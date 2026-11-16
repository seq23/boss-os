/**
 * A WEEKLY MAC JOB WHOSE SLOT FELL WHILE THE MAC WAS OFF RUNS ONCE, LATER THAT DAY (16 Nov 2026).
 *
 * 9 Nov 2026: the Mac booted at 07:36 Central, and launchd never replays a calendar slot missed
 * across a shutdown, so the Monday prospect finder (com.seq.boss-prospect-discovery, 07:00), the
 * people sweep (07:15) and the sites audit (06:00) did not run that week. The morning catch-up runs
 * at boot (RunAtLoad) and at 06:32, and calls this: every com.seq.* LaunchAgent with ONE weekly slot
 * whose slot is today, already past, and whose launchd log has not been written since that slot is
 * started once with `launchctl kickstart` (which never restarts a job already running).
 *
 * Only once-a-week jobs: a job that runs several times a week (the weekday senders) gets its next
 * slot tomorrow, and a blind second run of a sender is worse than a missed day. The log's time is the
 * record that it ran; a job that writes nothing to its launchd log would look missed, so the read
 * errs to "ran" whenever either log was written after the slot.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The jobs whose one weekly slot was today, is past, and left no log line since. Pure; local time (launchd's). */
export function missedToday(jobs, now = Date.now()) {
  const d = new Date(now);
  const out = [];
  for (const j of jobs ?? []) {
    // A morning-section producer (`--morning`) is the section catch-up's (morningSections.mjs), never run twice.
    // Once a week = every slot on ONE weekday (prospect discovery: 07:00 search, 09:15 collect); the
    // first slot of the day is the one a late boot misses.
    if (/oneshot/.test(j.label) || /--morning\b/.test(j.program ?? "") || !Array.isArray(j.slots) || !j.slots.length) continue;
    if (new Set(j.slots.map((x) => Number(x?.Weekday) % 7)).size !== 1) continue;
    const s = [...j.slots].sort((x, y) => (x.Hour * 60 + (x.Minute ?? 0)) - (y.Hour * 60 + (y.Minute ?? 0)))[0];
    if (s?.Weekday == null || s.Hour == null) continue;
    if (Number(s.Weekday) % 7 !== d.getDay()) continue;
    const slot = new Date(now); slot.setHours(Number(s.Hour), Number(s.Minute ?? 0), 0, 0);
    if (now < slot.getTime()) continue;
    if ((j.lastRunMs ?? 0) >= slot.getTime()) continue;
    out.push(j.label);
  }
  return out;
}

const plist = (f, key, fmt = "json") => { try { return execFileSync("plutil", ["-extract", key, fmt, "-o", "-", f], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };
const mtime = (p) => { try { return p ? statSync(p).mtimeMs : 0; } catch { return 0; } };

/** Every com.seq.* LaunchAgent's calendar and the last time either of its logs was written. */
export function readJobs(dir = join(homedir(), "Library/LaunchAgents")) {
  const jobs = [];
  for (const name of readdirSync(dir).filter((n) => /^com\.seq\..+\.plist$/.test(n))) {
    const f = join(dir, name);
    const cal = plist(f, "StartCalendarInterval");
    if (!cal) continue;
    let slots = JSON.parse(cal); if (!Array.isArray(slots)) slots = [slots];
    const outLog = plist(f, "StandardOutPath", "raw");
    const errLog = plist(f, "StandardErrorPath", "raw");
    const program = plist(f, "ProgramArguments") ?? "";
    jobs.push({ label: name.replace(/\.plist$/, ""), slots, program, lastRunMs: Math.max(mtime(outLog), mtime(errLog)) });
  }
  return jobs;
}

/** Starts each missed job once. Returns the labels started; a start that fails is said by name. */
export function catchUpWeeklySlots(now = Date.now()) {
  const started = [];
  for (const label of missedToday(readJobs(), now)) {
    try {
      execFileSync("launchctl", ["kickstart", `gui/${process.getuid()}/${label}`], { stdio: "ignore" });
      console.log(`missed-weekly-slot: ${label} missed today's slot while the Mac was off; started it now.`);
      started.push(label);
    } catch (e) {
      console.error(`NAMED STOP [MISSED_SLOT_NOT_STARTED] ${label}: ${e.message}`);
    }
  }
  return started;
}
