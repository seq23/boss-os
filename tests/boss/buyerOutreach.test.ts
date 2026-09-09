import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, uid } from "./helpers";
import { runResume } from "../../src/worker/boss/approvals/resume";

/**
 * REVIEWING A BUYER PRODUCES A LETTER, AND THE LETTER IS NEVER SENT.
 *
 * ─── Her words, 9 September 2026 ───────────────────────────────────────────
 *
 *   "the capital tab has all these prospective buyers and i reviewed them ....now what? it doesn't
 *    suggest an email already crafted to send to them?"
 *
 * On the day she said it, all 28 candidates on that screen were already marked `reviewed`. She had
 * done everything the screen asked and it had nothing further to say — the whole of "runs but is
 * inert", on the one surface whose purpose is to start a conversation.
 *
 * ─── The two halves this file holds down ───────────────────────────────────
 *
 * 1. A verdict of `reviewed` puts a finished letter in her Inbox, drafted from the row.
 * 2. APPROVING IT SENDS NOTHING. There is no path from this system to a third party's inbox and
 *    approving does not create one; only she can say a letter was sent, and the candidate reaches
 *    `contacted` at that moment and no earlier.
 */

const CAND = "src_test_buyer";

async function seedCandidate(over: Record<string, unknown> = {}) {
  const now = Date.now();
  await env.DB.prepare(`DELETE FROM buyer_outreach_drafts`).run();
  await env.DB.prepare(`DELETE FROM counterparty_crossmatches`).run();
  await env.DB.prepare(`DELETE FROM sourcing_candidates WHERE id = ?`).bind(CAND).run();
  await env.DB
    .prepare(
      `INSERT INTO sourcing_candidates
         (id, name, kind, ticket_floor_usd, thesis, source_url, source_name, read_at, origin, status,
          history_kind, history_last_at, history_exchanges, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      CAND,
      String(over.name ?? "Saints Capital"),
      "buyer",
      over.ticket_floor_usd ?? 10_000_000,
      over.thesis ?? "they were founded exclusively for the direct secondary market",
      "https://example.test/secondaries",
      "their own fund page",
      now - 86_400_000,
      "public_research",
      "new",
      over.history_kind ?? null,
      over.history_last_at ?? null,
      over.history_exchanges ?? null,
      now, now,
    )
    .run();
}

const review = () => apiJson<any>(`/api/wealth/sourcing/${CAND}/status`, { method: "POST", body: { status: "reviewed" } });

describe("a reviewed buyer gets a letter, and nothing sends it", () => {
  beforeEach(async () => { await seedCandidate(); });

  it("drafts one from the row and puts it in her Inbox", async () => {
    const res = await review();
    expect(res.body.data.letter.drafted).toBe(true);

    const drafts = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts`).all<any>();
    // Rule 0: the assertions below would all pass over an empty table.
    expect(drafts.results).toHaveLength(1);
    const d = drafts.results![0]!;

    // COMPOSED FROM THE FACTS ON THE ROW, not from a template with blanks. Every one of these is a
    // column the sourcing sweep filled, and a letter that could not name why it was addressed to
    // this firm would have dropped the sentence rather than left a gap.
    expect(d.body).toContain("Saints Capital");
    expect(d.body).toContain("founded exclusively for the direct secondary market");
    expect(d.body).toContain("$10M");
    expect(d.to_hint).toContain("https://example.test/secondaries");
    expect(d.state).toBe("awaiting");

    // AND IT IS ACTUALLY IN THE INBOX, on the same mechanism as the covers, with the work visible.
    const pending = await apiJson<any>("/api/judgement/pending");
    const item = pending.body.data.items.find((i: any) => i.id === d.judgement_id);
    expect(item).toBeTruthy();
    expect(item.resume_kind).toBe("buyer_outreach_email");
    expect(item.letter.subject).toBe(d.subject);
    expect(item.letter.body).toBe(d.body);

    const approval = await apiJson<any>("/api/approvals?status=pending");
    expect(approval.body.data.some((a: any) => a.id === item.approval_id)).toBe(true);
  });

  it("opens on the history when she has actually dealt with them, never as a stranger", async () => {
    const when = Date.parse("2026-03-01T00:00:00Z");
    await seedCandidate({ history_kind: "dealt", history_last_at: when, history_exchanges: 24 });
    await review();
    const d = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts`).first<any>();
    expect(d.body).toContain("We have worked together before");
    expect(d.body).toContain("24 exchanges");
    expect(d.body).not.toContain("I broker private, late-stage technology secondaries —");
    expect(d.subject).toBe("New late-stage secondary supply");
  });

  it("refuses to write to a firm on the do-not-contact list, and says why on her screen", async () => {
    const now = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO counterparty_crossmatches
           (id, candidate_id, candidate_name, lp_firm, lp_list, matched_core, method, confidence, why, status, created_at, updated_at)
         VALUES (?,?,?,?,'suppressed',?,'token_core','confirmed','same firm','new',?,?)`,
      )
      .bind(uid("cxm"), CAND, "Saints Capital", "Saints Capital", "saints", now, now)
      .run();

    const res = await review();
    expect(res.body.data.status).toBe("reviewed"); // her verdict is never lost to a refusal
    expect(res.body.data.letter.drafted).toBe(false);
    expect(res.body.data.letter.detail).toContain("do-not-contact");
    const drafts = await env.DB.prepare(`SELECT COUNT(*) AS n FROM buyer_outreach_drafts`).first<{ n: number }>();
    expect(drafts?.n).toBe(0);
  });

  it("APPROVING SENDS NOTHING, and only she can say it was sent", async () => {
    await review();
    const d = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts`).first<any>();
    const j = await env.DB.prepare(`SELECT * FROM judgement_calls WHERE id = ?`).bind(d.judgement_id).first<any>();

    const out = await runResume(env as any, j, "approved", null);
    expect(out.detail).toContain("ready to send from your own address");

    const after = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts WHERE id = ?`).bind(d.id).first<any>();
    expect(after.state).toBe("approved");
    expect(after.sent_at).toBeNull();
    // THE CANDIDATE HAS NOT BEEN CONTACTED. Approving a letter is not an approach, and a list that
    // said otherwise would have her believing she had spoken to somebody she has not.
    const cand = await env.DB.prepare(`SELECT status FROM sourcing_candidates WHERE id = ?`).bind(CAND).first<any>();
    expect(cand.status).toBe("reviewed");

    // It is now on the desk, ready.
    const desk = await apiJson<any>("/api/wealth/outreach");
    expect(desk.body.data.approved).toHaveLength(1);
    expect(desk.body.data.awaiting).toHaveLength(0);

    // And SHE marks it sent — the one act that moves the candidate.
    await apiJson(`/api/wealth/outreach/${d.id}/sent`, { method: "POST", body: {} });
    const sent = await env.DB.prepare(`SELECT state, sent_at FROM buyer_outreach_drafts WHERE id = ?`).bind(d.id).first<any>();
    expect(sent.state).toBe("sent");
    expect(sent.sent_at).toBeGreaterThan(0);
    const contacted = await env.DB.prepare(`SELECT status FROM sourcing_candidates WHERE id = ?`).bind(CAND).first<any>();
    expect(contacted.status).toBe("contacted");
  });

  it("refuses to mark an unapproved letter as sent", async () => {
    await review();
    const d = await env.DB.prepare(`SELECT id FROM buyer_outreach_drafts`).first<any>();
    const res = await apiJson<any>(`/api/wealth/outreach/${d.id}/sent`, { method: "POST", body: {} });
    expect(res.status).toBe(400);
  });

  it("try again writes a second letter carrying her reason, and supersedes the first", async () => {
    await review();
    const first = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts`).first<any>();
    const j = await env.DB.prepare(`SELECT * FROM judgement_calls WHERE id = ?`).bind(first.judgement_id).first<any>();

    const out = await runResume(env as any, j, "try_again", "Too long, and do not mention the floor.");
    expect(out.detail).toContain("Attempt 2");

    const rows = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts ORDER BY attempt`).all<any>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results![0]!.state).toBe("try_again");
    expect(rows.results![0]!.her_note).toContain("Too long");
    expect(rows.results![1]!.attempt).toBe(2);
    expect(rows.results![1]!.state).toBe("awaiting");
    // Her sentence travels with the attempt so the next one can be evaluated against it.
    expect(JSON.parse(rows.results![1]!.built_from).her_note).toContain("Too long");
  });
});
