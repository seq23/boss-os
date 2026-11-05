/**
 * OFFLINE IS NOT LOGGED OUT, AND A STOPPED RUN RESUMES BY ITSELF (25 Oct 2026) — the guard.
 *
 * CONFIRMED: during the ~18:30–20:00 outage on 25 Oct 2026 every pass of the Search Readiness run hit
 * "NAMED STOP [GH_NOT_AUTHENTICATED] run: gh auth login" (gh was logged in; the network was down),
 * the run ended "fixed=0 left=316" with exit 0, and nothing restarted it. These run the REAL
 * scripts/ops/ahrefs-audit-fix.sh and scripts/ops/search-readiness-fix.sh against a faked network
 * (curl) and a faked gh, and fail if: an outage is ever named a login stop; a real logout stops being
 * named; the wait is unbounded; a dead run is not resumed, or a live one is doubled; a waiting run loses its mark or opens a repair instead of a note.
 */
import { describe, it, expect } from "vitest";
import { spawnSync, spawn } from "node:child_process";
import { FAKE_AI_RUN } from "./fakeAiRun";
import { rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, copyFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** A fake network and gh. `down` = how many probes fail first ("forever" for all). */
function fakeBin(home: string) {
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const net = join(home, "net-down");
  const w = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  w("curl", `n="$(cat ${JSON.stringify(net)} 2>/dev/null || echo 0)"
echo probe >> ${JSON.stringify(join(home, "probes"))}
if [ "$n" = forever ]; then printf 000; exit 7; fi
if [ "$n" -gt 0 ]; then echo $((n-1)) > ${JSON.stringify(net)}; printf 000; exit 7; fi
printf 200`);
  // gh fails offline exactly as it fails logged out — the confusion being guarded.
  w("gh", `n="$(cat ${JSON.stringify(net)} 2>/dev/null || echo 0)"
[ "$n" = forever ] && exit 1
[ "$n" -gt 0 ] && exit 1
[ "\${FAKE_GH_LOGGED_IN:-1}" = 1 ]`);
  w("claude", "exit 0");
  w("security", "exit 1"); // past the gh check, the fixer stops at CLAUDE_NOT_AUTHENTICATED (exit 10)
  // `codex` is stubbed as INSTALLED BUT SIGNED OUT, because the real one must never be reached:
  // these tests run on her Mac from inside a Boss OS pass, where codex is on PATH and the pass's own
  // BOSS_AI_RUNNER / SR_SCOPE_REPO are in the environment. Leaking those sent the fixer down the
  // auto -> Codex branch and the run ended CODEX_NOT_AUTHENTICATED (13) where the test wanted 10 —
  // green in CI only because no codex binary exists there. runFixer now pins the runner per case.
  w("codex", `if [ "$1 $2" = "login status" ]; then [ "\${FAKE_CODEX_LOGGED_IN:-0}" = 1 ]; exit $?; fi\nexit 0`);
  writeFileSync(join(bin, "ai-run"), FAKE_AI_RUN); chmodSync(join(bin, "ai-run"), 0o755);
  return { bin, net };
}

const FAST = { SR_NET_WAIT_STEP_S: "1", SR_NET_WAIT_CAP_S: "1", SR_NET_WAIT_MAX_S: "4" };

function runFixer(down: string, loggedIn: boolean, extra: Record<string, string> = {}, opts: { noAiRun?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "srnet-fix-"));
  const ops = join(home, "boss-os/scripts/ops");
  mkdirSync(join(ops, "lib"), { recursive: true });
  copyFileSync("scripts/ops/ahrefs-audit-fix.sh", join(ops, "ahrefs-audit-fix.sh"));
  copyFileSync("scripts/ops/lib/net-wait.sh", join(ops, "lib/net-wait.sh"));
  copyFileSync("scripts/ops/lib/ai-run.mjs", join(ops, "lib/ai-run.mjs"));
  mkdirSync(join(home, "boss-os/src/shared/boss"), { recursive: true });
  copyFileSync("src/shared/boss/aiRoles.mjs", join(home, "boss-os/src/shared/boss/aiRoles.mjs"));
  writeFileSync(join(home, "prompt.md"), "x");
  const { bin, net } = fakeBin(home);
  writeFileSync(net, down);
  if (opts.noAiRun) rmSync(join(bin, "ai-run"));
  const r = spawnSync("/bin/bash", [join(ops, "ahrefs-audit-fix.sh")], {
    env: { ...(process.env as Record<string, string>), ...FAST,
      // The runner choice is part of the case, never inherited: a pass that runs these tests has its
      // own BOSS_AI_RUNNER, SR_SCOPE_REPO and AHREFS_DIGEST in the environment.
      BOSS_AI_RUNNER: "claude", SR_SCOPE_REPO: "", AHREFS_DIGEST: "", ...extra,
      HOME: home, PATH: `${bin}:${process.env.PATH}`,
      BOSS_OS_REPO: join(home, "boss-os"), AHREFS_AUDIT_PROMPT: join(home, "prompt.md"), FAKE_GH_LOGGED_IN: loggedIn ? "1" : "0" },
    encoding: "utf8", timeout: 60000,
  });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("ahrefs-audit-fix.sh tells the network apart from the gh login", () => {
  it("network down for a while, gh logged in: it waits, says so, and carries on — never GH_NOT_AUTHENTICATED", () => {
    const { rc, out } = runFixer("3", true);
    expect(out).toMatch(/waiting for the network/);
    expect(out).toMatch(/the network is back/);
    expect(out).not.toMatch(/GH_NOT_AUTHENTICATED/);
    // Past gh: the engine roles are read, then the off-limits list, absent from this fake checkout (11).
    expect(out).toMatch(/NAMED STOP \[NO_POLICY\]/);
    expect(rc, out).toBe(11);
  }, 60000);

  it("NEGATIVE: network up, gh really logged out: the login stop is still named (exit 7), with no wait", () => {
    const { rc, out } = runFixer("0", false);
    expect(out).toMatch(/NAMED STOP \[GH_NOT_AUTHENTICATED\] run: gh auth login/);
    expect(out).not.toMatch(/waiting for the network/);
    expect(rc).toBe(7);
  }, 60000);

  it("network down past the whole wait: a bounded NETWORK_UNREACHABLE (exit 13), never a login stop", () => {
    const t0 = Date.now();
    const { rc, out } = runFixer("forever", true);
    expect(out).toMatch(/NAMED STOP \[NETWORK_UNREACHABLE\]/);
    expect(out).not.toMatch(/GH_NOT_AUTHENTICATED/);
    expect(rc).toBe(13);
    expect(Date.now() - t0).toBeLessThan(30000);
  }, 60000);

  it("owner, 3 Nov 2026: no ai-run installed is a named stop the next run retries (13), before any model or gh call", () => {
    const { rc, out } = runFixer("0", true, {}, { noAiRun: true });
    expect(out).toMatch(/NAMED STOP \[AI_RUN_MISSING\]/);
    expect(out).not.toMatch(/waiting for the network|GH_NOT_AUTHENTICATED|NO_POLICY/);
    expect(rc, out).toBe(13);
  }, 60000);

  it("the default wait is about two hours, backing off, and the body is one parsed function", () => {
    const lib = readFileSync("scripts/ops/lib/net-wait.sh", "utf8");
    expect(lib).toContain('max="${SR_NET_WAIT_MAX_S:-7200}"');
    expect(lib).toMatch(/step=\$\(\( step \* 2 \)\)/);
    const fixer = readFileSync("scripts/ops/ahrefs-audit-fix.sh", "utf8");
    expect(fixer.trimEnd().endsWith('main "$@"; exit $?')).toBe(true);
    expect(fixer).not.toMatch(/gh auth status >\/dev\/null 2>&1 \|\| \{ say "NAMED STOP \[GH_NOT_AUTHENTICATED\]/);
  });
});

type RunnerOpts = { plans: string[]; fixRcs?: number[]; fixSleep?: number; down?: string; findings?: any[] };

/** A stub boss-os around the REAL runner and net-wait.sh. Plans are returned in turn, the last repeating. */
function runnerTree(o: RunnerOpts) {
  const home = mkdtempSync(join(tmpdir(), "srnet-run-"));
  const repo = join(home, "boss-os");
  const ops = join(repo, "scripts/ops");
  mkdirSync(join(ops, "lib"), { recursive: true });
  mkdirSync(join(repo, "src/shared/boss/searchReadiness"), { recursive: true });
  copyFileSync("scripts/ops/search-readiness-fix.sh", join(ops, "search-readiness-fix.sh"));
  copyFileSync("scripts/ops/lib/net-wait.sh", join(ops, "lib/net-wait.sh"));
  for (const f of ["orphanPr.mjs", "ownerApproval.mjs"]) copyFileSync(`src/shared/boss/searchReadiness/${f}`, join(repo, "src/shared/boss/searchReadiness", f));
  mkdirSync(join(repo, "src/shared/boss/siteAudit"), { recursive: true });
  copyFileSync("src/shared/boss/siteAudit/repoPolicy.mjs", join(repo, "src/shared/boss/siteAudit/repoPolicy.mjs"));
  if (o.findings) {
    const dir = join(home, ".boss-os/site-audit/sr-a"); mkdirSync(dir, { recursive: true });
    writeFileSync(join(home, "fixture-findings.json"), JSON.stringify({ findings: o.findings }));
  }
  // vault:run = env, so `npm run vault:run -- node x.mjs` runs node x.mjs with no secret.
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "stub", scripts: { "sites:audit": "true", "vault:run": "env" } }));
  writeFileSync(join(home, "plans.json"), JSON.stringify(o.plans));
  writeFileSync(join(ops, "search-readiness-audit.mjs"), `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const plans = JSON.parse(readFileSync(${JSON.stringify(join(home, "plans.json"))}, "utf8"));
const f = ${JSON.stringify(join(home, "plan-n"))};
const n = existsSync(f) ? +readFileSync(f, "utf8") : 0; writeFileSync(f, String(n + 1));
console.log(plans[Math.min(n, plans.length - 1)]);
`);
  writeFileSync(join(home, "fix-rcs"), (o.fixRcs ?? [0]).join(" "));
  writeFileSync(join(ops, "ahrefs-audit-fix.sh"), `
echo "$SR_SCOPE_REPO" >> ${JSON.stringify(join(home, "passes"))}
${o.findings ? `cp ${JSON.stringify(join(home, "fixture-findings.json"))} ${JSON.stringify(join(home, ".boss-os/site-audit/sr-a/findings.json"))}` : ""}
sleep ${o.fixSleep ?? 0}
set -- $(cat ${JSON.stringify(join(home, "fix-rcs"))}); rc=$1; [ $# -gt 1 ] && shift; echo "$*" > ${JSON.stringify(join(home, "fix-rcs"))}
exit $rc
`);
  writeFileSync(join(ops, "sr-run-stopped.mjs"), `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(join(home, "reported"))}, process.argv[2] + "\\n");`);
  writeFileSync(join(ops, "duty-run.sh"), `echo "$*" >> ${JSON.stringify(join(home, "duty-runs"))}\nwhile [ "$1" != "--" ]; do shift; done; shift; "$@"\n`);
  writeFileSync(join(repo, "src/shared/boss/searchReadiness/audit.mjs"), "export const queueRunLine = () => 'ok';\n");
  const { bin, net } = fakeBin(home);
  writeFileSync(net, o.down ?? "0");
  const env = { ...(process.env as Record<string, string>), ...FAST, HOME: home, BOSS_OS_REPO: repo, PATH: `${bin}:${process.env.PATH}`, SR_MAX_ROUNDS: "3" };
  const state = join(home, ".boss-os/search-readiness");
  const read = (f: string) => (existsSync(join(home, f)) ? readFileSync(join(home, f), "utf8") : "");
  const run = (...args: string[]) => {
    const r = spawnSync("/bin/bash", [join(ops, "search-readiness-fix.sh"), ...args], { env, cwd: repo, encoding: "utf8", timeout: 60000 });
    return { rc: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { home, repo, ops, env, net, state, mark: join(state, "run-unfinished.json"), lock: join(state, "run.lock"), read, run };
}

const EMPTY = "QUEUE total=0 workable=0 protected=0 no_repo=0";
const FOUR = "QUEUE total=4 workable=4 protected=0 no_repo=0\nCHUNK a 4 sr-1,sr-2";

describe("search-readiness-fix.sh waits out the network and resumes by itself", () => {
  it("network down at the start: it waits, then runs; a finished run leaves no unfinished mark", () => {
    const t = runnerTree({ plans: [EMPTY], down: "2" });
    const { rc, out } = t.run();
    expect(out).toMatch(/waiting for the network/);
    expect(rc, out).toBe(0);
    expect(existsSync(t.mark)).toBe(false);
    expect(existsSync(t.lock)).toBe(false);
  }, 60000);

  it("a pass that lost the network (13) is re-run, not counted as \"fixed nothing\"", () => {
    const t = runnerTree({ plans: [FOUR, FOUR, EMPTY], fixRcs: [13, 0] });
    const { rc, out } = t.run();
    expect(out).toMatch(/lost the network/);
    expect(out).not.toMatch(/fixed nothing; stopping/);
    expect(out).not.toMatch(/SR_QUEUE_STALLED/);
    expect(t.read("passes").trim().split("\n")).toEqual(["a", "a"]);
    expect(rc, out).toBe(0);
  }, 60000);

  it("network gone past the wait: exit 0, the mark stays, the waiting note is posted once; the tick then resumes it", () => {
    const t = runnerTree({ plans: [EMPTY], down: "forever" });
    const first = t.run();
    expect(first.rc, first.out).toBe(0);
    expect(first.out).toMatch(/NOTE: NETWORK_UNREACHABLE/);
    expect(first.out).toMatch(/NAMED STOP \[NETWORK_UNREACHABLE\]/);
    expect(first.out).not.toMatch(/GH_NOT_AUTHENTICATED/);
    expect(readFileSync(t.mark, "utf8")).toMatch(/"reason": "NETWORK_UNREACHABLE"/);
    expect(t.read("reported").trim()).toBe("NETWORK_UNREACHABLE");
    // Still down at the next tick: resumed, waits again, NOT reported a second time.
    const again = t.run("--resume-if-unfinished");
    expect(again.rc).toBe(0);
    expect(t.read("reported").trim().split("\n")).toEqual(["NETWORK_UNREACHABLE"]);
    // The network comes back: the tick resumes it through duty-run.sh and it finishes.
    writeFileSync(t.net, "0");
    const back = t.run("--resume-if-unfinished");
    expect(back.out).toMatch(/resuming/);
    expect(back.rc, back.out).toBe(0);
    expect(t.read("duty-runs")).toMatch(/search-readiness-fix\.sh -- bash scripts\/ops\/search-readiness-fix\.sh --resume/);
    expect(existsSync(t.mark)).toBe(false);
    expect(t.read("reported")).toContain("--cleared\n--cleared");
  }, 90000);

  it("a runner killed mid-run is resumed by the tick, and its stale lock is cleared", async () => {
    const t = runnerTree({ plans: [FOUR, EMPTY], fixSleep: 30 });
    const child = spawn("/bin/bash", [join(t.ops, "search-readiness-fix.sh")], { env: t.env, cwd: t.repo, detached: true, stdio: "ignore" });
    for (let i = 0; i < 100 && !t.read("passes"); i++) await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(t.mark)).toBe(true);
    process.kill(-child.pid!, "SIGKILL");
    await new Promise((r) => setTimeout(r, 300));
    expect(existsSync(join(t.lock, "pid")), "the lock of a killed run is stale").toBe(true);
    writeFileSync(join(t.home, "plans.json"), JSON.stringify([EMPTY]));
    const r = t.run("--resume-if-unfinished");
    expect(r.out).toMatch(/stale run lock/);
    expect(r.out).toMatch(/resuming/);
    expect(r.rc, r.out).toBe(0);
    expect(existsSync(t.mark)).toBe(false);
  }, 90000);

  it("NEGATIVE: beside a live run the tick starts nothing; with no unfinished run it starts nothing", () => {
    const t = runnerTree({ plans: [EMPTY] });
    mkdirSync(t.lock, { recursive: true });
    writeFileSync(join(t.lock, "pid"), String(process.pid));
    writeFileSync(t.mark, JSON.stringify({ pid: process.pid, reason: "running", reported: "" }));
    const live = t.run("--resume-if-unfinished");
    expect(live.out).toMatch(/alive.*not starting a second one/);
    expect(t.read("duty-runs")).toBe("");
    const u = runnerTree({ plans: [EMPTY] });
    const none = u.run("--resume-if-unfinished");
    expect(none.out).toMatch(/no unfinished Search Readiness run/);
    expect(u.read("duty-runs")).toBe("");
    expect(u.read("plan-n")).toBe("");
  }, 60000);

  /*
   * A STALLED QUEUE IS THE DUTY'S OWN END STATE (31 Oct 2026). Exit 14 here recorded every stalled run
   * as failed, so the weekly duty never moved last_run_at, re-ran every morning on the same briefs and
   * read "never fired" on Today. It is still never QUIET: the named stop is printed and on the desk.
   */
  it("a stalled queue ends the run, never quietly: named, on Danielle's repair desk, exit 0 so the duty is done until Tuesday", () => {
    const t = runnerTree({ plans: [FOUR] });
    const { rc, out } = t.run();
    expect(out).toMatch(/fixed nothing; stopping/);
    expect(out).toMatch(/NAMED STOP \[SR_QUEUE_STALLED\] 4 workable briefs left/);
    expect(rc).toBe(0);
    expect(t.read("reported").trim()).toBe("SR_QUEUE_STALLED");
    expect(existsSync(t.mark)).toBe(false);
  }, 60000);

  it("names the open PR blockers from the real runner, without calling them fixed nothing", () => {
    const t = runnerTree({ plans: [FOUR], findings: [{ disposition: "in_flight", pr_url: "https://github.com/seq23/a/pull/7", land: "blocked", land_detail: "draft_left_behind" }] });
    const r = t.run();
    expect(r.rc, r.out).toBe(0);
    expect(r.out).toContain("NAMED STOP [SR_BLOCKED_BY_OPEN_PRS]");
    expect(r.out).toContain("https://github.com/seq23/a/pull/7: draft_left_behind");
    expect(r.out).not.toContain("fixed nothing");
    expect(t.read("reported").trim()).toBe("SR_BLOCKED_BY_OPEN_PRS");
  }, 60000);

  it("spent AI usage preserves the mark and resumes after its reset", () => {
    const t = runnerTree({ plans: [FOUR], fixRcs: [13] });
    mkdirSync(t.state, { recursive: true });
    writeFileSync(join(t.state, "retry-after"), String(Math.floor(Date.now() / 1000) + 3600));
    const r = t.run();
    expect(r.rc, r.out).toBe(0);
    expect(r.out).toContain("AI_USAGE_EXHAUSTED");
    expect(r.out).not.toContain("SR_QUEUE_STALLED");
    expect(existsSync(t.mark)).toBe(true);
    writeFileSync(join(t.home, "plans.json"), JSON.stringify([EMPTY]));
    writeFileSync(join(t.state, "retry-after"), String(Math.floor(Date.now() / 1000) - 60));
    expect(t.run("--resume-if-unfinished").out).toContain("resuming");
    expect(existsSync(t.mark)).toBe(false);
  }, 60000);

  it("rounds spent while every round still fixed something is unfinished: named, non-zero (14), on the desk", () => {
    const THREE = "QUEUE total=3 workable=3 protected=0 no_repo=0\nCHUNK a 3 sr-1";
    const TWO = "QUEUE total=2 workable=2 protected=0 no_repo=0\nCHUNK a 2 sr-1";
    const ONE = "QUEUE total=1 workable=1 protected=0 no_repo=0\nCHUNK a 1 sr-1";
    const t = runnerTree({ plans: [FOUR, THREE, TWO, ONE] });
    const { rc, out } = t.run();
    expect(out).not.toMatch(/fixed nothing/);
    expect(out).toMatch(/NAMED STOP \[SR_ROUNDS_SPENT\] 1 workable briefs left/);
    expect(rc).toBe(14);
    expect(t.read("reported").trim()).toBe("SR_ROUNDS_SPENT");
  }, 60000);

  it("the installer keeps a KeepAlive on the unfinished mark, throttled to 15 minutes, naming no duty", () => {
    const installer = readFileSync("scripts/ops/install-agent-launchd.sh", "utf8");
    const block = installer.slice(installer.indexOf('SRR_LABEL="com.seq.boss-sr-resume"'), installer.indexOf("SRREOF\n\n"));
    expect(block).toContain("search-readiness-fix.sh --resume-if-unfinished");
    expect(block).toContain("<key>PathState</key><dict><key>$HOME/.boss-os/search-readiness/run-unfinished.json</key><true/>");
    expect(block).toMatch(/<key>ThrottleInterval<\/key><integer>900<\/integer>/);
    expect(block).not.toMatch(/duty-run\.sh/);
  });
});

describe("the stop reaches Danielle as a failed_task repair", () => {
  it("repairTask is a repair on emp_repo, named so the done mail says which job stopped", async () => {
    const { repairTask, SR_RUN_TITLE } = await import("../scripts/ops/sr-run-stopped.mjs");
    const t = repairTask("SR_ROUNDS_SPENT", "api.github.com did not answer.");
    expect(t.employee_id).toBe("emp_repo");
    expect(t.input).toMatchObject({ origin: "repair", repair_kind: "failed_task" });
    expect(t.title).toBe(SR_RUN_TITLE);
    expect(/^Find why "([^"\n]{3,80})" failed/.exec(t.title)?.[1]).toBe("Search Readiness fix run");
    expect(t.input.prompt).toMatch(/^seq23\/boss-os — /);
  });
});


describe("self-resuming waits are notes, never repairs", () => {
  it("posts both waiting codes to intake, clears them, and preserves hard-stop repairs", async () => {
    const { reportStop, repairTask, WAITING_STOPS } = await import("../scripts/ops/sr-run-stopped.mjs");
    const posts: { path: string; body: any }[] = [];
    const api = { post: async (path: string, body: any) => { posts.push({ path, body }); } };
    for (const code of WAITING_STOPS) {
      expect(() => repairTask(code, "waiting")).toThrow(/note/);
      expect(await reportStop(api, code, "waiting")).toBe("NOTE");
      expect(posts.at(-1)).toMatchObject({ path: "/open-loops/intake", body: { repo: "seq23/boss-os", stop: code, owner: "codex", finish_line: "the Search Readiness fix queue reaches zero" } });
      await reportStop(api, code, "", true);
      expect(posts.at(-1)?.body.cleared).toBe(true);
    }
    await reportStop(api, "SR_ROUNDS_SPENT", "rounds spent");
    expect(posts.filter(p => p.path === "/tasks")).toHaveLength(1);
  });

  it("an old repair receipt does not suppress the waiting note after upgrading", () => {
    const t = runnerTree({ plans: [EMPTY], down: "forever" });
    mkdirSync(t.state, { recursive: true });
    writeFileSync(t.mark, JSON.stringify({ pid: 99999999, reason: "NETWORK_UNREACHABLE", reported: "NETWORK_UNREACHABLE" }));
    const r = t.run("--resume");
    expect(r.rc, r.out).toBe(0);
    expect(r.out).toMatch(/NOTE: NETWORK_UNREACHABLE/);
    expect(t.read("reported").trim()).toBe("NETWORK_UNREACHABLE");
    expect(readFileSync(t.mark, "utf8")).toContain('"reported": "NOTE:NETWORK_UNREACHABLE"');
  }, 60000);

  it("the real resume gate waits for epochs, legacy overnight clocks and malformed values, then resumes after the fallback expires", () => {
    for (const value of [`${Math.floor(Date.now() / 1000) + 3600} 11:59 PM`, "unknown (Codex gave no reset time)", "6:50 PM — the work waits for the reset", "12:01 AM"]) {
      const t = runnerTree({ plans: [EMPTY] });
      mkdirSync(t.state, { recursive: true });
      writeFileSync(t.mark, JSON.stringify({ pid: 99999999, reason: "AI_USAGE_EXHAUSTED" }));
      const retry = join(t.state, "retry-after");
      writeFileSync(retry, value);
      if (value === "12:01 AM") {
        const afternoon = new Date(); afternoon.setHours(15, 0, 0, 0);
        utimesSync(retry, afternoon, afternoon);
      }
      const r = t.run("--resume-if-unfinished");
      expect(r.rc, r.out).toBe(0);
      expect(r.out).toMatch(/waiting until/);
      expect(t.read("duty-runs")).toBe("");
      expect(existsSync(t.mark)).toBe(true);
      if (value.startsWith("unknown")) {
        const old = new Date(Date.now() - 1900 * 1000); utimesSync(retry, old, old);
        const resumed = t.run("--resume-if-unfinished");
        expect(resumed.out).toMatch(/resuming/);
        expect(existsSync(t.mark)).toBe(false);
      }
    }
  }, 60000);
});
