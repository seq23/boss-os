/**
 * TIMES SHE READS, IN THE ZONE HER MAC IS ON (owner rule, 1 Nov 2026: "i will defer to you on
 * timezones"; fixed 6 Nov 2026). Jobs are defined in Central. A time shown to her — in an email from
 * Simone, the morning email, a briefing stamp, the Today page — is in her CURRENT zone, with Central in
 * brackets when that is different: "9:00 AM ET (8:00 AM CT)"; at home just "8:00 AM CT".
 *
 * Her current zone is the Boss OS setting `owner_timezone`, written by her Mac
 * (scripts/ops/owner-zone.mjs, run by tz-watch within the hour of a zone change). Unset or unreadable
 * → Central, never a guess (it was hard-coded Eastern in places until 6 Nov 2026).
 *
 * Pure; shared by the Worker and the Mac scripts. The one place a zone word or bracket is built.
 */
export const HOME_TZ = "America/Chicago";
export const OWNER_TZ_KEY = "owner_timezone";

const ZONE_WORDS = { "America/New_York": "ET", "America/Detroit": "ET", "America/Chicago": "CT", "America/Denver": "MT", "America/Phoenix": "MT", "America/Los_Angeles": "PT", "Pacific/Honolulu": "HT", "America/Anchorage": "AKT" };

/** A valid IANA zone name, or null. */
export function validZone(tz) {
  if (typeof tz !== "string" || !tz.trim() || tz.length > 64) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() }); return tz.trim(); } catch { return null; }
}

/** Her zone: the setting when it is a real zone, else Central. */
export const ownerZone = (tz) => validZone(tz) ?? HOME_TZ;

/** "CT", "ET", or the zone's own short name ("GMT+1") for anywhere else. */
export function zoneWord(tz, at = Date.now()) {
  if (ZONE_WORDS[tz]) return ZONE_WORDS[tz];
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(at)).find((x) => x.type === "timeZoneName")?.value ?? tz;
  } catch { return tz; }
}

// One formatter per zone, kept: constructing one costs real CPU on the Worker (timezone.ts).
const WALL = new Map();
/** The wall clock in a zone: { hour 0-23, minute }. */
export function wall(at, tz) {
  let f = WALL.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hourCycle: "h23" }); WALL.set(tz, f); }
  const p = f.formatToParts(new Date(at));
  const g = (t) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { hour: g("hour") % 24, minute: g("minute") };
}

/** "9:00 AM": the default clock. A sender with its own style passes `clock(hour, minute)`. */
export const fullClock = (h, m) => `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;

/**
 * "9:00 AM ET (8:00 AM CT)" in her zone with Central in brackets when the clocks differ;
 * "8:00 AM CT" when she is on Central (or her zone is unset).
 */
export function ownerTime(at, { tz = null, clock = fullClock } = {}) {
  const z = ownerZone(tz);
  const here = wall(at, z);
  const text = `${clock(here.hour, here.minute)} ${zoneWord(z, at)}`;
  if (z === HOME_TZ) return text;
  const home = wall(at, HOME_TZ);
  if (home.hour === here.hour && home.minute === here.minute && zoneWord(z, at) === zoneWord(HOME_TZ, at)) return text;
  return `${text} (${clock(home.hour, home.minute)} ${zoneWord(HOME_TZ, at)})`;
}
