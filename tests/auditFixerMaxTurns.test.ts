/**
 * THE TURN LIMIT REACHES THE WORKER (9 Nov 2026). ahrefs-audit-fix.sh set MAX_TURNS and never passed
 * it (shellcheck SC2034), so the repair ran on the engine's default and left half-finished drafts.
 * This runs the REAL script with a recording ai-run on PATH and fails if the repair call stops
 * carrying `--max-turns <n>` in AI_RUN_CLAUDE_ARGS (the form ai-run hands to `claude -p`, also on a
 * Codex-limit handoff), if the override is ignored, or if a bad value reaches the worker at all.
 */
import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function runFixer(extra: Record<string, string>) {
  const home = mkdtempSync(join(tmpdir(), "audit-turns-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const calls = join(home, "ai-run-calls");
  const w = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  w("ai-run", `role=""; while [ $# -gt 0 ]; do case "$1" in --role) role="$2"; shift 2;; --) break;; *) shift;; esac; done
printf 'role=%s args=%s\\n' "$role" "\${AI_RUN_CLAUDE_ARGS-<unset>}" >> "${calls}"; exit 1`);
  w("gh", "exit 0");
  w("curl", "printf 200");
  writeFileSync(join(home, "prompt.md"), "Do the thing.\n");
  const repoRoot = process.cwd();
  const r = spawnSync("/bin/bash", [join(repoRoot, "scripts/ops/ahrefs-audit-fix.sh")], {
    env: { ...(process.env as Record<string, string>), HOME: home, PATH: `${bin}:${process.env.PATH}`, BOSS_OS_REPO: repoRoot, AHREFS_AUDIT_PROMPT: join(home, "prompt.md"), SR_SCOPE_REPO: "test-repo", ...extra },
    encoding: "utf8",
    timeout: 60000,
  });
  const lines = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : [];
  return { rc: r.status, out: `${r.stdout}${r.stderr}`, worker: lines.filter((l) => l.startsWith("role=worker ")) };
}

it("the repair call carries --max-turns (default 250, override honoured); a bad value never reaches the worker", () => {
  const dflt = runFixer({});
  expect(dflt.worker.length, dflt.out).toBe(1);
  const perms = `--permission-mode dontAsk --setting-sources= --settings ${process.cwd()}/scripts/ops/sr-fix-permissions.json`;
  expect(dflt.worker[0]).toBe(`role=worker args=--max-turns 250 ${perms}`);
  const seven = runFixer({ AHREFS_AUDIT_MAX_TURNS: "7" });
  expect(seven.worker).toEqual([`role=worker args=--max-turns 7 ${perms}`]);
  // NEGATIVE: a value that is not a positive whole number is a named stop, and the worker never runs.
  const bad = runFixer({ AHREFS_AUDIT_MAX_TURNS: "lots" });
  expect(bad.worker).toEqual([]);
  expect(bad.out).toMatch(/NAMED STOP \[BAD_MAX_TURNS\]/);
  expect(bad.rc).toBe(5);
}, 120000);

/**
 * THE WORKER'S ALLOW LIST IS ONE THE CLI CAN READ (22 Nov 2026). A rule that mixes a * with the
 * trailing :* prefix, or several rules in one string, is matched literally and never allows anything
 * (the 17 Nov Claude pass warned of exactly that). And what must stay refused is on the deny list.
 */
it("sr-fix's permissions: every allow rule is one well-formed rule, and pushes to main, force pushes and merges are denied", () => {
  const p = JSON.parse(readFileSync("scripts/ops/sr-fix-permissions.json", "utf8")).permissions;
  for (const r of [...p.allow, ...p.deny]) {
    expect(r, r).toMatch(/^(Read|Glob|Grep|Edit|Write|mcp__[a-z-]+|Bash\([^()]+\))$/);
    if (p.allow.includes(r)) expect(r.replace(/:\*\)$/, ")"), `${r} mixes * with :*`).not.toMatch(/\*.*\)$|,/);
  }
  const prefix = (rule: string) => rule.replace(/^Bash\(/, "").replace(/(:\*)?\)$/, "");
  const denied = (cmd: string) => p.deny.some((r: string) => cmd.startsWith(prefix(r)));
  for (const cmd of ["git push origin HEAD:main", "git push origin HEAD:refs/heads/main", "gh api -X POST repos/x/y/merges", "npx wrangler r2 bucket delete x", "wrangler d1 execute db --remote", "git push --force origin x", "git push origin HEAD --force", "gh pr merge 12 --squash", "wrangler deploy", "rm -rf /", "gh secret set X"]) {
    expect(denied(cmd), cmd).toBe(true);
  }
  for (const cmd of ["git push origin HEAD:sr-fix-branch", "gh pr create --fill", "land 12"]) expect(denied(cmd), cmd).toBe(false);
});

/**
 * THE FILE IS THE WHOLE LIST (review S3/S4, 22 Nov 2026). The worker runs from $HOME, so without
 * `--setting-sources=` her user, project and local allow rules joined this file's (her signed-in Chrome,
 * `wrangler r2 *`, any push). The launch loads no other source; the file carries her command guard; no
 * allow rule hands over arbitrary GitHub API writes, another repo's git, or any command under `timeout`.
 */
it("sr-fix's permissions are the whole list: no inherited sources, the command guard rides along, no open-ended allows", () => {
  const f = JSON.parse(readFileSync("scripts/ops/sr-fix-permissions.json", "utf8"));
  const sh = readFileSync("scripts/ops/ahrefs-audit-fix.sh", "utf8");
  expect(sh).toMatch(/AI_RUN_CLAUDE_ARGS="[^"]*--setting-sources= --settings \$SR_FIX_SETTINGS"/);
  const guard = f.hooks?.PreToolUse?.find((h: { matcher: string }) => h.matcher === "Bash")?.hooks?.[0]?.command ?? "";
  expect(guard).toMatch(/command-guard\.mjs/);
  expect(guard).not.toMatch(/\/Users\//);
  for (const open of ["Bash(gh api:*)", "Bash(git -C:*)", "Bash(timeout:*)"]) expect(f.permissions.allow, open).not.toContain(open);
  expect(f.permissions.deny).toContain("mcp__claude-in-chrome");
});
