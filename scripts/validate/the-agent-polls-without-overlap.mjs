#!/usr/bin/env node
/**
 * THE MAC ASKS FOR WORK EVERY FIVE MINUTES IN THE WAKING DAY, AND NEVER RUNS TWO AGENTS AT ONCE (1 Oct 2026).
 *
 * "why is there a 18:35 check? if i press the button to run on demand?" The Run-now button queues a task in the cloud and the
 * Mac has to ask for it; it asked six times a day. The installer now also writes `com.seq.boss-agent-poll`, which runs
 * `scripts/ops/agent-claim.sh --poll` every 300 seconds. Two things must stay true or the cure is worse than the
 * wait, and this proves both over the REAL wrapper under real bash with a stub `npm` (no CLI starts, nothing is claimed):
 *
 *   1. IT NEVER OVERLAPS. The fixed-time job and the poll both go through the wrapper, which takes a kernel lock (flock on
 *      fd 9). A live holder makes the next tick exit silently (a briefing runs up to fifteen minutes; a second Claude Code
 *      or Codex session on the same Mac while the first works is the failure); a holder that dies, even by kill -9, frees
 *      it at once; a child the run leaves behind never holds it; and the lock never trusts the `mkdir` binary, which is
 *      not atomic on the ubuntu-26.04 runners (uutils; main red 21 Nov 2026, run 44989669473).
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
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, chmodSync, utimesSync, statSync } from "node:fs";
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
    if (/reload_plist "\$POLL_PLIST"/.test(text) === false || !/lint_plist "\$POLL_PLIST"/.test(text)) out.push("The poll plist is not linted and loaded like the others.");
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
  const out = { bin, log, home: join(root, "home"), workspace: join(root, "reports") };
  // WRITTEN ONCE PER ROOT, never rewritten. envFor() runs for every spawn, and the overlap cases start a
  // second wrapper (or eight) in the same root while the first is still executing bin/npm. Rewriting a
  // file the kernel is executing fails with ETXTBSY on Linux (12 Oct 2026, CI run 38282874761 on c4bcdea:
  // "ETXTBSY: text file is busy, open '/tmp/boss-claim-…/bin/npm'"). The stub's text depends only on the
  // root, so the first write is the only one needed.
  if (existsSync(join(bin, "npm")) && existsSync(join(bin, "node"))) return out;
  // `npm` stands in for `npm run --silent vault:run -- node scripts/...` (peek, work-once, sky-snapshot), `node` for the market snapshot.
  // Every call is logged in order. `peek` answers STUB_PEEK_RC (0 = something is waiting); `work-once` holds until the TEST
  // releases it (STUB_RELEASE) or for STUB_HOLD seconds, and with STUB_LINGER leaves a background child behind.
  //
  // Overlap is detected with bash's own noclobber (O_CREAT|O_EXCL in the shell), never the `mkdir` binary: on the
  // ubuntu-26.04 runners `mkdir` is uutils, which is not atomic (22 Nov 2026), so a mkdir marker could miss a real overlap.
  writeFileSync(
    join(bin, "npm"),
    `#!/bin/bash
echo "npm $*" >> "${log}"
case "$*" in
  *"agent.mjs peek"*) exit "\${STUB_PEEK_RC:-0}" ;;
  *"agent.mjs work-once"*)
    ( set -C; : > "\${BOSS_OS_HOME}/stub-running" ) 2>/dev/null || echo "OVERLAP" >> "${log}"
    [ -n "\${STUB_RELEASE:-}" ] && [ -e "\${STUB_RELEASE}" ] && echo "AFTER_RELEASE" >> "${log}"
    echo "HOLDING" >> "${log}"
    # A child the run leaves behind, holding every fd the run had (as a detached helper would).
    if [ -n "\${STUB_LINGER:-}" ]; then sleep 30 </dev/null >/dev/null 2>&1 & echo "$!" > "\${STUB_LINGER}"; fi
    # A hold the TEST ends (STUB_RELEASE: a file it creates once the contenders are done), never a fixed number of
    # seconds a loaded runner can outlast (15 Nov 2026, main run 43693209796: "the real wrapper behaves" red, then
    # green on a rerun with nothing changed). Bounded at 60 s so a broken lock still ends and is reported.
    if [ -n "\${STUB_RELEASE:-}" ]; then
      i=0; while [ ! -e "\${STUB_RELEASE}" ] && [ "$i" -lt 1200 ]; do sleep 0.05; i=$((i+1)); done
    else
      sleep "\${STUB_HOLD:-0}"
    fi
    rm -f "\${BOSS_OS_HOME}/stub-running" ;;
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
  return out;
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

/**
 * A `mkdir` with the race the ubuntu-26.04 runners' uutils mkdir has (22 Nov 2026, run 44989669473): it looks for the
 * path, and only then creates it, so racers that look in the same window all succeed. Put first on PATH, it makes that
 * race certain on any machine (her Mac's BSD mkdir included), so a lock that trusts the `mkdir` binary fails every time.
 */
function racyMkdirBin(root) {
  const dir = join(root, "racybin");
  mkdirSync(dir, { recursive: true });
  const real = spawnSync("sh", ["-c", "command -v mkdir"], { encoding: "utf8" }).stdout.trim() || "/bin/mkdir";
  writeFileSync(join(dir, "mkdir"), `#!/bin/bash
for a in "$@"; do [ "$a" = "-p" ] && exec "${real}" "$@"; done
for a in "$@"; do case "$a" in -*) ;; *) d="$a" ;; esac; done
if [ -e "$d" ]; then echo "mkdir: $d: File exists" >&2; exit 1; fi
sleep 0.3
exec "${real}" -p "$d"
`);
  chmodSync(join(dir, "mkdir"), 0o755);
  return dir;
}

/** Problems in the wrapper's behaviour, over the file at `wrapperPath`. */
export async function wrapperProblems(wrapperPath) {
  const out = [];
  {
    // The harness itself: a stub rewritten while a spawned wrapper executes it is ETXTBSY on Linux.
    const root = mkdtempSync(join(tmpdir(), "boss-claim-stub-"));
    try {
      const npm = join(stubEnv(root).bin, "npm");
      const t = new Date(Date.now() - 3_600_000);
      utimesSync(npm, t, t);
      stubEnv(root);
      if (statSync(npm).mtimeMs > t.getTime() + 1000) out.push("harness: stubEnv rewrote bin/npm on a second call in the same root (ETXTBSY while a wrapper runs it).");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  const fresh = () => mkdtempSync(join(tmpdir(), "boss-claim-"));
  const homeOf = (root) => join(root, "home");
  const logOf = (root) => join(root, "calls.log");
  const touchAgo = (path, minutesAgo) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{}");
    const t = new Date(Date.now() - minutesAgo * 60_000);
    utimesSync(path, t, t);
  };
  const waitForClaims = async (root, n) => {
    for (let i = 0; i < 200 && claimsIn(logOf(root)) < n; i++) await new Promise((r) => setTimeout(r, 50));
  };

  // 1. The poll only runs in the waking day: 06:00 in, 22:00 out; "08" is not read as octal. Peek answers "waiting" here.
  for (const [hour, expected] of [["03", 0], ["05", 0], ["06", 1], ["08", 1], ["14", 1], ["21", 1], ["22", 0], ["23", 0]]) {
    const root = fresh();
    runWrapper(wrapperPath, root, ["--poll"], { BOSS_OS_CLAIM_HOUR: hour });
    const n = claimsIn(logOf(root));
    if (n !== expected) out.push(`--poll at hour ${hour}: expected ${expected} claim(s), saw ${n}.`);
    rmSync(root, { recursive: true, force: true });
  }

  // 2. The fixed-time call claims at ANY hour, and does NOT peek or refresh (its own chain already did). A finished run
  // releases the lock: the next call claims too.
  {
    const root = fresh();
    const first = runWrapper(wrapperPath, root, [], { BOSS_OS_CLAIM_HOUR: "03" });
    const c = calls(logOf(root));
    if (claimsIn(logOf(root)) !== 1) out.push(`The fixed-time call at 03:00 should claim once, saw ${claimsIn(logOf(root))}.`);
    if (first.status !== 0) out.push(`A normal fixed-time claim exited ${first.status}: ${first.stderr.trim()}`);
    if (c.some((l) => /peek|sky-snapshot|market-snapshot/.test(l))) out.push("The fixed-time call peeked or refreshed the data; its own chain does that.");
    runWrapper(wrapperPath, root, [], { BOSS_OS_CLAIM_HOUR: "03" });
    if (claimsIn(logOf(root)) !== 2) out.push("The lock was not released after a normal run: the next call could not claim.");
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

  // 6. A live holder makes the next tick exit WITHOUT claiming: two agents never run at once. When it finishes, the next tick claims.
  {
    const root = fresh();
    const release = join(root, "release");
    const first = spawn("bash", [wrapperPath], { env: envFor(root, { STUB_RELEASE: release }), stdio: "ignore" });
    // The close listener is attached HERE, in the same tick as the spawn (2 Oct 2026, CI run 37017877746: attached later,
    // a fast mutant closed with nobody listening and Node exited 13, "unsettled top-level await").
    const firstClosed = new Promise((r) => first.on("close", r));
    // Wait until `first` has RECORDED its claim, so the second tick below provably runs inside the hold.
    await waitForClaims(root, 1);
    const second = runWrapper(wrapperPath, root, ["--poll"], { BOSS_OS_CLAIM_HOUR: "14" });
    if (claimsIn(logOf(root)) !== 1) out.push(`While one claim was running, a second tick started another: ${claimsIn(logOf(root))} claims recorded (expected 1).`);
    if (second.status !== 0) out.push(`A tick that finds a live holder should exit 0 silently, exited ${second.status}.`);
    writeFileSync(release, "");
    await firstClosed;
    runWrapper(wrapperPath, root, ["--poll"], { BOSS_OS_CLAIM_HOUR: "14" });
    if (claimsIn(logOf(root)) !== 2) out.push("The lock was not released when the holder finished: the next tick could not claim.");
    rmSync(root, { recursive: true, force: true });
  }

  // 7. A HOLDER THAT DIES (kill -9 mid-claim: no exit trap, no clean-up) does not hold the next tick out, and nothing an
  // older wrapper or a crash left on disk blocks a claim: an old lock directory whose record names a LIVE process (this
  // validator), one with an empty record, and a lock file with nobody holding it.
  {
    const root = fresh();
    const release = join(root, "release");
    const first = spawn("bash", [wrapperPath], { env: envFor(root, { STUB_RELEASE: release }), stdio: "ignore", detached: true });
    const firstClosed = new Promise((r) => first.on("close", r));
    await waitForClaims(root, 1);
    try { process.kill(-first.pid, "SIGKILL"); } catch { /* already gone */ }
    await firstClosed;
    rmSync(join(homeOf(root), "stub-running"), { force: true }); // the killed stub's own marker, not the wrapper's
    runWrapper(wrapperPath, root, ["--poll"], { BOSS_OS_CLAIM_HOUR: "14" });
    if (claimsIn(logOf(root)) !== 2) out.push(`A holder killed mid-claim (kill -9) still held the next tick out: ${claimsIn(logOf(root))} claims (expected 2).`);
    rmSync(root, { recursive: true, force: true });
  }
  for (const [label, setup] of [
    ["an old lock directory naming a live process", (home) => { mkdirSync(join(home, "agent-claim.lock"), { recursive: true }); writeFileSync(join(home, "agent-claim.lock", "holder"), `${process.pid}|Thu Jan  1 00:00:00 1970\n`); }],
    ["an old lock directory with an empty record", (home) => { mkdirSync(join(home, "agent-claim.lock"), { recursive: true }); writeFileSync(join(home, "agent-claim.lock", "holder"), ""); }],
    ["a lock file nobody holds", (home) => { mkdirSync(home, { recursive: true }); writeFileSync(join(home, "agent-claim.flock"), "left by a crash\n"); }],
  ]) {
    const root = fresh();
    setup(homeOf(root));
    runWrapper(wrapperPath, root, ["--poll"], { BOSS_OS_CLAIM_HOUR: "14" });
    if (claimsIn(logOf(root)) !== 1) out.push(`${label[0].toUpperCase()}${label.slice(1)} blocked the claim.`);
    rmSync(root, { recursive: true, force: true });
  }

  // 8. SIMULTANEOUS CONTENDERS (review of #61): eight ticks at the same instant claim exactly ONCE: on a free lock, on a lock
  // file a crash left, and with a `mkdir` that is not atomic first on PATH (the 21 Nov 2026 main red, run 44989669473: the
  // runners' uutils mkdir let two of eight contenders "create" the same lock directory, so two claims ran at once).
  for (const [label, prepare] of [
    ["a free lock", () => ({})],
    ["a lock file a crash left", (root) => { mkdirSync(homeOf(root), { recursive: true }); writeFileSync(join(homeOf(root), "agent-claim.flock"), ""); return {}; }],
    ["a free lock with a non-atomic mkdir (the runners' uutils race)", (root) => ({ PATH: `${racyMkdirBin(root)}:${stubEnv(root).bin}:${process.env.PATH}` })],
  ]) {
    const root = fresh();
    const extra = prepare(root);
    // The holder holds until the other seven have exited (or 45 s), so no contender, however late a loaded runner
    // starts it, can find the claim already finished: a second claim then means the lock failed.
    const release = join(root, "release");
    const procs = Array.from({ length: 8 }, () => spawn("bash", [wrapperPath, "--poll"], { env: envFor(root, { BOSS_OS_CLAIM_HOUR: "14", STUB_RELEASE: release, ...extra }), stdio: "ignore" }));
    let closed = 0;
    // The cap only ends a broken run. If it fires, a tick that starts AFTER the first claim finished may claim once more:
    // that is the lock working (main runs 43693209796 and 43780957679, 15 Nov 2026). Such claims are marked AFTER_RELEASE
    // by the stub and do not count; any claim that starts while the first is held still fails.
    const cap = setTimeout(() => writeFileSync(release, ""), 45_000);
    // Seven exits release the holder only once it is HOLDING (past its AFTER_RELEASE look): a busy tick exits at once, so the seven can all be
    // gone before the winner has even reached its claim, and a release written then would mark the one real claim late.
    // A second claim HOLDING already decides the case (the lock failed), so it releases at once instead of waiting out the cap.
    const poll = setInterval(() => {
      if ((closed >= 7 && calls(logOf(root)).includes("HOLDING")) || calls(logOf(root)).filter((l) => l === "HOLDING").length >= 2) { clearInterval(poll); writeFileSync(release, ""); }
    }, 20);
    await Promise.all(procs.map((p) => new Promise((r) => p.on("close", () => { closed++; r(); }))));
    clearInterval(poll);
    clearTimeout(cap);
    if (calls(logOf(root)).includes("OVERLAP")) out.push(`Eight simultaneous ticks on ${label}: two claims ran at the same moment.`);
    const late = calls(logOf(root)).filter((l) => l === "AFTER_RELEASE").length;
    const n = claimsIn(logOf(root)) - late;
    if (n !== 1) out.push(`Eight simultaneous ticks on ${label} produced ${n} claims while the first was held (expected exactly 1): two agents ran at once.`);
    rmSync(root, { recursive: true, force: true });
  }

  // 9. A CHILD THE RUN LEAVES BEHIND does not hold every later tick out: the lock is the wrapper's alone, never inherited.
  {
    const root = fresh();
    const linger = join(root, "linger.pid");
    runWrapper(wrapperPath, root, [], { STUB_LINGER: linger });
    runWrapper(wrapperPath, root, ["--poll"], { BOSS_OS_CLAIM_HOUR: "14" });
    if (claimsIn(logOf(root)) !== 2) out.push("A background child the run left behind held the lock: the next tick could not claim (the lock must not be inherited).");
    try { process.kill(Number(readFileSync(linger, "utf8").trim()), "SIGKILL"); } catch { /* already gone */ }
    rmSync(root, { recursive: true, force: true });
  }

  // 10. A LIVE HOLDER STAYS LIVE WHEN THE WALL CLOCK STEPS (7 Nov 2026, CI run 42417606391 on #327, and #328). A `ps` whose
  // lstart answer moves on every call (everything else goes to the real ps) stands in for an NTP step: nothing about who
  // holds the lock may come from the clock.
  {
    const root = fresh();
    const shift = join(root, "shiftbin");
    mkdirSync(shift, { recursive: true });
    const realPs = spawnSync("sh", ["-c", "command -v ps"], { encoding: "utf8" }).stdout.trim() || "/bin/ps";
    writeFileSync(join(shift, "ps"), `#!/bin/bash
case "$*" in
  *lstart*)
    n=$(cat "${join(root, "ps-calls")}" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "${join(root, "ps-calls")}"
    echo "Sat Nov  7 21:50:$((10 + n % 40)) 2026" ;;
  *) exec "${realPs}" "$@" ;;
esac
`);
    chmodSync(join(shift, "ps"), 0o755);
    const PATH = `${shift}:${stubEnv(root).bin}:${process.env.PATH}`;
    const release = join(root, "release");
    const first = spawn("bash", [wrapperPath], { env: envFor(root, { PATH, STUB_RELEASE: release }), stdio: "ignore" });
    const firstClosed = new Promise((r) => first.on("close", r));
    await waitForClaims(root, 1);
    runWrapper(wrapperPath, root, ["--poll"], { PATH, BOSS_OS_CLAIM_HOUR: "14" });
    writeFileSync(release, "");
    await firstClosed;
    if (calls(logOf(root)).includes("OVERLAP") || claimsIn(logOf(root)) !== 1) out.push(`On ${process.platform}, a live holder was taken over when the wall clock stepped: ${claimsIn(logOf(root))} claims (expected 1).`);
    rmSync(root, { recursive: true, force: true });
  }

  // 11. A LOCK THAT CANNOT BE TAKEN IS A NAMED STOP, never a silent tick (a quiet exit 0 here would mean the Mac never
  // claims again and nobody hears): with no working perl, and with a flock the filesystem refuses (the real one-liner, its
  // flock answering EOPNOTSUPP), the wrapper claims nothing, exits 3 and says CLAIM_LOCK_UNAVAILABLE. Only "held by
  // another process" (EWOULDBLOCK) is the silent busy tick.
  {
    const realPerl = spawnSync("sh", ["-c", "command -v perl"], { encoding: "utf8" }).stdout.trim() || "/usr/bin/perl";
    for (const [label, perl] of [
      ["no working perl", "#!/bin/bash\necho 'perl: not installed' >&2\nexit 127\n"],
      ["a flock the filesystem refuses", `#!/bin/bash\nexec "${realPerl}" -e 'BEGIN { require Errno; *CORE::GLOBAL::flock = sub { $! = Errno::EOPNOTSUPP(); 0 } }' "$@"\n`],
    ]) {
      const root = fresh();
      const broken = join(root, "brokenbin");
      mkdirSync(broken, { recursive: true });
      writeFileSync(join(broken, "perl"), perl);
      chmodSync(join(broken, "perl"), 0o755);
      const r = runWrapper(wrapperPath, root, [], { PATH: `${broken}:${stubEnv(root).bin}:${process.env.PATH}` });
      if (claimsIn(logOf(root)) !== 0) out.push(`With ${label} the wrapper claimed anyway.`);
      if (r.status !== 3 || !/CLAIM_LOCK_UNAVAILABLE/.test(r.stderr)) out.push(`With ${label} the wrapper must stop by name (exit 3, CLAIM_LOCK_UNAVAILABLE); it exited ${r.status}: ${r.stderr.trim() || "(silent)"}`);
      rmSync(root, { recursive: true, force: true });
    }
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
  const PERL_LOCK = `perl -MFcntl=:flock -MErrno -e 'open(my $fh, ">&=", 9) or exit 2; flock($fh, LOCK_EX | LOCK_NB) or exit($!{EWOULDBLOCK} ? 1 : 2); exit 0'`;
  const dir = mkdtempSync(join(tmpdir(), "boss-claim-self-"));
  const plant = async (name, mutate) => {
    // The wrapper finds its repo from its own path, so a planted copy lives under scripts/ops of a scratch tree.
    mkdirSync(join(dir, name, "scripts", "ops"), { recursive: true });
    const target = join(dir, name, "scripts", "ops", "agent-claim.sh");
    const text = mutate(wrapperText);
    if (text === wrapperText) throw new Error(`self-test mutant "${name}" did not apply: the wrapper text it targets has changed`);
    writeFileSync(target, text);
    chmodSync(target, 0o755);
    return wrapperProblems(target);
  };
  const realProblems = await wrapperProblems(join(ROOT, WRAPPER));
  for (const p of realProblems) console.error(`  real wrapper: ${p}`);
  check("the real wrapper behaves", realProblems.length === 0);
  check("a wrapper with no hour guard is caught", (await plant("noguard", (t) => t.replace('if [ "$hour" -lt 6 ] || [ "$hour" -ge 22 ]; then', "if false; then"))).length > 0);
  check("a wrapper with no lock is caught", (await plant("nolock", (t) => t.replace(PERL_LOCK, "true"))).length > 0);
  // THE 21 NOV 2026 LOCK: a directory made with the `mkdir` binary, released by a trap. Correct only where that binary is
  // atomic, so it must fail here on every machine, her Mac included (the non-atomic mkdir case), and on a kill -9.
  check("a lock that trusts the mkdir binary (the 21 Nov race) is caught", (await plant("mkdirlock", (t) => t.replace(PERL_LOCK, `mkdir "$LOCK_FILE.d" 2>/dev/null && trap 'rmdir "$LOCK_FILE.d"' EXIT`))).length > 0);
  check("a lock the run's children inherit is caught", (await plant("inherited", (t) => t.replace("agent.mjs work-once 9>&-", "agent.mjs work-once"))).length > 0);
  check("a flock error read as \"busy\" (a silent tick forever) is caught", (await plant("errorisbusy", (t) => t.replace("or exit($!{EWOULDBLOCK} ? 1 : 2)", "or exit 1"))).length > 0);
  check("a lock failure that exits quietly is caught", (await plant("quietfail", (t) => t.replace(/no claim this tick\." >&2\n     exit 3 ;;/, 'no claim this tick." >&2\n     exit 0 ;;'))).length > 0);
  check("a poll that claims without peeking is caught", (await plant("nopeek", (t) => t.replace("agent.mjs peek 9>&- >/dev/null 2>&1 || exit 0", "agent.mjs peek 9>&- >/dev/null 2>&1 || true"))).length > 0);
  check("a poll that claims without refreshing the briefing's data is caught", (await plant("norefresh", (t) => t.replace(/  if \[ -z "\$\(find "\$WORKSPACE\/SKY\.json"[\s\S]*?\n  fi\n  if \[ -z "\$\(find "\$WORKSPACE\/MARKETS\.json"[\s\S]*?\n  fi\n/, ""))).length > 0);
  check("a poll that refetches fresh data every tick is caught", (await plant("alwaysfetch", (t) => t.replaceAll('-mmin -"$FRESH_MINUTES"', "-mmin -0"))).length > 0);
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
  console.log("the-agent-polls-without-overlap: the poll is five minutes, waking day only, through one lock-taking wrapper the fixed-time job shares; a live holder blocks, a dead one (even kill -9) frees it, no child inherits it, and eight racers claim once even with a non-atomic mkdir. OK.");
}
