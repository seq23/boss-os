/**
 * ONE WAY TO SAY A TIME, A DAY AND A PRICE ON THE TEAM → DUTIES AND EMAIL MAP SCREENS.
 *
 * Ship review of #591 (27 Nov 2026, three FAILs): Team printed "next Nov 28, 06:40 AM" (no zone)
 * beside the Email Map's "06:40 … Central", a last result in UTC, "Mon/Tue/Wed/Thu/Fri at 10:40"
 * beside "Weekdays 10:40 AM", and "$1.5/mo" beside "$0.22/mo". Every one of those strings now comes
 * from here, so the two pages cannot drift apart again. Pinned by tests/dutiesAndMapWords.test.ts.
 */
import { OWNER_TIMEZONE, OWNER_TIMEZONE_LABEL, dateTimeFormat } from "./timezone";

/** "6:40 AM": the one clock (12-hour). The zone is said by the caller, once per line. */
export function centralClock(hour: number, minute: number): string {
  const h = ((Number(hour) + 11) % 12) + 1;
  return `${h}:${String(minute).padStart(2, "0")} ${Number(hour) < 12 ? "AM" : "PM"}`;
}

/** "Sun, Nov 29, 6:40 AM Central": an instant on her clock, whatever the device's zone. */
export function centralStamp(ms: number): string {
  return `${dateTimeFormat("en-US", { timeZone: OWNER_TIMEZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms))} ${OWNER_TIMEZONE_LABEL}`;
}

/** "$1.50": money always with cents. A value that is not a number is said, never printed as "$NaN". */
export function dollars(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "not known";
  return `$${n.toFixed(2)}`;
}

/** A 24-hour "10:40" in a line of prose, as the one 12-hour clock ("10:40 AM"); "6:40 AM" is left as it is. */
export function twelveHourTimes(text: string): string {
  return text.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s?(?:AM|PM|am|pm))/g, (_m, h: string, mi: string) => centralClock(Number(h), Number(mi)));
}

/** True when every clock time in a line is the one 12-hour clock, and a line with a time names Central. */
export function inOneClock(text: string): boolean {
  if (/\b\d{1,2}:\d{2}\b(?!\s?(AM|PM))/.test(text)) return false;
  return !/\d:\d\d/.test(text) || /Central/.test(text);
}

/** A name that starts a "From … · to …" clause reads mid-sentence: "From the site", not "From The site". */
export function inLine(name: string): string {
  return name.replace(/^(The|A|An) /, (w) => w.toLowerCase());
}

const DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A duty's schedule in the Email Map's words: "Daily at 7:00 AM Central", "Weekdays at …", "Fridays at …".
 * A duty kept on another zone's clock carries `central_clock` (the roster's `centralClockOf`): its hour
 * on her clock and how many days that moves it, so midnight New York reads "11:00 PM Central" the day before.
 */
export function dutyWhen(d: {
  cadence: string; weekday?: number | null; weekdays?: string | number[] | null; local_hour: number; local_minute: number;
  central_clock?: { hour: number; minute: number; day_shift: number } | null;
}): string {
  const c = d.central_clock ?? { hour: d.local_hour, minute: d.local_minute, day_shift: 0 };
  const move = (n: number) => (n + c.day_shift + 7) % 7;
  const t = `${centralClock(c.hour, c.minute)} ${OWNER_TIMEZONE_LABEL}`;
  if (d.cadence === "weekly") return `${DAY_NAMES[move(d.weekday ?? 1)]} at ${t}`;
  if (d.cadence === "monthly") return `${c.day_shift < 0 ? "The last day" : c.day_shift > 0 ? "The 2nd" : "The 1st"} of each month at ${t}`;
  let days: number[] = [];
  if (Array.isArray(d.weekdays)) days = d.weekdays;
  else { try { days = JSON.parse(d.weekdays ?? "null") ?? []; } catch { days = []; } }
  days = [...new Set(days)].filter((n) => n >= 0 && n <= 6).map(move).sort((a, b) => a - b);
  if (days.length === 0 || days.length === 7) return `Daily at ${t}`;
  if (days.join(",") === "1,2,3,4,5") return `Weekdays at ${t}`;
  if (days.length === 1) return `${DAY_NAMES[days[0]!]} at ${t}`;
  const names = days.map((n) => DAY_SHORT[n]!);
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} at ${t}`;
}
