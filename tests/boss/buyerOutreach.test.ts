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

    /*
     * IN HER WORDS, 19 SEPTEMBER 2026. Her rejection note on the first live batch of thirteen: "I
     * dont like the intro: "I broker ...." We should make this sound like I have investors
     * interested in late stage positions. I also dont like the I am approaching paragraph sounds
     * like Ai and too technical. We should start by say My name is Sequoia Taylor, and I run Spry
     * VC. Maybe a link to my linkedin page". Each clause is pinned; the old letter fails every one.
     */
    expect(d.body).toContain("My name is Sequoia Taylor, and I run Spry VC");
    expect(d.body).toContain("investors who are actively looking for late-stage positions");
    expect(d.body).toContain("linkedin.com/in/sequoiataylor");
    expect(d.body).not.toContain("I broker");
    expect(d.body).not.toContain("I am approaching");
    expect(d.body).not.toContain("founded exclusively for the direct secondary market");
    // THE BUYER'S FLOOR IS NOT HER BOOK. The old letter read their $10M minimum back to them as
    // "the positions I work are $10M and up" — a claim about her inventory that nothing supported.
    expect(d.body).not.toContain("$10M");
    expect(d.body).not.toContain("positions I work are");
    // The subject still names the firm, so the Inbox card and the draft say who it is for.
    expect(d.subject).toContain("Saints Capital");
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
    /*
     * THE GREEN BUTTON MAKES A DRAFT, AND WITHOUT A KEY IT SAYS SO BY NAME. Owner, 19 September
     * 2026: "it should never send — the green button should be to create the draft." This harness
     * binds no service account, so the outcome is the NAMED STOP, recorded on gmail_drafts and said
     * back in words — never a silent approval that looks like a draft exists.
     */
    expect(out.detail).toContain("Blocked: the Worker holds no Google key");
    expect(out.gmail_draft?.state).toBe("blocked");
    expect(out.gmail_draft?.failure_code).toBe("no_worker_key");
    const gm = await env.DB.prepare(`SELECT * FROM gmail_drafts WHERE outreach_draft_id = ?`).bind(d.id).all<any>();
    expect(gm.results).toHaveLength(1);
    expect(gm.results![0]!.state).toBe("blocked");
    expect(gm.results![0]!.gmail_draft_id).toBeNull();

    const after = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts WHERE id = ?`).bind(d.id).first<any>();
    expect(after.state).toBe("approved");
    expect(after.sent_at).toBeNull();
    // THE CANDIDATE HAS NOT BEEN CONTACTED. Approving a letter is not an approach, and a list that
    // said otherwise would have her believing she had spoken to somebody she has not.
    const cand = await env.DB.prepare(`SELECT status FROM sourcing_candidates WHERE id = ?`).bind(CAND).first<any>();
    expect(cand.status).toBe("reviewed");

    // It is now on the desk, and the desk says where the draft is — here, that it is blocked and why.
    const desk = await apiJson<any>("/api/wealth/outreach");
    expect(desk.body.data.approved).toHaveLength(1);
    expect(desk.body.data.awaiting).toHaveLength(0);
    expect(desk.body.data.approved[0].gmail.state).toBe("blocked");
    expect(desk.body.data.approved[0].gmail.failure_code).toBe("no_worker_key");

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

  /*
   * ─── THE BOOMERANG, PINNED SHUT ────────────────────────────────────────────
   *
   * CONFIRMED ON PRODUCTION, 19 SEPTEMBER 2026: thirteen letters sent back with a reason, thirteen
   * word-for-word identical letters raised 0.1 s later (apr_m2wzrn0e… rejected at 1789827114262,
   * its twin jdg_m2x04sfx… raised at 1789827114391). Her words: "the Inbox tab brings them back
   * after I sent them away."
   *
   * The test this replaces PINNED THAT BEHAVIOUR — it asserted "Attempt 2" appeared after a
   * try-again with a note, on a composer whose output cannot change with the note. It was the
   * boomerang written as a passing test. Restoring the old resume handler makes every assertion
   * below fail.
   */
  it("try again with a note does NOT raise the same letter again — it leaves the desk with her note on record", async () => {
    await review();
    const first = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts`).first<any>();
    const j = await env.DB.prepare(`SELECT * FROM judgement_calls WHERE id = ?`).bind(first.judgement_id).first<any>();

    // THROUGH THE REAL ROUTE — the same press the Inbox makes — so the judgement's own state moves too.
    const decided = await apiJson<any>(`/api/approvals/${j.approval_id}/decide`, {
      method: "POST", body: { decision: "rejected", note: "Too long, and do not mention the floor." },
    });
    expect(decided.status).toBe(200);
    expect(decided.body.data.execution.status).toBe("executed");
    expect(decided.body.data.execution.detail.redrafted).toBe(false);
    const out = { detail: decided.body.data.execution.detail.resumed as string };
    expect(out.detail).toContain("word-for-word the one you sent back");
    expect(out.detail).not.toContain("Attempt 2");

    // ONE row, hers, sent back. No second attempt exists anywhere.
    const rows = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts ORDER BY attempt`).all<any>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results![0]!.state).toBe("try_again");
    expect(rows.results![0]!.her_note).toContain("Too long");
    const calls = await env.DB.prepare(`SELECT COUNT(*) AS n FROM judgement_calls WHERE resume_kind = 'buyer_outreach_email' AND state = 'awaiting'`).first<{ n: number }>();
    expect(calls?.n).toBe(0);

    // BOTH TABS READ THE SAME STATE. The Inbox does not hold it; the desk lists it as sent back.
    const pending = await apiJson<any>("/api/judgement/pending");
    expect(pending.body.data.items.filter((i: any) => i.resume_kind === "buyer_outreach_email")).toHaveLength(0);
    const desk = await apiJson<any>("/api/wealth/outreach/sent-back");
    expect(desk.body.data.items).toHaveLength(1);
    expect(desk.body.data.items[0].her_note).toContain("Too long");

    // THE RAISING LANE RUNS AGAIN AND STILL RAISES NOTHING — both doors it has.
    const again = await apiJson<any>(`/api/wealth/recommendations/${CAND}/draft`, { method: "POST", body: {} });
    expect(again.body.data.drafted).toBe(false);
    expect(again.body.data.detail).toContain("word-for-word");
    const all = await apiJson<any>("/api/wealth/outreach/redraft-sent-back", { method: "POST", body: {} });
    expect(all.body.data.considered).toBe(1);
    expect(all.body.data.raised).toHaveLength(0);
    expect(all.body.data.left).toHaveLength(1);
    const stillOne = await env.DB.prepare(`SELECT COUNT(*) AS n FROM buyer_outreach_drafts`).first<{ n: number }>();
    expect(stillOne?.n).toBe(1);
  });

  it("try again raises a second attempt ONLY when the letter would actually differ, and it carries her note", async () => {
    await review();
    const first = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts`).first<any>();
    const j = await env.DB.prepare(`SELECT * FROM judgement_calls WHERE id = ?`).bind(first.judgement_id).first<any>();

    // Between attempts she states the sizes she is working, which the letter now names.
    await apiJson("/api/wealth/working-positions", { method: "PUT", body: { text: "5M and 40M" } });

    const out = await runResume(env as any, j, "try_again", "Say what sizes I actually have.");
    expect(out.redrafted).toBe(true);
    expect(out.detail).toContain("Attempt 2");
    expect(out.detail).toContain("a different letter");

    const rows = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts ORDER BY attempt`).all<any>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results![0]!.state).toBe("try_again");
    expect(rows.results![1]!.attempt).toBe(2);
    expect(rows.results![1]!.state).toBe("awaiting");
    expect(rows.results![1]!.body).not.toBe(rows.results![0]!.body);
    expect(rows.results![1]!.body).toContain("$40M and $5M");
    // Her sentence travels with the attempt so the next one can be evaluated against it.
    expect(JSON.parse(rows.results![1]!.built_from).her_note).toContain("Say what sizes");
    // And the Inbox card carries it too.
    const pending = await apiJson<any>("/api/judgement/pending");
    const card = pending.body.data.items.find((i: any) => i.id === rows.results![1]!.judgement_id);
    expect(card.letter.her_note).toContain("Say what sizes");
    // The sent-back list no longer holds the firm: a later attempt exists.
    const desk = await apiJson<any>("/api/wealth/outreach/sent-back");
    expect(desk.body.data.items).toHaveLength(0);
  });
});
