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
export const OWNER_TIMEZONE = "America/Chicago";

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
export function inOwnerZone(ts: number | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: OWNER_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
    ...opts,
  }).format(new Date(ts));
}

/** Just the date, same zone. A day boundary is a zone-dependent thing and this respects that. */
export function dayInOwnerZone(ts: number | null | undefined): string {
  return inOwnerZone(ts, { dateStyle: "medium", timeStyle: undefined });
}

/**
 * The zone's UTC offset at a given instant, in milliseconds.
 *
 * Derived by asking `Intl` what the wall clock reads there and comparing — which is the only way to
 * get it right across a DST boundary without shipping a table of transition dates that goes stale.
 */
export function zoneOffsetMs(ts: number, timeZone = OWNER_TIMEZONE): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asIfUtc - ts;
}

/**
 * The UTC instant of a wall-clock moment in the owner's zone.
 *
 * TWO PASSES, NOT ONE. The offset depends on the instant, and the instant is what is being solved
 * for — so a single subtraction lands in the wrong hour on the two days a year the clocks move. The
 * second pass re-reads the offset at the corrected guess and settles it.
 */
export function zonedTime(
  year: number, month: number, day: number, hour = 0, timeZone = OWNER_TIMEZONE, minute = 0,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - zoneOffsetMs(wall, timeZone);
  return wall - zoneOffsetMs(first, timeZone);
}

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
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" })
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}`;
}

/** `YYYY-MM-DD` for the day an instant falls in, in the owner's zone rather than UTC. */
export function dayIdInZone(ts: number, timeZone = OWNER_TIMEZONE): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}`;
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
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  // Anchored at noon UTC on the civil date, so the arithmetic below never straddles a day boundary.
  const civil = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12));
  // ISO: Thursday of this week decides the year. Sunday is 0 from getUTCDay and must read as 7.
  const dow = civil.getUTCDay() || 7;
  civil.setUTCDate(civil.getUTCDate() + 4 - dow);
  const isoYear = civil.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((civil.getTime() - jan1) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
