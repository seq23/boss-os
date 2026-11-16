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
 *   2. the suites for the changed files (`relatedTests`: changed tests, the suite named after each changed
 *      module, and its smallest importers in each pool), each under its own config: tests/boss/** under
 *      vitest.boss.config.ts, the rest under vitest.config.ts. So a change to src/worker/index.ts runs
 *      suites that load it under Node, which is what broke #423.
 *   3. the registered scans (`validate:scans`) that the change can affect. Every scan under ~5 s runs
 *      always (they are ~45 s in all, run 6 at a time); the scans in SLOW below run only when a changed
 *      path is one the scan's own scripts name (a path literal or a relative import in them) or the
 *      scan's script itself changed.
 *
 * It is NOT the full suite (CI runs that on the PR), and it does not run e2e.
 * Exit: 0 green · 1 a check failed (named) · 2 NAMED STOP [CHECK_CHANGED_NO_BASE] origin/main unreadable.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

const ALIASES = { "@shared/": "src/shared/", "@worker/": "src/worker/" };
const RESOLVE_EXT = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", "/index.ts", "/index.tsx", "/index.mjs", "/index.js"];

/** Every file under a directory, repo-relative. */
function walk(rel, out = []) {
  let names = [];
  try { names = readdirSync(join(ROOT, rel)); } catch { return out; }
  for (const n of names) {
    const r = `${rel}/${n}`;
    if (n === "node_modules" || n.startsWith(".")) continue;
    if (statSync(join(ROOT, r)).isDirectory()) walk(r, out); else out.push(r);
  }
  return out;
}

/** Repo-relative imports of one file (relative and @shared/@worker specifiers; `?raw` etc. stripped). Pure over text. */
export function importsOf(text, file) {
  const out = [];
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)["']([^"']+)["']/g)) {
    let spec = m[1].split("?")[0];
    const alias = Object.keys(ALIASES).find((a) => spec.startsWith(a));
    if (alias) spec = ALIASES[alias] + spec.slice(alias.length);
    else if (spec.startsWith(".")) spec = normalize(join(dirname(file), spec));
    else continue;
    const hit = RESOLVE_EXT.map((e) => spec + e).find((c) => existsSync(join(ROOT, c)) && statSync(join(ROOT, c)).isFile())
      ?? (spec.endsWith(".js") ? [spec.replace(/\.js$/, ".ts"), spec.replace(/\.js$/, ".tsx")].find((c) => existsSync(join(ROOT, c))) : undefined);
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * The suites to run for these changes, at most PER_FILE importers of each changed module per pool.
 *
 * Measured 15 Nov 2026: every suite that imports #422's ten files is 48 Boss suites (893 s here, and the
 * workers pool is flaky locally at that size: "Network connection lost", "Isolated storage failed"); the
 * full transitive closure is 188 suites. That is the full suite by another name, and CI runs it. What a
 * push should never carry is a module that no longer LOADS or a suite of its own that fails, and #423's
 * break was the first kind (`cloudflare:workers` under Node): any one suite importing src/worker/index.ts
 * shows it. So: every changed test file; the suite named after a changed module (firstRead.ts →
 * firstRead.test.ts); then, for each changed module, its smallest PER_FILE direct importers in each pool.
 * Computed from the import text (vitest's own `related` walk parses `?raw` markdown as code and dies under
 * the Boss config). Returns repo-relative test paths.
 */
export const PER_FILE = 2;
export function relatedTests(changed, perFile = PER_FILE) {
  const want = new Set(changed);
  const tests = walk("tests").filter((f) => /\.test\.tsx?$/.test(f));
  const pick = new Set(tests.filter((t) => want.has(t)));
  const base = (f) => f.split("/").pop().replace(/\.(test\.)?[cm]?[jt]sx?$/, "");
  const size = (f) => { try { return statSync(join(ROOT, f)).size; } catch { return Infinity; } };
  const importers = new Map(changed.map((c) => [c, []]));
  for (const t of tests) {
    let text = "";
    try { text = readFileSync(join(ROOT, t), "utf8"); } catch { continue; }
    for (const f of importsOf(text, t)) if (importers.has(f)) importers.get(f).push(t);
  }
  for (const [file, users] of importers) {
    if (!users.length) continue;
    for (const boss of [false, true]) {
      const pool = users.filter((u) => u.startsWith("tests/boss/") === boss);
      const named = pool.filter((u) => base(u) === base(file));
      const rest = pool.filter((u) => !named.includes(u)).sort((x, y) => size(x) - size(y));
      for (const u of [...named, ...rest].slice(0, Math.max(perFile, named.length))) pick.add(u);
    }
  }
  return [...pick].sort();
}

/** Split a file list into n near-equal slices (round robin), dropping empty ones. Pure. */
export const slices = (files, n) => Array.from({ length: n }, (_, i) => files.filter((_, j) => j % n === i)).filter((s) => s.length);

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

/**
 * The environment for every check, WITHOUT git's own variables. Git runs a pre-push hook with GIT_DIR
 * (and friends) pointing at the real repository, and every scratch repo a test or scan builds inherits
 * them: 15 Nov 2026, the first hooked push ran validate:codex-lane's `git init --bare` + `git push origin
 * HEAD:main` against boss-os itself (core.bare flipped, a scratch commit on the branch, a push to main that
 * only the branch ruleset refused). Pure.
 */
export const cleanEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k]) => !/^GIT_/.test(k)));

function sh(label, cmd, args) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: cleanEnv() });
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
  console.log(`check:changed — ${changed.length} file(s) changed vs ${bi > 0 ? process.argv[bi + 1] : "origin/main"}; ${code.length} code file(s); ${run.length} scan(s)${skipped.length ? `, skipped (paths untouched): ${skipped.join(", ")}` : ""}`);
  if (listOnly) { for (const f of changed) console.log(`  ${f}`); process.exit(0); }
  if (!changed.length) { console.log("check:changed — nothing changed vs origin/main, nothing to check."); process.exit(0); }

  const t0 = Date.now();
  const npx = (args) => ["npx", ["--no-install", ...args]];
  const related = code.length ? relatedTests(code) : [];
  // A change to a config or a test stub reaches every suite of that pool without an import line.
  const bossAll = changed.some((f) => /^(vitest\.boss\.config\.ts|tests\/boss\/setup\.ts)$/.test(f));
  const nodeAll = changed.some((f) => /^(vitest\.config\.ts|tests\/stubs\/)/.test(f));
  // A config or stub change reaches every suite of its pool: the Worker entry's importers stand in for them.
  const sample = (nodeAll || bossAll) ? relatedTests(["src/worker/index.ts", "src/worker/boss/index.ts"], 3) : [];
  const bossTests = [...new Set([...related, ...(bossAll ? sample : [])])].filter((f) => f.startsWith("tests/boss/"));
  const nodeTests = [...new Set([...related, ...(nodeAll ? sample : [])])].filter((f) => !f.startsWith("tests/boss/"));
  console.log(`  suites: ${nodeTests.length} node, ${bossTests.length} boss (changed tests, the suite named after each changed module, and up to ${PER_FILE} importers of each per pool; CI runs the rest)`);
  // The node pool runs four files at a time per process, so two processes stay under the port ceiling.
  // The Boss pool stays ONE process: four side by side raced each other's workerd storage (15 Nov 2026).
  const heavy = [
    () => sh("typecheck", ...npx(["tsc", "--noEmit", "--incremental", "--tsBuildInfoFile", "node_modules/.cache/check-changed.tsbuildinfo"])),
    ...slices(nodeTests, 2).map((part, i, all) => () => sh(`tests (node ${i + 1}/${all.length}, ${part.length})`, ...npx(["vitest", "run", ...part]))),
    ...slices(bossTests, 1).map((part, i, all) => () => sh(`tests (boss ${i + 1}/${all.length}, ${part.length})`, ...npx(["vitest", "run", "--config", "vitest.boss.config.ts", ...part]))),
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
