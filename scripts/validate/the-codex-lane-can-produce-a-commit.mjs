#!/usr/bin/env node
/**
 * THE CODEX LANE CAN PRODUCE A COMMIT — AND CANNOT MERGE ONE (31 Oct 2026).
 *
 * The defect: when a repo-change BUILD fell back to Codex (her ChatGPT seat), Codex's workspace-write
 * sandbox refused git metadata — `index.lock: Operation not permitted` — even with the worktree's
 * `.git` named as a writable root. rc_m62y71yasdwmdp7k (29 Oct, the Search Readiness repair) finished
 * its work and ended GIT_METADATA_READ_ONLY with no PR. Now Codex edits, and the runner, outside the
 * sandbox, commits, pushes and opens the PR (`finishCodexBuild`); `~/bin/land` alone merges.
 *
 * What is asserted, as behaviour:
 *   A. The shipped `finishCodexBuild` is RUN on a scratch repository (bare origin, linked worktree on a
 *      work branch, uncommitted edits, Codex's own GIT_METADATA_READ_ONLY block) with real git and a
 *      fake gh: it must leave a commit on the branch, push that branch, open a PR against main — and
 *      origin/main must not move and gh must never be asked to merge.
 *   B. It refuses to commit on main, and over a block that is not the sandbox's git block.
 *   C. The runner is wired to it: repo-change.mjs calls it for a Codex-served build, appends the
 *      build note to Codex's prompt, names no git directory as writable, and land never goes to Codex.
 *
 * `--self-test` runs the same checks over broken copies (a finish that never commits, a finish that
 * merges, a runner that no longer calls it) and fails unless every one is caught.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as seat from "../lib/codex-seat.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNNER = readFileSync(path.join(ROOT, "scripts/ops/repo-change.mjs"), "utf8");
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_NAME: "v", GIT_AUTHOR_EMAIL: "v@v", GIT_COMMITTER_NAME: "v", GIT_COMMITTER_EMAIL: "v@v" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();

function scratch() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "codex-lane-")));
  const origin = path.join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const main = path.join(root, "main");
  git(root, "clone", "-q", origin, main);
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  git(main, "push", "-q", "origin", "HEAD:main");
  const wt = path.join(root, "wt");
  git(main, "worktree", "add", "-q", wt, "-b", "work/rc-validator", "origin/main");
  const gh = [];
  const run = (cmd, args, o) => {
    if (cmd === "gh") {
      gh.push(args);
      if (args[1] === "view") return { status: 1, stdout: "", stderr: "no pull requests found" };
      return { status: 0, stdout: "https://github.com/seq23/probe/pull/9\n", stderr: "" };
    }
    try { return { status: 0, stdout: execFileSync(cmd, args, { cwd: o.cwd, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }), stderr: "" }; }
    catch (e) { return { status: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") }; }
  };
  return { root, origin, main, wt, gh, run };
}

function check({ finish, runner }) {
  const problems = [];
  const s = scratch();
  try {
    writeFileSync(path.join(s.wt, "repair.txt"), "Codex's edit");
    const out = { branch: "work/rc-validator", blocked: { tag: "GIT_METADATA_READ_ONLY", why: "index.lock: Operation not permitted" }, proof: { validators_passed: true }, pr_title: "Validator probe" };
    let fin;
    try { fin = finish({ cwd: s.wt, repo: "probe", branch: "work/rc-validator", out, run: s.run }); } catch (e) { fin = { ok: false, tag: "THREW", why: e.message }; }
    if (!fin?.ok) problems.push(`A: a Codex-edited build produced no PR (${fin?.tag}: ${fin?.why}).`);
    else if (!(fin.result.pr_number > 0) || !fin.result.pr_url) problems.push("A: the result carries no pr_url / pr_number.");
    let ahead = 0;
    try { ahead = Number(git(s.wt, "rev-list", "--count", "origin/main..HEAD")); } catch { ahead = 0; }
    if (ahead < 1) problems.push("A: no commit was made on the work branch.");
    let pushed = "";
    try { pushed = git(s.root, "--git-dir", s.origin, "rev-parse", "refs/heads/work/rc-validator"); } catch { pushed = ""; }
    if (!pushed || pushed !== git(s.wt, "rev-parse", "HEAD")) problems.push("A: the work branch was not pushed.");
    if (git(s.root, "--git-dir", s.origin, "log", "--format=%s", "main") !== "init") problems.push("A: origin/main moved — the lane reached main outside ~/bin/land.");
    if (s.gh.some((a) => a.includes("merge"))) problems.push("A: gh was asked to merge.");
    const create = s.gh.find((a) => a[1] === "create") ?? [];
    if (create.length && create[create.indexOf("--base") + 1] !== "main") problems.push("A: the PR was not opened against main.");

    let onMain;
    try { onMain = finish({ cwd: s.main, repo: "probe", branch: "main", out: {}, run: s.run }); } catch (e) { onMain = { ok: false, tag: "THREW" }; }
    if (onMain?.ok) problems.push("B: it committed on main.");
    writeFileSync(path.join(s.wt, "more.txt"), "x");
    let real;
    try { real = finish({ cwd: s.wt, repo: "probe", branch: "work/rc-validator", out: { blocked: { tag: "VALIDATOR_RED", why: "npm run validate failed" } }, run: s.run }); } catch { real = { ok: false }; }
    if (real?.ok) problems.push("B: it committed over Codex's own (non-git) block.");
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
  if (!/phase === "build" && servedBy === "codex" && buildPath\) \{\n\s+const fin = finishCodexBuild\(/.test(runner)) problems.push("C: repo-change.mjs no longer calls finishCodexBuild for a Codex-served build.");
  if (!/if \(phase === "build"\) prompt = `\$\{prompt\}\$\{CODEX_BUILD_NOTE\}`/.test(runner)) problems.push("C: Codex's build prompt no longer carries CODEX_BUILD_NOTE.");
  if (/git-common-dir|gitCommonDirs/.test(runner)) problems.push("C: the runner names a git directory as writable to Codex again.");
  if (!/phase: opts\.phase/.test(runner) || !seat.CODEX_CANNOT_RUN_PHASES.includes("land")) problems.push("C: a land phase can be handed to Codex.");
  if (/gh", \["pr", "merge"|gh pr merge/.test(seat.finishCodexBuild.toString())) problems.push("C: finishCodexBuild can merge.");
  return problems;
}

if (process.argv.includes("--self-test")) {
  const real = seat.finishCodexBuild;
  const cases = [
    { name: "a finish that never commits", finish: (a) => real({ ...a, run: (c, args, o) => (c === "git" && args[0] === "commit" ? { status: 0, stdout: "", stderr: "" } : a.run(c, args, o)) }), runner: RUNNER },
    { name: "a finish that merges to main", finish: (a) => { const r = real(a); a.run("git", ["push", "-q", "origin", "HEAD:main"], { cwd: a.cwd }); a.run("gh", ["pr", "merge", "9"], { cwd: a.cwd }); return r; }, runner: RUNNER },
    { name: "a finish that commits on main", finish: (a) => (a.branch === "main" ? { ok: true, result: {} } : real(a)), runner: RUNNER },
    { name: "a runner that no longer calls it", finish: real, runner: RUNNER.replace("const fin = finishCodexBuild(", "const fin = { ok: false } && (") },
    { name: "a runner that hands Codex the git dir again", finish: real, runner: `${RUNNER}\n// --git-common-dir` },
  ];
  let bad = 0;
  for (const c of cases) {
    const p = check(c);
    if (p.length === 0) { bad++; console.error(`SELF-TEST FAILED: ${c.name} was not caught`); }
    else console.log(`caught: ${c.name} — ${p[0]}`);
  }
  if (check({ finish: real, runner: RUNNER }).length) { bad++; console.error("SELF-TEST FAILED: the shipped code does not pass"); }
  if (bad) process.exit(1);
  console.log(`codex-lane self-test: ${cases.length}/${cases.length} breaks caught`);
} else {
  const problems = check({ finish: seat.finishCodexBuild, runner: RUNNER });
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exit(1);
  }
  console.log("codex lane: a Codex-edited build becomes a commit, a pushed work branch and a PR; main untouched; land stays ~/bin/land's");
}
