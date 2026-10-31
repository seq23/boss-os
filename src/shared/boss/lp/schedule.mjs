/**
 * LP SCHEDULING, ONE TAP (owner, 31 Oct 2026). THE PURE HALF.
 *
 * When an LP writes back warmly about meeting ("happy to chat, when works?", "let's find a time"),
 * Monique holds Sequoia's reply in that LP's own Gmail thread offering 2–3 concrete times from her
 * calendar; it goes from the mailbox they wrote to ONLY when she taps "Send as is" (or changes it and
 * taps once more). When the LP picks one of those times, the reply held is a short confirmation, and
 * the same tap sends the calendar invite (src/worker/boss/lp/schedule.ts).
 *
 *   her zone, per day  the "where I am until <date>" setting (`food_away_city` / `food_away_until`,
 *                      the same one the food row reads) while the day is on or before that date,
 *                      else the zone her Google Calendar is set to. Never a zone written into code
 *                      as "where she is". An away city whose zone is not known offers NO time that
 *                      day: fail closed, never a guess.
 *   her working hours  WORK_DAY, in that day's zone. Every offered slot starts and ends inside it.
 *   her calendars      busy time from BOTH Workspace calendars, merged once (`mergeBusy`), so a
 *                      meeting on both is one block and never counted twice.
 *
 * NO MODEL WRITES ANY OF IT. The words are fixed templates filled in code (first name, times), so an
 * LP's name or terms never reach a route. A model draft of LP content is Claude-seat only and the
 * Worker's router refuses it outright (`confidentialDraftRefusal`, router/index.ts).
 *
 * NO NAMES LIVE HERE. Tests use invented names at example.com.
 */
import { firstName } from "./plan.mjs";

const DAY = 86_400_000;

/** Her working day, in whichever zone she is in that day. Slots are offered only inside it. */
export const WORK_DAY = Object.freeze({ start: [9, 30], end: [17, 0] });
/** The local start times tried each working day, in order. All inside WORK_DAY. */
export const SLOT_STARTS = Object.freeze([[10, 0], [11, 30], [14, 0]]);
export const SLOT_MINUTES = 30;
/** Never offer a time sooner than this many working days out (she needs room to prepare). */
export const MIN_WORKDAYS_OUT = 2;
export const MAX_SLOTS = 3;
export const MIN_SLOTS = 2;

/** The cities she travels to, by the key `cityKey` gives, and their zone. Unknown → no slot that day. */
export const ZONE_BY_CITY = Object.freeze({
  "new york": "America/New_York", brooklyn: "America/New_York", boston: "America/New_York", washington: "America/New_York",
  miami: "America/New_York", atlanta: "America/New_York", philadelphia: "America/New_York",
  chicago: "America/Chicago", memphis: "America/Chicago", nashville: "America/Chicago", dallas: "America/Chicago",
  houston: "America/Chicago", austin: "America/Chicago", "new orleans": "America/Chicago",
  denver: "America/Denver", phoenix: "America/Phoenix", "las vegas": "America/Los_Angeles",
  "los angeles": "America/Los_Angeles", "san francisco": "America/Los_Angeles", seattle: "America/Los_Angeles",
  london: "Europe/London", paris: "Europe/Paris",
});

const ZONE_LABEL = Object.freeze({
  "America/New_York": "Eastern", "America/Chicago": "Central", "America/Denver": "Mountain", "America/Phoenix": "Arizona",
  "America/Los_Angeles": "Pacific", "Europe/London": "London", "Europe/Paris": "Paris",
});
export const zoneLabel = (zone) => ZONE_LABEL[zone] ?? String(zone ?? "").split("/").pop()?.replace(/_/g, " ") ?? "";

/** "New York, NY" → "new york"; "NYC" → "new york". */
export function cityKey(city) {
  const c = String(city ?? "").toLowerCase().split(",")[0].trim().replace(/\s+city$/, "").replace(/^nyc$/, "new york");
  return c || null;
}

/** True when Intl knows the zone. */
export function validZone(zone) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: String(zone) }); return Boolean(zone); } catch { return false; }
}

/**
 * Her zone on a given day (YYYY-MM-DD in that zone's terms is close enough: the away date is a whole
 * day). Returns null when the day's zone cannot be known — no slot is offered on such a day.
 */
export function zoneResolver({ awayCity = null, awayUntil = null, homeZone = null } = {}) {
  const away = awayCity && awayUntil ? ZONE_BY_CITY[cityKey(awayCity)] ?? null : null;
  const home = validZone(homeZone) ? homeZone : null;
  return (ymd) => {
    if (awayCity && awayUntil && ymd <= awayUntil) return away; // away, and an unknown city fails closed
    return home;
  };
}

/** Wall-clock parts of an instant in a zone. */
export function wall(t, zone) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

/** The instant of a wall-clock time on a date in a zone (DST-safe: searched, never an offset table). */
export function instantIn(zone, ymd, hour, minute) {
  const guess = Date.parse(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  for (let off = -14; off <= 14; off += 0.5) {
    const t = guess + off * 3600_000;
    const w = wall(t, zone);
    if (w.ymd === ymd && w.hour === hour && w.minute === minute) return t;
  }
  return null;
}

/** Busy intervals from several calendars as one sorted, non-overlapping list: a shared meeting counts once. */
export function mergeBusy(lists) {
  const all = (lists ?? []).flat().filter((b) => Array.isArray(b) && Number.isFinite(b[0]) && Number.isFinite(b[1]) && b[1] > b[0])
    .map(([s, e]) => [s, e]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const b of all) {
    const last = out[out.length - 1];
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]);
    else out.push(b);
  }
  return out;
}

const inside = (h, m, [sh, sm], [eh, em]) => h * 60 + m >= sh * 60 + sm && h * 60 + m <= eh * 60 + em;

/** True when [t, t + minutes) sits inside her working day in that day's zone. */
export function inWorkingHours(t, zone, minutes = SLOT_MINUTES) {
  if (!zone) return false;
  const s = wall(t, zone);
  const e = wall(t + minutes * 60_000, zone);
  if (s.weekday === "Sat" || s.weekday === "Sun" || s.ymd !== e.ymd) return false;
  return inside(s.hour, s.minute, WORK_DAY.start, WORK_DAY.end) && inside(e.hour, e.minute, WORK_DAY.start, WORK_DAY.end);
}

/**
 * Up to MAX_SLOTS open slots, each on a different weekday, from MIN_WORKDAYS_OUT working days out,
 * at SLOT_STARTS in HER zone for that day. `busy` is [[start, end]] in ms, already merged. Returns
 * [{ start, zone }]. Fewer than MIN_SLOTS is returned as [] — a reply offers 2–3 times or none.
 */
export function openSlots(busy, { now = Date.now(), zoneOn, want = MAX_SLOTS, minutes = SLOT_MINUTES } = {}) {
  if (typeof zoneOn !== "function") return [];
  const out = [];
  let workdays = 0;
  for (let d = 1; d <= 21 && out.length < want; d += 1) {
    // The calendar day d days out, read in UTC noon terms so a date is a date whatever the zone.
    const ymd = new Date(now + d * DAY).toISOString().slice(0, 10);
    const zone = zoneOn(ymd);
    const probe = zone ? wall(Date.parse(`${ymd}T17:00:00Z`), zone) : wall(Date.parse(`${ymd}T17:00:00Z`), "UTC");
    if (probe.weekday === "Sat" || probe.weekday === "Sun") continue;
    workdays += 1;
    if (workdays < MIN_WORKDAYS_OUT || !zone) continue;
    for (const [h, m] of SLOT_STARTS) {
      const s = instantIn(zone, ymd, h, m);
      if (s == null || s <= now) continue;
      const e = s + minutes * 60_000;
      if (!inWorkingHours(s, zone, minutes)) continue;
      if ((busy ?? []).some(([bs, be]) => bs < e && be > s)) continue;
      out.push({ start: s, zone });
      break; // one slot per day
    }
  }
  return out.length >= MIN_SLOTS ? out : [];
}

/** "Tuesday, November 3 at 11:30 AM Eastern". */
export function slotText(slot) {
  const d = new Date(slot.start);
  const day = d.toLocaleDateString("en-US", { timeZone: slot.zone, weekday: "long", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: slot.zone, hour: "numeric", minute: "2-digit" });
  return `${day} at ${time} ${zoneLabel(slot.zone)}`;
}

/* ─── What they wrote ───────────────────────────────────────────────────── */

const NO = /\b(?:not interested|no thanks|no thank you|not a fit|not the right time|not at this time|unsubscribe|remove me|please stop|pass on this|we(?:'ll| will) pass|decline)\b/i;
const MEET = [
  /\b(?:happy|glad|delighted|keen|would love|i'?d love|we'?d love|love|open|available) to (?:chat|talk|connect|speak|meet|catch up|jump on|hop on|set up|find)\b/i,
  /\bwhen (?:works|suits|would work|might work|is good|are you (?:free|available)|is convenient)\b/i,
  /\b(?:let'?s|let us|can we|could we|shall we) (?:find|set up|schedule|grab|get|book|arrange|put) (?:a |some )?(?:time|call|chat|meeting|something|a slot)\b/i,
  /\bfind (?:a )?time\b/i,
  /\bwhat (?:times?|days?|slots?) (?:work|suit|are good)\b/i,
  /\bsend (?:me |over |us )?(?:some|a few|a couple of|your) (?:times|slots|availability|options)\b/i,
  /\b(?:your|some) availability\b/i,
  /\bschedule (?:a |some )?(?:call|chat|time|meeting)\b/i,
  /\b(?:a |quick )?call (?:sounds|would be) (?:good|great|fine)\b/i,
  /\b(?:may|might|could|should|would|will) work\b/i,                  // "November may work"
  /\bwould (?:\w+ ){1,2}work\b/i,                                       // "would Tuesday work?"
  /\b(?:here (?:is|are) (?:my|our|his|her|\w+[’']s) )?(?:earliest )?availability\b/i,
];

/** Pure: did they write back warmly about meeting? A "no" anywhere wins. */
export function wantsToMeet(text) {
  const t = String(text ?? "");
  if (!t.trim() || NO.test(t)) return false;
  return MEET.some((re) => re.test(t));
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const REFUSE = /\b(?:does(?:n'?t| not)|do(?:n'?t| not)|can(?:'?t|not)|won'?t|will not|unable|not) (?:work|suit|make it|do)\b/i;
const TIME_RE = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d/])/gi;

/** The hours (0–23) and minutes a message names as times ("11:30", "2pm", "10 am"). */
function timesIn(text) {
  const out = [];
  for (const m of String(text).matchAll(TIME_RE)) {
    const [, hs, ms, ap] = m;
    if (!ms && !ap) continue; // a bare number is a date or a count, never a time
    let h = Number(hs);
    const min = Number(ms ?? 0);
    if (h > 23 || min > 59) continue;
    if (ap && /p/i.test(ap) && h < 12) h += 12;
    if (ap && /a/i.test(ap) && h === 12) h = 0;
    out.push({ h, min, ampm: Boolean(ap) });
  }
  return out;
}

/**
 * Pure: the ONE offered slot their words pick, or null. Their message must name that slot's day
 * (weekday or date) and no other offered day; a time they name must be that slot's time; and a
 * "doesn't work" is never a pick. Anything less certain is left to her own words.
 */
export function pickedSlot(text, offered) {
  const t = String(text ?? "").toLowerCase();
  const slots = (offered ?? []).filter((s) => s && Number.isFinite(s.start) && validZone(s.zone));
  if (!t.trim() || !slots.length || REFUSE.test(t) || NO.test(t)) return null;
  const named = slots.filter((s) => {
    const wd = DAYS[["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wall(s.start, s.zone).weekday)];
    const [, mo, da] = wall(s.start, s.zone).ymd.split("-").map(Number);
    const month = MONTHS[mo - 1];
    return new RegExp(`\\b(?:${wd}|${wd.slice(0, 3)}|${wd.slice(0, 3)}\\.)\\b`).test(t)
      || new RegExp(`\\b(?:${month}|${month.slice(0, 3)}\\.?)\\s+${da}(?:st|nd|rd|th)?\\b`).test(t)
      || new RegExp(`\\b${da}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${month}|${month.slice(0, 3)})\\b`).test(t)
      || new RegExp(`\\b${mo}/${da}\\b`).test(t);
  });
  if (named.length !== 1) return null;
  const slot = named[0];
  const w = wall(slot.start, slot.zone);
  const times = timesIn(t);
  if (times.length && !times.every((x) => x.min === w.minute && (x.h === w.hour || (!x.ampm && x.h + 12 === w.hour)))) return null;
  return slot;
}

/* ─── Times THEY proposed ("Here is my availability (PT): 11/3 – 10 am …") ─── */

const THEIR_ZONE = [
  [/\b(?:PT|PST|PDT|pacific)\b/i, "America/Los_Angeles"],
  [/\b(?:MT|MST|MDT|mountain)\b/i, "America/Denver"],
  [/\b(?:CT|CST|CDT|central)\b/i, "America/Chicago"],
  [/\b(?:ET|EST|EDT|eastern)\b/i, "America/New_York"],
  [/\b(?:GMT|BST|UK time|london time)\b/i, "Europe/London"],
];
const DATE_RE = new RegExp(`\\b(?:(\\d{1,2})/(\\d{1,2})|(${MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join("|")})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?)\\b`, "gi");

/**
 * Pure: the times an LP proposed, as instants. Only with a stated time zone (no zone, no guess — fail
 * closed) and an explicit date (M/D or "November 3"); every time after a date belongs to it until the
 * next date. The year is the next one on or after `now`'s.
 */
export function proposedTimes(text, now = Date.now()) {
  const t = String(text ?? "");
  const zone = THEIR_ZONE.find(([re]) => re.test(t))?.[1] ?? null;
  if (!zone || REFUSE.test(t) || NO.test(t)) return [];
  const dates = [...t.matchAll(DATE_RE)];
  const out = [];
  dates.forEach((d, i) => {
    const mo = d[1] ? Number(d[1]) : MONTHS.findIndex((m) => m.startsWith(String(d[3]).toLowerCase().slice(0, 3))) + 1;
    const da = Number(d[2] ?? d[4]);
    if (!(mo >= 1 && mo <= 12 && da >= 1 && da <= 31)) return;
    const seg = t.slice(d.index + d[0].length, dates[i + 1]?.index ?? t.length);
    const thisYear = Number(new Date(now).toISOString().slice(0, 4));
    for (const y of [thisYear, thisYear + 1]) {
      const ymd = `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
      const noon = instantIn(zone, ymd, 12, 0);
      if (noon == null || noon < now - DAY) continue;
      for (const x of timesIn(seg)) {
        const s = instantIn(zone, ymd, x.ampm ? x.h : x.h < 8 ? x.h + 12 : x.h, x.min);
        if (s != null) out.push({ start: s, zone });
      }
      break;
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Pure: the earliest time they proposed that suits her — ahead by at least `leadMs`, inside her
 * working hours in the zone she is in that day, and free on both calendars. `{ start, zone, theirs }`
 * with `zone` hers (the card) and `theirs` theirs (the reply), or null.
 */
export function proposedFit(text, { busy, zoneOn, now = Date.now(), leadMs = 3 * 3600_000, minutes = SLOT_MINUTES } = {}) {
  if (!busy || typeof zoneOn !== "function") return null;
  for (const p of proposedTimes(text, now)) {
    if (p.start < now + leadMs) continue;
    const mine = zoneOn(wall(p.start, "America/Chicago").ymd);
    if (!mine || !inWorkingHours(p.start, mine, minutes)) continue;
    if (busy.some(([bs, be]) => bs < p.start + minutes * 60_000 && be > p.start)) continue;
    return { start: p.start, zone: mine, theirs: p.zone };
  }
  return null;
}

/* ─── The words, fixed templates ────────────────────────────────────────── */

/** The reply offering times. Her voice: short, warm, "we", the times in her own zone. */
export function lpTimesBody({ name, slots }) {
  return [
    `Hi ${firstName(name)},`,
    "",
    "Wonderful, thank you. Any of these would work on my side for a short call:",
    ...slots.map((s) => `- ${slotText(s)}`),
    "",
    "If none of those suits, send me a couple of times that do and we'll make it work.",
    "",
    "Best,",
    "Sequoia",
  ].join("\n");
}

/** The reply when they picked one of her times. The same tap sends the invite. */
export function lpConfirmBody({ name, slot }) {
  // A time they proposed is said back on THEIR clock ("10:00 AM Pacific"); one of hers on hers.
  const said = slot.theirs && slot.theirs !== slot.zone ? { start: slot.start, zone: slot.theirs } : slot;
  return [
    `Hi ${firstName(name)},`,
    "",
    `${slotText(said)} is perfect. I'm sending a calendar invite with a video link now.`,
    "",
    "Looking forward to it.",
    "",
    "Best,",
    "Sequoia",
  ].join("\n");
}

/** The calendar invite's title and length. No LP name: the guest list says who. */
export const INVITE_TITLE = "Sequoia Taylor / West Peek Ventures";
export const INVITE_MINUTES = SLOT_MINUTES;

/** The stored offered slots, parsed and checked, or []. */
export function slotsFrom(json) {
  try {
    const v = typeof json === "string" ? JSON.parse(json) : json;
    return Array.isArray(v) ? v.filter((s) => s && Number.isFinite(Number(s.start)) && validZone(s.zone)).map((s) => ({ start: Number(s.start), zone: String(s.zone) })) : [];
  } catch { return []; }
}
