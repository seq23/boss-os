#!/usr/bin/env node
/**
 * CI MUST INSTALL WITH THE SAME npm MAJOR THAT WROTE THE LOCK.
 *
 * ─── The defect class this is the guard for ─────────────────────────────────
 *
 * On 2026-09-12 every run of `CI` on main died at `npm ci` before a single test ran:
 *
 *   Missing: @cloudflare/workers-types@4.20260702.1 from lock file
 *
 * Nothing in package.json had changed. The lock was written on this machine by npm 11 (Node 26);
 * CI ran Node 22, which bundles npm 10. The two majors disagree about whether an OPTIONAL PEER of a
 * nested dependency (the `wrangler@4.35` pinned inside `@cloudflare/vitest-pool-workers`, which
 * peers on `workers-types@^4`) belongs in the lock. npm 10 demands the entry; npm 11 deletes it
 * on the next `npm install`. So patching the lock is a fix that lasts exactly until she next runs
 * `npm install` locally, and then CI is red again with the same message.
 *
 * THE ROOT IS A TOOLCHAIN SPLIT, NOT A BAD LOCK. The fix is to declare one npm major in
 * `engines`, run CI on a Node that bundles it, and fail here — before push — whenever the two
 * drift apart again: a workflow edited to an older Node, or a lock regenerated on a machine whose
 * npm is not the declared one.
 *
 * ─── What is asserted ───────────────────────────────────────────────────────
 *
 *   1. `engines.npm` is declared in package.json, as a single major (">=11", "^11", "11.x").
 *   2. Every `node-version:` in every workflow under .github/workflows names a Node whose bundled
 *      npm has that major. Node 20 and 22 ship npm 10; Node 24 and 26 ship npm 11.
 *   3. The npm running this validator has that major, so a lock produced by whoever runs
 *      `npm run validate` is one CI can read.
 *
 * RULE 0: zero workflows, or zero `node-version:` lines across them, is a hard fail. A repo whose
 * CI declares no Node at all is not one this validator can vouch for.
 *
 *   node scripts/validate/ci-installs-with-the-npm-that-wrote-the-lock.mjs
 *   node scripts/validate/ci-installs-with-the-npm-that-wrote-the-lock.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOWS = ".github/workflows";

/**
 * Node major → the npm major it ships with. Extend when a new Node LTS lands; an unknown major is
 * a failure, not a pass, because "we do not know what npm this runs" is exactly the blind spot.
 */
export const BUNDLED_NPM_MAJOR = { 18: 9, 20: 10, 22: 10, 24: 11, 26: 11 };

export function declaredNpmMajor(pkg) {
  const range = pkg?.engines?.npm;
  if (typeof range !== "string") return null;
  const m = /(\d+)/.exec(range);
  return m ? Number(m[1]) : null;
}

/** Pure over { pkg, workflows: {path: yaml}, runningNpm: "11.17.0" } so the self-test drives the real code. */
export function check({ pkg, workflows, runningNpm }) {
  const bad = [];
  const want = declaredNpmMajor(pkg);
  if (want == null) {
    bad.push("package.json: engines.npm is not declared. The lock is written by one npm major and must be read by the same one; name it.");
    return bad;
  }

  const files = Object.keys(workflows);
  if (files.length === 0) bad.push(`${WORKFLOWS}: no workflow files found — nothing here to vouch for, and a repo with no CI is the silent form of this defect.`);

  let nodeLines = 0;
  for (const [file, yaml] of Object.entries(workflows)) {
    for (const line of yaml.split(/\r?\n/)) {
      const m = /^\s*node-version:\s*['"]?(\d+)/.exec(line);
      if (!m) continue;
      nodeLines += 1;
      const nodeMajor = Number(m[1]);
      const ships = BUNDLED_NPM_MAJOR[nodeMajor];
      if (ships == null) {
        bad.push(`${file}: node-version ${nodeMajor} is not in the bundled-npm table; add it to BUNDLED_NPM_MAJOR rather than guessing.`);
      } else if (ships !== want) {
        bad.push(`${file}: node-version ${nodeMajor} ships npm ${ships}, but engines.npm declares ${want}. `
          + `npm ${ships} will refuse the lock npm ${want} wrote ("Missing: ... from lock file") before any test runs.`);
      }
    }
  }
  if (files.length > 0 && nodeLines === 0) {
    bad.push(`${WORKFLOWS}: no \`node-version:\` in any workflow, so CI's npm is whatever the runner image happens to carry. Pin it.`);
  }

  const running = Number(/^(\d+)/.exec(String(runningNpm ?? ""))?.[1]);
  if (!Number.isFinite(running)) {
    bad.push("could not read the running npm version; a lock written by an unknown npm is not one CI is known to read.");
  } else if (running !== want) {
    bad.push(`this machine runs npm ${running}, engines.npm declares ${want}. A lock regenerated here will not install in CI; `
      + `use Node ${Object.entries(BUNDLED_NPM_MAJOR).filter(([, n]) => n === want).map(([k]) => k).join("/")} (or \`npm i -g npm@${want}\`) before touching package-lock.json.`);
  }
  return bad;
}

function loadWorkflows() {
  const dir = join(ROOT, WORKFLOWS);
  if (!existsSync(dir)) return {};
  const out = {};
  for (const f of readdirSync(dir)) if (/\.ya?ml$/.test(f)) out[`${WORKFLOWS}/${f}`] = readFileSync(join(dir, f), "utf8");
  return out;
}

function runningNpmVersion() {
  try { return execFileSync("npm", ["-v"], { encoding: "utf8" }).trim(); } catch { return null; }
}

const realInput = () => ({
  pkg: JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")),
  workflows: loadWorkflows(),
  runningNpm: runningNpmVersion(),
});

// ─── Self-test ───────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  const real = realInput();
  let failed = 0;
  const expect = (name, cond) => { if (cond) console.log(`  ✓ ${name}`); else { console.error(`  ✗ self-test: ${name}`); failed += 1; } };
  const ok = { pkg: { engines: { npm: ">=11" } }, workflows: { "ci.yml": "    with:\n      node-version: 24\n" }, runningNpm: "11.17.0" };

  expect("a declared npm 11 with Node 24 CI and npm 11 locally passes", check(ok).length === 0);
  expect("the break of 2026-09-12 — Node 22 CI against an npm-11 lock — is caught",
    check({ ...ok, workflows: { "ci.yml": "      node-version: 22\n" } }).length > 0);
  expect("a quoted node-version is still read",
    check({ ...ok, workflows: { "ci.yml": "      node-version: '22'\n" } }).length > 0);
  expect("one good job and one bad job in the same file is caught",
    check({ ...ok, workflows: { "ci.yml": "      node-version: 24\n      node-version: 22\n" } }).length > 0);
  expect("a missing engines.npm is caught", check({ ...ok, pkg: {} }).length > 0);
  expect("a Node major not in the table is a failure, not a pass",
    check({ ...ok, workflows: { "ci.yml": "      node-version: 99\n" } }).length > 0);
  expect("zero workflow files is a hard fail (RULE 0)", check({ ...ok, workflows: {} }).length > 0);
  expect("workflows with no node-version at all is a hard fail (RULE 0)",
    check({ ...ok, workflows: { "ci.yml": "on: push\n" } }).length > 0);
  expect("the wrong local npm is caught before it can write a lock CI cannot read",
    check({ ...ok, runningNpm: "10.9.9" }).length > 0);
  expect("an unreadable local npm is a failure", check({ ...ok, runningNpm: null }).length > 0);
  expect("the real repo passes", check(real).length === 0);

  if (failed) { console.error(`CI/LOCK npm PARITY SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("CI/LOCK npm PARITY SELF-TEST PASSED");
  process.exit(0);
}

const bad = check(realInput());
if (bad.length) {
  console.error("CI INSTALLS WITH A DIFFERENT npm THAN WROTE THE LOCK:");
  for (const b of bad) console.error(`  - ${b}`);
  process.exit(1);
}
console.log("ci/lock npm parity: engines.npm declared, every workflow's Node ships it, and so does this machine.");
