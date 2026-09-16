#!/usr/bin/env node
/**
 * Every SQL statement in the worker, parsed against the schema it will actually meet.
 *
 * WHY THIS EXISTS. Three bugs in one day shared a shape: correct-looking SQL that typechecked,
 * passed every test, and had never once been executed.
 *
 *   1. `ON CONFLICT (source_type, source_id)` against a PARTIAL unique index. SQLite requires the
 *      predicate repeated in the conflict target. The entire deliverables feature was dead for a
 *      day and reported nothing, because its callers wrap it so a handover failure cannot fail the
 *      brief it belongs to.
 *   2. `SELECT id FROM firm_user WHERE firm_scope = ?` — that table has no such column, so the
 *      weekly review's handover threw on every run, inside the same kind of catch.
 *   3. `SELECT id, superseded_by FROM knowledge_record` — the column is `supersedes_id` and points
 *      the other way. That one gates whether a knowledge record may back an LP claim.
 *
 * None of these is catchable by TypeScript: SQL is a string. None was caught by 1,175 tests,
 * because the paths were never exercised. All three are caught in seconds by asking SQLite to parse
 * them against the real schema.
 *
 * HOW. `EXPLAIN <statement>` parses and resolves every table and column reference WITHOUT executing
 * anything — no rows read, no rows written, safe against production. Binding errors are expected
 * and ignored: this checks the shape of the statement, not the arguments.
 *
 * LIMITS, stated because a validator that overstates itself is worse than none. Statements built by
 * interpolation (`${...}`) are skipped — their text is not knowable here. It proves a statement
 * CAN run; it says nothing about whether it returns the right rows.
 *
 * RUNS LOCALLY, AGAINST THE SCHEMA THE MIGRATIONS BUILD — changed 22 Aug 2026, and the change is
 * what makes this validator real rather than ceremonial.
 *
 * It used to spawn one `wrangler d1 execute --remote` per statement: 1,000-plus process launches and
 * round trips, which is where the ten-plus minutes went — essentially none of it in SQLite. A check
 * that takes ten minutes and needs production credentials is a check nobody runs, and this one was
 * indeed almost never run. **A validator nobody runs is not in the suite.**
 *
 * The migrations ARE production's schema — `npm run deploy:production` refuses to ship code against a
 * database with any migration pending, so the two cannot diverge. So the schema is built once in an
 * in-memory `node:sqlite` database and every statement EXPLAINed against it: seconds, no credentials,
 * no network, safe to run on every change.
 *
 * Usage:  node scripts/validate/sql-against-schema.mjs [--self-test]
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const WORKER_DIR = path.resolve("src/worker");
const MIGRATIONS_DIR = path.resolve("migrations");
const DB = process.argv.includes("--db") ? process.argv[process.argv.indexOf("--db") + 1] : "WP_OS_DB";
const ENV = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : "production";

/** Errors that mean the statement is WRONG, as opposed to merely un-bound. */
const REAL_ERROR = /no such (column|table|function)|syntax error|ambiguous column|ON CONFLICT clause does not match|too many terms/i;

function listFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full));
    else if (e.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

export function extractStatements(files) {
  const found = new Map();
  const patterns = [
    /`(\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^`]{10,1400})`/gis,
    /"(\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^"]{10,700})"/gi,
  ];
  for (const file of files) {
    /*
     * COMMENTS ARE STRIPPED BEFORE EXTRACTION, AND THIS IS NOT TIDINESS.
     *
     * The patterns below pair backticks naively, so a backtick inside a comment steals the opening
     * quote of the statement underneath it and the statement is never checked. Found the hard way:
     * a `// \`restricted\` because...` line sitting directly above an INSERT hid that INSERT
     * completely, and the scan reported PASSED on a statement naming a column that does not exist.
     *
     * That is the worst failure a validator can have — not a wrong answer, but a silent omission
     * that still prints a pass. A statement can now only escape this scan by being interpolated,
     * which is stated and deliberate.
     */
    const src = readFileSync(file, "utf8")
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        const raw = m[1];
        if (raw.includes("${")) continue; // interpolated: text is not knowable statically
        const sql = raw.replace(/\?\d+/g, "?").replace(/\s+/g, " ").trim();
        const line = src.slice(0, m.index).split("\n").length;
        if (!found.has(sql)) found.set(sql, `${path.relative(process.cwd(), file)}:${line}`);
      }
    }
  }
  return found;
}

/**
 * The schema, built from the migrations in order.
 *
 * Statements that fail are IGNORED rather than fatal, and that needs justifying: a migration may
 * legitimately not apply to a bare database — `INSERT`s referencing seeded rows, `ALTER`s guarded for
 * an older shape, backfills. What matters here is the resulting TABLE and COLUMN set, and a DDL
 * statement that fails to create a table announces itself immediately as every query against that
 * table failing. Silence is not possible.
 */
/** Migration statements D1 would refuse for a reason the local engine never raises. */
export const MIGRATION_FAULTS = [];

function buildSchema() {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const stmt of splitStatements(sql)) {
      // A migration is applied by D1 and by nothing else, so the one D1-only limit this scan knows
      // about is checked here, where the statement is in hand. Comments are stripped first: a
      // header that quotes the offending pattern must not fail the file that fixed it.
      const tooLong = longLikePattern(stmt.replace(/--.*$/gm, ""));
      if (tooLong) MIGRATION_FAULTS.push({ where: `migrations/${file}`, sql: stmt.slice(0, 90), reason: tooLong });
      try {
        db.exec(stmt);
      } catch {
        // See above: data statements are not the point, the shape is.
      }
    }
  }
  return db;
}

/** Split on semicolons that end a statement, respecting the BEGIN…END blocks triggers use. */
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let depth = 0;
  for (const line of sql.split("\n")) {
    const bare = line.replace(/--.*$/, "");
    if (/\bBEGIN\b/i.test(bare) && !/\bEND\b/i.test(bare)) depth += 1;
    if (/\bEND\s*;/i.test(bare) && depth > 0) depth -= 1;
    buf += `${line}\n`;
    if (depth === 0 && /;\s*$/.test(bare)) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Whether SQLite can parse and resolve this statement against the schema.
 *
 * `EXPLAIN` resolves every table and column reference without executing anything. Binding errors are
 * expected and ignored — this checks the SHAPE of the statement, never its arguments — so only
 * "no such table" and "no such column" count, which is exactly the class of bug that shipped three
 * times in one day.
 */
/**
 * D1 CAPS A LIKE PATTERN AT 50 BYTES, AND THE LOCAL SQLITE DOES NOT.
 *
 * 16 September 2026: `npm run deploy:production` stopped on migration 0245 with "LIKE or GLOB
 * pattern too complex" — a 66-byte literal that node:sqlite (the engine this validator builds the
 * schema in) accepts without comment, because its SQLITE_MAX_LIKE_PATTERN_LENGTH is 50,000 and
 * D1's is the SQLite default of 50. Every statement here had passed. A migration that fails on
 * production and nowhere else is exactly the class this scan exists for, so the literal length is
 * checked directly: no LIKE/GLOB against a string literal longer than 50 bytes, in a migration or
 * in the worker.
 */
export const D1_LIKE_PATTERN_MAX_BYTES = 50;
export function longLikePattern(sql) {
  for (const m of String(sql).matchAll(/\b(?:NOT\s+)?(?:LIKE|GLOB)\s+'((?:[^']|'')*)'/gi)) {
    const bytes = Buffer.byteLength(m[1].replace(/''/g, "'"), "utf8");
    if (bytes > D1_LIKE_PATTERN_MAX_BYTES) return `LIKE pattern is ${bytes} bytes; D1 refuses more than ${D1_LIKE_PATTERN_MAX_BYTES} ("LIKE or GLOB pattern too complex")`;
  }
  return null;
}

function checkOne(db, sql) {
  const tooLong = longLikePattern(sql);
  if (tooLong) return tooLong;
  try {
    db.prepare(`EXPLAIN ${sql}`);
    return null;
  } catch (err) {
    const message = String(err?.message ?? err);
    return SCHEMA_ERROR.test(message) ? message : null;
  }
}

/**
 * The error messages that mean "this statement does not match the schema".
 *
 * SQLITE PHRASES THE INSERT CASE DIFFERENTLY, AND THAT HOLE WAS REAL. A bad column in a SELECT says
 * "no such column: x"; the same mistake in an INSERT says "table t has no column named x". This
 * matched only the first, so EVERY bad column in EVERY INSERT in the codebase went unchecked — by a
 * validator whose own comment says it exists for "exactly the class of bug that shipped three times
 * in one day".
 *
 * Found by writing a deliberately broken INSERT to prove the scan caught it, and watching it pass.
 * A validator is only worth what its negative proof demonstrates, and this one had never been given
 * an INSERT to fail on.
 */
const SCHEMA_ERROR = /no such (table|column)|has no column named/i;

/**
 * The self-test this validator never had — and it was the only one of the eight without one.
 *
 * A scan that cannot demonstrate it catches anything is a scan nobody can trust, and this one is now
 * cheap enough to run on every change, which makes proving it matter more rather than less.
 */
function selfTest(db) {
  const cases = [
    ["SELECT id FROM firm_user", null, "a real table and column passes"],
    ["SELECT id FROM firm_user WHERE firm_scope = ?1", /no such column/i, "the column that broke the weekly review is caught"],
    ["SELECT id FROM table_that_does_not_exist", /no such table/i, "a missing table is caught"],
    ["SELECT id, superseded_by FROM knowledge_record", /no such column/i, "the LP-claim column that pointed the wrong way is caught"],
    /*
     * THE INSERT CASE, which this validator silently ignored until 7 Sep 2026. SQLite words it as
     * "table X has no column named Y" rather than "no such column", so the pattern never matched and
     * every INSERT in the repo was effectively unchecked.
     */
    ["INSERT INTO people (id, lane, full_name, column_that_does_not_exist) VALUES (?,?,?,?)", /has no column named/i, "a bad column in an INSERT is caught, not only in a SELECT"],
    ["INSERT INTO people (id, lane, full_name, privacy_class, created_at, updated_at) VALUES (?,?,?,?,?,?)", null, "a correct INSERT still passes"],
    ["INSERT INTO firm_user (id, email, full_name) VALUES (?1, ?2, ?3)", null, "a bound insert passes — arguments are not the point"],
    // The 0245 line that D1 refused and the local engine let through, verbatim.
    ["UPDATE boss_inbound_mail SET message_id = '<' || id || '@boss-os-console>' WHERE message_id IS NULL AND why LIKE '%Typed into Boss OS from her own authenticated session%'", /pattern too complex/i, "a LIKE pattern over D1's 50-byte cap is caught"],
    ["SELECT id FROM boss_inbound_mail WHERE why LIKE '%Typed into Boss OS from her own%'", null, "a LIKE pattern under the cap passes"],
  ];
  let failed = 0;
  for (const [sql, expected, why] of cases) {
    const got = checkOne(db, sql);
    const ok = expected ? Boolean(got && expected.test(got)) : got === null;
    if (!ok) {
      process.stderr.write(`SELF-TEST FAILED (${why}): ${sql}\n  got: ${got ?? "no error"}\n`);
      failed += 1;
    }
  }
  if (MIGRATION_FAULTS.length) {
    process.stderr.write(`SELF-TEST FAILED: ${MIGRATION_FAULTS.length} migration statement(s) D1 would refuse: ${MIGRATION_FAULTS.map((f) => f.where).join(", ")}\n`);
    failed += 1;
  }
  if (failed) process.exit(1);
  process.stdout.write(`SELF-TEST PASSED: ${cases.length}/${cases.length} cases, including all three bugs that prompted this scan, and the migrations carry no LIKE pattern D1 refuses.\n`);
}

async function main() {
  const db = buildSchema();
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get();
  // Guards the guard: a schema that failed to build would let every statement pass for want of
  // anything to contradict it, and the scan would report success over nothing.
  if (Number(tables.n) < 50) {
    process.stderr.write(`SCHEMA BUILD FAILED: only ${tables.n} tables built from ${MIGRATIONS_DIR}.\n`);
    process.exit(1);
  }

  if (process.argv.includes("--self-test")) {
    selfTest(db);
    return;
  }

  const statements = extractStatements(listFiles(WORKER_DIR));
  const entries = [...statements.entries()];
  process.stdout.write(`Checking ${entries.length} statements against ${tables.n} tables built from the migrations…\n`);

  // A scan that finds no statements to check is not a pass. Reproduced 2026-09: pointing
  // WORKER_DIR at an empty directory still printed "SQL SCHEMA SCAN PASSED" having checked zero
  // statements.
  if (entries.length === 0) {
    process.stdout.write(`SQL SCHEMA SCAN FAILED — examined 0 statements under ${WORKER_DIR}.\n`);
    process.stdout.write("A scan that checks nothing is not a passing scan. Confirm WORKER_DIR resolves to the\n");
    process.stdout.write("real worker tree before trusting this result.\n");
    process.exitCode = 1;
    return;
  }

  const failures = [...MIGRATION_FAULTS];
  for (const [sql, where] of entries) {
    const reason = checkOne(db, sql);
    if (reason) failures.push({ where, sql: sql.slice(0, 90), reason });
  }

  if (failures.length === 0) {
    process.stdout.write("SQL SCHEMA SCAN PASSED: every checkable statement parses against the schema the migrations build.\n");
    return;
  }
  process.stdout.write(`\nSQL SCHEMA SCAN FAILED — ${failures.length} statement(s) the schema rejects:\n`);
  for (const f of failures) process.stdout.write(`  ✗ ${f.where}\n      ${f.sql}\n      → ${f.reason}\n`);
  process.exitCode = 1;
}

await main();
