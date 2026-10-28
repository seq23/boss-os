/**
 * A SPENT AI ALLOWANCE IS "RETRY LATER", NOT "NOTHING LEFT TO TRY" (28 Oct 2026) — the guard.
 *
 * CONFIRMED from the logs (~/Library/Logs/boss-sr-fix/2026-10-28-073001.log,
 * ~/Library/Logs/ahrefs-audit-fix/2026-10-28-084817-54940.log): `codex exec` echoes the prompt it was
 * given into the run log, and the prompt carries the completion sentinel as a TEMPLATE
 * ("AHREFS-AUDIT-COMPLETE: projects=<n> fixed=<n> …"). The old `grep -q "AHREFS-AUDIT-COMPLETE:"`
 * matched that echo, so a pass that hit its ChatGPT usage limit in the first second — before the
 * model ran at all — was judged a finished pass and sent on to land a findings file that was never
 * written. These tests run the REAL scripts/ops/ahrefs-audit-fix.sh and
 * scripts/ops/search-readiness-fix.sh against faked codex/claude/gh/security/curl, and fail if: the
 * echoed template is ever accepted as a real sentinel; a missing findings file crashes with a stack
 * instead of a NAMED STOP; the codex→claude fallback direction does not exist; a round where every
 * pass is waiting on a spent allowance burns the remaining rounds instead of stopping with the mark
 * kept; or --rearm does not write the mark the standing resume job watches.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEMPLATE_SENTINEL =
  "AHREFS-AUDIT-COMPLETE: projects=<n> fixed=<n> surfaced=<n> off_limits=<n> no_repo=<n> ahrefs_side=<n> ahrefs_credits=<n> client_repo=<n> in_flight=<n>";
const USAGE_LIMIT_LINE =
  "ERROR: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 12:04 PM.";

function fakeAhrefsBin(home: string) {
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const w = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  // codex exec echoes every argument (the prompt included) before it ever produces a result, exactly
  // as the real CLI does; FAKE_CODEX_MODE picks whether this call hit the usage limit or finished.
  w(
    "codex",
    `if [ "$1" = login ]; then exit 0; fi
for a in "$@"; do printf '%s\\n' "$a"; done
if [ "\${FAKE_CODEX_MODE:-usage_limit}" = complete ]; then
  mkdir -p "$BOSS_OS_SITE_AUDIT_DIR"
  echo '{"findings":[]}' > "$BOSS_OS_SITE_AUDIT_DIR/findings.json"
  echo "AHREFS-AUDIT-COMPLETE: projects=0 fixed=0 surfaced=0 off_limits=0 no_repo=0 ahrefs_side=0 ahrefs_credits=0 client_repo=0 in_flight=0"
  exit 0
fi
echo "${USAGE_LIMIT_LINE}"
exit 1`
  );
  w(
    "claude",
    `echo RAN >> "$CLAUDE_RAN_LOG"
mkdir -p "$BOSS_OS_SITE_AUDIT_DIR"
echo '{"findings":[]}' > "$BOSS_OS_SITE_AUDIT_DIR/findings.json"
echo "AHREFS-AUDIT-COMPLETE: projects=1 fixed=1 surfaced=0 off_limits=0 no_repo=0 ahrefs_side=0 ahrefs_credits=0 client_repo=0 in_flight=0"
exit 0`
  );
  w("gh", `[ "$1" = auth ] && exit 0; exit 0`);
  w("curl", `printf 200`);
  return bin;
}

function runFixer(opts: { claudeSignedIn: boolean; mode: "usage_limit" | "complete"; extra?: Record<string, string> }) {
  const home = mkdtempSync(join(tmpdir(), "audit-usage-"));
  mkdirSync(join(home, "GitHub"), { recursive: true });
  const bin = fakeAhrefsBin(home);
  writeFileSync(join(bin, "security"), `#!/bin/bash\nexit ${opts.claudeSignedIn ? 0 : 1}\n`);
  chmodSync(join(bin, "security"), 0o755);
  writeFileSync(join(home, "prompt.md"), `Do the thing.\n\nEnd with: ${TEMPLATE_SENTINEL}\n`);
  const claudeRanLog = join(home, "claude-ran");
  const repoRoot = process.cwd();
  const r = spawnSync("/bin/bash", [join(repoRoot, "scripts/ops/ahrefs-audit-fix.sh")], {
    env: {
      ...(process.env as Record<string, string>),
      ...opts.extra,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      BOSS_OS_REPO: repoRoot,
      AHREFS_AUDIT_PROMPT: join(home, "prompt.md"),
      BOSS_AI_RUNNER: "codex",
      SR_SCOPE_REPO: "test-repo",
      FAKE_CODEX_MODE: opts.mode,
      CLAUDE_RAN_LOG: claudeRanLog,
    },
    encoding: "utf8",
    timeout: 60000,
  });
  return {
    rc: r.status,
    out: `${r.stdout}${r.stderr}`,
    home,
    retryAfter: join(home, ".boss-os/search-readiness/retry-after"),
    claudeRan: existsSync(claudeRanLog),
  };
}

describe("ahrefs-audit-fix.sh: the sentinel is a result, not the prompt's own template", () => {
  it("codex echoes the template sentinel and hits its usage limit, Claude signed out: AI_USAGE_EXHAUSTED, exit 13, no stack, never judged complete", () => {
    const { rc, out, retryAfter, claudeRan } = runFixer({ claudeSignedIn: false, mode: "usage_limit" });
    expect(rc, out).toBe(13);
    expect(out).toMatch(/NAMED STOP \[AI_USAGE_EXHAUSTED\]/);
    expect(out).not.toMatch(/^sentinel:/m);
    expect(out).not.toMatch(/ENOENT|at Object\.|at async|TypeError|node:internal/);
    expect(readFileSync(retryAfter, "utf8").trim()).toBe("12:04 PM");
    expect(claudeRan).toBe(false);
  }, 60000);

  it("codex hits its usage limit, Claude signed in: the SAME pass reruns once on Claude and finishes", () => {
    const { rc, out, claudeRan } = runFixer({ claudeSignedIn: true, mode: "usage_limit" });
    expect(out).toMatch(/Codex ran out of usage.*rerunning the same pass on Claude/);
    expect(claudeRan).toBe(true);
    expect(out).toMatch(/sentinel: AHREFS-AUDIT-COMPLETE: projects=1/);
    expect(out).not.toMatch(/NAMED STOP \[AI_USAGE_EXHAUSTED\]/);
    expect(out).not.toMatch(/NAMED STOP \[AUDIT_DID_NOT_COMPLETE\]/);
    expect(rc).not.toBe(13);
  }, 60000);

  it("a real sentinel with real numbers is accepted: never AUDIT_DID_NOT_COMPLETE or AI_USAGE_EXHAUSTED", () => {
    const { out } = runFixer({ claudeSignedIn: false, mode: "complete" });
    expect(out).toMatch(/sentinel: AHREFS-AUDIT-COMPLETE: projects=0/);
    expect(out).not.toMatch(/NAMED STOP \[AUDIT_DID_NOT_COMPLETE\]/);
    expect(out).not.toMatch(/NAMED STOP \[AI_USAGE_EXHAUSTED\]/);
  }, 60000);

  it("has_sentinel requires digits: the prompt's own <n> template never matches", () => {
    const script = readFileSync("scripts/ops/ahrefs-audit-fix.sh", "utf8");
    expect(script).toContain("has_sentinel() { grep -qE 'AHREFS-AUDIT-COMPLETE: projects=[0-9]' \"$1\"; }");
  });
});

describe("site-audit-lib.mjs: a missing findings file is a named stop, never a stack trace", () => {
  it("verdict on a missing file: NAMED STOP [NO_FINDINGS_FILE], exit 9", () => {
    const home = mkdtempSync(join(tmpdir(), "audit-lib-"));
    const missing = join(home, "nope/findings.json");
    const r = spawnSync("node", ["scripts/ops/site-audit-lib.mjs", "verdict", missing], { encoding: "utf8" });
    expect(r.status).toBe(9);
    expect(`${r.stdout}${r.stderr}`).toContain(`NAMED STOP [NO_FINDINGS_FILE] ${missing}`);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/ENOENT|at Object\.|node:internal/);
  });

  it("land on a missing file: NAMED STOP [NO_FINDINGS_FILE], exit 9", () => {
    const home = mkdtempSync(join(tmpdir(), "audit-lib-"));
    const missing = join(home, "nope/findings.json");
    const r = spawnSync("node", ["scripts/ops/site-audit-lib.mjs", "land", missing], { encoding: "utf8" });
    expect(r.status).toBe(9);
    expect(`${r.stdout}${r.stderr}`).toContain(`NAMED STOP [NO_FINDINGS_FILE] ${missing}`);
  });
});

type RunnerOpts = { plans: string[] };
const FOUR = "QUEUE total=4 workable=4 protected=0 no_repo=0\nCHUNK a 4 sr-1,sr-2";

function runnerTree(o: RunnerOpts) {
  const home = mkdtempSync(join(tmpdir(), "srnet-usage-run-"));
  const repo = join(home, "boss-os");
  const ops = join(repo, "scripts/ops");
  mkdirSync(join(ops, "lib"), { recursive: true });
  mkdirSync(join(repo, "src/shared/boss/searchReadiness"), { recursive: true });
  const copy = (src: string, dst: string) => writeFileSync(dst, readFileSync(src, "utf8"));
  copy("scripts/ops/search-readiness-fix.sh", join(ops, "search-readiness-fix.sh"));
  copy("scripts/ops/lib/net-wait.sh", join(ops, "lib/net-wait.sh"));
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "stub", scripts: { "sites:audit": "true", "vault:run": "env" } }));
  writeFileSync(join(home, "plans.json"), JSON.stringify(o.plans));
  writeFileSync(
    join(ops, "search-readiness-audit.mjs"),
    `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const plans = JSON.parse(readFileSync(${JSON.stringify(join(home, "plans.json"))}, "utf8"));
const f = ${JSON.stringify(join(home, "plan-n"))};
const n = existsSync(f) ? +readFileSync(f, "utf8") : 0; writeFileSync(f, String(n + 1));
console.log(plans[Math.min(n, plans.length - 1)]);
`
  );
  // Every pass this stub runs is "waiting on a spent AI allowance": rc=13, and it writes the
  // retry-after file exactly as the real ahrefs-audit-fix.sh does when every runner is exhausted.
  writeFileSync(
    join(ops, "ahrefs-audit-fix.sh"),
    `
echo "$SR_SCOPE_REPO" >> ${JSON.stringify(join(home, "passes"))}
mkdir -p ${JSON.stringify(join(home, ".boss-os/search-readiness"))}
echo "11:59 PM" > ${JSON.stringify(join(home, ".boss-os/search-readiness/retry-after"))}
exit 13
`
  );
  writeFileSync(join(ops, "sr-run-stopped.mjs"), `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(join(home, "reported"))}, process.argv[2] + "\\n");`);
  writeFileSync(join(ops, "duty-run.sh"), `echo "$*" >> ${JSON.stringify(join(home, "duty-runs"))}\nwhile [ "$1" != "--" ]; do shift; done; shift; "$@"\n`);
  writeFileSync(join(repo, "src/shared/boss/searchReadiness/audit.mjs"), "export const queueRunLine = () => 'ok';\n");
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const w = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  w("curl", "printf 200");
  w("gh", "exit 0");
  const env = { ...(process.env as Record<string, string>), HOME: home, BOSS_OS_REPO: repo, PATH: `${bin}:${process.env.PATH}`, SR_MAX_ROUNDS: "3" };
  const mark = join(home, ".boss-os/search-readiness/run-unfinished.json");
  const retryAfter = join(home, ".boss-os/search-readiness/retry-after");
  const run = (...args: string[]) => {
    const r = spawnSync("/bin/bash", [join(ops, "search-readiness-fix.sh"), ...args], { env, cwd: repo, encoding: "utf8", timeout: 60000 });
    return { rc: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { home, repo, ops, env, mark, retryAfter, run };
}

describe("search-readiness-fix.sh: a round fully waiting on a spent allowance stops now, mark kept", () => {
  it("every pass in the round returns 13 with retry-after written: AI_USAGE_EXHAUSTED, exit 13, never SR_QUEUE_STALLED, the mark stays", () => {
    const t = runnerTree({ plans: [FOUR] });
    const { rc, out } = t.run();
    expect(rc, out).toBe(13);
    expect(out).toMatch(/NAMED STOP \[AI_USAGE_EXHAUSTED\]/);
    expect(out).not.toMatch(/SR_QUEUE_STALLED/);
    expect(out).not.toMatch(/fixed nothing; stopping/);
    expect(existsSync(t.mark)).toBe(true);
  }, 60000);

  it("--rearm writes the unfinished mark and prints REARMED, so the standing resume job picks the run up", () => {
    const t = runnerTree({ plans: [FOUR] });
    const r = spawnSync("/bin/bash", [join(t.ops, "search-readiness-fix.sh"), "--rearm"], { env: t.env, cwd: t.repo, encoding: "utf8", timeout: 60000 });
    expect(`${r.stdout}${r.stderr}`).toMatch(/REARMED/);
    expect(existsSync(t.mark)).toBe(true);
  }, 60000);
});
