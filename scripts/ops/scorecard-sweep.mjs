#!/usr/bin/env node
/**
 * KENDRA'S MONTHLY STRAY SWEEP (owner ruling, 1 Nov 2026: "nothing runs unmeasured").
 *
 * Compares everything actually running — the Schedule, the launchd jobs on this Mac, and the scheduled
 * runs on every one of her repos' default branches (GitHub workflows; Worker crons are Schedule rows) —
 * with the Scorecard (src/shared/boss/scorecard/scorecard.mjs `findStrays`). Anything running with no
 * row gets a default row in Boss OS (POST /api/boss/scorecard/strays: No number until its source is
 * wired, day-30 and day-60 floors), which the Scorecard page and the Monday email show; logged.
 * Client repos are never read (candidateRepos excludes them).
 *
 * launchd com.seq.boss-scorecard-sweep, the 1st of each month 09:45 Central; by hand
 * `npm run scorecard:sweep` (`-- --dry` prints, records nothing).
 *
 * RULE 0: nothing read (no launchd job and no repo) is NAMED STOP [SWEEP_NOTHING_READ], exit 2.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findStrays } from "../../src/shared/boss/scorecard/scorecard.mjs";
import { candidateRepos, installedJobs, repoCronFilesApi } from "./lib/schedule.mjs";
import { bossApi } from "./lib/duty-kit.mjs";
import { readRepoCategories } from "./lib/repo-categories.mjs";
import { categoryOf } from "../../src/shared/boss/repos/categories.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OWNER = "seq23";

async function main(argv = process.argv.slice(2)) {
  const dry = argv.includes("--dry");
  const schedule = JSON.parse(readFileSync(join(ROOT, "src/shared/boss/schedule/manifest.json"), "utf8"));
  const scorecard = JSON.parse(readFileSync(join(ROOT, "src/shared/boss/scorecard/manifest.json"), "utf8"));
  const labels = Object.keys(installedJobs());
  const repoFiles = []; const unread = [];
  let repos = [];
  try { repos = candidateRepos(OWNER, [...new Set(schedule.rows.map((r) => r.trigger?.repo).filter(Boolean))]); }
  catch (e) { unread.push(`the repo list (${String(e?.message ?? e).slice(0, 60)})`); }
  // Friends & clients repos keep their own rows in their own repos (owner, 1 Nov 2026): never swept here.
  const cats = readRepoCategories();
  if (cats.problem) unread.push(`the repo categories (${cats.problem})`);
  else repos = repos.filter((r) => categoryOf(r, cats) !== "friends");
  for (const repo of repos) {
    try { repoFiles.push({ repo, files: repoCronFilesApi(OWNER, repo) }); } catch { unread.push(repo); }
  }
  if (!labels.length && !repoFiles.length) { console.error("NAMED STOP [SWEEP_NOTHING_READ] no launchd job and no repo could be read; nothing was compared."); return 2; }
  const strays = findStrays({ schedule, scorecard, labels, repoFiles });
  const census = `${labels.length} Mac jobs, ${repoFiles.length} repos (${repoFiles.reduce((a, r) => a + r.files.length, 0)} scheduled runs), ${schedule.rows.length} Schedule jobs read${unread.length ? `; not read: ${unread.join(", ")}` : ""}`;
  if (dry) { for (const s of strays) console.log(`stray: ${s.name} (${s.where})`); console.log(`sweep (dry): ${census}; ${strays.length} stray(s); nothing recorded.`); return 0; }
  const api = await bossApi();
  const r = await api.post("/scorecard/strays", { items: strays.map((s) => ({ ...s, business: "personal" })) });
  console.log(`Kendra's sweep: ${census}; ${strays.length} running with no scorecard row, ${r.added} new default row(s) added.`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(e?.code ?? 1); });
