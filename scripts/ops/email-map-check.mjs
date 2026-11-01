#!/usr/bin/env node
/**
 * `npm run email-map:check` — the Email Map against every repo and launchd job on her Mac.
 * Exit 0: every cited path exists on its repo's default branch, every file that sends is cited,
 * every launchd label is installed. Exit 1: a problem, by name. Exit 2: nothing could be checked
 * (no sibling repos found): never a quiet pass over zero.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkLaunchd, checkOtherRepos, clientRepoProblems, readManifest } from "./lib/email-map.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = readManifest(ROOT);
const repos = checkOtherRepos(manifest, ROOT);
const launchd = checkLaunchd(manifest);
if (repos.checked.length === 0) {
  console.error("NAMED STOP [EMAIL_MAP_NOTHING_CHECKED] no other repo checkout was found next to this one, in ~/GitHub or in ~.");
  process.exit(2);
}
const problems = [...clientRepoProblems(manifest, [...repos.checked, ...repos.missingRepos]), ...repos.problems, ...launchd.missing.map((l) => `launchd ${l} is not installed`)];
console.log(`Email Map: ${manifest.rows.length} rows; ${repos.checked.length} repos read${repos.missingRepos.length ? ` (not on this Mac: ${repos.missingRepos.join(", ")})` : ""}; ${launchd.labels.length} launchd labels.`);
if (problems.length) {
  console.error(problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
console.log("Every sender is on the map.");
