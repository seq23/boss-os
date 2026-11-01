#!/usr/bin/env node
/**
 * BRAINS ARE WHOLE, SKELETON-ONLY IN GIT, READ BY SOMEONE, AND PRIVATE SPANS CANNOT LEAK.
 *
 *   1. The migrations seed exactly the brains of `BRAINS` (plus the retired ones of `RETIRED_BRAINS`,
 *      whose rows stay as history), each body exactly `seedFor(slug, title-at-seed)`, and after every
 *      retitle (`UPDATE brains SET title`) each live brain carries its `BRAINS` title. The repo is
 *      public: a seed carrying real content, an extra brain, or a stale title fails the build.
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
  const out = [];
  let from = 0;
  for (;;) {
    const at = sql.indexOf("INSERT OR IGNORE INTO brains", from);
    if (at < 0) break;
    const end = sql.indexOf(";\n", at);
    const block = sql.slice(at, end < 0 ? undefined : end);
    const re = /\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/g;
    for (const m of block.matchAll(re)) out.push({ slug: m[1].replace(/''/g, "'"), title: m[2].replace(/''/g, "'"), body: m[3].replace(/''/g, "'") });
    from = end < 0 ? sql.length : end + 2;
  }
  return out;
}

/** Each slug's title after every `UPDATE brains SET title = '…' WHERE slug = '…'`, in file order. */
export function retitles(sql) {
  const out = new Map();
  for (const m of sql.matchAll(/UPDATE\s+brains\s+SET\s+title\s*=\s*'((?:[^']|'')*)'\s+WHERE\s+slug\s*=\s*'((?:[^']|'')*)'/gi)) {
    out.set(m[2].replace(/''/g, "'"), m[1].replace(/''/g, "'"));
  }
  return out;
}

export function checkSeeds(seeds, brains = B.BRAINS, titles = new Map(), retired = B.RETIRED_BRAINS) {
  const problems = [];
  if (!seeds.length) problems.push("no brain is seeded");
  const want = new Map(brains.map((b) => [b.slug, b.title]));
  for (const s of seeds) {
    const isRetired = Object.prototype.hasOwnProperty.call(retired, s.slug);
    if (!want.has(s.slug) && !isRetired) problems.push(`seeded brain "${s.slug}" is not one of the ${brains.length}`);
    else if (s.body !== B.seedFor(s.slug, s.title)) problems.push(`seeded brain "${s.slug}" is not the bare skeleton (the repo is public)`);
    else if (want.has(s.slug) && (titles.get(s.slug) ?? s.title) !== want.get(s.slug)) problems.push(`brain "${s.slug}" ends up titled "${titles.get(s.slug) ?? s.title}", not "${want.get(s.slug)}"`);
  }
  for (const b of brains) if (seeds.filter((s) => s.slug === b.slug).length !== 1) problems.push(`brain "${b.slug}" is seeded ${seeds.filter((s) => s.slug === b.slug).length} times, not once`);
  for (const [old, next] of Object.entries(retired)) {
    if (want.has(old)) problems.push(`retired brain "${old}" is still live`);
    if (!want.has(next)) problems.push(`retired brain "${old}" points at "${next}", which is not a live brain`);
    if (B.resolveBrainSlug(old) !== next) problems.push(`"${old}" does not resolve to "${next}"`);
  }
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

function allMigrationSql() {
  return readdirSync(join(ROOT, "migrations")).filter((x) => x.endsWith(".sql")).sort().map((f) => read(`migrations/${f}`)).join("\n");
}

function runReal() {
  const sql = allMigrationSql();
  return [
    ...checkSeeds(seededBrains(sql), B.BRAINS, retitles(sql)),
    ...checkReaders(B.EMPLOYEE_BRAINS, employeeIds()),
    ...checkStrip(B.stripConfidential),
    ...checkExits(realFiles()),
  ];
}

function selfTest() {
  const sql = allMigrationSql();
  const seeds = seededBrains(sql);
  const titles = retitles(sql);
  const files = realFiles();
  const broken = [
    ["a seed with real content", checkSeeds(seeds.map((s, i) => (i === 0 ? { ...s, body: s.body.replace("[MISSING]", "We sell X").replace("Write the roster", "Monique owns X") } : s)), B.BRAINS, titles)],
    ["a missing seed", checkSeeds(seeds.slice(1), B.BRAINS, titles)],
    ["a missing retitle", checkSeeds(seeds, B.BRAINS, new Map([...titles].filter(([k]) => k !== "spry")))],
    ["a retired brain that is still live", checkSeeds(seeds, B.BRAINS, titles, { ...B.RETIRED_BRAINS, spry: "brokerage" })],
    ["a retired brain pointing nowhere", checkSeeds(seeds, B.BRAINS, titles, { "industry-guides": "nowhere" })],
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
  console.log(`BRAINS OK — ${B.BRAINS.length} live brains seeded as skeletons and titled, ${Object.keys(B.RETIRED_BRAINS).length} retired kept as history, ${Object.keys(B.EMPLOYEE_BRAINS).length} employees mapped, every brain read, private spans cut at all three exits`);
}
