/**
 * Every scheduled claude run is locked to its own permissions file (24 Nov 2026). These prove the
 * lock, and that a refused or missing tool ends the run as refused or unknown, never as an answer.
 * The two fixtures are real locked runs (24 Nov 2026), trimmed: a Write outside the allow list that
 * dontAsk refused, and a run whose tool was denied so it never loaded.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
// @ts-expect-error plain .mjs
import { JOBS, jobProblems, scanProblems, unlockedCalls, sandboxProblems, SANDBOX_BREAKS } from "../scripts/validate/claude-runs-locked.mjs";
// @ts-expect-error plain .mjs
import { lockedArgs, refusals, resultText } from "../scripts/ops/lib/claude-lock.mjs";
// @ts-expect-error plain .mjs
import { permissionDenials } from "../scripts/ops/lib/permission-denials.mjs";
// @ts-expect-error plain .mjs
import { connectorVerdict } from "../scripts/ops/credential-check.mjs";
// @ts-expect-error plain .mjs
import { gmailAnswer, REFUSED_ANSWER } from "../scripts/ops/kdp-signin.mjs";
import { askClaudeJson } from "../scripts/ops/lib/duty-kit.mjs";

const ROOT = join(__dirname, "..");
const REFUSED = readFileSync(join(ROOT, "tests/fixtures/claude-locked-refused-write.jsonl"), "utf8");
const NOT_LOADED = readFileSync(join(ROOT, "tests/fixtures/claude-locked-tool-not-loaded.jsonl"), "utf8");
const settings = (name: string) => JSON.parse(readFileSync(join(ROOT, "scripts/ops", `${name}-permissions.json`), "utf8"));
const LIB = join(ROOT, "scripts/ops/lib/claude-lock.sh");
const sh = (script: string, env: Record<string, string> = {}) =>
  spawnSync("bash", ["-c", `source "${LIB}"; ${script}`], { encoding: "utf8", env: { ...process.env, ...env } });

describe("each job's permissions file", () => {
  for (const job of JOBS) {
    it(`${job.name}: passes, and fails with each needed tool removed`, () => {
      const real = settings(job.name);
      expect(jobProblems(real, job)).toEqual([]);
      for (const tool of job.needs) {
        const s = structuredClone(real);
        s.permissions.allow = s.permissions.allow.filter((a: string) => a !== tool);
        expect(jobProblems(s, job).join("\n")).toMatch(new RegExp(`missing ${tool.replace(/[()*.]/g, "\\$&")}|empty allow list`));
      }
    });
  }
  it("noelle: Agent is allowed only while her guard runs on every Agent call", () => {
    const job = JOBS.find((j: { name: string }) => j.name === "noelle");
    const real = settings("noelle");
    expect(real.permissions.allow).toContain("Agent");
    expect(real.permissions.additionalDirectories).toBeUndefined(); // her sandbox, not a widened list, sets her paths
    expect(jobProblems(real, job)).toEqual([]);
    const s = structuredClone(real);
    s.hooks.PreToolUse = s.hooks.PreToolUse.filter((h: { matcher: string }) => h.matcher !== "*");
    expect(jobProblems(s, job).join("\n")).toMatch(/allows Agent without noelle-guard\.mjs/);
    const t = structuredClone(real);
    t.permissions.deny.push("Task"); // 24 Nov 2026: a real locked run lost the Agent tool to this
    expect(jobProblems(t, job).join("\n")).toMatch(/denies? .*Task, which removes the Agent tool|holds Task, which removes the Agent tool/);
    const b = structuredClone(settings("builder"));
    b.permissions.deny = b.permissions.deny.filter((d: string) => d !== "Agent");
    expect(jobProblems(b, JOBS.find((j: { name: string }) => j.name === "builder")).join("\n")).toMatch(/deny is missing Agent/);
  });
  it("noelle: public research rejects permissions that open paid tools, writes or shell egress", () => {
    const job = JOBS.find((j: { name: string }) => j.name === "noelle");
    for (const tool of ["mcp__openseo__get_serp_results", "mcp__openseo__save_keywords", "WebFetch(domain:*)"]) {
      const changed = settings("noelle");
      changed.permissions.allow.push(tool);
      expect(sandboxProblems(changed, job.sandbox).join("\n")).toContain(tool);
    }
  });
  it("noelle: her settings without the sandbox, or with any way out of it, fail the build", () => {
    const job = JOBS.find((j: { name: string }) => j.name === "noelle");
    const real = settings("noelle");
    expect(sandboxProblems(real, job.sandbox)).toEqual([]);
    for (const [name, f] of SANDBOX_BREAKS) {
      const s = structuredClone(real);
      f(s);
      expect(jobProblems(s, job).length, name).toBeGreaterThan(0);
    }
    const none = structuredClone(real); delete none.sandbox;
    expect(jobProblems(none, job).join("\n")).toMatch(/has no sandbox block/);
  });
  it("a deny rule's refusal is counted, in its own wording, as well as dontAsk's", () => {
    const line = (content: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "gh api user" } }] } }) + "\n"
      + JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content }] } }) + "\n";
    expect(permissionDenials(line("Permission to use Bash with command gh api user has been denied."))).toEqual([{ tool: "Bash", command: "gh api user" }]);
    expect(permissionDenials(line("Permission to use Bash has been denied because Claude Code is running in don't ask mode."))).toHaveLength(1);
    expect(permissionDenials(line("Exit code 1: no such file"))).toEqual([]);
    const twice = line("Permission to use Bash with command gh api user has been denied.");
    expect(permissionDenials(twice + twice.split("\n")[1] + "\n")).toHaveLength(1); // the same result written twice is one refusal
  });
  it("Rule 0: no allow list, or an empty one not marked text_only, fails", () => {
    const job = JOBS.find((j: { name: string }) => j.name === "kdp-watch");
    expect(jobProblems({ permissions: { deny: [] } }, job)[0]).toMatch(/no allow list/);
    expect(jobProblems({ permissions: { allow: [], deny: [] } }, job)[0]).toMatch(/empty allow list/);
  });
  it("no job file allows a write tool it does not need, or loads her settings", () => {
    for (const job of JOBS) {
      const s = settings(job.name);
      expect(s.permissions.defaultMode ?? "dontAsk").toBe("dontAsk");
      expect(JSON.stringify(s)).not.toMatch(/\/Users\/|bypassPermissions/);
    }
    expect(settings("credential-check").permissions.allow).toEqual(["mcp__claude_ai_Gmail__search_threads"]);
    expect(settings("mailbox-sweep").permissions.allow).not.toContain("mcp__claude_ai_Gmail__send_message");
  });
});

describe("the scan over scripts/", () => {
  const SKIP = "--dangerously-skip-permissions";
  it("finds the skip flag put back into each locked script", () => {
    for (const f of ["scripts/ops/kdp-watch.sh", "scripts/ops/mailbox-sweep.sh", "scripts/ops/boss-mail-tail-run.sh"]) {
      const text = readFileSync(join(ROOT, f), "utf8");
      expect(unlockedCalls(f, text)).toEqual([]);
      expect(unlockedCalls(f, text.replace(/\$CLAUDE_LOCK\b/g, SKIP)).length).toBeGreaterThan(0);
    }
    for (const f of ["scripts/ops/credential-check.mjs", "scripts/ops/kdp-signin.mjs", "scripts/ops/repo-change.mjs", "scripts/ops/lib/duty-kit.mjs"]) {
      const text = readFileSync(join(ROOT, f), "utf8");
      expect(unlockedCalls(f, text)).toEqual([]);
      expect(unlockedCalls(f, text.replace(/\.\.\.lockedArgs\("[^"]+"\)/g, `"${SKIP}"`)).length).toBeGreaterThan(0);
    }
  });
  it("finds a bare claude -p and an ai-run with no locked args; a stale exception fails", () => {
    expect(scanProblems([["x.sh", '"$CLAUDE" -p "$(cat p)" --model opus']], [])).toHaveLength(1);
    expect(scanProblems([["x.sh", '"$AI_RUN" --role brain --out "$L" < p']], [])).toHaveLength(1);
    expect(scanProblems([["x.sh", 'AI_RUN_CLAUDE_ARGS="$X --permission-mode dontAsk --setting-sources= --settings f.json" "$AI_RUN" --role brain']], [])).toEqual([]);
    expect(scanProblems([["x.sh", "echo"]], [{ file: "x.sh", match: "y", why: "z" }])[0]).toMatch(/stale exception/);
  });
  it("the whole repo passes the validator", () => {
    const r = spawnSync("node", [join(ROOT, "scripts/validate/claude-runs-locked.mjs")], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});

describe("a refused or missing tool is never an answer", () => {
  it("refusals() reads a real refused call, and the result event's list", () => {
    expect(refusals(REFUSED).map((d: { tool: string }) => d.tool)).toEqual(["Write"]);
    const onlyResult = REFUSED.split("\n").filter((l) => l.includes('"type":"result"')).join("\n");
    expect(refusals(onlyResult).map((d: { tool: string }) => d.tool)).toEqual(["Write"]);
    expect(refusals(NOT_LOADED)).toEqual([]);
  });
  it("credential-check: a refused probe is unknown, even if the text claims the sentinel", () => {
    const forged = REFUSED.replace(/"result":"[^"]*"/, '"result":"CRED-GMAIL: OK"');
    const v = connectorVerdict(forged);
    expect(v.state).toBe("unknown");
    expect(v.detail).toContain("NAMED STOP [PERMISSION_DENIED]");
    expect(connectorVerdict(NOT_LOADED).state).toBe("unknown");
  });
  it("kdp-signin: a refused Gmail read is the refused answer, never a code", () => {
    expect(gmailAnswer(REFUSED.replace(/"result":"[^"]*"/, '"result":"123456"'))).toContain(REFUSED_ANSWER);
    expect(resultText(NOT_LOADED)).toMatch(/no Bash tool/);
  });
  it("askClaudeJson: a refused run is not ok", () => {
    const run = () => ({ status: 0, stdout: REFUSED.replace(/"result":"[^"]*"/, '"result":"{\\"ok\\":true}"'), stderr: "" });
    const r = askClaudeJson("p", { run, evidence: null });
    expect(r.ok).toBe(false);
    expect((r as { why?: string }).why).toContain("PERMISSION_DENIED");
  });
  it("every node spawn carries the four lock flags", () => {
    const a = lockedArgs("builder");
    expect(a.slice(0, 4)).toEqual(["--permission-mode", "dontAsk", "--setting-sources=", "--settings"]);
    expect(a[4]).toMatch(/scripts\/ops\/builder-permissions\.json$/);
  });
});

describe("lib/claude-lock.sh", () => {
  const dir = mkdtempSync(join(tmpdir(), "lock-"));
  it("refuses a missing permissions file by name (exit 6), and a path with a space", () => {
    const r = sh(`claude_lock_args "${dir}/none.json"`);
    expect(r.status).toBe(6);
    expect(r.stderr).toContain("NAMED STOP [NO_PERMISSIONS_FILE]");
    writeFileSync(join(dir, "a b.json"), "{}");
    expect(sh(`claude_lock_args "${dir}/a b.json"`).status).toBe(6);
    writeFileSync(join(dir, "ok.json"), "{}");
    expect(sh(`claude_lock_args "${dir}/ok.json"`).stdout).toBe(`--permission-mode dontAsk --setting-sources= --settings ${dir}/ok.json`);
  });
  it("claude_denials: a refused run counts 1 with its DENIED line; a missing transcript is unknown, never 0", () => {
    const log = join(dir, "run.log");
    writeFileSync(join(dir, "t.jsonl"), REFUSED);
    expect(sh(`claude_denials "${dir}/t.jsonl" "${log}"`).stdout.trim()).toBe("1");
    expect(readFileSync(log, "utf8")).toContain("DENIED Write");
    expect(sh(`claude_denials no-such-session "${log}"`, { HOME: dir }).stdout.trim()).toBe("unknown");
    writeFileSync(join(dir, "bad.jsonl"), "");
    expect(sh(`claude_denials "${dir}/bad.jsonl" "${log}"`).stdout.trim()).not.toBe("0");
  });
});
