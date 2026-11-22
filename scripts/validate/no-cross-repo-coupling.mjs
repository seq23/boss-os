#!/usr/bin/env node
/**
 * no-cross-repo-coupling.mjs — static Network OS boundary scan (P9,
 * `npm run validate:network-boundary`).
 *
 * Proves, by construction, that this Worker never couples to another system's storage. No source
 * file under src/ may contain
 *   (a) a filesystem/SQLite path into a sibling repo or DB file
 *       (network-os, agency-event-os, secondaries, *.sqlite/*.db),
 *   (b) a binding that is not this Worker's own (WP_OS_*, the Boss OS subtree's names, or one of
 *       the declared non-storage settings below),
 *   (c) a Network OS hostname or API base.
 * Until 22 Nov 2026 the copied West Peek fund code held one declared Network OS adapter
 * (services/networkAdapter.ts). It went with the chassis; West Peek OS owns that crossing now, so
 * no file here may name a Network OS host at all.
 *
 * The scan FAILS LOUDLY (exit 1, named violations). `--self-test` feeds synthetic
 * violating sources through the same check function and asserts they are caught.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC_DIR = path.join(ROOT, "src");

const SIBLING_REPO_PATH = /(west-peek-network-os|agency-event-os|seq23\/secondaries|\.\.\/\.\.\/\.\.\/[a-z-]*network)/i;

/**
 * ─── THE ONE FILE THAT MAY NAME A PARTNER REPO, BECAUSE IT NAMES IT TO REFUSE IT ───────────────
 *
 * `src/shared/boss/grid.mjs` is the grid: the repos she cares about for making money, AND the ones
 * that are out of scope. The exclusion list carries `west-peek`, `agency-event-os` and `secondaries`
 * by name, with a reason each.
 *
 * NAMING A REPOSITORY IN ORDER TO REFUSE IT IS THE OPPOSITE OF COUPLING, and the incident behind it
 * is the reason it has to be by name: on 29 August 2026 an agent working "portfolio-wide" branched
 * and merged into `west-peek-network-os` under a scope that had merely OMITTED it. An exclusion that
 * is only an absence is picked up again by the next scope that says "all her repos" and nothing
 * objects. So this scan would have been forcing the weaker of the two designs.
 *
 * THE EXEMPTION IS NARROW AND IT BUYS A STRICTER RULE, NOT A LOOSER ONE. The grid may name a repo;
 * it may never carry a PATH into one, an import from one, or a database file belonging to one —
 * checked immediately below, and harder than the general rule, because this is the one file whose
 * whole subject is other repositories.
 */
const EXCLUSION_REGISTRY = "src/shared/boss/grid.mjs";
const PATH_INTO_A_REPO = /(\.\.\/\.\.\/\.\.\/|~\/GitHub\/|\/Users\/[a-z]+\/GitHub\/)/i;
const FOREIGN_DB_FILE = /["'`][^"'`]*\.(sqlite3?|db)["'`]/i;
const FOREIGN_BINDING = /env\.(?!WP_OS_)(?:[A-Z][A-Z0-9_]{2,})\b/;
/**
 * Bindings that are NOT storage but are part of the declared environment (src/worker/env.ts).
 * Any binding outside this list, WP_OS_* and the Boss OS subtree is still a violation.
 * - ASSETS: the static SPA fetcher.
 * - CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET: this Worker's OWN Cloudflare Access service
 *   token, so its browser client can open its own pages. Platform-named, so neither can carry a
 *   WP_OS_ prefix; reachable only from effects/browserClient.ts and only for hosts isOwnHost()
 *   accepts.
 * - BOSS_EXTRA_OWNER_SENDERS: Boss intake's own private sender configuration, also read through
 *   process.env by Mac callers. A declared setting, not another system's storage.
 */
const DECLARED_NON_STORAGE_BINDINGS = /env\.(ASSETS|CF_ACCESS_CLIENT_ID|CF_ACCESS_CLIENT_SECRET|BOSS_EXTRA_OWNER_SENDERS)\b/;
const NETWORK_OS_HOST = /(network-os[a-z0-9.-]*\.(?:com|dev|net|io|workers\.dev)|api\.westpeeknetwork)/i;

function listSourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs|jsx)$/.test(entry.name)) out.push(full);
    }
  };
  walk(SRC_DIR);
  return out;
}

/**
 * Strip `//` line comments and block comments. Comments cannot couple anything —
 * naming a partner repository as PROVENANCE (e.g. "ported from seq23/secondaries")
 * is exactly what the plan asks for; only executable references are violations.
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
}

/**
 * Run all checks over a map of { relativePath: source }. Returns violation strings.
 * Pure — the same function scans the real tree and the self-test fixtures.
 */
/**
 * The ported Boss OS subtree, and the one file allowed to translate for it.
 *
 * WHAT THIS RULE IS FOR. "Only WP_OS_* bindings exist" catches a file reaching for storage that
 * belongs to another system - the failure where one repository quietly opens another's database.
 * Boss OS's `DB`, `VAULT`, `SESSIONS` and `TASKS` are not another system's storage. They are the
 * names the ported artifact was written against, and every one of them resolves to THIS Worker's
 * own WP_OS_* binding, translated in exactly one place.
 *
 * WHY NOT JUST RENAME THEM. It would touch all 64 ported files to change nothing observable, and
 * it would destroy the property that makes the port auditable: that the subtree still matches the
 * artifact it came from, line for line.
 *
 * THE RULE IS NARROWED, NOT DROPPED. Outside the subtree exactly one file may name a Boss binding,
 * and it is the mount. If a second one appears, that is a translation happening somewhere it can
 * no longer be reviewed in one place, and the scan below still fails on it.
 */
const BOSS_SUBTREE = "src/worker/boss/";
const BOSS_MOUNT = "src/worker/bossMount.ts";

export function checkSources(files) {
  const violations = [];
  for (const [rel, rawSource] of Object.entries(files)) {
    const source = stripComments(rawSource);
    if (rel === EXCLUSION_REGISTRY) {
      /*
       * It may NAME them. It may not REACH them: no relative path out of the tree, no `~/GitHub`,
       * no absolute path into a checkout. A list of repositories to stay out of that contained a
       * path into one would be the coupling this scan exists to stop, hiding inside the guard
       * against it.
       */
      const reach = source.match(PATH_INTO_A_REPO);
      if (reach) {
        violations.push(
          `${rel}: carries a filesystem path into another repository ("${reach[0]}"). The grid names ` +
          `repositories so that they can be refused; a path into one is the coupling itself.`,
        );
      }
    } else if (SIBLING_REPO_PATH.test(source)) {
      violations.push(`${rel}: reference to a partner repository path (cross-repo coupling; D5 forbids direct access)`);
    }
    if (FOREIGN_DB_FILE.test(source)) {
      violations.push(`${rel}: literal database file path (no system may open another system's storage)`);
    }
    if (NETWORK_OS_HOST.test(source)) {
      violations.push(`${rel}: Network OS hostname (West Peek OS owns that crossing; nothing here may call it)`);
    }
    // Remove the declared non-storage bindings before looking for a foreign one, so a
    // legitimate credential reference cannot mask an illegitimate storage binding later in
    // the same file.
    const withoutDeclared = source.replace(new RegExp(DECLARED_NON_STORAGE_BINDINGS.source, "g"), " ");
    const foreignBinding = withoutDeclared.match(FOREIGN_BINDING);
    const bossTranslates = rel.startsWith(BOSS_SUBTREE) || rel === BOSS_MOUNT;
    if (foreignBinding && !bossTranslates) {
      violations.push(`${rel}: non-West-Peek binding ${foreignBinding[0]} (only WP_OS_* bindings exist)`);
    }
  }
  return violations;
}

function scanRealTree() {
  const files = {};
  for (const full of listSourceFiles()) {
    const rel = path.relative(ROOT, full).split(path.sep).join("/");
    files[rel] = readFileSync(full, "utf8");
  }
  return files;
}

function selfTest() {
  const clean = {
    "src/worker/index.ts": "await env.WP_OS_DB.prepare('SELECT 1').first();\nreturn env.ASSETS.fetch(request);",
    "src/worker/boss/router/openrouter.ts": "const key = env.OPENROUTER_API_KEY;\nawait env.DB.prepare('SELECT 1').first();",
    // A declared non-storage setting is not another system's storage.
    "src/worker/effects/browserClient.ts": "const id = env.CF_ACCESS_CLIENT_ID;",
    // Boss intake's own private sender configuration, also read by Mac-side Node callers.
    "src/shared/boss/intake/mail.mjs": "const extra = process.env.BOSS_EXTRA_OWNER_SENDERS;",
    /*
     * THE GRID NAMES WHAT IS OUT OF SCOPE, AND NAMING IS NOT COUPLING. An exclusion that is merely
     * an absence is picked up again by the next scope that says "all her repos" — which is exactly
     * how an agent came to branch and merge into west-peek-network-os on 29 Aug 2026.
     */
    "src/shared/boss/grid.mjs": 'export const EXCLUDED = [{ match: "west-peek", why: "A different business." }, { match: "agency-event-os", why: "Out of scope." }];',
  };
  const failures = [];
  if (checkSources(clean).length !== 0) failures.push("clean fixture was flagged");

  const cases = {
    "partner repo path": { ...clean, "src/worker/services/sneaky.ts": 'const db = open("../../west-peek-network-os/data/app.db");' },
    "database file literal": { ...clean, "src/worker/services/sneaky.ts": 'const p = "/var/data/contacts.sqlite";' },
    // The exemption buys a STRICTER rule for that one file, not a looser one: it may name a repo
    // and may never carry a path into one.
    "the exclusion registry carrying a path into a repo": {
      ...clean,
      "src/shared/boss/grid.mjs": 'export const HOME = "~/GitHub/west-peek-network-os";',
    },
    "the exclusion registry reaching out of the tree": {
      ...clean,
      "src/shared/boss/grid.mjs": 'import x from "../../../west-peek-network-os/lib.mjs";',
    },
    "foreign binding": { ...clean, "src/worker/services/sneaky.ts": "await env.NETWORK_OS_DB.prepare('SELECT 1').all();" },
    "a Network OS hostname anywhere": { ...clean, "src/worker/services/sneaky.ts": 'await get("https://network-os.example.com/api/contacts");' },
    // A declared setting must not become a hiding place for a storage binding.
    "foreign storage binding alongside a declared setting": {
      ...clean,
      "src/worker/effects/browserClient.ts": "const id = env.CF_ACCESS_CLIENT_ID;\nawait env.PARTNER_DB.prepare('SELECT 1').all();",
    },
    "a retired fund-code credential outside the Boss OS subtree": {
      ...clean,
      "src/worker/services/sneaky.ts": "const k = env.OPENROUTER_API_KEY;",
    },
    "foreign storage alongside the owner sender setting": {
      ...clean,
      "src/shared/boss/intake/mail.mjs": "const extra = process.env.BOSS_EXTRA_OWNER_SENDERS;\nawait env.PARTNER_DB.prepare('SELECT 1').all();",
    },
    "an undeclared setting with the owner sender prefix": {
      ...clean,
      "src/shared/boss/intake/mail.mjs": "const extra = env.BOSS_EXTRA_OWNER_SENDERS_DB;",
    },
  };
  for (const [name, files] of Object.entries(cases)) {
    if (checkSources(files).length === 0) failures.push(`violating fixture NOT caught: ${name}`);
  }
  return { failures, caseCount: Object.keys(cases).length };
}

if (process.argv.includes("--self-test")) {
  const { failures, caseCount } = selfTest();
  if (failures.length > 0) {
    console.error("SELF-TEST FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASSED: clean fixture passes; all ${caseCount} violating fixtures are caught.`);
  process.exit(0);
}

const realTree = scanRealTree();
const scannedCount = Object.keys(realTree).length;
// A scan that finds nothing to check is not a pass — it is a scan that stopped reaching its own
// target. Reproduced 2026-09: pointing the scan at an empty directory still printed "NETWORK
// BOUNDARY SCAN PASSED" having examined zero files. Guard on the count, not just the content.
if (scannedCount === 0) {
  console.error(`NETWORK BOUNDARY SCAN FAILED — examined 0 source files under ${path.relative(ROOT, SRC_DIR)}.`);
  console.error("A scan that checks nothing is not a passing scan. Confirm SRC_DIR resolves to the real");
  console.error("source tree before trusting this result.");
  process.exit(1);
}
const violations = checkSources(realTree);
if (violations.length > 0) {
  console.error("NETWORK BOUNDARY SCAN FAILED — cross-repo coupling violations:");
  for (const v of violations) console.error(`  ✗ ${v}`);
  // What to do about it, for the same reason as the AI-boundary scan: the breach is only half the
  // message. D5 forbids one system reaching into another's storage or filesystem, not the crossing
  // itself — so the fix is nearly always "go through the adapter", not "give up on the data".
  console.error("\nAnything this Worker needs from a West Peek system comes through West Peek OS, which owns");
  console.error("that crossing. Never a partner repo path, never another system's database file, never a");
  console.error("binding that is not this Worker's own.");
  process.exit(1);
}
console.log("NETWORK BOUNDARY SCAN PASSED: no partner-repo paths, foreign DB files, foreign bindings, or Network OS hosts.");
