/**
 * THE REWRITE THAT ANSWERS HER NOTE — `wealth/rewrite.ts`.
 *
 * Driven with a FAKE model (`complete`) so what is pinned is the mechanism: the prompt carries
 * every note and the rejected letter; the rules are checked in code and a broken reply is sent
 * back once; a good reply becomes attempt N+1 in her Inbox with her note beside it; the row the
 * desk polls moves queued → running → ready/failed; the queue consumer branches on the task; the
 * hourly tick and the progress read materialise what she is owed; and none of it can raise a
 * letter she already sent back.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiJson, uid, stubFetch } from "./helpers";
import { runResume } from "../../src/worker/boss/approvals/resume";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { runDuties } from "../../src/worker/boss/index";
import {
  checkLetter, composeRewritePrompt, materialiseRewrites, parseLetterReply, queueRewrite,
  rewriteProgress, runOutreachRewrite, STALE_RUNNING_MS, type Complete, type LetterFacts,
} from "../../src/worker/boss/wealth/rewrite";
import type { RouteResult } from "../../src/worker/boss/router";

const CAND = "src_test_rewrite";
const NOTE_1 = "Rewrite the opening: my name, Spry VC, and that I have investors interested in late-stage positions. never refer to me as a broker";
const NOTE_2 = "talk about some of the names im currently working on like anthropic bytedance openai, in the introduction add a hyperlink to my linkedin profile where you say Spry VC";

const GOOD_BODY =
  "My name is Sequoia Taylor, and I run Spry VC (linkedin.com/in/sequoiataylor). I work with investors who are actively looking for late-stage positions in private technology companies, and I match them with holders who want liquidity.\n\n" +
  "Right now I am working on names like Anthropic, ByteDance and OpenAI, and the investors I work with have appetite for more of the same. If it is useful, I will send you what is currently available and the terms, and you can tell me whether any of it is a fit. If it is not, tell me what you are actually looking for and I will only come back when I have it.\n\n" +
  "Sequoia Taylor\nSpry VC\nlinkedin.com/in/sequoiataylor";

function reply(text: string, cost = 0): RouteResult {
  return {
    text, costMicros: cost, modelId: "mdl_cf_llama33_70b", modelName: "Llama 3.3 70B (Workers AI)", modelDisplayName: "Llama 3.3 70B (Workers AI)",
    providerId: "prv_workers_ai", usedFallback: false, decisionId: uid("rtd"), backendId: "bk_workers_ai", backendName: "Workers AI",
    degraded: false, degradedReason: null, notice: null, freeTier: true,
  };
}

/** A fake model that answers from a script and records every prompt it was shown. */
function fakeModel(script: string[]) {
  const seen: { system: string; user: string; turns: number }[] = [];
  let i = 0;
  const complete: Complete = async (_env, req) => {
    const system = req.messages.find((m) => m.role === "system")?.content ?? "";
    const users = req.messages.filter((m) => m.role === "user").map((m) => m.content);
    seen.push({ system, user: users[users.length - 1] ?? "", turns: req.messages.length });
    expect(req.modelAccess).toBe("private_model_only");
    expect(req.risk).toBe("medium");
    return reply(script[Math.min(i++, script.length - 1)] ?? "");
  };
  return { complete, seen };
}

async function seedCandidate(over: Record<string, unknown> = {}) {
  const now = Date.now();
  await env.DB.prepare(`DELETE FROM outreach_rewrites`).run();
  await env.DB.prepare(`DELETE FROM buyer_outreach_drafts`).run();
  await env.DB.prepare(`DELETE FROM counterparty_crossmatches`).run();
  await env.DB.prepare(`DELETE FROM judgement_calls WHERE resume_kind = 'buyer_outreach_email'`).run();
  await env.DB.prepare(`DELETE FROM sourcing_candidates WHERE id = ?`).bind(CAND).run();
  await env.DB
    .prepare(
      `INSERT INTO sourcing_candidates
         (id, name, kind, ticket_floor_usd, thesis, source_url, source_name, read_at, origin, status,
          history_kind, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(CAND, String(over.name ?? "Saints Capital"), "buyer", 10_000_000, "direct secondary market",
      "https://example.test/secondaries", "their own fund page", now - 86_400_000, "public_research", "reviewed", null, now, now)
    .run();
}

/** Review → letter in the Inbox → she sends it back with a note. Returns the sent-back draft. */
async function sendBack(note: string) {
  const res = await apiJson<any>(`/api/wealth/sourcing/${CAND}/status`, { method: "POST", body: { status: "reviewed" } });
  expect(res.body.data.letter.drafted).toBe(true);
  const d = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts WHERE state = 'awaiting'`).first<any>();
  const j = await env.DB.prepare(`SELECT * FROM judgement_calls WHERE id = ?`).bind(d.judgement_id).first<any>();
  const out = await runResume(env as any, j, "try_again", note);
  return { draft: await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts WHERE id = ?`).bind(d.id).first<any>(), out };
}

async function facts(): Promise<LetterFacts> {
  const candidate = await env.DB.prepare(`SELECT * FROM sourcing_candidates WHERE id = ?`).bind(CAND).first<any>();
  return {
    candidate, positions_usd: [], notes: [NOTE_1, NOTE_2],
    previous: { subject: "Late-stage secondaries — Saints Capital", body: "the old letter", attempt: 1 },
    rejectedBodies: ["the old letter"],
  };
}

describe("the rules are code, not prose", () => {
  beforeEach(seedCandidate);

  it("passes a letter that answers her notes and breaks none", async () => {
    expect(checkLetter({ subject: "Late-stage secondaries", body: GOOD_BODY }, await facts())).toEqual([]);
  });

  it("names every rule the letter breaks, in her language", async () => {
    const f = await facts();
    const bad = {
      subject: "Hi",
      body: "I broker deals. Positions I work are $50M and up. Email me at x@y.com or see https://example.com. the old letter",
    };
    const broken = checkLetter(bad, f);
    expect(broken.join(" | ")).toContain("at-sign");
    expect(broken.join(" | ")).toContain("broker");
    expect(broken.join(" | ")).toContain("her name");
    expect(broken.join(" | ")).toContain("LinkedIn");
    expect(broken.join(" | ")).toContain("link other than");
    expect(broken.join(" | ")).toContain("$50M");
    expect(broken.join(" | ")).toContain("too short");
  });

  it("allows only the sizes she stated herself", async () => {
    const f = { ...(await facts()), positions_usd: [40_000_000, 5_000_000] };
    const withHers = GOOD_BODY.replace("more of the same.", "more of the same; the positions I am working right now are $40M and $5M.");
    expect(checkLetter({ subject: "s", body: withHers }, f)).toEqual([]);
    const withTheirs = GOOD_BODY.replace("more of the same.", "more of the same, and your $10M minimum is fine.");
    expect(checkLetter({ subject: "s", body: withTheirs }, f).join(" ")).toContain("$10M");
  });

  it("refuses a letter that is word-for-word one she sent back, whitespace aside", async () => {
    const f = { ...(await facts()), rejectedBodies: [GOOD_BODY] };
    expect(checkLetter({ subject: "s", body: GOOD_BODY.replace(/\n\n/g, "\n \n") }, f).join(" ")).toContain("word-for-word");
  });

  it("parses the reply with or without a code fence, and refuses anything else", () => {
    const obj = { subject: "A", body: "B" };
    expect(parseLetterReply(JSON.stringify(obj))).toEqual(obj);
    expect(parseLetterReply("```json\n" + JSON.stringify(obj) + "\n```")).toEqual(obj);
    expect(parseLetterReply("Here it is:\n" + JSON.stringify(obj) + "\nHope that helps")).toEqual(obj);
    // CONFIRMED on the first live run: Llama 3.3 70B puts real line breaks inside the JSON string.
    const rawNewlines = '{"subject": "Late-stage secondaries", "body": "My name is Sequoia Taylor.\n\nSecond paragraph."}';
    expect(parseLetterReply(rawNewlines)).toEqual({ subject: "Late-stage secondaries", body: "My name is Sequoia Taylor.\n\nSecond paragraph." });
    expect(parseLetterReply("just prose")).toBeNull();
    expect(parseLetterReply(JSON.stringify({ subject: "A" }))).toBeNull();
  });

  it("tells the model every note, the rejected letter, and the rules — the prompt is the instruction", async () => {
    const p = composeRewritePrompt(await facts());
    expect(p.user).toContain(NOTE_1);
    expect(p.user).toContain(NOTE_2);
    expect(p.user).toContain("the old letter");
    expect(p.user).toContain("NEVER call her a broker");
    expect(p.user).toContain("(none stated — say nothing about size)");
    expect(p.system).toContain("Camille");
    expect(p.system).toContain("ONE JSON object");
  });
});

describe("a send-back with a note becomes a different letter, in her Inbox, with the note beside it", () => {
  beforeEach(seedCandidate);

  it("queues on send-back, runs on the queue, raises attempt 2 answering the note, and the desk sees every step", async () => {
    const { draft, out } = await sendBack(NOTE_2);
    expect(out.rewrite_queued).toBe(true);
    const rw = await env.DB.prepare(`SELECT * FROM outreach_rewrites`).first<any>();
    expect(rw.state).toBe("queued");
    expect(rw.source_draft_id).toBe(draft.id);
    expect(JSON.parse(rw.notes_all)).toEqual([NOTE_2]);

    // The progress line, before anything ran: ONE sentence for both tabs.
    let progress = await rewriteProgress(env as any);
    expect(progress.sentence).toBe("1 sent back with your note · rewriting now · 0 of 1 ready in your Inbox");

    const model = fakeModel([JSON.stringify({ subject: "Late-stage secondaries — Saints Capital", body: GOOD_BODY })]);
    const task = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(rw.task_id).first<any>();
    const result = await runOutreachRewrite(env as any, { id: task.id, lane: task.lane, employee_id: task.employee_id }, rw.id, model.complete);
    expect(result.state).toBe("ready");
    expect(result.written_by).toContain("Llama 3.3 70B");

    // The model was shown her note and the letter she sent back — one call, no retry needed.
    expect(model.seen).toHaveLength(1);
    expect(model.seen[0]!.user).toContain(NOTE_2);
    expect(model.seen[0]!.user).toContain(draft.body);

    // Attempt 2 is in her Inbox, different, answering the note, and says who wrote it.
    const rows = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts ORDER BY attempt`).all<any>();
    expect(rows.results).toHaveLength(2);
    const second = rows.results![1]!;
    expect(second.attempt).toBe(2);
    expect(second.state).toBe("awaiting");
    expect(second.body).not.toBe(draft.body);
    expect(second.body).toContain("Anthropic");
    expect(second.body).toContain("Spry VC (linkedin.com/in/sequoiataylor)");
    expect(second.her_note).toBe(NOTE_2);
    const built = JSON.parse(second.built_from);
    expect(built.her_note).toBe(NOTE_2);
    expect(built.written_by).toContain("Llama 3.3 70B");
    expect(built.rewrite_id).toBe(rw.id);

    const pending = await apiJson<any>("/api/judgement/pending");
    const card = pending.body.data.items.find((i: any) => i.id === second.judgement_id);
    expect(card.letter.her_note).toBe(NOTE_2);
    expect(card.question).toContain("answering your note");

    // The row the desk polls says ready, names the letter, and the sentence moves with it.
    const after = await env.DB.prepare(`SELECT * FROM outreach_rewrites WHERE id = ?`).bind(rw.id).first<any>();
    expect(after.state).toBe("ready");
    expect(after.result_draft_id).toBe(second.id);
    progress = await rewriteProgress(env as any);
    expect(progress.sentence).toBe("1 sent back with your note · rewritten · 1 of 1 ready in your Inbox");
    const desk = await apiJson<any>("/api/wealth/outreach/sent-back");
    expect(desk.body.data.items).toHaveLength(0);

    // Once she decides on the new letter the wave is over and the line goes away.
    const j2 = await env.DB.prepare(`SELECT * FROM judgement_calls WHERE id = ?`).bind(second.judgement_id).first<any>();
    await runResume(env as any, j2, "approved", null);
    progress = await rewriteProgress(env as any);
    expect(progress.total).toBe(0);
    expect(progress.sentence).toBeNull();
  });

  it("sends a rule-breaking reply back to the model ONCE with the broken rules named, then raises the corrected one", async () => {
    const { out } = await sendBack(NOTE_1);
    expect(out.rewrite_queued).toBe(true);
    const rw = await env.DB.prepare(`SELECT * FROM outreach_rewrites`).first<any>();
    const model = fakeModel([
      JSON.stringify({ subject: "s", body: GOOD_BODY.replace("I work with investors", "I broker deals and I work with investors") }),
      JSON.stringify({ subject: "s", body: GOOD_BODY }),
    ]);
    const task = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(rw.task_id).first<any>();
    const result = await runOutreachRewrite(env as any, task, rw.id, model.complete);
    expect(result.state).toBe("ready");
    expect(model.seen).toHaveLength(2);
    expect(model.seen[1]!.user).toContain("broke these rules");
    expect(model.seen[1]!.user).toContain("broker");
    expect(model.seen[1]!.turns).toBe(4); // system, user, assistant, user
  });

  it("after two broken replies it FAILS by name on the row, raises nothing, and keeps her note on the record", async () => {
    const { draft } = await sendBack(NOTE_1);
    const rw = await env.DB.prepare(`SELECT * FROM outreach_rewrites`).first<any>();
    const model = fakeModel([JSON.stringify({ subject: "s", body: "Contact me at a@b.com. " + GOOD_BODY })]);
    const task = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(rw.task_id).first<any>();
    const result = await runOutreachRewrite(env as any, task, rw.id, model.complete);
    expect(result.state).toBe("failed");
    expect(result.detail).toContain("at-sign");
    const after = await env.DB.prepare(`SELECT * FROM outreach_rewrites WHERE id = ?`).bind(rw.id).first<any>();
    expect(after.state).toBe("failed");
    expect(after.failure).toContain("Two tries");
    const rows = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts`).all<any>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results![0]!.id).toBe(draft.id);
    expect(rows.results![0]!.her_note).toBe(NOTE_1);
    const progress = await rewriteProgress(env as any);
    expect(progress.failed).toHaveLength(1);
    expect(progress.failed[0]!.why).toContain("at-sign");
    expect(progress.sentence).toBe("1 sent back with your note · 1 could not be rewritten · 0 of 1 ready in your Inbox");
  });

  it("can never raise a letter she already sent back, even when the model returns one", async () => {
    const { draft } = await sendBack(NOTE_1);
    const rw = await env.DB.prepare(`SELECT * FROM outreach_rewrites`).first<any>();
    const model = fakeModel([JSON.stringify({ subject: draft.subject, body: draft.body })]);
    const task = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(rw.task_id).first<any>();
    const result = await runOutreachRewrite(env as any, task, rw.id, model.complete);
    expect(result.state).toBe("failed");
    expect(result.detail).toContain("word-for-word");
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM buyer_outreach_drafts`).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("carries EVERY note she has written on the firm, oldest first — the first note is not forgotten by the second", async () => {
    const one = await sendBack(NOTE_1);
    const rw1 = await env.DB.prepare(`SELECT * FROM outreach_rewrites`).first<any>();
    const model = fakeModel([JSON.stringify({ subject: "s", body: GOOD_BODY })]);
    const t1 = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(rw1.task_id).first<any>();
    await runOutreachRewrite(env as any, t1, rw1.id, model.complete);

    // She sends attempt 2 back with a second note.
    const second = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts WHERE attempt = 2`).first<any>();
    const j2 = await env.DB.prepare(`SELECT * FROM judgement_calls WHERE id = ?`).bind(second.judgement_id).first<any>();
    const out2 = await runResume(env as any, j2, "try_again", NOTE_2);
    expect(out2.rewrite_queued).toBe(true);
    const rw2 = await env.DB.prepare(`SELECT * FROM outreach_rewrites WHERE source_draft_id = ?`).bind(second.id).first<any>();
    expect(JSON.parse(rw2.notes_all)).toEqual([NOTE_1, NOTE_2]);
    const model2 = fakeModel([JSON.stringify({ subject: "s", body: GOOD_BODY.replace("liquidity.", "liquidity today.") })]);
    const t2 = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(rw2.task_id).first<any>();
    const r2 = await runOutreachRewrite(env as any, t2, rw2.id, model2.complete);
    expect(r2.state).toBe("ready");
    expect(model2.seen[0]!.user).toContain(NOTE_1);
    expect(model2.seen[0]!.user).toContain(NOTE_2);
    // Both rejected letters are named so neither can come back.
    expect(model2.seen[0]!.user).toContain(one.draft.body);
    expect(model2.seen[0]!.user).toContain("EARLIER LETTERS SHE ALSO SENT BACK");
  });

  it("the queue consumer branches on the task and closes it with the rewrite's outcome", async () => {
    await sendBack(NOTE_1);
    const rw = await env.DB.prepare(`SELECT * FROM outreach_rewrites`).first<any>();
    /*
     * Through `handleTask` with the real router: this harness binds no model that may take
     * private-model-only work at medium risk, so the honest outcome is a NAMED refusal — the
     * task fails with the router's sentence, the row says why, and nothing is raised. The branch
     * is proven by the task closing with the rewrite's outcome rather than the generic draft.
     */
    await handleTask(env as any, { taskId: rw.task_id, lane: "ops" });
    const task = await env.DB.prepare(`SELECT status, error, output FROM tasks WHERE id = ?`).bind(rw.task_id).first<any>();
    const after = await env.DB.prepare(`SELECT state, failure FROM outreach_rewrites WHERE id = ?`).bind(rw.id).first<any>();
    expect(["failed", "queued"]).toContain(after.state);
    expect(task.status).toBe("failed");
    expect(task.error).toBeTruthy();
    expect(task.output).toBeNull(); // the generic path would have stored a { text, model } draft
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM buyer_outreach_drafts`).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});

describe("what she is owed is materialised without her pressing anything", () => {
  beforeEach(seedCandidate);
  /*
   * HERMETIC. `runDuties` is the whole hourly tick, and since 0263 the tick runs the `worker`
   * readers when they are due — twelve real GETs to the grid's live domains, 10 s timeout each.
   * On 21 Sep 2026 that put this test at 4.1 s on an M2 and past the 5 s default on the CI runner,
   * twice in a row, on a PR that never touched a rewrite: a unit test whose duration was the
   * internet's. The same stub `duties.test.ts` uses; the readers' own behaviour is
   * `propertyReaders.test.ts`'s to prove, not this file's.
   */
  let restoreFetch: (() => void) | null = null;
  beforeEach(() => { restoreFetch = stubFetch(() => new Response("ok")); });
  afterEach(() => { restoreFetch?.(); restoreFetch = null; });

  it("a sent-back letter with a note and no rewrite row (production's thirteen) is queued by the progress read and by the tick", async () => {
    const { draft } = await sendBack(NOTE_2);
    // Simulate production before this PR: the note is on the record and no rewrite exists.
    await env.DB.prepare(`DELETE FROM outreach_rewrites`).run();
    expect((await rewriteProgress(env as any)).total).toBe(0);

    const read = await apiJson<any>("/api/wealth/outreach/rewrites");
    expect(read.body.data.total).toBe(1);
    expect(read.body.data.rewriting).toBe(1);
    const rw = await env.DB.prepare(`SELECT * FROM outreach_rewrites WHERE source_draft_id = ?`).bind(draft.id).first<any>();
    expect(rw.state).toBe("queued");

    // The tick finds nothing new to queue (idempotent) but is the path that would have.
    await env.DB.prepare(`DELETE FROM outreach_rewrites`).run();
    await runDuties(env as any);
    const again = await env.DB.prepare(`SELECT COUNT(*) AS n FROM outreach_rewrites`).first<{ n: number }>();
    expect(again?.n).toBe(1);
    const m = await materialiseRewrites(env as any);
    expect(m.queued).toBe(0);
  });

  it("her press on the desk retries a FAILED rewrite; the tick and the read never do", async () => {
    const { draft } = await sendBack(NOTE_1);
    const rw = await env.DB.prepare(`SELECT * FROM outreach_rewrites`).first<any>();
    const model = fakeModel([JSON.stringify({ subject: "s", body: "Contact me at a@b.com. " + GOOD_BODY })]);
    const task = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(rw.task_id).first<any>();
    await runOutreachRewrite(env as any, task, rw.id, model.complete);
    expect((await env.DB.prepare(`SELECT state FROM outreach_rewrites WHERE id = ?`).bind(rw.id).first<any>()).state).toBe("failed");

    // The read and the tick leave a failure alone — a rule broken twice is not retried on its own.
    await apiJson<any>("/api/wealth/outreach/rewrites");
    await runDuties(env as any);
    expect((await env.DB.prepare(`SELECT state FROM outreach_rewrites WHERE id = ?`).bind(rw.id).first<any>()).state).toBe("failed");

    // Her press retries it: queued again, the task queued again, one queue row, no duplicate rewrite.
    const pressed = await apiJson<any>("/api/wealth/outreach/redraft-sent-back", { method: "POST", body: {} });
    expect(pressed.body.data.queued_now).toBe(1);
    expect(pressed.body.data.rewriting).toBe(1);
    const after = await env.DB.prepare(`SELECT state, failure FROM outreach_rewrites WHERE id = ?`).bind(rw.id).first<any>();
    expect(after.state).toBe("queued");
    expect(after.failure).toBeNull();
    expect((await env.DB.prepare(`SELECT status FROM tasks WHERE id = ?`).bind(rw.task_id).first<any>()).status).toBe("queued");
    const q = await env.DB.prepare(`SELECT COUNT(*) AS n FROM boss_task_queue WHERE task_id = ? AND state = 'pending'`).bind(rw.task_id).first<{ n: number }>();
    expect(q?.n).toBe(1);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM outreach_rewrites WHERE source_draft_id = ?`).bind(draft.id).first<{ n: number }>())?.n).toBe(1);
    // Pressing twice does not queue twice.
    const again = await apiJson<any>("/api/wealth/outreach/redraft-sent-back", { method: "POST", body: {} });
    expect(again.body.data.queued_now).toBe(0);
  });

  it("a rewrite stuck running past the stale limit is re-queued rather than displayed for ever", async () => {
    await sendBack(NOTE_1);
    const rw = await env.DB.prepare(`SELECT * FROM outreach_rewrites`).first<any>();
    const stuckAt = Date.now() - STALE_RUNNING_MS - 1000;
    await env.DB.batch([
      env.DB.prepare(`UPDATE outreach_rewrites SET state = 'running', started_at = ? WHERE id = ?`).bind(stuckAt, rw.id),
      env.DB.prepare(`UPDATE tasks SET status = 'running' WHERE id = ?`).bind(rw.task_id),
      env.DB.prepare(`INSERT INTO boss_task_queue (id, task_id, lane, attempt, state, visible_at, enqueued_at) VALUES (?,?,?,0,'running',?,?)`)
        .bind(uid("btq"), rw.task_id, "ops", stuckAt, stuckAt),
    ]);
    const m = await materialiseRewrites(env as any);
    expect(m.requeued).toBe(1);
    const after = await env.DB.prepare(`SELECT state FROM outreach_rewrites WHERE id = ?`).bind(rw.id).first<any>();
    expect(after.state).toBe("queued");
    const q = await env.DB.prepare(`SELECT state FROM boss_task_queue WHERE task_id = ?`).bind(rw.task_id).first<any>();
    expect(q.state).toBe("pending");
  });

  it("queueRewrite refuses a letter that was not sent back, a dropped firm, and a second press", async () => {
    const res = await apiJson<any>(`/api/wealth/sourcing/${CAND}/status`, { method: "POST", body: { status: "reviewed" } });
    expect(res.body.data.letter.drafted).toBe(true);
    const awaiting = await env.DB.prepare(`SELECT id FROM buyer_outreach_drafts`).first<any>();
    const notSentBack = await queueRewrite(env as any, awaiting.id);
    expect(notSentBack.queued).toBe(false);
    expect(notSentBack.detail).toContain("was not sent back");

    const { draft } = await sendBack(NOTE_1);
    const twice = await queueRewrite(env as any, draft.id);
    expect(twice.queued).toBe(false);
    expect(twice.detail).toContain("already queued");

    await env.DB.prepare(`DELETE FROM outreach_rewrites`).run();
    await env.DB.prepare(`UPDATE sourcing_candidates SET status = 'rejected' WHERE id = ?`).bind(CAND).run();
    const dropped = await queueRewrite(env as any, draft.id);
    expect(dropped.queued).toBe(false);
    expect(dropped.detail).toContain("dropped");
  });
});
