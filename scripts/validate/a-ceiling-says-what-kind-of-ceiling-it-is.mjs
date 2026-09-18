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
import { DatabaseSync } from "node:sqlite";
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

/**
 * EVERY migration that touches the backend spend columns, in order, comments stripped.
 *
 * ─── IT USED TO BE "THE NEWEST ONE", AND THAT WAS A LATENT BUG THIS FILE FOUND THE HARD WAY ────
 *
 * The declarations live in 0239. This function returned only the LAST file mentioning `spend_kind`,
 * which was 0239 right up until migration 0256 registered a new backend and set `spend_kind` on
 * that one row. From that moment the authority this validator inspected was a file containing one
 * declaration, and it reported that Workers AI, OpenRouter, the local runtime and Claude Code had
 * all lost theirs — four false failures, on rows nobody had touched.
 *
 * "The newest file that mentions the column" was only ever a proxy for "what the column says now",
 * and the proxy breaks the first time a declaration is added somewhere else. Migrations are
 * CUMULATIVE, so the honest reading is the cumulative one, and reading all of them is strictly
 * stronger than reading one: a declaration can now live in any migration and still be found, and a
 * declaration deleted from the only file that had it is still caught.
 *
 * THE END STATE IS ALSO CHECKED, separately and by replay, in `declaredState()` below. Text and
 * state answer different questions — "was it written down" and "is it true after every migration
 * runs" — and this file now asks both, because a later migration could silently overwrite an
 * earlier declaration and the text check alone would never see it.
 */
export function spendMigration(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const touching = [];
  for (const f of files) {
    const src = readFileSync(join(migrationsDir, f), "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    if (/spend_kind|ceiling_source|cost_basis/.test(src)) touching.push(src);
  }
  return touching.length === 0 ? null : touching.join("\n");
}

/**
 * What the spend columns ACTUALLY say once every migration has run.
 *
 * Replayed into in-memory SQLite, the way `validate:ladder` and `validate:free-brain` read the
 * world. This is the half the text check cannot do: a later migration that overwrote an earlier
 * declaration would leave the old text sitting in an old file, matching the regex, while the
 * database said something else entirely.
 *
 * Returns null if the replay produced nothing, which Rule 0 turns into a failure rather than a pass.
 */
export function declaredState(migrationsDir) {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    try { db.exec(readFileSync(join(migrationsDir, f), "utf8")); } catch { /* replayed best-effort */ }
  }
  try {
    const rows = db.prepare(
      `SELECT id, spend_kind, cost_basis, ceiling_source FROM execution_backends`,
    ).all();
    return rows.length === 0 ? null : rows.map((r) => ({ ...r }));
  } catch {
    return null;
  }
}

export function check({ sentences, plans, registry, route, screen, migration, state }) {
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

  /*
   * ── THE END STATE, NOT ONLY THE TEXT ──────────────────────────────────────
   *
   * Everything above asks whether a declaration was WRITTEN. This asks whether it is TRUE after
   * every migration has run, which is the only version of the question the screen actually renders.
   * A later migration that overwrote one of these would leave the original text in an old file,
   * still matching, while the row said something else.
   */
  if (state === null) {
    problems.push(
      `Replaying the migrations produced no execution_backends rows, so the spend kinds were checked ` +
      `only as text. A declaration nobody can read back is not a declaration.`,
    );
  } else {
    const byId = new Map(state.map((r) => [r.id, r]));
    let examined = 0;
    for (const c of ZERO_CASES) {
      const r = byId.get(c.id);
      if (!r) { problems.push(`\`${c.id}\` does not exist after the migrations replay, so its $0.00 says nothing.`); continue; }
      examined += 1;
      if (r.spend_kind !== c.kind) {
        problems.push(`\`${c.id}\` ends up \`${r.spend_kind}\` after every migration, not \`${c.kind}\` — it is ${c.why}.`);
      }
      if (r.cost_basis !== c.basis) {
        problems.push(`\`${c.id}\` ends up cost_basis \`${r.cost_basis}\`, not \`${c.basis}\`, so the screen prices it wrongly.`);
      }
    }
    const claude = byId.get("bk_claude_code");
    if (claude && claude.ceiling_source !== "plan") {
      problems.push(
        `\`bk_claude_code\` ends up ceiling_source \`${claude.ceiling_source}\` after every migration. ` +
        `A hand-set figure goes stale the moment she upgrades and nothing notices.`,
      );
    }
    /*
     * EVERY SUBSCRIPTION SEAT, not just the one that existed when this was written. 0256 added a
     * second ($0 on her ChatGPT Plus plan), and a seat recorded as `invoiced` is the fake-invoice
     * defect 0239 exists to prevent — she read one for a week.
     */
    for (const r of state) {
      if (r.cost_basis === "plan_equivalent") examined += 1;
      if (/^bk_(claude_code|codex)$/.test(r.id) && r.cost_basis !== "plan_equivalent") {
        problems.push(
          `\`${r.id}\` runs on one of her own subscriptions and is recorded cost_basis ` +
          `\`${r.cost_basis}\`. No card is charged for it, and a figure that looks like a bill and is ` +
          `not one is exactly what 0239 was written to stop.`,
        );
      }
    }
    /* RULE 0 for this rule specifically. */
    if (examined === 0) {
      problems.push(`No backend row was actually examined for its spend kind, so this rule passed over an empty loop.`);
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
    state: declaredState(join(ROOT, "migrations")),
  };

  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    /*
     * ─── THE END-STATE RULE, PROVEN NEGATIVELY ────────────────────────────────
     * Added with the rule itself: a guard nobody has watched fail is not a guard.
     */
    {
      name: "THE BUG THAT FOUND THIS: only the newest migration inspected, so declarations elsewhere vanish",
      // Exactly what `spendMigration` used to return once 0256 set spend_kind on one new row.
      input: { ...good, migration: "UPDATE execution_backends SET spend_kind = 'free' WHERE id = 'bk_codex';" },
      expect: 4,
    },
    {
      name: "a row whose end state contradicts the declaration written in an older migration",
      input: {
        ...good,
        state: good.state.map((r) => (r.id === "bk_workers_ai" ? { ...r, spend_kind: "capped" } : r)),
      },
      expect: 1,
    },
    {
      name: "a subscription seat recorded as though a card were charged",
      input: {
        ...good,
        state: good.state.map((r) => (r.id === "bk_codex" ? { ...r, cost_basis: "invoiced" } : r)),
      },
      expect: 1,
    },
    {
      name: "Claude Code's ceiling hand-set again instead of derived from the plan",
      input: {
        ...good,
        state: good.state.map((r) => (r.id === "bk_claude_code" ? { ...r, ceiling_source: "stored" } : r)),
      },
      expect: 1,
    },
    {
      name: "a replay that produced no rows at all, which must not read as agreement",
      input: { ...good, state: null },
      expect: 1,
    },
    {
      name: "a state with no backend row to examine — Rule 0 on this rule",
      input: { ...good, state: [] },
      expect: 4,
    },
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
    state: declaredState(join(ROOT, "migrations")),
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
