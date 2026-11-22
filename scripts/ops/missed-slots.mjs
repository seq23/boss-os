/**
 * A MAC JOB WHOSE SLOT FELL WHILE THE MAC WAS OFF OR ASLEEP RUNS ONCE, LATER THAT DAY (16 Nov 2026; daily
 * jobs and the 30-minute check added 20 Nov 2026 after the 01:40 backup missed two nights with the lid closed:
 * launchd replays neither a slot missed across a shutdown nor, reliably, one missed in a short dark wake).
 *
 * 9 Nov 2026: the Mac booted at 07:36 Central, and launchd never replays a calendar slot missed
 * across a shutdown, so the Monday prospect finder (com.seq.boss-prospect-discovery, 07:00), the
 * people sweep (07:15) and the sites audit (06:00) did not run that week. The morning catch-up runs
 * at boot (RunAtLoad) and at its morning slots (06:05, 06:14 and 10:10 since 21 Nov 2026), and calls this: every com.seq.* LaunchAgent with ONE weekly slot
 * whose slot is today, already past, and whose launchd log has not been written since that slot is
 * started once with `launchctl kickstart` (which never restarts a job already running).
 *
 * Daily jobs (every slot without a weekday) catch up their latest past slot; once-a-week jobs their first.
 * Jobs on several weekdays (the outreach senders) never: a blind late send is worse than a missed day.
 * The log's time is the record that it ran; the read errs to "ran" whenever either log was written after the slot.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The jobs whose one weekly slot was today, is past, and left no log line since. Pure; local time (launchd's). */
export function missedToday(jobs, now = Date.now()) {
  const d = new Date(now);
  const out = [];
  for (const j of jobs ?? []) {
    // A morning-section producer (`--morning`) is the section catch-up's (morningSections.mjs), never run twice.
    if (/oneshot|boss-morning-catchup/.test(j.label) || /--morning\b/.test(j.program ?? "") || !Array.isArray(j.slots) || !j.slots.length) continue;
    // A slot with no hour runs every hour already; a monthly slot (Day/Month) is not a daily one; a job with
    // no launchd log cannot show that it ran, so it would be started every 30 minutes: all left alone.
    if (j.slots.some((x) => x?.Hour == null || x?.Day != null || x?.Month != null) || j.noLog) continue;
    const days = new Set(j.slots.map((x) => (x?.Weekday == null ? "*" : Number(x.Weekday) % 7)));
    const at = (x) => { const t = new Date(now); t.setHours(Number(x.Hour), Number(x.Minute ?? 0), 0, 0); return t.getTime(); };
    let slot;
    if (days.size === 1 && days.has("*")) {
      // DAILY (20 Nov 2026): the LATEST of today's slots already past. The 01:40 backup missed while the
      // lid was closed runs when the Mac is next awake that day.
      const past = j.slots.map(at).filter((t) => t <= now);
      if (!past.length) continue;
      slot = Math.max(...past);
    } else if (days.size === 1) {
      // WEEKLY: once a week = every slot on ONE weekday; the first slot of the day is the one a late boot misses.
      const s = [...j.slots].sort((x, y) => (x.Hour * 60 + (x.Minute ?? 0)) - (y.Hour * 60 + (y.Minute ?? 0)))[0];
      if (Number(s.Weekday) % 7 !== d.getDay()) continue;
      slot = at(s);
      if (now < slot) continue;
    } else {
      // SEVERAL WEEKDAYS (the outreach senders: prospects, P&P outreach, T2R groups, LP drip): never a
      // blind late run; a late send is worse than a missed day. Their next weekday slot sends.
      continue;
    }
    if ((j.lastRunMs ?? 0) >= slot) continue;
    out.push(j.label);
  }
  return out;
}

const plist = (f, key, fmt = "json") => { try { return execFileSync("plutil", ["-extract", key, fmt, "-o", "-", f], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
const mtime = (p) => { try { return p ? statSync(p).mtimeMs : 0; } catch { return 0; } };
/** When the job last wrote ANY log: the newest file in its launchd log folders. A job that writes its own dated
 * log beside launchd's (fb-renew, drive-backup) ran even when launchd's file did not change (20 Nov 2026). */
const newestIn = (p) => {
  if (!p) return 0;
  try {
    const dir = dirname(p);
    return Math.max(mtime(p), ...readdirSync(dir).map((n) => mtime(join(dir, n))));
  } catch { return mtime(p); }
};

/** Every com.seq.* LaunchAgent's calendar and the last time either of its logs was written. */
export function readJobs(dir = join(homedir(), "Library/LaunchAgents")) {
  const raw = [];
  for (const name of readdirSync(dir).filter((n) => /^com\.seq\..+\.plist$/.test(n))) {
    const f = join(dir, name);
    const outLog = plist(f, "StandardOutPath", "raw");
    const errLog = plist(f, "StandardErrorPath", "raw");
    raw.push({ f, name, outLog, errLog, cal: plist(f, "StartCalendarInterval") });
  }
  // A log folder shared by several jobs (boss-agent) says nothing about THIS job: only its own files count there.
  const users = new Map();
  for (const r of raw) for (const d of new Set([r.outLog, r.errLog].filter(Boolean).map((x) => dirname(x)))) users.set(d, (users.get(d) ?? 0) + 1);
  const ran = (p) => (!p ? 0 : (users.get(dirname(p)) ?? 0) > 1 ? mtime(p) : newestIn(p));
  const jobs = [];
  for (const r of raw) {
    if (!r.cal) continue;
    let slots = JSON.parse(r.cal); if (!Array.isArray(slots)) slots = [slots];
    const program = plist(r.f, "ProgramArguments") ?? "";
    jobs.push({ label: r.name.replace(/\.plist$/, ""), slots, program, noLog: !r.outLog && !r.errLog, lastRunMs: Math.max(ran(r.outLog), ran(r.errLog)) });
  }
  return jobs;
}

/** Starts each missed job once. Returns the labels started; a start that fails is said by name. */
export function catchUpSlots(now = Date.now()) {
  const started = [];
  for (const label of missedToday(readJobs(), now)) {
    try {
      execFileSync("launchctl", ["kickstart", `gui/${process.getuid()}/${label}`], { stdio: "ignore" });
      console.log(`missed-slot: ${label} missed today's slot while the Mac was off; started it now.`);
      started.push(label);
    } catch (e) {
      console.error(`NAMED STOP [MISSED_SLOT_NOT_STARTED] ${label}: ${e.message}`);
    }
  }
  return started;
}

const DAY_MS = 86_400_000;
/**
 * NEVER SILENT (20 Nov 2026): a DAILY job whose launchd log has not been written for 36 hours. Pure.
 * The catch-up covers a missed night; this names a job that has stopped altogether (a broken plist,
 * a script that dies before logging).
 */
export function staleDaily(jobs, now = Date.now(), maxMs = 36 * 3_600_000) {
  return (jobs ?? [])
    .filter((j) => !/oneshot/.test(j.label) && !j.noLog && Array.isArray(j.slots) && j.slots.length && j.slots.every((x) => x?.Weekday == null && x?.Day == null && x?.Month == null && x?.Hour != null))
    .filter((j) => now - (j.lastRunMs ?? 0) > maxMs)
    .map((j) => ({ label: j.label, days: j.lastRunMs ? Math.floor((now - j.lastRunMs) / DAY_MS) : null }));
}

// Run directly (com.seq.boss-slot-catchup, every 30 minutes): start missed slots, name stale daily jobs.
if (import.meta.url === `file://${process.argv[1]}`) {
  const started = catchUpSlots();
  const stale = staleDaily(readJobs());
  console.log(`OUTPUT ${started.length} missed slots started`);
  // THE MAC'S DAY (21 Nov 2026): a job woken outside its window (seq-bin mac-window) left one pending
  // record; this is where it is started, once, when its window opens. Never a paused job.
  const mw = process.env.MAC_WINDOW_BIN || `${homedir()}/bin/mac-window`;
  try {
    process.stdout.write(execFileSync(mw, ["catch-up"], { encoding: "utf8", timeout: 120_000 }));
  } catch (e) {
    console.error(`NAMED STOP [MAC_WINDOW_CATCHUP_FAILED] ${mw} catch-up: ${String(e.message).slice(0, 160)}`);
  }
  if (stale.length) {
    const line = `Mac jobs that have not run for 36+ hours: ${stale.map((s) => s.label.replace(/^com\.seq\./, "")).join(", ")}`;
    console.error(`NAMED NOTE [DAILY_JOB_STALE] ${line}`);
    try {
      const { addMorningLines } = await import("../../src/shared/boss/mail/morning.mjs");
      addMorningLines("notices", { lines: [{ text: line }] });
    } catch (e) {
      console.error(`NAMED NOTE [STALE_LINE_NOT_WRITTEN] ${e.message}`);
    }
  }
}
