#!/usr/bin/env node
/**
 * ONE WAY TO RUN A VITEST POOL IN CI, shared by the gate's shards and "what failed last time"
 * (recheck-failed.mjs), so the two can never drift (fresh review of #538, 22 Nov 2026).
 *
 *   node scripts/ops/vitest-pool.mjs node --shard=1/4        # tests/ (vitest.config.ts), serial per shard
 *   node scripts/ops/vitest-pool.mjs boss --shard=1/3        # tests/boss/ (vitest.boss.config.ts, workerd)
 *   node scripts/ops/vitest-pool.mjs boss tests/boss/a.test.ts …
 *
 * THE BOSS POOL'S OWN RACE, RETRIED BY NAME, never a failing assertion. `@cloudflare/vitest-pool-workers`
 * snapshots isolated storage between suites and asserts every file under the D1 directory ends in
 * `.sqlite`; on a slow runner SQLite's WAL sidecar (`…sqlite-shm`) is sometimes still on disk at that
 * instant and the pool aborts with "Isolated storage failed", a message about the harness, not a test
 * (PR #29 and #31, 21 Sep 2026, 0 test failures, never locally). If the run died on EXACTLY that
 * signature, with no real assertion beside it, it runs once more; any other failure is reported as is.
 * Exit: vitest's own.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SIGNATURE = /Isolated storage failed/;
const REAL_FAILURE = /AssertionError: expected|TypeError|ReferenceError|Test timed out/;

/** Whether a failed boss run died only on the pool's storage race. Pure. */
export const onlyTheHarnessRace = (log) => SIGNATURE.test(log) && !REAL_FAILURE.test(log);

/** npx's arguments for one pool; an unknown pool is refused before anything runs. Pure. */
export function argsFor(pool, rest) {
  if (pool !== "node" && pool !== "boss") throw new Error(`vitest-pool: unknown pool "${pool}" (node | boss)`);
  return pool === "boss"
  ? ["--no-install", "vitest", "run", "--config", "vitest.boss.config.ts", ...rest]
    : ["--no-install", "vitest", "run", "--no-file-parallelism", ...rest];
}

/** One vitest run, its output streamed live (a shard killed at its timeout still leaves its log). */
function once(pool, rest) {
  return new Promise((resolve) => {
    const child = spawn("npx", argsFor(pool, rest), { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    const keep = (out) => (chunk) => { out.write(chunk); if (pool === "boss") log += chunk; };
    child.stdout.on("data", keep(process.stdout));
    child.stderr.on("data", keep(process.stderr));
    child.on("error", (err) => { console.error(`vitest-pool: could not start vitest (${err.message})`); resolve({ status: 1, log }); });
    child.on("close", (code) => resolve({ status: code ?? 1, log }));
  });
}

/** Runs one pool; the boss pool gets its one retry on the harness race. Resolves the exit status. */
export async function runPool(pool, rest) {
  argsFor(pool, rest); // refuses an unknown pool before anything runs
  const first = await once(pool, rest);
  if (first.status === 0 || pool !== "boss" || !onlyTheHarnessRace(first.log)) return first.status;
  console.log("::warning::the pool's isolated-storage snapshot raced a SQLite WAL sidecar; running the Boss suites once more");
  return (await once(pool, rest)).status;
}

function selfTest() {
  if (!onlyTheHarnessRace("Error: Isolated storage failed. There should be ...")) throw new Error("missed the harness race");
  if (onlyTheHarnessRace("Isolated storage failed\nAssertionError: expected 1 to be 2")) throw new Error("retried a real failure");
  if (onlyTheHarnessRace("AssertionError: expected 1 to be 2")) throw new Error("retried a plain failure");
  let threw = false; try { argsFor("other", []); } catch { threw = true; }
  if (!threw) throw new Error("accepted an unknown pool");
  if (!argsFor("boss", ["x"]).includes("vitest.boss.config.ts") || argsFor("node", []).includes("vitest.boss.config.ts")) throw new Error("ran a pool under the wrong config");
  console.log("vitest-pool self-test: ok");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [pool, ...rest] = process.argv.slice(2);
  (pool === "--self-test" ? Promise.resolve().then(selfTest) : runPool(pool, rest).then((code) => process.exit(code)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
