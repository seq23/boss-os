#!/usr/bin/env node
/**
 * EVERY BOSS OS ENDPOINT SHOULD BE REACHABLE FROM THE INTERFACE.
 *
 * WHY THIS EXISTS. Boss OS v20's Phase 7 opens with "about a third of the existing API has no
 * screen". Measured on 6 Sep 2026 it was worse than that: 104 of 237 methods on `api` were not
 * called by any page or component. A backend that works and cannot be reached is indistinguishable,
 * from the owner's chair, from one that does not work - and this repo's own history has the
 * canonical example of the confusion that causes: "959 tests pass and none of the buttons work".
 *
 * RATCHETED, NOT ZERO. A hundred screens cannot honestly be produced in one pass, and most of those
 * hundred methods do not deserve a screen of their own. A validator demanding zero would be
 * switched off in a week, which is how the repo ended up with `lists-speak-while-loading.mjs`
 * sitting in the tree with nothing invoking it. So the rule is: the number may FALL, never rise.
 * Adding an endpoint without a way to reach it fails the build; removing the last caller of one
 * fails the build; wiring one up lowers the ceiling and the ceiling never goes back up.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. That a reachable method is reachable USEFULLY, or that the
 * screen calling it is any good. It proves a path exists from the interface to the endpoint, which
 * is the thing that was absent, and nothing more.
 *
 *   node scripts/validate/api-has-a-screen.mjs
 *   node scripts/validate/api-has-a-screen.mjs --self-test
 *   node scripts/validate/api-has-a-screen.mjs --list      # print the current orphans
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const API = "src/client/boss/api.ts";
const CONSUMER_DIR = "src/client/boss";

/**
 * THE CEILING. Lower it when you wire something up; never raise it.
 *
 * 100 was the count on 6 Sep 2026 before Phase 7's screens; 89 after wiring the router, the
 * intake gate, vault restore and the audit/spend ledger; 86 after Stage 3's dispatch surface,
 * whose Watch screen reads a task's live state and offers cancel and requeue — so `task`,
 * `cancelTask` and `requeueTask` have a way in for the first time. Stage 3's own five methods and
 * the spend lever's two were wired the day they were written and never counted here at all.
 *
 * 79 on 9 Sep 2026, after the People tab was scrapped. The count fell by SEVEN rather than rising by
 * ten: deleting the screen orphaned sixteen `/relationships/*` methods, and every one of them was
 * deleted with it rather than left behind as a comment. The endpoints and the data are untouched —
 * `contacts-sync.mjs` still posts to the sync route and `people-worth-a-call.mjs` reads the same
 * correspondence locally — but nothing in the interface pretends to reach them any more.
 *
 * A note for the next person who removes a screen: the honest move is this one. Keeping the client
 * methods would have left the ceiling where it was and the interface a liar.
 *
 * If you are reading this
 * because the build failed and you are tempted to raise the number: the failure is telling you that
 * an endpoint has no way in, which is the whole point.
 */
const CEILING = 79;

/**
 * Names that appear at the same indentation as an API method but are not one.
 *
 * `constructor` belongs to ApiError; the other three are parameters of `captureOffline`. Listed
 * explicitly rather than filtered by a cleverer regex, because a parser that silently drops things
 * it does not understand under-reports, and under-reporting is the failure mode that matters here.
 */
const NOT_METHODS = new Set(["constructor", "attempt", "kind", "payload"]);

/** Every method declared on the exported `api` object. */
export function apiMethods(source) {
  const start = source.indexOf("export const api = {");
  if (start === -1) throw new Error(`${API}: could not find "export const api = {"`);
  const body = source.slice(start);
  const names = [...body.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9_]*)\s*:/gm)].map((m) => m[1]);
  return [...new Set(names)].filter((n) => !NOT_METHODS.has(n));
}

/** Methods no page, component or hook calls. */
export function orphansIn(methods, consumerSource) {
  return methods.filter((name) => !new RegExp(`\\b${name}\\s*\\(`).test(consumerSource));
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function readConsumers() {
  return walk(join(ROOT, CONSUMER_DIR))
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith("api.ts"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

// ─── Self-test ────────────────────────────────────────────────────────────────

const FIXTURES = [
  {
    name: "a method called from a page is not an orphan",
    api: `export const api = {\n  today: () => call("/today"),\n};`,
    consumers: `const d = await api.today();`,
    expect: [],
  },
  {
    name: "a method nothing calls IS an orphan",
    api: `export const api = {\n  today: () => call("/today"),\n  restore: () => call("/restore"),\n};`,
    consumers: `const d = await api.today();`,
    expect: ["restore"],
  },
  {
    name: "a method merely MENTIONED is still an orphan",
    // The trap: a name in a comment, a string or a type is not a way for a person to reach the
    // endpoint. Matching on the bare name would call this wired up.
    api: `export const api = {\n  restore: () => call("/restore"),\n};`,
    consumers: `// TODO: build a screen for restore\nconst label = "restore";`,
    expect: ["restore"],
  },
  {
    name: "ApiError's constructor is not an API method",
    api: `export const api = {\n  today: () => call("/today"),\n};`,
    consumers: `api.today();`,
    expect: [],
    extraApi: `export class ApiError extends Error {\n  constructor(m) { super(m); }\n}\n`,
  },
  {
    name: "nested object keys are not top-level methods",
    // Only two-space indentation counts. A key inside a nested literal is at four and must not be
    // read as an endpoint, or the count inflates and the ratchet becomes meaningless.
    api: `export const api = {\n  today: () => call("/today", {\n    headers: { x: 1 },\n  }),\n};`,
    consumers: `api.today();`,
    expect: [],
  },
];

function selfTest() {
  let failures = 0;
  for (const f of FIXTURES) {
    const methods = apiMethods((f.extraApi ?? "") + f.api);
    const got = orphansIn(methods, f.consumers);
    const ok = JSON.stringify(got) === JSON.stringify(f.expect);
    if (!ok) {
      failures += 1;
      console.error(`  ✗ ${f.name}\n      expected ${JSON.stringify(f.expect)}, got ${JSON.stringify(got)}`);
    }
  }
  if (failures) {
    console.error(`\nSELF-TEST FAILED: ${failures}/${FIXTURES.length}`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASSED: ${FIXTURES.length}/${FIXTURES.length} cases`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const methods = apiMethods(readFileSync(join(ROOT, API), "utf8"));
const orphans = orphansIn(methods, readConsumers());

if (process.argv.includes("--list")) {
  console.log(orphans.join("\n"));
  process.exit(0);
}

if (orphans.length > CEILING) {
  console.error(
    `API REACHABILITY FAILED: ${orphans.length} of ${methods.length} api methods have no screen, ` +
      `and the ceiling is ${CEILING}.\n`,
  );
  console.error("Endpoints with no way in:\n" + orphans.map((o) => `  - ${o}`).join("\n"));
  console.error(
    "\nA backend nobody can reach is indistinguishable from one that does not work. Either give it\n" +
      "a way in, or delete it. Do NOT raise the ceiling — it only goes down.",
  );
  process.exit(1);
}

if (orphans.length < CEILING) {
  console.error(
    `API REACHABILITY: ${orphans.length} orphans, below the ceiling of ${CEILING}.\n\n` +
      `Lower CEILING in ${"scripts/validate/api-has-a-screen.mjs"} to ${orphans.length} so the ground you\n` +
      `just gained cannot be given back.`,
  );
  process.exit(1);
}

console.log(
  `API REACHABILITY PASSED: ${orphans.length} of ${methods.length} api methods have no screen, ` +
    `at the ceiling of ${CEILING}. The count may fall; it may never rise.`,
);
