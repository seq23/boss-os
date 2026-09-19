import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, insertApproval } from "./helpers";
import { MIN_BATCH_REASON_CHARS } from "../../src/worker/boss/routes/approvals";

/**
 * ONE REASON FOR MANY DOCKETS.
 *
 * ─── Her words, 19 September 2026 ──────────────────────────────────────────
 *
 *   "I need to be able to reject all things at once with an overarching reason why — right now I
 *    had 13 messages to reject."
 *
 * Confirmed on production: thirteen rejections, eleven of them with the decision note "same". So a
 * batch is ONE act with ONE reason, and each docket is still decided by its own call through the
 * same route a single press uses — its record carries the whole sentence and the act it belonged
 * to. Approve is not offered in bulk, and the route says why.
 */

const REASON = "Rewrite the opening: my name, Spry VC, and that I have investors interested in late-stage positions.";

async function thirteen(): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < 13; i++) ids.push(await insertApproval({ title: `Send this to Firm ${i + 1}?`, kind: "manual" }));
  return ids;
}

describe("one reason, thirteen dockets", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM approvals`).run();
    await env.DB.prepare(`DELETE FROM approval_batches`).run();
  });

  it("13 seeded → one batch → each rejected through its own decision, the reason on every record, the act counted", async () => {
    const ids = await thirteen();

    const opened = await apiJson<any>("/api/approvals/batches", { method: "POST", body: { decision: "rejected", reason: REASON, count: 13 } });
    expect(opened.status).toBe(201);
    const batchId = opened.body.data.id as string;

    for (const id of ids) {
      const r = await apiJson<any>(`/api/approvals/${id}/decide`, { method: "POST", body: { decision: "rejected", batch_id: batchId } });
      expect(r.status).toBe(200);
      expect(r.body.data.approval.status).toBe("rejected");
      // THE WHOLE SENTENCE ON THIS RECORD, not "same", and the act it belonged to.
      expect(r.body.data.approval.decision_note).toBe(REASON);
      expect(r.body.data.approval.batch_id).toBe(batchId);
    }

    // Rule 0 on the table itself: thirteen rows, all rejected, all carrying the reason and the batch.
    const rows = await env.DB
      .prepare(`SELECT status, decision_note, batch_id FROM approvals WHERE batch_id = ?`)
      .bind(batchId)
      .all<{ status: string; decision_note: string; batch_id: string }>();
    expect(rows.results).toHaveLength(13);
    for (const r of rows.results!) {
      expect(r.status).toBe("rejected");
      expect(r.decision_note).toBe(REASON);
    }
    const pending = await apiJson<any>("/api/approvals?status=pending");
    expect(pending.body.data).toHaveLength(0);

    // Every item has its own event and its own audit line naming the batch.
    const events = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM approval_events WHERE event = 'rejected' AND detail LIKE ?`)
      .bind(`%${batchId}%`)
      .first<{ n: number }>();
    expect(events?.n).toBe(13);
    const audits = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'approval' AND action = 'rejected' AND detail LIKE ?`)
      .bind(`%${batchId}%`)
      .first<{ n: number }>();
    expect(audits?.n).toBe(13);

    // The act counted what happened.
    const batch = await apiJson<any>(`/api/approvals/batches/${batchId}`);
    expect(batch.body.data.batch.done_count).toBe(13);
    expect(batch.body.data.batch.failed_count).toBe(0);
    expect(batch.body.data.items).toHaveLength(13);
  });

  it("refuses 'same' — the shared reason must be a sentence", async () => {
    const r = await apiJson<any>("/api/approvals/batches", { method: "POST", body: { decision: "rejected", reason: "same", count: 13 } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain(`${MIN_BATCH_REASON_CHARS} characters`);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM approval_batches`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("refuses a bulk APPROVE by name — approving is one docket at a time", async () => {
    const r = await apiJson<any>("/api/approvals/batches", { method: "POST", body: { decision: "approved", reason: REASON, count: 13 } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("Only a rejection");
    // And the table's own CHECK refuses it even if the route did not.
    await expect(
      env.DB.prepare(`INSERT INTO approval_batches (id, decision, reason, requested_count, created_at, updated_at) VALUES ('apb_x','approved',?,1,1,1)`).bind(REASON).run(),
    ).rejects.toThrow();
  });

  it("a batch opened to reject cannot be used to approve a docket", async () => {
    const [id] = await thirteen();
    const opened = await apiJson<any>("/api/approvals/batches", { method: "POST", body: { decision: "rejected", reason: REASON, count: 1 } });
    const r = await apiJson<any>(`/api/approvals/${id}/decide`, { method: "POST", body: { decision: "approved", batch_id: opened.body.data.id } });
    expect(r.status).toBe(409);
    const row = await env.DB.prepare(`SELECT status FROM approvals WHERE id = ?`).bind(id).first<{ status: string }>();
    expect(row?.status).toBe("pending");
  });

  it("a docket already decided fails ITS decision only, and the act records the failure", async () => {
    const ids = await thirteen();
    await apiJson(`/api/approvals/${ids[0]}/decide`, { method: "POST", body: { decision: "approved" } });
    const opened = await apiJson<any>("/api/approvals/batches", { method: "POST", body: { decision: "rejected", reason: REASON, count: 13 } });
    const batchId = opened.body.data.id as string;

    let done = 0, failed = 0;
    for (const id of ids) {
      const r = await apiJson<any>(`/api/approvals/${id}/decide`, { method: "POST", body: { decision: "rejected", batch_id: batchId } });
      if (r.status === 200) done += 1;
      else {
        failed += 1;
        expect(r.status).toBe(409);
        await apiJson(`/api/approvals/batches/${batchId}/failed`, { method: "POST", body: { approval_id: id, error: r.body.error } });
      }
    }
    expect(done).toBe(12);
    expect(failed).toBe(1);
    const batch = await apiJson<any>(`/api/approvals/batches/${batchId}`);
    expect(batch.body.data.batch.done_count).toBe(12);
    expect(batch.body.data.batch.failed_count).toBe(1);
    // The approved one is untouched by the batch.
    const first = await env.DB.prepare(`SELECT status, batch_id FROM approvals WHERE id = ?`).bind(ids[0]).first<any>();
    expect(first.status).toBe("approved");
    expect(first.batch_id).toBeNull();
  });

  it("a note of her own on one item outranks the shared reason for that item", async () => {
    const [id] = await thirteen();
    const opened = await apiJson<any>("/api/approvals/batches", { method: "POST", body: { decision: "rejected", reason: REASON, count: 1 } });
    const r = await apiJson<any>(`/api/approvals/${id}/decide`, {
      method: "POST", body: { decision: "rejected", batch_id: opened.body.data.id, note: "This one specifically: wrong firm." },
    });
    expect(r.body.data.approval.decision_note).toBe("This one specifically: wrong firm.");
    expect(r.body.data.approval.batch_id).toBe(opened.body.data.id);
  });
});
