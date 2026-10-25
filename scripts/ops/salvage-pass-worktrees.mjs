#!/usr/bin/env node
/**
 * A FIXER PASS THAT STOPS EARLY NEVER TAKES ITS WORK WITH IT (25 Oct 2026).
 *
 * The first full Search Readiness run gave local-guides-generator's 61 briefs to one `claude -p`
 * pass. It hit `--max-turns 250` at 15:15 with 63 files changed in its worktree and nothing
 * committed: no sentinel, rc=9, and the runner moved on. The work existed only as an uncommitted
 * tree in ~/GitHub/.wt-danielle-local-guides-generator-20261025-142331 that nothing pointed at.
 * Chunking the queue (#139) makes a turn-limit hit rarer; this makes it harmless.
 *
 * What it does. ahrefs-audit-fix.sh calls it whenever a pass ends without its sentinel. For every
 * worktree audit-worktree.sh cut during that pass (named .wt-danielle-<repo>-<YYYYMMDD-HHMMSS>, the
 * stamp at or after the pass's start), it commits whatever is uncommitted onto the worktree's own
 * branch, pushes it, and opens a DRAFT PR titled "Salvaged: …". Draft, never landed here: the work
 * is unfinished and unreviewed. The next scoped pass for that repo is told (prompt, "Never lose
 * finished work") to continue on that branch, finish it, mark it ready and land it.
 *
 * Every worktree gets one line: SALVAGED <repo> <branch> <pr-url> | SALVAGE CLEAN <repo> <branch>
 * | SALVAGE FAILED <repo> <reason>. Zero worktrees is said too (SALVAGE NONE), never silence.
 *
 * Usage: node salvage-pass-worktrees.mjs --since <YYYYMMDD-HHMMSS> [--root ~/GitHub] [--repo <name>]
 * `gh` is resolved from SALVAGE_GH (tests point it at a stub) or PATH.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const WT_RE = /^\.wt-danielle-(.+)-(\d{8}-\d{6})$/;

/** The worktrees a pass started at `since` created. Pure: names in, `{ dir, repo, stamp }` out. */
export function pickWorktrees(names, since, repo = "") {
  return names
    .map((n) => { const m = WT_RE.exec(n); return m ? { dir: n, repo: m[1], stamp: m[2] } : null; })
    .filter((w) => w && w.stamp >= since && (!repo || w.repo === repo))
    .sort((a, b) => a.stamp.localeCompare(b.stamp));
}

/** What to do with one worktree. Pure, so the decision table is tested without git. */
export function salvageSteps({ dirty, ahead, hasPr }) {
  const steps = [];
  if (!dirty && hasPr) return steps; // already saved and visible
  if (dirty) steps.push("commit");
  if (dirty || ahead > 0) steps.push("push");
  if ((dirty || ahead > 0) && !hasPr) steps.push("draft-pr");
  return steps;
}

/** The local-time stamp audit-worktree.sh uses (`date +%Y%m%d-%H%M%S`), for a Date. */
export function stampOf(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function salvageOne(root, w, gh) {
  const cwd = join(root, w.dir);
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") return `SALVAGE FAILED ${w.repo} detached HEAD in ${cwd}`;
  // node_modules is the symlink audit-worktree.sh plants; it is never part of the work.
  // Filtered here, not with a ':!node_modules' pathspec: `git add` exits 1 on a pathspec that names
  // an ignored path, which is every repo that gitignores node_modules.
  const isModules = (l) => /^.. "?node_modules(\/|"?$)/.test(l);
  const dirty = git(cwd, ["status", "--porcelain"]).split("\n").filter((l) => l && !isModules(l)).length > 0;
  let base = "origin/main";
  try { base = git(cwd, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]) || base; } catch { /* keep main */ }
  const ahead = Number(git(cwd, ["rev-list", "--count", `${base}..HEAD`]) || 0);
  let hasPr = false;
  try { hasPr = execFileSync(gh, ["pr", "list", "--head", branch, "--state", "open", "--json", "url", "--jq", ".[0].url"], { cwd, encoding: "utf8" }).trim().length > 0; } catch { /* treated as none */ }
  const steps = salvageSteps({ dirty, ahead, hasPr });
  if (!steps.length) return `SALVAGE CLEAN ${w.repo} ${branch}`;
  if (steps.includes("commit")) {
    git(cwd, ["add", "-A"]);
    git(cwd, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "node_modules"]);
    git(cwd, ["commit", "-q", "-m", `WIP salvaged: the fixer pass stopped before committing (${w.stamp})\n\nCommitted by scripts/ops/salvage-pass-worktrees.mjs so a turn-limit hit does not discard\nfinished work. Unreviewed: the next pass for this repo continues here, finishes, and lands it.`]);
  }
  git(cwd, ["push", "-q", "-u", "origin", branch]);
  let url = "(existing PR)";
  if (steps.includes("draft-pr")) {
    url = execFileSync(gh, ["pr", "create", "--draft", "--head", branch,
      "--title", `Salvaged: unfinished Search Readiness pass (${w.repo}, ${w.stamp})`,
      "--body", "A fixer pass stopped (turn limit or crash) before it committed. Its worktree was committed as-is and pushed so nothing is lost.\n\nUnreviewed and not landed. The next scoped pass for this repo continues on this branch, keeps only correct at-source fixes, gets it green, marks it ready and lands it."],
      { cwd, encoding: "utf8" }).trim().split("\n").pop();
  }
  return `SALVAGED ${w.repo} ${branch} ${url}`;
}

export function salvage({ root, since, repo = "", gh = "gh" }) {
  const names = readdirSync(root).filter((n) => { try { return statSync(join(root, n)).isDirectory(); } catch { return false; } });
  const picked = pickWorktrees(names, since, repo);
  if (!picked.length) return [`SALVAGE NONE no worktree cut since ${since}${repo ? ` for ${repo}` : ""}`];
  return picked.map((w) => { try { return salvageOne(root, w, gh); } catch (e) { return `SALVAGE FAILED ${w.repo} ${String(e.message || e).split("\n")[0]}`; } });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k, d = "") => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const since = arg("--since");
  if (!/^\d{8}-\d{6}$/.test(since)) { console.error("NAMED STOP [NO_SINCE] --since YYYYMMDD-HHMMSS is required"); process.exit(2); }
  const lines = salvage({ root: arg("--root", join(homedir(), "GitHub")), since, repo: arg("--repo"), gh: process.env.SALVAGE_GH || "gh" });
  for (const l of lines) console.log(l);
  process.exit(lines.some((l) => l.startsWith("SALVAGE FAILED")) ? 1 : 0);
}
