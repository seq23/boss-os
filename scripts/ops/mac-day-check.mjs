#!/usr/bin/env node
/**
 * `npm run mac-day:check` — THE MAC'S DAY, PROVEN ON THE PLISTS THEMSELVES (her ruling 21 Nov 2026, Central,
 * every day): heavy work 22:00-06:55, the Mac OFF 07:00-10:00, everything else from 10:00, and every
 * morning job done by 06:30 with twice its worst measured runtime to spare ("do not let my ... morning
 * email /briefs suffer").
 *
 * Reads every com.seq.* / com.howweknow.* plist (and West Peek OS's local-jobs claimer) in ~/Library/LaunchAgents (and the PBS fill held in
 * ~/.peace-be-still/held), each Hour moved back from the Mac's zone to Central, and the Schedule manifest's
 * `macWindow` and `worstMin`. Fails, by name, when:
 *   - any calendar slot falls 07:00-09:59 (the Mac is off: it would simply never run);
 *   - a HEAVY job has a slot outside 22:00-06:55;
 *   - a LIGHT job has a slot outside 10:00-21:59;
 *   - a MORNING job's slot before 07:00 plus twice its worst runtime ends after 06:30, or it has no
 *     measured worst runtime;
 *   - more than 3 jobs start in one 5-minute slot from 10:00 on, on any real date of the next 8 weeks;
 *   - a job (one-shots and LEFT_AS_IS aside) does not run behind `mac-window run <its class> <label>`, or has no class
 *     (a row's `macWindowIn` names the script that runs it behind mac-window itself: the PBS fill, whose
 *     plist is held and moved by its own one-shot, so it is never rewritten).
 * Exit 0 clean, 1 problems, 2 nothing read (Rule 0: zero plists or zero calendar slots is a lost directory, not a pass).
 * At most two HEAVY jobs at once is held at run time, not here: mac-window's two heavy slots (seq-bin
 * tests/test-mac-window.sh); a third heavy start waits for a slot or, on an interval tick, tries next tick.
 *
 *   npm run mac-day:check                  # this Mac
 *   node scripts/ops/mac-day-check.mjs --dir <LaunchAgents> [--held <dir>] [--shift 0]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { centralToLocalOffset, macWindows, ONE_SHOT } from "./plist-central.mjs";
import { installedPlists, plistEvents, slotTimes } from "./lib/schedule.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// Her jobs, plus West Peek OS's local-jobs claimer (it runs `claude -p` builds on this Mac, so it keeps her day:
// LIGHT, behind mac-window, installed by west-peek-os `npm run launchd:install:local-jobs`, 22 Nov 2026). The seat
// claimer and the Meet listener are West Peek OS daemons this check does not schedule.
export const FAMILIES = /^(com\.seq\.|com\.howweknow\.|ventures\.westpeek\.os\.local-jobs$)/;
// Jobs her rules leave exactly as they are (21 Nov 2026: "dont ... put the pause back"): the 00:05 tool that
// ends her pauses is not rewritten, so it carries no guard and no row. Its slots are still checked.
export const LEFT_AS_IS = new Set(["com.seq.resume-paused-jobs"]);
const REST = [7 * 60, 10 * 60];
const HEAVY_END = 6 * 60 + 55;
const MORNING_DONE = 6 * 60 + 30;
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** One plist's calendar slots in Central: [{ mins, dow?, dom? }] (the Schedule's own reader; an hourly slot is 24). Pure. */
export function slotsOf(text, shift = 0) {
  return plistEvents(text, shift).flatMap((e) => (e.hourlyAt != null ? [...Array(24).keys()].map((h) => ({ mins: h * 60 + e.hourlyAt })) : e.mins != null ? [e] : []));
}

/** The `mac-window run <class> <label>` prefix of a plist, or null. Pure. */
export function guardOf(text) {
  const m = /<key>ProgramArguments<\/key>\s*<array>\s*<string>[^<]*\/mac-window<\/string>\s*<string>run<\/string>\s*<string>([A-Z]+)<\/string>\s*<string>([^<]+)<\/string>/.exec(text);
  return m ? { cls: m[1], label: m[2] } : null;
}

/** What the Schedule's rows themselves claim: a MORNING row's own slot before 07:00 plus twice the worst
 * runtime its row states must end by 06:30, and a MORNING row must state one. Pure. */
export function rowProblems(manifest) {
  const out = [];
  for (const r of manifest.rows ?? []) {
    if (r.system !== "mac" || r.macWindow !== "MORNING") continue;
    const w = r.worstMin?.minutes;
    if (!(w > 0)) { out.push(`row ${r.id}: a MORNING row with no measured worst runtime (worstMin)`); continue; }
    for (const s of [...new Set((r.slots ?? []).flatMap(slotTimes).map((x) => x.mins))]) {
      if (s < REST[0] && s + 2 * w > MORNING_DONE) out.push(`row ${r.id} ${hhmm(s)}: starts + 2 x ${w} min worst = ${hhmm(Math.ceil(s + 2 * w))}, after 06:30`);
    }
  }
  return out;
}

/** Every problem with these jobs ({ label: text }) against the manifest. Pure. */
export function macDayProblems(jobs, manifest, { shift = 0, from = new Date("2026-11-23T12:00:00Z"), days = 56 } = {}) {
  const cls = macWindows(manifest);
  const worst = new Map();
  // a label on several rows is held to the longest worst runtime any of them states
  for (const r of manifest.rows ?? []) for (const l of [].concat(r.trigger?.launchd ?? [])) if (r.worstMin) worst.set(l, Math.max(worst.get(l) ?? 0, r.worstMin.minutes));
  const inScript = new Set();
  for (const r of manifest.rows ?? []) if (r.macWindowIn) for (const l of [].concat(r.trigger?.launchd ?? [])) inScript.add(l);
  const problems = [];
  const starts = []; // { label, slot }
  for (const [label, text] of Object.entries(jobs)) {
    const slots = slotsOf(text, shift);
    const c = cls.get(label);
    const oneShot = ONE_SHOT.test(label);
    if (!oneShot && !LEFT_AS_IS.has(label)) {
      if (!c) problems.push(`${label}: no macWindow on its Schedule row`);
      const g = guardOf(text);
      if (!g && !inScript.has(label)) problems.push(`${label}: does not run behind mac-window`);
      else if (g && c && (g.cls !== c || g.label !== label)) problems.push(`${label}: runs behind mac-window ${g.cls} ${g.label}, its row says ${c}`);
    }
    for (const s of slots) {
      const at = `${label} ${s.dow != null ? `wd${s.dow} ` : ""}${s.dom != null ? `day${s.dom} ` : ""}${hhmm(s.mins)}`;
      if (s.mins >= REST[0] && s.mins < REST[1]) problems.push(`${at}: inside 07:00-09:59, when the Mac is off`);
      if (c === "HEAVY" && !(s.mins >= 22 * 60 || s.mins <= HEAVY_END)) problems.push(`${at}: a HEAVY job outside 22:00-06:55`);
      if (c === "LIGHT" && !(s.mins >= 10 * 60 && s.mins < 22 * 60)) problems.push(`${at}: a LIGHT job outside 10:00-21:59`);
      if (c === "MORNING" && s.mins < REST[0]) {
        const w = worst.get(label);
        if (w == null) problems.push(`${at}: a MORNING job with no measured worst runtime (worstMin on its row)`);
        else if (s.mins + 2 * w > MORNING_DONE) problems.push(`${at}: starts + 2 x ${w} min worst = ${hhmm(Math.ceil(s.mins + 2 * w))}, after 06:30`);
      }
      starts.push({ label, s });
    }
  }
  // Pile-up at boot and through the day: real dates, so a weekly and a monthly slot that share a day count together.
  for (let i = 0; i < days; i += 1) {
    const d = new Date(from.getTime() + i * 86_400_000);
    const dow = d.getUTCDay(); const dom = d.getUTCDate();
    const buckets = new Map();
    for (const { label, s } of starts) {
      if (s.mins < REST[1]) continue;
      if (s.dow != null && s.dow !== dow) continue;
      if (s.dom != null && s.dom !== dom) continue;
      const b = Math.floor(s.mins / 5) * 5;
      if (!buckets.has(b)) buckets.set(b, new Set());
      buckets.get(b).add(label);
    }
    for (const [b, set] of buckets) if (set.size > 3) problems.push(`${d.toISOString().slice(0, 10)} ${hhmm(b)}: ${set.size} jobs start in one 5-minute slot (${[...set].join(", ")})`);
  }
  return [...new Set(problems)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const dir = arg("--dir", path.join(os.homedir(), "Library", "LaunchAgents"));
  const held = arg("--held", path.join(os.homedir(), ".peace-be-still", "held"));
  const shift = Number(arg("--shift", String(centralToLocalOffset())));
  const jobs = { ...installedPlists(held, FAMILIES), ...installedPlists(dir, FAMILIES) };
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "src/shared/boss/schedule/manifest.json"), "utf8"));
  const n = Object.keys(jobs).length;
  const slots = Object.values(jobs).reduce((a, t) => a + slotsOf(t, shift).length, 0);
  if (!n || !slots) { console.log(`NAMED STOP [NO_PLISTS] ${n} plists and ${slots} calendar slots read in ${dir}: nothing to prove`); process.exit(2); }
  const problems = [...rowProblems(manifest), ...macDayProblems(jobs, manifest, { shift, from: new Date() })];
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`OUTPUT mac-day:check ${n} jobs, ${slots} calendar slots read: ${problems.length ? `${problems.length} problem(s)` : "every slot keeps the Mac's day (rest 07:00-09:59 empty, heavy 22:00-06:55, morning done by 06:30 with 2x worst to spare, at most 3 starts per 5 minutes)"}`);
  process.exit(problems.length ? 1 : 0);
}
