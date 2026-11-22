/*
 * ONE RUN AT A TIME, HELD BY THE KERNEL (22 Nov 2026). scripts/ops jobs took a `mkdir "$LOCK"` directory lock, which
 * is a mutex only when mkdir is one atomic mkdir(2): the ubuntu-26.04 runners' uutils mkdir is not (8 racers on one
 * path had several winners in 14 of 800 runs, run 44989669473), and the pid-file stale reclaim was a second race.
 * lib/flock.sh takes flock(2) through perl (macOS ships no `flock` binary), held by a small process that lets go the
 * moment the job's shell is gone, so no long child (ai-run, claude, Chrome) ever inherits the lock.
 */
import { describe, it, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
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
});

describe("every scripts/ops job that must run once at a time takes the kernel lock", () => {
  const ops = join(process.cwd(), "scripts/ops");
  const users = readdirSync(ops).filter((f) => f.endsWith(".sh") && readFileSync(join(ops, f), "utf8").includes("lib/flock.sh"));

  it("finds the jobs (never passes on zero) and none still takes a mkdir directory lock", () => {
    expect(users.length).toBeGreaterThanOrEqual(10);
    expect(users, "agent-claim takes the shared lock").toContain("agent-claim.sh");
    for (const f of readdirSync(ops).filter((f) => f.endsWith(".sh"))) {
      const src = readFileSync(join(ops, f), "utf8");
      expect(src, f).not.toMatch(/mkdir\s+"\$(RUN_)?LOCK"\s+2>/);
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
