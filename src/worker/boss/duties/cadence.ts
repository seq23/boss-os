/**
 * WHEN A DUTY IS NEXT DUE, IN A ZONE THAT CHANGES ITS MIND TWICE A YEAR.
 *
 * THE DEFECT THIS EXISTS TO PREVENT. The owner asked for her report at 7am Central. Written as a
 * cron expression that is `0 12 * * *` — correct today, in September, under CDT. In November it
 * delivers at 6am. Nobody files a bug for that: she just finds the report already an hour stale
 * when she opens it, twice a year, for ever.
 *
 * So a duty stores a WALL-CLOCK TIME AND A ZONE, and the next occurrence is computed. Daylight
 * saving becomes arithmetic instead of a surprise.
 *
 * PURE FUNCTIONS, NO DATABASE. Every rule here is testable without standing anything up, which
 * matters because the interesting cases are the two days a year nobody is looking.
 */

import { instantAt, wallClock } from "../../../shared/boss/schedule/clock.mjs";

const DAY_MS = 86_400_000;

/**
 * The UTC instant at which the clock in `timeZone` reads `y-m-d h:min`: schedule/clock.mjs's
 * `instantAt`, the one rule (this name is kept for its callers). A duty set in the hour the spring
 * change skips runs just after the jump, never an hour before its time.
 */
export { instantAt as utcForLocalTime };

export interface DutySchedule {
  /**
   * For a DAILY duty, the weekdays it actually runs on. 0 = Sunday. Empty or absent means every day.
   * Ignored for weekly and monthly cadences, which already name their day.
   */
  weekdays?: number[] | null;
  local_hour: number;
  local_minute: number;
  timezone: string;
  cadence: "daily" | "weekly" | "monthly";
  weekday?: number | null;
}

/**
 * The first occurrence strictly after `after`.
 *
 * STRICTLY AFTER, DELIBERATELY. Computing "the next one" from a moment that IS an occurrence must
 * move forward, or a duty that just ran is instantly due again and the cron materialises it in a
 * loop until something else stops it.
 *
 * Walks forward a day at a time — 400 candidates covers a monthly cadence with room to spare, and a
 * bounded loop cannot hang a cron tick. Exhausting it throws rather than returning a wrong answer:
 * a scheduler that silently invents a due date is worse than one that fails loudly.
 */
export function nextDueAt(schedule: DutySchedule, after: number): number {
  const { timezone, local_hour, local_minute, cadence } = schedule;

  /*
   * NO ZONE LOOKUP FOR A DAY THAT CANNOT MATCH, ONE PLACEMENT FOR A DAY THAT CAN.
   *
   * This walked every day with four or five `Intl` calls — the wall clock, two offset lookups to
   * place the local time, and the weekday twice — before deciding most of them were the wrong
   * weekday. Eighteen duties on the Today screen, each walked from its last run, came to a few
   * thousand of those calls, and on the Workers runtime each is real CPU. The screen was being
   * killed for it. Now a day is rejected by its civil date alone: the weekday of (y, m, d) is
   * arithmetic, and the first of the month is `d === 1`. The instant is only placed for a day that
   * could be the answer, and the answers are the same — checked against the old walk across four
   * zones, every cadence, and every hour of a year including both transitions.
   */
  // Advance in CIVIL days, not 24-hour steps (24 Nov 2026 fix): on a transition day the local date
  // changes after 23 or 25 hours, and the old `after + i * 24h` walk skipped the spring day whenever
  // `after` fell in the last hour of the day before (a 23:15 duty that ran on 7 Mar was next due 9 Mar).
  const start = wallClock(after, timezone);
  for (let i = 0; i < 400; i += 1) {
    const civil = new Date(Date.UTC(start.y, start.m - 1, start.d + i, 12));
    const probe = { y: civil.getUTCFullYear(), m: civil.getUTCMonth() + 1, d: civil.getUTCDate() };

    if (cadence === "monthly" && probe.d !== 1) continue;

    // The weekday of the civil date, with no zone lookup: a date's weekday is the same everywhere.
    const weekday = civil.getUTCDay();
    if (cadence === "weekly" && weekday !== (schedule.weekday ?? 1)) continue;
    if (cadence === "daily" && schedule.weekdays && schedule.weekdays.length > 0 && !schedule.weekdays.includes(weekday)) continue;

    const candidate = instantAt(timezone, probe.y, probe.m, probe.d, local_hour, local_minute);
    if (candidate <= after) continue;

    return candidate;
  }

  throw new Error(
    `no occurrence found for a ${cadence} duty at ${local_hour}:${String(local_minute).padStart(2, "0")} ${timezone} within 400 days`,
  );
}

export function dayOfWeekIn(timeZone: string, at: number): number {
  return wallClock(at, timeZone).dow;
}

/**
 * Is this duty due, and should it fire?
 *
 * A duty that has been asleep past several occurrences fires ONCE and moves on. Catching up by
 * materialising every missed morning would hand her four copies of Monday's report on Thursday,
 * which is not what a missed morning needs — and it is the same rule her own Core Law 3 states:
 * "Yesterday is closed. The system moves forward only."
 */
export function isDue(nextDueAtMs: number, suspended: boolean, now: number): boolean {
  return !suspended && nextDueAtMs <= now;
}

/**
 * A run this long BEFORE a slot answers for that slot (26 Oct 2026). launchd fires on the Mac's wall
 * clock and duties are kept in Central, so a Mac on Eastern fires an hour early; Central → Europe is
 * at most eight. Read by the run recorder (routes/duties.ts `creditFrom`) and by staleness.
 */
export const EARLY_RUN_GRACE_MS = 8 * 3_600_000;

/*
 * ─── THE CLOCK BELONGS TO CODE (22 Nov 2026) ────────────────────────────────
 *
 * THE DEFECT. Migration 0373 moved every Mac duty into her Mac's day and wrote each clock by hand in
 * SQLite date arithmetic: `date('now', '+1 day')` plus a fixed number of hours. Two errors in one
 * line: `date('now')` is a UTC date standing in for a Central day, and `'+1 day'` skips the coming
 * occurrence unconditionally. Applied when the UTC date already read 22 Nov, it set duty_lp_daily to
 * 23 Nov 05:45 while the duty had last run on 21 Nov, so the 22 Nov slot never existed, the Mac's
 * `--only-if-due` wrapper skipped the LP producer twice, and the morning email said "LP updates: its
 * job did not report in". The line was copied from 0327: the second break of one kind, so the clock
 * left SQL instead of being patched a third time.
 *
 * THE RULE. A stored clock that is AHEAD of the slot the duty owes is moved back to that slot. Never
 * forward: a genuinely missed run stays in the past, so Today still says so out loud.
 */

/** How far back one missed slot can be owed: one period of the duty's cadence. */
export function periodMs(schedule: Pick<DutySchedule, "cadence">): number {
  if (schedule.cadence === "weekly") return 7 * DAY_MS;
  if (schedule.cadence === "monthly") return 31 * DAY_MS;
  return DAY_MS;
}

/**
 * The slot this duty owes: the first occurrence strictly after the later of (a) the slot its last
 * successful run answered for, (b) the moment the duty was created, and (c) one period ago.
 *
 * (a) mirrors the run recorder (`creditFrom`, routes/duties.ts): a run up to EARLY_RUN_GRACE_MS
 * before a slot answers for that slot (a Mac on Eastern fires an hour early), so that slot is not
 * owed again. (c) bounds the debt to one period: a deploy never starts a backlog of week-old work.
 */
export function pendingSlot(
  schedule: DutySchedule,
  lastRunAt: number | null | undefined,
  now: number,
  createdAt?: number | null,
): number {
  let anchor = 0;
  if (typeof lastRunAt === "number" && Number.isFinite(lastRunAt)) {
    const following = nextDueAt(schedule, lastRunAt);
    anchor = following - lastRunAt <= EARLY_RUN_GRACE_MS ? following : lastRunAt;
  }
  const floor = Math.max(anchor, typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0, now - periodMs(schedule));
  return nextDueAt(schedule, floor);
}

export interface ClockRow extends DutySchedule {
  next_due_at: number | null;
  last_run_at?: number | null;
  created_at?: number | null;
  suspended?: number | boolean | null;
  removed_at?: number | null;
}

export type ClockRepair = { next_due_at: number; why: "not_a_slot" | "slot_skipped" };

/**
 * `null` when the clock is healthy, else where it belongs and why. It fires only when the stored
 * instant is LATER than the slot the duty owes — because it is not an occurrence of the duty's own
 * schedule (a schedule moved and the clock did not), or because a period was skipped. Suspended,
 * removed and clockless rows are never touched. An unschedulable duty (`nextDueAt` throws) is
 * rethrown to the caller, which keeps its clock and says so by name.
 */
export function clockRepair(duty: ClockRow, now: number): ClockRepair | null {
  if (duty.suspended || duty.removed_at) return null;
  if (typeof duty.next_due_at !== "number" || !Number.isFinite(duty.next_due_at)) return null;
  const owed = pendingSlot(duty, duty.last_run_at ?? null, now, duty.created_at ?? null);
  if (duty.next_due_at <= owed) return null;
  const isSlot = nextDueAt(duty, duty.next_due_at - 1) === duty.next_due_at;
  return { next_due_at: owed, why: isSlot ? "slot_skipped" : "not_a_slot" };
}
