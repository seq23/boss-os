#!/usr/bin/env node
/**
 * THE MAC RUNNERS' ONE LAUNCHER (owner, 3 Nov 2026: Codex is the worker, Claude the brain).
 *
 * `runAs(key, …)` reads the job's role from `src/shared/boss/aiRoles.mjs` and runs
 *   ~/bin/ai-run --role worker|brain [--cwd DIR] [--network] [--out FILE] -- "<prompt>"
 * (worker → codex exec on her ChatGPT plan; brain → claude -p). Nothing here picks an engine itself.
 *
 * A CODEX LIMIT IS A NOTE THAT WAITS, NEVER A CLAUDE FALLBACK. ai-run exits 75 with
 * `NAMED STOP [CODEX_LIMIT] resets <time>`; the result carries `codexLimit: { resets }` and the caller
 * ends the run as a named note the next scheduled run retries. There is no second call of any kind.
 *
 * CLI, for shell runners:  node scripts/ops/lib/ai-run.mjs role <key>   → prints worker|brain
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { roleFor, CODEX_LIMIT_EXIT } from "../../../src/shared/boss/aiRoles.mjs";

export const aiRunBin = (env = process.env) => env.AI_RUN_BIN || join(env.HOME || homedir(), "bin", "ai-run");

/** The argv for one ai-run call. */
export function aiRunArgs(role, { cwd, network = false, out, prompt }) {
  return ["--role", role, ...(cwd ? ["--cwd", cwd] : []), ...(network ? ["--network"] : []), ...(out ? ["--out", out] : []), "--", prompt];
}

/** `NAMED STOP [CODEX_LIMIT] resets <time>` → { resets }, or null. */
export function codexLimitFrom(code, text) {
  const m = String(text ?? "").match(/NAMED STOP \[CODEX_LIMIT\](?:\s+resets\s+([^\n]+))?/);
  if (code !== CODEX_LIMIT_EXIT && !m) return null;
  return { resets: m?.[1]?.trim() || "unknown" };
}

/** The one-line note a runner records for a Codex limit: not red, retried by the next run. */
export function codexLimitNote(key, limit) {
  return `NAMED STOP [CODEX_LIMIT] ${key} waits for the Codex reset (${limit.resets}); the next scheduled run retries it. Not handed to Claude.`;
}

/**
 * Run one job through ai-run in the role its key names. Resolves
 *   { role, code, out, err, timedOut, codexLimit, unavailable }
 * `spawnImpl` and `env` are injected for the test.
 */
export function runAs(key, { prompt, cwd, network = false, out, addDirs = [], timeoutMin = 120, onOut, env: baseEnv = process.env, spawnImpl = spawn } = {}) {
  const role = roleFor(key);
  const env = addDirs.length ? { ...baseEnv, AI_RUN_ADD_DIRS: addDirs.join(":") } : baseEnv;
  const bin = aiRunBin(env);
  if (spawnImpl === spawn && !existsSync(bin)) {
    return Promise.resolve({ role, code: 127, out: "", err: `NAMED STOP [AI_RUN_MISSING] ${bin} is not installed (seq-bin).`, timedOut: false, codexLimit: null, unavailable: "AI_RUN_MISSING" });
  }
  return new Promise((resolve) => {
    let so = "", se = "", timedOut = false;
    const child = spawnImpl(bin, aiRunArgs(role, { cwd, network, out, prompt }), { cwd: cwd || undefined, env, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMin * 60_000);
    child.stdout?.on("data", (d) => { so += d; onOut?.(String(d)); });
    child.stderr?.on("data", (d) => { se += d; onOut?.(String(d)); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ role, code: 127, out: so, err: `${se}${e.message}`, timedOut, codexLimit: null, unavailable: "AI_RUN_FAILED_TO_START" }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = `${so}\n${se}`;
      const codexLimit = role === "worker" ? codexLimitFrom(code, text) : null;
      const unavailable = /CODEX_UNAVAILABLE/.test(text) && code !== 0 ? "CODEX_UNAVAILABLE" : null;
      resolve({ role, code, out: so, err: se, timedOut, codexLimit, unavailable });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [cmd, key] = process.argv.slice(2);
  if (cmd === "role" && key) { console.log(roleFor(key)); process.exit(0); }
  console.error("usage: ai-run.mjs role <key>");
  process.exit(2);
}
