/**
 * A FIXER PASS THAT STOPS EARLY NEVER TAKES ITS WORK WITH IT (25 Oct 2026) — the guard.
 *
 * local-guides-generator's 61-brief pass hit --max-turns 250 with 63 files changed and none
 * committed; the runner moved on and the work sat in a worktree nothing pointed at. Fails if the
 * salvage step stops committing/pushing/opening a draft PR for a pass's worktree, if it touches a
 * worktree from before the pass, if it commits the node_modules symlink, or if ahrefs-audit-fix.sh
 * stops calling it on the no-sentinel path or the prompt stops telling the next pass to continue.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pickWorktrees, salvageSteps, salvage, stampOf } from "../scripts/ops/salvage-pass-worktrees.mjs";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

describe("salvage: which worktrees and what to do", () => {
  it("picks only this pass's worktrees, optionally one repo", () => {
    const names = [
      ".wt-danielle-local-guides-generator-20261025-142331",
      ".wt-danielle-local-guides-generator-20261023-060805",
      ".wt-danielle-dream-wedding-builder-20261025-151600",
      "boss-os", ".wt-other-x-20261025-150000",
    ];
    expect(pickWorktrees(names, "20261025-142131").map((w) => w.repo)).toEqual(["local-guides-generator", "dream-wedding-builder"]);
    expect(pickWorktrees(names, "20261025-142131", "dream-wedding-builder").map((w) => w.stamp)).toEqual(["20261025-151600"]);
    expect(pickWorktrees(names, "20261026-000000")).toEqual([]);
  });

  it("decision table: dirty commits, pushes and opens a draft; clean does nothing", () => {
    expect(salvageSteps({ dirty: true, ahead: 0, hasPr: false })).toEqual(["commit", "push", "draft-pr"]);
    expect(salvageSteps({ dirty: false, ahead: 2, hasPr: false })).toEqual(["push", "draft-pr"]);
    expect(salvageSteps({ dirty: true, ahead: 1, hasPr: true })).toEqual(["commit", "push"]);
    expect(salvageSteps({ dirty: false, ahead: 0, hasPr: false })).toEqual([]);
    expect(salvageSteps({ dirty: false, ahead: 3, hasPr: true })).toEqual([]);
  });

  it("stamp matches audit-worktree.sh's `date +%Y%m%d-%H%M%S`", () => {
    expect(stampOf(new Date(2026, 9, 25, 14, 21, 31))).toBe("20261025-142131");
  });
});

describe("salvage: against real git", () => {
  it("commits an uncommitted worktree onto its branch, pushes it, opens a draft PR, skips node_modules", () => {
    const base = mkdtempSync(join(tmpdir(), "salvage-"));
    const origin = join(base, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    const seed = join(base, "seed");
    execFileSync("git", ["clone", "-q", origin, seed]);
    git(seed, "config", "user.email", "t@example.invalid"); git(seed, "config", "user.name", "t");
    writeFileSync(join(seed, "a.txt"), "one\n"); git(seed, "add", "."); git(seed, "commit", "-q", "-m", "seed"); git(seed, "push", "-q", "origin", "HEAD:main");

    const root = join(base, "GitHub"); mkdirSync(root);
    const wt = join(root, ".wt-danielle-site-20261025-142331");
    execFileSync("git", ["clone", "-q", origin, wt]);
    git(wt, "config", "user.email", "t@example.invalid"); git(wt, "config", "user.name", "t");
    git(wt, "checkout", "-q", "-b", "danielle/site-audit-20261025-142331");
    writeFileSync(join(wt, "a.txt"), "fixed\n"); writeFileSync(join(wt, "b.txt"), "new\n");
    symlinkSync(base, join(wt, "node_modules"));
    // A second worktree in a repo that gitignores node_modules (most do): must salvage too.
    const wt2 = join(root, ".wt-danielle-other-20261025-150000");
    execFileSync("git", ["clone", "-q", origin, wt2]);
    git(wt2, "config", "user.email", "t@example.invalid"); git(wt2, "config", "user.name", "t");
    git(wt2, "checkout", "-q", "-b", "danielle/site-audit-20261025-150000");
    writeFileSync(join(wt2, ".gitignore"), "node_modules\n"); writeFileSync(join(wt2, "c.txt"), "c\n");
    symlinkSync(base, join(wt2, "node_modules"));
    // An older worktree from a previous pass, also dirty: must be left alone.
    const old = join(root, ".wt-danielle-site-20261020-060000");
    execFileSync("git", ["clone", "-q", origin, old]); writeFileSync(join(old, "a.txt"), "old\n");

    const calls = join(base, "gh-calls.txt");
    const gh = join(base, "gh");
    writeFileSync(gh, `#!/bin/sh\necho "$@" >> "${calls}"\ncase "$1 $2" in "pr list") grep -q -- "pr create --draft --head $4 " "${calls}" 2>/dev/null && echo https://example.invalid/pr/1; exit 0;; "pr create") echo https://example.invalid/pr/1;; esac\n`);
    chmodSync(gh, 0o755);

    const lines = salvage({ root, since: "20261025-142131", gh });
    expect(lines).toEqual([
      "SALVAGED site danielle/site-audit-20261025-142331 https://example.invalid/pr/1",
      "SALVAGED other danielle/site-audit-20261025-150000 https://example.invalid/pr/1",
    ]);
    expect(git(wt2, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual([".gitignore", "c.txt"]);
    expect(git(wt, "status", "--porcelain", "--", ".", ":!node_modules")).toBe("");
    const pushed = git(seed, "ls-remote", origin, "danielle/site-audit-20261025-142331");
    expect(pushed).toContain(git(wt, "rev-parse", "HEAD"));
    const files = git(wt, "show", "--name-only", "--format=", "HEAD").split("\n");
    expect(files.sort()).toEqual(["a.txt", "b.txt"]);
    expect(readFileSync(calls, "utf8")).toMatch(/pr create --draft --head danielle\/site-audit-20261025-142331 --title Salvaged:/);
    expect(git(old, "status", "--porcelain")).not.toBe(""); // untouched

    // Run again: nothing left to do, and it says so.
    expect(salvage({ root, since: "20261025-142131", gh })).toEqual([
      "SALVAGE CLEAN site danielle/site-audit-20261025-142331",
      "SALVAGE CLEAN other danielle/site-audit-20261025-150000",
    ]);
    expect(readFileSync(calls, "utf8").match(/pr create/g)).toHaveLength(2);
    expect(salvage({ root, since: "20261026-000000", gh })).toEqual(["SALVAGE NONE no worktree cut since 20261026-000000"]);
  });
});

describe("salvage is wired in", () => {
  const sh = readFileSync("scripts/ops/ahrefs-audit-fix.sh", "utf8");
  it("ahrefs-audit-fix.sh salvages before it exits 9 with no sentinel", () => {
    const block = sh.slice(sh.indexOf("NAMED STOP [AUDIT_DID_NOT_COMPLETE]"), sh.indexOf("exit 9"));
    expect(block).toMatch(/salvage-pass-worktrees\.mjs" --since "\$SINCE"/);
    expect(block).toMatch(/SALVAGE_FAILED/);
  });
  it("the salvage step sits after the claude call (safe to land under a running copy)", () => {
    expect(sh.indexOf("salvage-pass-worktrees.mjs")).toBeGreaterThan(sh.indexOf('"$CLAUDE" -p'));
  });
  it("the prompt tells every pass to checkpoint and to continue a salvaged PR", () => {
    const prompt = readFileSync("scripts/ops/ahrefs-audit-fix-prompt.md", "utf8");
    expect(prompt).toMatch(/### NEVER LOSE FINISHED WORK/);
    expect(prompt).toMatch(/Salvaged: in:title/);
    expect(prompt).toMatch(/Commit and push after each finished group of briefs/);
  });
});
