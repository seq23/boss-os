import type { Env } from "../env";
import { logEvent } from "../lib/log";
import { clockRepair, type DutySchedule } from "./cadence";

/**
 * THE ONE DOOR TO "WHEN IS THIS DUTY DUE" (22 Nov 2026).
 *
 * Every place that answers whether a duty is due reads its clock through here, so no answer can be
 * given from a clock a migration or a moved schedule left ahead of the slot the duty owes
 * (`clockRepair`, cadence.ts). A repair writes the one column and logs `duty_clock_repaired` to
 * Diagnostics: it is Boss OS's own work, so it never writes to her. `validate:duty-clock`
 * (scripts/validate/the-clock-belongs-to-code.mjs) fails the build on a due-answer path that skips it.
 */
export interface ClockedDuty {
  id: string;
  local_hour: number;
  local_minute: number;
  timezone: string;
  cadence: DutySchedule["cadence"];
  weekday?: number | null;
  /** JSON array, as stored. */
  weekdays?: string | null;
  next_due_at: number | null;
  last_run_at?: number | null;
  created_at?: number | null;
  suspended?: number | boolean | null;
  removed_at?: number | null;
}

/** The duty's clock after the repair rule. Writes the repaired value; never throws for a bad schedule. */
export async function effectiveNextDue(env: Env, duty: ClockedDuty, now: number): Promise<number | null> {
  let weekdays: number[] | null = null;
  try { weekdays = duty.weekdays ? (JSON.parse(duty.weekdays) as number[]) : null; } catch { weekdays = null; }
  let repair;
  try {
    repair = clockRepair({ ...duty, weekday: duty.weekday ?? null, weekdays }, now);
  } catch (err) {
    // Unschedulable: the clock is kept exactly as it was and the reason is said by name.
    await logEvent(env.DB, {
      level: "error", scope: "duties", event: "duty_unschedulable", entityId: duty.id,
      detail: { timezone: duty.timezone, cadence: duty.cadence, error: err instanceof Error ? err.message : String(err) },
    }).catch(() => {});
    return duty.next_due_at;
  }
  if (!repair) return duty.next_due_at;
  await env.DB
    .prepare(`UPDATE standing_duties SET next_due_at = ? WHERE id = ? AND next_due_at = ?`)
    .bind(repair.next_due_at, duty.id, duty.next_due_at)
    .run();
  await logEvent(env.DB, {
    level: "warn", scope: "duties", event: "duty_clock_repaired", entityId: duty.id,
    detail: { from: duty.next_due_at, to: repair.next_due_at, why: repair.why },
  }).catch(() => {});
  return repair.next_due_at;
}
