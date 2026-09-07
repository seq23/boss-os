import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { dayIdInZone } from "@shared/boss/timezone";

/**
 * WRITING THE EXECUTIVE INTELLIGENCE REPORT, WHICH NOTHING ANYWHERE USED TO DO.
 *
 * The table has existed since migration 0176. `today.ts` reads it on every page load. The duty
 * fires at 06:30 Central. And `grep -rl "INSERT INTO executive_reports" src/worker/boss` returned
 * nothing at all — there was no writer, so the Executive Briefing block on Today had rendered its
 * "no report yet" state every morning since the table was created, exactly as designed, for ever.
 *
 * WHY IT LANDS ON `/backends/report` RATHER THAN AN ENDPOINT OF ITS OWN. That path is already
 * authenticated for the device, already the only way a run finishes, and already carries the
 * runner's evidence. A second endpoint would be a second contract to keep in step with the first,
 * which is the failure this codebase has now hit twice in one morning.
 *
 * THE REPORT IS WRITTEN IMMEDIATELY AND THE APPROVAL IS STILL RAISED. Those are different
 * questions and collapsing them breaks one of them. The approval is about the RUN — what the
 * backend did on her machine, whether it touched anything it should not have. The report is a
 * document that was researched and delivered. Gating the reading of it behind an approval would
 * mean opening Boss OS at 7am to a decision instead of a report, which is the entire thing the duty
 * exists to prevent. Nothing about the run's proposal contract is weakened: it still ends as a
 * proposal, and this writes alongside it.
 *
 * A PARTIAL REPORT IS A REAL OUTCOME. The owner's instruction for this duty is explicit: "on
 * failure just say so and name the gaps". A report that refuses to appear teaches her to stop
 * looking at 7am; one that names what is missing keeps the habit and stays honest. So `status`
 * carries partial and failed as first-class values and a failed run still writes a row.
 */

export interface DeliveredReport {
  status?: unknown;
  summary?: unknown;
  sections?: unknown;
  gaps?: unknown;
  sources?: unknown;
  corrections?: unknown;
  day_id?: unknown;
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asText = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Turn one reported run into the day's report row, when the task it came from was contracted to
 * deliver one.
 *
 * Returns the row id, or null when this run delivers nothing — which is the ordinary case for every
 * other kind of backend work and must not be treated as an error.
 */
export async function deliverExecutiveReport(
  env: Env,
  args: { taskId: string; runId: string; report: DeliveredReport | null; runStatus: string; now?: number },
): Promise<string | null> {
  const now = args.now ?? Date.now();

  const task = await env.DB
    .prepare(`SELECT id, input FROM tasks WHERE id = ?`).bind(args.taskId)
    .first<{ id: string; input: string | null }>();
  if (!task) return null;

  let input: Record<string, unknown> = {};
  try { input = task.input ? (JSON.parse(task.input) as Record<string, unknown>) : {}; } catch { input = {}; }
  if (input.delivers !== "executive_reports") return null;

  /*
   * THE DAY IT IS FOR, IN HER ZONE, NOT THE DAY IT WAS WRITTEN. A report generated at 06:30 for the
   * 7th belongs to the 7th even if a retry writes it at 09:00 — and 06:30 Central is already the
   * next day in UTC for half the year, which is precisely how a report would silently file itself
   * under tomorrow. The runner may name the day explicitly; otherwise this computes it in Central.
   */
  const forDay = asText(args.report?.day_id) ?? dayIdInZone(now);

  /*
   * A RUN THAT FAILED STILL WRITES A ROW. The block on Today can then say when the last good report
   * was, rather than rendering an unexplained blank that looks identical to "nothing ran".
   */
  const reported = asText(args.report?.status);
  const status =
    args.runStatus !== "succeeded" ? "failed"
    : reported === "complete" || reported === "partial" || reported === "failed" ? reported
    // A run that succeeded and named no status delivered SOMETHING, and calling that complete would
    // be a claim the runner never made. Partial is the honest floor.
    : "partial";

  const gaps = asArray(args.report?.gaps);
  const sections = asArray(args.report?.sections);

  /*
   * SAYING "complete" WITH GAPS IS NOT ALLOWED. The spec's success criterion is that anything
   * unverified is listed as a gap rather than omitted, and a report that lists gaps and calls
   * itself complete has quietly redefined the word. Downgraded here rather than trusted.
   */
  const honest = status === "complete" && gaps.length > 0 ? "partial" : status;

  const summary =
    asText(args.report?.summary) ??
    (honest === "failed"
      ? "The research run did not produce a usable report. Nothing here is a finding."
      : null);

  const id = newId("xrp");

  /*
   * ONE ROW PER DAY, REPLACED RATHER THAN DUPLICATED. `idx_report_day` is unique on `day_id`, so a
   * retry after a partial morning overwrites it with the better answer instead of failing the whole
   * report path on a constraint the caller cannot see.
   */
  await env.DB
    .prepare(
      `INSERT INTO executive_reports
         (id, day_id, generated_at, task_id, backend_run_id, status, summary, sections, gaps, sources, corrections)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(day_id) DO UPDATE SET
         generated_at = excluded.generated_at,
         task_id = excluded.task_id,
         backend_run_id = excluded.backend_run_id,
         status = excluded.status,
         summary = excluded.summary,
         sections = excluded.sections,
         gaps = excluded.gaps,
         sources = excluded.sources,
         corrections = excluded.corrections`,
    )
    .bind(
      id, forDay, now, args.taskId, args.runId, honest, summary,
      JSON.stringify(sections),
      JSON.stringify(gaps),
      JSON.stringify(asArray(args.report?.sources)),
      JSON.stringify(asArray(args.report?.corrections)),
    )
    .run();

  await logEvent(env.DB, {
    level: honest === "failed" ? "warn" : "info",
    scope: "duties", event: "executive_report_delivered", entityId: args.taskId,
    detail: { day_id: forDay, status: honest, sections: sections.length, gaps: gaps.length, run_id: args.runId },
  });

  return id;
}
