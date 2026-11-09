/**
 * KENDRA'S ALARMS — THE PURE RULES (owner, 5 Nov 2026: stop "green but did nothing").
 *
 * Why, in the cases that cost us:
 *   - P&P corporate outreach ran green 2-5 Nov and sent 0 emails ("LIVE: 0 sent, 0 planned").
 *   - Wynn's owner emails failed 236 times 2-6 Nov (Resend HTTP 401) and nobody was told.
 *   - The DNA research task read "running" for hours on a spent seat.
 *
 * Shared by the Worker (src/worker/boss/alarms/kendra.ts, the hourly tick) and her Mac
 * (scripts/ops/owner-mail-watch.mjs), so "low", "stale" and "failing" are one rule in one place.
 * No node imports: the Worker bundles this file.
 *
 * Every alarm belongs to Kendra (emp_continuity, Systems). It reaches her Today screen only when
 * she alone can fix it (`hers`), e.g. a credential only she holds.
 */

export const KENDRA = "emp_continuity";
export const DEFAULT_OUTPUT_RUNS = 2;

// ─── A. The census line ─────────────────────────────────────────────────────────────────────

/** `OUTPUT <n> <metric>`, on its own line. The last one printed wins. */
const OUTPUT_RE = /^OUTPUT (\d{1,9}) ([^\n]{1,80})$/;

/**
 * Reads the job's census line out of what it printed. `null` when there is none: no line means the
 * output is UNKNOWN, and unknown counts as below the floor. Pure.
 */
export function parseOutputLine(text) {
  let found = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const m = OUTPUT_RE.exec(raw.trim());
    if (m) found = { count: Number(m[1]), metric: m[2].trim() };
  }
  return found;
}

/** The line a job prints. One helper so every job says it the same way. */
export const outputLine = (count, metric) => `OUTPUT ${Math.max(0, Math.trunc(Number(count) || 0))} ${metric}`;

/**
 * Is one run below its floor? A failed run, a run that printed no OUTPUT line, and a count under the
 * floor are all low. A floor of 0 (a job that only checks) is never low on output. Pure.
 */
export function runIsLow(run, floor) {
  if (!(Number(floor) > 0)) return false;
  if (run?.outcome === "failed") return true;
  if (run?.output_count === null || run?.output_count === undefined) return true;
  return Number(run.output_count) < Number(floor);
}

/**
 * THE FLOOR CHECK. `runs` are the duty's runs since its floor was set, newest first. Alarms when the
 * newest `output_runs` runs are ALL low. One low run is a quiet day; two in a row is a fault. Pure.
 *
 * Returns { alarm, low, needed, newest } where `newest` is the latest run (for the sentence).
 */
export function floorVerdict(duty, runs) {
  const floor = Number(duty?.output_floor);
  const needed = Math.max(1, Number(duty?.output_runs) || DEFAULT_OUTPUT_RUNS);
  const list = Array.isArray(runs) ? runs : [];
  if (!(floor > 0)) return { alarm: false, low: 0, needed, newest: list[0] ?? null };
  let low = 0;
  for (const r of list) {
    if (!runIsLow(r, floor)) break;
    low += 1;
  }
  return { alarm: low >= needed, low, needed, newest: list[0] ?? null };
}

/** What the newest run produced, in words: a number, or why there is none. Pure. */
export function producedWords(run, metric) {
  if (!run) return `nothing (no run recorded)`;
  if (run.outcome === "failed") return `0 ${metric} (the run failed)`;
  if (run.output_count === null || run.output_count === undefined) return `an unknown number of ${metric} (it printed no OUTPUT line)`;
  return `${run.output_count} ${metric}`;
}

/** Kendra's sentence: "<job> ran but produced <n> <metric> (needs <floor>)". Pure. */
export function floorAlarmText(duty, verdict) {
  const metric = duty.output_metric || "results";
  return `${duty.name} ran but produced ${producedWords(verdict.newest, metric)} (needs ${duty.output_floor}), ` +
    `${verdict.low} run${verdict.low === 1 ? "" : "s"} in a row.`;
}

// ─── B. The first-run check ─────────────────────────────────────────────────────────────────

/** YYYY-MM-DD in Central, `days` after `ms`. Pure. */
export function centralDay(ms, days = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Number(ms) + days * 86_400_000));
}

/** The Open Loops row for a new job. Closes itself on the first above-floor run. Pure. */
export function firstRunLoop(job) {
  const metric = job.output_metric || (Number(job.output_floor) > 0 ? "results" : "a clean run");
  const by = centralDay(job.created_at, 2);
  return {
    source_key: `first-run#${job.id}`,
    title: `Check ${job.name} produced ${metric} by ${by}`.slice(0, 200),
    finish_line: Number(job.output_floor) > 0
      ? `Its first run reports at least ${job.output_floor} ${metric} (an OUTPUT line).`
      : `Its first run finishes cleanly.`,
    next_step: `Read its first run. If it produced nothing, find why and fix it at source.`,
    owner: KENDRA,
    next_date: by,
  };
}

/** Has this run answered the first-run check? Above floor, or (floor 0) a clean finish. Pure. */
export function firstRunMet(run, floor) {
  if (!run || run.outcome === "failed") return false;
  if (!(Number(floor) > 0)) return true;
  return run.output_count !== null && run.output_count !== undefined && Number(run.output_count) >= Number(floor);
}

// ─── G2. A task that sits "running" ─────────────────────────────────────────────────────────

export const STALE_ABSOLUTE_MS = 2 * 3_600_000;
/** A usual duration is trusted only from this many finished runs of the same kind. */
export const USUAL_MIN_SAMPLES = 5;
/** Never call a run stale younger than this, whatever its usual is. */
export const STALE_FLOOR_MS = 30 * 60_000;

/** The median of finished durations, or null below USUAL_MIN_SAMPLES. Pure. */
export function usualDuration(durations) {
  const d = (durations ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (d.length < USUAL_MIN_SAMPLES) return null;
  const mid = Math.floor(d.length / 2);
  return d.length % 2 ? d[mid] : Math.round((d[mid - 1] + d[mid]) / 2);
}

/**
 * HER MAC POLLS 06:00–22:00 CENTRAL (scripts/ops/agent-claim.sh --poll, every five minutes). Work
 * parked on a seat can only be claimed inside that window, so a wait is measured in its hours.
 */
export const POLL_WINDOW = Object.freeze([6, 22]);
/** A run parked on a seat and claimed by no machine through this many polling hours is said. */
export const NEVER_CLAIMED_POLLING_MS = 4 * 3_600_000;

const chicagoHour = (ms) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date(ms))) % 24;

/**
 * The milliseconds between `from` and `to` that fall inside POLL_WINDOW in Central. Central's offset
 * is whole hours, so each UTC hour lies wholly inside or outside the window. Pure.
 */
export function pollingHoursMs(from, to) {
  let a = Number(from);
  const b = Number(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  let total = 0;
  // At most 60 days of hours; a longer wait is long past every floor anyway.
  for (let i = 0; a < b && i < 24 * 60; i += 1) {
    const next = Math.min(b, (Math.floor(a / 3_600_000) + 1) * 3_600_000);
    const h = chicagoHour(a);
    if (h >= POLL_WINDOW[0] && h < POLL_WINDOW[1]) total += next - a;
    a = next;
  }
  return total;
}

/**
 * Is a running task stale? The clock is the WORK's, not the task's (9 Nov 2026: "Executive
 * Intelligence Report" read "running 53 min on bk_claude_code" while its run sat parked, unclaimed,
 * on a Mac that was switched off; `tasks.started_at` is stamped a second before the work is parked).
 *   - `parked` (a backend run exists and no machine has claimed it) is waiting, never running: stale
 *     only once the wait (from `parked_at`, the newest run's dispatch, else `started_at`) passes
 *     NEVER_CLAIMED_POLLING_MS counted inside the polling window.
 *   - otherwise: longer than twice its usual duration, or more than two hours with no recorded
 *     progress, both measured from `claimed_at` when there is one, else `started_at`.
 * `last_progress_at` is the newest task event or claim; null = none. Pure.
 */
export function staleTaskVerdict(task, usualMs, now) {
  const started = Number(task?.started_at);
  if (!Number.isFinite(started)) return { stale: false, why: "not started" };
  if (task.parked) {
    const since = Number(task.parked_at);
    const from = Number.isFinite(since) && since > 0 ? since : started;
    const waited = now - from;
    const polling = pollingHoursMs(from, now);
    if (polling > NEVER_CLAIMED_POLLING_MS) return { stale: true, why: "never_claimed", waited, polling };
    return { stale: false, why: "waiting_for_seat", waited, polling };
  }
  const claimed = Number(task.claimed_at);
  const from = Number.isFinite(claimed) && claimed > 0 ? claimed : started;
  const age = now - from;
  const progress = Number(task.last_progress_at);
  const quiet = Number.isFinite(progress) && progress > from ? now - progress : age;
  if (usualMs && age > Math.max(2 * usualMs, STALE_FLOOR_MS)) return { stale: true, why: "twice_usual", age, usualMs };
  if (age > STALE_ABSOLUTE_MS && quiet > STALE_ABSOLUTE_MS) return { stale: true, why: "no_progress", age, quiet };
  return { stale: false, why: "fine", age };
}

const hm = (ms) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};

/** Kendra's sentence for a stale task, naming the title and the seat. Pure. */
export function staleTaskText(task, verdict) {
  const title = String(task.title).slice(0, 120);
  if (verdict.why === "never_claimed") {
    const seat = task.parked_on || "a seat";
    return `"${title}" has been waiting ${hm(verdict.waited)} for ${seat} to pick it up; no machine ever claimed it.`;
  }
  const seat = task.seat || "no seat recorded";
  const why = verdict.why === "twice_usual"
    ? `more than twice its usual ${hm(verdict.usualMs)}`
    : `with no recorded progress for ${hm(verdict.quiet ?? verdict.age)}`;
  return `"${title}" has been running ${hm(verdict.age)} on ${seat}, ${why}.`;
}

// ─── G1. Owner-bound email that fails ───────────────────────────────────────────────────────

export const MAIL_FAILS_IN_A_ROW = 2;

/** The error as a class, never the body: "auth (HTTP 401)", "refused (HTTP 422)", "network". Pure. */
export function errorClass(detail) {
  const s = String(detail ?? "");
  const code = /\b(?:HTTP\s*)?([45]\d\d)\b/.exec(s)?.[1];
  if (code === "401" || code === "403") return `auth (HTTP ${code})`;
  if (code === "429") return "rate limited (HTTP 429)";
  if (code && code.startsWith("4")) return `refused (HTTP ${code})`;
  if (code) return `provider down (HTTP ${code})`;
  if (/timeout|timed out|fetch failed|ENOTFOUND|ECONN/i.test(s)) return "network";
  if (/longer than|too long|size/i.test(s)) return "too long";
  return "other";
}

/** A subject reduced to its kind (reference codes and counts dropped), so a series groups. Pure. */
export function subjectKind(subject) {
  return String(subject ?? "")
    .replace(/\s*·\s*[A-Z0-9]+-[A-Z0-9]+\s*$/u, "")
    .replace(/\d+/g, "N")
    .trim()
    .slice(0, 120);
}

/**
 * THE OWNER-MAIL CHECK. `attempts` are every owner-bound send attempt one app recorded, any order:
 * { app, subject, ok, detail, at }. A send series (app + subject kind) whose newest
 * MAIL_FAILS_IN_A_ROW attempts all failed raises one alarm. A later success clears it. Pure.
 *
 * Returns [{ key, app, subject, errorClass, fails, last_at, hers }].
 */
/** "West Peek OS" → "west-peek-os". Pure. */
export const appSlug = (app) => String(app ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A short stable hash, so a subject never has to fit an alarm key's characters. Pure. */
export function shortHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** The series key: `<app slug>#<hash of the subject kind>`. Pure. */
export const mailSeriesKey = (app, subject) => `${appSlug(app)}#${shortHash(subjectKind(subject))}`;

export function ownerMailVerdicts(attempts) {
  const series = new Map();
  for (const a of attempts ?? []) {
    const key = mailSeriesKey(a.app, a.subject);
    if (!series.has(key)) series.set(key, []);
    series.get(key).push(a);
  }
  // A key is the app's, not the series': once any email of the app went after an auth failure, the
  // key works again (6 Nov 2026: Wynn's key was renewed at 15:05 UTC; two series had simply stopped).
  const lastOk = new Map();
  for (const a of attempts ?? []) if (a.ok && String(a.at) > (lastOk.get(a.app) ?? "")) lastOk.set(a.app, String(a.at));
  const out = [];
  for (const [key, list] of series) {
    list.sort((x, y) => String(y.at).localeCompare(String(x.at)));
    let fails = 0;
    for (const a of list) { if (a.ok) break; fails += 1; }
    if (fails < MAIL_FAILS_IN_A_ROW) continue;
    const cls = errorClass(list[0].detail);
    if (cls.startsWith("auth") && (lastOk.get(list[0].app) ?? "") > String(list[0].at)) continue;
    out.push({ key, app: list[0].app, subject: subjectKind(list[0].subject), errorClass: cls, fails, last_at: list[0].at, hers: cls.startsWith("auth") });
  }
  return out;
}

/** Kendra's sentence. App, subject and error class only; never a body or an address. Pure. */
export function ownerMailText(v) {
  return `${v.app}: owner emails "${v.subject}" failed ${v.fails} times in a row (${v.errorClass}).` +
    (v.hers ? " The sending key was refused, which only you can renew." : "");
}
