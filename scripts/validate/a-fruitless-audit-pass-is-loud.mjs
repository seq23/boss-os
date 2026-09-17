#!/usr/bin/env node
/**
 * A PASS THAT FIXED NOTHING MUST BE LOUD, AND IT MUST BE LOUD ABOUT THE RIGHT THINGS.
 *
 * ─── The morning that produced this ─────────────────────────────────────────
 *
 * 17 September 2026. `duty_site_audit_repair` ran for the first time in its life, end to end, and
 * exited clean:
 *
 *     AHREFS-AUDIT-COMPLETE: projects=2 fixed=0 surfaced=0 off_limits=0 no_repo=2
 *
 * 118 confirmed errors on a live business site, 3 on another, zero pull requests, exit code 0. On
 * every surface the owner looks at, that was INDISTINGUISHABLE FROM A CLEAN WEEK — and by making
 * `last_run_at` move, it actively SILENCED the one alert that had been covering this duty, the
 * "has not fired" alarm in routes/today.ts. The pass working made the system quieter than the pass
 * never having run.
 *
 * `GET /site-audit-findings` served those rows the whole time and NO CLIENT SCREEN CALLED IT.
 * "Exists but nothing invokes it" — this repository's own named defect, sitting at the delivery end
 * of a duty whose entire purpose is to be read by a person.
 *
 * ─── What this guards, and it is a different fact from its sibling ──────────
 *
 * `validate:audit-fixer` proves the duty is REACHABLE — that it exists, has a real seat, a runnable
 * executor, and cannot touch the forbidden repository. It proves the pass can RUN.
 *
 * This one proves the opposite half: that when the pass runs and comes back with work a person has
 * to do, THE PERSON HEARS ABOUT IT. Those two are not the same invariant and a system can pass one
 * while failing the other — which is precisely what it did all morning.
 *
 * ─── How it is proven: by RUNNING THE SHIPPED SQL, never a copy of it ───────
 *
 * The query is EXTRACTED from `routes/today.ts` and executed against a schema built by replaying
 * every migration, over fixture rows of all five dispositions. A validator that rewrote the query
 * in order to check the query would be asserting its own copy — the exact defect
 * `the-audit-fixer-cannot-touch-velocity.mjs` refuses in its own header, and the reason the
 * off-limits rule is tested through `mayAutoFix()` rather than re-implemented.
 *
 * So this fails when someone deletes the alert, and equally when someone leaves the alert in place
 * and quietly narrows the query underneath it.
 *
 * RULE 0: examining zero dispositions, or getting zero rows back from a fixture set that was
 * deliberately built to return some, is a FAILURE and not a pass. Both are loops that report a
 * clean bill of health over an empty set.
 *
 *   node scripts/validate/a-fruitless-audit-pass-is-loud.mjs
 *   node scripts/validate/a-fruitless-audit-pass-is-loud.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { DISPOSITIONS } from "../../src/shared/boss/siteAudit/repoPolicy.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : null);

const ALERTS = "src/worker/boss/routes/today.ts";
const TABLE = "site_audit_findings";
const DUTY_ID = "duty_site_audit_repair";

/**
 * The dispositions that mean A PERSON STILL HAS TO DO SOMETHING.
 *
 * Derived from the shared vocabulary rather than typed out, so adding a sixth disposition to
 * `repoPolicy.mjs` cannot leave this file silently governing five.
 *
 * `fixed_pr` and `none` are deliberately NOT here. The first already produced a pull request she
 * sees in GitHub; the second is a correctly empty pass. Alerting on either is how a surface earns
 * the habit of being ignored, and this file has been corrected twice for exactly that.
 */
export const NEEDS_A_PERSON = DISPOSITIONS.filter((d) => d !== "fixed_pr" && d !== "none");

/** Every migration, replayed in order, so the schema under test is the one that ships. */
export function schemaFromMigrations(dir = join(ROOT, "migrations")) {
  const db = new DatabaseSync(":memory:");
  const failed = [];
  let n = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    n += 1;
    try { db.exec(readFileSync(join(dir, f), "utf8")); }
    catch (e) { failed.push(`${f}: ${e.message.split("\n")[0]}`); }
  }
  return { db, failed, files: n };
}

/**
 * The alert's own SELECT, lifted out of the route.
 *
 * Matched on `FROM site_audit_findings` inside a template literal, which is the shape every read in
 * that file has. Returning null is a FAILURE upstream, never a skip: "I could not find the query"
 * and "the query is fine" must not produce the same exit code.
 */
export function extractAlertSql(source) {
  if (source === null) return null;
  for (const m of source.matchAll(/`([^`]*FROM\s+site_audit_findings[^`]*)`/g)) {
    return m[1];
  }
  return null;
}

/** Fixture rows: one of every disposition, so the query is asked to discriminate. */
function seedFindings(db) {
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO ${TABLE}
       (id, project, domain, repo, mapped_by, disposition, headline, because, suggested_action,
        errors, searched, status, run_id, found_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  let seeded = 0;
  for (const d of DISPOSITIONS) {
    insert.run(
      `f_${d}`, `Project_${d}`, `${d}.example`, d === "no_repo" ? null : "some-repo",
      d === "no_repo" ? "unmapped" : "repo_identity",
      d, `headline for ${d}`, `because ${d}`, `action ${d}`,
      d === "no_repo" ? 118 : 7, "{}", "new", "run_fixture", now, now,
    );
    seeded += 1;
  }
  // A dismissed row and an archived row, which must never reach her however bad they look.
  insert.run("f_dismissed", "Dismissed", "d.example", "r", "repo_identity", "surfaced",
    "h", "b", "a", 999, "{}", "dismissed", "run_fixture", now, now);
  seeded += 1;
  db.prepare(`UPDATE ${TABLE} SET archived_at = ? WHERE id = 'f_off_limits'`).run(now);
  return seeded;
}

/**
 * Rule: the shipped query returns every disposition that needs a person, and nothing else.
 */
export function theQuerySurfacesWhatNeedsAPerson(db, sql) {
  const bad = [];
  if (!sql) {
    return [`${ALERTS} contains no SELECT against ${TABLE}. Nothing reads what the pass found, so a run that fixed nothing is silent — and because a completed run moves last_run_at, it is QUIETER than a run that never happened.`];
  }
  if (NEEDS_A_PERSON.length === 0) {
    return ["the set of dispositions needing a person is EMPTY, so this guard would examine nothing and pass."];
  }

  let rows;
  try { rows = db.prepare(sql).all(); }
  catch (e) { return [`the query in ${ALERTS} does not execute against the shipped schema: ${e.message.split("\n")[0]}`]; }

  if (rows.length === 0) {
    return [`the query returned ZERO rows from a fixture set built to return some. Either it examines nothing or it filters everything, and both report a clean week over outstanding work.`];
  }

  const got = new Set(rows.map((r) => String(r.disposition)));

  // `off_limits` is archived in the fixtures, so it proves the archive filter rather than presence.
  for (const d of NEEDS_A_PERSON.filter((x) => x !== "off_limits")) {
    if (!got.has(d)) {
      bad.push(`a finding with disposition '${d}' does not reach the alert surface. That is work handed back to a person that no screen mentions — the shape of the morning that produced this file.`);
    }
  }
  if (got.has("fixed_pr")) {
    bad.push("the alert fires for 'fixed_pr'. That work is already a pull request she sees in GitHub, and an alert repeating it teaches her the surface is noise.");
  }
  if (got.has("none")) {
    bad.push("the alert fires for 'none'. An empty pass is a CORRECT outcome — her own bar is 'if she comes up empty handed its fine' — and alarming on it is a screen that cries wolf.");
  }
  if (got.has("off_limits")) {
    bad.push("an ARCHIVED finding still reaches her, so nothing can ever be put away and the surface only grows.");
  }
  const ids = rows.map((r) => String(r.worst_project ?? ""));
  if (ids.some((p) => p.includes("Dismissed"))) {
    bad.push("a DISMISSED finding still reaches her. Dismissing it is the decision; repeating it overrules her.");
  }
  return bad;
}

/**
 * Rule: the query's result is actually turned into an alert, addressed to this duty, in words a
 * non-engineer can act on.
 *
 * The query being right while nothing renders it is the same "runs but inert" failure one layer up,
 * and it is how this whole situation arose in the first place.
 */
export function theRowsBecomeAnAlert(source) {
  const bad = [];
  if (source === null) return [`${ALERTS} could not be read.`];

  if (!/auditFindings\.results/.test(source)) {
    bad.push(`${ALERTS} never iterates the findings it reads. A query whose rows are dropped is the same inert shape one layer up.`);
  }
  if (!new RegExp(`source_id:\\s*"${DUTY_ID}"`).test(source)) {
    bad.push(`the alert does not point at ${DUTY_ID}, so she cannot tell which employee's work it is or where it came from.`);
  }
  if (!/no_repo/.test(source)) {
    bad.push(`${ALERTS} does not name 'no_repo'. That is the disposition today's run actually produced — 118 errors on a live site nothing claims — and it is the one that must never be silent.`);
  }
  /*
   * NOT IN THE CONTRACT. Her rule, 13 September: "something not working should never be in today's
   * contract it should be in the inbox." Stated here as well as in `validate:audit-fixer` and
   * `validate:contract-is-her-work`, because an invariant asserted at one end is a preference.
   */
  const pillars = read("src/worker/boss/today/pillars.ts");
  if (pillars !== null) {
    const code = pillars.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    if (new RegExp(`FROM\\s+${TABLE}`).test(code)) {
      bad.push(`today/pillars.ts reads ${TABLE}. Machinery belongs on the alert surface, never in the day's contract, where it DISPLACES her real work.`);
    }
  }
  return bad;
}

// ─── Self-test ───────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  let failed = 0;
  const expect = (label, actual, shouldCatch) => {
    if ((actual.length > 0) !== shouldCatch) {
      console.error(`  ✗ ${label} — expected ${shouldCatch ? "caught" : "clean"}, got ${JSON.stringify(actual)}`);
      failed += 1;
    } else console.log(`  ✓ ${label}`);
  };

  const { db } = schemaFromMigrations();
  seedFindings(db);
  const source = read(ALERTS);
  const sql = extractAlertSql(source);

  expect("the shipped query surfaces what needs a person", theQuerySurfacesWhatNeedsAPerson(db, sql), false);
  expect("the rows become an alert", theRowsBecomeAnAlert(source), false);

  // ─── NEGATIVE PROOFS. Break it, and require the guard to see it. ──────────
  expect("no query at all — the state of this repo before today",
    theQuerySurfacesWhatNeedsAPerson(db, null), true);
  expect("a query narrowed to only unmapped findings",
    theQuerySurfacesWhatNeedsAPerson(db, sql.replace(/IN \([^)]*\)/, "IN ('no_repo')")), true);
  expect("a query that also alarms on a correctly empty pass",
    theQuerySurfacesWhatNeedsAPerson(db, sql.replace(/IN \([^)]*\)/, "IN ('no_repo', 'surfaced', 'off_limits', 'none')")), true);
  expect("a query that repeats work already opened as a PR",
    theQuerySurfacesWhatNeedsAPerson(db, sql.replace(/IN \([^)]*\)/, "IN ('no_repo', 'surfaced', 'fixed_pr')")), true);
  expect("a query that stopped hiding archived findings",
    theQuerySurfacesWhatNeedsAPerson(db, sql.replace(/AND archived_at IS NULL|archived_at IS NULL\s+AND/, "")), true);
  expect("a query that overrules a dismissal",
    theQuerySurfacesWhatNeedsAPerson(db, sql.replace(/status = 'new'/, "status != 'zzz'")), true);
  expect("a query that matches nothing at all",
    theQuerySurfacesWhatNeedsAPerson(db, sql.replace(/status = 'new'/, "status = 'no-such-status'")), true);
  expect("rows read and then dropped on the floor",
    theRowsBecomeAnAlert(source.replaceAll("auditFindings.results", "[]")), true);
  expect("an alert that does not say whose work it is",
    theRowsBecomeAnAlert(source.replaceAll(`source_id: "${DUTY_ID}"`, "source_id: null")), true);

  if (failed) { console.error(`FRUITLESS PASS SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("FRUITLESS PASS SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

const { db, failed, files } = schemaFromMigrations();
if (failed.length) {
  console.error(`FRUITLESS PASS SCAN FAILED — ${failed.length} migration(s) would not apply, so the schema under test is not the one that ships:`);
  for (const f of failed) console.error(`  ✗ ${f}`);
  process.exit(2);
}

// RULE 0, stated three ways. Any of these empty turns everything below into a loop over nothing.
if (NEEDS_A_PERSON.length === 0) {
  console.error("FRUITLESS PASS SCAN FAILED — no disposition is classed as needing a person, so nothing would ever be checked.");
  process.exit(2);
}
const table = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(TABLE);
if (!table) {
  console.error(`FRUITLESS PASS SCAN FAILED — ${files} migrations replayed and no ${TABLE} table exists.`);
  process.exit(2);
}
const seeded = seedFindings(db);
if (seeded === 0) {
  console.error("FRUITLESS PASS SCAN FAILED — zero fixture findings were seeded, so the query would be asked nothing.");
  process.exit(2);
}

const source = read(ALERTS);
const sql = extractAlertSql(source);
const problems = [
  ...theQuerySurfacesWhatNeedsAPerson(db, sql),
  ...theRowsBecomeAnAlert(source),
];

if (problems.length) {
  console.error(`FRUITLESS PASS SCAN FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(
  `FRUITLESS PASS SCAN PASSED: a run of ${DUTY_ID} that fixes nothing is not silent. `
  + `${seeded} fixture findings across ${DISPOSITIONS.length} dispositions were put through the SELECT that ships in ${ALERTS}; `
  + `it surfaces ${NEEDS_A_PERSON.join(", ")} as alerts against the duty, stays quiet for fixed_pr and none, `
  + `and hides archived and dismissed rows. ${files} migrations replayed.`,
);
