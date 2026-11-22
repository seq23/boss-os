#!/usr/bin/env node
/**
 * WHAT FAILED LAST TIME RUNS FIRST (owner, 22 Nov 2026: "yes do both of those ci speedups").
 *
 * #537 pushed a fix and waited the whole gate (~10 minutes) to learn whether the two suites that failed
 * were green now. This runs first on a pull request: it reads the PR's previous CI run on another commit,
 * and if that run FAILED it re-runs exactly the suites that failed there (vitest's "FAIL tests/…" lines),
 * each under its own config. Red here stops the gate in about two minutes; green lets the full gate run,
 * unchanged, so nothing the full gate checks is skipped.
 *
 * Nothing to re-check (not a PR, no earlier run, the earlier run passed or was cancelled, or its failure
 * was not a test suite, e.g. a scan or the build) prints why and exits 0: the full gate decides.
 *
 *   node scripts/ops/recheck-failed.mjs --plan     # in CI: write files=<list> to GITHUB_OUTPUT (no install needed)
 *   RECHECK_FILES="<files…>" node scripts/ops/recheck-failed.mjs --run   # run those suites, each under its own config
 *   node scripts/ops/recheck-failed.mjs --self-test
 * Exit: 0 green or nothing to re-check · 1 a suite that failed last time still fails.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Only plain repo test paths pass (the list came from a log). Pure. */
export const safeFiles = (list) => String(list).split(/\s+/).filter((f) => /^tests\/[A-Za-z0-9._/-]+\.test\.tsx?$/.test(f) && !f.includes("..") && existsSync(f));

const ANSI = /\x1b\[[0-9;]*m/g;

/** The test files vitest reported as FAIL in a run's log, repo-relative, sorted. Pure. */
export function failedTestFiles(log) {
  const out = new Set();
  for (const line of String(log).replace(ANSI, "").split("\n")) {
    const m = line.match(/\bFAIL\s+(tests\/[^\s>]+\.test\.tsx?)/);
    if (m) out.add(m[1]);
  }
  return [...out].sort();
}

/** The run to compare against: the newest finished run on another commit. Pure over `gh run list` rows. */
export function previousRun(runs, headSha) {
  return runs.filter((r) => r.headSha !== headSha && r.status === "completed").sort((a, b) => b.databaseId - a.databaseId)[0] ?? null;
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });

function plan() {
  const files = pick();
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `files=${files.join(" ")}\n`);
}

function pick() {
  const path = process.env.GITHUB_EVENT_PATH;
  const event = path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const pr = event.pull_request;
  const none = (why) => { console.log(`recheck: ${why}`); return []; };
  if (!pr) return none("not a pull request, nothing to re-check");
  let runs;
  try {
    runs = JSON.parse(gh(["run", "list", "-R", process.env.GITHUB_REPOSITORY, "--workflow", "ci.yml", "--branch", pr.head.ref,
      "--event", "pull_request", "--limit", "20", "--json", "databaseId,headSha,status,conclusion"]));
  } catch (e) { return none(`earlier runs not readable (${String(e.message).split("\n")[0]}); the full gate decides`); }
  const prev = previousRun(runs, pr.head.sha);
  if (!prev) return none("no earlier finished run on this PR");
  if (prev.conclusion !== "failure") return none(`the earlier run (${prev.headSha.slice(0, 8)}) was ${prev.conclusion}, nothing to re-check`);
  let log = "";
  try { log = gh(["run", "view", String(prev.databaseId), "-R", process.env.GITHUB_REPOSITORY, "--log-failed"]); }
  catch (e) { return none(`the earlier run's log is not readable (${String(e.message).split("\n")[0]}); the full gate decides`); }
  const files = safeFiles(failedTestFiles(log).join(" "));
  if (!files.length) return none("the earlier run failed outside the test suites (a scan or the build); the full gate decides");
  console.log(`recheck: ${files.length} suite(s) failed on ${prev.headSha.slice(0, 8)}; running them first:\n  ${files.join("\n  ")}`);
  return files;
}

function run(files) {
  const boss = files.filter((f) => f.startsWith("tests/boss/"));
  const node = files.filter((f) => !f.startsWith("tests/boss/"));
  let failed = false;
  if (node.length) failed = spawnSync("npx", ["--no-install", "vitest", "run", "--no-file-parallelism", ...node], { stdio: "inherit" }).status !== 0 || failed;
  if (boss.length) failed = spawnSync("npx", ["--no-install", "vitest", "run", "--config", "vitest.boss.config.ts", ...boss], { stdio: "inherit" }).status !== 0 || failed;
  if (failed) { console.log("::error::a suite that failed last time still fails; the full gate is not run on this commit"); process.exit(1); }
  console.log("recheck: every suite that failed last time passes now; the full gate runs");
}

function selfTest() {
  const log = "shard 4/4\tUNKNOWN STEP\t2026Z \x1b[31m\x1b[1m\x1b[7m FAIL \x1b[27m\x1b[22m\x1b[39m tests/onlyColoured.test.ts\x1b[2m > \x1b[22mthe Worker entry\n"
    + "x FAIL  tests/boss/bigMail.test.ts > a\nx FAIL  tests/workerEntryExports.test.ts > b\n ✓ tests/ok.test.ts\n";
  const got = failedTestFiles(log);
  const want = ["tests/boss/bigMail.test.ts", "tests/onlyColoured.test.ts", "tests/workerEntryExports.test.ts"];
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`failedTestFiles: ${JSON.stringify(got)}`);
  if (failedTestFiles("all green\n ✓ tests/a.test.ts").length) throw new Error("failedTestFiles found a FAIL in a green log");
  const runs = [{ databaseId: 3, headSha: "new", status: "in_progress" }, { databaseId: 2, headSha: "old", status: "completed", conclusion: "failure" }, { databaseId: 1, headSha: "older", status: "completed", conclusion: "success" }];
  if (previousRun(runs, "new")?.databaseId !== 2) throw new Error("previousRun did not pick the newest finished run on another commit");
  if (previousRun([{ databaseId: 1, headSha: "new", status: "completed" }], "new") !== null) throw new Error("previousRun picked this commit's own run");
  if (safeFiles("tests/a.test.ts;rm tests/$(x).test.ts ../tests/b.test.ts").length) throw new Error("safeFiles let an unsafe path through");
  if (safeFiles("tests/checkChanged.test.ts").length !== 1) throw new Error("safeFiles refused a real suite");
  console.log("recheck-failed self-test: ok");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.argv.includes("--self-test") ? selfTest() : process.argv.includes("--plan") ? plan() : run(safeFiles(process.env.RECHECK_FILES ?? ""));
