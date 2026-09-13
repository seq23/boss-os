#!/usr/bin/env node
/**
 * RETENTION MUST REACH BACK AT LEAST AS FAR AS THE QUESTION THE RESTORE CHECKLIST ASKS.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 * `docs/boss/RESTORE_CHECKLIST.md` asks one question about age:
 *
 *     "The most recent offsite copy is less than a quarter old"
 *
 * `SNAPSHOT_KEEP` was 12 and it was NOT twelve for its own sake — the comment beside it said so:
 * twelve WEEKLY snapshots is roughly a quarter, so the copies on hand reach back as far as the
 * checklist looks. The number was derived from the cadence.
 *
 * On 13 Sep 2026 the owner moved the cadence to DAILY. Nothing about `SNAPSHOT_KEEP = 12` would
 * have looked wrong in that diff — it is a different constant, in a different paragraph, with a
 * comment that still reads sensibly. And the vault would have gone from holding a quarter of
 * history to holding TWELVE DAYS of it, silently, with the comment still claiming a quarter.
 *
 * That is this repository's named defect at the level of two integers: two components each holding
 * half of one fact, with nothing linking them, free to disagree. A comment is not a link.
 *
 * ─── What is actually checked ───────────────────────────────────────────────
 *
 *   1. All three constants EXIST and parse as numbers of milliseconds. A scan that cannot find its
 *      own subject has proved nothing, and must say so rather than pass.
 *   2. `SNAPSHOT_KEEP x SNAPSHOT_INTERVAL_MS >= QUARTER_MS`. This is the whole invariant. It binds
 *      the two numbers that must move together, so changing either alone fails here.
 *   3. The checklist STILL ASKS THE QUESTION. If the "less than a quarter old" line goes, the
 *      invariant is enforcing a requirement nobody makes any more — which is a validator that has
 *      quietly become a fiction, and is worth failing over so someone re-derives the number.
 *   4. `QUARTER_MS` is not quietly redefined downwards to make a short retention pass. It must be
 *      at least 89 days, because "a quarter" cannot be argued below three months without the
 *      argument being visible here.
 *
 * RULE 0: finding zero constants, or a missing cadence file, or a missing checklist, is a FAILURE.
 * There is no empty loop to pass over — the whole check is "these specific facts agree", so an
 * absent fact is a hard failure, never a skip.
 *
 *   node scripts/validate/retention-outlasts-the-checklist.mjs
 *   node scripts/validate/retention-outlasts-the-checklist.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const CADENCE = "src/worker/boss/cron/cadence.ts";
const CHECKLIST = "docs/boss/RESTORE_CHECKLIST.md";

const DAY_MS = 86_400_000;

/** The phrase the retention number is derived FROM. If it moves, the derivation must be redone. */
const CHECKLIST_QUESTION = /less than a quarter old/i;

/** A quarter cannot be argued below three months without the argument being visible. */
const QUARTER_FLOOR_MS = 89 * DAY_MS;

/**
 * Read one exported numeric constant out of the cadence module.
 *
 * EVALUATED AS ARITHMETIC RATHER THAN MATCHED AS A LITERAL, because the file legitimately writes
 * `90 * DAY_MS` and `1 * DAY_MS` — the units are the point. A literal-only matcher would find
 * nothing and, if it were permissive, would pass; so this resolves `DAY_MS`/`HOUR_MS` first and
 * then evaluates the remaining digits, operators and underscores. Anything else returns null and
 * becomes a hard failure upstream rather than a silent zero.
 */
export function constantMs(source, name) {
  const m = new RegExp(`export\\s+const\\s+${name}\\s*(?::\\s*number\\s*)?=\\s*([^;]+);`).exec(source);
  if (!m) return null;

  const expr = m[1]
    .replace(/\bDAY_MS\b/g, String(DAY_MS))
    .replace(/\bHOUR_MS\b/g, String(3_600_000))
    .replace(/_/g, "")
    .trim();

  // Only arithmetic on numbers survives. An identifier this scan does not know is not guessed at.
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return null;
  try {
    const value = Function(`"use strict"; return (${expr});`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

const days = (ms) => (ms / DAY_MS).toFixed(ms % DAY_MS === 0 ? 0 : 2);

/**
 * The check itself, over supplied text — so the self-test exercises the REAL logic rather than a
 * paraphrase of it. A self-test that re-implements what it is testing proves only that two copies
 * of a bug agree.
 */
export function check(cadenceSource, checklistSource) {
  const problems = [];

  const keep = constantMs(cadenceSource, "SNAPSHOT_KEEP");
  const interval = constantMs(cadenceSource, "SNAPSHOT_INTERVAL_MS");
  const quarter = constantMs(cadenceSource, "QUARTER_MS");

  // RULE 0. A missing constant is a scan that examined nothing, and must fail as one.
  for (const [name, value] of [
    ["SNAPSHOT_KEEP", keep],
    ["SNAPSHOT_INTERVAL_MS", interval],
    ["QUARTER_MS", quarter],
  ]) {
    if (value === null) {
      problems.push(
        `${CADENCE} does not export a readable numeric ${name}. This scan cannot check an invariant ` +
        `whose terms it cannot find, and a scan that examined nothing must fail rather than pass.`,
      );
    }
  }
  if (problems.length) return problems;

  if (keep < 1) {
    problems.push(`SNAPSHOT_KEEP is ${keep}. A vault that keeps nothing is not a vault.`);
  }
  if (interval < 1) {
    problems.push(`SNAPSHOT_INTERVAL_MS is ${interval}. A cadence of zero makes the coverage arithmetic meaningless.`);
  }

  if (quarter < QUARTER_FLOOR_MS) {
    problems.push(
      `QUARTER_MS is ${days(quarter)} days. "A quarter" cannot be redefined below ${days(QUARTER_FLOOR_MS)} ` +
      `days to make a short retention pass — that would make this check agree with whatever it is given, ` +
      `which is the same as not having it.`,
    );
  }

  const coverage = keep * interval;
  if (coverage < quarter) {
    problems.push(
      `RETENTION IS SHORTER THAN THE CHECKLIST'S OWN QUESTION. SNAPSHOT_KEEP (${keep}) x ` +
      `SNAPSHOT_INTERVAL_MS (${days(interval)} day(s)) = ${days(coverage)} days of history, and ` +
      `${CHECKLIST} asks whether the most recent copy is less than ${days(quarter)} days old. ` +
      `The vault would be deleting the evidence the checklist exists to look for. Move SNAPSHOT_KEEP ` +
      `with the cadence: at this interval it must be at least ${Math.ceil(quarter / interval)}.`,
    );
  }

  if (!CHECKLIST_QUESTION.test(checklistSource)) {
    problems.push(
      `${CHECKLIST} no longer asks whether the most recent copy is "less than a quarter old". That ` +
      `sentence is where SNAPSHOT_KEEP's value comes from, so if the question changed the number has ` +
      `to be re-derived — and this check has to be re-pointed at the new question rather than left ` +
      `enforcing a requirement nobody makes.`,
    );
  }

  return problems;
}

// ─── Self-test: the detection proved on text, not on the repo ───────────────

function selfTest() {
  const goodChecklist = "- [ ] The most recent offsite copy is less than a quarter old\n";
  const good = `
export const DAY_MS = 86_400_000;
export const SNAPSHOT_INTERVAL_MS = 1 * DAY_MS;
export const QUARTER_MS = 90 * DAY_MS;
export const SNAPSHOT_KEEP = 90;
`;

  const cases = [
    {
      name: "the shipped pairing passes",
      cadence: good,
      checklist: goodChecklist,
      expect: 0,
    },
    {
      name: "THE ACTUAL DEFECT: cadence went daily and KEEP stayed at 12",
      cadence: good.replace("SNAPSHOT_KEEP = 90", "SNAPSHOT_KEEP = 12"),
      checklist: goodChecklist,
      expect: 1,
    },
    {
      name: "the OLD weekly pairing, which was already six days short of the quarter it claimed",
      cadence: `
export const DAY_MS = 86_400_000;
export const SNAPSHOT_INTERVAL_MS = 7 * DAY_MS;
export const QUARTER_MS = 90 * DAY_MS;
export const SNAPSHOT_KEEP = 12;
`,
      checklist: goodChecklist,
      expect: 1,
    },
    {
      name: "a weekly cadence with retention moved to match passes",
      cadence: `
export const DAY_MS = 86_400_000;
export const SNAPSHOT_INTERVAL_MS = 7 * DAY_MS;
export const QUARTER_MS = 90 * DAY_MS;
export const SNAPSHOT_KEEP = 13;
`,
      checklist: goodChecklist,
      expect: 0,
    },
    {
      name: "an hourly cadence with 90 kept — coverage is under four days",
      cadence: `
export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const SNAPSHOT_INTERVAL_MS = 1 * HOUR_MS;
export const QUARTER_MS = 90 * DAY_MS;
export const SNAPSHOT_KEEP = 90;
`,
      checklist: goodChecklist,
      expect: 1,
    },
    {
      name: "redefining a quarter downwards to make short retention pass is caught",
      cadence: good.replace("QUARTER_MS = 90 * DAY_MS", "QUARTER_MS = 12 * DAY_MS").replace("SNAPSHOT_KEEP = 90", "SNAPSHOT_KEEP = 12"),
      checklist: goodChecklist,
      expect: 1,
    },
    {
      name: "RULE 0 — SNAPSHOT_KEEP deleted entirely is a failure, not an empty pass",
      cadence: good.replace("export const SNAPSHOT_KEEP = 90;", ""),
      checklist: goodChecklist,
      expect: 1,
    },
    {
      name: "RULE 0 — QUARTER_MS deleted entirely is a failure",
      cadence: good.replace("export const QUARTER_MS = 90 * DAY_MS;", ""),
      checklist: goodChecklist,
      expect: 1,
    },
    {
      name: "RULE 0 — SNAPSHOT_INTERVAL_MS deleted entirely is a failure",
      cadence: good.replace("export const SNAPSHOT_INTERVAL_MS = 1 * DAY_MS;", ""),
      checklist: goodChecklist,
      expect: 1,
    },
    {
      name: "a constant set from an identifier this scan cannot resolve fails rather than guessing",
      cadence: good.replace("SNAPSHOT_KEEP = 90", "SNAPSHOT_KEEP = RETENTION_FROM_ENV"),
      checklist: goodChecklist,
      expect: 1,
    },
    {
      name: "the checklist losing its quarter question is caught",
      cadence: good,
      checklist: "- [ ] The most recent offsite copy exists\n",
      expect: 1,
    },
    {
      name: "SNAPSHOT_KEEP of zero is caught",
      cadence: good.replace("SNAPSHOT_KEEP = 90", "SNAPSHOT_KEEP = 0"),
      checklist: goodChecklist,
      expect: 2,
    },
    {
      name: "a type annotation on the constant does not hide it",
      cadence: good.replace("export const SNAPSHOT_KEEP = 90;", "export const SNAPSHOT_KEEP: number = 90;"),
      checklist: goodChecklist,
      expect: 0,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.cadence, c.checklist).length;
    const ok = c.expect === 0 ? found === 0 : found >= 1;
    if (!ok) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }

  if (failed) {
    console.error(`\nretention-outlasts-the-checklist self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`retention-outlasts-the-checklist self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const missing = [CADENCE, CHECKLIST].filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(
      `retention-outlasts-the-checklist FAILED — ${missing.join(" and ")} missing. This scan cannot ` +
      `check an invariant whose terms do not exist, and a scan that examined nothing must fail.`,
    );
    process.exit(1);
  }

  const problems = check(
    readFileSync(join(ROOT, CADENCE), "utf8"),
    readFileSync(join(ROOT, CHECKLIST), "utf8"),
  );

  if (problems.length) {
    console.error("retention-outlasts-the-checklist FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  const source = readFileSync(join(ROOT, CADENCE), "utf8");
  const keep = constantMs(source, "SNAPSHOT_KEEP");
  const interval = constantMs(source, "SNAPSHOT_INTERVAL_MS");
  const quarter = constantMs(source, "QUARTER_MS");
  console.log(
    `retention-outlasts-the-checklist: ${keep} snapshots x ${days(interval)} day(s) = ` +
    `${days(keep * interval)} days of history, against a ${days(quarter)}-day checklist question. OK.`,
  );
}
