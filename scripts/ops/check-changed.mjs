#!/usr/bin/env node
/**
 * THE CHECK SCOPED TO THE WORK, BEFORE A PUSH (owner, 15 Nov 2026: "stop changes taking hours").
 *
 * #423 went red in CI on a thing a one-minute local run would have caught: a change to
 * src/worker/index.ts broke the suites that load it (`cloudflare:workers` under Node), and the round
 * trip through CI is twenty minutes. The full gate is CI's job; this is the slice of it the change can
 * break, so the push that reaches CI is already green on that slice.
 *
 *   npm run check:changed              # files changed vs origin/main (committed, staged, unstaged, untracked)
 *   npm run check:changed -- --list    # print what would run, run nothing
 *   npm run check:changed -- --base <ref>   # measure against another base (e.g. a merged PR's parent)
 *
 * What runs, in one go:
 *   1. typecheck (tsc --noEmit, the whole project: it is incremental-cheap and a type break travels).
 *   2. `vitest related --run <changed>` under BOTH configs (vitest.config.ts and vitest.boss.config.ts),
 *      so a change to a module runs every suite that imports it, directly or not, in either pool.
 *   3. the registered scans (`validate:scans`) that the change can affect. Every scan under ~5 s runs
 *      always (they are ~45 s in all, run 6 at a time); the scans in SLOW below run only when a changed
 *      path is one the scan's own scripts name (a path literal or a relative import in them) or the
 *      scan's script itself changed.
 *
 * It is NOT the full suite (CI runs that on the PR), and it does not run e2e.
 * Exit: 0 green · 1 a check failed (named) · 2 NAMED STOP [CHECK_CHANGED_NO_BASE] origin/main unreadable.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

// The checkout it is run in (npm and the hook both run from the repo root), so one copy can measure another worktree.
const ROOT = (() => { try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(); } catch { return join(dirname(fileURLToPath(import.meta.url)), "..", ".."); } })();

/**
 * Scans too slow to run on every push, measured 15 Nov 2026 on a Mac (`validate:scans` one by one):
 * agent-poll 159 s (it drives the real launchd wrapper under bash with timed holds), service-rules 15 s.
 * Every other scan measured under 4 s. A scan added here is scoped by the paths its scripts name.
 */
export const SLOW = ["validate:agent-poll", "validate:service-rules"];

const TEST_EXT = /\.(?:[cm]?[jt]sx?)$/;
const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Files changed vs the merge base with origin/main, plus anything not committed yet. Existing files only. */
export function changedFiles(against = "origin/main") {
  let base;
  try { base = git(["merge-base", against, "HEAD"]).trim(); } catch { return null; }
  const set = new Set([
    ...git(["diff", "--name-only", "--diff-filter=ACMR", base]).split("\n"),
    ...git(["ls-files", "--others", "--exclude-standard"]).split("\n"),
  ].filter(Boolean));
  return [...set].filter((f) => existsSync(join(ROOT, f))).sort();
}

/** The scans in `validate:scans`, by npm script name, in order. */
export function registeredScans(scripts) {
  return String(scripts["validate:scans"] ?? "").split("&&").map((s) => s.trim().replace(/^npm run\s+/, "")).filter(Boolean);
}

/** Repo-relative script files a package script runs (`node <file>` / `bash <file>`). */
export function scriptFiles(cmd) {
  return [...String(cmd).matchAll(/(?:node|bash|sh)\s+((?:scripts|src)\/[^\s&|;]+)/g)].map((m) => m[1]);
}

/** Every repo path a script names: path literals ("src/…", "scripts/…", "docs/…", …) and relative imports. Pure over text. */
export function pathsNamedIn(text, file) {
  const out = new Set([file]);
  for (const m of text.matchAll(/["'`]((?:src|scripts|docs|migrations|tests|e2e|design|workers|\.github)(?:\/[^"'`\s$]*)?)["'`]/g)) out.add(m[1].replace(/\/$/, ""));
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) out.add(normalize(join(dirname(file), m[1])));
  return [...out];
}

/** Does a changed path fall under any named path (equal, or inside a named directory)? */
export const touches = (changed, named) => changed.some((c) => named.some((n) => c === n || c.startsWith(`${n}/`)));

/** Which scans run for these changes: { run: [names], skipped: [names] }. */
export function scansFor(changed, scripts, read = (f) => readFileSync(join(ROOT, f), "utf8")) {
  const run = [];
  const skipped = [];
  for (const name of registeredScans(scripts)) {
    if (!SLOW.includes(name)) { run.push(name); continue; }
    const files = scriptFiles(scripts[name] ?? "");
    const named = files.flatMap((f) => { try { return pathsNamedIn(read(f), f); } catch { return [f]; } });
    (files.length === 0 || touches(changed, [...named, "package.json"]) ? run : skipped).push(name);
  }
  return { run, skipped };
}

function sh(label, cmd, args) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.on("close", (code) => res({ label, ok: code === 0, secs: (Date.now() - t0) / 1000, out }));
  });
}

async function pool(jobs, n) {
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const j = jobs[i++]; results.push(await j()); } }));
  return results;
}

async function main() {
  const listOnly = process.argv.includes("--list");
  const bi = process.argv.indexOf("--base");
  const changed = changedFiles(bi > 0 ? process.argv[bi + 1] : "origin/main");
  if (!changed) { console.error("NAMED STOP [CHECK_CHANGED_NO_BASE] origin/main is not readable here: git fetch origin, then run again."); process.exit(2); }
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
  const code = changed.filter((f) => TEST_EXT.test(f));
  const { run, skipped } = scansFor(changed, scripts);
  console.log(`check:changed — ${changed.length} file(s) changed vs ${bi > 0 ? process.argv[bi + 1] : "origin/main"}; ${code.length} code file(s) for vitest related; ${run.length} scan(s)${skipped.length ? `, skipped (paths untouched): ${skipped.join(", ")}` : ""}`);
  if (listOnly) { for (const f of changed) console.log(`  ${f}`); process.exit(0); }
  if (!changed.length) { console.log("check:changed — nothing changed vs origin/main, nothing to check."); process.exit(0); }

  const t0 = Date.now();
  const npx = (args) => ["npx", ["--no-install", ...args]];
  const heavy = [
    () => sh("typecheck", ...npx(["tsc", "--noEmit"])),
    ...(code.length ? [
      () => sh("vitest related (node)", ...npx(["vitest", "related", "--run", "--passWithNoTests", "--no-file-parallelism", ...code])),
      () => sh("vitest related (boss)", ...npx(["vitest", "related", "--run", "--passWithNoTests", "--config", "vitest.boss.config.ts", ...code])),
    ] : []),
  ];
  const scanJobs = run.map((name) => () => sh(name, "npm", ["run", "-s", name]));
  const [heavyResults, scanResults] = await Promise.all([pool(heavy, heavy.length), pool(scanJobs, 6)]);
  const all = [...heavyResults, ...scanResults];
  const failed = all.filter((r) => !r.ok);
  for (const r of heavyResults) console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.label} (${r.secs.toFixed(1)} s)`);
  console.log(`  ${scanResults.filter((r) => r.ok).length}/${scanResults.length} scans ok (longest ${Math.max(0, ...scanResults.map((r) => r.secs)).toFixed(1)} s)`);
  for (const r of failed) console.log(`\n── ${r.label} ──\n${r.out.trim().split("\n").slice(-40).join("\n")}`);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (failed.length) { console.log(`\ncheck:changed FAILED in ${secs} s: ${failed.map((r) => r.label).join(", ")}`); process.exit(1); }
  console.log(`check:changed green in ${secs} s`);
}

if (process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === "") await main();
