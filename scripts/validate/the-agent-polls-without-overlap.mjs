#!/usr/bin/env node
/**
 * THE MAC ASKS FOR WORK EVERY FIVE MINUTES IN THE WAKING DAY, AND NEVER RUNS TWO AGENTS AT ONCE (1 Oct 2026).
 *
 * "why is there a 18:35 check? if i press the button to run on demand?" The Run-now button queues a task in the cloud and the
 * Mac has to ask for it; it asked six times a day. The installer now also writes `com.seq.boss-agent-poll`, which runs
 * `scripts/ops/agent-claim.sh --waking-hours-only` every 300 seconds. Two things must stay true or the cure is worse than the
 * wait, and this proves both over the REAL wrapper under real bash with a stub `npm` (no CLI starts, nothing is claimed):
 *
 *   1. IT NEVER OVERLAPS. The fixed-time job and the poll both go through the wrapper, which takes a lock holding its PID. A
 *      live holder makes the next tick exit silently (a briefing runs up to fifteen minutes; a second Claude Code or Codex
 *      session on the same Mac while the first works is the failure); a dead holder is a crash and is taken over.
 *   2. IT STAYS IN THE WAKING DAY. Outside 06:00-22:00 the poll does nothing; the fixed job is not restricted.
 *
 * It also pins the installer text: the poll's plist exists with StartInterval 300 and the waking-hours flag, the fixed job
 * reaches the claim through the wrapper (never raw `agent.mjs work-once`, which would bypass the lock), and the slot list the
 * screen names (the fixed job's StartCalendarInterval) is untouched.
 *
 *   node scripts/validate/the-agent-polls-without-overlap.mjs
 *   node scripts/validate/the-agent-polls-without-overlap.mjs --self-test
 */
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, chmodSync, copyFileSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INSTALLER = "scripts/ops/install-agent-launchd.sh";
const WRAPPER = "scripts/ops/agent-claim.sh";

/** Problems in the installer's text. */
export function installerProblems(text) {
  const out = [];
  if (!text.includes('POLL_LABEL="com.seq.boss-agent-poll"')) out.push("The installer does not define com.seq.boss-agent-poll.");
  const poll = text.match(/cat > "\$POLL_PLIST" <<POLLEOF([\s\S]*?)POLLEOF/)?.[1] ?? "";
  if (!poll) out.push("The installer writes no poll plist (no POLLEOF heredoc).");
  else {
    if (!/<key>StartInterval<\/key><integer>300<\/integer>/.test(poll)) out.push("The poll is not StartInterval 300 (five minutes).");
    if (/StartCalendarInterval/.test(poll)) out.push("The poll uses StartCalendarInterval; the screen's slot list is the FIXED job's and must stay its own.");
    if (!/agent-claim\.sh --waking-hours-only<\/string>/.test(poll)) out.push("The poll does not run agent-claim.sh --waking-hours-only.");
    if (!/<key>BOSS_OS_DEVICE_ID<\/key>/.test(poll)) out.push("The poll does not carry BOSS_OS_DEVICE_ID, so every claim would die on the missing device id.");
    if (/&&/.test(poll)) out.push("The poll carries a bare && (the installer escapes every & as &amp;).");
    if (/launchctl load "\$POLL_PLIST"/.test(text) === false || !/lint_plist "\$POLL_PLIST"/.test(text)) out.push("The poll plist is not linted and loaded like the others.");
  }
  const fixed = text.match(/cat > "\$PLIST" <<PLISTEOF([\s\S]*?)PLISTEOF/)?.[1] ?? "";
  if (!fixed) out.push("The installer has no fixed-time agent plist.");
  else {
    if (!/\$REPO\/scripts\/ops\/agent-claim\.sh<\/string>/.test(fixed)) out.push("The fixed-time job does not claim through agent-claim.sh, so it would bypass the lock the poll relies on.");
    if (/agent\.mjs work-once/.test(fixed)) out.push("The fixed-time job still runs `agent.mjs work-once` directly: two agents could run at once.");
  }
  return out;
}

function stubEnv(root) {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const log = join(root, "npm.log");
  // The stub is what `npm run --silent vault:run -- node scripts/sync-agent/agent.mjs work-once` resolves to: it records the call and
  // can hold for STUB_HOLD seconds, standing in for a run in progress.
  writeFileSync(join(bin, "npm"), `#!/bin/bash\necho "$@" >> "${log}"\nsleep "\${STUB_HOLD:-0}"\n`);
  chmodSync(join(bin, "npm"), 0o755);
  return { bin, log, home: join(root, "home") };
}
const calls = (log) => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);

function runWrapper(wrapperPath, root, args, extraEnv = {}) {
  const { bin, home } = stubEnv(root);
  return spawnSync("bash", [wrapperPath, ...args], {
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, BOSS_OS_HOME: home, ...extraEnv },
    encoding: "utf8",
  });
}

/** Problems in the wrapper's behaviour, over the file at `wrapperPath`. */
export async function wrapperProblems(wrapperPath) {
  const out = [];
  const fresh = () => mkdtempSync(join(tmpdir(), "boss-claim-"));
  const lockOf = (root) => join(root, "home", "agent-claim.lock");

  // 1. Outside the waking day the poll does nothing; inside it claims once; the edges are 06:00 (in) and 22:00 (out).
  for (const [hour, expected] of [["03", 0], ["05", 0], ["06", 1], ["08", 1], ["14", 1], ["21", 1], ["22", 0], ["23", 0]]) {
    const root = fresh();
    runWrapper(wrapperPath, root, ["--waking-hours-only"], { BOSS_OS_CLAIM_HOUR: hour });
    const n = calls(join(root, "npm.log")).length;
    if (n !== expected) out.push(`--waking-hours-only at hour ${hour}: expected ${expected} claim(s), saw ${n}.`);
    if (existsSync(lockOf(root))) out.push(`--waking-hours-only at hour ${hour}: the lock was left behind.`);
    rmSync(root, { recursive: true, force: true });
  }

  // 2. Without the flag (the fixed-time job) it claims at ANY hour, and says work-once.
  {
    const root = fresh();
    runWrapper(wrapperPath, root, [], { BOSS_OS_CLAIM_HOUR: "03" });
    const c = calls(join(root, "npm.log"));
    if (c.length !== 1) out.push(`The fixed-time call at 03:00 should claim once, saw ${c.length}.`);
    else if (!/agent\.mjs work-once/.test(c[0]) || !/vault:run/.test(c[0])) out.push(`The claim does not run vault:run ... agent.mjs work-once: ${c[0]}`);
    if (existsSync(lockOf(root))) out.push("The lock was not released after a normal run.");
    rmSync(root, { recursive: true, force: true });
  }

  // 3. A live holder makes the next tick exit WITHOUT claiming: two agents never run at once.
  {
    const root = fresh();
    const { bin, home } = stubEnv(root);
    const first = spawn("bash", [wrapperPath], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, BOSS_OS_HOME: home, STUB_HOLD: "3" }, stdio: "ignore" });
    for (let i = 0; i < 40 && !existsSync(join(lockOf(root), "pid")); i++) await new Promise((r) => setTimeout(r, 50));
    const second = runWrapper(wrapperPath, root, ["--waking-hours-only"], { BOSS_OS_CLAIM_HOUR: "14" });
    const n = calls(join(root, "npm.log")).length;
    if (n !== 1) out.push(`While one claim was running, a second tick started another: ${n} claims recorded (expected 1).`);
    if (second.status !== 0) out.push(`A tick that finds a live holder should exit 0 silently, exited ${second.status}.`);
    await new Promise((r) => first.on("close", r));
    if (existsSync(lockOf(root))) out.push("The lock was not released when the holder finished.");
    rmSync(root, { recursive: true, force: true });
  }

  // 4. A lock whose holder is dead is a crash: it is taken over, the claim runs, and the lock is cleaned up.
  {
    const root = fresh();
    mkdirSync(lockOf(root), { recursive: true });
    writeFileSync(join(lockOf(root), "pid"), "2147483646\n"); // no such process
    runWrapper(wrapperPath, root, ["--waking-hours-only"], { BOSS_OS_CLAIM_HOUR: "14" });
    if (calls(join(root, "npm.log")).length !== 1) out.push("A lock left by a dead process blocked the claim instead of being taken over.");
    if (existsSync(lockOf(root))) out.push("The taken-over lock was not released.");
    rmSync(root, { recursive: true, force: true });
  }
  return out;
}

const selfTest = process.argv.includes("--self-test");

if (selfTest) {
  const real = readFileSync(join(ROOT, INSTALLER), "utf8");
  const results = [];
  const check = (name, ok) => results.push([name, ok]);

  check("the real installer is clean", installerProblems(real).length === 0);
  check("a poll that is not every five minutes is caught", installerProblems(real.replace("<integer>300</integer>", "<integer>30</integer>")).length > 0);
  check("a poll without the waking-hours flag is caught", installerProblems(real.replace("agent-claim.sh --waking-hours-only</string>", "agent-claim.sh</string>")).length > 0);
  check("a poll on the calendar list is caught", installerProblems(real.replace("<key>StartInterval</key><integer>300</integer>", "<key>StartCalendarInterval</key><array/>")).length > 0);
  check("a fixed job that bypasses the wrapper is caught", installerProblems(real.replace("; $REPO/scripts/ops/agent-claim.sh</string>", "; cd $REPO &amp;&amp; npm run --silent vault:run -- node scripts/sync-agent/agent.mjs work-once</string>")).length > 0);
  check("a poll with no device id is caught", installerProblems(real.replace(/(<key>Label<\/key><string>\$POLL_LABEL<\/string>[\s\S]*?)<key>BOSS_OS_DEVICE_ID<\/key>/, "$1<key>OTHER</key>")).length > 0);

  const wrapperText = readFileSync(join(ROOT, WRAPPER), "utf8");
  const dir = mkdtempSync(join(tmpdir(), "boss-claim-self-"));
  const plant = async (name, mutate) => {
    const p = join(dir, `${name}.sh`);
    // The wrapper finds its repo from its own path, so a planted copy lives under scripts/ops of a scratch tree.
    mkdirSync(join(dir, name, "scripts", "ops"), { recursive: true });
    const target = join(dir, name, "scripts", "ops", "agent-claim.sh");
    writeFileSync(target, mutate(wrapperText));
    chmodSync(target, 0o755);
    return wrapperProblems(target);
  };
  check("the real wrapper behaves", (await wrapperProblems(join(ROOT, WRAPPER))).length === 0);
  check("a wrapper with no hour guard is caught", (await plant("noguard", (t) => t.replace('if [ "$hour" -lt 6 ] || [ "$hour" -ge 22 ]; then', "if false; then"))).length > 0);
  check("a wrapper with no lock is caught", (await plant("nolock", (t) => t.replace('if ! mkdir "$LOCK_DIR" 2>/dev/null; then', "if false; then"))).length > 0);
  check("a wrapper that never takes over a dead holder's lock is caught", (await plant("nosteal", (t) => t.replace('rm -rf "$LOCK_DIR"            # the holder is gone: a crash left the lock behind\n  mkdir "$LOCK_DIR" 2>/dev/null || exit 0', "exit 0"))).length > 0);
  check("a wrapper that leaves its lock behind is caught", (await plant("noclean", (t) => t.replace("trap 'rm -rf \"$LOCK_DIR\"' EXIT", ":"))).length > 0);
  rmSync(dir, { recursive: true, force: true });

  const failed = results.filter(([, ok]) => !ok);
  for (const [name, ok] of results) console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (failed.length) process.exit(1);
  console.log(`SELF-TEST PASSED: ${results.length}/${results.length} cases.`);
} else {
  const problems = [
    ...installerProblems(readFileSync(join(ROOT, INSTALLER), "utf8")),
    ...(existsSync(join(ROOT, WRAPPER)) ? await wrapperProblems(join(ROOT, WRAPPER)) : [`${WRAPPER} does not exist.`]),
  ];
  if (problems.length) {
    console.error("THE AGENT POLL IS NOT SAFE:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("the-agent-polls-without-overlap: the poll is five minutes, waking day only, through one lock-taking wrapper the fixed-time job shares; a live holder blocks, a dead one is taken over, the lock is released. OK.");
}
