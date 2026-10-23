#!/usr/bin/env node
/**
 * A RETIRED DUTY TAKES ITS CHILD ROWS WITH IT (23 Oct 2026). Migration 0294 deleted two standing
 * duties without their duty_runs; a fresh local or CI database has no runs, so every test passed, and
 * production (45 runs for those duties) refused the apply with SQLITE_CONSTRAINT_FOREIGNKEY. The deploy
 * stopped after the merge.
 *
 * Rule: in every migration, a `DELETE FROM standing_duties` must come AFTER a `DELETE FROM <t>` for
 * every table <t> that REFERENCES standing_duties(id) in an earlier (or the same) migration.
 *
 *   node scripts/validate/retired-duty-fk.mjs              # the real migrations
 *   node scripts/validate/retired-duty-fk.mjs --self-test  # proves the check bites
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "migrations");

const strip = (sql) => sql.replace(/--[^\n]*/g, "");

/** files: Array<[name, sql]> in apply order. Returns the problems found. */
export function check(files) {
  const children = new Set();
  const bad = [];
  let deletes = 0;
  for (const [name, raw] of files) {
    const sql = strip(raw);
    const stmts = sql.split(";");
    const cleared = new Set();
    for (const st of stmts) {
      for (const m of st.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*)/gi)) {
        if (/REFERENCES\s+standing_duties\s*\(/i.test(m[2])) children.add(m[1]);
      }
      for (const m of st.matchAll(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN[\s\S]*REFERENCES\s+standing_duties\s*\(/gi)) children.add(m[1]);
      const del = /DELETE\s+FROM\s+(\w+)/i.exec(st);
      if (!del) continue;
      if (del[1] === "standing_duties") {
        deletes++;
        const missing = [...children].filter((c) => !cleared.has(c));
        if (missing.length) bad.push(`${name}: deletes from standing_duties before clearing ${missing.join(", ")} (each REFERENCES standing_duties(id))`);
      } else if (children.has(del[1])) cleared.add(del[1]);
    }
  }
  return { bad, children: children.size, deletes };
}

function real() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().map((f) => [f, fs.readFileSync(path.join(DIR, f), "utf8")]);
  if (files.length === 0) { console.error("FAIL: no migrations read"); process.exit(1); }
  const { bad, children, deletes } = check(files);
  if (children === 0) { console.error("FAIL: no table references standing_duties — the scan is reading nothing"); process.exit(1); }
  if (bad.length) { console.error(`FAIL:\n  ${bad.join("\n  ")}`); process.exit(1); }
  console.log(`RETIRED-DUTY FK PASSED: ${files.length} migrations, ${children} child tables, ${deletes} duty deletes, each after its child rows.`);
}

function selfTest() {
  const parent = ["0001.sql", "CREATE TABLE standing_duties (id TEXT PRIMARY KEY);\nCREATE TABLE duty_runs (id TEXT, duty_id TEXT NOT NULL REFERENCES standing_duties(id));"];
  const cases = [
    ["the 0294 shape fails", [parent, ["0002.sql", "DELETE FROM standing_duties WHERE id = 'x';"]], 1],
    ["runs cleared first passes", [parent, ["0002.sql", "DELETE FROM duty_runs WHERE duty_id = 'x';\nDELETE FROM standing_duties WHERE id = 'x';"]], 0],
    ["runs cleared after fails", [parent, ["0002.sql", "DELETE FROM standing_duties WHERE id = 'x';\nDELETE FROM duty_runs WHERE duty_id = 'x';"]], 1],
    ["a commented delete is ignored", [parent, ["0002.sql", "-- DELETE FROM standing_duties WHERE id = 'x';"]], 0],
  ];
  let ok = 0;
  for (const [label, files, want] of cases) {
    const got = check(files).bad.length;
    if (got === want) ok++; else console.error(`SELF-TEST FAIL: ${label} (want ${want} problems, got ${got})`);
  }
  if (ok !== cases.length) process.exit(1);
  console.log(`SELF-TEST PASSED: ${ok}/${cases.length} cases.`);
}

process.argv.includes("--self-test") ? selfTest() : real();
