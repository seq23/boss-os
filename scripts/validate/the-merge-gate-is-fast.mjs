#!/usr/bin/env node
/**
 * THE MERGE GATE IS FAST, THE SLOW SUITE IS WEEKLY + ON DEMAND, AND EVERY JOB HAS A CEILING.
 *
 * ─── The wait this closes ────────────────────────────────────────────────────
 *
 * 21 Sep 2026, PR #35: one serial CI job took 15m02s (unit 7m55s, Boss suites 5m00s) and the
 * Playwright journeys — 217 of them on one worker — lost a 5-second visibility race, retried the
 * whole suite, and hit the 30-minute cap with 214 passed. Fifty minutes to learn nothing about the
 * change, then a re-run. The shape that replaced it: the pull-request gate is typecheck + scans +
 * the unit suite in four vitest shards + the Boss suites in three, all parallel, about 3–4 minutes;
 * the journeys ran after the merge on `main` with their own ceiling.
 *
 * 26 Sep 2026, build first, test in batches: "after the merge" still meant every merge waited
 * 15–17 minutes before `Deploy` would fire. The journeys moved out of `ci.yml` altogether into
 * `e2e.yml`, which ran nightly and on dispatch and gates PRODUCTION (deploy.yml fires on its
 * success; `land --promote` ships the newest green sha). The merge gate is `ci.yml` alone.
 *
 * 26 Sep 2026, later the same day: the repo is PRIVATE, so every scheduled run spends GitHub
 * Actions minutes, and the owner's rule is at most one scheduled run a week for private repos.
 * The schedule is weekly — Sunday 08:00 UTC, `0 8 * * 0` — plus `workflow_dispatch`. Production
 * still promotes only from an e2e-green sha, so `land --promote boss-os --run-e2e` is the path
 * after a batch. Rule 7 below pins the cron itself, so a "helpful" return to nightly (or hourly)
 * fails the build instead of quietly spending the minutes again.
 *
 * ─── The rule, read from the YAML ────────────────────────────────────────────
 *
 *   1. Every job in ci.yml has `timeout-minutes` — a hang is reported as a hang, not as GitHub's
 *      six-hour default.
 *   2. The unit suite and the Boss suites are sharded: a matrix with ≥2 shards, and the vitest
 *      `--shard=i/N` denominator equals the matrix length, so no file is skipped and none runs twice.
 *   3. Each unit shard stays serial inside (`--no-file-parallelism`), the way the suites are written.
 *   4. ci.yml runs NO Playwright step — the journeys are not per merge, on any event.
 *   5. Every job in ci.yml has a ceiling ≤ 10 minutes, so the gate cannot quietly drift back to
 *      the shape this replaced.
 *   6. e2e.yml runs the Playwright journeys with a ceiling, and is triggered ONLY by `schedule`
 *      and `workflow_dispatch` — never `push`, never `pull_request`.
 *   7. e2e.yml's `schedule` is exactly ONE cron and it is the weekly one, `0 8 * * 0` — a private
 *      repo's scheduled suite runs at most once a week. Nightly, hourly, or a second cron line
 *      fails the build.
 *
 * RULE 0: zero jobs in either file, zero sharded jobs, or no Playwright job in e2e.yml is a hard
 * failure — an empty workflow satisfies every "no job is…" rule and proves nothing.
 *
 *   node scripts/validate/the-merge-gate-is-fast.mjs
 *   node scripts/validate/the-merge-gate-is-fast.mjs --self-test
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CI = ".github/workflows/ci.yml";
const E2E = ".github/workflows/e2e.yml";
const GATE_CEILING_MIN = 10;
const PLAYWRIGHT = /playwright test|npm run e2e\b/;
/** Sunday 08:00 UTC. The one scheduled run a week a private repo's Playwright suite is allowed. */
const WEEKLY_CRON = "0 8 * * 0";

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

/** The top-level `on:` block's trigger names (push, pull_request, schedule, …), comments stripped. */
export function triggersIn(yaml) {
  const lines = yaml.split("\n").map((l) => l.replace(/\s#.*$/, ""));
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (start < 0) {
    const inline = lines.find((l) => /^on:\s*\S/.test(l));
    if (!inline) return [];
    const v = inline.replace(/^on:\s*/, "").replace(/^\[|\]$/g, "");
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    if (!line.startsWith(" ")) break;
    const m = line.match(/^  ([A-Za-z_]+):/);
    if (m) out.push(m[1]);
  }
  return out;
}

const timeoutOf = (t) => { const m = t.match(/^\s+timeout-minutes:\s*(\d+)\s*$/m); return m ? Number(m[1]) : null; };

/** Every `- cron: "…"` line under the top-level `schedule:` trigger, comments stripped. */
export function cronsIn(yaml) {
  const lines = yaml.split("\n").map((l) => l.replace(/\s#.*$/, ""));
  const start = lines.findIndex((l) => /^  schedule:\s*$/.test(l));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    if (!line.startsWith("    ")) break;
    const m = line.match(/^\s+-\s*cron:\s*["']?([^"']+?)["']?\s*$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

export function check({ ci, e2e }) {
  const problems = [];
  const jobs = jobsIn(ci);
  const ids = Object.keys(jobs);
  if (ids.length === 0) { problems.push(`${CI} declares no jobs — nothing here can be a gate.`); return problems; }

  let sharded = 0;
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
    if (PLAYWRIGHT.test(t)) problems.push(`job "${id}" in ${CI} runs the Playwright journeys — 15–17 minutes (double on a retry) back on the merge path. They belong in ${E2E}.`);
    else if (ceiling !== null && ceiling > GATE_CEILING_MIN) problems.push(`job "${id}" gates merges with a ${ceiling}-minute ceiling; the merge gate is ≤ ${GATE_CEILING_MIN} minutes a job.`);
  }
  if (sharded < 2) problems.push(`only ${sharded} sharded job(s) — both the unit suite and the Boss suites are sharded, or the serial 15-minute job is back.`);

  // The journeys: weekly + dispatch in e2e.yml, with a ceiling, never on push or pull_request.
  if (!e2e) { problems.push(`${E2E} is missing — the Playwright journeys run nowhere. Weekly means weekly, not never.`); return problems; }
  const e2eJobs = jobsIn(e2e);
  const e2eIds = Object.keys(e2eJobs).filter((id) => PLAYWRIGHT.test(e2eJobs[id]));
  if (e2eIds.length === 0) problems.push(`no job in ${E2E} runs the Playwright journeys — the suite runs nowhere.`);
  for (const id of e2eIds) if (timeoutOf(e2eJobs[id]) === null) problems.push(`job "${id}" in ${E2E} has no timeout-minutes — a hung weekly run runs for six hours.`);
  const triggers = triggersIn(e2e);
  for (const bad of ["push", "pull_request", "pull_request_target"]) if (triggers.includes(bad)) problems.push(`${E2E} triggers on \`${bad}\` — the journeys are back on the merge path. Only schedule and workflow_dispatch.`);
  if (!triggers.includes("schedule")) problems.push(`${E2E} has no \`schedule\` trigger — a suite nobody runs is not a gate for production.`);
  else {
    // Rule 7: one cron, and it is the weekly one. A private repo pays Actions minutes for every run.
    const crons = cronsIn(e2e);
    if (crons.length === 0) problems.push(`${E2E} has a \`schedule\` trigger with no \`- cron:\` line — the suite is scheduled for never.`);
    else if (crons.length > 1) problems.push(`${E2E} schedules ${crons.length} crons (${crons.join(", ")}) — a private repo's suite runs at most once a week: exactly one cron, "${WEEKLY_CRON}".`);
    else if (crons[0] !== WEEKLY_CRON) problems.push(`${E2E} cron is "${crons[0]}" — the schedule is weekly, Sunday 08:00 UTC ("${WEEKLY_CRON}"), because this private repo spends Actions minutes on every run (owner, 26 Sep 2026). After a batch, \`land --promote boss-os --run-e2e\`, not a denser cron.`);
  }
  if (!triggers.includes("workflow_dispatch")) problems.push(`${E2E} has no \`workflow_dispatch\` — \`land --promote --run-e2e\` cannot run it on demand.`);
  return problems;
}

function selfTest() {
  const ci = readFileSync(join(ROOT, CI), "utf8");
  const e2e = readFileSync(join(ROOT, E2E), "utf8");
  const cases = [
    ["the shipped shape passes", { ci, e2e }, 0],
    ["a gate job with no ceiling is named", { ci: ci.replace(/^    timeout-minutes: 6\n/m, ""), e2e }, 1],
    ["the journeys back in ci.yml (post-merge or not)", { ci: ci + "\n  e2e:\n    runs-on: ubuntu-latest\n    timeout-minutes: 40\n    if: github.event_name != 'pull_request'\n    steps:\n      - run: npm run e2e\n", e2e }, 1],
    ["a shard denominator that skips files", { ci: ci.replace("--shard=${{ matrix.shard }}/4", "--shard=${{ matrix.shard }}/5"), e2e }, 1],
    ["a one-shard matrix", { ci: ci.replace("shard: [1, 2, 3]", "shard: [1]"), e2e }, 1],
    ["the unit shard gone parallel inside", { ci: ci.replace("npx vitest run --no-file-parallelism --shard", "npx vitest run --shard"), e2e }, 1],
    ["a gate job whose ceiling is the old 30", { ci: ci.replace(/^    timeout-minutes: 8\n/m, "    timeout-minutes: 30\n"), e2e }, 1],
    ["e2e.yml back on push", { ci, e2e: e2e.replace("\non:\n", "\non:\n  push:\n    branches: [main]\n") }, 1],
    ["e2e.yml back on pull_request", { ci, e2e: e2e.replace("\non:\n", "\non:\n  pull_request:\n") }, 1],
    ["e2e.yml with no schedule", { ci, e2e: e2e.replace(/^  schedule:\n(?:    .*\n)+/m, "") }, 1],
    ["e2e.yml with no dispatch", { ci, e2e: e2e.replace(/^  workflow_dispatch:\n/m, "") }, 1],
    ["the weekly job with no ceiling", { ci, e2e: e2e.replace(/^    timeout-minutes: \d+\n/m, "") }, 1],
    ["e2e.yml back to nightly", { ci, e2e: e2e.replace(`- cron: "${WEEKLY_CRON}"`, '- cron: "0 7 * * *"') }, 1],
    ["e2e.yml hourly", { ci, e2e: e2e.replace(`- cron: "${WEEKLY_CRON}"`, '- cron: "0 * * * *"') }, 1],
    ["e2e.yml with a second cron beside the weekly one", { ci, e2e: e2e.replace(`- cron: "${WEEKLY_CRON}"`, `- cron: "${WEEKLY_CRON}"\n    - cron: "0 7 * * 3"`) }, 1],
    ["e2e.yml scheduled with no cron line", { ci, e2e: e2e.replace(/^    - cron: .*\n/m, "") }, 1],
    ["e2e.yml weekly cron unquoted still passes", { ci, e2e: e2e.replace(`- cron: "${WEEKLY_CRON}"`, `- cron: ${WEEKLY_CRON}`) }, 0],
    ["RULE 0: no jobs at all in ci.yml", { ci: "name: CI\non: push\n", e2e }, 1],
    ["RULE 0: e2e.yml missing", { ci, e2e: "" }, 1],
    ["RULE 0: e2e.yml with no Playwright job", { ci, e2e: e2e.replace(/npm run e2e/g, "npm run typecheck") }, 1],
    ["RULE 0: the sharded jobs deleted", { ci: ci.replace(/\n  unit:\n[\s\S]*$/, "\n"), e2e }, 1],
  ];
  let wrong = 0;
  for (const [name, input, min] of cases) {
    const p = check(input);
    const ok = min === 0 ? p.length === 0 : p.length >= min;
    if (!ok) { wrong += 1; console.error(`  ✗ ${name}: ${p.length} problem(s)\n    ${p.join("\n    ")}`); }
  }
  if (wrong) { console.error(`the-merge-gate-is-fast self-test: ${wrong} case(s) wrong`); process.exit(1); }
  console.log(`the-merge-gate-is-fast self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

if (process.argv.includes("--self-test")) { selfTest(); process.exit(0); }
const read = (f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return ""; } };
const problems = check({ ci: read(CI), e2e: read(E2E) });
if (problems.length) {
  console.error("THE MERGE GATE IS NOT THE FAST SHAPE:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
const jobs = jobsIn(read(CI));
console.log(`the-merge-gate-is-fast: ${Object.keys(jobs).length} gate jobs, every one with a ceiling ≤ ${GATE_CEILING_MIN} min; unit and Boss suites sharded; the journeys weekly ("${WEEKLY_CRON}") + dispatch in ${E2E}, never per merge. OK.`);
