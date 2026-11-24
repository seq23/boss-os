/**
 * THE OWNER'S ZONE, IN ONE PLACE.
 *
 * "America/Chicago" was written out in eight separate files before this — the cron comment, the
 * duty seed, two route strings, a client string, the notifications list. Nothing linked them, which
 * is the shape this repository names: several components each holding their own copy of the same
 * fact, free to disagree.
 *
 * WHY IT IS A ZONE NAME AND NEVER AN OFFSET. Central is UTC-5 in July and UTC-6 in December, and
 * an offset written down today is wrong twice a year. `Intl` carries the whole rule set, so a date
 * in March and a date in November both render correctly without anyone maintaining a table.
 *
 * WHAT THIS IS NOT. It is not the timezone of a scheduled duty — `standing_duties.timezone` is a
 * per-duty column and stays that way, because a duty could legitimately run on someone else's
 * clock. This is the zone the owner READS in, which is a different fact about a different thing.
 */
import { CENTRAL, dateTimeFormat, dayOf, instantAt, wallClock, zoneOffsetMs } from "./schedule/clock.mjs";

export { dateTimeFormat, wallClock, zoneOffsetMs };
export const OWNER_TIMEZONE: string = CENTRAL;

/** How the zone is named on screen when a time needs to say which clock it is on. */
export const OWNER_TIMEZONE_LABEL = "Central";

/**
 * A date and time in the owner's zone.
 *
 * THE ZONE IS FORCED RATHER THAN INHERITED. `toLocaleString()` with no arguments renders in
 * whatever zone the browser happens to be in, which is right until she opens this on a laptop in
 * another city and every almanac time silently shifts. An astronomical instant is a fixed moment;
 * only its presentation is local, and it should be local to HER rather than to the device.
 */
/**
 * The component options Intl will NOT accept alongside dateStyle/timeStyle.
 *
 * THE BUG THIS FIXES, and it took the Spirit screen down in production on 13 Sep 2026.
 * `Intl.DateTimeFormat` THROWS — `TypeError: Invalid option : option` — when a style shortcut is
 * combined with any individual component. This function supplied `dateStyle: "medium"` and
 * `timeStyle: "short"` as defaults and then spread the caller's options over them, so the moment a
 * caller asked for something specific the two collided:
 *
 *   inOwnerZone(ts, { weekday: "long", month: "long", day: "numeric", hour: "numeric", … })
 *     → { dateStyle, timeStyle, weekday, month, day, hour, … }  → throws
 *
 * The whole page went to "The Spirit screen could not be drawn", while the API it reads was
 * returning 200 with correct data the entire time. That gap is the lesson: the endpoint was
 * verified and the RENDER was not, so every check passed while the screen was blank.
 *
 * A caller asking for components has been explicit, so the style defaults step aside. They were
 * only ever a default.
 */
const COMPONENT_OPTIONS = [
  "weekday", "era", "year", "month", "day", "dayPeriod",
  "hour", "minute", "second", "fractionalSecondDigits", "timeZoneName",
] as const;

export function inOwnerZone(ts: number | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return "—";
  const wantsComponents = COMPONENT_OPTIONS.some(
    (k) => (opts as Record<string, unknown>)[k] !== undefined,
  );
  const base: Intl.DateTimeFormatOptions = wantsComponents
    ? { timeZone: OWNER_TIMEZONE }
    : { timeZone: OWNER_TIMEZONE, dateStyle: "medium", timeStyle: "short" };
  return dateTimeFormat("en-US", { ...base, ...opts }).format(new Date(ts));
}

/** Just the date, same zone. A day boundary is a zone-dependent thing and this respects that. */
export function dayInOwnerZone(ts: number | null | undefined): string {
  return inOwnerZone(ts, { dateStyle: "medium", timeStyle: undefined });
}

/**
 * THE CONVERSION ITSELF LIVES IN schedule/clock.mjs (24 Nov 2026): the formatter cache, the zone
 * offset, the wall clock and the wall-time-to-instant rule. These names stay for their many callers.
 * `zonedTime` keeps its old argument order (zone fifth, minute last).
 */
export const zonedTime = (year: number, month: number, day: number, hour = 0, timeZone = OWNER_TIMEZONE, minute = 0): number =>
  instantAt(timeZone, year, month, day, hour, minute);

/**
 * The half-open range of a calendar month in the owner's zone: [start, end).
 *
 * THE END IS THE NEXT MONTH'S FIRST, NOT "PLUS 31 DAYS". The route this replaced added a fixed 31
 * days to the start, so every month shorter than that swept up the beginning of the next one — a
 * September view quietly containing the 1st of October, and a February view containing three days
 * of March.
 */
export function monthRange(month: string, timeZone = OWNER_TIMEZONE): { start: number; end: number } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return {
    start: zonedTime(y, m, 1, 0, timeZone),
    end: m === 12 ? zonedTime(y + 1, 1, 1, 0, timeZone) : zonedTime(y, m + 1, 1, 0, timeZone),
  };
}

/** `YYYY-MM` for the month an instant falls in, in the owner's zone rather than UTC. */
export function monthIdInZone(ts: number, timeZone = OWNER_TIMEZONE): string {
  return dayOf(ts, timeZone).slice(0, 7);
}

/** `YYYY-MM-DD` for the day an instant falls in, in the owner's zone rather than UTC (clock.mjs `dayOf`). */
export function dayIdInZone(ts: number, timeZone = OWNER_TIMEZONE): string {
  return dayOf(ts, timeZone);
}

/**
 * `YYYY-Www` — the ISO week an instant falls in, in the owner's zone rather than UTC.
 *
 * WHY THE ZONE MATTERS HERE MORE THAN ANYWHERE ELSE ON THIS FILE. Imani's practice duty fires on a
 * SUNDAY, which is the last day of an ISO week. At the scheduled 17:00 Central it is 22:00 UTC and
 * still Sunday, so the ordinary run is fine — and that is what makes this the kind of bug that
 * ships. Any run past 19:00 Central is already Monday in UTC, hence the NEXT ISO week, so a retry
 * after a failed Sunday would file the week-ahead brief under the week that had just ended, with a
 * number that looks perfectly plausible. Retries are when this happens and are precisely when
 * nobody is checking week numbers.
 *
 * ISO rather than "week starting Sunday": weeks are numbered from the Monday, and the week that
 * owns 4 January owns the year. That is the only week numbering with one definition, which is what
 * a stored identifier needs.
 */
export function weekIdInZone(ts: number, timeZone = OWNER_TIMEZONE): string {
  const w = wallClock(ts, timeZone);

  // Anchored at noon UTC on the civil date, so the arithmetic below never straddles a day boundary.
  const civil = new Date(Date.UTC(w.y, w.m - 1, w.d, 12));
  // ISO: Thursday of this week decides the year. Sunday is 0 from getUTCDay and must read as 7.
  const dow = civil.getUTCDay() || 7;
  civil.setUTCDate(civil.getUTCDate() + 4 - dow);
  const isoYear = civil.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((civil.getTime() - jan1) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
