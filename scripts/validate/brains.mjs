#!/usr/bin/env node
/**
 * BRAINS ARE WHOLE, SKELETON-ONLY IN GIT, READ BY SOMEONE, AND PRIVATE SPANS CANNOT LEAK.
 *
 *   1. The migration seeds exactly the brains of `BRAINS`, each body exactly `seedFor(slug, title)`.
 *      The repo is public: a seed carrying real content (or a ninth business) fails the build.
 *   2. Every employee named in `EMPLOYEE_BRAINS` is a real employee id in the migrations, every slug
 *      it names is a real brain, and every brain is read by at least one employee ("exists but
 *      nothing reads it" is a defect).
 *   3. `stripConfidential` cuts closed, unclosed and repeated spans, and the three exits a model
 *      request can take (the router, the dispatch row, the claim hand-over) all call the cut.
 *
 *   node scripts/validate/brains.mjs
 *   node scripts/validate/brains.mjs --self-test     # breaks each check and watches it fail
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as B from "../../src/shared/boss/brains/brain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

export function seededBrains(sql) {
  const at = sql.indexOf("INSERT OR IGNORE INTO brains");
  if (at < 0) return [];
  const block = sql.slice(at, sql.indexOf(";\n", at));
  const out = [];
  const re = /\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/g;
  for (const m of block.matchAll(re)) out.push({ slug: m[1].replace(/''/g, "'"), title: m[2].replace(/''/g, "'"), body: m[3].replace(/''/g, "'") });
  return out;
}

export function checkSeeds(seeds, brains = B.BRAINS) {
  const problems = [];
  if (!seeds.length) problems.push("no brain is seeded");
  const want = new Map(brains.map((b) => [b.slug, b.title]));
  for (const s of seeds) {
    if (!want.has(s.slug)) problems.push(`seeded brain "${s.slug}" is not one of the ${brains.length}`);
    else if (s.body !== B.seedFor(s.slug, want.get(s.slug))) problems.push(`seeded brain "${s.slug}" is not the bare skeleton (the repo is public)`);
  }
  for (const b of brains) if (!seeds.some((s) => s.slug === b.slug)) problems.push(`brain "${b.slug}" is not seeded`);
  return problems;
}

export function checkReaders(map, employeeIds, slugs = B.BRAIN_SLUGS) {
  const problems = [];
  // The team doc is read by everyone, as the who's-who excerpt (brainBlockFor → whosWhoBlock).
  const read = new Set([B.TEAM_SLUG]);
  for (const [emp, v] of Object.entries(map)) {
    if (!employeeIds.has(emp)) problems.push(`${emp} reads brains but is not an employee`);
    const list = v === "all" ? [...B.BUSINESS_SLUGS] : v === "all+personal" ? [...slugs] : v;
    for (const s of list) { if (!slugs.includes(s)) problems.push(`${emp} reads "${s}", which is not a brain`); read.add(s); }
  }
  for (const s of slugs) if (!read.has(s)) problems.push(`nobody reads the "${s}" brain`);
  return problems;
}

export function checkStrip(strip) {
  const problems = [];
  const cases = [
    ["a <!-- confidential -->LP Alpha<!-- /confidential --> b", "LP Alpha"],
    ["x <!--confidential--> fund terms with no close", "fund terms"],
    ["<!-- confidential -->one<!-- /confidential --> and <!-- CONFIDENTIAL -->two<!-- /confidential -->", "two"],
  ];
  for (const [input, secret] of cases) {
    const out = strip(input);
    if (out.includes(secret) || /confidential\s*-->/i.test(out)) problems.push(`the cut left "${secret}" in: ${JSON.stringify(out)}`);
  }
  return problems;
}

export function checkExits(files) {
  const problems = [];
  if (!/stripConfidential\(m\.content\)/.test(files.router)) problems.push("the router does not cut private spans from every message");
  if (!/deepStrip\(built\)/.test(files.dispatch)) problems.push("the dispatch row is not cut for a seat other than Claude's");
  if (!/deepStrip\(requested\)/.test(files.claim)) problems.push("a run handed down to another seat at claim is not cut");
  return problems;
}

function employeeIds() {
  const ids = new Set();
  for (const f of readdirSync(join(ROOT, "migrations")).filter((x) => x.endsWith(".sql"))) {
    for (const m of read(`migrations/${f}`).matchAll(/\('(emp_[a-z_]+)'/g)) ids.add(m[1]);
  }
  return ids;
}

function realFiles() {
  return {
    router: read("src/worker/boss/router/index.ts"),
    dispatch: read("src/worker/boss/backends/dispatch.ts"),
    claim: read("src/worker/boss/routes/backends.ts"),
  };
}

function runReal() {
  const sql = read("migrations/0323_boss_brains.sql");
  return [
    ...checkSeeds(seededBrains(sql)),
    ...checkReaders(B.EMPLOYEE_BRAINS, employeeIds()),
    ...checkStrip(B.stripConfidential),
    ...checkExits(realFiles()),
  ];
}

function selfTest() {
  const sql = read("migrations/0323_boss_brains.sql");
  const seeds = seededBrains(sql);
  const files = realFiles();
  const broken = [
    ["a seed with real content", checkSeeds(seeds.map((s, i) => (i === 0 ? { ...s, body: s.body.replace("[MISSING]", "We sell X").replace("Write the roster", "Monique owns X") } : s)))],
    ["a missing seed", checkSeeds(seeds.slice(1))],
    ["an employee who does not exist", checkReaders({ ...B.EMPLOYEE_BRAINS, emp_nobody: ["spry"] }, employeeIds())],
    ["a brain nobody reads", checkReaders({ emp_research: ["porch-and-party"] }, employeeIds())],
    ["a cut that only removes the marks", checkStrip((t) => String(t).replace(/<!--\s*\/?\s*confidential\s*-->/gi, ""))],
    ["a router that forgot the cut", checkExits({ ...files, router: files.router.replace(/stripConfidential\(m\.content\)/g, "m.content") })],
    ["a claim that forgot the cut", checkExits({ ...files, claim: files.claim.replace(/deepStrip\(requested\)/g, "requested") })],
  ];
  let bad = 0;
  for (const [name, problems] of broken) {
    if (!problems.length) { console.error(`SELF-TEST FAILED: "${name}" was not caught`); bad++; }
  }
  if (bad) process.exit(1);
  console.log(`BRAINS SELF-TEST OK — ${broken.length} broken shapes caught`);
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const problems = runReal();
  if (problems.length) { for (const p of problems) console.error(`BRAINS: ${p}`); process.exit(1); }
  console.log(`BRAINS OK — ${B.BRAINS.length} skeleton seeds, ${Object.keys(B.EMPLOYEE_BRAINS).length} employees mapped, every brain read, private spans cut at all three exits`);
}
