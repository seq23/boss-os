#!/usr/bin/env node
/**
 * EVERY JOB NAMES WHAT IT PRODUCES (owner, 5 Nov 2026: stop "green but did nothing").
 *
 * P&P corporate outreach ran green 2-5 Nov 2026 and sent 0. Nothing could have said so: no job
 * declared what it was for, and no run recorded what it made. This fails CI when:
 *   1. a Schedule row (src/shared/boss/schedule/manifest.json) names no `output`: a producing job
 *      needs a metric, a floor above 0 and its runs; a job that only checks declares floor 0 with a
 *      reason (`outputProblems`);
 *   2. a duty's row and the floor its migration wrote disagree (`dutyFloorProblems`);
 *   3. a producing Mac or cloud duty's script prints no `OUTPUT <n> <metric>` line, except the named
 *      PENDING scripts below — each must still lack it, so the list can only shrink.
 * Kendra's alarm (src/worker/boss/alarms/kendra.ts) is what reads the floors; this keeps them declared.
 *
 *   node scripts/validate/every-job-names-its-output.mjs [--self-test]
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { outputProblems, migrationFloors, dutyFloorProblems } from "../ops/lib/schedule.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "src/shared/boss/schedule/manifest.json"), "utf8"));
const migrationSql = readdirSync(join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(join(ROOT, "migrations", f), "utf8")).join("\n");

/**
 * Producing duties whose script does not print its OUTPUT line yet, each with why it is not done here.
 * Until it prints one, Kendra's check counts its runs as unknown (below the floor) and says so.
 */
export const PENDING = {
  "pnp-listings.sh": "lives in ~/bin, not this repo; one line, echo \"OUTPUT <n> listings checked\"",
};

const PRINTS = /outputLine\(|^\s*(console\.log\(|echo\s+)["'`]OUTPUT /m;

/**
 * duty id → its local job, from the migrations in order (a later one wins: a rename). Each
 * `'local_job', '<script>'` belongs to the duty its own statement names: the `('duty_…'` tuple it sits
 * in, or the `WHERE id = 'duty_…'` of a json_set. Pure.
 */
export function dutyScripts(sql) {
  const jobs = new Map();
  for (const stmt of String(sql).split(/;\s*\n/)) {
    for (const mm of stmt.matchAll(/'local_job',\s*'([a-z0-9.-]+\.(?:mjs|sh))'/g)) {
      const before = stmt.slice(0, mm.index);
      const tuple = [...before.matchAll(/\(\s*'(duty_[a-z0-9_]+)'/g)].pop()?.[1];
      const where = /WHERE id = '(duty_[a-z0-9_]+)'/.exec(stmt.slice(mm.index))?.[1];
      const id = /^\s*UPDATE/i.test(stmt.replace(/^(\s*--[^\n]*\n)*/, "")) ? where : tuple ?? where;
      if (id) jobs.set(id, mm[1]);
    }
  }
  return jobs;
}

/** Prints the line itself, or through a sibling script it imports (seller-hunt runs buyer-hunt's code). */
function printsOutput(text, readScript) {
  if (text === null) return false;
  if (PRINTS.test(text)) return true;
  return [...text.matchAll(/import\(?\s*["']\.\/([a-z0-9.-]+\.mjs)["']/g)].some((m) => PRINTS.test(readScript(m[1]) ?? ""));
}

/** Producing local-job duties (from the migrations) whose script prints no OUTPUT line. Pure over its inputs. */
export function scriptProblems(m, floors, readScript, pending = PENDING) {
  const out = [];
  const producing = new Map();
  for (const r of m.rows ?? []) {
    const d = r.trigger?.duty;
    if (d && floors.get(d)?.floor > 0) producing.set(d, r);
  }
  const jobs = dutyScripts(migrationSql);
  let examined = 0;
  for (const [d] of producing) {
    const script = jobs.get(d);
    if (!script) continue; // an agent or Worker duty: the Worker counts its output
    examined += 1;
    const text = readScript(script);
    const prints = printsOutput(text, readScript);
    if (pending[script] !== undefined) {
      if (prints) out.push(`${script} prints its OUTPUT line now: take it off PENDING`);
      continue;
    }
    if (text === null) out.push(`${d}: its script ${script} is not in scripts/ops (add it to PENDING with where it lives)`);
    else if (!prints) out.push(`${d}: ${script} produces "${floors.get(d).metric}" and prints no OUTPUT line (outputLine(n, metric) from src/shared/boss/alarms/rules.mjs)`);
  }
  if (examined === 0) out.push("no producing local-job duty was examined, so the OUTPUT check saw nothing");
  return out;
}

const readScript = (s) => { const p = join(ROOT, "scripts/ops", s); return existsSync(p) ? readFileSync(p, "utf8") : null; };

function check(m = manifest, sql = migrationSql, read = readScript) {
  const floors = migrationFloors(sql);
  return [...outputProblems(m), ...dutyFloorProblems(m, floors), ...scriptProblems(m, floors, read)];
}

function selfTest() {
  const clone = () => JSON.parse(JSON.stringify(manifest));
  const at = (id, f) => { const m = clone(); const r = m.rows.find((x) => x.trigger?.duty === id || x.id === id); f(r); return m; };
  const BROKEN = [
    ["a row with no output", () => check(at("duty_pnp_corporate_outreach", (r) => delete r.output))],
    ["a producing row with no metric", () => check(at("duty_pnp_corporate_outreach", (r) => delete r.output.metric))],
    ["a check with no reason", () => check(at("duty_mac_cleanup", (r) => delete r.output.reason))],
    ["schedule and duty floors disagree", () => check(at("duty_pnp_corporate_outreach", (r) => { r.output.floor = 5; }))],
    ["the migration's floor is gone", () => check(manifest, migrationSql.replace(/WHERE id = 'duty_pnp_corporate_outreach';/, "WHERE id = 'duty_gone';"))],
    ["a producing script stopped printing", () => check(manifest, migrationSql, (s) => (s === "pnp-corporate-outreach.mjs" ? readScript(s).replace(/outputLine\(/g, "line(") : readScript(s)))],
    // your-day.mjs prints its line (13 Nov 2026): listed as pending again, it must be caught.
    ["a pending script that prints now", () => scriptProblems(manifest, migrationFloors(migrationSql), readScript, { ...PENDING, "your-day.mjs": "listed, but it prints" })],
    ["no rows at all", () => check({ rows: [] })],
  ];
  const missed = BROKEN.filter(([, f]) => f().length === 0).map(([n]) => n);
  if (missed.length) { console.error(`NAMED STOP [SELF_TEST_BLIND] not caught: ${missed.join(", ")}`); process.exit(1); }
  console.log(`SELF-TEST OK — ${BROKEN.length} broken shapes caught`);
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const problems = check();
  if (problems.length) { for (const p of problems) console.error(`  ${p}`); console.error(`NAMED STOP [OUTPUT_UNDECLARED] ${problems.length} problem(s)`); process.exit(1); }
  const n = manifest.rows.filter((r) => r.output?.floor > 0).length;
  console.log(`every job names its output: ${manifest.rows.length} rows (${n} producing, ${manifest.rows.length - n} checks); ${Object.keys(PENDING).length} scripts pending an OUTPUT line`);
}
