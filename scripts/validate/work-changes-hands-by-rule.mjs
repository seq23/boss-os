#!/usr/bin/env node
/**
 * WORK CAN CHANGE HANDS, AND A RULE DECIDES IT — NOT A MODEL.
 *
 * ─── The capability that did not exist ─────────────────────────────────────
 *
 * 12 September 2026: "please help me find a seller of $1B+ of OpenAI shares. Route this to whomever
 * should handle this." No tag, so it DEFAULTED to the Chief of Staff and stayed there. Grepping the
 * repository for a statement that changes `tasks.employee_id` returned exactly ONE hit, inside
 * employee merge. Handing work to a colleague was not slow or broken. It did not exist.
 *
 * ─── And why it is keywords ────────────────────────────────────────────────
 *
 * The same message, handed to a language model, produced "Classification: General Inquiry. Routing:
 * Route to Customer Service Team." — a department this company does not have, for a request to place
 * a billion dollars of stock. A model picking the seat IS the defect. So the rule is deterministic,
 * it runs before any model, and it is allowed to be narrow.
 *
 * ─── How it is proven ───────────────────────────────────────────────────────
 *
 * BEHAVIOUR, by calling `handoffFor` and `seatInDepartment` — the functions the intake calls — over
 * her real sentence and over the ordinary mail that must NOT move. And the roster half is resolved
 * against the shipped migrations REPLAYED into in-memory SQLite, so "Relationships is emp_relationship"
 * is asked of the employees table rather than hardcoded here.
 *
 * STRUCTURE, on the two files, for what a pure function cannot show: that the handoff runs above
 * `admitTask` so no model ever sees the wrong desk, and that the endpoint reads the seat from
 * `employees`, writes the audit row, and refuses a handoff with no reason.
 *
 * AND THE GREP THAT STARTED IT, kept as a rule: `tasks.employee_id` may be reassigned in exactly two
 * places — employee merge, and the handoff endpoint. A third would be an unaudited way to move work.
 *
 * RULE 0: zero cases and an empty roster are both FAILURES.
 *
 *   node scripts/validate/work-changes-hands-by-rule.mjs
 *   node scripts/validate/work-changes-hands-by-rule.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { handoffFor, seatInDepartment, huntRequestIn, HOLDING_DEPARTMENT } from "../../src/shared/boss/intake/handoff.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INTAKE = "src/worker/boss/intake/inboundMail.ts";
const API = "src/worker/boss/routes/tasks.ts";
const MERGE = "src/worker/boss/routes/employees.ts";

/** HER MESSAGE, verbatim — `iml_m2az871dxk00t729`. */
const HERS = "please help me find a seller of $1B+ of OpenAI shares. Route this to whomever should handle this.";

/** The roster, replayed out of the shipped migrations and asked the intake's own question. */
export function rosterFromMigrations(dir = join(ROOT, "migrations")) {
  const db = new DatabaseSync(":memory:");
  const failed = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    try { db.exec(readFileSync(join(dir, f), "utf8")); }
    catch (e) { failed.push(`${f}: ${e.message.split("\n")[0]}`); }
  }
  return db.prepare(
    `SELECT id, name, role, lane, department FROM employees
      WHERE status = 'active' AND lifecycle IN ('active','provisional')
      ORDER BY created_at`,
  ).all().map((r) => ({ ...r }));
}

/** `[what it is, input, the department expected or null]`. */
const CASES = [
  ["HER REAL MESSAGE is handed to the Relationships desk",
    { text: HERS, subject: "", fromDepartment: HOLDING_DEPARTMENT }, "Relationships"],
  ["a sell-side instruction with no dollar size still moves",
    { text: "can you find buyers for the Databricks block", subject: "", fromDepartment: HOLDING_DEPARTMENT }, "Relationships"],
  ["a dollar size on its own is enough — she does not write $1B about anything else",
    { text: "the $500M one from Tuesday, please pick it up", subject: "", fromDepartment: HOLDING_DEPARTMENT }, "Relationships"],
  ["the instruction in the SUBJECT counts, because that is where she often puts it",
    { text: "", subject: "find a seller of OpenAI shares", fromDepartment: HOLDING_DEPARTMENT }, "Relationships"],

  // THE OTHER DIRECTION, which is the half that keeps this honest.
  ["a desk SHE NAMED is never overruled",
    { text: HERS, subject: "#simone", fromDepartment: "Records" }, null],
  ["ordinary mail on the holding desk does not move",
    { text: "can you book me a flight to Chicago on Tuesday", subject: "", fromDepartment: HOLDING_DEPARTMENT }, null],
  ["a word from one group alone is not a signal",
    { text: "please find the deck from last week", subject: "", fromDepartment: HOLDING_DEPARTMENT }, null],
  ["a message about shares with no instruction in it does not move",
    { text: "here are the share certificates, for the file", subject: "", fromDepartment: HOLDING_DEPARTMENT }, null],
  ["an empty message does not move",
    { text: "", subject: "", fromDepartment: HOLDING_DEPARTMENT }, null],
  ["the tag itself is never a keyword",
    { text: "#monique", subject: "", fromDepartment: HOLDING_DEPARTMENT }, null],
];

export function theRuleDecides(rule = handoffFor) {
  const bad = [];
  for (const [label, input, expected] of CASES) {
    const got = rule(input);
    const dept = got?.department ?? null;
    if (dept !== expected) {
      bad.push(`${label}: expected ${expected ?? "no handoff"}, got ${dept ?? "no handoff"}.`);
      continue;
    }
    if (got && !got.matched?.length) {
      bad.push(`${label}: handed off without naming a single word it matched on — that is a guess with a sentence attached.`);
    }
    if (got && !got.why) bad.push(`${label}: handed off with no reason, so the audit row cannot say why.`);
  }
  return bad;
}

/** Rule: the destination is a real seat, resolved from the employees table. */
export function theSeatComesFromTheRoster(roster) {
  const bad = [];

  /* RULE 0. An empty roster would make every lookup return null and every case above pass. */
  if (!roster || roster.length === 0) {
    return ["the replayed migrations produce no active employees, so no handoff destination was actually resolved."];
  }

  const holding = seatInDepartment(roster, HOLDING_DEPARTMENT);
  if (!holding) {
    bad.push(`no active seat is in "${HOLDING_DEPARTMENT}", so the desk this rule moves work OFF does not exist.`);
  }

  const handoff = handoffFor({ text: HERS, fromDepartment: HOLDING_DEPARTMENT });
  if (!handoff) return [...bad, "her own message no longer produces a handoff at all."];

  const seat = seatInDepartment(roster, handoff.department);
  if (!seat) {
    bad.push(
      `the rule names the ${handoff.department} department and no active employee is in it. `
      + "A handoff to an empty desk is worse than no handoff.",
    );
  } else if (holding && seat.id === holding.id) {
    bad.push("the handoff resolves back to the desk it is moving work off, so it does nothing.");
  }

  // An unknown department resolves to nothing rather than to the first seat in the list.
  if (seatInDepartment(roster, "Customer Service Team")) {
    bad.push('"Customer Service Team" resolved to a seat. That is the department the model invented; it does not exist here.');
  }
  if (seatInDepartment(roster, "")) bad.push("an empty department name resolved to a seat, so a blank rule would silently reassign work.");
  return bad;
}

/**
 * `[what it is, her sentence, the hunt expected or null]`.
 *
 * A handoff moves the work to the right desk; this says what the work IS. `buyer-hunt.mjs` has taken
 * `--asset`, `--size` and `--side` all along and was reachable from exactly one place: somebody
 * typing `npm run capital:buyers`.
 */
const HUNT_CASES = [
  ["HER REAL SENTENCE parses to an asset, a size and a side", HERS, { asset: "OpenAI", size_usd: 1e9, side: "sell" }],
  ["the tagged short form she was told to use", "#monique find me a seller of $1B+ OpenAI",
    { asset: "OpenAI", size_usd: 1e9, side: "sell" }],
  ["the other direction", "can you find buyers for the Databricks block, $20M",
    { asset: "Databricks", size_usd: 2e7, side: "buy" }],
  ["a size written as words", "find me a seller of $600 million Anthropic",
    { asset: "Anthropic", size_usd: 6e8, side: "sell" }],

  // IT REFUSES RATHER THAN GUESSES. A hunt run against an asset nobody named is a real search over
  // nothing, reported as a quiet week.
  ["no size means no hunt", "find a seller of OpenAI shares", null],
  ["no side means no hunt — the direction is never assumed", "what about the $1B of OpenAI", null],
  ["no asset means no hunt", "find me a seller for $1B of it", null],
  ["ordinary mail is not a hunt", "can you book me a flight to Chicago on Tuesday", null],
];

/** Rule: her sentence becomes the exact arguments the hunt script takes. */
export function theRequestBecomesAHunt(parse = huntRequestIn) {
  const bad = [];
  for (const [label, text, expected] of HUNT_CASES) {
    const got = parse(text);
    if (expected === null) {
      if (got) bad.push(`${label}: parsed to ${JSON.stringify(got)} — a hunt invented from a sentence that did not ask for one.`);
      continue;
    }
    if (!got) { bad.push(`${label}: parsed to nothing, so the search never runs and the request sits as a paragraph on a card.`); continue; }
    for (const k of ["asset", "size_usd", "side"]) {
      if (got[k] !== expected[k]) bad.push(`${label}: ${k} was ${JSON.stringify(got[k])}, expected ${JSON.stringify(expected[k])}.`);
    }
  }
  return bad;
}

/** Rule: the intake hands off BEFORE any model, and the API can do it on demand. */
export function theCodeDoesIt(intake, api, merge) {
  const bad = [];
  if (intake === null) return [`${INTAKE} could not be read, so the live intake path is unverified.`];
  if (api === null) return [`${API} could not be read, so the handoff endpoint is unverified.`];

  // ── The intake ────────────────────────────────────────────────────────────
  if (!/handoffFor\(/.test(intake)) {
    bad.push(`${INTAKE} never calls handoffFor(), so a message with no tag still stops at the first desk it lands on.`);
  }
  if (!/seatInDepartment\(roster/.test(intake)) {
    bad.push(`${INTAKE} does not resolve the destination out of the roster it read from D1 — a hardcoded seat is a second list of who works here.`);
  }
  const handoffAt = intake.indexOf("handoffFor(");
  const admitAt = intake.indexOf("await admitTask(");
  if (handoffAt !== -1 && admitAt !== -1 && handoffAt > admitAt) {
    bad.push("the handoff runs AFTER admitTask, so a model has already been given the work on the wrong desk. Routing decided after the fact is not routing.");
  }
  if (!/action: "handed_off"/.test(intake)) {
    bad.push(`${INTAKE} moves the message to another desk without an audit row, so a reassignment cannot be found later.`);
  }

  /*
   * ─── AND THE HUNT REACHES THE SCRIPT THAT DOES IT ────────────────────────
   * `input.hunt` is the argument list; `buyer-hunt.mjs --from-boss` is what picks it up; and
   * `POST /:id/hunt-result` is what stops the task sitting queued for ever once it has run.
   */
  if (!/huntRequestIn\(/.test(intake)) {
    bad.push(`${INTAKE} never parses a hunt request, so "find me a seller of $1B+ OpenAI" is a paragraph on a card and nothing more.`);
  }
  if (!/\.\.\.\(hunt \? \{ hunt \} : \{\}\)/.test(intake)) {
    bad.push(`${INTAKE} does not put the hunt on the task input, so the script has nothing to pick up.`);
  }

  // ── The endpoint ──────────────────────────────────────────────────────────
  if (!/tasks\.post\("\/:id\/handoff"/.test(api)) {
    bad.push(`${API} has no handoff route, so the only way to move work is the one the intake does automatically.`);
  }
  if (!/UPDATE tasks SET employee_id = \? WHERE id = \?/.test(api)) {
    bad.push(`${API} never reassigns tasks.employee_id, so the endpoint does not actually hand the work over.`);
  }
  if (!/FROM employees[\s\S]{0,200}status = 'active'/.test(api)) {
    bad.push(`${API} does not check that the destination is an ACTIVE employee — handing work to a retired seat looks exactly like it worked.`);
  }
  if (!/action: "handed_off"/.test(api)) {
    bad.push(`${API} writes no audit_log row for a handoff.`);
  }
  if (!/A handoff needs a reason/.test(api)) {
    bad.push(`${API} allows a handoff with no reason, so a task can change hands with nothing on the record about why.`);
  }
  if (!/tasks\.post\("\/:id\/hunt-result"/.test(api)) {
    bad.push(`${API} has nowhere for a finished hunt to land, so a hunt that RAN leaves its task queued for ever.`);
  }

  /*
   * ─── THE GREP THAT STARTED THIS, AS A RULE ────────────────────────────────
   * Exactly two files may reassign `tasks.employee_id`: employee merge, and the handoff endpoint.
   */
  const reassign = /UPDATE tasks SET employee_id/;
  if (merge !== null && !reassign.test(merge)) {
    bad.push(`${MERGE} no longer reassigns tasks on a merge, which means merged work is being orphaned.`);
  }
  return bad;
}

/** Every other file that reassigns `tasks.employee_id` — there must be none. */
export function noThirdWayToMoveWork(files) {
  const allowed = new Set([API, MERGE]);
  const bad = [];
  let scanned = 0;
  for (const [rel, source] of files) {
    scanned += 1;
    if (allowed.has(rel)) continue;
    if (/UPDATE\s+tasks\s+SET[^;]{0,200}employee_id\s*=/is.test(source)) {
      bad.push(`${rel} reassigns tasks.employee_id outside the two audited paths, so work can move with no record.`);
    }
  }
  if (scanned === 0) bad.push("no source files were scanned, so 'there is no third way' was not actually checked.");
  return bad;
}

/** Every .ts under src/worker, as [relative path, source]. */
function workerSources(dir = join(ROOT, "src", "worker"), out = [], base = ROOT) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) workerSources(p, out, base);
    else if (e.name.endsWith(".ts")) out.push([p.slice(base.length + 1), readFileSync(p, "utf8")]);
  }
  return out;
}

// ─── Self-test ───────────────────────────────────────────────────────────────

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);
const intakeSource = read(INTAKE);
const apiSource = read(API);
const mergeSource = read(MERGE);

if (process.argv.includes("--self-test")) {
  let failed = 0;
  const expect = (label, actual, shouldCatch) => {
    if ((actual.length > 0) !== shouldCatch) {
      console.error(`  ✗ ${label} — expected ${shouldCatch ? "caught" : "clean"}, got ${JSON.stringify(actual)}`);
      failed += 1;
    } else console.log(`  ✓ ${label}`);
  };

  const roster = rosterFromMigrations();
  expect("the real rule moves her message and leaves ordinary mail alone", theRuleDecides(), false);
  expect("the destination resolves out of the replayed roster", theSeatComesFromTheRoster(roster), false);
  expect("the intake and the endpoint both do it", theCodeDoesIt(intakeSource, apiSource, mergeSource), false);
  expect("her sentence becomes the hunt's arguments", theRequestBecomesAHunt(), false);
  expect("there is no third way to move work", noThirdWayToMoveWork(workerSources()), false);

  /*
   * ─── THE NEGATIVE PROOF ───────────────────────────────────────────────────
   */
  expect("a rule that never hands anything off — the state on 12 September", theRuleDecides(() => null), true);
  expect("a rule that hands off EVERYTHING, which is the hallucination with a regex",
    theRuleDecides(() => ({ department: "Relationships", why: "everything is relationships", matched: ["*"] })), true);
  expect("a rule that overrules a desk she named",
    theRuleDecides((i) => (/seller|buyers|\$/.test(`${i.subject} ${i.text}`)
      ? { department: "Relationships", why: "w", matched: ["x"] } : null)), true);
  expect("a parser that never produces a hunt — the state on 12 September", theRequestBecomesAHunt(() => null), true);
  expect("a parser that invents a hunt from any sentence", theRequestBecomesAHunt(
    () => ({ asset: "OpenAI", size_usd: 1e9, side: "sell" })), true);
  expect("a parser that defaults the side instead of reading it", theRequestBecomesAHunt((t) => {
    const r = huntRequestIn(t);
    return r ?? (/\$/.test(t) ? { asset: "OpenAI", size_usd: 1e9, side: "buy" } : null);
  }), true);
  expect("an intake that parses the hunt and never attaches it", theCodeDoesIt(
    intakeSource?.replace("...(hunt ? { hunt } : {}),", "") ?? null, apiSource, mergeSource), true);
  expect("an api with nowhere for a finished hunt to land", theCodeDoesIt(
    intakeSource, apiSource?.replace('tasks.post("/:id/hunt-result"', 'tasks.post("/:id/unused"') ?? null, mergeSource), true);
  expect("an empty roster", theSeatComesFromTheRoster([]), true);
  expect("a roster with nobody in Relationships", theSeatComesFromTheRoster(
    rosterFromMigrations().filter((s) => s.department !== "Relationships"),
  ), true);
  expect("an intake that hands off only after the model has run", theCodeDoesIt(
    intakeSource?.replace(/const handoff = handoffFor\(\{[\s\S]*?\n  \}\);/, "const handoff = null;")
      .replace("...(handoffNote ? { handed_off: handoffNote } : {}),", "handoffFor({});") ?? null,
    apiSource, mergeSource,
  ), true);
  expect("an endpoint with no audit row", theCodeDoesIt(
    intakeSource, apiSource?.replaceAll('action: "handed_off"', 'action: "moved"') ?? null, mergeSource,
  ), true);
  expect("an endpoint that takes a handoff with no reason", theCodeDoesIt(
    intakeSource, apiSource?.replace("A handoff needs a reason", "") ?? null, mergeSource,
  ), true);
  expect("an endpoint that does not check the seat is active", theCodeDoesIt(
    intakeSource, apiSource?.replace(/WHERE id = \? AND status = 'active'[\s\S]{0,80}?`/, "WHERE id = ?`") ?? null, mergeSource,
  ), true);
  expect("a third file quietly reassigning work", noThirdWayToMoveWork([
    ["src/worker/boss/somewhere/else.ts", "await db.prepare(`UPDATE tasks SET employee_id = ? WHERE id = ?`).run();"],
  ]), true);
  expect("a scan that scanned nothing", noThirdWayToMoveWork([]), true);
  expect("an intake that could not be read", theCodeDoesIt(null, apiSource, mergeSource), true);

  if (failed) { console.error(`HANDOFF SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("HANDOFF SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

const roster = rosterFromMigrations();

/* RULE 0. */
if (CASES.length === 0 || HUNT_CASES.length === 0 || roster.length === 0) {
  console.error("HANDOFF SCAN FAILED — nothing to examine:");
  console.error(`  ${CASES.length} rule case(s), ${HUNT_CASES.length} hunt case(s), ${roster.length} active employee(s) from the replayed migrations.`);
  process.exit(2);
}

const problems = [
  ...theRuleDecides(),
  ...theRequestBecomesAHunt(),
  ...theSeatComesFromTheRoster(roster),
  ...theCodeDoesIt(intakeSource, apiSource, mergeSource),
  ...noThirdWayToMoveWork(workerSources()),
];

if (problems.length) {
  console.error("HANDOFF SCAN FAILED:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  console.error('  "Route this to whomever should handle this" has to mean something.');
  process.exit(2);
}

const seat = seatInDepartment(roster, handoffFor({ text: HERS, fromDepartment: HOLDING_DEPARTMENT }).department);
console.log(
  `HANDOFF OK — ${CASES.length} rule case(s) and ${HUNT_CASES.length} hunt case(s) over ${roster.length} active seat(s); her "$1B+ of OpenAI `
  + `shares" message lands on ${seat.name} (${seat.id}, ${seat.role}) by rule, before any model runs, `
  + "and only two audited paths may reassign a task.",
);
