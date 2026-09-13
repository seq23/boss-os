#!/usr/bin/env node
/**
 * THE WRANGLER THE E2E SUITE BOOTS MUST SURVIVE ONE DROPPED CONNECTION.
 *
 * ─── The defect class this is the guard for ─────────────────────────────────
 *
 * On 2026-09-12 the Playwright job died twice in one CI run, at two unrelated points in the suite,
 * with `wrangler dev` printing an EMPTY error and then exiting:
 *
 *   ✘ [ERROR]
 *   If you think this is a bug then please create an issue at ...
 *
 * Everything after it was `ECONNREFUSED ::1:8787` — 26 journeys red for one event. The reason was
 * in a log file the runner throws away. Upstream it is cloudflare/workers-sdk#15317: when a
 * single proxied request to the user Worker rejects ("Network connection lost."), the ProxyWorker
 * posts a plain object across the worker boundary, `castErrorCause` wraps it in `new Error()` with
 * no message, and `DevEnv.handleErrorEvent` treats `"Error inside ProxyWorker"` as FATAL. A
 * transient network condition on a 2-core runner takes the whole dev server down. It is not
 * reproducible on a developer machine and it is not this repo's code: every frame is wrangler's.
 *
 * The upstream fix (workers-sdk#15252, merged 2026-09-07, first shipped in wrangler 4.129.1) adds
 * a branch that logs the failed request and keeps serving:
 *
 *   "Error inside ProxyWorker (the affected request failed; the dev server continues): ..."
 *
 * A wrangler below that line is one whose `wrangler dev` will, some run, die under a dropped
 * connection and turn one event into a red suite with no message. This makes such a downgrade —
 * a range edited back, a lock regenerated against an older resolution, an `npm install` that
 * quietly resolved lower — fail before push instead of some Tuesday in CI.
 *
 * ─── What is asserted ───────────────────────────────────────────────────────
 *
 *   1. `devDependencies.wrangler` in package.json has a floor at or above FIRST_SURVIVING.
 *   2. `package-lock.json` resolves the root `wrangler` at or above FIRST_SURVIVING.
 *   3. The wrangler actually installed in node_modules ships the surviving branch — the literal
 *      text wrangler prints when it keeps going. Version numbers say what was asked for; the
 *      shipped code says what will run.
 *
 * RULE 0: no package.json range, no lock entry, or no installed wrangler is a hard fail, never a
 * pass. "Nothing to check" is exactly the state in which the next crash is unexplained.
 *
 *   node scripts/validate/wrangler-dev-survives-a-dropped-connection.mjs
 *   node scripts/validate/wrangler-dev-survives-a-dropped-connection.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** First wrangler release whose `wrangler dev` survives a rejected proxy fetch (workers-sdk#15252). */
export const FIRST_SURVIVING = "4.129.1";

/** The exact text the surviving branch logs; its presence in the shipped CLI is the proof. */
export const SURVIVING_MARKER = "the affected request failed; the dev server continues";

export function parseVersion(v) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function atLeast(v, floor) {
  const a = parseVersion(v);
  const b = parseVersion(floor);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

/**
 * The lowest version a caret/tilde/>= range admits. Anything else (`*`, `latest`, a URL, a tag)
 * has no floor this can vouch for and is reported as such.
 */
export function rangeFloor(range) {
  if (typeof range !== "string") return null;
  const m = /^\s*(?:\^|~|>=)?\s*(\d+\.\d+\.\d+)\s*$/.exec(range);
  return m ? m[1] : null;
}

/** Pure over { pkg, lock, installedCli } so the self-test drives the real code. */
export function check({ pkg, lock, installedCli }) {
  const bad = [];

  const range = pkg?.devDependencies?.wrangler ?? pkg?.dependencies?.wrangler;
  if (typeof range !== "string") {
    bad.push("package.json: wrangler is not a declared dependency, so the e2e suite boots whatever happens to be on the machine.");
  } else {
    const floor = rangeFloor(range);
    if (!floor) {
      bad.push(`package.json: wrangler range "${range}" has no floor this can read; declare a caret range at or above ${FIRST_SURVIVING}.`);
    } else if (!atLeast(floor, FIRST_SURVIVING)) {
      bad.push(`package.json: wrangler range "${range}" admits ${floor}, below ${FIRST_SURVIVING} — a \`wrangler dev\` that dies, with an empty error, on one dropped connection (workers-sdk#15317).`);
    }
  }

  const locked = lock?.packages?.["node_modules/wrangler"]?.version;
  if (!locked) {
    bad.push("package-lock.json: no root node_modules/wrangler entry — the lock does not say which wrangler CI will boot.");
  } else if (!atLeast(locked, FIRST_SURVIVING)) {
    bad.push(`package-lock.json: wrangler resolves to ${locked}, below ${FIRST_SURVIVING}. Run \`npm install wrangler@^${FIRST_SURVIVING}\` with the npm engines.npm declares.`);
  }

  if (installedCli == null) {
    bad.push("node_modules/wrangler/wrangler-dist/cli.js is not installed or not readable; the shipped code is the only proof of what will run. `npm ci` first.");
  } else if (!installedCli.includes(SURVIVING_MARKER)) {
    bad.push(`the installed wrangler does not carry the surviving branch ("${SURVIVING_MARKER}"); its \`wrangler dev\` is fatal on a rejected proxy fetch.`);
  }

  return bad;
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

const realInput = () => {
  const cli = join(ROOT, "node_modules", "wrangler", "wrangler-dist", "cli.js");
  return {
    pkg: readJson(join(ROOT, "package.json")),
    lock: existsSync(join(ROOT, "package-lock.json")) ? readJson(join(ROOT, "package-lock.json")) : null,
    installedCli: existsSync(cli) ? readFileSync(cli, "utf8") : null,
  };
};

// ─── Self-test ───────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  const real = realInput();
  let failed = 0;
  const expect = (name, cond) => { if (cond) console.log(`  ✓ ${name}`); else { console.error(`  ✗ self-test: ${name}`); failed += 1; } };
  const ok = {
    pkg: { devDependencies: { wrangler: "^4.131.1" } },
    lock: { packages: { "node_modules/wrangler": { version: "4.131.1" } } },
    installedCli: `logger2.error(\`\${event.reason} (${SURVIVING_MARKER}): \${detail}\`);`,
  };

  expect("a surviving range, lock and shipped CLI pass", check(ok).length === 0);
  expect("the exact floor passes", check({ ...ok, pkg: { devDependencies: { wrangler: `^${FIRST_SURVIVING}` } }, lock: { packages: { "node_modules/wrangler": { version: FIRST_SURVIVING } } } }).length === 0);
  expect("the range of 2026-09-12 (^4.42.0) is caught", check({ ...ok, pkg: { devDependencies: { wrangler: "^4.42.0" } } }).length > 0);
  expect("a lock resolving 4.120.1 — the one that died in CI — is caught", check({ ...ok, lock: { packages: { "node_modules/wrangler": { version: "4.120.1" } } } }).length > 0);
  expect("a shipped CLI without the surviving branch is caught even when the numbers look right",
    check({ ...ok, installedCli: "else this.emit(\"error\", event);" }).length > 0);
  expect("a range with no readable floor is a failure, not a pass", check({ ...ok, pkg: { devDependencies: { wrangler: "latest" } } }).length > 0);
  expect("a tilde range is read for its floor", check({ ...ok, pkg: { devDependencies: { wrangler: "~4.131.0" } } }).length === 0);
  expect("no wrangler dependency at all is a hard fail (RULE 0)", check({ ...ok, pkg: {} }).length > 0);
  expect("no lock entry is a hard fail (RULE 0)", check({ ...ok, lock: { packages: {} } }).length > 0);
  expect("no installed wrangler is a hard fail (RULE 0)", check({ ...ok, installedCli: null }).length > 0);
  expect("version comparison is numeric, not lexical (4.129.1 > 4.99.0)", atLeast("4.129.1", "4.99.0") && !atLeast("4.99.0", "4.129.1"));
  expect("the real repo passes", check(real).length === 0);

  if (failed) { console.error(`WRANGLER-DEV-SURVIVES SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("WRANGLER-DEV-SURVIVES SELF-TEST PASSED");
  process.exit(0);
}

const bad = check(realInput());
if (bad.length) {
  console.error("THE WRANGLER THIS REPO BOOTS WOULD DIE ON ONE DROPPED CONNECTION:");
  for (const b of bad) console.error(`  - ${b}`);
  process.exit(1);
}
console.log(`wrangler dev survives a dropped connection: range, lock and shipped CLI are all at or past ${FIRST_SURVIVING}.`);
