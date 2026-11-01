#!/usr/bin/env node
/**
 * Render the pinned Search Readiness Checklist page from the manifest (one definition).
 *
 *   npm run sites:page -- --out <path>     default ~/.boss-os/search-readiness/checklist-from-manifest.html
 *                         [--results <file>]  the "Where every site stands" table; default the newest
 *                                             ~/.boss-os/search-readiness/results-<day>.json
 *
 * The output is the page to republish to her pinned artifact. Editing the page by hand forks it from
 * the checks; edit checklist.json and re-render instead.
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadChecklist } from "../../src/shared/boss/searchReadiness/audit.mjs";
import { renderChecklistPage, loadTemplate } from "../../src/shared/boss/searchReadiness/page.mjs";
import { readRepoCategories } from "./lib/repo-categories.mjs";

const i = process.argv.indexOf("--out");
const out = i >= 0 ? process.argv[i + 1] : join(homedir(), ".boss-os", "search-readiness", "checklist-from-manifest.html");
const checklist = loadChecklist();
const DIR = join(homedir(), ".boss-os", "search-readiness");
const ri = process.argv.indexOf("--results");
const newest = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^results-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop() : null;
const resultsPath = ri >= 0 ? process.argv[ri + 1] : newest ? join(DIR, newest) : null;
const results = resultsPath ? JSON.parse(readFileSync(resultsPath, "utf8")) : null;
// Her sites and her friends' sites are shown apart, by the repo categories in the personal brain.
const categories = readRepoCategories();
if (categories.problem) console.log(`note: ${categories.problem}; every site is listed as hers`);
const html = renderChecklistPage(checklist, loadTemplate(), { results, categories });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
const auto = checklist.items.filter((x) => x.check.mode === "auto").length;
console.log(`Rendered ${checklist.items.length} items (${auto} automatic, ${checklist.items.length - auto} by hand)${results ? `, standings from ${resultsPath}` : ", no results file so no standings table"} → ${out}`);
