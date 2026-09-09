#!/usr/bin/env node
/**
 * NO EMPLOYEE IS TOLD A BROWSER IS IMPOSSIBLE WHILE ONE EXISTS, AND THERE IS ONLY ONE LAUNCHER.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * "why cant all employees have the rights simone now has" — 9 September 2026.
 *
 * Simone got a real Chrome because she was the first employee who needed one, and the launch logic
 * ended up inside `kdp-browser.mjs` where only she could reach it. Every other employee's prompt
 * said, in effect, that anything behind a login was impossible. That is how a capability nobody had
 * built became a standing excuse — and the worst version of it, `kdp-surface-prompt.md`'s "if the
 * browser is unreachable her laptop is shut", turned a permanent structural absence into weather.
 *
 * ─── The four things it checks ──────────────────────────────────────────────
 *
 *   1. THE SHARED LAUNCHER EXISTS and exposes the three things a caller needs: a per-profile path,
 *      an open, and a classifier. A capability nobody can call is not a capability.
 *   2. ONE COPY OF THE LAUNCH LOGIC. `chromium.launchPersistentContext(` may appear in exactly one
 *      file under `scripts/`. Two components each keeping their own version of the same rule is the
 *      defect class that produced most of this repository's bugs, and it is the specific thing that
 *      kept this capability locked to one employee.
 *   3. PROFILES ARE PER-EMPLOYEE, NOT SHARED. The launcher must derive the directory from the
 *      profile NAME. A single shared profile would put a live authenticated Amazon publishing
 *      session inside every research run — one bad navigation from touching her KDP account.
 *   4. NO PROMPT CLAIMS IMPOSSIBILITY WITHOUT NAMING THE WAY IN. A prompt may say the Chrome MCP
 *      tools are absent — that is true and proven. It may not leave an employee believing there is
 *      no browser at all: any prompt that talks about not having a browser must also name
 *      `npm run browser:`.
 *
 * RULE 0: zero prompts examined, or zero launch sites found, is a FAILURE. A scan that cannot find
 * the thing it governs is broken, not satisfied.
 *
 *   node scripts/validate/every-employee-can-open-a-browser.mjs
 *   node scripts/validate/every-employee-can-open-a-browser.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HARNESS = "scripts/ops/browser.mjs";

/** The real call, not a mention of it in a comment warning people off. */
const LAUNCH = /chromium\.launchPersistentContext\s*\(/;

/** A prompt telling an employee that browsing is off the table. */
const CLAIMS_NO_BROWSER =
  /(no browser|browser is not available|without a browser|cannot use (a |the )?browser|browser automation is (un)?available|has no Chrome|browser is unreachable)/i;

/** Evidence the same file also names the way in. */
const NAMES_THE_WAY_IN = /npm run browser:/;

export function duplicateLaunchers(files) {
  return files.filter((f) => LAUNCH.test(f.source)).map((f) => f.path);
}

export function promptsThatShutTheDoor(prompts) {
  return prompts
    .filter((p) => CLAIMS_NO_BROWSER.test(p.source) && !NAMES_THE_WAY_IN.test(p.source))
    .map((p) => p.path);
}

export function harnessGaps(source) {
  const gaps = [];
  if (!/export function profilePath/.test(source)) gaps.push("profilePath — a directory per employee");
  if (!/export async function openProfile/.test(source)) gaps.push("openProfile — the one launcher");
  if (!/export function classify/.test(source)) gaps.push("classify — signed in, signed out, or reachable");
  // THE ISOLATION RULE, ASSERTED RATHER THAN ASSUMED. A launcher that ignores the name it is given
  // is a shared browser wearing per-employee clothes.
  if (!/browser\/\$\{clean\}|browser\/\$\{name\}/.test(source)) {
    gaps.push("a profile directory derived from the profile NAME — without it every employee shares one browser");
  }
  return gaps;
}

// ─── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const fail = [];
  const say = (name, want, got) => {
    if (JSON.stringify(want) === JSON.stringify(got)) return;
    fail.push(`${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };

  say("one launcher is fine", ["a.mjs"], duplicateLaunchers([
    { path: "a.mjs", source: "chromium.launchPersistentContext(dir, {})" },
    { path: "b.mjs", source: "// never call chromium.launchPersistentContext here" },
  ]));
  say("a second real launcher is seen", ["a.mjs", "b.mjs"], duplicateLaunchers([
    { path: "a.mjs", source: "chromium.launchPersistentContext(dir, {})" },
    { path: "b.mjs", source: "const c = await chromium.launchPersistentContext(other, {})" },
  ]));

  say("a prompt that shuts the door is caught", ["bad.md"], promptsThatShutTheDoor([
    { path: "bad.md", source: "This run has no browser, so do not try." },
    { path: "ok.md", source: "This run has no browser MCP. Use npm run browser:read instead." },
    { path: "quiet.md", source: "nothing about browsers here" },
  ]));

  say("a shared-profile launcher is caught", [
    "a profile directory derived from the profile NAME — without it every employee shares one browser",
  ], harnessGaps(
    "export function profilePath(n) { return '~/.boss-os/browser/shared'; }\n" +
    "export async function openProfile() {}\nexport function classify() {}",
  ).slice(-1));

  if (fail.length) {
    console.error("SELF-TEST FAILED:");
    for (const f of fail) console.error("  ✗", f);
    process.exit(1);
  }
  console.log("SELF-TEST PASSED: 4/4 cases — a duplicate launcher, a door-shutting prompt, and a shared profile are all caught.");
}

// ─── Run ──────────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const problems = [];

if (!existsSync(join(ROOT, HARNESS))) {
  console.error(`SHARED BROWSER SCAN FAILED: ${HARNESS} does not exist, so no employee has a browser at all.`);
  process.exit(2);
}
const harness = readFileSync(join(ROOT, HARNESS), "utf8");
for (const gap of harnessGaps(harness)) problems.push(`${HARNESS} is missing ${gap}.`);

const opsFiles = readdirSync(join(ROOT, "scripts/ops"), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".mjs"))
  .map((e) => ({ path: `scripts/ops/${e.name}`, source: readFileSync(join(ROOT, "scripts/ops", e.name), "utf8") }));

const prompts = readdirSync(join(ROOT, "scripts/ops"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => ({ path: `scripts/ops/${f}`, source: readFileSync(join(ROOT, "scripts/ops", f), "utf8") }));

// RULE 0, TWICE.
if (opsFiles.length === 0) problems.push("scripts/ops holds no scripts at all — this scan examined nothing.");
if (prompts.length === 0) problems.push("scripts/ops holds no employee prompts — this scan examined nothing.");

const launchers = duplicateLaunchers(opsFiles);
if (launchers.length === 0) {
  problems.push("nothing under scripts/ops actually launches a browser, so the harness is a shell.");
} else if (launchers.length > 1) {
  problems.push(
    `${launchers.length} files launch their own browser (${launchers.join(", ")}). ` +
      "There must be exactly one, or the day the launch options change only one copy changes.",
  );
}

for (const p of promptsThatShutTheDoor(prompts)) {
  problems.push(
    `${p} tells an employee they have no browser and never names \`npm run browser:\`. ` +
      "That is how a capability nobody had built became a standing excuse.",
  );
}

if (problems.length) {
  console.error("SHARED BROWSER SCAN FAILED:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nEvery employee has the rights Simone has: her own Chrome, her own profile, headless, with no\n" +
      "password anywhere in the system. A prompt that says otherwise is out of date, not correct.",
  );
  process.exit(1);
}

console.log(
  `SHARED BROWSER SCAN PASSED: one launcher in ${launchers[0]}, profiles derived per employee, ` +
    `and ${prompts.length} employee prompt(s) all name the way in.`,
);
