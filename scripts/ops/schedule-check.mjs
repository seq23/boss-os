#!/usr/bin/env node
/**
 * `npm run schedule:check` — the Schedule (src/shared/boss/schedule/manifest.json) against everything
 * that really fires, on her Mac:
 *   - the live Boss OS duties (GET /api/boss/duties/all, through the vault for the passcode);
 *   - every com.seq.*, com.howweknow.* and ventures.westpeek.* plist launchd holds, each Hour moved
 *     back from the Mac's zone to Central (so a plist that bypassed the Central pinning shows up as
 *     an hour early);
 *   - every GitHub Actions and Cloudflare cron on the default branch of every repo of hers that is not
 *     a client's (gh repo list; a repo with no checkout here is read through the GitHub API).
 * Exit 0: every job has a row and every row's time is the real time. Exit 1: problems, by name.
 * Exit 2: nothing could be checked. Lines of the approved week still waiting on another repo's move
 * are printed as WAITING, never passed silently.
 *
 *   npm run schedule:check                 # everything
 *   npm run schedule:check -- --no-duties  # without the Boss OS API (no vault prompt)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  candidateRepos, chicagoOffset, cronProblems, disabledWorkflows, dutyProblems, installedJobs, launchdProblems,
  missingLabels, readSchedule, repoCronFiles, repoCronFilesApi, scheduleCategoryProblems, scheduleRepoDir, shapeProblems, weekProblems,
} from "./lib/schedule.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OWNER = "seq23";
const m = readSchedule(ROOT);
const problems = [...shapeProblems(m)];
let checked = 0;

// ─── Duties, live ────────────────────────────────────────────────────────────
/** /duties/all speaks in choices ("weekly:2", "custom" + words); turn one back into a duty row. */
export function dutyFromApi(d) {
  const c = String(d.choice ?? "");
  const base = { id: d.id, name: d.name, local_hour: d.local_hour, local_minute: d.local_minute, removed: d.removed };
  if (c === "monthly") return { ...base, cadence: "monthly" };
  if (c.startsWith("weekly:")) return { ...base, cadence: "weekly", weekday: Number(c.slice(7)) };
  if (c === "weekdays") return { ...base, cadence: "daily", weekdays: "[1,2,3,4,5]" };
  if (c === "custom") {
    const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const days = names.map((n, i) => (new RegExp(n, "i").test(d.schedule_words ?? "") ? i : -1)).filter((i) => i >= 0);
    return { ...base, cadence: "daily", weekdays: JSON.stringify(days) };
  }
  return { ...base, cadence: "daily" };
}
if (!process.argv.includes("--no-duties")) {
  try {
    const { bossApi } = await import("./lib/duty-kit.mjs");
    const api = await bossApi();
    const duties = (await api.get("/duties/all")).duties.map(dutyFromApi);
    problems.push(...dutyProblems(m, duties));
    checked += duties.length;
    console.log(`duties: ${duties.length} live`);
  } catch (e) {
    problems.push(`the live duties could not be read (${String(e?.message ?? e).slice(0, 120)}); run through the vault: npm run vault:run -- npm run schedule:check`);
  }
}

// ─── launchd, as installed ───────────────────────────────────────────────────
const jobs = installedJobs();
problems.push(...launchdProblems(m, jobs), ...missingLabels(m, jobs).map((l) => `launchd ${l} is on the Schedule and not installed on this Mac`));
checked += Object.keys(jobs).length;
console.log(`launchd: ${Object.keys(jobs).length} jobs`);

// ─── Crons in every repo of hers ─────────────────────────────────────────────
let repos = [];
try { repos = candidateRepos(OWNER, [...new Set(m.rows.map((r) => r.trigger?.repo).filter(Boolean))]); } catch (e) { problems.push(`gh repo list failed (${String(e?.message ?? e).slice(0, 80)}); the repos could not be read`); }
const offset = chicagoOffset();
let files = 0;
for (const repo of repos) {
  const disabled = disabledWorkflows(OWNER, repo);
  let list;
  try { list = scheduleRepoDir(repo, ROOT) ? repoCronFiles(repo, ROOT, { disabled }) : repoCronFilesApi(OWNER, repo); }
  catch (e) { problems.push(`${repo}: its workflows could not be read from GitHub (${String(e?.message ?? e).split("\n")[0].slice(0, 120)})`); continue; }
  files += list.length;
  problems.push(...cronProblems(m, repo, list, offset));
}
for (const r of m.rows) if (r.trigger?.repo && !repos.includes(r.trigger.repo)) problems.push(`${r.id}: repo ${r.trigger.repo} is not one of hers any more (archived, renamed or a client's)`);
problems.push(...scheduleCategoryProblems(m, repos));
checked += files;
console.log(`repos: ${repos.length} read, ${files} scheduled files (Central is UTC${offset})`);

// ─── The approved week ───────────────────────────────────────────────────────
const week = weekProblems(m);
problems.push(...week.problems);

if (checked === 0) {
  console.error("NAMED STOP [SCHEDULE_NOTHING_CHECKED] no duty, plist or repo could be read.");
  process.exit(2);
}
for (const p of week.pending) console.log(`  WAITING ${p}`);
if (problems.length) {
  console.error(problems.map((p) => `  ${p}`).join("\n"));
  console.error(`Schedule: ${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`Schedule: ${m.rows.length} rows; every job has a row and runs when the page says.${week.pending.length ? ` ${week.pending.length} line(s) of the week wait on another repo's move.` : ""}`);
