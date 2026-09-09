#!/usr/bin/env node
/**
 * A SECTION HEADING MAY NOT BE QUIETER THAN THE TEXT IT GOVERNS.
 *
 * ─── Her verdict on Today's Contract, 9 September 2026 ─────────────────────
 *
 * The pillar headers rendered LIGHTER than their own content, the whole block was one flat beige,
 * her gratitude sentence sat at body weight in the middle of it, and `2026-09-09` was printed beside
 * "Wednesday 9 September".
 *
 * She was describing an inverted hierarchy and it was real. The four pillar headers used `.eyebrow`
 * — 11px, `--muted` — while `.row-title` beneath them is weight 500 in full `--ink`. Four section
 * headings, each less visible than the paragraph it governed. Nothing was broken; the wrong element
 * was used, four times, and no test in this repository can see a thing like that.
 *
 * ─── The four rules ────────────────────────────────────────────────────────
 *
 *   1. THE HEADING CLASS EXISTS AND IS FULL-INK. `.pillar` must not resolve to `--muted`, or the
 *      fix is the defect with a new name.
 *   2. THE CONTRACT USES IT. Every pillar header on Today must be `.pillar`, never `.eyebrow`.
 *      `.eyebrow` stays exactly as it is everywhere else — it is a quiet label and it is right.
 *   3. THE SENTENCE IS NOT A PARAGRAPH. `spirit.action` is the one line of her day that is not an
 *      instruction and must render through `.sentence`.
 *   4. THE DATE IS NOT PRINTED TWICE. The contract header must not render `content.day_id` beside
 *      the human label, which said the same thing in a format written for a database key.
 *
 * RULE 0: a missing stylesheet, a missing screen, or zero pillar headings found is a FAILURE.
 *
 *   node scripts/validate/a-heading-outranks-its-content.mjs
 *   node scripts/validate/a-heading-outranks-its-content.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CSS = "src/client/boss/styles.css";
const SCREEN = "src/client/boss/pages/Today.tsx";

/** The four pillars, which are the headings this governs. */
export const PILLARS = ["Body —", "Spirit —", "Wealth —", "Execution —"];

/** A rule body, by class name. */
export function ruleFor(css, cls) {
  const m = new RegExp(`\\n\\.${cls}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[1] : null;
}

export function headingIsMuted(css) {
  const body = ruleFor(css, "pillar");
  if (body === null) return "there is no `.pillar` rule at all";
  if (/color:\s*var\(--muted\)/.test(body)) return "`.pillar` is `--muted`, which is quieter than the `--ink` content beneath it";
  if (!/color:\s*var\(--ink\)/.test(body)) return "`.pillar` never sets `color: var(--ink)`, so it inherits whatever it lands in";
  return null;
}

/** Pillar headings still rendered with the quiet label class. */
export function pillarsStillOnEyebrow(screen) {
  return PILLARS.filter((p) => new RegExp(`className="eyebrow"[^<]*>${p}`).test(screen));
}

export function pillarsMissingTheHeading(screen) {
  return PILLARS.filter((p) => !new RegExp(`className="pillar"[^<]*>${p}`).test(screen));
}

// ─── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const fail = [];
  const say = (name, ok) => { if (!ok) fail.push(name); };

  say("a full-ink heading passes", headingIsMuted("\n.pillar { color: var(--ink); font-size: 18px; }") === null);
  say("a muted heading is caught", headingIsMuted("\n.pillar { color: var(--muted); }") !== null);
  say("a missing rule is caught", headingIsMuted(".eyebrow { color: var(--muted); }") !== null);
  say("a heading with no colour at all is caught", headingIsMuted("\n.pillar { font-size: 18px; }") !== null);

  const bad = '<p className="eyebrow">Body — movement</p><p className="pillar">Spirit — the sentence</p>';
  say("a pillar left on the label class is caught", pillarsStillOnEyebrow(bad).length === 1);
  say("a pillar that never got the heading is caught", pillarsMissingTheHeading(bad).length === 3);

  if (fail.length) {
    console.error("SELF-TEST FAILED:");
    for (const f of fail) console.error("  ✗", f);
    process.exit(1);
  }
  console.log("SELF-TEST PASSED: 6/6 cases — a muted heading, a missing rule and a pillar left on the label class are all caught.");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const problems = [];
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : null);

const css = read(CSS);
const screen = read(SCREEN);
if (!css) problems.push(`${CSS} is missing.`);
if (!screen) problems.push(`${SCREEN} is missing.`);

if (css) {
  const why = headingIsMuted(css);
  if (why) problems.push(`${CSS}: ${why}. A heading quieter than its own content is the defect she reported.`);
  if (!/^\.sentence\s*\{/m.test(css)) {
    problems.push(`${CSS} has no \`.sentence\` rule, so her gratitude line renders at the weight of a hydration reminder.`);
  }
}

if (screen) {
  for (const p of pillarsStillOnEyebrow(screen)) {
    problems.push(`${SCREEN}: "${p}" still uses \`.eyebrow\`, the quiet label class, as a section heading.`);
  }
  for (const p of pillarsMissingTheHeading(screen)) {
    problems.push(`${SCREEN}: "${p}" is not rendered with \`.pillar\`, so it does not outrank its content.`);
  }
  // RULE 0. Zero pillars found means the block has moved and this scan is asking about nothing.
  if (pillarsMissingTheHeading(screen).length === PILLARS.length) {
    problems.push(`${SCREEN} contains none of the four pillar headings — this scan examined nothing.`);
  }
  if (/className="sentence"/.test(screen) === false) {
    problems.push(`${SCREEN} never renders the day's sentence through \`.sentence\`.`);
  }
  if (/className="row-val">\{content\.day_id\}/.test(screen)) {
    problems.push(
      `${SCREEN} prints \`content.day_id\` beside the human date. The same fact twice, once in a ` +
        "format written for a database key.",
    );
  }
}

if (problems.length) {
  console.error("HEADING HIERARCHY SCAN FAILED:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nThe eye must find the section before it reads the section. Nothing else on the screen matters if it cannot.");
  process.exit(1);
}

console.log(
  `HEADING HIERARCHY SCAN PASSED: ${PILLARS.length} pillar headings outrank their content, the ` +
    "day's sentence has its own weight, and the date is printed once.",
);
