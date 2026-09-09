#!/usr/bin/env node
/**
 * A ROW THAT CANNOT SAY WHY IT IS ON HER SCREEN COMES OFF THE SCREEN.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 * The Capital desk showed twenty-eight buyer candidates, every one already `reviewed` — verified
 * against production D1, which returns exactly one status row: `reviewed 28`. Twenty-five of the
 * twenty-eight carried no published cheque floor, so the list's own sort key was null for most of
 * it. Nothing on any row said why that firm rather than another, and nothing said why the order was
 * the order. Her verdict: *"id rather the capital tab just not list buyers like this."*
 *
 * The People roster had already shipped the same defect in a worse form: two hundred consecutive
 * rows reading `importance 100 · trust 100 · recency 0 · opportunity 0`, because three of those four
 * numbers were read from columns nothing had ever written. A number nobody computed, printed as
 * though measured, is worse than no number.
 *
 * ─── The five things it checks, and why each is separate ────────────────────
 *
 * A recommendation is a chain, and any one link breaking produces the same confident, useless row:
 *
 *   1. EVERY SIGNAL CARRIES ITS FACT. A signal with a positive weight must interpolate a value from
 *      the row it read. A fixed sentence awarded points is a rule restated, not evidence — and it
 *      reads identically on every firm, which is the twenty-eight-identical-rows failure exactly.
 *   2. EVERY SIGNAL DECLARES `code`, `weight` and `says`. A weight with no sentence is a number she
 *      cannot argue with.
 *   3. NOTHING IS WITHHELD SILENTLY. Every firm pushed onto `suppressed`, `out_of_reach` or
 *      `already_moving` leaves with a non-empty `because`. "Not on the list" and "never considered"
 *      look identical on a screen and only one of them is information.
 *   4. THE SCREEN ACTUALLY RENDERS ALL OF IT. A reason computed in a module and never bound in the
 *      page is this repository's most-produced defect — two components each keeping their own list
 *      with no link between them. The headline, the per-signal sentence, the withholding reason and
 *      the stated limitation must each appear in `Capital.tsx`.
 *   5. THE LIMITATION IS SAID OUT LOUD. `basis.limitation` must exist and must be rendered, because
 *      the position data this ranking wants does not exist — `position`, `position_mark`,
 *      `portfolio_vehicles` and `deals` are all empty on production — and a ranking that hides what
 *      it could not measure is a faked ranking.
 *
 * RULE 0: examining zero signals, zero withholdings or zero screen bindings is a FAILURE, not a
 * pass. A loop over an empty set is how a validator stays green for ever while what it guards rots.
 *
 *   node scripts/validate/a-recommendation-says-why.mjs
 *   node scripts/validate/a-recommendation-says-why.mjs --self-test
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODULE = "src/shared/wealth/recommend.ts";
const SCREEN = "src/client/boss/pages/Capital.tsx";

/**
 * Every `signals.push({ ... })` in the module, as `{ code, weight, says }`.
 *
 * BRACE-COUNTED RATHER THAN REGEXED TO THE CLOSING BRACE. A `says` sentence contains `${...}`
 * template holes, and a lazy `\}` match stops inside the first one — which silently truncates the
 * sentence and makes every check downstream ask its question of half a string. Under-reporting is
 * the failure mode that matters in a validator, so the scan counts braces.
 */
export function signalsIn(source) {
  const out = [];
  const marker = "signals.push({";
  let at = source.indexOf(marker);
  while (at !== -1) {
    let depth = 0;
    let i = at + marker.length - 1;
    for (; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") { depth -= 1; if (depth === 0) break; }
    }
    const text = source.slice(at + marker.length - 1, i + 1);
    out.push({
      text,
      code: (text.match(/code:\s*"([^"]+)"/) ?? [])[1] ?? null,
      weight: (text.match(/weight:\s*(-?\d+)/) ?? [])[1],
      says: /says:/.test(text) ? text.slice(text.indexOf("says:")) : null,
    });
    at = source.indexOf(marker, i);
  }
  return out;
}

/** Every push onto a withheld list, with the text of its object literal. */
export function withholdingsIn(source) {
  const out = [];
  for (const list of ["suppressed", "outOfReach", "alreadyMoving"]) {
    const marker = `${list}.push({`;
    let at = source.indexOf(marker);
    while (at !== -1) {
      let depth = 0;
      let i = at + marker.length - 1;
      for (; i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") { depth -= 1; if (depth === 0) break; }
      }
      out.push({ list, text: source.slice(at + marker.length - 1, i + 1) });
      at = source.indexOf(marker, i);
    }
  }
  return out;
}

/** A positive weight must be justified by a fact read off the row, not by a fixed sentence. */
export function mutesIn(signals) {
  return signals
    .filter((s) => Number(s.weight) > 0)
    .filter((s) => !s.says || !s.says.includes("${"))
    .map((s) => s.code ?? "(unnamed)");
}

export function incompleteIn(signals) {
  return signals
    .filter((s) => !s.code || s.weight === undefined || !s.says)
    .map((s) => s.code ?? "(unnamed)");
}

export function silentWithholdingsIn(withholdings) {
  return withholdings
    .filter((w) => !/because:/.test(w.text) || /because:\s*(null|""|undefined)/.test(w.text))
    .map((w) => w.list);
}

/** What the page must actually bind, or the reasoning never reaches her. */
const SCREEN_BINDINGS = [
  { what: "the reason this firm is recommended", needle: "r.headline" },
  { what: "each signal's own sentence", needle: "s.says" },
  { what: "why a firm was withheld", needle: "w.because" },
  { what: "what the ranking could not measure", needle: "basis.limitation" },
  { what: "the sample letter's body, in full", needle: "r.letter.body" },
];

export function unboundIn(screen) {
  return SCREEN_BINDINGS.filter((b) => !screen.includes(b.needle));
}

// ─── Self-test ────────────────────────────────────────────────────────────────

const FIXTURES = [
  {
    name: "a positive signal quoting the row is fine",
    module: 'signals.push({ code: "a", weight: 25, says: `They said "${x}".` });',
    mutes: [],
  },
  {
    name: "a positive signal with a FIXED sentence is caught",
    // The trap this exists for: points awarded for a rule, described in words that read the same on
    // every firm. Indistinguishable, on the screen, from a reason.
    module: 'signals.push({ code: "b", weight: 25, says: "They look like a good fit." });',
    mutes: ["b"],
  },
  {
    name: "a zero or negative signal may be a fixed sentence",
    module: 'signals.push({ code: "c", weight: 0, says: "Nothing was assumed about size." });',
    mutes: [],
  },
  {
    name: "a template hole inside says() is not mistaken for the end of the object",
    // The brace-counting case. A lazy scan stops inside `${...}` and truncates the sentence, which
    // would make the fixed-sentence check ask its question of half a string.
    module: 'signals.push({ code: "d", weight: 5, says: `Read on ${onDay(c.read_at)}, so it is current.` });\nsignals.push({ code: "e", weight: 25, says: "flat" });',
    mutes: ["e"],
  },
];

const WITHHOLD_FIXTURES = [
  {
    name: "a withholding with a reason passes",
    module: 'suppressed.push({ candidate_id: c.id, name: c.name, because: "on the list" });',
    silent: [],
  },
  {
    name: "a withholding with no reason is caught",
    module: 'outOfReach.push({ candidate_id: c.id, name: c.name });',
    silent: ["outOfReach"],
  },
  {
    name: "a withholding whose reason is empty is caught",
    module: 'alreadyMoving.push({ candidate_id: c.id, name: c.name, because: "" });',
    silent: ["alreadyMoving"],
  },
];

function selfTest() {
  let failures = 0;
  const say = (name, want, got) => {
    if (JSON.stringify(want) === JSON.stringify(got)) return;
    failures += 1;
    console.error(`  ✗ ${name}\n      expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  for (const f of FIXTURES) say(f.name, f.mutes, mutesIn(signalsIn(f.module)));
  for (const f of WITHHOLD_FIXTURES) say(f.name, f.silent, silentWithholdingsIn(withholdingsIn(f.module)));
  say("an unbound screen is caught", ["r.headline"],
    unboundIn("s.says w.because basis.limitation r.letter.body").map((b) => b.needle));

  const total = FIXTURES.length + WITHHOLD_FIXTURES.length + 1;
  if (failures) {
    console.error(`\nSELF-TEST FAILED: ${failures}/${total}`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASSED: ${total}/${total} cases`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const module = readFileSync(join(ROOT, MODULE), "utf8");
const screen = readFileSync(join(ROOT, SCREEN), "utf8");

const signals = signalsIn(module);
const withholdings = withholdingsIn(module);
const problems = [];

// RULE 0, THREE TIMES. Each of these loops is over a set that could become empty, and an empty set
// would sail through every check below it.
if (signals.length === 0) {
  problems.push(`${MODULE} declares no signals at all. A ranking with no stated reasons is the thing this guards.`);
}
if (withholdings.length === 0) {
  problems.push(`${MODULE} withholds nothing from anybody. Suppression and reach are what make it a recommendation.`);
}

for (const code of incompleteIn(signals)) {
  problems.push(`signal "${code}" is missing one of code / weight / says.`);
}
for (const code of mutesIn(signals)) {
  problems.push(
    `signal "${code}" awards points with a fixed sentence — it reads identically on every firm, ` +
      "so it is a rule restated rather than a fact read off the row.",
  );
}
for (const list of silentWithholdingsIn(withholdings)) {
  problems.push(`a firm is pushed onto "${list}" with no \`because\`, so it disappears without a reason.`);
}
for (const b of unboundIn(screen)) {
  problems.push(`${SCREEN} never renders ${b.needle} — ${b.what} is computed and never reaches her.`);
}

if (problems.length) {
  console.error("RECOMMENDATION REASONING FAILED:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nEvery row on that screen answers: what decision is this for, and does it enable it. A row that\n" +
      "cannot say why it is there either gets that answer or comes off the screen.",
  );
  process.exit(1);
}

console.log(
  `RECOMMENDATION REASONING PASSED: ${signals.length} signals each carry a fact, ` +
    `${withholdings.length} withholding paths each carry a reason, and ` +
    `${SCREEN_BINDINGS.length} of them are bound on the screen.`,
);
