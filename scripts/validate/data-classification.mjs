#!/usr/bin/env node
/**
 * Every Boss OS table must be classified, and the sovereign ones must stay sovereign.
 *
 * WHY A BUILD FAILURE AND NOT A RUNTIME CHECK. The airlock already refuses an unclassified entity
 * at runtime (`classify()` returns LOCAL_ONLY on both axes and every assert throws). That is the
 * right failure, but it is a failure a person only meets once the feature is written, wired and
 * running — by which point the table exists, holds data, and the cheapest fix is to classify it in
 * whatever direction unblocks the demo. This moves the same question to the moment the table is
 * created, when the answer is still free.
 *
 * THE SECOND CHECK IS THE ONE THAT MATTERS LATER. Residency can be edited in a migration like any
 * other row, so nothing stops a future migration quietly moving Spirit OS to CLOUD_SYNC. The
 * invariants below name the subsystems and tables whose residency was decided by the owner, and a
 * change to any of them has to come through this file — where it is a visible, reviewable act
 * rather than a line in a 200-line SQL diff.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "migrations";

/** CREATE / DROP / SQLite's create-copy-drop-rename rebuild, followed in document order. */
const TABLE_OPS =
  /(?<op>CREATE|DROP)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+|IF\s+EXISTS\s+)?["`[]?(?<name>[A-Za-z_][A-Za-z0-9_]*)|ALTER\s+TABLE\s+["`[]?(?<from>[A-Za-z_][A-Za-z0-9_]*)["`\]]?\s+RENAME\s+TO\s+["`[]?(?<to>[A-Za-z_][A-Za-z0-9_]*)/gi;

export function tablesIn(sql) {
  const live = new Set();
  for (const m of sql.matchAll(TABLE_OPS)) {
    const g = m.groups ?? {};
    if (g.op) {
      if (g.op.toUpperCase() === "CREATE") live.add(g.name);
      else live.delete(g.name);
    } else if (g.to) {
      live.delete(g.from);
      live.add(g.to);
    }
  }
  return live;
}

/** Entities named in a `data_policy` insert, with the residency each was given. */
export function policyRows(sql) {
  const out = new Map();
  const block = sql.slice(sql.indexOf("INSERT INTO data_policy"));
  for (const m of block.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_0-9]+)'\s*,\s*'([A-Z_]+)'\s*,\s*'([A-Z_]+)'/g)) {
    out.set(m[1], { subsystem: m[2], residency: m[3], ai_processing: m[4] });
  }
  return out;
}

/**
 * Residency the owner decided, recorded here so a migration cannot move it without touching this
 * file. Spirit OS is named by subsystem because every table in it is the same decision.
 */
const SOVEREIGN_SUBSYSTEMS = new Set(["spirit"]);
const SOVEREIGN_TABLES = new Set([
  "decisions", "predictions", "red_team_reviews", "calibrations",
  "emotional_states",
  "relationships", "meeting_briefs", "meeting_captures",
  "memory_items", "promotion_events",
  "learning_entries",
  /*
   * HER LIVE BOOK. What she has out to sell, in what name, at what size, and the floor she will not
   * break below. Named here rather than left to the migration because that is the point of this
   * set: residency is editable in SQL like any other row, and moving her inventory to CLOUD_SYNC
   * should be a visible act in a reviewed file, not a word changed in a 200-line diff.
   */
  "capital_book", "capital_book_line",
]);
/** Spirit's computed sky is arithmetic anyone can redo, and is deliberately not sovereign. */
const SOVEREIGN_EXCEPTIONS = new Set(["astro_calendar", "astro_days"]);

/**
 * Entities that are CLASSIFIED but deliberately have NO TABLE, with the reason each one does not.
 *
 * The rule below — a policy row with no table is stale — exists to catch a table that was dropped
 * while its classification lingered, which hides a real gap. A deliberately table-less entity is
 * the opposite case and has to be declared here rather than silently tolerated, or the check that
 * catches the real thing has to be weakened to accommodate it.
 *
 * A NEW ENTRY HERE IS A DESIGN DECISION, not a way past a failing build. It says: this material is
 * classified, the airlock governs it, and it is never written down in the cloud domain at all.
 */
const CLASSIFIED_BUT_NEVER_STORED = new Map([
  [
    "gratitude_sentences",
    "Spirit is a sovereign subsystem, so the daily gratitude sentence is LOCAL_ONLY on both axes. " +
      "It is composed in the Worker from her own record and never written down: deterministic for a " +
      "given day, so it is recomputed rather than stored. A table appearing here would mean someone " +
      "decided her gratitude should live in Cloudflare's database, which nothing about this feature " +
      "requires.",
  ],
  [
    "coaching_turns",
    "The morning coaching conversation. LOCAL_ONLY residency is honoured LITERALLY: there is no " +
      "table for it here and there must never be one. Turns live in the browser on the owner's " +
      "device and the endpoint that reaches a model persists nothing — the classification exists " +
      "so the airlock can govern whether a model may READ them, which is the other axis and a " +
      "different question. tests/boss/coaching.test.ts asserts no such table appears.",
  ],
]);

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const bossTables = new Set();
let policy = new Map();
for (const f of files) {
  const sql = readFileSync(join(MIGRATIONS, f), "utf8");
  if (f.includes("_boss_")) for (const t of tablesIn(sql)) bossTables.add(t);
  if (sql.includes("INSERT INTO data_policy")) policy = new Map([...policy, ...policyRows(sql)]);
}

const problems = [];

// Rule 0: a scan that examined nothing is not a pass.
if (bossTables.size === 0) problems.push("found 0 Boss tables — the scan no longer matches how migrations are written");
if (policy.size === 0) problems.push("found 0 data_policy rows — the classification migration is missing or unparsed");

for (const t of [...bossTables].sort()) {
  if (!policy.has(t)) problems.push(`${t}: no data_policy row — an unclassified table is refused at runtime, so classify it in a migration`);
}
for (const [entity, p] of [...policy].sort()) {
  if (!bossTables.has(entity) && !CLASSIFIED_BUT_NEVER_STORED.has(entity)) {
    problems.push(`${entity}: classified but no such Boss table — a stale policy row hides a real gap`);
  }
  // The declared exceptions are checked in the other direction too: an entity listed as never
  // stored that HAS acquired a table means the promise was broken and nobody noticed.
  if (bossTables.has(entity) && CLASSIFIED_BUT_NEVER_STORED.has(entity)) {
    problems.push(
      `${entity}: declared as never stored, but a table now exists — ${CLASSIFIED_BUT_NEVER_STORED.get(entity)}`,
    );
  }
  const mustBeLocal = (SOVEREIGN_SUBSYSTEMS.has(p.subsystem) || SOVEREIGN_TABLES.has(entity)) && !SOVEREIGN_EXCEPTIONS.has(entity);
  if (mustBeLocal && p.residency !== "LOCAL_ONLY") {
    problems.push(`${entity}: residency is ${p.residency}, but the owner classified it sovereign — LOCAL_ONLY is required`);
  }
  if (mustBeLocal && p.ai_processing !== "LOCAL_ONLY") {
    problems.push(`${entity}: ai_processing is ${p.ai_processing}, but sovereign material may only be reasoned about locally`);
  }
}

function selfTest() {
  const cases = [
    ["a rebuilt table keeps its name", "CREATE TABLE a (x);\nCREATE TABLE a_new (x);\nDROP TABLE a;\nALTER TABLE a_new RENAME TO a;", ["a"]],
    ["a dropped table is gone", "CREATE TABLE a (x);\nDROP TABLE a;", []],
    ["if not exists is matched", "CREATE TABLE IF NOT EXISTS b (x);", ["b"]],
  ];
  let failed = 0;
  for (const [name, sql, expected] of cases) {
    const got = [...tablesIn(sql)].sort();
    if (JSON.stringify(got) !== JSON.stringify(expected.sort())) {
      console.error(`SELF-TEST FAILED — ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
      failed++;
    }
  }
  const p = policyRows("INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES\n  ('x', 'spirit', 'LOCAL_ONLY', 'LOCAL_ONLY', 'r');");
  if (p.get("x")?.residency !== "LOCAL_ONLY") {
    console.error("SELF-TEST FAILED — a policy row is not parsed");
    failed++;
  }
  if (failed) process.exit(1);
  console.log(`SELF-TEST PASSED: ${cases.length + 1}/${cases.length + 1} cases.`);
}

if (problems.length > 0) {
  console.error("DATA CLASSIFICATION SCAN FAILED:\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nAn entity with no policy classifies as LOCAL_ONLY on both axes and every airlock");
  console.error("assertion refuses it. Classify the table in a migration, with a reason.");
  process.exit(1);
}
const local = [...policy.values()].filter((p) => p.residency === "LOCAL_ONLY").length;
console.log(
  `DATA CLASSIFICATION SCAN PASSED: ${policy.size} Boss entities classified, ${local} of them LOCAL_ONLY, ` +
    "and every sovereign entity still sovereign.",
);
selfTest();
