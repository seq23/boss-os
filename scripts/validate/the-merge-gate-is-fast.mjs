#!/usr/bin/env node
/**
 * THE MERGE GATE IS FAST, THE SLOW SUITE IS POST-MERGE, AND EVERY JOB HAS A CEILING.
 *
 * ─── The wait this closes ────────────────────────────────────────────────────
 *
 * 21 Sep 2026, PR #35: one serial CI job took 15m02s (unit 7m55s, Boss suites 5m00s) and the
 * Playwright journeys — 217 of them on one worker — lost a 5-second visibility race, retried the
 * whole suite, and hit the 30-minute cap with 214 passed. Fifty minutes to learn nothing about the
 * change, then a re-run. The shape that replaced it: the pull-request gate is typecheck + scans +
 * the unit suite in four vitest shards + the Boss suites in two, all parallel, about 3–4 minutes;
 * the journeys run after the merge on `main` with their own ceiling.
 *
 * ─── The rule, read from the YAML ────────────────────────────────────────────
 *
 *   1. Every job in ci.yml has `timeout-minutes` — a hang is reported as a hang, not as GitHub's
 *      six-hour default.
 *   2. The unit suite and the Boss suites are sharded: a matrix with ≥2 shards, and the vitest
 *      `--shard=i/N` denominator equals the matrix length, so no file is skipped and none runs twice.
 *   3. Each unit shard stays serial inside (`--no-file-parallelism`), the way the suites are written.
 *   4. The Playwright job does not run on `pull_request` — it is post-merge — and it keeps a ceiling.
 *   5. Every job the pull request waits on has a ceiling ≤ 10 minutes, so the gate cannot quietly
 *      drift back to the shape this replaced.
 *
 * RULE 0: zero jobs, zero sharded jobs, or no Playwright job is a hard failure — an empty workflow
 * satisfies every "no job is…" rule and proves nothing.
 *
 *   node scripts/validate/the-merge-gate-is-fast.mjs
 *   node scripts/validate/the-merge-gate-is-fast.mjs --self-test
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CI = ".github/workflows/ci.yml";
const GATE_CEILING_MIN = 10;

/** Split the workflow's `jobs:` block into { id: text } without a YAML library. */
export function jobsIn(yaml) {
  const at = yaml.indexOf("\njobs:\n");
  if (at < 0) return {};
  const body = yaml.slice(at + 7);
  const jobs = {};
  let id = null;
  for (const line of body.split("\n")) {
    const m = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (m) { id = m[1]; jobs[id] = ""; continue; }
    if (id !== null && (line.startsWith("    ") || line.trim() === "" || line.startsWith("  #"))) jobs[id] += line + "\n";
  }
  return jobs;
}

export function check(yaml) {
  const problems = [];
  const jobs = jobsIn(yaml);
  const ids = Object.keys(jobs);
  if (ids.length === 0) { problems.push(`${CI} declares no jobs — nothing here can be a gate.`); return problems; }

  const timeoutOf = (t) => { const m = t.match(/^\s+timeout-minutes:\s*(\d+)\s*$/m); return m ? Number(m[1]) : null; };
  const isPr = (t) => !/^\s+if:\s*.*github\.event_name\s*!=\s*'pull_request'/m.test(t);

  let sharded = 0; let e2e = 0;
  for (const id of ids) {
    const t = jobs[id];
    const ceiling = timeoutOf(t);
    if (ceiling === null) problems.push(`job "${id}" has no timeout-minutes — a hang there runs for GitHub's six-hour default.`);

    const shardRuns = [...t.matchAll(/--shard=\$\{\{\s*matrix\.shard\s*\}\}\/(\d+)/g)].map((m) => Number(m[1]));
    const matrix = t.match(/^\s+shard:\s*\[([^\]]+)\]/m);
    if (shardRuns.length || matrix) {
      sharded += 1;
      const n = matrix ? matrix[1].split(",").map((s) => s.trim()).filter(Boolean).length : 0;
      if (!matrix) problems.push(`job "${id}" runs vitest with --shard but has no matrix.shard list — the other shards never run.`);
      else if (n < 2) problems.push(`job "${id}" has a shard matrix of ${n}; sharding with one shard is the serial job wearing a matrix.`);
      for (const d of shardRuns) if (d !== n) problems.push(`job "${id}" runs --shard=i/${d} over a matrix of ${n} shards — ${d > n ? "files are skipped" : "files run twice"}.`);
      if (shardRuns.length === 0) problems.push(`job "${id}" has a shard matrix but no --shard=\${{ matrix.shard }}/N run line — every shard runs the whole suite.`);
      const unitRuns = t.split("\n").filter((l) => /^\s+(run:|-\s*run:)?\s*npx vitest run(?! --config)/.test(l) || /^\s+run: npx vitest run(?! --config)/.test(l));
      if (unitRuns.some((l) => !l.includes("--no-file-parallelism"))) problems.push(`job "${id}" runs the unit suite in parallel inside a shard; these suites share a miniflare per file and were written to run serially.`);
    }
    if (/playwright test|npm run e2e/.test(t)) {
      e2e += 1;
      if (isPr(t)) problems.push(`job "${id}" runs the Playwright journeys on pull requests — 15–17 minutes (double on a retry) back in the merge gate.`);
    } else if (isPr(t) && ceiling !== null && ceiling > GATE_CEILING_MIN) {
      problems.push(`job "${id}" gates pull requests with a ${ceiling}-minute ceiling; the merge gate is ≤ ${GATE_CEILING_MIN} minutes a job.`);
    }
  }
  if (sharded < 2) problems.push(`only ${sharded} sharded job(s) — both the unit suite and the Boss suites are sharded, or the serial 15-minute job is back.`);
  if (e2e === 0) problems.push(`no job runs the Playwright journeys — post-merge means after the merge, not never.`);
  return problems;
}

function selfTest() {
  const good = readFileSync(join(ROOT, CI), "utf8");
  const cases = [
    ["the shipped shape passes", good, 0],
    ["a job with no ceiling is named", good.replace(/^    timeout-minutes: 6\n/m, ""), 1],
    ["the journeys back on pull requests", good.replace(/^    if: github\.event_name != 'pull_request'\n/m, ""), 1],
    ["a shard denominator that skips files", good.replace("--shard=${{ matrix.shard }}/4", "--shard=${{ matrix.shard }}/5"), 1],
    ["a one-shard matrix", good.replace("shard: [1, 2, 3]", "shard: [1]"), 1],
    ["the unit shard gone parallel inside", good.replace("npx vitest run --no-file-parallelism --shard", "npx vitest run --shard"), 1],
    ["a gate job whose ceiling is the old 30", good.replace(/^    timeout-minutes: 8\n/m, "    timeout-minutes: 30\n"), 1],
    ["RULE 0: no jobs at all", "name: CI\non: push\n", 1],
    ["RULE 0: the sharded jobs deleted", good.replace(/\n  unit:\n[\s\S]*?\n  e2e:\n/, "\n  e2e:\n"), 1],
  ];
  let wrong = 0;
  for (const [name, yaml, min] of cases) {
    const p = check(yaml);
    const ok = min === 0 ? p.length === 0 : p.length >= min;
    if (!ok) { wrong += 1; console.error(`  ✗ ${name}: ${p.length} problem(s)\n    ${p.join("\n    ")}`); }
  }
  if (wrong) { console.error(`the-merge-gate-is-fast self-test: ${wrong} case(s) wrong`); process.exit(1); }
  console.log(`the-merge-gate-is-fast self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

if (process.argv.includes("--self-test")) { selfTest(); process.exit(0); }
const problems = check(readFileSync(join(ROOT, CI), "utf8"));
if (problems.length) {
  console.error("THE MERGE GATE IS NOT THE FAST SHAPE:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
const jobs = jobsIn(readFileSync(join(ROOT, CI), "utf8"));
console.log(`the-merge-gate-is-fast: ${Object.keys(jobs).length} jobs, every one with a ceiling; unit and Boss suites sharded; the journeys post-merge. OK.`);
