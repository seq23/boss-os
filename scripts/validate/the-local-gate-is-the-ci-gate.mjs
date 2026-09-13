#!/usr/bin/env node
/**
 * THE COMMAND THE DOCUMENTATION CALLS THE GATE IS THE GATE.
 *
 * ─── The defect, found by a red build ──────────────────────────────────────
 *
 * On 13 September 2026 a branch passed `npm run validate` end to end — both suites, 2,998 tests —
 * and CI went red on `validate:brand`: a `#000` in `styles.css`, in a stylesheet whose own header
 * says "There is not one hard-coded hex anywhere after [the token block]". The scan that catches
 * that has existed for weeks. It was simply not in the chain.
 *
 * Pulling the thread found the hole was two-way and much larger than one scan:
 *
 *   NINE scans ran ONLY in CI. A green local run could push a red build, and the round trip is
 *   twenty minutes. That is the failure that day.
 *
 *   THIRTY-EIGHT scans ran ONLY locally. A contributor who did not run the chain by hand could land
 *   a change that broke any of them with CI green throughout — which is the worse half, because
 *   nothing ever tells you.
 *
 * Neither set was a subset of the other and nothing compared them. Two components each keeping
 * their own list, with no link between them, and the list is THE GATE.
 *
 * ─── The rule ──────────────────────────────────────────────────────────────
 *
 *   1. EVERY `validate:*` CI RUNS IS IN `npm run validate`. Otherwise local green is not a
 *      prediction of CI green and the twenty-minute round trip becomes the feedback loop.
 *   2. EVERY REGISTERED SCAN RUNS IN CI. `validate:scans` is the union and CI runs it as one step,
 *      so a scan added to the chain is gated the day it is written rather than the day someone
 *      remembers to add a YAML block.
 *   3. `validate` IS `validate:scans` PLUS typecheck PLUS the tests. A chain that drifts back into
 *      a hand-maintained list of individual scans is this defect growing back.
 *
 * RULE 0: finding zero CI steps, or zero scans in the chain, is a HARD FAILURE — a comparison of
 * two empty lists agrees perfectly and proves nothing.
 *
 *   node scripts/validate/the-local-gate-is-the-ci-gate.mjs
 *   node scripts/validate/the-local-gate-is-the-ci-gate.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const PKG = "package.json";
const CI = ".github/workflows/ci.yml";

/** Every `validate:*` script a text mentions, in order, deduplicated. */
export function validatorsIn(text) {
  return [...new Set([...String(text).matchAll(/npm run (validate:[a-z0-9-]+)/g)].map((m) => m[1]))];
}

export function check({ pkg, ci }) {
  const problems = [];
  let scripts;
  try {
    scripts = JSON.parse(pkg).scripts ?? {};
  } catch {
    problems.push(`${PKG} is not readable JSON, so nothing here can be compared.`);
    return problems;
  }

  const chain = scripts.validate ?? "";
  const scans = scripts["validate:scans"] ?? "";
  const inScans = validatorsIn(scans);
  const inCi = validatorsIn(ci).filter((v) => v !== "validate:scans");

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (inScans.length === 0) {
    problems.push(`\`validate:scans\` names no validators. Two empty lists agree perfectly and prove nothing.`);
    return problems;
  }
  if (inCi.length === 0) {
    problems.push(`${CI} names no \`validate:*\` steps, so this comparison has nothing on the other side.`);
    return problems;
  }

  // ── 1. Everything CI runs is in the local gate ───────────────────────────
  for (const v of inCi) {
    if (!inScans.includes(v)) {
      problems.push(
        `CI runs \`${v}\` and \`npm run validate\` does not. A green local run then predicts nothing about ` +
        `CI, and the feedback loop becomes a twenty-minute round trip — which is exactly how a \`#000\` ` +
        `in the stylesheet reached a pull request.`,
      );
    }
  }

  // ── 2. Everything in the local gate runs in CI ───────────────────────────
  if (!/npm run validate:scans/.test(ci)) {
    problems.push(
      `${CI} does not run \`npm run validate:scans\`. Without it, every scan CI does not name ` +
      `individually is ungated — and it was thirty-eight of them.`,
    );
  }

  // ── 3. The chain is the scans plus typecheck plus the tests ──────────────
  if (!/npm run validate:scans/.test(chain)) {
    problems.push(
      `\`npm run validate\` does not run \`validate:scans\`. A chain that drifts back into a ` +
      `hand-maintained list of individual scans is this defect growing back.`,
    );
  }
  for (const step of ["npm run typecheck", "npm run test"]) {
    if (!chain.includes(step)) problems.push(`\`npm run validate\` no longer runs \`${step}\`.`);
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const good = {
    pkg: readFileSync(join(ROOT, PKG), "utf8"),
    ci: readFileSync(join(ROOT, CI), "utf8"),
  };
  const withoutBrandInScans = (() => {
    const p = JSON.parse(good.pkg);
    p.scripts["validate:scans"] = p.scripts["validate:scans"].replace(" && npm run validate:brand", "");
    return JSON.stringify(p, null, 2);
  })();

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "THE ACTUAL DEFECT: a scan CI runs that the local gate does not",
      input: { ...good, pkg: withoutBrandInScans },
      expect: 1,
    },
    {
      name: "CI no longer running the catch-all, leaving most scans ungated",
      input: { ...good, ci: good.ci.replace(/ *run: npm run validate:scans\n/, "") },
      expect: 1,
    },
    {
      name: "the chain going back to a hand-maintained list",
      input: {
        ...good,
        pkg: (() => {
          const p = JSON.parse(good.pkg);
          p.scripts.validate = "npm run validate:identity && npm run typecheck && npm run test";
          return JSON.stringify(p, null, 2);
        })(),
      },
      expect: 1,
    },
    {
      name: "the chain dropping the tests",
      input: {
        ...good,
        pkg: (() => {
          const p = JSON.parse(good.pkg);
          p.scripts.validate = "npm run validate:scans && npm run typecheck";
          return JSON.stringify(p, null, 2);
        })(),
      },
      expect: 1,
    },
    { name: "RULE 0 — no scans registered", input: { ...good, pkg: (() => { const p = JSON.parse(good.pkg); p.scripts["validate:scans"] = ""; return JSON.stringify(p, null, 2); })() }, expect: 1 },
    { name: "RULE 0 — no CI validator steps", input: { ...good, ci: "jobs:\n  build:\n    steps: []\n" }, expect: 1 },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.input).length;
    const okCase = c.expect === 0 ? found === 0 : found >= 1;
    if (!okCase) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }

  if (failed) {
    console.error(`\nthe-local-gate-is-the-ci-gate self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`the-local-gate-is-the-ci-gate self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missingFiles = [PKG, CI].filter((f) => !existsSync(join(ROOT, f)));
if (missingFiles.length) {
  console.error(`the-local-gate-is-the-ci-gate FAILED — ${missingFiles.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const pkg = readFileSync(join(ROOT, PKG), "utf8");
  const problems = check({ pkg, ci: readFileSync(join(ROOT, CI), "utf8") });

  if (problems.length) {
    console.error("the-local-gate-is-the-ci-gate FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  const scans = validatorsIn(JSON.parse(pkg).scripts["validate:scans"]);
  console.log(
    `the-local-gate-is-the-ci-gate: ${scans.length} registered scans, every one of them run by CI and by ` +
    `\`npm run validate\`. OK.`,
  );
}
