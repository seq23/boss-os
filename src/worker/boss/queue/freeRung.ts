/**
 * THE LADDER NEVER ENDS ON A SPENT SEAT (owner, 6 Nov 2026).
 *
 * `tsk_m6pq1seyd1qp8j45` (Camille's deep research for Valerie) sat "running" from 07:00 Central with
 * no run anywhere: it named no seat, so the consumer sent it to the plain cloud rung inside a drain
 * that died, and nothing ever looked at it again. Codex was out until 10 Nov and the Mac's poll
 * re-claimed its spent seat every 30 minutes. Three rules, here and in consumer.ts:
 *
 *   1. RESEARCH WALKS THE FREE TIERS FIRST, THEN HER SUBSCRIPTION SEATS (owner, 6 Nov 2026, replacing
 *      the earlier seat-first walk): Gemini free with Google Search → OpenRouter `:free` models with
 *      Brave Search → Codex's seat if not spent → the Claude seat (her Mac seen recently) → NAMED STOP
 *      with the reset. Never a paid API; never a wait while a later rung can run.
 *   2. A free rung (`runFreeResearch`) files Camille's page, completes the task and writes the
 *      "Done" notice her Mac sends (task-notices.mjs) — the normal Boss OS way.
 *   3. A rung that cannot run is NAMED STOP [<CODE>] with its reset time: recorded on the task, put
 *      on Kendra's (Systems) list in system_events, re-queued for the reset — never a silent loop.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { noticeOnce } from "../service/notices";
import { runGroundedResearch, type FreeSearchEngine, type GroundedOutcome } from "../research/grounded";
import { getBackend } from "../backends/registry";
import { isPlanSpent } from "../backends/spent";
import { OPENAI_SEAT, CLAUDE_SEAT } from "../duties/seatOrder";
import { scanForModelAccess, privateLexicon } from "../router/modelAccess";

const KENDRA = "emp_continuity";
/** The queue row's note that only the hourly tick may drain it (bossMount.ts drainBossTasks). */
export const TICK_ONLY = "tick-only: long research waits for the hourly tick";
/** The longest a re-queued task sleeps before it looks again (a Cloudflare Queue's own ceiling). */
const MAX_SLEEP_S = 12 * 3600;

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Research work: the task's kind, or a research page. */
export function isResearchWork(task: { intake_kind?: string | null }, input: Record<string, unknown>): boolean {
  // A research page, or a research ask that names nothing else. A duty with its own delivery (the
  // briefing, tool suggestions, link prospects…) keeps its own contract and is not this.
  const page = isObj(input.research_page) && input.delivers === "research_page";
  const bare = task.intake_kind === "research" && input.delivers === undefined && input.backend_id === undefined &&
    input.backend_ladder === undefined && input.spec_module === undefined;
  // A REPAIR IS NEVER RESEARCH (7 Nov 2026). Kendra's alarm repair for the stuck DNA research was
  // classified "research" from its own title, ran as a free research page and emailed her "Done
  // (partial): Fixing the Stale Task System Alarm" five times. A repair goes to the repair path.
  if (input.origin === "repair") return false;
  return (page || bare) && !isObj(input.firm_scan) && !isObj(input.repo_change) && input.chrome_job !== true;
}

/** The ask, in her words: the composed prompt is the page contract, not the question. */
export function researchAskOf(task: { title?: string | null }, input: Record<string, unknown>): string {
  const page = isObj(input.research_page) ? input.research_page : null;
  const parts = [input.instruction, input.body, page?.question, input.prompt]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return (parts[0] ?? String(task.title ?? "")).trim();
}

function centralTime(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

/**
 * NAMED STOP: on the task, on Kendra's list, re-queued for the reset when there is one. `tell` adds
 * ONE plain notice for her (a wait of days); a stop the overnight reset clears is a note only.
 */
export async function namedStop(
  env: Env,
  task: { id: string; lane: string; title: string },
  stop: { code: string; why: string; resumeAt: number | null; tell?: boolean; requeue?: boolean },
): Promise<void> {
  const now = Date.now();
  const requeue = stop.requeue !== false;
  await env.DB.batch([
    ...(requeue ? [env.DB.prepare(`UPDATE tasks SET status = 'queued' WHERE id = ?`).bind(task.id)] : []),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'named_stop',?)`)
      .bind(newId("tev"), task.id, now, JSON.stringify({ code: stop.code, why: stop.why, resume_at: stop.resumeAt, owner: KENDRA })),
  ]);
  await logEvent(env.DB, {
    level: "warn", scope: "systems", event: "named_stop", lane: task.lane, entityId: task.id,
    detail: { code: stop.code, why: stop.why, resume_at: stop.resumeAt, owner: KENDRA, title: task.title },
  });
  if (requeue && stop.resumeAt) {
    const delay = Math.max(60, Math.min(MAX_SLEEP_S, Math.round((stop.resumeAt - now) / 1000)));
    await env.TASKS.send({ taskId: task.id, lane: task.lane }, { delaySeconds: delay });
  }
  if (stop.tell) {
    await noticeOnce(env, {
      task, fromName: "Kendra", kind: `stop:${stop.code}`,
      subject: `Paused until ${stop.resumeAt ? centralTime(stop.resumeAt) : "a seat is free"}: ${task.title.slice(0, 100)}`,
      lines: [
        `"${task.title}" is paused, not lost.`,
        "",
        stop.resumeAt
          ? `Every worker that may do it is out until ${centralTime(stop.resumeAt)} (Central). It starts again on its own then.`
          : "Every worker that may do it is out, and none has said when it is back. I am watching it.",
      ],
    }).catch(() => null);
  }
}

/** When Codex's seat is back, or null when it is not out. */
export async function codexResetAt(env: Env, now = Date.now()): Promise<number | null> {
  const row = await getBackend(env.DB, OPENAI_SEAT).catch(() => null) as { exhausted_until?: number | null } | null;
  const until = row?.exhausted_until;
  return typeof until === "number" && until > now ? until : null;
}

/**
 * The next top of the hour: the hourly tick ("0 * * * *") drains rows visible at or before the moment
 * it fires, so the row must be visible AT :00. (It was :01, so the :00 tick skipped it for an hour.)
 */
export function nextTickAt(now: number): number {
  return Math.floor(now / 3600_000) * 3600_000 + 3600_000;
}

/** How recently her Mac's agent must have polled for a seat on it to be worth parking work on. */
export const MAC_SEEN_MS = 30 * 60_000;

/**
 * HER MAC IS THERE TO CLAIM IT. The agent's five-minute poll stamps `sync_device.last_seen_at`
 * (routes/backends.ts, GET /runs?held_by= and POST /claim). No private device seen within
 * MAC_SEEN_MS means no seat run will be claimed: work is never parked on a seat nobody can claim
 * (the e2e machine has no Mac at all).
 */
export async function macSeen(env: Env, now = Date.now()): Promise<boolean> {
  const row = await env.DB
    .prepare(`SELECT MAX(last_seen_at) AS seen FROM sync_device WHERE kind = 'private' AND revoked_at IS NULL`)
    .first<{ seen: number | null }>().catch(() => null);
  return typeof row?.seen === "number" && now - row.seen < MAC_SEEN_MS;
}

/** A seat that can take work now: enabled, not marked spent, and her Mac seen recently. */
export async function seatReady(env: Env, backendId: string, now = Date.now()): Promise<boolean> {
  const seat = await getBackend(env.DB, backendId).catch(() => null) as { status?: string; exhausted_until?: number | null } | null;
  if (!seat || seat.status !== "enabled" || isPlanSpent(seat, now)) return false;
  return macSeen(env, now);
}

/**
 * THE SEATS RESEARCH MAY WALK TO, IN ORDER, after every free rung is out (owner, 6 Nov 2026): Codex's
 * seat if it is not spent, then the Claude seat. Each only when her Mac is seen. `claudeOnly` (private
 * work) leaves Codex out.
 */
export async function researchSeats(env: Env, o: { claudeOnly?: boolean } = {}, now = Date.now()): Promise<string[]> {
  const out: string[] = [];
  if (!o.claudeOnly && await seatReady(env, OPENAI_SEAT, now)) out.push(OPENAI_SEAT);
  if (await seatReady(env, CLAUDE_SEAT, now)) out.push(CLAUDE_SEAT);
  return out;
}

/**
 * A BARE RESEARCH ASK BECOMES CAMILLE'S RESEARCH PAGE before it goes to a seat: the seat run delivers
 * `delivers.json` with a `research_page`, which `deliverResearchPage` files only for a task that
 * carries `research_page.page_id` and `delivers: "research_page"` (the same shape admit.ts writes).
 * Mutates `input` and the task row. Parts the free rungs already finished stay on the task's events.
 */
export async function asResearchPage(env: Env, task: any, input: Record<string, unknown>): Promise<void> {
  const page = await import("../../../shared/boss/research/page.mjs");
  if (isObj(input.research_page) && typeof input.research_page.page_id === "string" && input.delivers === page.RESEARCH_PAGE_DELIVERS) return;
  const now = Date.now();
  const question = researchAskOf(task, input).slice(0, 2000);
  const id = newId("rpg");
  await env.DB.prepare(`INSERT INTO research_pages (id, task_id, question, state, requested_at, updated_at) VALUES (?,?,?,'queued',?,?)`)
    .bind(id, String(task.id), question, now, now).run();
  Object.assign(input, {
    research_page: { page_id: id, question },
    delivers: page.RESEARCH_PAGE_DELIVERS,
    requested: { ...page.RESEARCH_PAGE_REQUESTED, allowed_paths: [...page.RESEARCH_PAGE_REQUESTED.allowed_paths], web_tools: [...page.RESEARCH_PAGE_REQUESTED.web_tools] },
    prompt: page.composeResearchPrompt({ id, question }),
  });
  await env.DB.prepare(`UPDATE tasks SET input = ? WHERE id = ?`).bind(JSON.stringify(input), String(task.id)).run();
}

export type FreeResearchOutcome =
  | { handled: true }
  /** Every free rung is out. `capped`: a daily allowance ran out (the earliest reset); `privateAsk`: the screen kept it off free routes. */
  | { handled: false; why: string; capped: { code: string; why: string; resumeAt: number | null } | null; privateAsk?: boolean };

/**
 * THE FREE RUNGS FOR RESEARCH, IN HER ORDER (owner, 6 Nov 2026: "it started with all free tiers and if
 * they were all out then it uses an allowance on the paid models i have subscriptions to"):
 *   1. Gemini free with Google Search grounding;
 *   2. OpenRouter `:free` models writing from Brave Search results (the repo's $0 search source;
 *      OpenRouter's own web plugin costs money and is never used). No Brave key → rung 2 is skipped
 *      with a ladder_step saying "no free search source for OpenRouter".
 * Long work, so a request's 30-second tail hands it to the hourly tick. Returns handled when the page
 * was filed (or the task was handed to the tick); otherwise why every free rung is out, so the
 * caller walks on to the seats (consumer.ts) and only then stops by name.
 */
export async function runFreeResearch(
  env: Env,
  task: any,
  input: Record<string, unknown>,
  o: { fromRequest?: boolean; employeeName?: string | null },
): Promise<FreeResearchOutcome> {
  const t = { id: String(task.id), lane: String(task.lane), title: String(task.title ?? task.id) };
  if (o.fromRequest) {
    await env.DB.prepare(`UPDATE tasks SET status = 'queued' WHERE id = ?`).bind(t.id).run();
    await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'ladder_step',?)`)
      .bind(newId("tev"), t.id, Date.now(), JSON.stringify({ next: "free Google search", why: "long research runs on the hourly tick, never in a request's 30-second tail" })).run();
    // Marked TICK-ONLY, so the next request's drain cannot take it first and defer it again (13:00, 6
    // Nov 2026: a request drained it six seconds after the tick and it waited another hour).
    await env.DB.prepare(
      `INSERT INTO boss_task_queue (id, task_id, lane, attempt, state, visible_at, enqueued_at, last_error)
       VALUES (?, ?, ?, 0, 'pending', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), t.id, t.lane, nextTickAt(Date.now()), Date.now(), TICK_ONLY).run();
    return { handled: true };
  }
  /*
   * THE PRIVACY SCREEN FIRST, FAIL CLOSED. The free tiers train on prompts; an ask the screen flags
   * never reaches Google or OpenRouter. It goes to the Claude seat only (the caller), never Codex.
   */
  const ask = researchAskOf(task, input);
  const verdict = scanForModelAccess([{ role: "user", content: ask }], await privateLexicon(env.DB),
    { modelAccess: task.model_access ?? null, sensitivity: task.sensitivity ?? null });
  if (verdict.privateOnly) {
    return { handled: false, privateAsk: true, capped: null, why: `the privacy screen keeps this off the free routes (${verdict.reason ?? "private"})` };
  }
  const step = (detail: Record<string, unknown>) => env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'ladder_step',?)`)
    .bind(newId("tev"), t.id, Date.now(), JSON.stringify(detail)).run();

  const reasons: string[] = [];
  let capped: { code: string; why: string; resumeAt: number | null } | null = null;
  const rungs: { engine: FreeSearchEngine; backend: string; label: string }[] = [
    { engine: "google", backend: "bk_gemini", label: "free Google search" },
    { engine: "brave", backend: "bk_openrouter", label: "OpenRouter free models with Brave Search" },
  ];
  for (const rung of rungs) {
    if (rung.engine === "brave" && !env.BRAVE_SEARCH_API_KEY) {
      await step({ backend_id: rung.backend, refused: "no free search source for OpenRouter (BRAVE_SEARCH_API_KEY is not on this Worker); its web plugin costs money", next: "the seats" });
      reasons.push("no free search source for OpenRouter");
      continue;
    }
    await step({ backend_id: rung.backend, next: rung.label, why: "research walks the free tiers first, then the subscription seats" });
    const out = await runGroundedResearch(env, task, ask, Date.now, rung.engine);
    if (out.state === "unavailable") {
      await step({ backend_id: rung.backend, refused: out.why, next: rung.engine === "google" ? "OpenRouter free models with Brave Search" : "the seats" });
      reasons.push(`${rung.label}: ${out.why.slice(0, 160)}`);
      continue;
    }
    if (out.state === "stop") {
      await step({ backend_id: rung.backend, refused: out.why, code: out.code, resume_at: out.resumeAt, next: rung.engine === "google" ? "OpenRouter free models with Brave Search" : "the seats" });
      reasons.push(out.why.slice(0, 200));
      if (!capped || (out.resumeAt !== null && (capped.resumeAt === null || out.resumeAt < capped.resumeAt))) capped = { code: out.code, why: out.why, resumeAt: out.resumeAt };
      continue;
    }
    await fileFreePage(env, task, input, t, out, o.employeeName ?? null, rung.label);
    return { handled: true };
  }
  return { handled: false, capped, why: reasons.join(" | ") };
}

/** File Camille's page from a free rung, complete the task and write the "Done" notice. */
async function fileFreePage(
  env: Env, task: any, input: Record<string, unknown>, t: { id: string; lane: string; title: string },
  out: Extract<GroundedOutcome, { state: "done" }>, _employeeName: string | null, via: string,
): Promise<void> {
  const now = Date.now();
  const { researchPageUrl } = await import("../../../shared/boss/research/page.mjs");
  let pageId = isObj(input.research_page) && typeof input.research_page.page_id === "string" ? input.research_page.page_id : null;
  if (!pageId) {
    pageId = newId("rpg");
    await env.DB.prepare(`INSERT INTO research_pages (id, task_id, question, state, requested_at, updated_at) VALUES (?,?,?,'queued',?,?)`)
      .bind(pageId, t.id, researchAskOf(task, input).slice(0, 2000), now, now).run();
  }
  const { fileResearchPage } = await import("../duties/deliverReport");
  const runRef = `grounded:${t.id}`;
  await fileResearchPage(env, { pageId, taskId: t.id, runId: runRef, page: out.page, now });
  const url = researchPageUrl(pageId);
  const text = `${out.page.summary}\n\nPage: ${url}`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE tasks SET status = 'done', output = ?, error = NULL, finished_at = ? WHERE id = ?`)
      .bind(JSON.stringify({ text, model: out.model, research_page_id: pageId, sources: out.page.sources.length, gaps: out.page.gaps.length }), now, t.id),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'completed',?)`)
      .bind(newId("tev"), t.id, now, JSON.stringify({ via, model: out.model, research_page_id: pageId, sources: out.page.sources.length, gaps: out.page.gaps.length })),
  ]);
  // The Done notice is written by fileResearchPage, the one place every rung and seat files a page.
}
