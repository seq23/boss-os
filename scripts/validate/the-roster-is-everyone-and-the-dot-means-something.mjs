#!/usr/bin/env node
/**
 * THE ROSTER IS EVERYONE, AND A GREEN DOT ASSERTS SOMETHING THAT COULD BE FALSE.
 *
 * ─── Her words ─────────────────────────────────────────────────────────────
 *
 *   "the ai employee status section does not have an accurate list of who is on duty and there
 *    prob needs to be better UX showing a green dot showing they are working correctly when they
 *    are and that changes to red when they are broken"
 *
 * ─── The accuracy half, settled before any dot was drawn ───────────────────
 *
 * Not a hardcoded roster and not a stale one. The block rendered `busiest`:
 *
 *     … WHERE e.status = 'active' ORDER BY open_tasks DESC, e.name ASC LIMIT 5
 *
 * EIGHT employees are active in production. The block showed five, so three were missing from "who
 * is on duty" at any moment, and which three moved as the queue moved. The summary line above the
 * list said eight all along, which is what made it feel almost-right.
 *
 * A roster sorted by busyness with a cut-off hides precisely the employees doing nothing — the
 * state most worth seeing.
 *
 * ─── What is checked ───────────────────────────────────────────────────────
 *
 *   1. NOBODY IS CUT OFF. `roster()` returns one entry per active employee, and the route's query
 *      carries no LIMIT. Checked over a fixture of eight, because five of eight passing a
 *      "renders a list" test is exactly what shipped.
 *   2. A DOT IS A FALSIFIABLE VERDICT, run through the shipped code:
 *        · a failed last run          → red
 *        · a duty overdue on its OWN schedule → red
 *        · a Mon/Wed/Fri duty on a Sunday     → GREEN, not red — the same false alert the
 *          staleness rewrite was for, and the dot must not reintroduce it
 *        · never run                  → amber, never green: grey-as-green is how a dead employee
 *          looks healthy
 *        · no standing duty at all    → amber, for the same reason
 *   3. OVERDUE IS ONE IMPLEMENTATION. `roster.ts` calls `dutyStaleness`; a second copy would let
 *      the dot and the Critical Alert disagree about the same duty on the same morning.
 *   4. EVERY STATE CARRIES ITS SENTENCE. A red dot with no reason is a puzzle, not an alert.
 *   5. THE STATE IS IN THE SHAPE AS WELL AS THE COLOUR. The three health classes must differ by
 *      something other than colour — `border-radius` or `border` — or the block is unreadable in
 *      greyscale and for a colourblind reader, and the label must be rendered, not hovered.
 *
 * RULE 0: zero employees in the fixture, or zero health states exercised, is a HARD FAILURE.
 *
 *   node scripts/validate/the-roster-is-everyone-and-the-dot-means-something.mjs
 *   node scripts/validate/the-roster-is-everyone-and-the-dot-means-something.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerTsResolve } from "./lib/ts-resolve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MODULE = "src/worker/boss/today/roster.ts";
const ROUTE = "src/worker/boss/routes/today.ts";
const SCREEN = "src/client/boss/pages/Today.tsx";
const CSS = "src/client/boss/styles.css";

const HEALTH = ["green", "amber", "red"];

/** The eight active employees, as production holds them. */
export const EMPLOYEES = [
  { id: "emp_chief", name: "Simone", role: "Chief of Staff", lane: "ops", open_tasks: 0 },
  { id: "emp_continuity", name: "Kendra", role: "Systems Manager", lane: "ops", open_tasks: 0 },
  { id: "emp_knowledge", name: "Zora", role: "Archivist", lane: "ops", open_tasks: 0 },
  { id: "emp_practice", name: "Imani", role: "Director of Practice", lane: "ops", open_tasks: 0 },
  { id: "emp_relationship", name: "Monique", role: "Director of Relationships", lane: "ops", open_tasks: 0 },
  { id: "emp_repo", name: "Danielle", role: "Technical Program Manager", lane: "ops", open_tasks: 0 },
  { id: "emp_research", name: "Camille", role: "Director of Research", lane: "ops", open_tasks: 2 },
  { id: "emp_risk", name: "Toni", role: "Chief Risk Officer", lane: "trading", open_tasks: 0 },
];

const CENTRAL = "America/Chicago";
const SUNDAY = Date.parse("2026-09-13T18:57:00Z");

/** One duty per case that must come out a particular colour. */
export const DUTIES = [
  {
    // THE CASE THAT MUST NOT GO RED: Mon/Wed/Fri, ran Friday, read on a Sunday.
    id: "duty_brokerage_sourcing", name: "Brokerage Sourcing Sweep (Mon/Wed/Fri)", employee_id: "emp_relationship",
    cadence: "daily", weekday: null, weekdays: "[1,3,5]", local_hour: 6, local_minute: 45, timezone: CENTRAL,
    suspended: 0, last_run_at: 1_789_128_106_042, created_at: 1_788_802_886_000, last_task_status: "done",
  },
  {
    id: "duty_exec_intel", name: "Executive Intelligence Report", employee_id: "emp_research",
    cadence: "daily", weekday: null, weekdays: null, local_hour: 6, local_minute: 30, timezone: CENTRAL,
    suspended: 0, last_run_at: Date.parse("2026-09-13T11:30:00Z"), created_at: Date.parse("2026-08-01T00:00:00Z"),
    last_task_status: "done",
  },
  {
    // A failed last run: red, whatever the clock says.
    id: "duty_kdp_surface", name: "Kindle surface", employee_id: "emp_chief",
    cadence: "weekly", weekday: 1, weekdays: null, local_hour: 8, local_minute: 0, timezone: CENTRAL,
    suspended: 0, last_run_at: Date.parse("2026-09-07T13:00:00Z"), created_at: Date.parse("2026-08-01T00:00:00Z"),
    last_task_status: "failed",
  },
  {
    // Overdue against its own schedule: red.
    id: "duty_tool_scout", name: "Tools worth knowing about", employee_id: "emp_continuity",
    cadence: "weekly", weekday: 4, weekdays: null, local_hour: 8, local_minute: 0, timezone: CENTRAL,
    suspended: 0, last_run_at: Date.parse("2026-08-20T13:00:00Z"), created_at: Date.parse("2026-08-01T00:00:00Z"),
    last_task_status: "done",
  },
  {
    // Never run: amber, never green.
    id: "duty_mailbox_sweep", name: "Mailbox sweep", employee_id: "emp_knowledge",
    cadence: "weekly", weekday: 0, weekdays: null, local_hour: 9, local_minute: 0, timezone: CENTRAL,
    suspended: 0, last_run_at: null, created_at: Date.parse("2026-09-12T00:00:00Z"), last_task_status: null,
  },
];

/** What each employee must come out as, and why that case exists. */
export const EXPECTED = {
  emp_relationship: { health: "green", why: "Mon/Wed/Fri, ran Friday, read on a Sunday — the false alert that must not come back as a dot" },
  emp_research: { health: "green", why: "a daily duty that ran this morning" },
  emp_chief: { health: "red", why: "their last run FAILED" },
  emp_continuity: { health: "red", why: "a weekly duty three weeks overdue against its own schedule" },
  emp_knowledge: { health: "amber", why: "their duty has never run — not the same as working" },
  emp_practice: { health: "amber", why: "no standing duty at all, so nothing can say whether they work" },
  emp_repo: { health: "amber", why: "no standing duty at all" },
  emp_risk: { health: "amber", why: "no standing duty at all" },
};

export function check({ entries, route, screen, css }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (!Array.isArray(entries) || entries.length === 0) {
    problems.push(`\`roster()\` returned nothing for ${EMPLOYEES.length} active employees. A list of nobody satisfies every rule below.`);
    return problems;
  }
  const states = new Set(entries.map((e) => e.health));
  if (states.size < 2) {
    problems.push(
      `Every employee in the fixture came out "${[...states][0]}". The fixture deliberately contains a ` +
      `failed run, an overdue duty, a duty that has never run and three employees with no duty at all; ` +
      `one colour for all of them means the verdict is not a verdict.`,
    );
    return problems;
  }

  // ── 1. Nobody is cut off ─────────────────────────────────────────────────
  if (entries.length !== EMPLOYEES.length) {
    problems.push(
      `${EMPLOYEES.length} employees are active and the roster returned ${entries.length}. The block showed ` +
      `the five BUSIEST of eight, so three were missing at any moment and which three moved with the ` +
      `queue — while the summary above it correctly said eight.`,
    );
  }
  for (const e of EMPLOYEES) {
    if (!entries.some((r) => r.id === e.id)) problems.push(`${e.name} is active and is not on the roster.`);
  }
  const routeCode = code(route);
  if (/FROM employees e[\s\S]{0,400}?LIMIT\s+\d/.test(routeCode)) {
    problems.push(`${ROUTE}'s employee query still carries a LIMIT. That LIMIT is the defect: a roster with a cut-off is not a roster.`);
  }

  // ── 2, 4. Each dot is the right verdict and says why ─────────────────────
  for (const entry of entries) {
    const want = EXPECTED[entry.id];
    if (!want) continue;
    if (entry.health !== want.health) {
      problems.push(
        `${entry.name} came out ${entry.health} and must be ${want.health} — ${want.why}. ` +
        `Reason given: "${entry.reason}".`,
      );
    }
    if (!entry.reason) problems.push(`${entry.name}'s dot carries no reason. A red dot with no sentence is a puzzle, not an alert.`);
    if (!entry.label) problems.push(`${entry.name}'s state has no word beside it, so the verdict dies in greyscale.`);
  }

  // ── 3. One implementation of "overdue" ───────────────────────────────────
  if (!/dutyStaleness\s*\(/.test(code(readFileSync(join(ROOT, MODULE), "utf8")))) {
    problems.push(
      `${MODULE} does not use \`dutyStaleness\`. A second copy of "is this duty late" lets the dot and ` +
      `the Critical Alert disagree about the same duty on the same morning.`,
    );
  }

  // ── 5. Shape as well as colour, and the label rendered ───────────────────
  const shapes = {};
  for (const state of HEALTH) {
    const rule = new RegExp(`\\.health-${state}\\s*\\{([^}]*)\\}`).exec(css);
    if (!rule) {
      problems.push(`${CSS} has no \`.health-${state}\` rule.`);
      continue;
    }
    const radius = /border-radius\s*:\s*([^;]+);/.exec(rule[1])?.[1]?.trim() ?? "";
    const border = /border\s*:\s*([^;]+);/.exec(rule[1])?.[1]?.trim() ?? "";
    shapes[state] = `${radius}|${border}`;
  }
  if (Object.keys(shapes).length === HEALTH.length && new Set(Object.values(shapes)).size < 2) {
    problems.push(
      `${CSS} distinguishes the three health states by COLOUR ALONE (${JSON.stringify(shapes)}). In greyscale, ` +
      `or for a colourblind reader, the block then says nothing at all — and it is read on a phone.`,
    );
  }
  const screenCode = code(screen);
  if (!/health-\$\{|health-\$\{e\.health|`health health-/.test(screenCode) && !/health-/.test(screenCode)) {
    problems.push(`${SCREEN} never renders a health class, so the verdict is computed and invisible.`);
  }
  if (!/e\.label/.test(screenCode)) {
    problems.push(`${SCREEN} does not render the state's word, leaving colour as the only carrier.`);
  }
  if (!/e\.reason/.test(screenCode)) {
    problems.push(`${SCREEN} does not render the reason, so a red dot arrives with no explanation.`);
  }

  return problems;
}

// ─── Running the shipped code ───────────────────────────────────────────────

async function evaluate() {
  registerTsResolve();
  const mod = await import(`file://${join(ROOT, MODULE)}`);
  return mod.roster(EMPLOYEES, DUTIES, SUNDAY);
}

// ─── Self-test ──────────────────────────────────────────────────────────────

async function selfTest() {
  const entries = await evaluate();
  const good = {
    entries,
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    css: readFileSync(join(ROOT, CSS), "utf8"),
  };
  const recolour = (id, health) => good.entries.map((e) => (e.id === id ? { ...e, health } : e));

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "THE ACTUAL DEFECT: the roster cut back to the five busiest",
      input: { ...good, entries: good.entries.slice(0, 5) },
      expect: 1,
    },
    {
      name: "the LIMIT restored on the employees query",
      input: { ...good, route: `${good.route}\nSELECT e.id FROM employees e WHERE e.status='active' ORDER BY x LIMIT 5\n` },
      expect: 1,
    },
    {
      name: "THE FALSE ALERT AS A DOT: Mon/Wed/Fri going red on a Sunday",
      input: { ...good, entries: recolour("emp_relationship", "red") },
      expect: 1,
    },
    { name: "a failed last run shown green", input: { ...good, entries: recolour("emp_chief", "green") }, expect: 1 },
    { name: "an overdue duty shown green", input: { ...good, entries: recolour("emp_continuity", "green") }, expect: 1 },
    {
      name: "GREY-AS-GREEN: an employee who has never run shown green",
      input: { ...good, entries: recolour("emp_knowledge", "green") },
      expect: 1,
    },
    {
      name: "an employee with no duty at all shown green",
      input: { ...good, entries: recolour("emp_practice", "green") },
      expect: 1,
    },
    {
      name: "a dot with no reason on it",
      input: { ...good, entries: good.entries.map((e) => ({ ...e, reason: "" })) },
      expect: 1,
    },
    {
      name: "the three states separated by colour alone",
      input: {
        ...good,
        css: good.css
          .replace(".health-amber { background: transparent; border: 2px solid var(--gold-deep); border-radius: 50%; }", ".health-amber { background: var(--gold-deep); border-radius: 50%; }")
          .replace(".health-red { background: var(--reject); border-radius: 1px; }", ".health-red { background: var(--reject); border-radius: 50%; }"),
      },
      expect: 1,
    },
    {
      name: "the screen dropping the word beside the dot",
      input: { ...good, screen: good.screen.replaceAll("e.label", "nothing") },
      expect: 1,
    },
    {
      name: "the screen dropping the reason",
      input: { ...good, screen: good.screen.replaceAll("e.reason", "nothing") },
      expect: 1,
    },
    { name: "RULE 0 — an empty roster", input: { ...good, entries: [] }, expect: 1 },
    {
      name: "RULE 0 — every employee the same colour",
      input: { ...good, entries: good.entries.map((e) => ({ ...e, health: "green" })) },
      expect: 1,
    },
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
    console.error(`\nthe-roster-is-everyone-and-the-dot-means-something self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`the-roster-is-everyone-and-the-dot-means-something self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missingFiles = [MODULE, ROUTE, SCREEN, CSS].filter((f) => !existsSync(join(ROOT, f)));
if (missingFiles.length) {
  console.error(`the-roster-is-everyone-and-the-dot-means-something FAILED — ${missingFiles.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const entries = await evaluate();
  const problems = check({
    entries,
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    css: readFileSync(join(ROOT, CSS), "utf8"),
  });

  if (problems.length) {
    console.error("the-roster-is-everyone-and-the-dot-means-something FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  const byState = HEALTH.map((h) => `${entries.filter((e) => e.health === h).length} ${h}`).join(", ");
  console.log(
    `the-roster-is-everyone-and-the-dot-means-something: all ${entries.length} active employees on the ` +
    `roster (${byState}), each with a reason, the Mon/Wed/Fri case green on a Sunday, and the three ` +
    `states told apart by shape as well as colour. OK.`,
  );
}
