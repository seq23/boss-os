/**
 * BOSS OS'S OWN CLOCK (21 Nov 2026, Kendra's alarm mail:morning-email).
 *
 * GitHub Actions' `schedule` event is best effort: from about 2026-11-17 20:40Z it fired this account's
 * scheduled workflows once every 6-9 hours instead of on their crons (a ten-minute job ran 11 times in
 * four days), and on 21 Nov no tick of the morning email reached 06:40-09:00 Central. GitHub stays the
 * RUNNER; the CLOCK is the Worker's five-minute Cloudflare cron, which reads this file.
 *
 * The Schedule manifest is the clock's definition: a row with `trigger.clock: "worker"` is fired by
 * a repository_dispatch of `trigger.event`, at the times its own `trigger.crons` say.
 * `CRON_TZ=America/Chicago m h dom mon dow` is read on the Central wall clock (06:40 is 06:40 in
 * summer and winter); a plain cron is read in UTC.
 *
 * A LATE OR MISSED TICK FIRES ONE CATCH-UP, NEVER A REPLAY: per job, only the LATEST due minute inside
 * the last CATCH_UP_MINUTES counts. Its key, `<id>:<YYYY-MM-DD>:<HH:MM>` (Central), is what the Worker
 * claims in D1 before it dispatches, so two ticks inside one window dispatch once. Pure.
 */

export const CATCH_UP_MINUTES = 30;

// ─── THE CENTRAL CLOCK (24 Nov 2026) ─────────────────────────────────────────────────────────────
//
// THE ONE PLACE A WALL CLOCK IS CONVERTED. Before this, Boss OS held a dozen copies of "what does the
// clock in Chicago read" and "when does it read 09:00" (timezone.ts, ownerTime.mjs, the outreach
// brakes, the free rung, duty cadence, the Spry weekly, lp-followups, schedule.mjs, eight centralDay
// copies, …), and two of them were an hour wrong on one side of a clock change. Every caller now asks
// this file; timezone.ts and ownerTime.mjs re-export these names for their many callers.
//
// ZONE NAME, NEVER AN OFFSET. Central is UTC-5 in summer and UTC-6 in winter; `Intl` carries the IANA
// rules, so no offset is ever written down here. Every function takes a zone (default Central)
// because duties and her travel days run on other clocks too.

/** Her home clock. */
export const CENTRAL = "America/Chicago";

/**
 * ONE FORMATTER PER SHAPE, KEPT. Building an `Intl.DateTimeFormat` loads locale and zone data; on the
 * Workers runtime that is tens of microseconds, and the duty calendar once built thousands per Today
 * screen (~120 ms CPU on a 10 ms plan). A formatter is immutable, so one per (locale, options) serves
 * every call.
 */
const FORMATTERS = new Map();
export function dateTimeFormat(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = FORMATTERS.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, options); FORMATTERS.set(key, f); }
  return f;
}

/** An instant in words on a zone's clock, e.g. `formatIn(ms, { weekday: "short", hour: "numeric" })`. Pure. */
export function formatIn(ms, options = {}, zone = CENTRAL) {
  return dateTimeFormat("en-US", { ...options, timeZone: zone }).format(new Date(ms));
}

/**
 * The zone's offset from UTC at an instant, in ms (Central: -6 h in winter, -5 h in summer). LOOKED UP ONCE PER QUARTER-HOUR PER ZONE: an offset only changes at
 * a transition and every zone in use moves on a quarter-hour of UTC, so one `formatToParts` answers for
 * the whole 15-minute bucket.
 */
const OFFSET_BUCKET_MS = 15 * 60_000;
const OFFSETS = new Map();
export function zoneOffsetMs(ms, zone = CENTRAL) {
  const bucket = Math.floor(ms / OFFSET_BUCKET_MS) * OFFSET_BUCKET_MS;
  const key = `${zone}|${bucket}`;
  let off = OFFSETS.get(key);
  if (off === undefined) {
    const p = {};
    for (const x of dateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(bucket))) p[x.type] = x.value;
    off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - bucket;
    if (OFFSETS.size > 20_000) OFFSETS.clear(); // a long scan of old rows never grows the isolate without bound
    OFFSETS.set(key, off);
  }
  return off;
}

/** An instant as epoch ms from a number, a Date or an ISO string (every copy this replaced took all three). */
const toMs = (t) => (typeof t === "number" ? t : new Date(t).getTime());

/** What the wall clock in `zone` reads at an instant: `{ y, m (1-12), d, h (0-23), min, dow (0 = Sunday) }`. Pure. */
export function wallClock(at, zone = CENTRAL) {
  const ms = toMs(at);
  const l = new Date(ms + zoneOffsetMs(ms, zone));
  return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate(), h: l.getUTCHours(), min: l.getUTCMinutes(), dow: l.getUTCDay() };
}

/**
 * The instant the clock in `zone` reads y-m-d h:min. Days past the month's end roll over (d = 32 is
 * the next month's 1st). The two clock-change days follow the platform's own rule (TC39 Temporal's
 * "compatible", which is also what cron and launchd do):
 *  - a time in the hour the clocks SKIP (02:30 on 8 Mar 2026 in Chicago) is the moment that far past
 *    the jump: 03:30 CDT. Never the hour before it: two copies here answered 01:30 CST, which runs a
 *    02:15 duty before a 01:45 one, and lp-followups fell back to 02:30 UTC, six hours early.
 *  - a time in the hour the clocks REPEAT (01:30 on 1 Nov 2026) is the first of its two instants.
 * Pure.
 */
export function instantAt(zone, y, m, d, h = 0, min = 0) {
  const wall = Date.UTC(y, m - 1, d, h, min);
  const before = zoneOffsetMs(wall - 86_400_000, zone);
  const after = zoneOffsetMs(wall + 86_400_000, zone);
  const fits = [wall - before, wall - after].filter((t) => wall - t === zoneOffsetMs(t, zone));
  if (fits.length) return Math.min(...fits);
  return wall - before; // the skipped hour: the offset from before the jump lands that far past it
}

const pad = (n) => String(n).padStart(2, "0");
const ymd = (w) => `${w.y}-${pad(w.m)}-${pad(w.d)}`;

/** `YYYY-MM-DD` of the day an instant falls in on that zone's clock (`days` moves it whole days). Pure. */
export function dayOf(ms, zone = CENTRAL, days = 0) {
  const w = wallClock(ms, zone);
  if (!days) return ymd(w);
  // Calendar days, never 24-hour steps: 23:30 on 7 Mar plus 24 hours is already 9 Mar in Chicago.
  return new Date(Date.UTC(w.y, w.m - 1, w.d + days)).toISOString().slice(0, 10);
}

/** The instant the day holding `ms` starts on that zone's clock (00:00 local; 23 or 25 hours long on a change day). Pure. */
export function startOfDay(ms, zone = CENTRAL) {
  const w = wallClock(ms, zone);
  return instantAt(zone, w.y, w.m, w.d);
}

/** The Monday that starts the week holding `ms` on that zone's clock, as YYYY-MM-DD. Pure. */
export function weekOf(ms, zone = CENTRAL) {
  const w = wallClock(ms, zone);
  const day = new Date(Date.UTC(w.y, w.m - 1, w.d));
  day.setUTCDate(day.getUTCDate() - ((w.dow + 6) % 7));
  return day.toISOString().slice(0, 10);
}

function fieldMatches(field, value, lo, hi) {
  for (const part of field.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS ? Number(stepS) : 1;
    let a; let b;
    if (range === "*") { a = lo; b = hi; } else { [a, b] = range.split("-").map(Number); if (b == null) b = stepS ? hi : a; }
    if (!Number.isFinite(a) || !Number.isFinite(b) || !(step > 0)) continue;
    if (value >= a && value <= b && (value - a) % step === 0) return true;
  }
  return false;
}

/** One cron (optionally `CRON_TZ=America/Chicago …`) → `{ zone, fields }`, or null when unreadable. Pure. */
export function parseCron(cron) {
  let c = String(cron ?? "").trim();
  let zone = "UTC";
  const tz = /^CRON_TZ=(\S+)\s+/.exec(c);
  if (tz) {
    if (tz[1] !== CENTRAL) return null;
    zone = CENTRAL;
    c = c.slice(tz[0].length);
  }
  const fields = c.split(/\s+/);
  return fields.length === 5 ? { zone, fields } : null;
}

/** Does this cron fire at the minute holding `ms`? Pure. */
export function cronFiresAt(cron, ms) {
  const p = parseCron(cron);
  if (!p) return false;
  const w = wallClock(ms, p.zone);
  const [mi, ho, dom, mon, dow] = p.fields;
  if (!fieldMatches(mi, w.min, 0, 59) || !fieldMatches(ho, w.h, 0, 23) || !fieldMatches(mon, w.m, 1, 12)) return false;
  const domOk = fieldMatches(dom, w.d, 1, 31);
  const dowOk = fieldMatches(dow.replace(/7/g, "0"), w.dow, 0, 6);
  // Cron's own rule: when both day fields are restricted, either one matching fires it.
  return dom !== "*" && dow !== "*" ? domOk || dowOk : domOk && dowOk;
}

/** The rows the Worker's clock fires. Pure. */
export const clockRows = (manifest, repo = "boss-os") =>
  (manifest?.rows ?? []).filter((r) => r?.trigger?.clock === "worker" && r.trigger.repo === repo);

/**
 * The jobs due now: per worker-clocked row, the latest minute in (now - CATCH_UP_MINUTES, now] that
 * one of its crons fires. `[{ id, event, file, due_at, key }]`. Pure.
 */
export function dueJobs(manifest, nowMs, { windowMinutes = CATCH_UP_MINUTES, repo = "boss-os" } = {}) {
  const top = Math.floor(nowMs / 60_000) * 60_000;
  const out = [];
  for (const r of clockRows(manifest, repo)) {
    for (let i = 0; i < windowMinutes; i++) {
      const at = top - i * 60_000;
      if (!(r.trigger.crons ?? []).some((c) => cronFiresAt(c, at))) continue;
      const w = wallClock(at, CENTRAL);
      out.push({
        id: r.id, event: r.trigger.event, file: r.trigger.file, due_at: at,
        key: `${r.id}:${ymd(w)}:${pad(w.h)}:${pad(w.min)}`,
      });
      break;
    }
  }
  return out;
}

/** A worker-clocked row that cannot be fired, by name (no event, an unreadable cron, a foreign zone). Pure. */
export function clockRowProblems(manifest, repo = "boss-os") {
  const out = [];
  for (const r of clockRows(manifest, repo)) {
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(r.trigger.event ?? "")) out.push(`${r.id}: a worker-clocked row needs trigger.event, the repository_dispatch type its workflow listens for`);
    for (const c of r.trigger.crons ?? []) {
      const p = parseCron(c);
      if (!p) out.push(`${r.id}: cron "${c}" cannot be read by Boss OS's clock (five fields, UTC or CRON_TZ=America/Chicago)`);
      // The Worker fires a minute the Central clock READS; on the spring day it never reads 02:00-02:59,
      // so a job set inside that hour would silently miss a day. Every-hour crons only lose one tick.
      else if (p.zone === CENTRAL && p.fields[1] !== "*" && fieldMatches(p.fields[1], 2, 0, 23)) out.push(`${r.id}: cron "${c}" runs in the 02:00 Central hour, which the spring clock change skips; pick another hour`);
    }
  }
  return out;
}

const DAY_WORDS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const clock12 = (hhmm) => {
  const [h = 0, m = 0] = String(hhmm).split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

/** One Schedule slot in plain words (Central): "Mon & Fri 8:00 am", "Every day 6:15 am", "Every 5 minutes". Pure. */
export function slotWords(slot) {
  if (slot === "always") return "Always on";
  let m = /^every (\d+)([sm])$/.exec(slot);
  if (m) { const mins = m[2] === "s" ? Math.round(Number(m[1]) / 60) : Number(m[1]); return mins <= 1 ? "Every minute" : `Every ${mins} minutes`; }
  m = /^hourly :(\d\d)$/.exec(slot);
  if (m) return `Every hour at :${m[1]}`;
  m = /^(\S+) (\d\d:\d\d)(?:-(\d\d:\d\d)\/(\d+)m)?$/.exec(slot);
  if (!m) return slot;
  const [, d = "", start = "00:00", end, step] = m;
  const days = d === "daily" ? "Every day"
    : d === "mon,tue,wed,thu,fri" ? "Weekdays"
    : d.startsWith("day") ? `Monthly, the ${d.split(",").map((x) => x.slice(3)).join(" & ")}`
    : d.split(",").map((x) => DAY_WORDS[x] ?? x).join(" & ");
  return end ? `${days}, every ${step} min, ${clock12(start)}–${clock12(end)}` : `${days} ${clock12(start)}`;
}

const MONTH_WORDS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * The next instant at or after `nowMs` that a "<days> HH:MM" Schedule slot fires (Central wall clock,
 * so a clock change moves the instant, never the 10:15 pm), or null for a slot that is not a plain
 * day-and-time ("always", "every 5m", ranges). A slot in the hour the clocks skip (02:30 on the spring
 * day) runs that day, just after the jump (launchd and cron both do); it used to read as the next day.
 * Pure.
 */
export function nextSlotAt(slot, nowMs) {
  const m = /^(\S+) (\d\d):(\d\d)$/.exec(String(slot));
  if (!m || !Number.isFinite(nowMs)) return null;
  const [, d = "", hh = "0", mm = "0"] = m;
  const days = d === "daily" ? DOW_KEYS : d === "mon,tue,wed,thu,fri" ? DOW_KEYS.slice(1, 6) : d.split(",");
  if (!days.every((x) => DOW_KEYS.includes(x))) return null;
  const today = wallClock(nowMs);
  for (let i = 0; i <= 8; i++) {
    // Walk civil dates (noon UTC never straddles a day), so a 23- or 25-hour day is never skipped or repeated.
    const civil = new Date(Date.UTC(today.y, today.m - 1, today.d + i, 12));
    if (!days.includes(DOW_KEYS[civil.getUTCDay()])) continue;
    const at = instantAt(CENTRAL, civil.getUTCFullYear(), civil.getUTCMonth() + 1, civil.getUTCDate(), Number(hh), Number(mm));
    if (at >= nowMs) return at;
  }
  return null;
}

/** When the next of a job's slots fires, in her words: "Sun 29 Nov, 10:15 pm CT"; null when none can be dated. Pure. */
export function nextRunWords(slots, nowMs) {
  const next = (slots ?? []).map((s) => nextSlotAt(s, nowMs)).filter((v) => v !== null).sort((a, b) => a - b)[0];
  if (next == null) return null;
  const w = wallClock(next);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][w.dow]} ${w.d} ${MONTH_WORDS[w.m - 1]}, ${clock12(`${w.h}:${w.min}`)} CT`;
}

// ─── THE MAC'S DAY (her ruling 21 Nov 2026, Central, every day) ──────────────────────────────────
//
// THE ONE DEFINITION of when her Mac looks for work (27 Nov 2026, Camille's briefing late for the
// morning email). It was written four times — the Schedule's classes, an hour guard inside
// agent-claim.sh (06:00-22:00), POLL_WINDOW in alarms/rules.mjs (also 06:00-22:00) and the sentence
// Today shows her — and since 21 Nov none of them agreed: the poll's row said LIGHT (10:00-21:59), so
// the five-minute safety net could not run at 04:00, when the briefing comes due, and Kendra's
// parked-run alarm could not count a wait before 06:00. Every reader now asks this table:
// plist-central.mjs (the classes mac-window is given), mac-day-check.mjs (the plists proven against
// it), the alarm's hours and Today's sentence. seq-bin's `mac-window` enforces the same table at run
// time; validate:agent-poll holds the poll's class to the hour the briefing duty is due.
//
// Minutes of the Central day, half-open [from, to). HEAVY may start until 06:30 and is stopped at
// 06:55, so a slot AT 06:55 is still inside it.
export const MAC_REST = Object.freeze([7 * 60, 10 * 60]);
export const MAC_WINDOWS = Object.freeze({
  HEAVY: Object.freeze([Object.freeze([22 * 60, 24 * 60]), Object.freeze([0, 6 * 60 + 56])]),
  MORNING: Object.freeze([Object.freeze([0, MAC_REST[0]]), Object.freeze([MAC_REST[1], 24 * 60])]),
  LIGHT: Object.freeze([Object.freeze([MAC_REST[1], 22 * 60])]),
  ANY: Object.freeze([Object.freeze([0, MAC_REST[0]]), Object.freeze([MAC_REST[1], 24 * 60])]),
});
/** Every morning job is done by 06:30 with twice its worst runtime to spare. */
export const MORNING_DONE = 6 * 60 + 30;
/**
 * The five-minute poll's class (`com.seq.boss-agent-poll`): an any-hour claimer, so a run parked at
 * 04:00 is claimed at 04:05, never at 10:15. The Schedule row must say the same (validate:agent-poll).
 */
export const MAC_POLL_CLASS = "ANY";

/** Does her Mac run a job of class `cls` at minute `mins` of the Central day? Unknown class: no. Pure. */
export function macLooksAt(cls, mins) {
  const w = MAC_WINDOWS[cls];
  if (!w) return false;
  const m = ((Math.floor(Number(mins)) % 1440) + 1440) % 1440;
  return w.some(([a, b]) => m >= a && m < b);
}

/** A class's hours in words, last minute inclusive: "10:00 to 21:59", "22:00 to 06:55", "at any hour but 07:00 to 10:00". Pure. */
export function macWindowWords(cls) {
  const w = MAC_WINDOWS[cls];
  if (!w) return "never";
  const t = (m) => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;
  if (w.length === 2 && w[0][0] === 0 && w[1][1] === 1440) return `at any hour but ${t(w[0][1])} to ${t(w[1][0])}`;
  if (w.length === 2 && w[0][1] === 1440 && w[1][0] === 0) return `${t(w[0][0])} to ${t(w[1][1] - 1)}`;
  return w.map(([a, b]) => `${t(a)} to ${t(b - 1)}`).join(" and ");
}
