import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { isDue, nextDueAt, type DutySchedule } from "./cadence";

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
  next_due_at: number;
  task_kind: string;
  task_title: string;
  task_input: string | null;
  suspended: number;
}

export interface MaterialiseResult {
  considered: number;
  fired: { duty: string; task_id: string; next_due_at: number }[];
  skipped: { duty: string; reason: string }[];
}

export async function materialiseDueDuties(env: Env, now = Date.now()): Promise<MaterialiseResult> {
  const rows = await env.DB
    .prepare(`SELECT * FROM standing_duties ORDER BY next_due_at`)
    .all<DutyRow>();

  const duties = rows.results ?? [];
  const fired: MaterialiseResult["fired"] = [];
  const skipped: MaterialiseResult["skipped"] = [];

  for (const duty of duties) {
    if (!isDue(duty.next_due_at, duty.suspended === 1, now)) {
      skipped.push({ duty: duty.id, reason: duty.suspended === 1 ? "suspended" : "not_due" });
      continue;
    }

    const schedule: DutySchedule = {
      local_hour: duty.local_hour,
      local_minute: duty.local_minute,
      timezone: duty.timezone,
      cadence: duty.cadence,
      weekday: duty.weekday,
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

    const taskId = newId("tsk");
    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO tasks (id, lane, employee_id, title, input, status, created_at)
           VALUES (?,?,?,?,?,'queued',?)`,
        )
        .bind(taskId, duty.lane, duty.employee_id, duty.task_title, duty.task_input, now),
      env.DB
        .prepare(`UPDATE standing_duties SET next_due_at = ?, last_run_at = ?, last_task_id = ? WHERE id = ?`)
        .bind(advanced, now, taskId, duty.id),
    ]);

    await audit(env.DB, {
      actor: "system", lane: duty.lane, entityType: "standing_duty", entityId: duty.id,
      action: "materialised", detail: { task_id: taskId, next_due_at: advanced },
    });

    fired.push({ duty: duty.id, task_id: taskId, next_due_at: advanced });
  }

  return { considered: duties.length, fired, skipped };
}
