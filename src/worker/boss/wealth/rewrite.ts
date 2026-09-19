/**
 * THE REWRITE THAT ANSWERS HER NOTE.
 *
 * ─── Her words, 19 September 2026, ~13:00 CT ───────────────────────────────
 *
 *   "I just rejected the 13 again and gave it my notes and I don't see it working on re-writing
 *    them."
 *
 * ─── What production showed (CONFIRMED, read-only) ─────────────────────────
 *
 * Her second batch (`approval_batches` apb_m2x9y0t8yq0tfpe0, 13 of 13 done, 0 failed) carried a
 * real note — name the companies she is working on, hyperlink her LinkedIn — and every one of the
 * thirteen `approval_events.executed` rows answered: "Sent back and your reason is on the record.
 * No new letter to <firm>: it would be word-for-word the one you sent back." Nothing was queued
 * for the Mac, nothing failed, nothing was hidden. The redraft was `composeOutreach`, a
 * deterministic composition from the candidate row: it has no way to read a note, so the only
 * letter it could produce was the one she rejected, and the twin guard rightly refused it.
 *
 * A template cannot answer a note. This module is the writer that can.
 *
 * ─── Where it runs, and why not on her Mac ─────────────────────────────────
 *
 * The seats (`bk_claude_code`, `bk_codex`) are claimed by her Mac on a launchd slot — the next one
 * may be an hour away, and she is looking at the screen now. A thirteen-letter rewrite is small
 * work: one short prompt each, one JSON reply each. So it runs on the Worker's own queue
 * (`boss_task_queue`, drained after the request that queued it and by the progress poll) through
 * `routeCompletion`, labelled `private_model_only`: the letter goes out under her name to a
 * counterparty and names the companies she is working, so the training-permitting free rungs are
 * refused and it lands on the first non-training rung — Workers AI, $0 inside the allowance. On
 * production every Worker-side run of the last fortnight landed on `mdl_cf_llama33_70b` for the
 * same reason (`routing_decisions`, 5 of 5).
 *
 * ─── What the model may and may not say, checked rather than hoped ─────────
 *
 * The composer's rules were never prose; they are `checkLetter` below, applied to every reply:
 * her name and firm and LinkedIn present; never "broker" (her note: "always as an advisor and
 * investor with LP relationships"); no address; no money figure she did not state herself (the
 * fabricated "$50M and up" from the first batch); different from every letter she sent back for
 * this firm. A reply that breaks a rule is sent back to the model ONCE with the broken rules
 * named; a second failure is recorded as `failed` with the reason on her screen, and her note
 * stays on the record. The letter never reaches the Inbox unchecked.
 */

import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { getSetting } from "../lib/settings";
import { routeCompletion, BudgetExceeded, RoutingBlocked, ProviderFailure, type RouteRequest, type RouteResult } from "../router";
import { admitTask } from "../tasks/admit";
import { listSizes, parseMoneyUsd, readStoredPositions, WORKING_POSITIONS_KEY } from "../../../shared/wealth/positionSizes";
import type { CandidateRow, CrossmatchFact, Draft } from "./outreach";

export const REWRITE_OWNER = "emp_research"; // Camille writes these; the card says so.

/** The row as it is read back for the screen. */
export interface RewriteRow {
  id: string;
  candidate_id: string;
  source_draft_id: string;
  her_note: string;
  notes_all: string;
  batch_id: string | null;
  task_id: string | null;
  state: "queued" | "running" | "ready" | "failed";
  result_draft_id: string | null;
  written_by: string | null;
  cost_micros: number;
  failure: string | null;
  requested_at: number;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
}

/**
 * Queue the rewrite of one sent-back letter. Idempotent: the unique index on `source_draft_id`
 * means a second press, a second poll or a second tick cannot queue a second rewrite of the same
 * letter — the existing row is returned instead.
 */
export async function queueRewrite(
  env: Env,
  sourceDraftId: string,
  opts: { batchId?: string | null } = {},
  now = Date.now(),
): Promise<{ queued: boolean; rewrite_id: string | null; detail: string }> {
  const draft = await env.DB
    .prepare(
      `SELECT d.id, d.candidate_id, d.her_note, d.attempt, d.state, s.name, s.status AS candidate_status
         FROM buyer_outreach_drafts d JOIN sourcing_candidates s ON s.id = d.candidate_id
        WHERE d.id = ?`,
    )
    .bind(sourceDraftId)
    .first<{ id: string; candidate_id: string; her_note: string | null; attempt: number; state: string; name: string; candidate_status: string }>();
  if (!draft) return { queued: false, rewrite_id: null, detail: "That letter is gone, so there is nothing to rewrite." };
  if (draft.state !== "try_again") {
    return { queued: false, rewrite_id: null, detail: `The letter to ${draft.name} was not sent back (it is ${draft.state}), so there is nothing to rewrite.` };
  }
  if (draft.candidate_status === "rejected") {
    return { queued: false, rewrite_id: null, detail: `${draft.name} was dropped, so no letter is rewritten.` };
  }
  const note = (draft.her_note ?? "").trim();
  if (!note) {
    return {
      queued: false, rewrite_id: null,
      detail: `Sent back with no reason, so the next letter to ${draft.name} would be a guess. Nothing was rewritten.`,
    };
  }

  const existing = await env.DB
    .prepare(`SELECT id, state FROM outreach_rewrites WHERE source_draft_id = ?`)
    .bind(sourceDraftId)
    .first<{ id: string; state: string }>();
  if (existing) {
    return { queued: false, rewrite_id: existing.id, detail: `A rewrite of the letter to ${draft.name} is already ${existing.state}.` };
  }

  const notes = await env.DB
    .prepare(
      `SELECT her_note FROM buyer_outreach_drafts
        WHERE candidate_id = ? AND her_note IS NOT NULL AND TRIM(her_note) <> '' ORDER BY attempt ASC`,
    )
    .bind(draft.candidate_id)
    .all<{ her_note: string }>();
  /*
   * A NOTE THAT SHORT IS NOT AN INSTRUCTION. Production's second attempt carries eleven notes that
   * read "same" (the bulk-reject route refuses under 12 characters now; these predate it). They are
   * her verdict, not a rule, and handing "same" to the model as a standing instruction is noise.
   */
  const notesAll = [...new Set((notes.results ?? []).map((r) => r.her_note.trim()).filter((n) => n.length >= 12))];
  if (!notesAll.includes(note)) notesAll.push(note);

  const rewriteId = newId("orw");
  await env.DB
    .prepare(
      `INSERT INTO outreach_rewrites
         (id, candidate_id, source_draft_id, her_note, notes_all, batch_id, task_id, state, requested_at, updated_at)
       VALUES (?,?,?,?,?,?,NULL,'queued',?,?)`,
    )
    .bind(rewriteId, draft.candidate_id, sourceDraftId, note, JSON.stringify(notesAll), opts.batchId ?? null, now, now)
    .run();

  /*
   * THE TASK IS THE THING THAT RUNS. It goes through `admitTask` like every other piece of work so
   * it is owned (Camille), enveloped, classified and visible on the board; `input.outreach_rewrite`
   * is what the consumer branches on. The two axes are declared here rather than guessed from the
   * title: private-model-only, internal audience.
   */
  const admitted = await admitTask(env, {
    title: `Rewrite the letter to ${draft.name} with her note (attempt ${draft.attempt + 1})`,
    lane: "ops",
    employee_id: REWRITE_OWNER,
    intake_kind: "drafting",
    risk: "medium",
    model_access: "private_model_only",
    audience: "internal",
    input: { outreach_rewrite: { rewrite_id: rewriteId, candidate_id: draft.candidate_id } },
  });
  if (!admitted.created || !admitted.task_id) {
    await env.DB
      .prepare(`UPDATE outreach_rewrites SET state = 'failed', failure = ?, finished_at = ?, updated_at = ? WHERE id = ?`)
      .bind(`Intake refused the rewrite: ${admitted.reason ?? "no reason given"}`, now, now, rewriteId)
      .run();
    return { queued: false, rewrite_id: rewriteId, detail: `Intake refused the rewrite to ${draft.name}: ${admitted.reason ?? "no reason given"}` };
  }
  await env.DB
    .prepare(`UPDATE outreach_rewrites SET task_id = ?, updated_at = ? WHERE id = ?`)
    .bind(admitted.task_id, now, rewriteId)
    .run();
  return {
    queued: true,
    rewrite_id: rewriteId,
    detail: `Camille is rewriting the letter to ${draft.name} now, answering your note. It lands in your Inbox in minutes; nothing is sent to anybody.`,
  };
}

/**
 * Every sent-back letter with a note that nobody has answered yet gets its rewrite queued.
 *
 * Called from the progress read, from the desk button and from the hourly tick, so a rewrite she
 * is owed starts whether or not anybody opens the app: her rejection WITH A NOTE is the
 * instruction, and this is the mechanism that makes an instruction start work. It also resets a
 * rewrite that has read `running` for longer than any model call takes (a drain cut off mid-run),
 * so a stuck row is retried rather than displayed for ever.
 */
export const STALE_RUNNING_MS = 3 * 60_000;

export async function materialiseRewrites(
  env: Env,
  now = Date.now(),
  opts: { retryFailed?: boolean } = {},
): Promise<{ queued: number; requeued: number }> {
  /*
   * HER PRESS RETRIES A FAILURE. A rewrite that failed — the router refused, the model broke a rule
   * twice — stays failed on the desk with its reason, and the tick never retries it on its own (a
   * rule the model breaks twice is not going to pass on the third). "Rewrite the N with my notes"
   * is her saying try again, so from that door only, failed rewrites go back to the queue.
   */
  let retried = 0;
  if (opts.retryFailed) {
    const failed = await env.DB
      .prepare(`SELECT id, task_id, source_draft_id FROM outreach_rewrites WHERE state = 'failed'`)
      .all<{ id: string; task_id: string | null; source_draft_id: string }>();
    for (const row of failed.results ?? []) {
      // The letter must still be the latest attempt and still sent back; otherwise the row is history.
      const still = await env.DB
        .prepare(
          `SELECT 1 FROM buyer_outreach_drafts d WHERE d.id = ? AND d.state = 'try_again'
              AND NOT EXISTS (SELECT 1 FROM buyer_outreach_drafts l WHERE l.candidate_id = d.candidate_id AND l.attempt > d.attempt)`,
        )
        .bind(row.source_draft_id)
        .first();
      if (!still || !row.task_id) continue;
      await env.DB.batch([
        env.DB.prepare(`UPDATE outreach_rewrites SET state = 'queued', failure = NULL, started_at = NULL, finished_at = NULL, updated_at = ? WHERE id = ?`).bind(now, row.id),
        env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL WHERE id = ?`).bind(row.task_id),
        env.DB.prepare(
          `INSERT INTO boss_task_queue (id, task_id, lane, attempt, state, visible_at, enqueued_at)
             SELECT ?, ?, 'ops', 0, 'pending', ?, ?
              WHERE NOT EXISTS (SELECT 1 FROM boss_task_queue WHERE task_id = ? AND state IN ('pending','running'))`,
        ).bind(newId("btq"), row.task_id, now, now, row.task_id),
      ]);
      retried++;
    }
  }

  const owed = await env.DB
    .prepare(
      `SELECT d.id FROM buyer_outreach_drafts d
         JOIN sourcing_candidates s ON s.id = d.candidate_id
        WHERE d.state = 'try_again' AND d.her_note IS NOT NULL AND TRIM(d.her_note) <> ''
          AND s.status <> 'rejected'
          AND NOT EXISTS (SELECT 1 FROM buyer_outreach_drafts later
                           WHERE later.candidate_id = d.candidate_id AND later.attempt > d.attempt)
          AND NOT EXISTS (SELECT 1 FROM outreach_rewrites r WHERE r.source_draft_id = d.id)
        ORDER BY d.updated_at ASC LIMIT 50`,
    )
    .all<{ id: string }>();
  let queued = 0;
  for (const row of owed.results ?? []) {
    const r = await queueRewrite(env, row.id, {}, now);
    if (r.queued) queued++;
  }

  const stale = await env.DB
    .prepare(
      `SELECT r.id, r.task_id FROM outreach_rewrites r
        WHERE r.state = 'running' AND r.started_at IS NOT NULL AND r.started_at < ?`,
    )
    .bind(now - STALE_RUNNING_MS)
    .all<{ id: string; task_id: string | null }>();
  let requeued = 0;
  for (const row of stale.results ?? []) {
    if (!row.task_id) continue;
    await env.DB.batch([
      env.DB.prepare(`UPDATE outreach_rewrites SET state = 'queued', started_at = NULL, updated_at = ? WHERE id = ?`).bind(now, row.id),
      env.DB.prepare(`UPDATE tasks SET status = 'queued' WHERE id = ? AND status = 'running'`).bind(row.task_id),
      env.DB.prepare(
        `UPDATE boss_task_queue SET state = 'pending', visible_at = ?, last_error = 'requeued: the rewrite read running past the stale limit'
          WHERE task_id = ? AND state = 'running'`,
      ).bind(now, row.task_id),
    ]);
    requeued++;
  }
  if (queued || requeued || retried) {
    await logEvent(env.DB, {
      level: "info", scope: "wealth", event: "rewrites_materialised", detail: { queued, requeued, retried },
    }).catch(() => {});
  }
  return { queued: queued + retried, requeued };
}

// ─── The model call ───────────────────────────────────────────────────────────

export interface LetterFacts {
  candidate: CandidateRow;
  positions_usd: number[];
  previous: { subject: string; body: string; attempt: number };
  notes: string[];
  rejectedBodies: string[];
}

const IDENTITY = {
  name: "Sequoia Taylor",
  firm: "Spry VC",
  linkedin: "linkedin.com/in/sequoiataylor",
};

/** The prompt, composed from facts. Exported so the test can pin what the model is told. */
export function composeRewritePrompt(f: LetterFacts): { system: string; user: string } {
  const history =
    f.candidate.history_kind === "dealt" ? "someone she has dealt with before"
      : f.candidate.history_kind === "discussed" ? "someone who has discussed buying with her before, never traded"
      : "a firm from public research with no mail history";
  const sizes = f.positions_usd.length ? listSizes(f.positions_usd) : "(none stated — say nothing about size)";
  const system =
    `You are Camille, Director of Research at Boss OS, drafting an email that ${IDENTITY.name} will send herself from her own mailbox. ` +
    "Write in her voice: plain, direct, warm, short. No marketing tone, no bullet points, no subject-line hype, no em dashes. " +
    "You answer her notes exactly; each note is a standing instruction. " +
    'Reply with ONE JSON object only: {"subject": "...", "body": "..."} — no code fence, no commentary. Paragraphs in the body are separated by a blank line.';
  const rules = [
    `Open with her name and firm: "My name is ${IDENTITY.name}, and I run ${IDENTITY.firm}". Where the letter says ${IDENTITY.firm} the first time, put her LinkedIn page in parentheses right after it: ${IDENTITY.firm} (${IDENTITY.linkedin}). Plain text; the mail client makes it a link.`,
    "She is an advisor and investor with LP relationships who trades late-stage secondaries. NEVER call her a broker and never use the word broker or brokerage.",
    `The only sizes the letter may state are the ones she stated herself: ${sizes}. Do not invent any other dollar figure and do not read the recipient's minimum back to them.`,
    "No email addresses, no phone numbers, no URLs other than her LinkedIn page.",
    "Do not describe the recipient's thesis back to them and do not explain why you chose them; one ask, then her sign-off (name, firm, LinkedIn) on three lines.",
    "The body must be materially different from every letter she sent back (below); do not return one of them with small edits.",
    "Between 120 and 260 words.",
  ];
  const user = [
    `RECIPIENT: ${f.candidate.name} (${f.candidate.kind}; ${history}).`,
    `HER NOTES, oldest first — every one is a standing instruction and the newest is the reason for this rewrite:`,
    ...f.notes.map((n, i) => `${i + 1}. ${n}`),
    "",
    "RULES (checked by code after you reply; a broken rule sends the letter back to you):",
    ...rules.map((r, i) => `${i + 1}. ${r}`),
    "",
    `THE LETTER SHE SENT BACK (attempt ${f.previous.attempt}):`,
    `Subject: ${f.previous.subject}`,
    f.previous.body,
    ...(f.rejectedBodies.length > 1
      ? ["", "EARLIER LETTERS SHE ALSO SENT BACK:", ...f.rejectedBodies.slice(0, -1).map((b, i) => `--- ${i + 1} ---\n${b}`)]
      : []),
    "",
    "Write the new letter now, as the JSON object.",
  ].join("\n");
  return { system, user };
}

/**
 * Raw newlines inside a JSON string are not JSON, and Llama 3.3 70B writes them anyway.
 *
 * CONFIRMED on the first live run (19 Sep 2026, local wrangler dev against the real Workers AI
 * rung): the reply was a perfect {subject, body} object whose body carried literal line breaks
 * between paragraphs — `JSON.parse` refused it twice and the rewrite failed as "not a JSON
 * object" over a letter that answered every note. So control characters inside string literals
 * are escaped before parsing; nothing outside a string is touched.
 */
export function escapeControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === "\\") { out += ch + (text[i + 1] ?? ""); i++; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

/** Parse the model's reply into a letter, tolerating a code fence or prose around the object. */
export function parseLetterReply(text: string): { subject: string; body: string } | null {
  const raw = String(text ?? "").trim();
  const shapes = [raw, raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")];
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) shapes.push(raw.slice(first, last + 1));
  const candidates = [...shapes, ...shapes.map(escapeControlCharsInStrings)];
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v.subject === "string" && typeof v.body === "string" && v.subject.trim() && v.body.trim()) {
        return { subject: v.subject.trim(), body: v.body.trim().replace(/\r\n/g, "\n") };
      }
    } catch { /* try the next shape */ }
  }
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The rules, as code. Returns the broken ones by name, in her language, so the model can be told
 * and so a failed rewrite can say on the card exactly what was wrong with the letter.
 */
export function checkLetter(letter: { subject: string; body: string }, f: LetterFacts): string[] {
  const broken: string[] = [];
  const whole = `${letter.subject}\n${letter.body}`;
  if (whole.includes("@")) broken.push("it contains an at-sign — an address reached the letter");
  if (/\bbroker(age|s|ed|ing)?\b/i.test(whole)) broken.push('it calls her a broker — she is "an advisor and investor with LP relationships"');
  if (!whole.includes(IDENTITY.name)) broken.push("it does not carry her name");
  if (!whole.includes(IDENTITY.firm)) broken.push(`it does not name ${IDENTITY.firm}`);
  if (!whole.includes(IDENTITY.linkedin)) broken.push("it does not carry her LinkedIn page");
  const urls = whole.match(/\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|io|vc|net|org|ai)\b\S*/gi) ?? [];
  if (urls.some((u) => !u.toLowerCase().includes(IDENTITY.linkedin))) broken.push("it contains a link other than her LinkedIn page");
  const money = whole.match(/\$\s?\d[\d,.]*\s?(?:k|m|mm|b|bn|million|billion|thousand)?\b/gi) ?? [];
  const allowed = new Set(f.positions_usd);
  for (const m of money) {
    const parsed = parseMoneyUsd(m.replace(/\s+/g, ""));
    if (!parsed.ok || parsed.usd === null || !allowed.has(parsed.usd)) {
      broken.push(`it states a figure she did not (${m.trim()}) — only ${f.positions_usd.length ? listSizes(f.positions_usd) : "no size at all"} may appear`);
      break;
    }
  }
  const words = letter.body.split(/\s+/).filter(Boolean).length;
  if (words < 80) broken.push(`it is too short (${words} words)`);
  if (words > 320) broken.push(`it is too long (${words} words)`);
  const nb = norm(letter.body);
  if (f.rejectedBodies.some((b) => norm(b) === nb)) broken.push("it is word-for-word a letter she already sent back");
  return broken;
}

export type Complete = (env: Env, req: RouteRequest) => Promise<RouteResult>;

export interface RewriteOutcome {
  state: "ready" | "failed";
  detail: string;
  draft_id?: string;
  judgement_id?: string;
  cost_micros: number;
  written_by: string | null;
}

/**
 * Run one rewrite task. Called by the queue consumer for a task carrying `input.outreach_rewrite`.
 * Never throws for a letter that could not be written — that outcome is recorded on the row and
 * said on the card; it throws only for a transient provider failure, so the queue retries it.
 */
export async function runOutreachRewrite(
  env: Env,
  task: { id: string; lane: string; employee_id: string | null },
  rewriteId: string,
  complete: Complete = routeCompletion,
  now = Date.now(),
): Promise<RewriteOutcome> {
  const rw = await env.DB.prepare(`SELECT * FROM outreach_rewrites WHERE id = ?`).bind(rewriteId).first<RewriteRow>();
  if (!rw) return { state: "failed", detail: "The rewrite row is gone.", cost_micros: 0, written_by: null };
  if (rw.state === "ready") {
    return { state: "ready", detail: "Already rewritten.", draft_id: rw.result_draft_id ?? undefined, cost_micros: rw.cost_micros, written_by: rw.written_by };
  }
  await env.DB
    .prepare(`UPDATE outreach_rewrites SET state = 'running', started_at = ?, task_id = COALESCE(task_id, ?), updated_at = ? WHERE id = ?`)
    .bind(now, task.id, now, rewriteId)
    .run();

  const fail = async (why: string, cost = 0, writtenBy: string | null = null): Promise<RewriteOutcome> => {
    const at = Date.now();
    await env.DB
      .prepare(`UPDATE outreach_rewrites SET state = 'failed', failure = ?, cost_micros = cost_micros + ?, written_by = COALESCE(?, written_by), finished_at = ?, updated_at = ? WHERE id = ?`)
      .bind(why.slice(0, 600), cost, writtenBy, at, at, rewriteId)
      .run();
    return { state: "failed", detail: why, cost_micros: cost, written_by: writtenBy };
  };

  const candidate = await env.DB.prepare(`SELECT * FROM sourcing_candidates WHERE id = ?`).bind(rw.candidate_id).first<CandidateRow>();
  if (!candidate) return fail("That firm is gone from the list, so no letter was written.");
  const matches = await env.DB
    .prepare(`SELECT lp_firm, lp_list, confidence FROM counterparty_crossmatches WHERE candidate_id = ? AND status <> 'rejected'`)
    .bind(rw.candidate_id)
    .all<CrossmatchFact>();
  const suppressed = (matches.results ?? []).find((m) => m.lp_list !== "sequence" && m.confidence === "confirmed");
  if (suppressed) {
    return fail(`${suppressed.lp_firm} is on West Peek's do-not-contact list and this is the same firm, so no letter was written. Drop the firm, or take it off that list first.`);
  }

  const previous = await env.DB
    .prepare(`SELECT subject, body, attempt FROM buyer_outreach_drafts WHERE id = ?`)
    .bind(rw.source_draft_id)
    .first<{ subject: string; body: string; attempt: number }>();
  if (!previous) return fail("The letter she sent back is gone, so there is nothing to rewrite from.");
  const rejected = await env.DB
    .prepare(`SELECT body FROM buyer_outreach_drafts WHERE candidate_id = ? AND state = 'try_again' ORDER BY attempt ASC`)
    .bind(rw.candidate_id)
    .all<{ body: string }>();

  let notes: string[] = [];
  try { notes = JSON.parse(rw.notes_all); } catch { notes = [rw.her_note]; }
  if (!notes.includes(rw.her_note)) notes.push(rw.her_note);

  const facts: LetterFacts = {
    candidate,
    positions_usd: readStoredPositions(await getSetting(env.DB, WORKING_POSITIONS_KEY)),
    previous,
    notes,
    rejectedBodies: (rejected.results ?? []).map((r) => r.body),
  };
  const prompt = composeRewritePrompt(facts);
  const employee = task.employee_id
    ? await env.DB.prepare(`SELECT route_id FROM employees WHERE id = ?`).bind(task.employee_id).first<{ route_id: string | null }>()
    : null;

  const messages: RouteRequest["messages"] = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];
  let cost = 0;
  let writtenBy: string | null = null;
  let letter: { subject: string; body: string } | null = null;
  let broken: string[] = [];

  for (let pass = 1; pass <= 2; pass++) {
    let result: RouteResult;
    try {
      result = await complete(env, {
        routeId: employee?.route_id ?? "rt_ops_default",
        lane: task.lane,
        taskId: task.id,
        employeeId: task.employee_id,
        intakeKind: "drafting",
        risk: "medium",
        sensitivity: "private",
        modelAccess: "private_model_only",
        budgetMicros: 0,
        messages,
      });
    } catch (err) {
      if (err instanceof BudgetExceeded || err instanceof RoutingBlocked) {
        return fail(`The router refused the rewrite: ${(err as Error).message}`, cost, writtenBy);
      }
      if (err instanceof ProviderFailure) {
        // Transient: record it and let the queue retry with backoff. The row goes back to queued.
        await env.DB
          .prepare(`UPDATE outreach_rewrites SET state = 'queued', started_at = NULL, failure = ?, updated_at = ? WHERE id = ?`)
          .bind(`Provider failed, retrying: ${err.message}`.slice(0, 600), Date.now(), rewriteId)
          .run();
        throw err;
      }
      return fail(`The rewrite could not run: ${(err as Error)?.message ?? String(err)}`, cost, writtenBy);
    }
    cost += result.costMicros;
    writtenBy = result.modelName;
    letter = parseLetterReply(result.text);
    broken = letter ? checkLetter(letter, facts) : ["the reply was not a {subject, body} JSON object"];
    if (broken.length === 0) break;
    // Diagnostics on the task, so a rule the model keeps breaking can be read rather than guessed.
    await env.DB
      .prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'rewrite_reply_rejected',?)`)
      .bind(newId("tev"), task.id, Date.now(), JSON.stringify({ pass, broken, reply_head: result.text.slice(0, 600), model: result.modelName }))
      .run()
      .catch(() => {});
    messages.push({ role: "assistant", content: result.text });
    messages.push({
      role: "user",
      content: `That letter broke these rules: ${broken.map((b, i) => `${i + 1}) ${b}`).join("; ")}. Write it again as the JSON object, keeping every rule.`,
    });
  }

  if (!letter || broken.length > 0) {
    return fail(
      `Two tries, and the letter still broke a rule: ${broken.join("; ")}. Your note is on the record; nothing was raised.`,
      cost, writtenBy,
    );
  }

  const composed: Draft = {
    subject: letter.subject,
    body: letter.body,
    to_hint: candidate.source_url
      ? `The contact route on ${candidate.source_name ?? "their site"}: ${candidate.source_url}`
      : `No source page was recorded for ${candidate.name}, so find the contact route before sending this.`,
    built_from: {
      candidate_id: candidate.id,
      name: candidate.name,
      drafted_at: Date.now(),
      used: ["her_notes", "previous_letter", ...(facts.positions_usd.length ? ["her_positions"] : [])],
      history_kind: candidate.history_kind ?? null,
      history_label:
        candidate.history_kind === "dealt" ? "someone you have dealt with"
          : candidate.history_kind === "discussed" ? "someone who has discussed buying with you"
          : "a firm from public research — no mail history with them",
      her_note: rw.her_note,
      notes_all: notes,
      written_by: writtenBy,
      rewrite_id: rewriteId,
      attempt_rewritten: previous.attempt,
    },
  };

  const { raiseLetterFor } = await import("../routes/wealth");
  const raised = await raiseLetterFor(env, candidate, composed, rw.her_note, Date.now());
  if (!raised.drafted) return fail(raised.detail, cost, writtenBy);

  const at = Date.now();
  await env.DB
    .prepare(
      `UPDATE outreach_rewrites SET state = 'ready', result_draft_id = ?, written_by = ?, cost_micros = cost_micros + ?, failure = NULL, finished_at = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(raised.draft_id ?? null, writtenBy, cost, at, at, rewriteId)
    .run();
  await logEvent(env.DB, {
    level: "info", scope: "wealth", event: "letter_rewritten", entityId: rewriteId,
    detail: { candidate_id: candidate.id, written_by: writtenBy, cost_micros: cost, judgement_id: raised.judgement_id ?? null },
  }).catch(() => {});
  return {
    state: "ready",
    detail: `A different letter to ${candidate.name}, answering your note, is in your Inbox (written by ${writtenBy}).`,
    draft_id: raised.draft_id,
    judgement_id: raised.judgement_id,
    cost_micros: cost,
    written_by: writtenBy,
  };
}

// ─── Progress, for the screen ─────────────────────────────────────────────────

export interface RewriteProgress {
  /** The wave: every rewrite still in motion or whose letter is still waiting on her. */
  total: number;
  rewriting: number;
  ready: number;
  failed: { candidate_name: string; why: string }[];
  items: {
    id: string; candidate_id: string; candidate_name: string; state: string; her_note: string;
    result_draft_id: string | null; written_by: string | null; failure: string | null; updated_at: number;
  }[];
  latest_batch: { id: string; reason: string; requested_count: number; created_at: number } | null;
  /** ONE sentence both tabs print, so they cannot disagree about the count. Null when nothing is in motion. */
  sentence: string | null;
}

export async function rewriteProgress(env: Env): Promise<RewriteProgress> {
  const [rows, batch] = await Promise.all([
    env.DB
      .prepare(
        `SELECT r.id, r.candidate_id, s.name AS candidate_name, r.state, r.her_note, r.result_draft_id, r.written_by,
                r.failure, r.updated_at, res.state AS result_state
           FROM outreach_rewrites r
           JOIN sourcing_candidates s ON s.id = r.candidate_id
           LEFT JOIN buyer_outreach_drafts res ON res.id = r.result_draft_id
          WHERE r.state IN ('queued','running','failed')
             OR (r.state = 'ready' AND res.state = 'awaiting')
          ORDER BY r.requested_at ASC LIMIT 200`,
      )
      .all<any>(),
    env.DB
      .prepare(`SELECT id, reason, requested_count, created_at FROM approval_batches ORDER BY created_at DESC LIMIT 1`)
      .first<{ id: string; reason: string; requested_count: number; created_at: number }>(),
  ]);
  const items = (rows.results ?? []).map((r) => ({
    id: r.id, candidate_id: r.candidate_id, candidate_name: r.candidate_name, state: r.state, her_note: r.her_note,
    result_draft_id: r.result_draft_id, written_by: r.written_by, failure: r.failure, updated_at: r.updated_at,
  }));
  const total = items.length;
  const rewriting = items.filter((i) => i.state === "queued" || i.state === "running").length;
  const ready = items.filter((i) => i.state === "ready").length;
  const failed = items.filter((i) => i.state === "failed").map((i) => ({ candidate_name: i.candidate_name, why: i.failure ?? "no reason recorded" }));
  const sentence = total === 0
    ? null
    : `${total} sent back with your note · ${rewriting > 0 ? "rewriting now" : failed.length && ready < total ? `${failed.length} could not be rewritten` : "rewritten"} · ${ready} of ${total} ready in your Inbox`;
  return { total, rewriting, ready, failed, items, latest_batch: batch ?? null, sentence };
}
