#!/usr/bin/env node
/**
 * A CEILING SAYS WHICH KIND OF CEILING IT IS, AND WHOSE MONEY IT IS.
 *
 * ─── Her words ─────────────────────────────────────────────────────────────
 *
 *   "i see nothing in systems about controlling costs and setting monthly budgets that all got sent
 *    to the backends tab? so claude cieling is $50? i want claude ceiling to be whatever my plan
 *    allows; idk maybe rethink this whole budget thing and give me a budget ceiling for each thing
 *    there..idk / arent we on medium level of costs? what happened to the lever?"
 *
 * ─── Four defects, measured against production ─────────────────────────────
 *
 *   1. THE LEVER WAS NEVER MISSING, IT WAS INVISIBLE. `spend_lever = MODERATE` at $25/month with
 *      `cost_mode = NORMAL` — exactly the "medium" she remembers. Both lived in Settings and
 *      neither appeared on Systems, so the control she was given had vanished from her seat.
 *
 *   2. $0 MEANT THREE OPPOSITE THINGS. Workers AI $0 because it is FREE; OpenRouter $0 because
 *      NOTHING IS AUTHORISED; the local runtime $0 because it is OFF. One number, three meanings,
 *      and the screen showed the number. `Backends.tsx` has rendered "FREE" / "NO CAP" / "up to $x"
 *      from a `spend.kind` the whole time and no row ever carried one — two components each keeping
 *      their own idea, with no link between them.
 *
 *   3. THE $50 WAS A HAND-SET NUMBER. 0222 wrote it and says so in its own comment: "headroom, not
 *      a response to observed spend". A bigger hardcoded number would be the same defect with a
 *      larger digit — it goes stale the moment she changes plan and nothing notices.
 *
 *   4. "$17.03 SPENT" IS NOT MONEY. `bk_claude_code` runs on her Claude subscription: equivalent
 *      usage against a flat fee, no money out. 0195 and 0222 both say so in comments and the screen
 *      said neither, so she has been reading a fake invoice.
 *
 * ─── What is checked, by running the shipped arithmetic ────────────────────
 *
 *   1. THE THREE ZEROES ARE TOLD APART. `spendSentence` must give free, unauthorised and off three
 *      DIFFERENT sentences — checked as difference, not as wording.
 *   2. RESERVE, NOT CAP. The employee ceiling is capacity minus reserve; a 0% reserve gives her
 *      literally "whatever my plan allows"; a 100% reserve leaves the employees nothing rather than
 *      going negative; and changing the TIER moves the ceiling with no row edited.
 *   3. THE DAY STAYS DERIVED. `dailyMicros × 31` never exceeds the ceiling — 0222 found a $2/day cap
 *      under a $50/month ceiling and this is the property that stops it recurring.
 *   4. A PLAN-SOURCED CEILING IS APPLIED AT LOAD, so the dispatch guard, the spend guard and the
 *      Today budget alert all see the derived figure without any of them knowing about plans.
 *   5. A PLAN FIGURE SAYS IT IS NOT A BILL, wherever it is rendered.
 *   6. THE LEVER AND THE COST MODE ARE BOTH CONTROLS ON SYSTEMS, AND STILL TWO THINGS.
 *
 * RULE 0: zero backends with a declared spend kind, or zero plan fixtures evaluated, is a HARD
 * FAILURE.
 *
 *   node scripts/validate/a-ceiling-says-what-kind-of-ceiling-it-is.mjs
 *   node scripts/validate/a-ceiling-says-what-kind-of-ceiling-it-is.mjs --self-test
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerTsResolve } from "./lib/ts-resolve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const PLAN = "src/worker/boss/router/plan.ts";
const REGISTRY = "src/worker/boss/backends/registry.ts";
const SYSTEM_ROUTE = "src/worker/boss/routes/system.ts";
const SCREEN = "src/client/boss/pages/Systems.tsx";

/** The three zero-ceiling rows whose zeroes mean opposite things. */
export const ZERO_CASES = [
  { id: "bk_workers_ai", kind: "free", basis: "free", why: "free — an included allowance on an account already paid for" },
  { id: "bk_openrouter", kind: "capped", basis: "invoiced", why: "nothing authorised — free tiers only until she raises it" },
  { id: "bk_local_runtime", kind: "off", basis: "free", why: "switched off" },
];

export const PLAN_CASES = [
  { name: "Claude Max (5x) with the default reserve", tier: "claude_max_5x", reserve: 25, capacity: 100_000_000, ceiling: 75_000_000 },
  { name: "the same plan with the reserve zeroed — literally whatever the plan allows", tier: "claude_max_5x", reserve: 0, capacity: 100_000_000, ceiling: 100_000_000 },
  { name: "everything reserved", tier: "claude_max_5x", reserve: 100, capacity: 100_000_000, ceiling: 0 },
  { name: "upgrading the plan moves the ceiling with no row edited", tier: "claude_max_20x", reserve: 25, capacity: 200_000_000, ceiling: 150_000_000 },
];

/** The newest migration that touches the backend spend columns, comments stripped. */
export function spendMigration(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let latest = null;
  for (const f of files) {
    const src = readFileSync(join(migrationsDir, f), "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    if (/spend_kind/.test(src)) latest = src;
  }
  return latest;
}

export function check({ sentences, plans, registry, route, screen, migration }) {
  const problems = [];
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const screenCode = code(screen);

  // ── RULE 0 ───────────────────────────────────────────────────────────────
  if (!Array.isArray(sentences) || sentences.length === 0 || !Array.isArray(plans) || plans.length === 0) {
    problems.push(`Zero spend kinds or zero plan fixtures were evaluated, so every rule below examined nothing.`);
    return problems;
  }

  // ── 1. The three zeroes are told apart ───────────────────────────────────
  const said = sentences.map((s) => s.sentence);
  if (new Set(said).size !== said.length) {
    problems.push(
      `Two of the three $0.00 backends produce the SAME sentence: ${JSON.stringify(said)}. Workers AI is $0 ` +
      `because it is free, OpenRouter because nothing is authorised, and the local runtime because it is ` +
      `off — one number, three meanings, and the screen showed the number.`,
    );
  }
  for (const s of sentences) {
    if (!s.sentence || s.sentence.trim() === "") problems.push(`\`${s.id}\` (${s.why}) produced no sentence at all.`);
  }
  if (!migration) {
    problems.push(`No migration declares \`spend_kind\`, so no row carries the kind the screen has always been able to render.`);
  } else {
    for (const c of ZERO_CASES) {
      const re = new RegExp(`spend_kind\\s*=\\s*'${c.kind}'[\\s\\S]{0,300}?${c.id}|${c.id}[\\s\\S]{0,300}?spend_kind\\s*=\\s*'${c.kind}'`);
      if (!re.test(migration)) problems.push(`\`${c.id}\` is not declared as \`${c.kind}\` — it is ${c.why}.`);
    }
    if (!/ceiling_source\s*=\s*'plan'[\s\S]{0,300}?bk_claude_code|bk_claude_code[\s\S]{0,400}?ceiling_source\s*=\s*'plan'/.test(migration)) {
      problems.push(
        `\`bk_claude_code\` does not take its ceiling from the plan. "i want claude ceiling to be whatever ` +
        `my plan allows" — a hand-set figure goes stale the moment she upgrades and nothing notices.`,
      );
    }
    if (!/cost_basis\s*=\s*'plan_equivalent'/.test(migration)) {
      problems.push(`No backend is marked \`plan_equivalent\`, so the subscription figure still reads as a bill.`);
    }
  }

  // ── 2, 3. Reserve, not cap — and the day stays derived ───────────────────
  for (const p of plans) {
    if (p.got.employeeCeilingMicros !== p.ceiling) {
      problems.push(`${p.name}: ceiling came out ${p.got.employeeCeilingMicros} and must be ${p.capacity} − ${p.reserve}% = ${p.ceiling}.`);
    }
    if (p.got.employeeCeilingMicros < 0) problems.push(`${p.name}: the ceiling went negative.`);
    if (p.got.dailyMicros * 31 > p.got.employeeCeilingMicros) {
      problems.push(
        `${p.name}: the derived daily figure (${p.got.dailyMicros}) times 31 exceeds the monthly ceiling ` +
        `(${p.got.employeeCeilingMicros}). That is 0222's defect exactly — a $2/day cap under a $50/month ` +
        `ceiling, two limits that could not both be honoured.`,
      );
    }
  }
  const zeroReserve = plans.find((p) => p.reserve === 0);
  if (zeroReserve && zeroReserve.got.employeeCeilingMicros !== zeroReserve.got.capacityMicros) {
    problems.push(
      `A zero reserve must mean literally "whatever my plan allows" — the ceiling is ` +
      `${zeroReserve.got.employeeCeilingMicros} against a capacity of ${zeroReserve.got.capacityMicros}.`,
    );
  }

  // ── 4. The derived ceiling is applied at load ────────────────────────────
  const registryCode = code(registry);
  if (!/ceiling_source === "plan"/.test(registryCode) || !/planState\s*\(/.test(registryCode)) {
    problems.push(
      `${REGISTRY} does not apply the plan ceiling when a backend is loaded. Applying it anywhere else ` +
      `means the dispatch guard, the spend guard and Today's budget alert each have to be taught about ` +
      `plans — and the one that is not becomes the number that disagrees.`,
    );
  }
  /*
   * BOTH LOADERS, and this was learned from a negative proof that did not fire. The first draft
   * asked only whether the phrase `ceiling_source === "plan"` appeared anywhere in the file — so
   * deleting the guard INSIDE `applyPlanCeiling` left the phrase behind in the `.map()` a line
   * later and the scan passed over a registry that no longer derived anything. The property that
   * matters is that every path which loads a backend goes through the derivation; one that does not
   * is the consumer holding the stale $50.
   */
  for (const loader of ["listBackends", "getBackend"]) {
    const fn = new RegExp(`export async function ${loader}[\\s\\S]*?\\n\\}`).exec(registryCode)?.[0] ?? "";
    if (!/applyPlanCeiling\s*\(/.test(fn)) {
      problems.push(
        `${REGISTRY}'s \`${loader}\` does not route through \`applyPlanCeiling\`, so a backend loaded that ` +
        `way still carries the hand-set ceiling from its row.`,
      );
    }
  }

  // ── 5. A plan figure says it is not a bill ───────────────────────────────
  if (!/basis_note|COST_BASIS_NOTE/.test(code(route))) {
    problems.push(`${SYSTEM_ROUTE} does not send the cost basis with the figures, so nothing downstream can say the subscription usage is not money.`);
  }
  if (!/basis_note/.test(screenCode)) {
    problems.push(
      `${SCREEN} never renders the cost basis. "$17.03 spent" against a flat subscription has been read ` +
      `as an invoice for a week, and 0222 warned about exactly this — an authoritative-looking number ` +
      `that misleads.`,
    );
  }

  // ── 6. Both controls are here, and still two things ──────────────────────
  if (!/setSpendLever\(/.test(screenCode)) {
    problems.push(
      `${SCREEN} has no spend-lever control. She is on MODERATE and asked "what happened to the lever?" ` +
      `— it was never missing, it was invisible, and a readout would leave it that way.`,
    );
  }
  if (!/setSetting\("cost_mode"/.test(screenCode)) {
    problems.push(`${SCREEN} has no cost-mode control, so half of "medium" is still only in Settings.`);
  }
  if (!/api\.costs\(\)/.test(screenCode)) {
    problems.push(`${SCREEN} does not read the consolidated costs answer, so the numbers are scattered again.`);
  }
  if (!/spend_kind/.test(screenCode)) {
    problems.push(`${SCREEN} does not render each backend's spend kind, so a $0.00 still means three things.`);
  }

  return problems;
}

// ─── Running the shipped code ───────────────────────────────────────────────

async function evaluate() {
  registerTsResolve();
  const plan = await import(`file://${join(ROOT, PLAN)}`);
  const sentences = ZERO_CASES.map((c) => ({ ...c, sentence: plan.spendSentence(c.kind, 0, c.basis) }));
  const plans = PLAN_CASES.map((p) => ({ ...p, got: plan.derivePlan(p.tier, p.capacity, p.reserve, true) }));
  return { sentences, plans };
}

// ─── Self-test ──────────────────────────────────────────────────────────────

async function selfTest() {
  const { sentences, plans } = await evaluate();
  const good = {
    sentences,
    plans,
    registry: readFileSync(join(ROOT, REGISTRY), "utf8"),
    route: readFileSync(join(ROOT, SYSTEM_ROUTE), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    migration: spendMigration(join(ROOT, "migrations")),
  };

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "THE DEFECT: the three $0 backends saying the same thing",
      input: { ...good, sentences: good.sentences.map((s) => ({ ...s, sentence: "Up to $0.00 a month." })) },
      expect: 1,
    },
    {
      name: "a ceiling that caps instead of reserving",
      input: { ...good, plans: good.plans.map((p) => (p.reserve === 0 ? { ...p, got: { ...p.got, employeeCeilingMicros: 50_000_000 } } : p)) },
      expect: 1,
    },
    {
      name: "the daily pace exceeding the monthly ceiling again",
      input: { ...good, plans: good.plans.map((p, i) => (i === 0 ? { ...p, got: { ...p.got, dailyMicros: 3_000_000 } } : p)) },
      expect: 1,
    },
    {
      name: "the plan upgrade leaving the ceiling behind",
      input: { ...good, plans: good.plans.map((p) => (p.tier === "claude_max_20x" ? { ...p, got: { ...p.got, employeeCeilingMicros: 75_000_000 } } : p)) },
      expect: 1,
    },
    {
      name: "the derived ceiling no longer applied at load",
      input: { ...good, registry: good.registry.replaceAll('ceiling_source === "plan"', "false") },
      expect: 1,
    },
    {
      name: "the screen dropping the not-a-bill note",
      input: { ...good, screen: good.screen.replaceAll("basis_note", "unused") },
      expect: 1,
    },
    {
      name: "THE INVISIBLE LEVER: no lever control on Systems",
      input: { ...good, screen: good.screen.replaceAll("setSpendLever(", "readOnly(") },
      expect: 1,
    },
    {
      name: "the cost mode left in Settings",
      input: { ...good, screen: good.screen.replaceAll('setSetting("cost_mode"', 'noop("cost_mode"') },
      expect: 1,
    },
    {
      name: "the spend kind never declared on the rows",
      input: { ...good, migration: good.migration.replaceAll("spend_kind = 'free'", "spend_kind = 'capped'") },
      expect: 1,
    },
    {
      name: "bk_claude_code back on a hand-set ceiling",
      input: { ...good, migration: good.migration.replaceAll("ceiling_source = 'plan'", "ceiling_source = 'stored'") },
      expect: 1,
    },
    { name: "RULE 0 — nothing evaluated", input: { ...good, plans: [] }, expect: 1 },
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
    console.error(`\na-ceiling-says-what-kind-of-ceiling-it-is self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`a-ceiling-says-what-kind-of-ceiling-it-is self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const missingFiles = [PLAN, REGISTRY, SYSTEM_ROUTE, SCREEN].filter((f) => !existsSync(join(ROOT, f)));
if (missingFiles.length) {
  console.error(`a-ceiling-says-what-kind-of-ceiling-it-is FAILED — ${missingFiles.join(", ")} missing.`);
  process.exit(1);
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const { sentences, plans } = await evaluate();
  const problems = check({
    sentences,
    plans,
    registry: readFileSync(join(ROOT, REGISTRY), "utf8"),
    route: readFileSync(join(ROOT, SYSTEM_ROUTE), "utf8"),
    screen: readFileSync(join(ROOT, SCREEN), "utf8"),
    migration: spendMigration(join(ROOT, "migrations")),
  });

  if (problems.length) {
    console.error("a-ceiling-says-what-kind-of-ceiling-it-is FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  console.log(
    `a-ceiling-says-what-kind-of-ceiling-it-is: ${sentences.length} kinds of $0.00 told apart in words, ` +
    `${plans.length} plan fixtures where the ceiling is capacity minus reserve and the day never outruns ` +
    `the month, the derived ceiling applied at load, and the lever and cost mode both controls on ` +
    `Systems. OK.`,
  );
}
