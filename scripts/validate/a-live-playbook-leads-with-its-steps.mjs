#!/usr/bin/env node
/**
 * A PLAYBOOK THAT APPLIES RIGHT NOW LEADS, WITH ITS STEPS, AND ITS CONDITION IS ASKED OF THE
 * SCHEDULE THAT GOVERNS IT.
 *
 * ─── Her words ─────────────────────────────────────────────────────────────
 *
 *   "the governence section on systems needs work. some thing about playbook broken or stale"
 *
 * ─── What was actually true, measured ──────────────────────────────────────
 *
 * `fpb_vault_stale` was ACTIVE and it was RIGHT: the newest complete snapshot in production was
 * 6 September, read on the 13th. Every nightly run in between reported
 * `snapshot: { skipped: true, reason: "not_due", last_at: 1788717612524 }` — a deployed build whose
 * snapshot window had not yet been changed to daily.
 *
 * So the finding was correct and the screen reported it uselessly:
 *
 *   · It sat THIRD, in a panel styled identically to the two that were fine, with the word ACTIVE
 *     in a value column and nothing saying anything wanted her.
 *   · Its STEPS were loaded, parsed by the endpoint, and never rendered. A playbook IS its steps;
 *     without them it is a label announcing that something is wrong.
 *   · No sentence anywhere said what was currently true.
 *   · Decision rights rendered `action_class`, so she was reading `dr_capability_patch`, while
 *     every row already carries a `label` and a `rationale` that nothing used.
 *
 * ─── And the condition was two copies of a number linked to nothing ────────
 *
 *     routes/governance.ts    stale_vault: !snapshot || now - snapshot.ts > 2 * 86_400_000
 *     governance/sentinel.ts  stale_vault: !snapshot || now - snapshot.ts > 2 * DAY_MS
 *
 * Two files, each free to drift from the other and BOTH free to drift from the cadence that takes
 * the snapshots. The owner asked for a daily snapshot at end of day; when that landed, neither of
 * these knew — they would have gone on measuring a daily backup against a two-day ruler and the
 * alarm would have kept working by accident. `vaultIsStale` in `cron/cadence.ts` asks the schedule.
 *
 * ─── What is checked ───────────────────────────────────────────────────────
 *
 *   1. ONE RULE, ASKED OF THE CADENCE. `vaultIsStale` is used by both readers, neither carries a
 *      hardcoded two-day span any more, and the shipped function answers correctly for a snapshot
 *      taken inside last night's window, a night that was missed, and a vault never snapshotted.
 *   2. THE LIVE PLAYBOOK LEADS, and it renders its STEPS.
 *   3. THE SECTION OPENS WITH A VERDICT — one line saying what is true and what it wants.
 *   4. DECISION RIGHTS ARE IN HER WORDS: `label` and `rationale`, never `action_class`.
 *
 * RULE 0: zero staleness fixtures evaluated, or no Governance section to read, is a HARD FAILURE.
 *
 *   node scripts/validate/a-live-playbook-leads-with-its-steps.mjs
 *   node scripts/validate/a-live-playbook-leads-with-its-steps.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerTsResolve } from "./lib/ts-resolve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const CADENCE = "src/worker/boss/cron/cadence.ts";
const ROUTE = "src/worker/boss/routes/governance.ts";
const SENTINEL = "src/worker/boss/governance/sentinel.ts";
const SCREEN = "src/client/boss/pages/Systems.tsx";

/** Central time, because the snapshot window is her evening rather than UTC's. */
const CT = (iso) => Date.parse(iso);

export const STALENESS_FIXTURES = [
  {
    name: "a snapshot taken inside last night's window, read this morning",
    now: CT("2026-09-14T15:00:00Z"), // Monday 10:00 Central
    last: CT("2026-09-14T03:05:00Z"), // Sunday 22:05 Central — inside Sunday's 20:00 window
    expect: false,
    why: "last night's copy is current all of today; going red on it would be noise every morning",
  },
  {
    name: "last night's snapshot missed",
    now: CT("2026-09-14T15:00:00Z"),
    last: CT("2026-09-13T03:05:00Z"), // the night BEFORE last
    expect: true,
    why: "one missed night is red here, deliberately — this is the copy that protects everything else",
  },
  {
    name: "the production case: seven days since the last complete snapshot",
    now: CT("2026-09-13T18:57:00Z"),
    last: 1_788_717_612_524,
    expect: true,
    why: "this is what was on her screen, and the playbook was right",
  },
  {
    name: "a vault that has never been snapshotted",
    now: CT("2026-09-14T15:00:00Z"),
    last: null,
    expect: true,
    why: "no copy at all is the loudest version of this, not a quiet one",
  },
];

/** The Governance component's body. */
export function governanceBody(screen) {
  const start = screen.indexOf("function Governance(");
  if (start === -1) return null;
  const next = screen.indexOf("\nfunction ", start + 10);
  return screen.slice(start, next === -1 ? screen.length : next);
}

export function check({ staleness, cadence, route, sentinel, screen }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (!Array.isArray(staleness) || staleness.length === 0) {
    problems.push(`Zero vault-staleness fixtures were evaluated, so rule 1 examined nothing.`);
    return problems;
  }
  const body = governanceBody(code(screen));
  if (!body) {
    problems.push(`${SCREEN} has no Governance component this scan can read, so rules 2 to 4 have nothing to apply to.`);
    return problems;
  }

  // ── 1. One rule, asked of the cadence ────────────────────────────────────
  for (const f of staleness) {
    if (f.got !== f.expect) {
      problems.push(
        `${f.name}: vaultIsStale answered ${f.got} and must answer ${f.expect} — ${f.why}.`,
      );
    }
  }
  if (!/export function vaultIsStale/.test(code(cadence))) {
    problems.push(`${CADENCE} no longer exports \`vaultIsStale\`, so nothing links the alarm to the schedule that takes the snapshots.`);
  }
  if (!/snapshotWindowOpensAt\s*\(/.test(code(cadence).split("vaultIsStale")[1] ?? "")) {
    problems.push(
      `\`vaultIsStale\` does not ask \`snapshotWindowOpensAt\`. A number it keeps to itself is the two-day ` +
      `span this replaces: it stayed correct by accident while the cadence changed underneath it.`,
    );
  }
  for (const [file, src] of [[ROUTE, route], [SENTINEL, sentinel]]) {
    const c = code(src);
    if (!/vaultIsStale\s*\(/.test(c)) {
      problems.push(`${file} does not use \`vaultIsStale\`, so it keeps its own idea of how fresh a vault has to be.`);
    }
    if (/2\s*\*\s*(86_400_000|86400000|DAY_MS)/.test(c)) {
      problems.push(`${file} still carries a hardcoded two-day staleness span. That is the copy this change removed.`);
    }
  }

  // ── 2. The live playbook leads, with its steps ───────────────────────────
  if (!/applies_now/.test(body)) {
    problems.push(
      `${SCREEN}'s Governance section does not separate the playbooks that apply RIGHT NOW. A live ` +
      `playbook sat third, in a panel styled identically to the two that were fine.`,
    );
  }
  if (!/\.steps|p\.steps/.test(body)) {
    problems.push(
      `${SCREEN} does not render a playbook's steps. The endpoint parses them out of JSON and they were ` +
      `thrown away — a playbook IS its steps, and without them it is a label announcing something is wrong.`,
    );
  }
  if (!/condition_text|p\.condition/.test(body)) {
    problems.push(`${SCREEN} does not say WHY a playbook fired.`);
  }

  // ── 3. A verdict at the top ──────────────────────────────────────────────
  if (!/applies right now|Nothing is currently wrong/.test(body)) {
    problems.push(
      `${SCREEN}'s Governance section opens with no one-line state. Three panels of raw rows and no ` +
      `sentence anywhere is a database view: she has to read all of it to find out whether anything ` +
      `is wrong.`,
    );
  }

  // ── 4. Decision rights in her words ──────────────────────────────────────
  if (!/r\.label/.test(body) || !/r\.rationale/.test(body)) {
    problems.push(
      `${SCREEN} renders decision rights without their \`label\` and \`rationale\`. She was reading ` +
      `\`dr_capability_patch\` off a row that already says what it is and why.`,
    );
  }
  const rightsRow = /title=\{text\(r\.[^)]*\)\}/.exec(body)?.[0] ?? "";
  if (/r\.action_class \?\? r\.id/.test(rightsRow) && !/r\.label/.test(rightsRow)) {
    problems.push(`${SCREEN} still titles a decision right with its \`action_class\`.`);
  }

  return problems;
}

// ─── Running the shipped code ───────────────────────────────────────────────

async function evaluate() {
  registerTsResolve();
  const mod = await import(`file://${join(ROOT, CADENCE)}`);
  return STALENESS_FIXTURES.map((f) => ({ ...f, got: mod.vaultIsStale(f.now, f.last) }));
}

// ─── Self-test ──────────────────────────────────────────────────────────────

async function selfTest() {
  const staleness = await evaluate();
  const good = {
    staleness,
    cadence: readFileSync(join(ROOT, CADENCE), "utf8"),
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    sentinel: readFileSync(join(ROOT, SENTINEL), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
  };

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "a seven-day-old vault reported as fresh",
      input: { ...good, staleness: good.staleness.map((f, i) => (i === 2 ? { ...f, got: false } : f)) },
      expect: 1,
    },
    {
      name: "last night's snapshot reported as stale — noise every morning",
      input: { ...good, staleness: good.staleness.map((f, i) => (i === 0 ? { ...f, got: true } : f)) },
      expect: 1,
    },
    {
      name: "a vault never snapshotted reported as fine",
      input: { ...good, staleness: good.staleness.map((f, i) => (i === 3 ? { ...f, got: false } : f)) },
      expect: 1,
    },
    {
      name: "THE TWO COPIES: the hardcoded two-day span back in the route",
      input: { ...good, route: `${good.route}\nconst stale = !snapshot || now - snapshot.ts > 2 * 86_400_000;\n` },
      expect: 1,
    },
    {
      name: "the sentinel keeping its own idea again",
      input: { ...good, sentinel: good.sentinel.replaceAll("vaultIsStale(", "ownIdea(") },
      expect: 1,
    },
    {
      name: "THE DEFECT: the playbook's steps thrown away again",
      input: { ...good, screen: good.screen.replace(/\(Array\.isArray\(p\.steps\) \? p\.steps : \[\]\)/, "[]").replaceAll("p.steps", "p.nothing") },
      expect: 1,
    },
    {
      name: "the live playbook no longer leading",
      input: { ...good, screen: good.screen.replaceAll("applies_now", "unused") },
      expect: 1,
    },
    {
      name: "the verdict line removed",
      input: { ...good, screen: good.screen.replace(/applies right now/, "x").replace(/Nothing is currently wrong/, "y") },
      expect: 1,
    },
    {
      name: "decision rights back to action_class ids",
      input: { ...good, screen: good.screen.replaceAll("r.label ?? r.action_class ?? r.id", "r.action_class ?? r.id").replaceAll("r.rationale ?? r.rule", "r.rule") },
      expect: 1,
    },
    { name: "RULE 0 — nothing evaluated", input: { ...good, staleness: [] }, expect: 1 },
    { name: "RULE 0 — no Governance component", input: { ...good, screen: "// nothing" }, expect: 1 },
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
    console.error(`\na-live-playbook-leads-with-its-steps self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`a-live-playbook-leads-with-its-steps self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missingFiles = [CADENCE, ROUTE, SENTINEL, SCREEN].filter((f) => !existsSync(join(ROOT, f)));
if (missingFiles.length) {
  console.error(`a-live-playbook-leads-with-its-steps FAILED — ${missingFiles.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const staleness = await evaluate();
  const problems = check({
    staleness,
    cadence: readFileSync(join(ROOT, CADENCE), "utf8"),
    route: readFileSync(join(ROOT, ROUTE), "utf8"),
    sentinel: readFileSync(join(ROOT, SENTINEL), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
  });

  if (problems.length) {
    console.error("a-live-playbook-leads-with-its-steps FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `a-live-playbook-leads-with-its-steps: ${staleness.length} vault-staleness fixtures answered off the ` +
    `snapshot cadence by one function both readers share, the live playbook leads with its steps and the ` +
    `reason it fired, the section opens with a verdict, and decision rights read in her words. OK.`,
  );
}
