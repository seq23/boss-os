import { nextDueAt, type DutySchedule } from "./cadence";

/**
 * A DUTY IS LATE AGAINST ITS OWN SCHEDULE, NEVER AGAINST A CALENDAR IT DOES NOT KEEP.
 *
 * ─── The false alarm this replaces ─────────────────────────────────────────
 *
 * Her Critical Alerts, Sunday 13 September 2026, at HIGH:
 *
 *   "Brokerage Sourcing Sweep (Mon/Wed/Fri) has not fired for 2 days. Its clock says it should
 *    have."
 *
 * Its clock said nothing of the sort. The duty's own NAME says Mon/Wed/Fri, its row says
 * `cadence = 'daily'` with `weekdays = [1,3,5]`, and it ran on Friday the 11th exactly as designed.
 * The next occurrence was Monday. The alert fired on Sunday because the check was:
 *
 *     COALESCE(last_run_at, created_at) < now − (cadence = 'daily' ? 2 : …) days
 *
 * — a DAILY clock applied to a duty that deliberately does not run daily. `weekdays` was added so a
 * duty could run two or three times a week instead of seven; the staleness check was never taught
 * about it, so every weekday-restricted duty goes loud every weekend, for ever.
 *
 * That is "a guard that cannot reach what it governs", and the cost is the one this repository
 * names everywhere: a screen that cries wolf is one she stops reading. It was the loudest thing on
 * her morning and it was wrong.
 *
 * ─── The rule, and why the grace is a day rather than an occurrence ────────
 *
 * A duty is stale when an occurrence its OWN schedule named has passed, and a further full day has
 * gone by without it running.
 *
 * The old comment gave the reason for a threshold and got the arithmetic wrong: "one missed run is
 * a laptop that was closed; two is a fault". That is right about a DAILY duty, where two runs is
 * two mornings. Expressed as two OCCURRENCES it would let a Mon/Wed/Fri duty sit silent from Monday
 * to Thursday, and expressed as two DAYS it fires on a Sunday about a Monday duty. Expressed as
 * "the occurrence is more than a day old" it means the same thing it always meant for a daily duty
 * — this morning's missed 06:30 is quiet, yesterday morning's is not — and it finally means
 * something sensible for every other shape.
 *
 * PURE FUNCTIONS OVER A ROW. Nothing here reads the database, so every case that matters — a
 * Sunday, a Monday, a duty that has never run, a duty suspended mid-week — is testable without
 * standing anything up. `cadence.ts` already owns the hard part; this counts what it returns.
 */

/** What the staleness check needs off a `standing_duties` row. */
export interface DutyStalenessRow {
  id: string;
  name: string;
  cadence: string;
  weekday: number | null;
  /** JSON array as stored, or the parsed array. `[1,3,5]` is Mon/Wed/Fri. */
  weekdays: string | number[] | null;
  local_hour: number | null;
  local_minute: number | null;
  timezone?: string | null;
  time_zone?: string | null;
  suspended: number | boolean;
  last_run_at: number | null;
  created_at: number | null;
}

export interface DutyStaleness {
  /** Loud or quiet. */
  stale: boolean;
  /** How many of its own occurrences have gone by unrun. */
  missed: number;
  /** The oldest occurrence it missed, or null when it has missed none. */
  missed_since: number | null;
  /** The next time its schedule says it should run. */
  next_expected: number | null;
  /** Why it is quiet, when it is. Used by the employee health dot, which must explain itself. */
  reason: string;
}

/** One full day past a missed occurrence before it is a fault. A closed laptop deserves a morning. */
export const STALENESS_GRACE_MS = 86_400_000;

/** Never walk further than this; a bounded loop cannot hang a page render. */
const MAX_OCCURRENCES = 64;

function scheduleOf(duty: DutyStalenessRow): DutySchedule | null {
  const zone = duty.timezone ?? duty.time_zone ?? null;
  if (!zone || duty.local_hour === null || duty.local_minute === null) return null;

  let weekdays: number[] | null = null;
  if (Array.isArray(duty.weekdays)) weekdays = duty.weekdays;
  else if (typeof duty.weekdays === "string" && duty.weekdays.trim() !== "") {
    try {
      const parsed = JSON.parse(duty.weekdays);
      if (Array.isArray(parsed)) weekdays = parsed.filter((n): n is number => typeof n === "number");
    } catch {
      weekdays = null;
    }
  }

  const cadence = duty.cadence === "weekly" || duty.cadence === "monthly" ? duty.cadence : "daily";
  return {
    weekdays,
    local_hour: duty.local_hour,
    local_minute: duty.local_minute,
    timezone: zone,
    cadence,
    weekday: duty.weekday,
  };
}

/**
 * Where the count starts.
 *
 * `created_at` rather than the epoch when a duty has never run, and that is not a detail: measuring
 * a brand-new weekly duty from 0 made every one of them raise a HIGH alert the moment it was
 * created. Measured from creation, a new duty is given its own cadence to fire in before anything
 * is said about it.
 */
function referenceFor(duty: DutyStalenessRow, now: number): number {
  return duty.last_run_at ?? duty.created_at ?? now;
}

/**
 * How late a duty is against the schedule it actually keeps.
 *
 * A suspended duty is never stale — being switched off is a decision, and a decision in force is
 * not a fault. That is the same rule the credential register now applies to a backend nobody
 * enabled, and for the same reason: an alert that fires because a deliberate choice is in force is
 * noise wearing an alarm's clothes.
 */
export function dutyStaleness(duty: DutyStalenessRow, now = Date.now()): DutyStaleness {
  if (duty.suspended) {
    return { stale: false, missed: 0, missed_since: null, next_expected: null, reason: "Suspended on purpose." };
  }

  const schedule = scheduleOf(duty);
  if (!schedule) {
    /*
     * A ROW THIS CANNOT READ IS REPORTED, NOT ASSUMED FINE. A duty with no zone or no local time
     * cannot be scheduled at all, and calling that healthy is how a duty that never runs looks
     * exactly like one that runs perfectly.
     */
    return {
      stale: true,
      missed: 0,
      missed_since: null,
      next_expected: null,
      reason: `"${duty.name}" has no readable schedule, so nothing can say when it should run.`,
    };
  }

  const reference = referenceFor(duty, now);
  let cursor = reference;
  let missed = 0;
  let firstMissed: number | null = null;
  let next: number | null = null;

  for (let i = 0; i < MAX_OCCURRENCES; i += 1) {
    let occurrence: number;
    try {
      occurrence = nextDueAt(schedule, cursor);
    } catch {
      break;
    }
    if (occurrence > now) {
      next = occurrence;
      break;
    }
    missed += 1;
    if (firstMissed === null) firstMissed = occurrence;
    cursor = occurrence;
  }

  const stale = firstMissed !== null && now - firstMissed > STALENESS_GRACE_MS;
  const reason = stale
    ? `"${duty.name}" missed ${missed} scheduled run${missed === 1 ? "" : "s"}, the first of them ` +
      `${Math.floor((now - firstMissed!) / 3_600_000)} hours ago.`
    : missed > 0
      ? `"${duty.name}" is due and has not run yet today. One missed morning is a closed laptop.`
      : `"${duty.name}" is on schedule.`;

  return { stale, missed, missed_since: firstMissed, next_expected: next, reason };
}
