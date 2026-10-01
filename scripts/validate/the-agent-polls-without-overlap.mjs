#!/usr/bin/env node
/**
 * THE MAC ASKS FOR WORK EVERY FIVE MINUTES IN THE WAKING DAY, AND NEVER RUNS TWO AGENTS AT ONCE (1 Oct 2026).
 *
 * "why is there a 18:35 check? if i press the button to run on demand?" The Run-now button queues a task in the cloud and the
 * Mac has to ask for it; it asked six times a day. The installer now also writes `com.seq.boss-agent-poll`, which runs
 * `scripts/ops/agent-claim.sh --poll` every 300 seconds. Two things must stay true or the cure is worse than the
 * wait, and this proves both over the REAL wrapper under real bash with a stub `npm` (no CLI starts, nothing is claimed):
 *
 *   1. IT NEVER OVERLAPS. The fixed-time job and the poll both go through the wrapper, which takes a lock holding its PID. A
 *      live holder makes the next tick exit silently (a briefing runs up to fifteen minutes; a second Claude Code or Codex
 *      session on the same Mac while the first works is the failure); a dead holder is a crash and is taken over.
 *   2. IT STAYS IN THE WAKING DAY. Outside 06:00-22:00 the poll does nothing; the fixed job is not restricted.
 *   3. IT PEEKS BEFORE IT DOES ANYTHING COSTLY, AND THE BRIEFING'S DATA IS FRESH BEFORE THE CLAIM (review of #61). An idle poll is one
 *      read and fetches nothing from any feed; when a run is waiting it refreshes SKY.json and MARKETS.json (unless written in the
 *      last ten minutes) and only then claims, as the fixed-time chain does.
 *
 * It also pins the installer text: the poll's plist exists with StartInterval 300 and the waking-hours flag, the fixed job
 * reaches the claim through the wrapper (never raw `agent.mjs work-once`, which would bypass the lock), and the slot list the
 * screen names (the fixed job's StartCalendarInterval) is untouched.
 *
 *   node scripts/validate/the-agent-polls-without-overlap.mjs
 *   node scripts/validate/the-agent-polls-without-overlap.mjs --self-test
 */
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, chmodSync, utimesSync } from "node:fs";
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
    if (!/agent-claim\.sh --poll<\/string>/.test(poll)) out.push("The poll does not run agent-claim.sh --poll.");
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
  const log = join(root, "calls.log");
  // `npm` stands in for `npm run --silent vault:run -- node scripts/...` (peek, work-once, sky-snapshot), `node` for the market snapshot.
  // Every call is logged in order. `peek` answers STUB_PEEK_RC (0 = something is waiting); `work-once` can hold for STUB_HOLD seconds,
  // standing in for a run in progress, and can overwrite the lock's record (STUB_REWRITE_HOLDER) to prove the release is ownership-safe.
  writeFileSync(
    join(bin, "npm"),
    `#!/bin/bash
echo "npm $*" >> "${log}"
case "$*" in
  *"agent.mjs peek"*) exit "\${STUB_PEEK_RC:-0}" ;;
  *"agent.mjs work-once"*)
    if [ -n "\${STUB_REWRITE_HOLDER:-}" ]; then echo "2147483646|never" > "\${BOSS_OS_HOME}/agent-claim.lock/holder"; fi
    sleep "\${STUB_HOLD:-0}" ;;
esac
exit 0
`,
  );
  writeFileSync(join(bin, "node"), `#!/bin/bash
echo "node $*" >> "${log}"
exit 0
`);
  chmodSync(join(bin, "npm"), 0o755);
  chmodSync(join(bin, "node"), 0o755);
  return { bin, log, home: join(root, "home"), workspace: join(root, "reports") };
}
const calls = (log) => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
const claimsIn = (log) => calls(log).filter((l) => /agent\.mjs work-once/.test(l)).length;

function envFor(root, extra = {}) {
  const { bin, home, workspace } = stubEnv(root);
  return { PATH: `${bin}:${process.env.PATH}`, HOME: root, BOSS_OS_HOME: home, BOSS_OS_REPORT_WORKSPACE: workspace, ...extra };
}

function runWrapper(wrapperPath, root, args, extraEnv = {}) {
  return spawnSync("bash", [wrapperPath, ...args], { env: envFor(root, extraEnv), encoding: "utf8" });
}

/** Problems in the wrapper's behaviour, over the file at `wrapperPath`. */
export async function wrapperProblems(wrapperPath) {
  const out = [];
  const fresh = () => mkdtempSync(join(tmpdir(), "boss-claim-"));
  const lockOf = (root) => join(root, "home", "agent-claim.lock");
  const logOf = (root) => join(root, "calls.log");
  const touchAgo = (path, minutesAgo) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{}");
    const t = new Date(Date.now() - minutesAgo * 60_000);
    utimesSync(path, t, t);
  };

  // 1. The poll only runs in the waking day: 06:00 in, 22:00 out; "08" is not read as octal. Peek answers "waiting" here.
  for (const [hour, expected] of [["03", 0], ["05", 0], ["06", 1], ["08", 1], ["14", 1], ["21", 1], ["22", 0], ["23", 0]]) {
    const root = fresh();
    runWrapper(wrapperPath, root, ["--poll"], { BOSS_OS_CLAIM_HOUR: hour });
    const n = claimsIn(logOf(root));
    if (n !== expected) out.push(`--poll at hour ${hour}: expected ${expected} claim(s), saw ${n}.`);
    if (existsSync(lockOf(root)) || existsSync(`${lockOf(root)}.gate`)) out.push(`--poll at hour ${hour}: a lock or gate was left behind.`);
    rmSync(root, { recursive: true, force: true });
  }

  // 2. The fixed-time call claims at ANY hour, and does NOT peek or refresh (its own chain already did).
  {
    const root = fresh();
    runWrapper(wrapperPath, root, [], { BOSS_OS_CLAIM_HOUR: "03" });
    const c = calls(logOf(root));
    if (claimsIn(logOf(root)) !== 1) out.push(`The fixed-time call at 03:00 should claim once, saw ${claimsIn(logOf(root))}.`);
    if (c.some((l) => /peek|sky-snapshot|market-snapshot/.test(l))) out.push("The fixed-time call peeked or refreshed the data; its own chain does that.");
    if (existsSync(lockOf(root))) out.push("The lock was not released after a normal run.");
    rmSync(root, { recursive: true, force: true });
  }

  // 3. IDLE POLL: peek says nothing is waiting (4), an old Worker (5), or an error (1): no refresh, no claim, no feed fetch.
  for (const rc of ["4", "5", "1"]) {
    const root = fresh();
    runWrapper(wrapperPath, root, ["--poll"], { BOSS_OS_CLAIM_HOUR: "14", STUB_PEEK_RC: rc });
    const c = calls(logOf(root));
    if (claimsIn(logOf(root)) !== 0) out.push(`A poll whose peek exited ${rc} still claimed.`);
    if (c.some((l) => /sky-snapshot|market-snapshot/.test(l))) out.push(`A poll whose peek exited ${rc} still fetched from a feed.`);
    if (!c.some((l) => /agent\.mjs peek/.test(l))) out.push("The poll did not peek.");
    rmSync(root, { recursive: true, force: true });
  }

  // 4. WORK WAITING: refresh sky and market BEFORE the claim (review of #61), in that order.
  {
    const root = fresh();
    runWrapper(wrapperPath, root, ["--poll"], { BOSS_OS_CLAIM_HOUR: "06", STUB_PEEK_RC: "0" });
    const c = calls(logOf(root));
    const at = (re) => c.findIndex((l) => re.test(l));
    const peek = at(/agent\.mjs peek/), sky = at(/sky-snapshot/), market = at(/market-snapshot/), claim = at(/agent\.mjs work-once/);
    if (peek < 0 || sky < 0 || market < 0 || claim < 0) out.push(`A poll with work waiting must peek, refresh sky and market, then claim; calls were: ${c.join(" | ")}`);
    else if (!(peek < sky && sky < claim && market < claim)) out.push(`The poll claimed before refreshing the briefing's data: ${c.join(" | ")}`);
    rmSync(root, { recursive: true, force: true });
  }

  // 5. Files written in the last ten minutes are not refetched (bounds feed traffic), but the claim still happens; stale ones are.
  {
    const root = fresh();
    const ws = join(root, "reports");
    touchAgo(join(ws, "SKY.json"), 2);
    touchAgo(join(ws, "MARKETS.json"), 2);
    runWrapper(wrapperPath, root, ["--poll"], { BOSS_OS_CLAIM_HOUR: "14", STUB_PEEK_RC: "0" });
    const c = calls(logOf(root));
    if (c.some((l) => /sky-snapshot|market-snapshot/.test(l))) out.push("Data written two minutes ago was refetched.");
    if (claimsIn(logOf(root)) !== 1) out.push("A poll with fresh data and work waiting did not claim.");
    rmSync(root, { recursive: true, force: true });
    const root2 = fresh();
    touchAgo(join(root2, "reports", "SKY.json"), 30);
    touchAgo(join(root2, "reports", "MARKETS.json"), 30);
    runWrapper(wrapperPath, root2, ["--poll"], { BOSS_OS_CLAIM_HOUR: "14", STUB_PEEK_RC: "0" });
    const c2 = calls(logOf(root2));
    if (!c2.some((l) => /sky-snapshot/.test(l)) || !c2.some((l) => /market-snapshot/.test(l))) out.push("Data written thirty minutes ago was not refreshed before the claim.");
    rmSync(root2, { recursive: true, force: true });
  }

  // 6. A live holder makes the next tick exit WITHOUT claiming: two agents never run at once.
  {
    const root = fresh();
    const first = spawn("bash", [wrapperPath], { env: envFor(root, { STUB_HOLD: "3" }), stdio: "ignore" });
    for (let i = 0; i < 60 && !existsSync(join(lockOf(root), "holder")); i++) await new Promise((r) => setTimeout(r, 50));
    const second = runWrapper(wrapperPath, root, ["--poll"], { BOSS_OS_CLAIM_HOUR: "14" });
    if (claimsIn(logOf(root)) !== 1) out.push(`While one claim was running, a second tick started another: ${claimsIn(logOf(root))} claims recorded (expected 1).`);
    if (second.status !== 0) out.push(`A tick that finds a live holder should exit 0 silently, exited ${second.status}.`);
    await new Promise((r) => first.on("close", r));
    if (existsSync(lockOf(root))) out.push("The lock was not released when the holder finished.");
    rmSync(root, { recursive: true, force: true });
  }

  // 7. A lock whose holder is dead, or EMPTY (a crash between mkdir and writing itself down), is taken over; the lock is cleaned up.
  for (const [label, setup] of [
    ["a dead holder", (dir) => writeFileSync(join(dir, "holder"), "2147483646|Thu Jan  1 00:00:00 1970\n")],
    ["a holder record that is empty", (dir) => writeFileSync(join(dir, "holder"), "")],
    ["a lock with no record at all", () => {}],
  ]) {
    const root = fresh();
    mkdirSync(lockOf(root), { recursive: true });
    setup(lockOf(root));
    runWrapper(wrapperPath, root, ["--poll"], { BOSS_OS_CLAIM_HOUR: "14" });
    if (claimsIn(logOf(root)) !== 1) out.push(`A lock left by ${label} blocked the claim instead of being taken over.`);
    if (existsSync(lockOf(root))) out.push(`The lock taken over from ${label} was not released.`);
    rmSync(root, { recursive: true, force: true });
  }

  // 8. SIMULTANEOUS CONTENDERS (review of #61): eight ticks at the same instant, on a free lock and on a dead one, claim exactly ONCE.
  for (const [label, prepare] of [
    ["a free lock", () => {}],
    ["a lock left by a dead process", (root) => { mkdirSync(lockOf(root), { recursive: true }); writeFileSync(join(lockOf(root), "holder"), "2147483646|Thu Jan  1 00:00:00 1970\n"); }],
  ]) {
    const root = fresh();
    prepare(root);
    const procs = Array.from({ length: 8 }, () => spawn("bash", [wrapperPath, "--poll"], { env: envFor(root, { BOSS_OS_CLAIM_HOUR: "14", STUB_HOLD: "1" }), stdio: "ignore" }));
    await Promise.all(procs.map((p) => new Promise((r) => p.on("close", r))));
    const n = claimsIn(logOf(root));
    if (n !== 1) out.push(`Eight simultaneous ticks on ${label} produced ${n} claims (expected exactly 1): two agents ran at once.`);
    if (existsSync(lockOf(root)) || existsSync(`${lockOf(root)}.gate`)) out.push(`Eight simultaneous ticks on ${label} left a lock or gate behind.`);
    rmSync(root, { recursive: true, force: true });
  }

  // 9. The release is OWNERSHIP-SAFE: if the lock's record no longer names this process, it is not removed.
  {
    const root = fresh();
    runWrapper(wrapperPath, root, [], { STUB_REWRITE_HOLDER: "1" });
    if (!existsSync(lockOf(root))) out.push("The release removed a lock that no longer belonged to this process.");
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
  check("a poll without the poll flag is caught", installerProblems(real.replace("agent-claim.sh --poll</string>", "agent-claim.sh</string>")).length > 0);
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
  check("a wrapper with no lock is caught", (await plant("nolock", (t) => t.replace('if mkdir "$LOCK_DIR" 2>/dev/null; then\n  have_lock=1', 'if true; then\n  have_lock=1'))).length > 0);
  check("a wrapper that never takes over a dead holder's lock is caught", (await plant("nosteal", (t) => t.replace('rm -rf "$LOCK_DIR"             # the holder is gone (or never wrote itself down): a crash left the lock behind\n  mkdir "$LOCK_DIR" 2>/dev/null && have_lock=1', ":"))).length > 0);
  check("a wrapper that leaves its lock behind is caught", (await plant("noclean", (t) => t.replace('[ "${rec%%|*}" = "$$" ] && rm -rf "$LOCK_DIR"', ":"))).length > 0);
  check("a release that removes a lock that is not its own is caught", (await plant("steals", (t) => t.replace('[ "${rec%%|*}" = "$$" ] && rm -rf "$LOCK_DIR"', 'rm -rf "$LOCK_DIR"'))).length > 0);
  check("a poll that claims without peeking is caught", (await plant("nopeek", (t) => t.replace("agent.mjs peek >/dev/null 2>&1 || exit 0", "agent.mjs peek >/dev/null 2>&1 || true"))).length > 0);
  check("a poll that claims without refreshing the briefing's data is caught", (await plant("norefresh", (t) => t.replace(/  if \[ -z "\$\(find "\$WORKSPACE\/SKY\.json"[\s\S]*?\n  fi\n  if \[ -z "\$\(find "\$WORKSPACE\/MARKETS\.json"[\s\S]*?\n  fi\n/, ""))).length > 0);
  check("a poll that refetches fresh data every tick is caught", (await plant("alwaysfetch", (t) => t.replaceAll('-mmin -"$FRESH_MINUTES"', "-mmin -0"))).length > 0);
  check("a takeover with no gate (the race review of #61 found) is caught", (await plant("nogate", (t) => t.replace('if mkdir "$GATE_DIR" 2>/dev/null; then have_gate=1; break; fi', "have_gate=1; break").replace('rm -rf "$LOCK_DIR"             # the holder is gone', 'sleep 0.3; rm -rf "$LOCK_DIR"             # the holder is gone'))).length > 0);
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
