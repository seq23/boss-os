#!/usr/bin/env node
/**
 * THE TWO BUSINESSES NEVER BLEND: NO BOSS OS SURFACE OR DUTY READS WEST PEEK'S FUND-LEVEL LP TOTALS.
 *
 * ─── Her words, 19 September 2026 ──────────────────────────────────────────
 *
 *   "I don't want it to track the LP stuff for West Peek on that tab — that's irrelevant here. I
 *    still want Monique to do her job of finding positive replies in my LP search — the LP search
 *    is my personal LP search, that's why she is doing it — but the overall amount of money raised
 *    and all that is not for Boss OS."
 *
 * ─── What this fails on ────────────────────────────────────────────────────
 *
 *   1. The return ledger enumerates a `west_peek` lane project. `RETURN_LINES` in
 *      `src/worker/boss/today/returns.ts` must filter the lane out, and the contribute door must
 *      check `LINE_KEYS` built from it — proven by IMPORTING the real module and reading the real
 *      list, not by grepping for the filter.
 *   2. Any Capital-tab source or the Worker's wealth/returns code carries fund-level wording:
 *      "capital committed", "LP emails sent", "amount raised", "LP pipeline", "commitments",
 *      "lp_tracker" (the tracker sheet as a returns source).
 *   3. A Mac contributor (`scripts/ops/line-returns.mjs`) reads the LP tracker sheet or posts a
 *      `west_peek_raise` line.
 *   4. Monique's personal LP-search duties are NOT gone — `duty_lp_replies` and `duty_lp_positive`
 *      are seeded and no migration suspends them. Removing the fund totals must never take her
 *      reply hunt with it; that is the half she said to keep.
 *
 * RULE 0: zero files scanned, or a projects list with no lanes, fails.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF_TEST = process.argv.includes("--self-test");

const SURFACES = [
  "src/client/boss/pages/Capital.tsx",
  "src/worker/boss/routes/wealth.ts",
  "src/worker/boss/routes/capital.ts",
  "src/worker/boss/today/returns.ts",
];
const CONTRIBUTORS = ["scripts/ops/line-returns.mjs"];
const FUND_WORDS = [
  /capital committed/i,
  /LP emails sent/i,
  /amount raised|money raised|raised to date/i,
  /LP pipeline/i,
  /\bcommitments?\s+(?:from|by)\s+LPs?\b/i,
  /["']lp_tracker["']/,
  /west_peek_raise/,
];
const KEEP_DUTIES = ["duty_lp_replies", "duty_lp_positive"];

/** The real return lines, from the real module, through tsx. */
function returnLanes(root) {
  const script = `
    import { RETURN_LINES, LINE_KEYS } from ${JSON.stringify(pathToFileURL(join(root, "src/worker/boss/today/returns.ts")).href)};
    import { PROJECTS } from ${JSON.stringify(pathToFileURL(join(root, "src/worker/boss/today/projects.ts")).href)};
    if (!Array.isArray(RETURN_LINES)) { console.log(JSON.stringify({ missing: "RETURN_LINES is not exported from today/returns.ts — the ledger enumerates PROJECTS with no lane filter", all_lanes: PROJECTS.map((p) => p.lane) })); }
    else console.log(JSON.stringify({ lanes: RETURN_LINES.map((p) => p.lane), keys: [...LINE_KEYS], all_lanes: PROJECTS.map((p) => p.lane) }));
  `;
  const r = spawnSync("npx", ["tsx", "-e", script], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`could not load returns.ts through tsx: ${r.stderr.slice(0, 400)}`);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

export function check({ surfaces, contributors, migrations, lanes }) {
  const failures = [];
  let scanned = 0;

  if (lanes?.missing) failures.push(lanes.missing);
  else if (!lanes || !Array.isArray(lanes.all_lanes) || lanes.all_lanes.length === 0) {
    failures.push("projects.ts declared no lanes — the ledger check examined nothing");
  } else {
    if (lanes.lanes.includes("west_peek")) failures.push("the return ledger enumerates a west_peek lane line (RETURN_LINES must exclude the lane)");
    if (lanes.keys.includes("west_peek_raise")) failures.push("LINE_KEYS accepts west_peek_raise, so the contribute door would take a fund-level contribution");
    if (!lanes.all_lanes.includes("west_peek")) failures.push("projects.ts no longer declares a west_peek project at all — the Wednesday cadence (§5.4) is her diary and must stay; only the RETURN LINE goes");
  }

  for (const [file, text] of Object.entries(surfaces)) {
    scanned++;
    for (const re of FUND_WORDS) {
      const m = re.exec(text);
      if (m) failures.push(`${file}: carries fund-level wording "${m[0]}"`);
    }
  }
  for (const [file, text] of Object.entries(contributors)) {
    scanned++;
    if (/west_peek_raise/.test(text)) failures.push(`${file}: still contributes the west_peek_raise line`);
    if (/Sent Log|Reply Log/.test(text)) failures.push(`${file}: still reads the LP tracker's Sent Log / Reply Log`);
  }

  for (const duty of KEEP_DUTIES) {
    const seeded = migrations.some((m) => m.includes(`'${duty}'`) && /INSERT(?: OR IGNORE)? INTO standing_duties/.test(m));
    if (!seeded) failures.push(`${duty} is not seeded — Monique's personal LP-search duty must stay`);
    const suspended = migrations.some((m) => new RegExp(`UPDATE standing_duties[\\s\\S]{0,300}?suspended\\s*=\\s*1[\\s\\S]{0,300}?WHERE id\\s*=\\s*'${duty}'`).test(m));
    if (suspended) failures.push(`${duty} is suspended by a migration — her reply hunt was taken with the fund totals`);
  }

  if (scanned === 0) failures.push("no surface or contributor file was scanned");
  return { failures, scanned };
}

/**
 * Comments are where her words are quoted — the reason a line was removed is written next to the
 * removal. The scan reads CODE: block and line comments are stripped first, so a quoted "capital
 * committed" in a header does not read as a surface printing it.
 */
export function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

function loadRepo(root) {
  const read = (f) => (existsSync(join(root, f)) ? withoutComments(readFileSync(join(root, f), "utf8")) : null);
  const surfaces = Object.fromEntries(SURFACES.map((f) => [f, read(f)]).filter(([, t]) => t !== null));
  const contributors = Object.fromEntries(CONTRIBUTORS.map((f) => [f, read(f)]).filter(([, t]) => t !== null));
  const dir = join(root, "migrations");
  const migrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(join(dir, f), "utf8"));
  return { surfaces, contributors, migrations };
}

function selfTest() {
  const good = {
    surfaces: { "a.tsx": "The desk. Monique's finds. Positive replies.", "returns.ts": "export const RETURN_LINES = PROJECTS.filter((p) => p.lane !== 'west_peek');" },
    contributors: { "line-returns.mjs": "// Search Console only" },
    migrations: [
      "INSERT INTO standing_duties (id) VALUES ('duty_lp_replies');",
      "INSERT OR IGNORE INTO standing_duties (id) VALUES ('duty_lp_positive');",
    ],
    lanes: { lanes: ["brokerage", "spry"], keys: ["brokerage", "hpc"], all_lanes: ["brokerage", "west_peek", "spry"] },
  };
  const cases = [
    { name: "clean repo passes", input: good, expect: 0 },
    { name: "ledger lists the west_peek lane", input: { ...good, lanes: { ...good.lanes, lanes: [...good.lanes.lanes, "west_peek"] } }, expect: 1 },
    { name: "contribute door accepts west_peek_raise", input: { ...good, lanes: { ...good.lanes, keys: [...good.lanes.keys, "west_peek_raise"] } }, expect: 1 },
    { name: "the West Peek project was deleted outright (the diary cadence must stay)", input: { ...good, lanes: { ...good.lanes, all_lanes: ["brokerage", "spry"] } }, expect: 1 },
    { name: "Capital says 'capital committed'", input: { ...good, surfaces: { ...good.surfaces, "a.tsx": "<div>capital committed</div>" } }, expect: 1 },
    { name: "Capital says 'LP emails sent'", input: { ...good, surfaces: { ...good.surfaces, "a.tsx": "LP emails sent, all time" } }, expect: 1 },
    { name: "a returns source named lp_tracker", input: { ...good, surfaces: { ...good.surfaces, "a.tsx": "source: 'lp_tracker'" } }, expect: 1 },
    { name: "contributor still posts west_peek_raise", input: { ...good, contributors: { "line-returns.mjs": "line: 'west_peek_raise'" } }, expect: 1 },
    { name: "contributor still reads the Sent Log", input: { ...good, contributors: { "line-returns.mjs": 'await tab(token, LP_SHEET, "Sent Log")' } }, expect: 1 },
    { name: "Monique's reply duty was removed", input: { ...good, migrations: [good.migrations[1]] }, expect: 1 },
    { name: "Monique's positive-reply duty was suspended", input: { ...good, migrations: [...good.migrations, "UPDATE standing_duties SET suspended = 1, suspended_reason = 'x' WHERE id = 'duty_lp_positive';"] }, expect: 1 },
    { name: "no lanes at all (Rule 0)", input: { ...good, lanes: { lanes: [], keys: [], all_lanes: [] } }, expect: 1 },
    { name: "RETURN_LINES not exported (the old file)", input: { ...good, lanes: { missing: "RETURN_LINES is not exported", all_lanes: ["west_peek"] } }, expect: 1 },
    { name: "nothing scanned (Rule 0)", input: { ...good, surfaces: {}, contributors: {} }, expect: 1 },
  ];
  let bad = 0;
  for (const c of cases) {
    const { failures } = check(c.input);
    const ok = c.expect === 0 ? failures.length === 0 : failures.length >= c.expect;
    if (!ok) { bad++; console.error(`  ✗ ${c.name}: ${failures.length} failure(s) — ${failures.join(" | ") || "none"}`); }
  }
  if (bad) { console.error(`SELF-TEST FAILED: ${bad} of ${cases.length}`); process.exit(1); }
  console.log(`SELF-TEST PASSED: ${cases.length}/${cases.length} cases`);
}

if (SELF_TEST) {
  selfTest();
} else {
  const repo = loadRepo(ROOT);
  const lanes = returnLanes(ROOT);
  const { failures, scanned } = check({ ...repo, lanes });
  if (failures.length) {
    console.error("WEST PEEK FUND TOTALS FOUND IN BOSS OS:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`NO WEST PEEK FUND TOTALS: ${scanned} files scanned, ${lanes.keys.length} return lines (lanes ${[...new Set(lanes.lanes)].join(", ")}), Monique's ${KEEP_DUTIES.length} LP-search duties intact.`);
}
