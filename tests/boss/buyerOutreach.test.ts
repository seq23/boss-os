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
   * ─── THE BOOMERANG, PINNED SHUT — AND THE REWRITE THAT ANSWERS HER NOTE ────
   *
   * CONFIRMED ON PRODUCTION, 19 SEPTEMBER 2026, TWICE. Morning: thirteen letters sent back with a
   * reason, thirteen word-for-word identical letters raised 0.1 s later. Afternoon, after #27
   * closed that: thirteen sent back again with a real note ("talk about some of the names I'm
   * currently working on … hyperlink to my linkedin"), and thirteen honest refusals — "No new
   * letter … it would be word-for-word" — because the composer cannot read a note. Her words: "I
   * don't see it working on re-writing them."
   *
   * So a send-back with a note now QUEUES A REWRITE and raises nothing itself. The assertions
   * below pin both halves: nothing identical comes back (the boomerang), and the work she is owed
   * is queued, visible as progress, and owned (the silence). Restoring the old resume handler
   * fails both.
   */
  it("try again with a note raises NOTHING itself — it queues the rewrite and says so on both tabs", async () => {
    await review();
    const first = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts`).first<any>();
    const j = await env.DB.prepare(`SELECT * FROM judgement_calls WHERE id = ?`).bind(first.judgement_id).first<any>();

    // THROUGH THE REAL ROUTE — the same press the Inbox makes — so the judgement's own state moves too.
    const decided = await apiJson<any>(`/api/approvals/${j.approval_id}/decide`, {
      method: "POST", body: { decision: "rejected", note: "Too long, and do not mention the floor." },
    });
    expect(decided.status).toBe(200);
    expect(decided.body.data.execution.status).toBe("executed");
    expect(decided.body.data.execution.detail.rewrite_queued).toBe(true);
    const resumed = decided.body.data.execution.detail.resumed as string;
    expect(resumed).toContain("rewriting the letter");
    expect(resumed).toContain("nothing is sent to anybody");
    expect(resumed).not.toContain("Attempt 2");

    // ONE letter row, hers, sent back. No second attempt exists anywhere — the rewrite has not run.
    const rows = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts ORDER BY attempt`).all<any>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results![0]!.state).toBe("try_again");
    expect(rows.results![0]!.her_note).toContain("Too long");
    const calls = await env.DB.prepare(`SELECT COUNT(*) AS n FROM judgement_calls WHERE resume_kind = 'buyer_outreach_email' AND state = 'awaiting'`).first<{ n: number }>();
    expect(calls?.n).toBe(0);

    // THE REWRITE IS QUEUED, OWNED BY CAMILLE, ON THE WORKER'S OWN QUEUE — not parked for a Mac slot.
    const rw = await env.DB.prepare(`SELECT * FROM outreach_rewrites`).all<any>();
    expect(rw.results).toHaveLength(1);
    expect(rw.results![0]!.state).toBe("queued");
    expect(rw.results![0]!.her_note).toContain("Too long");
    expect(rw.results![0]!.source_draft_id).toBe(first.id);
    const task = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(rw.results![0]!.task_id).first<any>();
    expect(task.status).toBe("queued");
    expect(task.employee_id).toBe("emp_research");
    expect(task.model_access).toBe("private_model_only");
    expect(JSON.parse(task.input).outreach_rewrite.rewrite_id).toBe(rw.results![0]!.id);
    expect(JSON.parse(task.input).backend_id).toBeUndefined(); // no seat, no launchd wait

    // BOTH TABS READ THE SAME STATE. The Inbox does not hold it; the desk lists it as sent back,
    // and the progress line — ONE sentence for both tabs — says it is being rewritten.
    const pending = await apiJson<any>("/api/judgement/pending");
    expect(pending.body.data.items.filter((i: any) => i.resume_kind === "buyer_outreach_email")).toHaveLength(0);
    const desk = await apiJson<any>("/api/wealth/outreach/sent-back");
    expect(desk.body.data.items).toHaveLength(1);
    expect(desk.body.data.items[0].her_note).toContain("Too long");
    const progress = await apiJson<any>("/api/wealth/outreach/rewrites");
    expect(progress.body.data.total).toBe(1);
    expect(progress.body.data.rewriting).toBe(1);
    expect(progress.body.data.ready).toBe(0);
    expect(progress.body.data.sentence).toBe("1 sent back with your note · rewriting now · 0 of 1 ready in your Inbox");

    // THE OLD DOORS STILL RAISE NOTHING IDENTICAL, AND THE DESK BUTTON QUEUES NO SECOND REWRITE.
    const again = await apiJson<any>(`/api/wealth/recommendations/${CAND}/draft`, { method: "POST", body: {} });
    expect(again.body.data.drafted).toBe(false);
    expect(again.body.data.detail).toContain("word-for-word");
    const all = await apiJson<any>("/api/wealth/outreach/redraft-sent-back", { method: "POST", body: {} });
    expect(all.body.data.queued_now).toBe(0);
    expect(all.body.data.total).toBe(1);
    const stillOne = await env.DB.prepare(`SELECT COUNT(*) AS n FROM buyer_outreach_drafts`).first<{ n: number }>();
    expect(stillOne?.n).toBe(1);
    const stillOneRewrite = await env.DB.prepare(`SELECT COUNT(*) AS n FROM outreach_rewrites`).first<{ n: number }>();
    expect(stillOneRewrite?.n).toBe(1);
  });

  it("try again with NO note queues nothing and says the next letter would be a guess", async () => {
    await review();
    const first = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts`).first<any>();
    const j = await env.DB.prepare(`SELECT * FROM judgement_calls WHERE id = ?`).bind(first.judgement_id).first<any>();
    const out = await runResume(env as any, j, "try_again", null);
    expect(out.rewrite_queued).toBe(false);
    expect(out.detail).toContain("would be a guess");
    const rw = await env.DB.prepare(`SELECT COUNT(*) AS n FROM outreach_rewrites`).first<{ n: number }>();
    expect(rw?.n).toBe(0);
  });
});
