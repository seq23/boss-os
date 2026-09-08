#!/usr/bin/env node
/**
 * EVERY OWNED DELIVERABLE HAS AN OWNER, A TERMINAL CONDITION, AND A LIVE ESCALATION PATH.
 *
 * ─── The rule this makes real ───────────────────────────────────────────────
 *
 * "she owns this deliverable so she needs to make sure its done and if there is any block she needs
 * to tell me immediately and keep reminding me until its done. she canot drop it. that goes for all
 * employees when i give them something to own."
 *
 * "Cannot be dropped" has to be structural or it is a preference. The runtime half is in
 * `src/worker/boss/today/deliverables.ts`: completion is granted by counting real records, never
 * claimed, so a broken executor makes a commitment LOUDER rather than quieter. This file is the
 * other half — the guarantee that a commitment cannot be created in a shape that silently cannot
 * escalate.
 *
 * ─── The four ways a deliverable can be born unable to nag ──────────────────
 *
 * 1. NO OWNER, or an owner who is not on the roster. Every escalation names a person — "the KDP
 *    thing is stuck" is a worse sentence than "Simone's publication chase is stuck" — and a
 *    foreign key to a seat nobody occupies produces the first one.
 *
 * 2. A TERMINAL CHECK THE WORKER DOES NOT HAVE. This is the quiet catastrophe: a typo in
 *    `terminal_check` makes the deliverable impossible to complete, so it nags her for ever with no
 *    route out but killing it — which trains her to kill them, which is dropping work with extra
 *    steps.
 *
 * 3. A TERMINAL CONDITION THAT SAYS NOTHING. "Done" or "finished" is not a condition; it is the
 *    word being defined. She has to be able to read it and agree with it, which takes a sentence.
 *
 * 4. NO PATH TO HER SCREEN. `deliverableAlerts` must actually be called by `routes/today.ts`. An
 *    escalation engine nothing invokes is this repository's single most repeated defect, and it has
 *    already produced a table with a reader and no writer, a gratitude sentence nothing called, and
 *    an agent runner no job started.
 *
 * RULE 0: zero deliverables examined is a FAILURE. A register that is empty renders on her screen
 * as "nothing is stuck", which is indistinguishable from "everything is fine" — and a validator
 * that passes on an empty loop is the same mistake one level up.
 *
 *   node scripts/validate/owned-deliverables.mjs
 *   node scripts/validate/owned-deliverables.mjs --self-test
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const ENGINE = "src/worker/boss/today/deliverables.ts";
const SURFACE = "src/worker/boss/routes/today.ts";

/**
 * Each row an INSERT into `owned_deliverables` writes.
 *
 * The columns are read positionally from the statement's own column list, so this stays correct if
 * a later migration inserts a different subset — a parser that assumed one column order would fail
 * silently the first time someone wrote a shorter INSERT, which is the failure mode a validator can
 * least afford.
 */
export function deliverableRows(sql) {
  const out = [];
  const re = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+owned_deliverables\s*\(([^)]*)\)/gi;
  for (const m of sql.matchAll(re)) {
    const columns = m[1].split(",").map((c) => c.trim().toLowerCase());
    const body = sql.slice(m.index + m[0].length);
    // Each row opens with the deliverable id, exactly as the duty scan slices on `('duty_...'`.
    const ids = [...body.matchAll(/\(\s*'(del_[a-z0-9_]+)'/gi)];
    for (let i = 0; i < ids.length; i += 1) {
      const from = ids[i].index;
      const to = i + 1 < ids.length ? ids[i + 1].index : body.length;
      const text = body.slice(from, to);
      const values = [...text.matchAll(/'((?:[^']|'')*)'/g)].map((v) => v[1]);
      const row = {};
      columns.forEach((col, idx) => { row[col] = values[idx]; });
      out.push({ id: ids[i][1], row, text });
    }
  }
  return out;
}

/** The checks the Worker actually implements. */
export function terminalChecksIn(source) {
  const start = source.indexOf("export const TERMINAL_CHECKS");
  if (start === -1) return new Set();
  const body = source.slice(start);
  const end = body.indexOf("\n};");
  return new Set([...body.slice(0, end === -1 ? body.length : end).matchAll(/^\s{2}([a-z_][a-z0-9_]*):/gm)].map((m) => m[1]));
}

/** Employee ids any migration seeds, so an owner has to be a real seat. */
function employeeIds(allSql) {
  const ids = new Set(
    [...allSql.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+employees[\s\S]{0,4000}?VALUES\s*([\s\S]{0,8000})/gi)]
      .flatMap((m) => [...m[1].matchAll(/\(\s*'(emp_[a-z0-9_]+)'/gi)].map((x) => x[1])),
  );
  for (const m of allSql.matchAll(/WHERE\s+id\s*=\s*'(emp_[a-z0-9_]+)'/gi)) ids.add(m[1]);
  return ids;
}

function scan() {
  const files = readdirSync(join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const allSql = files.map((f) => read(`migrations/${f}`)).join("\n");

  const rows = [];
  for (const f of files) for (const r of deliverableRows(read(`migrations/${f}`))) rows.push({ ...r, file: f });

  const engine = read(ENGINE);
  const surface = read(SURFACE);
  const checks = terminalChecksIn(engine);
  const employees = employeeIds(allSql);
  const problems = [];

  // ── The escalation path has to reach her screen at all ──
  if (!/deliverableAlerts\s*\(/.test(surface)) {
    problems.push(
      `${SURFACE} never calls deliverableAlerts(). Every deliverable below would escalate into a\n` +
      `      function nobody invokes, which is this repository's most repeated defect.`,
    );
  }
  if (!/escalationFor/.test(engine) || checks.size === 0) {
    problems.push(`${ENGINE} has no terminal checks, so nothing can ever be marked done.`);
  }

  for (const { id, row, file } of rows) {
    const owner = row.employee_id;
    if (!owner) problems.push(`${id} (${file}): no employee_id. Every escalation names a person; this one could not.`);
    else if (!employees.has(owner)) {
      problems.push(`${id} (${file}): owned by '${owner}', which no migration seeds as an employee.`);
    }

    const check = row.terminal_check;
    if (!check) {
      problems.push(`${id} (${file}): no terminal_check, so nothing can ever mark it done.`);
    } else if (!checks.has(check)) {
      problems.push(
        `${id} (${file}): terminal_check '${check}' is not in TERMINAL_CHECKS in ${ENGINE}.\n` +
        `      It can never complete, so it would nag her for ever with no route out but killing it —\n` +
        `      which teaches her to kill deliverables, which is dropping work with extra steps.`,
      );
    }

    const condition = (row.terminal_condition ?? "").trim();
    if (condition.length < 20) {
      problems.push(
        `${id} (${file}): terminal_condition is "${condition}". "Done" is the word being defined, not\n` +
        `      a definition. She has to be able to read it and agree with it.`,
      );
    }

    const path = (row.escalation_path ?? "").trim();
    if (path.length < 20) {
      problems.push(`${id} (${file}): no escalation_path worth the name — the row cannot say how she finds out.`);
    }
  }

  return { rows, problems };
}

// ─── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  let failed = 0;
  const sql =
    `INSERT OR IGNORE INTO owned_deliverables\n  (id, name, employee_id, terminal_check)\nVALUES\n` +
    `  ('del_a', 'A thing', 'emp_chief', 'kdp_all_live'),\n` +
    `  ('del_b', 'Another', 'emp_research', 'other_check');`;
  const rows = deliverableRows(sql);
  if (rows.length !== 2) { console.error(`  ✗ expected 2 rows, got ${rows.length}`); failed += 1; }
  if (rows[0]?.row.employee_id !== "emp_chief" || rows[0]?.row.terminal_check !== "kdp_all_live") {
    console.error(`  ✗ columns not mapped positionally: ${JSON.stringify(rows[0]?.row)}`);
    failed += 1;
  }
  if (rows[1]?.row.terminal_check !== "other_check") {
    console.error("  ✗ the second row inherited the first's values");
    failed += 1;
  }

  const found = terminalChecksIn(
    `export const TERMINAL_CHECKS: Record<string, X> = {\n  one: async () => {},\n  two: async () => {},\n};\nexport const OTHER = { three: 1 };`,
  );
  if (!(found.has("one") && found.has("two") && !found.has("three"))) {
    console.error(`  ✗ terminal checks misread: ${[...found].join(", ")}`);
    failed += 1;
  }

  if (failed) { console.error(`\nSELF-TEST FAILED: ${failed} case(s)`); process.exit(1); }
  console.log("SELF-TEST PASSED: 4/4 cases.");
}

// ─── Run ──────────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) { selfTest(); process.exit(0); }

const { rows, problems } = scan();

/*
 * RULE 0, AND IT IS THE WHOLE POINT HERE.
 *
 * A register with nothing in it renders on Today as "nothing is stuck", which is indistinguishable
 * from "everything is fine" — so a validator that shrugged at zero deliverables would be certifying
 * the exact silence her rule exists to outlaw.
 */
if (rows.length === 0) {
  console.error(
    "OWNED DELIVERABLE SCAN EXAMINED NOTHING. No migration writes an owned_deliverables row, so\n" +
    "nothing in this system is owned in the sense she means — or the way they are written changed\n" +
    "and this scan did not keep up. Either way that is a broken scan, not a clean repo.",
  );
  process.exit(2);
}

if (problems.length > 0) {
  console.error("OWNED DELIVERABLE SCAN FAILED:\n");
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  console.error(
    "A deliverable that cannot escalate is one that has been dropped already; it just has not been\n" +
    "noticed yet. Give it an owner who exists, a condition the records can decide, and a way to her.",
  );
  process.exit(1);
}

console.log(
  `OWNED DELIVERABLE SCAN PASSED: ${rows.length} owned deliverable(s), each with a real owner, a ` +
  "terminal condition the Worker can evaluate, and an escalation path that reaches Today.",
);
selfTest();
