#!/usr/bin/env node
/**
 * THE CLOCK BELONGS TO CODE.
 *
 * ─── The morning this exists because of ────────────────────────────────────
 *
 * 22 Nov 2026: Simone's morning email said "LP updates: its job did not report in". The LP producer
 * had not failed; it had been refused twice by its own `--only-if-due` wrapper, because its clock
 * read 23 Nov. Migration 0373 had written that clock by hand in SQLite date arithmetic,
 * `(unixepoch(date('now', '+1 day')) + 11*3600 + 45*60) * 1000`: a UTC date standing in for a
 * Central day, and a period skipped unconditionally. The line was copied from 0327, which copied the
 * shape from earlier files. `nextDueAt` (src/worker/boss/duties/cadence.ts) already placed the next
 * slot correctly across zones and clock changes; the migrations hand-rolled it again beside it.
 *
 * ─── The rules ──────────────────────────────────────────────────────────────
 *
 * 1. NO MIGRATION MAY `UPDATE standing_duties … SET next_due_at`. A migration that moves a duty
 *    writes the wall-clock columns (cadence, weekday, weekdays, local_hour, local_minute) and the
 *    code places the instant: `clockRepair` moves a clock left ahead of the owed slot back to it.
 *    The files that did it before this rule are named below with the day each landed. An INSERT of
 *    a brand-new duty may still seed a clock; a seeded clock that is wrong self-heals the same way.
 * 2. EVERY FILE IN src/worker THAT ANSWERS "IS IT DUE" (`isDue(` or `macDueToday(`) READS THE CLOCK
 *    THROUGH `effectiveNextDue` (duties/clock.ts), so no new answer path can bypass the repair.
 * 3. RULE 0: zero migrations read, or zero due-answer call sites found, is a hard fail.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const SELF_TEST = process.argv.includes("--self-test");

/** Migrations that hand-wrote a clock before the rule existed (file → the day it landed). */
const GRANDFATHERED = new Map([
  ["0197_boss_sourcing_next_due.sql", "2026-09-07"],
  ["0232_boss_the_ahrefs_pass_is_monthly_and_catches_up.sql", "2026-09-13"],
  ["0241_boss_toni_and_zora_get_real_work.sql", "2026-09-13"],
  ["0246_boss_the_ahrefs_pass_matches_how_the_audits_arrive.sql", "2026-09-17"],
  ["0257_boss_the_briefing_on_par_with_the_one_she_pays_for.sql", "2026-09-19"],
  ["0285_boss_kindle_duties_run_monthly.sql", "2026-10-16"],
  ["0327_boss_the_rebalanced_week.sql", "2026-11-01"],
  ["0358_boss_kindle_publish_runs_weekly.sql", "2026-11-08"],
  ["0373_boss_the_macs_day.sql", "2026-11-21"],
]);

/** Does this SQL text hold an UPDATE of standing_duties that assigns next_due_at? */
export function writesTheClock(sql) {
  const stripped = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return stripped.split(";").some((stmt) =>
    /^\s*UPDATE\s+standing_duties\b/i.test(stmt) && /(?:\bSET|,)\s*next_due_at\s*=/i.test(stmt));
}

export function scanMigrations(files, read, grandfathered = GRANDFATHERED) {
  const bad = [];
  for (const f of files) {
    if (!writesTheClock(read(f))) continue;
    if (grandfathered.has(f)) continue;
    bad.push(`migrations/${f} writes standing_duties.next_due_at. Write only the wall-clock columns (cadence, weekday, weekdays, local_hour, local_minute); the Worker places the instant (clockRepair, src/worker/boss/duties/cadence.ts).`);
  }
  return { bad, examined: files.length };
}

const CALL = /(?<![\w.])(?:isDue|macDueToday)\(/;
const DEFINITION = /function\s+(?:isDue|macDueToday)\(/g;

export function scanDueAnswers(files, read) {
  const bad = [];
  let sites = 0;
  for (const f of files) {
    const src = read(f).replace(DEFINITION, "");
    if (!CALL.test(src)) continue;
    sites += 1;
    if (!/\beffectiveNextDue\(/.test(src)) {
      bad.push(`${f} answers whether a duty is due without reading its clock through effectiveNextDue (src/worker/boss/duties/clock.ts).`);
    }
  }
  return { bad, sites };
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

if (SELF_TEST) {
  const fail = [];
  const migs = {
    "0400_new.sql": "UPDATE standing_duties SET local_hour = 5, next_due_at = (unixepoch(date('now', '+1 day')) + 11 * 3600) * 1000 WHERE id = 'x';",
    "0401_hours_only.sql": "-- next_due_at as 0327\nUPDATE standing_duties SET local_hour = 5, local_minute = 45 WHERE id = 'x';",
    "0402_where_only.sql": "UPDATE standing_duties SET suspended = 1 WHERE next_due_at = 0;",
    "0403_insert.sql": "INSERT INTO standing_duties (id, next_due_at) VALUES ('y', 0);",
    "0373_boss_the_macs_day.sql": "UPDATE standing_duties SET next_due_at = 1 WHERE id = 'z';",
    "0404_first_column.sql": "UPDATE standing_duties\n  SET next_due_at = 1\n  WHERE id = 'q';",
  };
  const m = scanMigrations(Object.keys(migs), (f) => migs[f]);
  if (!m.bad.some((x) => x.includes("0400_new.sql"))) fail.push("a new migration hand-writing next_due_at passed");
  if (!m.bad.some((x) => x.includes("0404_first_column.sql"))) fail.push("next_due_at as the first SET column passed");
  if (m.bad.some((x) => x.includes("0401_hours_only.sql"))) fail.push("a migration moving only wall-clock columns (with next_due_at in a comment) was flagged");
  if (m.bad.some((x) => x.includes("0402_where_only.sql"))) fail.push("next_due_at in a WHERE clause was flagged");
  if (m.bad.some((x) => x.includes("0403_insert.sql"))) fail.push("an INSERT seeding a new duty's clock was flagged");
  if (m.bad.some((x) => x.includes("0373_boss_the_macs_day.sql"))) fail.push("a grandfathered migration was flagged");

  const srcs = {
    "bypass.ts": "const due = isDue(d.next_due_at, false, now);",
    "door.ts": "const n = await effectiveNextDue(env, d, now); const due = isDue(n, false, now);",
    "brief.ts": "const due = macDueToday(d, now);",
    "def.ts": "export function isDue(a, b, c) { return a <= c; }",
    "other.ts": "const thisIsDue(x) = 1; obj.isDue(1);",
  };
  const s = scanDueAnswers(Object.keys(srcs), (f) => srcs[f]);
  if (!s.bad.some((x) => x.startsWith("bypass.ts"))) fail.push("a due answer that skips effectiveNextDue passed");
  if (!s.bad.some((x) => x.startsWith("brief.ts"))) fail.push("a macDueToday answer that skips effectiveNextDue passed");
  if (s.bad.some((x) => x.startsWith("door.ts"))) fail.push("a due answer through the door was flagged");
  if (s.bad.some((x) => x.startsWith("def.ts") || x.startsWith("other.ts"))) fail.push("a definition or an unrelated name was counted as a due answer");
  if (s.sites !== 3) fail.push(`expected 3 due-answer files in the fixtures, found ${s.sites}`);

  if (fail.length) {
    console.error(`validate:duty-clock self-test FAILED:\n  - ${fail.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("validate:duty-clock self-test: 11 fixtures behave.");
  process.exit(0);
}

const migDir = join(ROOT, "migrations");
const migFiles = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
const m = scanMigrations(migFiles, (f) => readFileSync(join(migDir, f), "utf8"));
const workerFiles = walk(join(ROOT, "src/worker")).map((p) => relative(ROOT, p));
const s = scanDueAnswers(workerFiles, (f) => readFileSync(join(ROOT, f), "utf8"));

const problems = [...m.bad, ...s.bad];
if (m.examined === 0) problems.push("NAMED STOP [DUTY_CLOCK_NOTHING_CHECKED]: no migrations were read.");
if (s.sites === 0) problems.push("NAMED STOP [DUTY_CLOCK_NOTHING_CHECKED]: no file in src/worker answers whether a duty is due; the scan found nothing to hold.");
const missing = [...GRANDFATHERED.keys()].filter((f) => !migFiles.includes(f));
if (missing.length) problems.push(`grandfathered migrations no longer exist (prune the list): ${missing.join(", ")}`);

if (problems.length) {
  console.error(`validate:duty-clock FAILED:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log(`validate:duty-clock: ${m.examined} migrations read, none new writes a duty clock; ${s.sites} due-answer files all read through effectiveNextDue.`);
