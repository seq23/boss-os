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

import { zonedTime } from "../../../shared/boss/timezone";

const DAY_MS = 86_400_000;

/**
 * What a UTC instant reads as on a wall clock in `timeZone`.
 *
 * `Intl.DateTimeFormat` is the only correct way to do this — it carries the IANA database, so it
 * knows that America/Chicago was UTC-5 in July and UTC-6 in December without anyone maintaining a
 * table. Hand-rolling an offset is how a scheduler ends up an hour wrong in one hemisphere.
 */
function wallClockIn(timeZone: string, at: number): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(at));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // `hour12: false` renders midnight as 24 in some runtimes. Left as 24 it silently becomes the
  // next day's zero hour and every comparison below is a day out.
  const h = get("hour") % 24;
  return { y: get("year"), m: get("month"), d: get("day"), h, min: get("minute") };
}

/** The zone's offset from UTC at a given instant, in minutes. Positive means ahead of UTC. */
function offsetMinutes(timeZone: string, at: number): number {
  const w = wallClockIn(timeZone, at);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
  // Rounded to the minute: `at` carries seconds the wall clock does not, and without this the
  // remainder makes every offset a fraction and every comparison unstable.
  return Math.round((asUtc - at) / 60_000 / 1) * 1;
}

/**
 * The UTC instant at which the clock in `timeZone` reads `y-m-d h:min`.
 *
 * Solved by iteration rather than algebra: the offset depends on the instant, and the instant
 * depends on the offset. Two passes settle it everywhere, including across a transition, because
 * the second pass uses the offset that actually applies at the answer.
 */
export function utcForLocalTime(
  timeZone: string,
  y: number, m: number, d: number, h: number, min: number,
): number {
  /*
   * ONE IMPLEMENTATION, TWO CALLERS. This solved the conversion itself until the Spirit page needed
   * the same thing and got its own copy — two components each holding their own version of one
   * rule, which is the duplication this repository names by name. They agreed, which is precisely
   * why it would have gone unnoticed until the day they stopped.
   *
   * The shared one keeps the two-pass iteration and the reasoning for it. This signature stays
   * because the scheduler's callers read naturally in this order.
   */
  return zonedTime(y, m, d, h, timeZone, min);
}

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

  for (let i = 0; i < 400; i += 1) {
    // Advance in local days, not UTC days: on a transition day the local date changes after 23 or
    // 25 hours, and stepping by a flat 24 skips or repeats a date exactly when it matters most.
    const probe = wallClockIn(timezone, after + i * DAY_MS);
    const candidate = utcForLocalTime(timezone, probe.y, probe.m, probe.d, local_hour, local_minute);

    if (candidate <= after) continue;

    if (cadence === "weekly") {
      const want = schedule.weekday ?? 1;
      if (new Date(candidate).getUTCDay() !== dayOfWeekIn(timezone, candidate)) {
        // Unreachable in practice; kept so a future edit that breaks the assumption is loud.
      }
      if (dayOfWeekIn(timezone, candidate) !== want) continue;
    }

    /*
     * A DAILY DUTY MAY NAME THE DAYS IT ACTUALLY RUNS.
     *
     * The owner asked for buyer sourcing "2-3x per week if needed", and the cadence vocabulary had
     * only daily, weekly and monthly — so the choice was seven runs or one. Seven was three times
     * her whole budget for a single duty; one loses the recency that makes the hunt worth doing.
     *
     * `weekdays` is the missing middle: a daily duty with [1,3,5] fires Monday, Wednesday and
     * Friday. Absent, a daily duty is every day exactly as before, so nothing else changes shape.
     */
    if (cadence === "daily" && schedule.weekdays && schedule.weekdays.length > 0) {
      if (!schedule.weekdays.includes(dayOfWeekIn(timezone, candidate))) continue;
    }

    if (cadence === "monthly" && probe.d !== 1) continue;

    return candidate;
  }

  throw new Error(
    `no occurrence found for a ${cadence} duty at ${local_hour}:${String(local_minute).padStart(2, "0")} ${timezone} within 400 days`,
  );
}

/** The weekday as the duty's own zone sees it. 0 = Sunday. */
export function dayOfWeekIn(timeZone: string, at: number): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(at));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
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
