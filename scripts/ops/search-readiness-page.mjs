#!/usr/bin/env node
/**
 * Render the pinned Search Readiness Checklist page from the manifest (one definition).
 *
 *   npm run sites:page -- --out <path>     default ~/.boss-os/search-readiness/checklist-from-manifest.html
 *
 * The output is the page to republish to her pinned artifact. Editing the page by hand forks it from
 * the checks; edit checklist.json and re-render instead.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadChecklist } from "../../src/shared/boss/searchReadiness/audit.mjs";
import { renderChecklistPage, loadTemplate } from "../../src/shared/boss/searchReadiness/page.mjs";

const i = process.argv.indexOf("--out");
const out = i >= 0 ? process.argv[i + 1] : join(homedir(), ".boss-os", "search-readiness", "checklist-from-manifest.html");
const checklist = loadChecklist();
const html = renderChecklistPage(checklist, loadTemplate());
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
const auto = checklist.items.filter((x) => x.check.mode === "auto").length;
console.log(`Rendered ${checklist.items.length} items (${auto} automatic, ${checklist.items.length - auto} by hand) → ${out}`);
