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

/** A scoped pass reads its briefs from the queue before the worker starts (the pass packet): one brief for test-repo. */
function writeQueue(home: string) {
  mkdirSync(join(home, ".boss-os/search-readiness"), { recursive: true });
  writeFileSync(join(home, ".boss-os/search-readiness/fix-queue.json"), JSON.stringify({ written_at: "2026-11-27T00:00:00Z", briefs: [{ id: "sr-test.example-b1", repo: "test-repo", domain: "test.example", item_id: "b1", failure: "a title is 81 chars" }] }));
}

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
  writeQueue(home);
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
  // 27 Nov 2026: only the tools the allow list names are loaded (--tools), in the allow list's own order.
  const perms = `--tools Read,Glob,Grep,Edit,Write,Bash --permission-mode dontAsk --setting-sources= --settings ${process.cwd()}/scripts/ops/sr-fix-permissions.json`;
  const sid = "--session-id [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  expect(dflt.worker[0]).toMatch(new RegExp(`^role=worker args=--max-turns 250 ${sid} ${esc(perms)}$`));
  const seven = runFixer({ AHREFS_AUDIT_MAX_TURNS: "7" });
  expect(seven.worker.length).toBe(1);
  expect(seven.worker[0]).toMatch(new RegExp(`^role=worker args=--max-turns 7 ${sid} ${esc(perms)}$`));
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

/**
 * A REFUSED COMMAND IS A NAMED STOP, NEVER A QUIET PASS (23 Nov 2026). dontAsk refused the worker's
 * `git -C`, `grep`, `curl -s`, `gh run list` and the worktree helper by its full path (60+ refusals in
 * the 17-22 Nov passes), the model worked around them, and passes ended 0 with fixes half done. This
 * runs the REAL script through a COMPLETE pass (sentinel, findings, land and report stubbed green): a
 * transcript with one refusal ends 14 with the refused command named; the same pass with none ends 0;
 * an unreadable transcript is refused, never read as "no refusals".
 */
function fullPass(transcript: "denied" | "clean" | "unreadable") {
  const home = mkdtempSync(join(tmpdir(), "audit-denied-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const w = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  const denied = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "git -C ~/GitHub/x log -3" } }] } }) + "\n"
    + JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "Permission to use Bash has been denied because Claude Code is running in don't ask mode." }] } }) + "\n";
  const clean = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "ok" }] } }) + "\n";
  writeFileSync(join(home, "denied.jsonl"), denied);
  writeFileSync(join(home, "clean.jsonl"), clean);
  const src = transcript === "unreadable" ? "" : join(home, `${transcript}.jsonl`);
  w("ai-run", `sid="$(printf '%s' "$AI_RUN_CLAUDE_ARGS" | sed -n 's/.*--session-id \\([^ ]*\\).*/\\1/p')"
d="$HOME/.claude/projects/-home"; mkdir -p "$d"
if [ -n "${src}" ]; then cp "${src}" "$d/$sid.jsonl"; else mkdir -p "$d/$sid.jsonl"; fi
mkdir -p "$BOSS_OS_SITE_AUDIT_DIR"
echo '{"findings":[{"disposition":"none","repo":"test-repo"}]}' > "$BOSS_OS_SITE_AUDIT_DIR/findings.json"
echo "AHREFS-AUDIT-COMPLETE: projects=1 fixed=0"; exit 0`);
  w("gh", "exit 0");
  w("curl", "printf 200");
  w("npm", "exit 0");
  writeFileSync(join(home, "prompt.md"), "Do the thing.\n");
  writeQueue(home);
  const repoRoot = process.cwd();
  const r = spawnSync("/bin/bash", [join(repoRoot, "scripts/ops/ahrefs-audit-fix.sh")], {
    env: { ...(process.env as Record<string, string>), HOME: home, PATH: `${bin}:${process.env.PATH}`, BOSS_OS_REPO: repoRoot, AHREFS_AUDIT_PROMPT: join(home, "prompt.md"), SR_SCOPE_REPO: "test-repo", BOSS_OS_SITE_AUDIT_DIR: join(home, "sa") },
    encoding: "utf8",
    timeout: 60000,
  });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
}

it("a command the worker was refused ends the pass 14 as NAMED STOP [PERMISSION_DENIED], naming the command", () => {
  const bad = fullPass("denied");
  expect(bad.out).toMatch(/DENIED Bash: git -C ~\/GitHub\/x log -3/);
  expect(bad.out).toMatch(/NAMED STOP \[PERMISSION_DENIED\] the worker was refused 1 command/);
  expect(bad.rc, bad.out).toBe(14);
  // NEGATIVE: the same complete pass with no refusal is a clean 0 (the stop is not always on).
  const ok = fullPass("clean");
  expect(ok.out).not.toMatch(/PERMISSION_DENIED/);
  expect(ok.rc, ok.out).toBe(0);
  // OUTAGE: a transcript that cannot be read is a stop, never "no refusals".
  const blind = fullPass("unreadable");
  expect(blind.out).toMatch(/NAMED STOP \[PERMISSION_DENIED\] the worker's transcript .* could not be read/);
  expect(blind.rc, blind.out).toBe(14);
}, 180000);

/**
 * THE PROMPT'S OWN COMMANDS ARE ON THE LIST (23 Nov 2026). The prompt said
 * `bash ~/GitHub/boss-os/scripts/ops/audit-worktree.sh` and the list allowed only the runtime copy, so
 * the helper every pass needs first was refused 28 times. Every `bash ~/…` line the prompt tells the
 * worker to run must match an allow rule, and the refusals seen in those passes are allowed now.
 */
it("every helper command the prompt hands the worker matches an allow rule", () => {
  const p = JSON.parse(readFileSync("scripts/ops/sr-fix-permissions.json", "utf8")).permissions;
  const prefix = (rule: string) => rule.replace(/^Bash\(/, "").replace(/(:\*)?\)$/, "");
  const allowed = (cmd: string) => p.allow.some((r: string) => r.startsWith("Bash(") && (r.endsWith(":*)") ? cmd.startsWith(prefix(r)) : cmd === prefix(r)));
  const prompt = readFileSync("scripts/ops/ahrefs-audit-fix-prompt.md", "utf8");
  const cmds = [...prompt.matchAll(/^(bash ~\/\S+.*)$/gm)].map((m) => (m[1] ?? "").trim());
  // 27 Nov 2026: the runner, not the worker, now crawls for the row and the next cut prunes, so the
  // worktree cut is the one helper the prompt still hands over by `bash`; it must be found and allowed.
  expect(cmds).toContain("bash ~/.boss-os/runtime/scripts/ops/audit-worktree.sh <repo>");
  for (const c of cmds) expect(allowed(c), c).toBe(true);
  // The packet's fallback when GitHub would not give the open work: the in-flight check by hand.
  expect(allowed("node ~/GitHub/boss-os/scripts/ops/site-audit-lib.mjs inflight keepmyproof oregon"), "inflight").toBe(true);
  for (const c of ["grep -o x file.html", "git worktree list", "curl -s https://example.com/", "curl -sL https://example.com/", "gh run list --repo seq23/x", "gh pr diff 1 --repo seq23/x", "git ls-files aplayermode", "git remote -v"]) {
    expect(allowed(c), c).toBe(true);
  }
});
