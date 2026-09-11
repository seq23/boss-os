#!/usr/bin/env node
/**
 * EVERY KDP MESSAGE ENDS IN A NAMED OUTCOME. NONE IS READ AND DROPPED.
 *
 * ─── Her instruction ────────────────────────────────────────────────────────
 *
 *   "EVERYTIME I GET A KDP EMAIL SHE SHOULD READ IT AND DETERMINE IF THERE IS A TASK FOR HER"
 *
 * ─── The defect class ───────────────────────────────────────────────────────
 *
 * `kdp_mail_log` recorded a disposition and a note, and `action_taken` was NULLABLE. So a message
 * could be read, classified, written down, and end nowhere — and the row looked complete. It is the
 * same shape as the audit emails that carried counts and no URLs, and the same shape as the
 * approval that was stamped `executed` having done nothing: a record that proves the reading
 * happened and says nothing about whether anything followed.
 *
 * ─── Three outcomes, and "nothing" being one of them is the point ───────────
 *
 *   acted     — Simone did something. `action_taken` says what.
 *   assigned  — she opened work; a colleague through /assign, or something in her own queue.
 *   noted     — nothing to do, AND THE REASON IS WRITTEN DOWN.
 *
 * `noted` is not a loophole. Promotional mail SHOULD end in nothing; the difference between
 * DECIDING that and FORGETTING is whether a reason exists. So an outcome with no `action_taken` is
 * refused exactly as a missing note is.
 *
 * ─── What this checks, in the code rather than in a prompt ──────────────────
 *
 *   1. The endpoint requires an outcome on every item, from a closed set with no default. A default
 *      would silently classify every un-triaged message as whatever the default is.
 *   2. The endpoint requires `action_taken` on every item, including `noted`.
 *   3. A `problem` may not end in `noted`. "if something is wrong w/one of my titles she needs to
 *      spring into action" — so the one disposition meaning something is wrong is the one that
 *      cannot be noted and dropped.
 *   4. The prompt the local run follows tells it to produce all three fields, so the run is capable
 *      of satisfying the endpoint rather than being rejected at 09:30 every day.
 *   5. The column exists and the reader returns it, because an outcome nothing renders is one she
 *      cannot check.
 *
 * RULE 0: examining zero messages — that is, finding no enforcement to examine — is a FAILURE.
 *
 *   node scripts/validate/every-kdp-message-ends-somewhere.mjs
 *   node scripts/validate/every-kdp-message-ends-somewhere.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const ROUTE = "src/worker/boss/routes/kdp.ts";
const PROMPT = "scripts/ops/kdp-surface-prompt.md";
const REPORTER = "scripts/ops/kdp-surface-report.mjs";

/** The body of the POST /mail handler, bounded, so a check cannot be satisfied by another route. */
export function mailHandler(source) {
  const start = source.indexOf('kdp.post("/mail"');
  if (start === -1) return null;
  const end = source.indexOf('kdp.get("/mail"', start);
  return source.slice(start, end === -1 ? source.length : end);
}

/** The outcome values a closed set declares, in the shape this repo writes them. */
export function outcomeValues(source) {
  const m = /OUTCOME_KINDS\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(source);
  if (!m) return [];
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

function scan() {
  const problems = [];
  const checks = [];

  for (const f of [ROUTE, PROMPT, REPORTER]) {
    if (!existsSync(join(ROOT, f))) {
      problems.push(`${f} does not exist, so there is nothing enforcing that a message ends anywhere.`);
      return { checks, problems };
    }
  }

  const route = read(ROUTE);
  const handler = mailHandler(route);
  if (!handler) {
    problems.push(`${ROUTE} has no POST /mail handler this scan can read. That is a broken scan, not a clean file.`);
    return { checks, problems };
  }

  // 1. A closed set, with the three outcomes, and no default.
  const values = outcomeValues(route);
  checks.push("closed outcome set");
  if (values.length === 0) {
    problems.push(`${ROUTE} declares no OUTCOME_KINDS set, so any string would be accepted as an outcome.`);
  } else {
    for (const need of ["acted", "assigned", "noted"]) {
      if (!values.includes(need)) problems.push(`${ROUTE} does not offer "${need}" as an outcome, so a message that ends that way has nowhere to be recorded.`);
    }
  }
  /*
   * ── THE GUARD MUST GUARD, NOT MERELY APPEAR ──────────────────────────────
   *
   * The first draft tested only that `OUTCOME_KINDS.has(outcome)` appeared somewhere in the
   * handler, and its own negative proof exposed it: prefixing the condition with `false &&`
   * disabled the check completely AND THE VALIDATOR STAYED GREEN. A validator that a one-word edit
   * can neuter is decoration, and it would have passed for ever over a handler that accepted
   * anything.
   *
   * So the shape is required: a NEGATED test that THROWS. The throw has to be within a short window
   * of the condition, or an unrelated later throw would vouch for a guard that returns nothing.
   */
  const guard = /if\s*\(\s*!\s*OUTCOME_KINDS\.has\(outcome\)\s*\)\s*\{/.exec(handler);
  if (!guard) {
    problems.push(
      `POST /mail has no \`if (!OUTCOME_KINDS.has(outcome))\` guard, so a message can still end nowhere. ` +
      `The condition appearing inside some other expression is not a guard.`,
    );
  } else {
    /*
     * BOUNDED TO THE GUARD'S OWN BLOCK, because a fixed character window let the NEXT check's throw
     * vouch for this one — emptying this block kept the validator green, which the negative proof
     * caught. The block ends at the first close brace on the guard's own indentation.
     */
    const after = handler.slice(guard.index);
    const close = after.indexOf("\n    }");
    const block = close === -1 ? after : after.slice(0, close);
    if (!/throw badRequest/.test(block)) {
      problems.push(`POST /mail tests the outcome and does not throw on a bad one, so the check decides nothing.`);
    }
  }
  /*
   * A DEFAULT IS A FALLBACK TO A REAL OUTCOME, NOT A FALLBACK TO THE EMPTY STRING.
   *
   * The first draft flagged `String(raw?.outcome_kind ?? "")` — which is the opposite of a default:
   * coercing a missing value to "" is what makes the closed-set check REJECT it. Matching on `??`
   * alone would have forced the code to be written worse to satisfy the validator.
   */
  if (new RegExp(`outcome_kind\\s*\\?\\?\\s*["'](${values.join("|") || "x^"})["']`).test(handler)) {
    problems.push(
      `POST /mail defaults the outcome when one is missing. A default silently classifies every ` +
      `un-triaged message as whatever the default is, which is the dropping this exists to stop.`,
    );
  }

  // 2. An outcome without an account of itself is not an outcome.
  checks.push("action_taken required on every outcome");
  if (!/if \(!action\)/.test(handler)) {
    problems.push(
      `POST /mail accepts an item with no action_taken. Even "nothing to do" needs its reason — ` +
      `deciding a message is promotional and forgetting to read it look identical without one.`,
    );
  }

  // 3. A problem cannot be noted and dropped.
  checks.push("a problem may not end in 'nothing to do'");
  if (!/disposition === "problem" && outcome === "noted"/.test(handler)) {
    problems.push(
      `POST /mail lets a "problem" disposition end in "noted". Her instruction is that a title in ` +
      `trouble gets acted on without her being asked first; a problem noted and dropped is the ` +
      `opposite of that, recorded as compliance.`,
    );
  }

  // 4. The run can actually produce what the endpoint demands.
  checks.push("the prompt produces an outcome");
  const prompt = read(PROMPT);
  if (!/outcome_kind/.test(prompt)) {
    problems.push(
      `${PROMPT} never mentions outcome_kind, so the daily run will post items the endpoint refuses ` +
      `and the triage will fail at 09:30 every day with a 400 in a log nobody reads.`,
    );
  }
  for (const need of ["acted", "assigned", "noted"]) {
    if (!prompt.includes(need)) {
      problems.push(`${PROMPT} does not tell the run that "${need}" is an available outcome, so it cannot use it.`);
    }
  }

  // 5. Stored and rendered — an outcome nothing shows is one she cannot check.
  checks.push("the outcome is stored and returned");
  if (!/INSERT INTO kdp_mail_log[\s\S]{0,400}outcome_kind/.test(handler)) {
    problems.push(`POST /mail validates an outcome and does not store it. A guard that discards what it checked is decoration.`);
  }
  const migrations = readdirSync(join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => read(`migrations/${f}`)).join("\n");
  if (!/ALTER TABLE kdp_mail_log ADD COLUMN outcome_kind/.test(migrations)) {
    problems.push(`No migration adds kdp_mail_log.outcome_kind, so the INSERT would fail against the real database.`);
  }
  const reader = route.slice(route.indexOf('kdp.get("/mail"'));
  if (!/outcome_kind/.test(reader.slice(0, 900))) {
    problems.push(`GET /mail does not return outcome_kind, so an outcome is recorded where she cannot read it.`);
  }

  return { checks, problems };
}

// ─── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  let failed = 0;

  const src = `kdp.post("/mail", async (c) => { const x = 1; });\nkdp.get("/mail", async (c) => { const y = 2; });`;
  const h = mailHandler(src);
  if (!h || !h.includes("const x") || h.includes("const y")) {
    console.error("  ✗ the POST /mail handler is not bounded — a GET's code would satisfy a POST's check");
    failed += 1;
  }

  if (mailHandler("no handler here") !== null) {
    console.error("  ✗ a missing handler should be null rather than the whole file");
    failed += 1;
  }

  const vals = outcomeValues(`const OUTCOME_KINDS = new Set(["acted", "assigned", "noted"]);`);
  if (JSON.stringify(vals) !== JSON.stringify(["acted", "assigned", "noted"])) {
    console.error(`  ✗ outcome values not parsed, got ${JSON.stringify(vals)}`);
    failed += 1;
  }

  if (outcomeValues("no set at all").length !== 0) {
    console.error("  ✗ an absent set should parse as no values rather than throwing");
    failed += 1;
  }

  if (failed) {
    console.error(`\nSELF-TEST FAILED: ${failed} case(s)`);
    process.exit(1);
  }
  console.log("SELF-TEST PASSED: 4/4 cases.");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const { checks, problems } = scan();

/*
 * RULE 0. Finding nothing to examine is not a pass. If the handler, the prompt or the column can no
 * longer be found, this validator has stopped guarding anything and must say so loudly rather than
 * returning the same green it returned when everything was fine.
 */
if (checks.length === 0) {
  console.error(
    "KDP OUTCOME SCAN EXAMINED NOTHING. The mail handler, the prompt or the column is no longer shaped\n" +
    "the way this scan reads it. That is a broken scan, not a repository where every message lands.",
  );
  process.exit(2);
}

if (problems.length > 0) {
  console.error("KDP OUTCOME SCAN FAILED:\n");
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  console.error(
    "A message read and silently dropped is the defect. Every one ends in something Simone did,\n" +
    "something she opened, or an explicit nothing with a reason attached.",
  );
  process.exit(1);
}

console.log(
  `KDP OUTCOME SCAN PASSED: ${checks.length} enforcement points — every message must end in acted, ` +
  `assigned or noted-with-a-reason, a problem may not end in nothing, and the run is told how.`,
);
selfTest();
