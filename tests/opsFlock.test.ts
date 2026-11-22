/*
 * ONE RUN AT A TIME, HELD BY THE KERNEL (22 Nov 2026). scripts/ops jobs took a `mkdir "$LOCK"` directory lock, which
 * is a mutex only when mkdir is one atomic mkdir(2): the ubuntu-26.04 runners' uutils mkdir is not (8 racers on one
 * path had several winners in 14 of 800 runs, run 44989669473), and the pid-file stale reclaim was a second race.
 * lib/flock.sh takes flock(2) through perl (macOS ships no `flock` binary), held by a small process that lets go the
 * moment the job's shell is gone, so no long child (ai-run, claude, Chrome) ever inherits the lock.
 */
import { describe, it, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const LIB = join(process.cwd(), "scripts/ops/lib/flock.sh");
const sh = (script: string, ...args: string[]) =>
  spawnSync("/bin/bash", ["-c", `source "${LIB}"; ${script}`, "x", ...args], { encoding: "utf8", timeout: 30000 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const busy = (file: string) => sh('lock_busy "$1"; echo "rc=$?"', file).stdout.trim();
const scratch = () => mkdtempSync(join(tmpdir(), "ops-flock-"));

async function until(fn: () => boolean, ms = 10000) {
  for (let t = 0; t < ms && !fn(); t += 100) await sleep(100);
  return fn();
}

describe("lib/flock.sh: one holder, freed however the holder ends", () => {
  it("a second caller beside a holder is told busy (1); lock_busy sees it held; once the holder ends it is free", async () => {
    const lock = join(scratch(), "sub/.lock.flock");
    const holder = spawn("/bin/bash", ["-c", `source "${LIB}"; hold_lock "$1" || exit 9; exec sleep 30`, "x", lock], { stdio: "ignore" });
    expect(await until(() => busy(lock) === "rc=0"), "the holder took it").toBe(true);
    expect(sh('hold_lock "$1"; echo "rc=$?"', lock).stdout.trim()).toBe("rc=1");
    holder.kill("SIGTERM");
    expect(await until(() => busy(lock) === "rc=1", 4000), "freed within a few seconds of the holder ending").toBe(true);
    expect(sh('hold_lock "$1"; echo "rc=$?"', lock).stdout.trim()).toBe("rc=0");
  }, 30000);

  it("8 racers on one path: exactly one wins, every time", () => {
    for (let round = 0; round < 5; round++) {
      const dir = scratch();
      const lock = join(dir, ".lock.flock");
      const r = spawnSync("/bin/bash", ["-c", `
        source "${LIB}"
        for i in 1 2 3 4 5 6 7 8; do ( hold_lock "$1" && { echo win; sleep 2; } ) & done; wait`, "x", lock], { encoding: "utf8", timeout: 30000 });
      expect(r.stdout.split("\n").filter((l) => l === "win").length, `round ${round}`).toBe(1);
    }
  }, 60000);

  it("a holder killed with -9 (no trap runs) frees the lock: nothing stale is left to reclaim", async () => {
    const lock = join(scratch(), ".lock.flock");
    const holder = spawn("/bin/bash", ["-c", `source "${LIB}"; hold_lock "$1" || exit 9; exec sleep 30`, "x", lock], { stdio: "ignore" });
    expect(await until(() => busy(lock) === "rc=0")).toBe(true);
    holder.kill("SIGKILL");
    expect(await until(() => busy(lock) === "rc=1", 4000)).toBe(true);
  }, 30000);

  it("a long child left running after the job ends does not hold the next run out", async () => {
    const dir = scratch();
    const lock = join(dir, ".lock.flock");
    const r = spawnSync("/bin/bash", ["-c", `source "${LIB}"; hold_lock "$1" || exit 9; nohup sleep 8 >/dev/null 2>&1 & echo $!`, "x", lock], { encoding: "utf8", timeout: 20000 });
    const orphan = Number(r.stdout.trim());
    expect(orphan).toBeGreaterThan(0);
    try {
      expect(await until(() => busy(lock) === "rc=1", 4000), "the orphan holds nothing").toBe(true);
    } finally {
      try { process.kill(orphan, "SIGKILL"); } catch { /* gone */ }
    }
  }, 30000);

  it("release_lock lets go at once, while the shell lives on (agent-claim's next claim can start the moment one ends)", () => {
    const lock = join(scratch(), ".lock.flock");
    const r = sh('hold_lock "$1" || exit 9; lock_busy "$1"; echo "held=$?"; release_lock; lock_busy "$1"; echo "after=$?"', lock);
    expect(r.stdout.trim().split("\n")).toEqual(["held=0", "after=1"]);
  });

  it("an unlockable path is 2 (the caller's NAMED STOP), never 'busy' and never 'held'", () => {
    expect(sh('hold_lock /dev/null/nope/.lock.flock; echo "rc=$?"').stdout.trim()).toBe("rc=2");
    expect(busy(join(scratch(), "absent"))).toBe("rc=1");
  });

  it("a run that ends normally frees the lock AT ONCE: the next check never sees a finished run as running (CI shard 2/4)", () => {
    const lock = join(scratch(), ".lock.flock");
    // The next check runs straight after the job, from the same parent (launchd's next tick, the resume check).
    const r = sh(`for i in 1 2 3 4 5; do /bin/bash -c 'source "$2"; hold_lock "$1" || exit 9' x "$1" "$2"; lock_busy "$1"; echo "after=$?"; done`, lock, LIB);
    expect(r.stdout.trim().split("\n")).toEqual(Array(5).fill("after=1"));
  }, 60000);

  it("a holder killed from outside while the run works is said by name at the end (LOCK_LOST), never silent", () => {
    const lock = join(scratch(), ".lock.flock");
    const r = sh('hold_lock "$1" || exit 9; kill -9 "$LOCK_HOLDER_PID"; sleep 0.3; exit 0', lock);
    expect(r.stderr).toMatch(/NAMED STOP \[LOCK_LOST\]/);
    expect(sh('hold_lock "$1" || exit 9; exit 0', lock).stderr, "a normal run says nothing").not.toMatch(/LOCK_LOST/);
  }, 30000);
});

describe("the switch-over: a run of the OLD code still inside its directory lock", () => {
  it("a live pid in the old .lock directory is busy for both calls; the next run steps aside", () => {
    const dir = scratch();
    const lock = join(dir, ".lock.flock");
    mkdirSync(join(dir, ".lock"));
    const old = spawn("sleep", ["20"], { stdio: "ignore" });
    try {
      writeFileSync(join(dir, ".lock/pid"), `${old.pid}\n`);
      expect(busy(lock), "lock_busy").toBe("rc=0");
      expect(sh('hold_lock "$1"; echo "rc=$?"', lock).stdout.trim(), "hold_lock").toBe("rc=1");
      expect(existsSync(join(dir, ".lock")), "a live old lock is never removed").toBe(true);
    } finally { old.kill("SIGKILL"); }
  }, 30000);

  it("a dead pid in the old directory is not busy, and taking the lock removes the old directory", () => {
    const dir = scratch();
    const lock = join(dir, ".lock.flock");
    mkdirSync(join(dir, ".lock"));
    const gone = spawnSync("/bin/bash", ["-c", "echo $$"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(join(dir, ".lock/pid"), `${gone}\n`);
    expect(busy(lock)).toBe("rc=1");
    expect(sh('hold_lock "$1"; echo "rc=$?"', lock).stdout.trim()).toBe("rc=0");
    expect(existsSync(join(dir, ".lock"))).toBe(false);
  }, 30000);
});

describe("every scripts/ops job that must run once at a time takes the kernel lock", () => {
  const ops = join(process.cwd(), "scripts/ops");
  const users = readdirSync(ops).filter((f) => f.endsWith(".sh") && readFileSync(join(ops, f), "utf8").includes("lib/flock.sh"));

  it("finds the jobs (never passes on zero) and none still takes a mkdir directory lock", () => {
    expect(users.length).toBeGreaterThanOrEqual(10);
    expect(users, "agent-claim takes the shared lock").toContain("agent-claim.sh");
    for (const f of readdirSync(ops).filter((f) => f.endsWith(".sh"))) {
      const code = readFileSync(join(ops, f), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
      // Any mkdir of a lock path, with or without -p, by any variable name (FIXLOCK hid from the old guard).
      expect(code, f).not.toMatch(/mkdir\s+(-p\s+)?"?\$\{?\w*LOCK\w*|mkdir\s+(-p\s+)?"?[^\s"]*lock\b/i);
    }
  });

  it("a job that sets its own EXIT trap after taking the lock keeps the lock's release in it", () => {
    for (const f of users) {
      const code = readFileSync(join(ops, f), "utf8").split("\n").filter((l) => !/^\s*#/.test(l));
      const taken = code.findIndex((l) => /hold_lock\s/.test(l));
      if (taken < 0) continue;
      for (const l of code.slice(taken).filter((l) => /\btrap\b.*\bEXIT\b/.test(l))) expect(l, f).toMatch(/release_lock/);
    }
  });

  it("a second run of a real job beside a held lock steps aside: exit 0, ALREADY_RUNNING, and does nothing else", async () => {
    const home = scratch();
    const lock = join(home, "Library/Logs/kdp-watch/.lock.flock");
    expect(existsSync(join(ops, "kdp-watch.sh"))).toBe(true);
    const holder = spawn("/bin/bash", ["-c", `source "${LIB}"; hold_lock "$1" || exit 9; exec sleep 30`, "x", lock], { stdio: "ignore" });
    try {
      expect(await until(() => busy(lock) === "rc=0")).toBe(true);
      const r = spawnSync("/bin/bash", [join(ops, "kdp-watch.sh")], { env: { ...process.env, HOME: home, PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 20000 });
      const out = `${r.stdout}${r.stderr}${existsSync(join(home, "Library/Logs/kdp-watch")) ? readdirSync(join(home, "Library/Logs/kdp-watch")).filter((f) => f.endsWith(".log")).map((f) => readFileSync(join(home, "Library/Logs/kdp-watch", f), "utf8")).join("") : ""}`;
      expect(out).toMatch(/NAMED STOP \[ALREADY_RUNNING\]/);
      expect(r.status, out).toBe(0);
    } finally {
      holder.kill("SIGKILL");
    }
  }, 30000);
});

describe("boss-mail-tail's fix agent holds the kernel lock for its whole life (its old mkdir/pid lock is gone)", () => {
  /** A copy of the runner's own tree, with a fake agent and a vault runner that does nothing. */
  function tailTree() {
    const repo = scratch();
    mkdirSync(join(repo, "scripts/ops/lib"), { recursive: true });
    mkdirSync(join(repo, "scripts/vault"), { recursive: true });
    for (const f of ["boss-mail-tail-run.sh", "lib/flock.sh", "lib/tail-report.mjs"]) {
      writeFileSync(join(repo, "scripts/ops", f), readFileSync(join(process.cwd(), "scripts/ops", f)));
    }
    writeFileSync(join(repo, "scripts/vault/vault.mjs"), "console.log('folded');\n");
    const state = join(repo, "state");
    mkdirSync(state);
    const report = join(state, "report.txt");
    const claude = join(repo, "fake-claude");
    writeFileSync(claude, `#!/bin/bash\nsleep 3\nprintf 'subject\\nDone.\\nFRICTION_FIXED: 0\\n' > ${JSON.stringify(report)}\n`, { mode: 0o755 });
    const prompt = join(state, "prompt.txt");
    writeFileSync(prompt, "fix it");
    const lock = join(state, ".agent-lock.flock");
    const env = { ...(process.env as Record<string, string>), BOSS_OS_REPO: repo, HOME: repo };
    const args = [join(repo, "scripts/ops/boss-mail-tail-run.sh"), prompt, join(state, "tail.jsonl"), lock, claude, report, "subject", ""];
    return { state, lock, env, args };
  }

  it("busy while the agent works, a second agent beside it steps aside, and free the moment it ends", async () => {
    const t = tailTree();
    const first = spawn("/bin/bash", t.args, { env: t.env, stdio: "ignore" });
    const done = new Promise<number | null>((r) => first.on("exit", r));
    expect(await until(() => busy(t.lock) === "rc=0"), "the running agent holds it").toBe(true);
    const second = spawnSync("/bin/bash", t.args, { env: t.env, encoding: "utf8", timeout: 20000 });
    expect(second.status).toBe(0);
    expect(readFileSync(join(t.state, "report.log"), "utf8")).toMatch(/steps aside/);
    await done;
    expect(busy(t.lock), "free straight after the agent ended").toBe("rc=1");
  }, 60000);
});
