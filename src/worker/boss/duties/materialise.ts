import type { Env } from "../env";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { isDue, nextDueAt, type DutySchedule } from "./cadence";
import { admitTask } from "../tasks/admit";
import { BRIEFING_PROMPT_VERSION, composeBriefingPrompt, ctDayLabel } from "./briefingSpec";
import { BRIEFING_CLASSIFICATION, BRIEFING_LADDER_IDS, modelBySeat } from "./briefingLadder";

/**
 * Turning due duties into queued work.
 *
 * DUTIES NEVER EXECUTE INLINE, which is Phase 10's own instruction and the right shape regardless:
 * this function writes a task and advances a clock. The task is picked up by whatever runs tasks —
 * for Camille's report that is Claude Code on the owner's Mac, reached through the `agent_executed`
 * backend, because a Cloudflare Worker cannot read the news and a model asked to recall it would
 * invent it.
 *
 * SO A CRON TICK CANNOT BE SLOW OR EXPENSIVE. It compares two numbers per duty and, at most, writes
 * one row. Whatever the work costs is charged where the work happens, under the spend lever, not
 * inside a maintenance run that has no envelope of its own.
 */

export interface DutyRow {
  id: string;
  name: string;
  employee_id: string;
  lane: string;
  local_hour: number;
  local_minute: number;
  timezone: string;
  cadence: "daily" | "weekly" | "monthly";
  weekday: number | null;
  /** JSON array of weekdays a DAILY duty runs on. Null means every day. */
  weekdays: string | null;
  next_due_at: number;
  task_kind: string;
  task_title: string;
  task_input: string | null;
  suspended: number;
  /** 'agent' | 'local_job'. Absent on rows written before 0201, which means agent. */
  executor?: string | null;
}

export interface MaterialiseResult {
  considered: number;
  fired: { duty: string; task_id: string; next_due_at: number }[];
  skipped: { duty: string; reason: string }[];
}

/**
 * Materialise the duties whose clock says so — or ONE duty, now, because she asked.
 *
 * ─── Why "now" had to exist ────────────────────────────────────────────────
 *
 * There was no way to fire a standing duty except waiting for its clock. That is fine until
 * something about a duty CHANGES: migration 0237 rewrote the Executive Intelligence Report's prompt
 * to follow §5's eleven sections, and the only way to find out whether the run actually produced
 * them was to wait for 06:30 the next morning and look.
 *
 * "It will work tomorrow" is a promise, and this repository has a standing rule against handing her
 * one of those in place of evidence. A duty you cannot fire is a duty you cannot prove.
 *
 * `only` DOES NOT SKIP THE GATES. It bypasses the CLOCK and nothing else — a suspended duty stays
 * suspended, a `local_job` still refuses, intake may still decline it, and the budget and backend
 * guards all run exactly as they do at 06:30. The difference between this and the scheduled path is
 * one boolean about time.
 */
export async function materialiseDueDuties(
  env: Env,
  now = Date.now(),
  only?: string,
): Promise<MaterialiseResult> {
  const rows = only
    ? await env.DB.prepare(`SELECT * FROM standing_duties WHERE id = ?`).bind(only).all<DutyRow>()
    : await env.DB.prepare(`SELECT * FROM standing_duties ORDER BY next_due_at`).all<DutyRow>();

  const duties = rows.results ?? [];
  const fired: MaterialiseResult["fired"] = [];
  const skipped: MaterialiseResult["skipped"] = [];

  for (const duty of duties) {
    /*
     * A LOCALLY-EXECUTED DUTY IS NEVER MATERIALISED HERE, AND ITS CLOCK IS NOT TOUCHED.
     *
     * Some work has an employee's name on it and cannot be done by an agent, because the Claude
     * Code runner strips every credential from its environment on purpose: reading her mailbox,
     * Search Console, her `gh` login. That work runs from launchd on her Mac and REPORTS BACK,
     * which is what advances `last_run_at` and `next_due_at`.
     *
     * Admitting a task for one of these would be worse than doing nothing. It would queue work the
     * agent cannot perform, the agent would claim it, fail or invent an answer, and the duty would
     * report a run it never had — the exact "runs but inert" shape, dressed as success.
     *
     * The clock is deliberately left alone rather than advanced past the missed slot: a local job
     * that has not reported leaves `next_due_at` in the past, which is precisely the signal Today
     * uses to say so out loud.
     */
    if (duty.executor === "local_job") {
      skipped.push({ duty: duty.id, reason: "local_job" });
      continue;
    }

    /*
     * A SUSPENDED DUTY IS STILL SUSPENDED WHEN SHE ASKS FOR IT BY HAND. Suspension is a decision;
     * "run it now" is about the clock, not about the decision.
     */
    if (only && duty.suspended === 1) {
      skipped.push({ duty: duty.id, reason: "suspended" });
      continue;
    }
    if (!only && !isDue(duty.next_due_at, duty.suspended === 1, now)) {
      skipped.push({ duty: duty.id, reason: duty.suspended === 1 ? "suspended" : "not_due" });
      continue;
    }

    let weekdays: number[] | null = null;
    // A malformed list must not silently become "every day" — that is how a duty triples its cost
    // without anyone editing a schedule. It stays null and the duty runs as it always did.
    try { weekdays = duty.weekdays ? (JSON.parse(duty.weekdays) as number[]) : null; } catch { weekdays = null; }

    const schedule: DutySchedule = {
      local_hour: duty.local_hour,
      local_minute: duty.local_minute,
      timezone: duty.timezone,
      cadence: duty.cadence,
      weekday: duty.weekday,
      weekdays,
    };

    /*
     * ADVANCE THE CLOCK FIRST, AND FROM `now` RATHER THAN FROM THE MISSED TIME.
     *
     * Two failures this avoids, both of which produce a loop rather than an error. Computing from
     * `next_due_at` after a long outage returns a time that is still in the past, so the duty stays
     * due and materialises again on the very next tick — for ever. And writing the task before the
     * clock means a crash between the two leaves the duty due with the task already made, which is
     * the same loop wearing a different hat.
     *
     * A duty that slept through several occurrences therefore fires ONCE and moves on. Four copies
     * of Monday's report on Thursday is not what a missed morning needs, and the owner's own Core
     * Law 3 says it plainly: "Yesterday is closed. The system moves forward only."
     */
    let advanced: number;
    try {
      advanced = nextDueAt(schedule, now);
    } catch (err) {
      // An unschedulable duty is recorded and left alone rather than retried into the ground. It
      // keeps its old next_due_at, so nothing silently changes about when it believes it is due.
      skipped.push({ duty: duty.id, reason: `unschedulable: ${err instanceof Error ? err.message : String(err)}` });
      await logEvent(env.DB, {
        level: "error", scope: "cron", event: "duty_unschedulable", entityId: duty.id,
        detail: { timezone: duty.timezone, cadence: duty.cadence },
      }).catch(() => {});
      continue;
    }

    /*
     * THE CLOCK ADVANCES BEFORE THE TASK IS MADE, and that ordering is the one this function
     * already argued for above: a crash between the two must not leave a duty still due with its
     * task already written, because that is a loop rather than an error. A duty that fails to be
     * admitted therefore MISSES one occurrence rather than retrying for ever — and it says so, at
     * error level, every single time, so a duty that can never be admitted is loud rather than
     * quietly absent.
     */
    await env.DB
      .prepare(`UPDATE standing_duties SET next_due_at = ?, last_run_at = ? WHERE id = ?`)
      .bind(advanced, now, duty.id).run();

    /*
     * ADMITTED THROUGH THE REAL INTAKE, WHICH IT NEVER USED TO BE.
     *
     * What was here was a bare INSERT of seven columns — no classification, no execution
     * assignment, no permission envelope, no `intake_kind`, and CRUCIALLY no `TASKS.send()`. The
     * duty fired on time, `last_run_at` advanced, a row appeared with status 'queued', and the work
     * never ran. `boss_task_queue` was empty while two tasks sat queued since the 6th, and the
     * Executive Intelligence Report the owner opens Boss OS to read had never been produced once.
     *
     * Every observable signal said this was working. That is what makes "runs but inert" the defect
     * class worth naming: it does not fail, it succeeds at the wrong thing.
     *
     * A `TASKS.send()` bolted on here would have fixed the symptom and left two intake paths to be
     * kept in step by whoever noticed next. `admitTask` is the one path both callers use, so a task
     * a duty creates is now indistinguishable from one created by hand.
     */
    let admitted;
    try {
      let input: Record<string, unknown> = duty.task_input ? (JSON.parse(duty.task_input) as Record<string, unknown>) : {};
      /*
       * ── THE BRIEFING'S PROMPT IS COMPOSED HERE, FROM THE MODULE, ON EVERY FIRING ──
       *
       * `duty_exec_intel` no longer carries `$.prompt` in its row (0257). It carries
       * `spec_module: "executive_briefing"`, and the text the run is handed is
       * `composeBriefingPrompt()` from `briefingSpec.ts` — the file's production prompt, versioned,
       * diffable, and read by the same grader that scores what comes back. Eight prior rewrites each
       * landed as a `json_set` in a migration nobody could diff; this is the end of that.
       *
       * The version is stamped on the task so the report row records which specification produced
       * it. `hasMarketData` is true here because the Mac writes MARKETS.json before every claim; the
       * prompt still tells the run what to do if the file is absent.
       */
      if (input.spec_module === "executive_briefing") {
        const requested = typeof input.requested === "object" && input.requested ? { ...(input.requested as Record<string, unknown>) } : {};
        input = {
          ...input,
          prompt: composeBriefingPrompt({ dayLabel: ctDayLabel(now), hasMarketData: true }),
          prompt_version: BRIEFING_PROMPT_VERSION,
          /*
           * THE LADDER IS STAMPED FROM THE MODULE TOO. Her two $0 seats in the order she named them,
           * each with its own model, and the cloud rungs beneath when both refuse. See
           * `briefingLadder.ts` for why this was not true before 19 September.
           */
          backend_id: BRIEFING_LADDER_IDS[0],
          backend_ladder: BRIEFING_LADDER_IDS,
          cloud_fallback: true,
          requested: { ...requested, model_by_backend: modelBySeat() },
        };
      }
      const briefing = input.spec_module === "executive_briefing";
      admitted = await admitTask(env, {
        title: duty.task_title,
        lane: duty.lane,
        employee_id: duty.employee_id,
        // The kind the duty was defined with, rather than one inferred from its title every morning.
        intake_kind: duty.task_kind,
        input,
        // The briefing declares its axes; a word-match on its own prompt made the cloud rungs
        // unreachable. See BRIEFING_CLASSIFICATION.
        ...(briefing ? BRIEFING_CLASSIFICATION : {}),
      });
    } catch (err) {
      skipped.push({ duty: duty.id, reason: `not_admitted: ${err instanceof Error ? err.message : String(err)}` });
      await logEvent(env.DB, {
        level: "error", scope: "cron", event: "duty_not_admitted", entityId: duty.id,
        detail: { lane: duty.lane, task_kind: duty.task_kind, error: err instanceof Error ? err.message : String(err) },
      }).catch(() => {});
      continue;
    }

    /*
     * INTAKE IS ALLOWED TO REFUSE, and a refusal is a real outcome rather than a failure — the
     * system is explicitly permitted to decide that a piece of standing work is not worth doing.
     * It is recorded as a skip with its reason rather than reported as a firing.
     */
    if (!admitted.created || !admitted.task_id) {
      skipped.push({ duty: duty.id, reason: `refused_by_intake: ${admitted.reason ?? "no reason given"}` });
      continue;
    }

    const taskId = admitted.task_id;
    await env.DB
      .prepare(`UPDATE standing_duties SET last_task_id = ? WHERE id = ?`)
      .bind(taskId, duty.id).run();

    await audit(env.DB, {
      actor: "system", lane: duty.lane, entityType: "standing_duty", entityId: duty.id,
      action: "materialised",
      detail: { task_id: taskId, next_due_at: advanced, queued: admitted.queued, kind: admitted.classification.intakeKind },
    });

    fired.push({ duty: duty.id, task_id: taskId, next_due_at: advanced });
  }

  return { considered: duties.length, fired, skipped };
}
