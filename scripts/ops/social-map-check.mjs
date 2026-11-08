#!/usr/bin/env node
/**
 * `npm run social-map:check` — the Social Map against every site and repo on her Mac.
 * Reads every grid site's entity.json sameAs and every repo's posting code on its default branch
 * (her own and the system's repos, from the personal brain's Repo categories), curls each URL
 * (a login wall is "unverifiable", never dead) and checks each live_auto row's job's last run.
 * Exit 0 clean · 1 problems, by name · 2 NAMED STOP [SOCIAL_MAP_NOTHING_CHECKED] (no repo found).
 * `--offline` skips the URL and job checks. The Sunday cohesion check runs the same function.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSocialMapCheck } from "./lib/social-map.mjs";
import { readRepoCategories } from "./lib/repo-categories.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cats = readRepoCategories();
if (cats.problem) console.error(`note: ${cats.problem}; only the repos the map cites are scanned for posting code`);
const repos = cats.problem ? [] : [...cats.mine, ...cats.system].filter((r) => r !== "boss-os");
const r = await runSocialMapCheck({ root: ROOT, repos, live: !process.argv.includes("--offline") });
console.log(r.census);
if (r.status === 2) process.exit(2);
if (r.problems.length) { console.error(r.problems.map((p) => `  ${p}`).join("\n")); process.exit(1); }
console.log("Every account, sameAs and posting job is on the map.");
