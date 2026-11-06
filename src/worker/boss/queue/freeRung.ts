/**
 * THE LADDER NEVER ENDS ON A SPENT SEAT (owner, 6 Nov 2026).
 *
 * `tsk_m6pq1seyd1qp8j45` (Camille's deep research for Valerie) sat "running" from 07:00 Central with
 * no run anywhere: it named no seat, so the consumer sent it to the plain cloud rung inside a drain
 * that died, and nothing ever looked at it again. Codex was out until 10 Nov and the Mac's poll
 * re-claimed its spent seat every 30 minutes. Three rules, here and in consumer.ts:
 *
 *   1. RESEARCH WALKS Codex seat → Claude seat (only where her rules allow) → free Google-grounded
 *      search → stop by name. A research ask with no seat named is made a research page
 *      (`asResearchPage`), so it gets the same ladder and the same delivery as one she emailed.
 *   2. The grounded rung (`runGroundedRung`) files Camille's page, completes the task and writes the
 *      "Done" notice her Mac sends (task-notices.mjs) — the normal Boss OS way.
 *   3. A rung that cannot run is NAMED STOP [<CODE>] with its reset time: recorded on the task, put
 *      on Kendra's (Systems) list in system_events, re-queued for the reset — never a silent loop.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { noticeOnce } from "../service/notices";
import { runGroundedResearch } from "../research/grounded";
import { getBackend } from "../backends/registry";
import { OPENAI_SEAT } from "../duties/seatOrder";
import { scanForModelAccess, privateLexicon } from "../router/modelAccess";

const KENDRA = "emp_continuity";
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
  return (page || bare) && !isObj(input.firm_scan) && !isObj(input.repo_change) && input.chrome_job !== true;
}

/** The ask, in her words: the composed prompt is the page contract, not the question. */
export function researchAskOf(task: { title?: string | null }, input: Record<string, unknown>): string {
  const page = isObj(input.research_page) ? input.research_page : null;
  const parts = [input.instruction, input.body, page?.question, input.prompt]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return (parts[0] ?? String(task.title ?? "")).trim();
}

/**
 * A RESEARCH ASK THAT NAMED NO SEAT BECOMES A RESEARCH PAGE (additive: the task's input gains the
 * page fields admitTask gives an emailed "research:" ask; a research_pages row is created). Returns
 * the new input, or null when the task already names where it runs.
 */
export async function asResearchPage(env: Env, task: { id: string; title?: string | null }, input: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (input.backend_id !== undefined || input.backend_ladder !== undefined || input.delivers !== undefined || isObj(input.research_page)) return null;
  const { composeResearchPrompt, RESEARCH_PAGE_DELIVERS, RESEARCH_PAGE_BACKEND, RESEARCH_PAGE_REQUESTED } = await import("../../../shared/boss/research/page.mjs");
  const question = researchAskOf(task, input).slice(0, 4000);
  const pageId = newId("rpg");
  const now = Date.now();
  const next = {
    ...input,
    research_page: { page_id: pageId, question },
    delivers: RESEARCH_PAGE_DELIVERS,
    backend_id: RESEARCH_PAGE_BACKEND,
    requested: { ...RESEARCH_PAGE_REQUESTED, allowed_paths: [...RESEARCH_PAGE_REQUESTED.allowed_paths], web_tools: [...RESEARCH_PAGE_REQUESTED.web_tools] },
    prompt: composeResearchPrompt({ id: pageId, question }),
  };
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO research_pages (id, task_id, question, state, requested_at, updated_at) VALUES (?,?,?,'queued',?,?)`).bind(pageId, task.id, question.slice(0, 2000), now, now),
    env.DB.prepare(`UPDATE tasks SET input = ? WHERE id = ?`).bind(JSON.stringify(next), task.id),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'ladder_step',?)`)
      .bind(newId("tev"), task.id, now, JSON.stringify({ made_research_page: pageId, why: "a research ask with no seat named gets the research ladder: Codex, then Claude where allowed, then free Google search" })),
  ]);
  return next;
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

/** The next top of the hour plus a minute: when the hourly tick, which may run long work, drains. */
export function nextTickAt(now: number): number {
  return Math.floor(now / 3600_000) * 3600_000 + 3600_000 + 60_000;
}

/**
 * THE FREE GOOGLE-GROUNDED RUNG. Long work (one grounded call per part of the brief), so it never
 * runs in a request's 30-second tail: a drain started by a request hands it to the hourly tick.
 * Returns true when it handled the task (done, stopped by name, or handed to the tick); false when
 * the grounded route cannot answer, so the caller walks on to the other free routes.
 */
export async function runGroundedRung(
  env: Env,
  task: any,
  input: Record<string, unknown>,
  o: { fromRequest?: boolean; employeeName?: string | null },
): Promise<boolean> {
  const t = { id: String(task.id), lane: String(task.lane), title: String(task.title ?? task.id) };
  if (o.fromRequest) {
    await env.DB.prepare(`UPDATE tasks SET status = 'queued' WHERE id = ?`).bind(t.id).run();
    await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'ladder_step',?)`)
      .bind(newId("tev"), t.id, Date.now(), JSON.stringify({ next: "free Google search", why: "long research runs on the hourly tick, never in a request's 30-second tail" })).run();
    await env.TASKS.send({ taskId: t.id, lane: t.lane }, { delaySeconds: Math.round((nextTickAt(Date.now()) - Date.now()) / 1000) });
    return true;
  }
  /*
   * THE PRIVACY SCREEN FIRST, FAIL CLOSED. The free tier trains on prompts; an ask the screen flags
   * waits for Codex's seat by name and is never sent to Google (the router would refuse it too).
   */
  const ask = researchAskOf(task, input);
  const verdict = scanForModelAccess([{ role: "user", content: ask }], await privateLexicon(env.DB),
    { modelAccess: task.model_access ?? null, sensitivity: task.sensitivity ?? null });
  if (verdict.privateOnly) {
    const reset = await codexResetAt(env);
    await namedStop(env, t, { code: "NO_SEAT_AVAILABLE", tell: true, resumeAt: reset,
      why: `NAMED STOP [NO_SEAT_AVAILABLE] the privacy screen keeps this off free Google search (${verdict.reason ?? "private"}); Codex is out${reset ? ` until ${new Date(reset).toISOString()}` : ""}` });
    return true;
  }
  await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'ladder_step',?)`)
    .bind(newId("tev"), t.id, Date.now(), JSON.stringify({ backend_id: "bk_gemini", next: "free Google search", why: "the seats are spent or not allowed; research walks to Gemini with Google Search grounding, free" })).run();

  const out = await runGroundedResearch(env, task, ask);
  if (out.state === "unavailable") {
    await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'ladder_step',?)`)
      .bind(newId("tev"), t.id, Date.now(), JSON.stringify({ backend_id: "bk_gemini", refused: out.why, next: "other free routes" })).run();
    return false;
  }
  if (out.state === "stop") {
    await namedStop(env, t, { code: out.code, why: out.why, resumeAt: out.resumeAt, tell: false });
    return true;
  }

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
      .bind(newId("tev"), t.id, now, JSON.stringify({ via: "free Google search", model: out.model, research_page_id: pageId, sources: out.page.sources.length, gaps: out.page.gaps.length })),
  ]);
  await noticeOnce(env, {
    task: t, fromName: o.employeeName ?? "Camille", kind: `done#${Number(task.attempts ?? 0)}`,
    subject: `Done: ${out.page.title.slice(0, 120)}`,
    lines: [
      `Your research is ready: ${out.page.title}.`,
      "",
      "Nothing to decide — this is just so you know.",
      "",
      out.page.summary.replace(/\s*\[\d+\]/g, ""),
      "",
      `Read the full page: ${url}`,
      "",
      `Every fact on it is tied to a page Google found (${out.page.sources.length} sources).${out.page.gaps.length ? ` What I could not confirm is listed at the end (${out.page.gaps.length} items).` : ""}`,
    ],
  });
  return true;
}
