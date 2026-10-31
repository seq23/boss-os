import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { CODEX_BUILD_NOTE, codexExecArgs, codexSeatUsable, finishCodexBuild, runWithCodexFallback, type RunResult } from "../scripts/lib/codex-seat.mjs";
import { readFileSync } from "node:fs";
// @ts-expect-error — plain ESM with no declaration file
import { claudeSpentUsage as spentOf } from "../scripts/ops/repo-change.mjs";

/** The runner's own reading of a finished run: it inspects only a failed one, as the shipped code does. */
const claudeSpentUsage = (r: { out: string; err: string; code?: number | null; isError?: boolean }): string | null =>
  spentOf({ code: r.code ?? 1, isError: r.isError ?? true, timedOut: false, ...r });

/**
 * REPO WORK ON CARDS HAS A SECOND MODEL WHEN CLAUDE CODE'S PLAN IS SPENT (29 Sep 2026).
 *
 * The Mac job runs `claude -p` for each phase and reads the RESULT FROM A FILE the model writes, so
 * which model wrote it does not change how the phase is judged. These cases prove the hand-over is
 * made for exactly one reason — a spent plan — and for no other, with the CLIs replaced by fakes.
 * Nothing here runs Codex; the flag set is UNPROVEN against the installed binary (see codex-seat.mjs).
 */

const ok = (out = "{}", err = ""): RunResult => ({ code: 0, out, err });
const LIMIT_JSON = "Claude AI usage limit reached|1759071600"; // the `result` text the runner keeps from the stream

function harness(opts: { claude: RunResult; usable?: { ok: boolean; why: string }; missing?: string | null; codex?: RunResult }) {
  const calls: string[] = [];
  const lines: string[] = [];
  const run = () =>
    runWithCodexFallback({
      runClaude: async () => (calls.push("claude"), opts.claude),
      runCodex: async () => (calls.push("codex"), opts.codex ?? ok("codex wrote the result file")),
      limited: claudeSpentUsage,
      usable: () => opts.usable ?? { ok: true, why: "auth_mode=chatgpt" },
      supports: async (flags) => (calls.push(`supports:${flags.join(",")}`), opts.missing ?? null),
      addDirs: ["/job", "/pkg"],
      onLine: (l) => lines.push(l),
    });
  return { run, calls, lines };
}

describe("claudeSpentUsage — a spent plan, and nothing else", () => {
  it("reads a failed run that says the plan is out, in JSON or as bare text", () => {
    expect(claudeSpentUsage({ out: LIMIT_JSON, err: "" })).toContain("usage limit reached");
    expect(claudeSpentUsage({ out: "", err: "You've hit your limit · resets 3pm" })).toContain("hit your limit");
    expect(claudeSpentUsage({ out: "Claude AI usage limit reached|1759071600", err: "" })).toBeTruthy();
  });

  it("never treats a SUCCESSFUL run as spent, whatever its answer says", () => {
    const success = "The docs mention that usage limit reached is what the CLI prints.";
    expect(claudeSpentUsage({ out: success, err: "", code: 0, isError: false })).toBeNull();
    expect(spentOf({ out: LIMIT_JSON, err: "", code: 1, isError: true, timedOut: true }), "a timeout is not a spent plan").toBeNull();
  });

  it("does not mistake an ordinary failure for a spent plan", () => {
    const bad = "Tool call failed: npm run validate exited 1";
    expect(claudeSpentUsage({ out: bad, err: "" })).toBeNull();
    expect(claudeSpentUsage({ out: "", err: "TypeError: cannot read properties of undefined" })).toBeNull();
    expect(claudeSpentUsage({ out: "", err: "" })).toBeNull();
  });
});

describe("runWithCodexFallback", () => {
  it("leaves a healthy Claude run alone and never touches Codex", async () => {
    const h = harness({ claude: { ...ok("done"), isError: false } as any });
    const r = await h.run();
    expect(r.servedBy).toBe("claude");
    expect(r.handedOver).toBe(false);
    expect(h.calls).toEqual(["claude"]);
  });

  it("hands the SAME phase to Codex when — and only when — Claude Code's plan is spent, and says so", async () => {
    const h = harness({ claude: { code: 1, out: LIMIT_JSON, err: "" } });
    const r = await h.run();
    expect(r.servedBy).toBe("codex");
    expect(r.handedOver).toBe(true);
    expect(r.out).toContain("served by Codex");
    expect(r.out).toContain("codex wrote the result file");
    expect(h.calls).toEqual(["claude", "supports:--sandbox,--add-dir", "codex"]);
    expect(h.lines.some((l) => l.includes("handing this phase to Codex"))).toBe(true);
  });

  it("does NOT hand over an ordinary failure — the phase fails as it always did", async () => {
    const claude = { code: 1, out: "npm run validate exited 1", err: "" };
    const h = harness({ claude });
    const r = await h.run();
    expect(r.servedBy).toBe("claude");
    expect(r.handedOver).toBe(false);
    expect(h.calls).toEqual(["claude"]);
    expect(r.code).toBe(1);
  });

  it("refuses to use Codex when it would bill the API, and says why in the phase's own error text", async () => {
    const h = harness({ claude: { code: 1, out: LIMIT_JSON, err: "" }, usable: { ok: false, why: "no longer records auth_mode=chatgpt" } });
    const r = await h.run();
    expect(r.handedOver).toBe(false);
    expect(r.err).toContain("Codex cannot stand in");
    expect(r.err).toContain("auth_mode=chatgpt");
    expect(h.calls).toEqual(["claude"]);
  });

  it("is unavailable, with a sentence, when the installed Codex lacks a flag the phase needs", async () => {
    const h = harness({ claude: { code: 1, out: LIMIT_JSON, err: "" }, missing: "--add-dir" });
    const r = await h.run();
    expect(r.handedOver).toBe(false);
    expect(r.err).toContain("does not support --add-dir");
    expect(h.calls).not.toContain("codex");
  });

  it("asks only for the flags the phase needs: no --add-dir when there are no extra folders", async () => {
    const calls: string[] = [];
    await runWithCodexFallback({
      runClaude: async () => ({ code: 1, out: LIMIT_JSON, err: "" }),
      runCodex: async () => ok(),
      limited: claudeSpentUsage,
      usable: () => ({ ok: true, why: "" }),
      supports: async (f) => (calls.push(f.join(",")), null),
      addDirs: [],
    });
    expect(calls).toEqual(["--sandbox"]);
  });
});

describe("the runner is wired to it, and keeps every key off the Codex child", () => {
  const src = readFileSync(new URL("../scripts/ops/repo-change.mjs", import.meta.url), "utf8");
  it("runs each phase through the fallback, gives Codex the phase's folder, and strips OPENAI_* from its environment", () => {
    expect(src).toMatch(/return runWithCodexFallback\(/);
    expect(src).toMatch(/addDirs: \[dir\]/);
    expect(src).toMatch(/filter\(\(\[k\]\) => !\/\^OPENAI_\/i\.test\(k\)\)/);
    expect(src).toMatch(/spawn\("codex", codexExecArgs\(writable\)/);
  });
});

describe("the Codex run itself", () => {
  it("edits only the worktree and the named folders, reaches the network, reads the prompt from stdin", () => {
    const a = codexExecArgs(["/job", "/pkg"]);
    expect(a[0]).toBe("exec");
    expect(a).toContain("workspace-write");
    expect(a).not.toContain("danger-full-access");
    expect(a.join(" ")).toContain("sandbox_workspace_write.network_access=true");
    expect(a.join(" ")).toContain("--add-dir /job --add-dir /pkg");
    expect(a[a.length - 1]).toBe("-");
  });

  it("is usable only on the ChatGPT subscription — an API-key login would bill per token", () => {
    const home = mkdtempSync(path.join(tmpdir(), "codex-home-"));
    try {
      expect(codexSeatUsable(home).ok).toBe(false);
      mkdirSync(path.join(home, ".codex"));
      writeFileSync(path.join(home, ".codex", "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "x" }));
      const bad = codexSeatUsable(home);
      expect(bad.ok).toBe(false);
      expect(bad.why).toContain("bill the API per token");
      writeFileSync(path.join(home, ".codex", "auth.json"), JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: null }));
      expect(codexSeatUsable(home).ok).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("Codex edits; the runner commits, pushes and opens the PR — never merges (31 Oct 2026)", () => {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();

  function scratch() {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "codex-finish-")));
    const origin = path.join(root, "origin.git");
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    const main = path.join(root, "main");
    git(root, "clone", "-q", origin, main);
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    git(main, "push", "-q", "origin", "HEAD:main");
    const wt = path.join(root, "wt");
    git(main, "worktree", "add", "-q", wt, "-b", "work/rc-probe", "origin/main");
    const gh: string[][] = [];
    const run = (cmd: string, args: string[], o: { cwd: string }) => {
      if (cmd === "gh") {
        gh.push(args);
        if (args[1] === "view") return { status: 1, stdout: "", stderr: "no pull requests found" };
        return { status: 0, stdout: "https://github.com/seq23/probe/pull/7\n", stderr: "" };
      }
      try { return { status: 0, stdout: execFileSync(cmd, args, { cwd: o.cwd, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }), stderr: "" }; }
      catch (e: any) { return { status: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") }; }
    };
    return { root, origin, main, wt, gh, run };
  }

  it("turns Codex's uncommitted edits (and its GIT_METADATA_READ_ONLY block) into a commit, a pushed branch and a PR", () => {
    const s = scratch();
    try {
      writeFileSync(path.join(s.wt, "fix.txt"), "the repair");
      const out = { branch: "work/rc-probe", blocked: { tag: "GIT_METADATA_READ_ONLY", why: "index.lock denied" }, proof: { validators_passed: true }, pr_title: "Repair the probe" };
      const fin = finishCodexBuild({ cwd: s.wt, repo: "probe", branch: "work/rc-probe", out, run: s.run });
      expect(fin.ok).toBe(true);
      if (!fin.ok) return;
      expect(fin.result.pr_number).toBe(7);
      expect(fin.result.blocked).toBeUndefined();
      expect(git(s.wt, "status", "--porcelain")).toBe("");
      expect(git(s.wt, "log", "-1", "--format=%s")).toBe("Repair the probe");
      expect(git(s.root, "--git-dir", s.origin, "rev-parse", "refs/heads/work/rc-probe")).toBe(git(s.wt, "rev-parse", "HEAD"));
      // main on the remote never moved, and nothing asked gh to merge.
      expect(git(s.root, "--git-dir", s.origin, "log", "--format=%s", "main")).toBe("init");
      expect(s.gh.some((a) => a.includes("merge"))).toBe(false);
      expect(s.gh.find((a) => a[1] === "create")).toEqual(expect.arrayContaining(["--base", "main", "--head", "work/rc-probe"]));
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it("refuses main, respects a real block, and names an empty build", () => {
    const s = scratch();
    try {
      expect(finishCodexBuild({ cwd: s.main, repo: "probe", branch: "main", out: {}, run: s.run })).toMatchObject({ ok: false, tag: "REFUSED_PROTECTED_BRANCH" });
      writeFileSync(path.join(s.wt, "x.txt"), "x");
      expect(finishCodexBuild({ cwd: s.wt, repo: "probe", branch: "work/rc-probe", out: { blocked: { tag: "VALIDATOR_RED", why: "npm run validate failed" } }, run: s.run })).toMatchObject({ ok: false, tag: "CODEX_BLOCKED" });
      expect(git(s.wt, "status", "--porcelain")).not.toBe("");
      rmSync(path.join(s.wt, "x.txt"));
      expect(finishCodexBuild({ cwd: s.wt, repo: "probe", branch: "work/rc-probe", out: {}, run: s.run })).toMatchObject({ ok: false, tag: "NO_CHANGES" });
      expect(finishCodexBuild({ cwd: s.wt, repo: "probe", branch: "work/rc-probe", out: null, run: s.run })).toMatchObject({ ok: false, tag: "NO_RESULT_FILE" });
      expect(s.gh).toEqual([]);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it("names no git directory as writable to Codex, tells a build it does not commit, and lets a land phase wait", async () => {
    const src = readFileSync(new URL("../scripts/ops/repo-change.mjs", import.meta.url), "utf8");
    expect(src).not.toMatch(/git-common-dir/);
    expect(src).toMatch(/if \(phase === "build"\) prompt = `\$\{prompt\}\$\{CODEX_BUILD_NOTE\}`/);
    expect(src).toMatch(/phase === "build" && servedBy === "codex" && buildPath\) \{\n\s+const fin = finishCodexBuild\(/);
    expect(CODEX_BUILD_NOTE).toMatch(/runner commits, pushes/);
    const calls: string[] = [];
    const r = await runWithCodexFallback({
      runClaude: async () => ({ code: 1, out: LIMIT_JSON, err: "" }),
      runCodex: async () => (calls.push("codex"), ok()),
      limited: claudeSpentUsage,
      usable: () => ({ ok: true, why: "" }),
      supports: async () => null,
      phase: "land",
    });
    expect(calls).toEqual([]);
    expect(r.waitForSeat).toBe(true);
    expect(r.err).toContain("waits for it");
  });
});
