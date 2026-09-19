#!/usr/bin/env node
/**
 * EVERY GRID PROPERTY HAS EVERY READER WIRED, OR A NAMED REASON IT CANNOT BE.
 *
 * ─── Her words, 19 September 2026 ──────────────────────────────────────────
 *
 *   "Connect all the GSC and whatever else to measure the health and GitHub and all."
 *
 * ─── What this fails on ────────────────────────────────────────────────────
 *
 * The four readers — uptime, github, gsc, cloudflare — are a fixed set, and the grid is her twelve
 * properties. That is 48 cells, and each one has to be either WIRED (a real code path writes a
 * `property_health_readings` row for that reader) or CANNOT with a sentence. A cell that is neither
 * is a property whose health card would show a blank, and a blank is the one thing the card may
 * not show: "healthy" and "never looked" are opposite facts that look identical.
 *
 * "Wired" is checked against CODE, not against the registry's own claim about itself:
 *
 *   1. `src/shared/boss/propertyReaders.mjs` crosses every grid key with every reader (the module
 *      is imported and run, not grepped).
 *   2. Every reader the registry says runs in the WORKER is registered in `WORKER_READERS` in
 *      `health/readers.ts`, named as `worker_reader` by a `standing_duties` row in a migration
 *      with `executor = 'worker'`, and `materialise.ts` runs worker duties.
 *   3. Every reader the registry says runs on her MAC is produced by `scripts/ops/grid-watch.mjs`
 *      (`reader: "<name>"` appears in code) which posts to `/api/grid/health/readings`, a route
 *      that exists, is mounted, and writes the table.
 *   4. The readings table is created by a migration and read by `routes/gridHealth.ts`, and the
 *      client has a screen that calls `/grid/health`.
 *   5. Every CANNOT sentence is at least forty characters and names the property's situation —
 *      "n/a" is not a reason.
 *
 * RULE 0: zero properties or zero readers is a failure, not a pass.
 *
 *   node scripts/validate/every-property-has-its-readers.mjs
 *   node scripts/validate/every-property-has-its-readers.mjs --self-test
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const REGISTRY = "src/shared/boss/propertyReaders.mjs";
const READERS_TS = "src/worker/boss/health/readers.ts";
const MATERIALISE = "src/worker/boss/duties/materialise.ts";
const ROUTE = "src/worker/boss/routes/gridHealth.ts";
const INDEX = "src/worker/boss/index.ts";
const MAC = "scripts/ops/grid-watch.mjs";
const MIGRATIONS_DIR = "migrations";
const CLIENT_API = "src/client/boss/api.ts";
const CLIENT_CARD = "src/client/boss/components/PropertyHealth.tsx";
const TABLE = "property_health_readings";

const stripProse = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

/**
 * The scan. `registry` is what `readerRegistry()` returned; `files` maps path → text (so the
 * self-test can hand in fixtures without touching the tree).
 */
export function scan(registry, gridKeys, readers, files) {
  const problems = [];
  const has = (p) => typeof files[p] === "string";

  if (gridKeys.length === 0) problems.push("the grid has zero properties, so nothing was examined (Rule 0).");
  if (readers.length === 0) problems.push("the reader set is empty, so nothing was examined (Rule 0).");

  // 1. Every cell exists exactly once.
  for (const key of gridKeys) {
    for (const reader of readers) {
      const cells = registry.filter((c) => c.property_key === key && c.reader === reader);
      if (cells.length !== 1) { problems.push(`${key} × ${reader}: ${cells.length} registry cells (expected exactly one).`); continue; }
      const cell = cells[0];
      if (!cell.wired) {
        const why = String(cell.cannot ?? "").trim();
        if (why.length < 40) problems.push(`${key} × ${reader}: CANNOT with no real reason ("${why}"). Say what about this property stops the reader.`);
      }
    }
  }
  for (const c of registry) {
    if (!gridKeys.includes(c.property_key)) problems.push(`registry names "${c.property_key}", which is not a grid property.`);
    if (!readers.includes(c.reader)) problems.push(`registry names reader "${c.reader}", which is not one of the four.`);
  }

  // 2/3. Every WIRED reader has a code path, by where it runs.
  const readersCode = has(READERS_TS) ? stripProse(files[READERS_TS]) : "";
  const materialise = has(MATERIALISE) ? stripProse(files[MATERIALISE]) : "";
  const mac = has(MAC) ? stripProse(files[MAC]) : "";
  const migrations = Object.entries(files).filter(([p]) => p.startsWith(`${MIGRATIONS_DIR}/`)).map(([, t]) => t).join("\n");

  const wiredReaders = new Set(registry.filter((c) => c.wired).map((c) => c.reader));
  for (const reader of wiredReaders) {
    const runsOn = registry.find((c) => c.reader === reader)?.runs_on;
    if (runsOn === "worker") {
      if (!new RegExp(`^\\s*${reader}\\s*:`, "m").test(readersCode)) problems.push(`reader "${reader}" runs in the Worker and WORKER_READERS in ${READERS_TS} does not register it.`);
      const dutyRe = new RegExp(`'worker'[\\s\\S]{0,400}?'worker_reader'\\s*,\\s*'${reader}'`);
      if (!dutyRe.test(migrations)) problems.push(`reader "${reader}" runs in the Worker and no migration declares a standing duty with executor 'worker' naming it as worker_reader — nothing would ever run it.`);
      if (!/executor === "worker"/.test(materialise) || !/runWorkerReader\s*\(/.test(materialise)) problems.push(`${MATERIALISE} does not run worker duties, so "${reader}" is registered and never invoked.`);
    } else if (runsOn === "mac") {
      if (!new RegExp(`reader:\\s*"${reader}"`).test(mac)) problems.push(`reader "${reader}" runs on her Mac and ${MAC} never produces a reading with reader: "${reader}".`);
      if (!/\/api\/boss\/grid\/health\/readings/.test(mac)) problems.push(`${MAC} does not post to /api/boss/grid/health/readings, so the Mac readers land nowhere.`);
    } else {
      problems.push(`reader "${reader}" has runs_on "${runsOn}", which is neither worker nor mac.`);
    }
  }

  // 4. Table, route, mount, screen.
  if (!new RegExp(`CREATE TABLE ${TABLE}\\b`).test(migrations)) problems.push(`no migration creates ${TABLE}.`);
  if (!new RegExp(`INSERT INTO ${TABLE}\\b`).test(readersCode)) problems.push(`${READERS_TS} does not write INTO ${TABLE}.`);
  const route = has(ROUTE) ? stripProse(files[ROUTE]) : "";
  if (!new RegExp(`FROM ${TABLE}\\b`).test(route)) problems.push(`${ROUTE} does not read FROM ${TABLE}.`);
  if (!/post\("\/readings"/.test(route)) problems.push(`${ROUTE} has no POST /readings door for the Mac readers.`);
  const index = has(INDEX) ? stripProse(files[INDEX]) : "";
  if (!/app\.route\("\/api\/grid\/health",\s*gridHealth\)/.test(index)) problems.push(`${INDEX} does not mount gridHealth at /api/grid/health.`);
  const clientApi = has(CLIENT_API) ? files[CLIENT_API] : "";
  if (!/"\/grid\/health"/.test(clientApi)) problems.push(`${CLIENT_API} never calls /grid/health, so no screen can show the readings.`);
  if (!has(CLIENT_CARD) || !/propertyHealth\(\)/.test(files[CLIENT_CARD])) problems.push(`${CLIENT_CARD} is missing or does not call api.propertyHealth().`);

  return problems;
}

async function realInputs() {
  const { GRID_KEYS } = await import(join(ROOT, "src/shared/boss/grid.mjs"));
  const { READERS, readerRegistry } = await import(join(ROOT, REGISTRY));
  const { readdirSync } = await import("node:fs");
  const files = {};
  for (const p of [READERS_TS, MATERIALISE, ROUTE, INDEX, MAC, CLIENT_API, CLIENT_CARD]) if (existsSync(join(ROOT, p))) files[p] = read(p);
  for (const f of readdirSync(join(ROOT, MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql"))) files[`${MIGRATIONS_DIR}/${f}`] = read(`${MIGRATIONS_DIR}/${f}`);
  return { gridKeys: [...GRID_KEYS], readers: [...READERS], registry: readerRegistry(), files };
}

// ─── Self-test ────────────────────────────────────────────────────────────────

function selfTest(real) {
  const good = () => ({ registry: real.registry.map((c) => ({ ...c })), gridKeys: [...real.gridKeys], readers: [...real.readers], files: { ...real.files } });
  const cases = [
    { name: "the real tree passes", mutate: () => {}, want: 0 },
    { name: "a property missing a cell fails", mutate: (i) => { i.registry = i.registry.filter((c) => !(c.property_key === "hpc" && c.reader === "gsc")); }, want: 1 },
    { name: "a CANNOT with a throwaway reason fails", mutate: (i) => { const c = i.registry.find((x) => !x.wired); c.cannot = "n/a"; }, want: 1 },
    { name: "a registry key outside the grid fails", mutate: (i) => { i.registry.push({ property_key: "west_peek", reader: "uptime", runs_on: "worker", wired: true, cannot: null }); }, want: 1 },
    { name: "a Worker reader nobody registered fails", mutate: (i) => { i.files[READERS_TS] = i.files[READERS_TS].replace(/^\s*gsc\s*:/m, "  gsc_renamed:"); }, want: 1 },
    { name: "a Worker reader with no duty row fails", mutate: (i) => { for (const p of Object.keys(i.files)) if (p.startsWith("migrations/")) i.files[p] = i.files[p].replace(/'worker_reader',\s*'uptime'/g, "'worker_reader', 'uptime_x'"); }, want: 1 },
    { name: "materialise that never runs worker duties fails", mutate: (i) => { i.files[MATERIALISE] = i.files[MATERIALISE].replace(/executor === "worker"/g, 'executor === "worker_never"'); }, want: 1 },
    { name: "a Mac reader grid-watch never produces fails", mutate: (i) => { i.files[MAC] = i.files[MAC].replace(/reader: "cloudflare"/g, 'reader: "cf"'); }, want: 1 },
    { name: "grid-watch that posts nowhere fails", mutate: (i) => { i.files[MAC] = i.files[MAC].replace(/\/api\/boss\/grid\/health\/readings/g, "/nowhere"); }, want: 1 },
    { name: "a route that does not read the table fails", mutate: (i) => { i.files[ROUTE] = i.files[ROUTE].replace(/FROM property_health_readings/g, "FROM elsewhere"); }, want: 1 },
    { name: "an unmounted route fails", mutate: (i) => { i.files[INDEX] = i.files[INDEX].replace(/app\.route\("\/api\/grid\/health", gridHealth\)/, ""); }, want: 1 },
    { name: "no screen fails", mutate: (i) => { delete i.files[CLIENT_CARD]; }, want: 1 },
    { name: "an empty grid is Rule 0", mutate: (i) => { i.gridKeys = []; i.registry = []; }, want: 1 },
  ];
  let failed = 0;
  for (const c of cases) {
    const input = good();
    c.mutate(input);
    const got = scan(input.registry, input.gridKeys, input.readers, input.files);
    const ok = c.want === 0 ? got.length === 0 : got.length >= c.want;
    if (!ok) { failed += 1; console.error(`  ✗ ${c.name}: expected ${c.want === 0 ? "no problems" : "a failure"}, got ${JSON.stringify(got)}`); }
  }
  if (failed) { console.error(`\nSELF-TEST FAILED: ${failed} case(s)`); process.exit(1); }
  console.log(`SELF-TEST PASSED: ${cases.length}/${cases.length} cases.`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const real = await realInputs();
if (process.argv.includes("--self-test")) { selfTest(real); process.exit(0); }

const problems = scan(real.registry, real.gridKeys, real.readers, real.files);
if (problems.length > 0) {
  console.error("PROPERTY READERS SCAN FAILED:\n");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("\nA property × reader cell with neither a code path nor a named reason is a blank on her health card,\nand a blank cannot be told from \"healthy\". Wire it, or write down why it cannot be.");
  process.exit(1);
}
const wired = real.registry.filter((c) => c.wired).length;
console.log(`PROPERTY READERS SCAN PASSED: ${real.gridKeys.length} properties × ${real.readers.length} readers — ${wired} wired, ${real.registry.length - wired} cannot by name, 0 blank.`);
