#!/usr/bin/env node
/**
 * NO SCREEN ASSERTS SOMETHING ABOUT THE SKY THAT IT DID NOT COMPUTE.
 *
 * ─── Observed live, 9 September 2026 ───────────────────────────────────────
 *
 * Three components on the Spirit tab, one question, two wrong answers:
 *
 *   Top of the page   "New Moon in Virgo — tomorrow, Thursday September 10 at 10:28 PM"
 *   The almanac       lists that moon, marked *computed*
 *   The week block    "No new or full moon this week, so no ritual is suggested"
 *   Could not source  "Moon phase data — SKY.json not present in working directory.
 *                      Cannot determine whether new or full moon falls this week."
 *
 * NEITHER WRONG ANSWER WAS A DATA PROBLEM. `buildAlmanac` computes new and full moons to the minute
 * from Meeus ch. 49 and `astro_calendar` holds them. The week block printed an ASTRONOMICAL claim on
 * the strength of an empty rituals array — what it knew was that a duty had delivered no ritual — and
 * the duty wrote a gap about a missing file for a question the database beside it answers.
 *
 * ─── The three rules ───────────────────────────────────────────────────────
 *
 *   1. A CLAIM ABOUT THE MOON MUST BE NEAR THE COMPUTED ANSWER. Any file under `src/client` that
 *      says "no new or full moon" must also read `moons_this_week`. Saying it from anything else is
 *      saying it from something that does not know.
 *   2. THE ENDPOINT MUST ACTUALLY COMPUTE IT. `routes/spirit.ts` must derive the week's moons from
 *      `astro_calendar` — the same rows the top of the page renders — rather than from a delivery.
 *   3. A GAP THE SYSTEM CAN ANSWER MUST NOT BE PRINTED AS A GAP. The endpoint must filter the
 *      duty's moon-phase gap, because "cannot determine" beside a computed time is worse than
 *      either one alone: it tells her the number she is most likely to act on is unknown.
 *
 * RULE 0: zero client files scanned, or the endpoint missing, is a FAILURE.
 *
 *   node scripts/validate/one-sky-one-answer.mjs
 *   node scripts/validate/one-sky-one-answer.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENDPOINT = "src/worker/boss/routes/spirit.ts";

/** A sentence claiming the sky is quiet. */
const CLAIMS_NO_MOON = /no new or full moon|no moon this week|nothing in the sky this week/i;
/** The computed answer, which is the only thing entitled to make that claim. */
const READS_THE_ALMANAC = /moons_this_week/;

export function unfoundedClaims(files) {
  return files
    .filter((f) => CLAIMS_NO_MOON.test(f.source) && !READS_THE_ALMANAC.test(f.source))
    .map((f) => f.path);
}

export function endpointGaps(src) {
  const gaps = [];
  if (!/FROM astro_calendar[\s\S]{0,200}new_moon/.test(src)) {
    gaps.push("it never reads new and full moons out of astro_calendar, so the week's answer comes from a delivery rather than from the sky");
  }
  if (!/moons_this_week/.test(src)) gaps.push("it never returns `moons_this_week`, so no screen can read the computed answer");
  if (!/MOON_GAP/.test(src)) {
    gaps.push('it never drops the duty\'s "cannot determine whether new or full moon falls this week" gap, which the almanac answers');
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

  say("a claim beside the computed answer is fine", [], unfoundedClaims([
    { path: "ok.tsx", source: "moons.length > 0 ? x : 'No new or full moon this week'; week.moons_this_week" },
  ]));
  say("a claim with nothing behind it is caught", ["bad.tsx"], unfoundedClaims([
    { path: "bad.tsx", source: "rituals.length === 0 ? 'No new or full moon this week' : y" },
  ]));
  say("a file that says nothing about the sky is left alone", [], unfoundedClaims([
    { path: "quiet.tsx", source: "<div>Today</div>" },
  ]));
  say("an endpoint that computes nothing is caught", 3, endpointGaps("export const spirit = new Hono();").length);
  say("a complete endpoint passes", 0, endpointGaps(
    "SELECT kind, starts_at FROM astro_calendar WHERE kind IN ('new_moon','full_moon')\nmoons_this_week: moons,\nconst MOON_GAP = /x/;",
  ).length);

  if (fail.length) {
    console.error("SELF-TEST FAILED:");
    for (const f of fail) console.error("  ✗", f);
    process.exit(1);
  }
  console.log("SELF-TEST PASSED: 5/5 cases — an unfounded claim and an endpoint that computes nothing are both caught.");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const walk = (dir, out = []) => {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
};

const files = walk("src/client").map((p) => ({ path: p, source: readFileSync(join(ROOT, p), "utf8") }));
const problems = [];

// RULE 0.
if (files.length === 0) problems.push("no client files were scanned at all — the tree has moved and this scan is broken.");

for (const p of unfoundedClaims(files)) {
  problems.push(
    `${p} says the sky is quiet this week without reading \`moons_this_week\`. ` +
      "That is an astronomical claim standing in for an empty array, and it contradicted the top of its own page.",
  );
}

if (!existsSync(join(ROOT, ENDPOINT))) {
  problems.push(`${ENDPOINT} is missing — the computed answer has nowhere to come from.`);
} else {
  for (const g of endpointGaps(readFileSync(join(ROOT, ENDPOINT), "utf8"))) problems.push(`${ENDPOINT}: ${g}.`);
}

if (problems.length) {
  console.error("ONE-SKY-ONE-ANSWER SCAN FAILED:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nThe almanac computes new and full moons to the minute. Anything on a screen that disagrees with\n" +
      "it is not a second opinion; it is the same page contradicting itself about tomorrow.",
  );
  process.exit(1);
}

console.log(
  `ONE-SKY-ONE-ANSWER SCAN PASSED: ${files.length} client file(s) scanned, every claim about the ` +
    "week's moons reads the computed almanac, and the answerable gap is dropped rather than printed.",
);
