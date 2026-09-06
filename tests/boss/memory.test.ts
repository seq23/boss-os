import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { runPromotionSweep } from "../../src/worker/boss/routes/memory";
import { executeDecision, type ApprovalRow } from "../../src/worker/boss/approvals/execute";
import { apiJson, insertMemory, row, all } from "./helpers";

const post = (path: string, body?: unknown) => apiJson(path, { method: "POST", body: body ?? {} });
const DAY = 86_400_000;

describe("Phase 3 — nothing becomes memory without approval", () => {
  it("refuses to create a memory above capture", async () => {
    const { status, body } = await post("/api/memory", { title: "T", body: "B", tier: "canon" });
    expect(status).toBe(409);
    expect(body.error).toContain("above capture");
  });

  it("captures at the capture tier regardless of what was asked for", async () => {
    const { status, body } = await post("/api/memory", { title: "A fact", body: "The body" });
    expect(status).toBe(201);
    expect(body.data.tier).toBe("capture");
    expect(body.data.promoted_at).toBeNull();
  });

  it("raises an approval rather than promoting on request", async () => {
    const id = await insertMemory({ tier: "capture" });
    const { status, body } = await post(`/api/memory/${id}/promote`, { to_tier: "working" });
    expect(status).toBe(201);

    // The tier has not moved yet.
    expect((await row(`SELECT tier FROM memory_items WHERE id = ?`, id))!.tier).toBe("capture");
    const event = await row(`SELECT outcome FROM promotion_events WHERE approval_id = ?`, body.data.approval_id);
    expect(event!.outcome).toBe("proposed");
  });

  it("refuses a sideways or downward promotion", async () => {
    const id = await insertMemory({ tier: "working" });
    const { status } = await post(`/api/memory/${id}/promote`, { to_tier: "capture" });
    expect(status).toBe(409);
  });

  it("refuses to stack a second pending promotion on the same memory", async () => {
    const id = await insertMemory({ tier: "capture" });
    await post(`/api/memory/${id}/promote`, { to_tier: "working" });
    const { status } = await post(`/api/memory/${id}/promote`, { to_tier: "working" });
    expect(status).toBe(409);
  });
});

describe("Phase 3 — promotion sweep", () => {
  it("applies a rule that needs no approval and records why", async () => {
    const id = await insertMemory({ tier: "capture", hits: 5, confidence: 0.9, created_at: Date.now() - 3 * DAY });
    const result = await runPromotionSweep(env);

    expect(result.promoted).toBeGreaterThanOrEqual(1);
    expect((await row(`SELECT tier FROM memory_items WHERE id = ?`, id))!.tier).toBe("working");
    const event = await row(`SELECT outcome, note FROM promotion_events WHERE item_id = ?`, id);
    expect(event!.outcome).toBe("applied");
    expect(event!.note).toContain("Capture to working");
  });

  it("raises an approval for a rule that requires one, without moving the tier", async () => {
    const id = await insertMemory({ tier: "working", hits: 9, confidence: 0.95, created_at: Date.now() - 30 * DAY });
    const result = await runPromotionSweep(env);

    expect(result.proposed).toBeGreaterThanOrEqual(1);
    expect((await row(`SELECT tier FROM memory_items WHERE id = ?`, id))!.tier).toBe("working");
    const event = await row(`SELECT outcome FROM promotion_events WHERE item_id = ?`, id);
    expect(event!.outcome).toBe("proposed");
  });

  it("leaves memories that have not earned promotion alone", async () => {
    const id = await insertMemory({ tier: "capture", hits: 0, confidence: 0.1, created_at: Date.now() });
    await runPromotionSweep(env);
    expect((await row(`SELECT tier FROM memory_items WHERE id = ?`, id))!.tier).toBe("capture");
  });

  it("does not stack duplicate cards when it runs twice", async () => {
    await insertMemory({ tier: "working", hits: 9, confidence: 0.95, created_at: Date.now() - 30 * DAY });
    await runPromotionSweep(env);
    const first = await all(`SELECT id FROM promotion_events WHERE outcome = 'proposed'`);
    await runPromotionSweep(env);
    const second = await all(`SELECT id FROM promotion_events WHERE outcome = 'proposed'`);
    expect(second.length).toBe(first.length);
  });

  it("ignores archived memories", async () => {
    const id = await insertMemory({
      tier: "capture", hits: 5, confidence: 0.9,
      created_at: Date.now() - 3 * DAY, status: "archived",
    });
    await runPromotionSweep(env);
    expect((await row(`SELECT tier FROM memory_items WHERE id = ?`, id))!.tier).toBe("capture");
  });
});

describe("Phase 3 — the full promotion loop", () => {
  it("moves the tier only after the approval clears", async () => {
    const id = await insertMemory({ tier: "working", hits: 9, confidence: 0.95, created_at: Date.now() - 30 * DAY });
    await runPromotionSweep(env);

    const event = await row(`SELECT approval_id FROM promotion_events WHERE item_id = ?`, id);
    const approval = await row<ApprovalRow>(`SELECT * FROM approvals WHERE id = ?`, event!.approval_id);

    expect((await row(`SELECT tier FROM memory_items WHERE id = ?`, id))!.tier).toBe("working");
    await executeDecision(env, approval!, "approved");
    expect((await row(`SELECT tier FROM memory_items WHERE id = ?`, id))!.tier).toBe("canon");
  });
});

describe("Phase 3 — archive path", () => {
  it("archives and restores without losing the record", async () => {
    const id = await insertMemory({});
    await post(`/api/memory/${id}/archive`, { reason: "Superseded" });
    expect((await row(`SELECT status FROM memory_items WHERE id = ?`, id))!.status).toBe("archived");

    await post(`/api/memory/${id}/restore`);
    expect((await row(`SELECT status FROM memory_items WHERE id = ?`, id))!.status).toBe("active");
  });

  it("counts a hit, which is what earns promotion", async () => {
    const id = await insertMemory({ hits: 0 });
    await post(`/api/memory/${id}/hit`);
    const item = await row(`SELECT hits, last_hit_at FROM memory_items WHERE id = ?`, id);
    expect(item!.hits).toBe(1);
    expect(item!.last_hit_at).toBeGreaterThan(0);
  });
});
