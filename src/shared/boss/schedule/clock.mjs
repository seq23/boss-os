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
const CENTRAL = "America/Chicago";

/** The wall-clock parts of one instant in a zone ("UTC" or America/Chicago). Pure. */
export function wallParts(ms, zone = CENTRAL) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return { year: Number(g("year")), month: Number(g("month")), day: Number(g("day")), hour: Number(g("hour")), minute: Number(g("minute")), dow };
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
  const w = wallParts(ms, p.zone);
  const [mi, ho, dom, mon, dow] = p.fields;
  if (!fieldMatches(mi, w.minute, 0, 59) || !fieldMatches(ho, w.hour, 0, 23) || !fieldMatches(mon, w.month, 1, 12)) return false;
  const domOk = fieldMatches(dom, w.day, 1, 31);
  const dowOk = fieldMatches(dow.replace(/7/g, "0"), w.dow, 0, 6);
  // Cron's own rule: when both day fields are restricted, either one matching fires it.
  return dom !== "*" && dow !== "*" ? domOk || dowOk : domOk && dowOk;
}

/** The rows the Worker's clock fires. Pure. */
export const clockRows = (manifest, repo = "boss-os") =>
  (manifest?.rows ?? []).filter((r) => r?.trigger?.clock === "worker" && r.trigger.repo === repo);

const pad = (n) => String(n).padStart(2, "0");

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
      const w = wallParts(at, CENTRAL);
      out.push({
        id: r.id, event: r.trigger.event, file: r.trigger.file, due_at: at,
        key: `${r.id}:${w.year}-${pad(w.month)}-${pad(w.day)}:${pad(w.hour)}:${pad(w.minute)}`,
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
    for (const c of r.trigger.crons ?? []) if (!parseCron(c)) out.push(`${r.id}: cron "${c}" cannot be read by Boss OS's clock (five fields, UTC or CRON_TZ=America/Chicago)`);
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
