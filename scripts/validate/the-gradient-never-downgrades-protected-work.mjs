#!/usr/bin/env node
/**
 * THE GRADIENT TIGHTENS ON ITS OWN, HER HAND STILL WINS, AND PROTECTED WORK IS NEVER DOWNGRADED.
 *
 * ─── What this exists to stop coming back ───────────────────────────────────────────────────────
 *
 * A spend control that gets more careful as money runs out has exactly one way to go wrong, and it
 * is not "it did not tighten enough". It is that the tightening reaches work it was never supposed
 * to reach, and answers it with a weaker model, and nothing says a downgrade happened. That is the
 * same defect as `rtd_m2b0p2mdcrt61m4g` — an 8B model answering a $1B secondary question with
 * "Route to Customer Service Team" — arrived at through economy rather than through a tie-break.
 *
 * So the guarantee is structural and it is checked structurally:
 *
 *   1. THE GRADIENT RUNS ONLY INSIDE MODERATE. `appliesAt` returns true for exactly one position.
 *      FREE_ONLY stays free at $0 spent and OPEN stays open at $40; her instruction is not a
 *      starting point the gradient may adjust.
 *   2. THE GRADIENT NEVER MOVES THE LEVER. `gradient.ts` writes no setting, anywhere. The only
 *      writer of `spend_lever` is `setSpendLever`, which is reached from her own routes.
 *   3. PROTECTED WORK EXITS BEFORE ANY BAND IS READ. `gradientEffect` returns NO_EFFECT for
 *      protected work on a line ABOVE the first band comparison — so no threshold added later can
 *      create a back door without deleting that line, and deleting it fails this scan.
 *   4. THE PER-RUN FACTOR IS APPLIED, not merely computed, and it is `effect.perRunFactor` — which
 *      is 1 for protected work by construction.
 *   5. AT FREE_ONLY, PAID WORK STOPS AND SAYS SO. The router has an explicit stop that fires when
 *      the LEVER removed a paid candidate and the work is protected, and it breaks out rather than
 *      taking the next free model.
 *   6. THE LADDER IS HER FIVE FIGURES and the two money rungs read the RAW total while the three
 *      care rungs read the PACED one.
 *   7. THE $75 LINE IS COMPARED, not merely stored — the same "runs but inert" test the per-run cap
 *      had to pass.
 *   8. EVIDENCE IS UNKNOWN UNTIL IT IS NOT. `experience.ts` requires runs AND human-decided rows,
 *      no migration back-fills `model_job_outcome`, and the shipped seed leaves it empty.
 *   9. THE LIVE DEFAULT IS MODERATE in the shipped seed, while the CODE default stays FREE_ONLY.
 *
 * RULE 0: zero sources read, or a seed that did not replay, is a HARD FAILURE. Every rule above
 * would otherwise pass over nothing.
 *
 *   node scripts/validate/the-gradient-never-downgrades-protected-work.mjs
 *   node scripts/validate/the-gradient-never-downgrades-protected-work.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const GRADIENT = "src/worker/boss/router/gradient.ts";
const ROUTER = "src/worker/boss/router/index.ts";
const EXPERIENCE = "src/worker/boss/router/experience.ts";
const SPEND = "src/worker/boss/router/spend.ts";

const FILES = [GRADIENT, ROUTER, EXPERIENCE, SPEND];

const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

export function check({ sources, settings, outcomeRows, applied, migrations }) {
  const bad = [];

  // ── RULE 0 ─────────────────────────────────────────────────────────────────
  const present = FILES.filter((f) => (sources[f] ?? "").length > 0);
  if (present.length !== FILES.length) {
    return [`only ${present.length} of ${FILES.length} source files were read, so nothing below was examined`];
  }
  if (!Number.isFinite(applied) || applied < 200) {
    return [`only ${applied} migrations replayed; the seed examined is not the shipped seed`];
  }

  const gradient = code(sources[GRADIENT]);
  const router = code(sources[ROUTER]);
  const experience = code(sources[EXPERIENCE]);

  // ── 1. Only inside MODERATE ────────────────────────────────────────────────
  if (!/export function appliesAt\([^)]*\): boolean \{\s*return position === "MODERATE";\s*\}/.test(gradient)) {
    bad.push(
      `${GRADIENT}'s appliesAt is not exactly "MODERATE". The gradient runs between her instructions; ` +
      `widening this lets it tighten FREE_ONLY or loosen OPEN, which is it overruling her hand.`,
    );
  }

  // ── 2. It never moves the lever ────────────────────────────────────────────
  if (/setSetting|SPEND_LEVER_KEY\s*,|setSpendLever/.test(gradient)) {
    bad.push(`${GRADIENT} writes a setting. The gradient may never move the lever — her hand always wins.`);
  }

  // ── 3. Protected work exits before any band is read ────────────────────────
  const effectFn = /export function gradientEffect\([\s\S]*?\n\}/.exec(gradient)?.[0] ?? "";
  if (!effectFn) {
    bad.push(`${GRADIENT} has no gradientEffect, so there is nothing that decides what the gradient does`);
  } else {
    const guard = effectFn.indexOf("if (protectedWork) return NO_EFFECT;");
    const firstBand = effectFn.search(/state\.band ===/);
    if (guard === -1) {
      bad.push(
        `${GRADIENT}'s gradientEffect does not return NO_EFFECT for protected work. That single line IS the ` +
        `guarantee that protected work is never downgraded anywhere on the gradient.`,
      );
    } else if (firstBand !== -1 && guard > firstBand) {
      bad.push(
        `${GRADIENT} reads a band before it exempts protected work, so a rung can reach protected work. The ` +
        `exemption has to be above every threshold, or a threshold added later becomes a back door.`,
      );
    }
  }

  // ── 4. The factor is applied, and it is the effect's ───────────────────────
  if (!/const effectivePerRunCap = Math\.max\(0, Math\.floor\(perRunCap \* effect\.perRunFactor\)\);/.test(router)) {
    bad.push(
      `${ROUTER} does not narrow the per-run ceiling by effect.perRunFactor. A gradient that computes a ` +
      `factor nothing multiplies is the "runs but inert" defect.`,
    );
  }
  if (!/if \(estimate > effectivePerRunCap\)/.test(router)) {
    bad.push(`${ROUTER} computes an effective per-run cap and compares the estimate against something else`);
  }

  // ── 5. FREE_ONLY stops loudly and does not substitute ──────────────────────
  if (!/lever\.position === "FREE_ONLY" && protectedWork && free && leverRefusedPaid/.test(router)) {
    bad.push(
      `${ROUTER} has no stop for protected work at FREE_ONLY. Without it the loop walks on to the next ` +
      `candidate, finds a free model and answers — which is the silent substitution she ruled out.`,
    );
  }
  if (!/if \(refusal\.code === "lever_free_only"\) leverRefusedPaid = true;/.test(router)) {
    bad.push(`${ROUTER} never records that the LEVER was what removed a paid candidate, so the stop can never fire`);
  }
  if (!/if \(freeOnlyStop\) \{\s*throw new RoutingBlocked\(/.test(router)) {
    bad.push(
      `${ROUTER} does not throw on the FREE_ONLY stop. A BudgetExceeded would become a spend-approval card, ` +
      `which would quietly authorise the downgrade she has already ruled out.`,
    );
  }

  // ── 6. Her five figures, and which total each rung reads ───────────────────
  const ladder = [
    ["GRADIENT_CHEAPER_MICROS", "5_000_000"],
    ["GRADIENT_CAUTIOUS_MICROS", "10_000_000"],
    ["GRADIENT_NOTIFY_MICROS", "50_000_000"],
    ["GRADIENT_HARD_STOP_MICROS", "75_000_000"],
  ];
  for (const [name, value] of ladder) {
    if (!new RegExp(`export const ${name} = ${value};`).test(gradient)) {
      bad.push(`${GRADIENT} does not state ${name} as ${value} — her ladder is not the ladder in force`);
    }
  }
  if (!/return bandFor\(|bandFor\(pace\.pacedMicros\)/.test(gradient)) {
    bad.push(`${GRADIENT}'s band is not taken from the PACED figure, so the ladder is not pro-rated`);
  }
  if (!/notify: pace\.spentMicros >= GRADIENT_NOTIFY_MICROS/.test(gradient)) {
    bad.push(
      `${GRADIENT}'s $50 notice does not read the RAW month-to-date total. A projection must never raise an ` +
      `alarm about money that has not left.`,
    );
  }
  if (!/hardStop: pace\.spentMicros >= GRADIENT_HARD_STOP_MICROS/.test(gradient)) {
    bad.push(`${GRADIENT}'s $75 stop does not read the RAW total, so a forecast could stop work on its own`);
  }
  if (!/const floor = DAY_MS \/ span;/.test(gradient)) {
    bad.push(
      `${GRADIENT} does not floor the elapsed fraction, so any spend at 00:05 on the 1st paces to thousands ` +
      `of dollars and produces an austerity cliff made out of the clock.`,
    );
  }

  // ── 7. The $75 line is compared, not merely stored ─────────────────────────
  if (!/const monthLineReached = gradient\.spentMicros >= monthLine;/.test(router)) {
    bad.push(`${ROUTER} never compares the month's spend against her $75 line`);
  }
  if (!/if \(monthLineReached && !free\)/.test(router)) {
    bad.push(`${ROUTER} computes monthLineReached and refuses nothing on it — a line that stops nothing`);
  }
  if (!/bypassFor\(db, "month", null\)/.test(router)) {
    bad.push(`${ROUTER}'s $75 stop has no bypass, and her ladder says "hard stop, bypass available"`);
  }

  // ── 8. Unknown is unknown ──────────────────────────────────────────────────
  if (!/export const MIN_RUNS = \d+;/.test(experience) || !/export const MIN_HUMAN_CONFIRMATIONS = \d+;/.test(experience)) {
    bad.push(`${EXPERIENCE} does not state both thresholds, so "enough evidence" is not a number anything can check`);
  }
  if (!/const enough = runs >= MIN_RUNS && c\.human >= MIN_HUMAN_CONFIRMATIONS;/.test(experience)) {
    bad.push(
      `${EXPERIENCE} does not require human-decided outcomes before calling a model proven. "The call returned" ` +
      `is not "the work stood", and a confidence built from router rows alone is the paper confidence this replaces.`,
    );
  }
  if (!/if \(!enough\) verdict = "unknown";/.test(experience)) {
    bad.push(`${EXPERIENCE} can reach a verdict other than unknown without enough evidence`);
  }
  if (!/export function mayBePreferredForProtectedWork[\s\S]{0,200}return exp\?\.verdict === "proven";/.test(experience)) {
    bad.push(`${EXPERIENCE} lets something other than a proven record promote a model for protected work`);
  }
  if (/INSERT INTO model_job_outcome|INSERT OR IGNORE INTO model_job_outcome/i.test(migrations)) {
    bad.push(
      `a migration back-fills model_job_outcome. Inventing outcomes so the screens have something to show is ` +
      `the exact defect this table exists to replace.`,
    );
  }
  if (outcomeRows !== 0) {
    bad.push(`the shipped seed contains ${outcomeRows} outcome row(s). Evidence is earned at runtime, never seeded.`);
  }

  // ── 9. Live default MODERATE, code default FREE_ONLY ───────────────────────
  if (settings.spend_lever !== "MODERATE") {
    bad.push(
      `the shipped seed leaves spend_lever as ${JSON.stringify(settings.spend_lever)}. An absent row resolves to ` +
      `FREE_ONLY, which made every paid backend commissioned in 0247 unreachable and said nothing.`,
    );
  }
  const spend = code(sources[SPEND]);
  if (!/isPosition\(raw\) \? raw : "FREE_ONLY"/.test(spend)) {
    bad.push(
      `${SPEND} no longer falls back to FREE_ONLY. Seeding a live default must not weaken the fail-closed rule: ` +
      `a hand-edited or misspelled position still has to land at $0.`,
    );
  }

  return bad;
}

// ─── Gathering ──────────────────────────────────────────────────────────────

function gather() {
  const dir = join(ROOT, "migrations");
  const db = new DatabaseSync(":memory:");
  let applied = 0;
  const files = readdirSync(dir).filter((x) => x.endsWith(".sql")).sort();
  for (const f of files) {
    try {
      db.exec(readFileSync(join(dir, f), "utf8"));
      applied += 1;
    } catch {
      /* a migration node:sqlite cannot parse is skipped; the count above is what makes that safe */
    }
  }
  const rows = (sql) => {
    try {
      return db.prepare(sql).all();
    } catch {
      return [];
    }
  };
  const settings = Object.fromEntries(rows(`SELECT key, value FROM settings`).map((r) => [r.key, r.value]));
  const outcomeRows = rows(`SELECT COUNT(*) AS n FROM model_job_outcome`)[0]?.n ?? -1;
  db.close();

  const sources = {};
  for (const f of FILES) sources[f] = existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), "utf8") : "";
  const migrations = files.map((x) => readFileSync(join(dir, x), "utf8")).join("\n");

  return { sources, settings, outcomeRows: Number(outcomeRows), applied, migrations };
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const good = gather();
  const bend = (file, from, to) => ({
    ...good,
    sources: { ...good.sources, [file]: good.sources[file].replace(from, to) },
  });

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    { name: "RULE 0: no sources read", input: { ...good, sources: {} }, expect: 1 },
    { name: "RULE 0: a seed that did not replay", input: { ...good, applied: 3 }, expect: 1 },
    {
      name: "THE DEFECT: protected work exempted only AFTER a band is read",
      input: bend(GRADIENT, "  if (protectedWork) return NO_EFFECT;\n", ""),
      expect: 1,
    },
    {
      name: "the gradient widened past MODERATE",
      input: bend(GRADIENT, 'return position === "MODERATE";', 'return position !== "OPEN";'),
      expect: 1,
    },
    {
      name: "THE DEFECT: the gradient moving her lever",
      input: bend(GRADIENT, "export function bandFor", 'const x = setSetting;\nexport function bandFor'),
      expect: 1,
    },
    {
      name: "a per-run factor computed and never applied",
      input: bend(ROUTER, "const effectivePerRunCap = Math.max(0, Math.floor(perRunCap * effect.perRunFactor));", "const effectivePerRunCap = perRunCap;"),
      expect: 1,
    },
    {
      name: "THE DEFECT: FREE_ONLY quietly substituting a weaker model",
      input: bend(ROUTER, 'lever.position === "FREE_ONLY" && protectedWork && free && leverRefusedPaid', "false"),
      expect: 1,
    },
    {
      name: "the FREE_ONLY stop downgraded to a spend-approval card",
      input: bend(ROUTER, "if (freeOnlyStop) {\n    throw new RoutingBlocked(", "if (freeOnlyStop) {\n    somethingElse("),
      expect: 1,
    },
    {
      name: "the $75 line stored and never compared",
      input: bend(ROUTER, "if (monthLineReached && !free)", "if (false)"),
      expect: 1,
    },
    {
      name: "THE DEFECT: the $50 notice reading a forecast instead of real money",
      input: bend(GRADIENT, "notify: pace.spentMicros >= GRADIENT_NOTIFY_MICROS", "notify: pace.pacedMicros >= GRADIENT_NOTIFY_MICROS"),
      expect: 1,
    },
    {
      name: "the elapsed floor removed, so the 1st of the month is an austerity cliff",
      input: bend(GRADIENT, "const floor = DAY_MS / span;", "const floor = 0;"),
      expect: 1,
    },
    {
      name: "her ladder quietly renumbered",
      input: bend(GRADIENT, "export const GRADIENT_HARD_STOP_MICROS = 75_000_000;", "export const GRADIENT_HARD_STOP_MICROS = 200_000_000;"),
      expect: 1,
    },
    {
      name: "THE DEFECT: confidence manufactured from router rows alone",
      input: bend(EXPERIENCE, "const enough = runs >= MIN_RUNS && c.human >= MIN_HUMAN_CONFIRMATIONS;", "const enough = runs >= 1;"),
      expect: 1,
    },
    {
      name: "an unproven model allowed to be preferred for protected work",
      input: bend(EXPERIENCE, 'return exp?.verdict === "proven";', "return true;"),
      expect: 1,
    },
    {
      name: "THE DEFECT: outcomes back-filled by a migration",
      input: { ...good, migrations: `${good.migrations}\nINSERT INTO model_job_outcome (id) VALUES ('x');` },
      expect: 1,
    },
    {
      name: "a seed that ships outcome rows",
      input: { ...good, outcomeRows: 12 },
      expect: 1,
    },
    {
      name: "THE DEFECT: the live default left absent",
      input: { ...good, settings: { ...good.settings, spend_lever: undefined } },
      expect: 1,
    },
    {
      name: "the code's fail-closed default weakened alongside the seed",
      input: bend(SPEND, 'isPosition(raw) ? raw : "FREE_ONLY"', 'isPosition(raw) ? raw : "MODERATE"'),
      expect: 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check(c.input).length;
    const ok = c.expect === 0 ? found === 0 : found > 0;
    if (!ok) {
      failed++;
      console.error(`  ✘ ${c.name}: expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
      if (c.expect === 0) for (const p of check(c.input)) console.error(`      • ${p}`);
    }
  }
  if (failed) {
    console.error(`\ngradient self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`gradient self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const world = gather();
  const problems = check(world);
  if (problems.length) {
    console.error("THE GRADIENT SCAN FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }
  console.log(
    `GRADIENT OK — ${world.applied} migrations replayed; the ladder is $5 / $10 / $50 / $75 pro-rated against the ` +
    `month elapsed, it runs only inside MODERATE, it writes no setting, protected work exits before any rung is ` +
    `read, the per-run factor is applied, FREE_ONLY stops protected paid work loudly instead of substituting, the ` +
    `$75 line is compared with a bypass available, every model is UNKNOWN until ${/MIN_RUNS = (\d+)/.exec(world.sources[EXPERIENCE])?.[1]} runs ` +
    `including ${/MIN_HUMAN_CONFIRMATIONS = (\d+)/.exec(world.sources[EXPERIENCE])?.[1]} a person decided, and the seed ships ` +
    `${world.outcomeRows} outcome rows with spend_lever at ${world.settings.spend_lever}.`,
  );
}
