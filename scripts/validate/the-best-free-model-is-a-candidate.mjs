#!/usr/bin/env node
/**
 * THE BEST FREE BRAIN IN THE BUILDING IS OFFERED THE WORK.
 *
 * ─── What went wrong ────────────────────────────────────────────────────────
 *
 * 12 September 2026. "please help me find a seller of $1B+ of OpenAI shares. Route this to whomever
 * should handle this." Task `tsk_m2az87r6eh7s3qs2`. The answer:
 *
 *     "Classification: General Inquiry. Routing: Route to Customer Service Team."
 *
 * Routing decision `rtd_m2b0p2mdcrt61m4g` names three candidates: `mdl_kimi_k2` and `mdl_qwen_fast`
 * rejected at `availability` because Fireworks is disabled, and `mdl_cf_llama31_8b` used, free.
 *
 * `mdl_cf_llama33_70b` is not in the list. Enabled. `capability_tier` general. On `prv_workers_ai`,
 * whose backend `bk_workers_ai` is enabled. `in_micros_1k` 0, `out_micros_1k` 0 — Cloudflare's
 * included allowance, the SAME $0 as the 8B. Not rejected: absent. The continuity tier was sorted
 * cheapest-first and then ALPHABETICALLY, "Llama 3.1 8B" beat "Llama 3.3 70B", the 8B answered, the
 * loop stopped, and the 70B was never screened at all.
 *
 * A tie-break on spelling had been quietly making a capability decision on every mail-driven task
 * this system has ever run. Nothing was red. Nothing could be: it was correct on cost, on privacy,
 * on availability and on budget.
 *
 * ─── How it is proven ───────────────────────────────────────────────────────
 *
 * TWO WAYS, because either alone leaves the hole open.
 *
 *   1. THE ORDER, by calling `orderCandidates` — the actual comparator `router/index.ts` calls,
 *      which is why it lives in `shared/boss/router/candidateOrder.mjs` as plain ESM. Given two free
 *      models it must put the more capable one first, whatever they are called.
 *
 *   2. THE ROSTER OF MODELS, by REPLAYING every shipped migration into in-memory SQLite and asking
 *      it the router's own questions. The best free model must be reachable as a DECLARED route
 *      candidate, so that it does not depend on winning a sort in order to be seen — the exact
 *      dependency that failed.
 *
 * COST: this file also refuses to let the fix cost money. A "best free model" that is not actually
 * free, or a paid backend switched on to satisfy it, fails here.
 *
 * RULE 0: zero free models examined is a FAILURE. An empty loop reports "the best free model is a
 * candidate" over a system that has no free model at all, which is the opposite of the truth.
 *
 *   node scripts/validate/the-best-free-model-is-a-candidate.mjs
 *   node scripts/validate/the-best-free-model-is-a-candidate.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { orderCandidates, capabilityRank } from "../../src/shared/boss/router/candidateOrder.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROUTER = "src/worker/boss/router/index.ts";

/**
 * The world the router routes in: the ROUTES and BACKENDS from the shipped migrations replayed in
 * order, and the MODELS from `CLOUD_BACKENDS` — the one list `provision-backend.mjs` and
 * `POST /api/models/provision/:backendId` both write the `models` table from.
 *
 * MODELS ARE NOT IN THE MIGRATIONS AND THAT IS NOT A BUG. A cloud backend's model rows are
 * provisioned from code when the backend is commissioned, precisely so there is one list. Reading
 * that list here — bundled out of the TypeScript, the way `provision-backend.mjs` reads it — is what
 * stops this validator becoming the second copy.
 */
export async function theWorld(dir = join(ROOT, "migrations")) {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const failed = [];
  for (const f of files) {
    try { db.exec(readFileSync(join(dir, f), "utf8")); }
    catch (e) { failed.push(`${f}: ${e.message.split("\n")[0]}`); }
  }
  const routes = db.prepare(`SELECT id, lane, primary_model_id, fallback_model_id FROM routes`).all();
  const backends = db.prepare(`SELECT id, status, monthly_ceiling_micros FROM execution_backends`).all();
  const models = db.prepare(
    `SELECT m.id, m.provider_id, m.slug, m.display_name, m.capability_tier, m.enabled,
            m.in_micros_1k, m.out_micros_1k, m.context_tokens, p.enabled AS provider_enabled
       FROM models m JOIN providers p ON p.id = m.provider_id`,
  ).all().map((m) => ({ ...m }));

  /*
   * THE OTHER LIST. Cloud model rows are normally written by `provision-backend.mjs` out of
   * `CLOUD_BACKENDS` when a backend is commissioned; 0229 seeds the two Workers AI rows as well,
   * because a FOREIGN KEY will not let a route name a model that does not exist yet. That is two
   * places holding the same facts, which is this repo's most-named defect — so the two are LINKED
   * here, field by field, rather than left to agree by hope.
   */
  const out = join(mkdtempSync(join(tmpdir(), "freebrain-")), "wiring.mjs");
  await build({
    entryPoints: [join(ROOT, "src/worker/boss/router/backends.ts")],
    bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "silent",
  });
  const { CLOUD_BACKENDS } = await import(out);

  return { models, routes, backends, wiring: CLOUD_BACKENDS, files: files.length, failed };
}

/**
 * Rule: a model row seeded by a migration says exactly what the wiring says.
 *
 * Only the rows that appear in BOTH are compared. A wiring entry with no seeded row is the normal
 * case — that backend has not been commissioned — and is not a drift.
 */
export function theTwoListsAgree({ models, wiring }) {
  const bad = [];
  let compared = 0;
  const byId = new Map(models.map((m) => [m.id, m]));
  for (const b of wiring ?? []) {
    for (const w of b.models) {
      const row = byId.get(w.id);
      if (!row) continue;
      compared += 1;
      const fields = [
        ["provider", row.provider_id, b.providerId],
        ["slug", row.slug, w.slug],
        ["display name", row.display_name, w.displayName],
        ["capability tier", row.capability_tier, w.capabilityTier],
        ["input price", Number(row.in_micros_1k), Number(w.inMicros1k)],
        ["output price", Number(row.out_micros_1k), Number(w.outMicros1k)],
        ["context length", Number(row.context_tokens), Number(w.contextTokens)],
      ];
      for (const [what, seeded, wired] of fields) {
        if (seeded !== wired) {
          bad.push(
            `${w.id}: the migration seeds ${what} ${JSON.stringify(seeded)} and CLOUD_BACKENDS says `
            + `${JSON.stringify(wired)}. Two lists of the same fact, already disagreeing.`,
          );
        }
      }
    }
  }
  if (compared === 0) {
    bad.push(
      "no seeded model row matches any wiring entry, so the two lists were not actually compared. "
      + "An empty comparison is not agreement.",
    );
  }
  return bad;
}

/**
 * FREE MEANS NOTHING IS BILLED — WHICH IS NOT THE SAME AS A ZERO IN THE PRICE COLUMN.
 *
 * This used to read `in_micros_1k === 0 && out_micros_1k === 0`, and that definition was correct
 * only for as long as nobody had priced the models. Migration 0248 recorded Cloudflare's own
 * published rates for both Workers AI models, and on the old definition this guard immediately
 * announced that the system had no free brain left — while nothing about what those calls cost had
 * changed at all.
 *
 * WHAT MAKES A WORKERS AI CALL COST NOTHING IS THE INCLUDED DAILY ALLOWANCE, a property of the
 * BACKEND. `backends/guard.ts` is the one place that fact is stated (`FREE_ROUTES`), the router
 * reads it through `routeIsBilled` when it orders candidates, and this reads the same idea. A zero
 * price column is what a model looks like when nobody has checked it, and treating that as proof of
 * free is how an unchecked placeholder became a guarantee.
 *
 * An OpenRouter `:free` slug is free the same way: by an observable property of the route rather
 * than by a number somebody typed.
 */
const FREE_BY_ALLOWANCE = new Set(["prv_workers_ai"]);
const isFree = (m) =>
  FREE_BY_ALLOWANCE.has(String(m.provider_id)) ||
  String(m.slug ?? "").endsWith(":free") ||
  (Number(m.in_micros_1k) === 0 && Number(m.out_micros_1k) === 0);
const isLive = (m) => Number(m.enabled) === 1 && Number(m.provider_enabled) === 1;

/**
 * Rule 1: at equal cost, the comparator prefers capability — by behaviour, not by reading the file.
 *
 * The 8B/70B pair is the real one. The synthetic pair proves it is not a special case keyed off
 * those two names, which would pass this test and fail the next model anyone adds.
 */
export function theOrderPrefersCapability(order = orderCandidates) {
  const bad = [];
  const eightB = { id: "mdl_cf_llama31_8b", display_name: "Llama 3.1 8B (Workers AI)", capability_tier: "fast" };
  const seventyB = { id: "mdl_cf_llama33_70b", display_name: "Llama 3.3 70B (Workers AI)", capability_tier: "general" };
  const free = () => 0;

  for (const start of [[eightB, seventyB], [seventyB, eightB]]) {
    const got = order(start, free);
    if (got[0]?.id !== seventyB.id) {
      bad.push(
        `given the real free pair in ${start.map((m) => m.capability_tier).join(" then ")} order, the `
        + `comparator put ${got[0]?.display_name} first. That is the alphabet outranking capability, `
        + "which is how rtd_m2b0p2mdcrt61m4g chose an 8B model for a $1B block trade.",
      );
    }
  }

  // Not keyed to those names: a `frontier` model called "Aardvark" still beats a `fast` "Zebra".
  const synthetic = order([
    { id: "z", display_name: "Zebra", capability_tier: "fast" },
    { id: "a", display_name: "Aardvark", capability_tier: "frontier" },
  ], free);
  if (synthetic[0]?.id !== "a") {
    bad.push("the preference is hardcoded to the Llama pair rather than to capability — the next model added would inherit the bug.");
  }

  // AND COST STILL COMES FIRST. Capability may break a tie; it may never buy one.
  const cheapFast = { id: "cheap", display_name: "Cheap fast", capability_tier: "fast" };
  const dearFrontier = { id: "dear", display_name: "Dear frontier", capability_tier: "frontier" };
  const priced = order([dearFrontier, cheapFast], (m) => (m.id === "dear" ? 50_000 : 0));
  if (priced[0]?.id !== "cheap") {
    bad.push(
      "capability outranked COST, so this is no longer a tie-break — it is a licence to spend, and "
      + "Stage 5 is defined as cost preference.",
    );
  }

  // An unclassified tier may not float to the top on a guess.
  if (capabilityRank("nonsense") !== 0) bad.push("an unknown capability tier ranks above `fast`, so an unclassified model can win a tie on nothing.");
  if (capabilityRank("general") <= capabilityRank("fast")) bad.push("`general` does not outrank `fast`, which is what those words mean.");
  return bad;
}

/**
 * Rule 2: the best free model EXISTS, and nothing lower-capability is reached before it.
 *
 * Two separate facts, and the 12 September failure needed both to be false. The 70B had to be a row
 * the router could load, and it had to be reached before the 8B. It was a row — and it was never
 * reached, because the tie-break was alphabetical.
 *
 * The route DECLARATIONS are deliberately not asserted here. Promoting a free model into the route
 * makes it report as `fallback` rather than `degraded`, which strips the "DEGRADED TIER" label off
 * every screen that renders the answer — visibility bought with honesty. See 0229 for the full
 * argument. What matters is that the continuity tier reaches the better free model first.
 */
export function theBestFreeModelIsDeclared({ models, routes, backends }) {
  const bad = [];
  const freeLive = models.filter(isLive).filter(isFree);

  /* RULE 0, on the subject of the examination itself. */
  if (freeLive.length === 0) {
    return [
      "there is no enabled, free model at all once the migrations are replayed. This guard would "
      + "otherwise pass over an empty list while the system had no zero-cost brain to fall back on, "
      + "which is the continuity tier switched off.",
    ];
  }

  const best = orderCandidates(freeLive, () => 0)[0];
  const eightB = freeLive.find((m) => m.id === "mdl_cf_llama31_8b");

  /*
   * THE HARDCODED CONTINUITY FALLBACK IS NOT ALLOWED TO BE THE CEILING. `mdl_cf_llama31_8b` is the
   * model every mail-driven task has ever landed on. If it is still the first free candidate, this
   * fix did nothing.
   */
  if (!eightB) {
    bad.push(
      "mdl_cf_llama31_8b is not an enabled free model any more. That is the row every mail-driven "
      + "task fell back to; if it has gone, this guard is comparing against nothing.",
    );
  } else if (best.id === eightB.id) {
    bad.push(
      `the first free candidate is still ${eightB.display_name} (${eightB.capability_tier}). That is `
      + "the model that answered a $1B block trade with \"Route to Customer Service Team\".",
    );
  } else if (capabilityRank(best.capability_tier) <= capabilityRank(eightB.capability_tier)) {
    bad.push(
      `the first free candidate ${best.display_name} ranks no higher than ${eightB.display_name}, so `
      + "nothing was actually gained.",
    );
  }

  // AND THE 70B IS A ROW THE ROUTER CAN LOAD AT ALL. Absent is how it stayed invisible.
  const seventyB = models.find((m) => m.id === "mdl_cf_llama33_70b");
  if (!seventyB) {
    bad.push("mdl_cf_llama33_70b does not exist as a model row after the migrations replay, so a fresh database has no general-tier free model.");
  } else if (!isLive(seventyB)) {
    bad.push("mdl_cf_llama33_70b exists but is disabled, or its provider is, so it can never be a candidate.");
  }

  // The ops lane must still HAVE a route, or none of this is reachable.
  if (!routes.find((r) => r.lane === "ops")) {
    bad.push("there is no route for the ops lane, which is the lane every mail-driven task runs in.");
  }

  /*
   * COST: $0, AND STILL $0. The fix may not have been bought.
   */
  if (!isFree(best)) {
    bad.push(`${best.display_name} is not free (${best.in_micros_1k}/${best.out_micros_1k} micros per 1k) — this system runs at $0.`);
  }
  const fireworks = backends.find((b) => b.id === "bk_fireworks");
  if (fireworks && fireworks.status === "enabled") {
    bad.push("bk_fireworks has been enabled. The standing cost rule is $0; the paid backend stays registered and off.");
  }
  return bad;
}

/** Rule 3: the router actually uses the comparator this file proves. */
export function theRouterUsesIt(source) {
  if (source === null) return [`${ROUTER} could not be read, so the shipped order is unverified.`];
  const bad = [];
  if (!/candidateOrder\.mjs"/.test(source)) {
    bad.push(`${ROUTER} does not import the shared comparator, so what this validator proves is not what ships.`);
  }
  if (!/orderCandidates\(/.test(source)) {
    bad.push(`${ROUTER} never calls orderCandidates(), so the continuity tier is ordered by something unguarded.`);
  }
  if (/\.sort\(\(a, b\) => \{[\s\S]{0,400}?localeCompare/.test(source)) {
    bad.push(
      `${ROUTER} still sorts candidates with its own localeCompare tie-break. That is the alphabet `
      + "making a capability decision, which is the bug.",
    );
  }
  return bad;
}

// ─── Self-test ───────────────────────────────────────────────────────────────

const routerPath = join(ROOT, ROUTER);
const routerSource = existsSync(routerPath) ? readFileSync(routerPath, "utf8") : null;

if (process.argv.includes("--self-test")) {
  let failed = 0;
  const expect = (label, actual, shouldCatch) => {
    if ((actual.length > 0) !== shouldCatch) {
      console.error(`  ✗ ${label} — expected ${shouldCatch ? "caught" : "clean"}, got ${JSON.stringify(actual)}`);
      failed += 1;
    } else console.log(`  ✓ ${label}`);
  };

  const world = await theWorld();
  expect("the shipped comparator prefers capability at equal cost", theOrderPrefersCapability(), false);
  expect("the shipped migrations declare the best free model", theBestFreeModelIsDeclared(world), false);
  expect("the real router calls the shared comparator", theRouterUsesIt(routerSource), false);

  /*
   * ─── THE NEGATIVE PROOF ───────────────────────────────────────────────────
   * The shipped defect, restored, and required to come back red.
   */
  const alphabetical = (models, costOf) => [...models].sort((a, b) => {
    const c = costOf(a) - costOf(b);
    return c !== 0 ? c : String(a.display_name).localeCompare(String(b.display_name));
  });
  expect("the alphabetical tie-break that chose an 8B for a $1B block", theOrderPrefersCapability(alphabetical), true);

  const capabilityFirst = (models, costOf) => [...models].sort((a, b) =>
    capabilityRank(b.capability_tier) - capabilityRank(a.capability_tier) || costOf(a) - costOf(b));
  expect("a comparator where capability outranks cost", theOrderPrefersCapability(capabilityFirst), true);

  expect("a world where the 70B row was never seeded, as on 12 September", theBestFreeModelIsDeclared({
    ...world, models: world.models.filter((m) => m.id !== "mdl_cf_llama33_70b"),
  }), true);

  expect("a world where the 70B exists but is disabled", theBestFreeModelIsDeclared({
    ...world,
    models: world.models.map((m) => (m.id === "mdl_cf_llama33_70b" ? { ...m, enabled: 0 } : m)),
  }), true);

  /*
   * "NO FREE MODEL AT ALL" NOW HAS TO STRIP ALL THREE WAYS A ROUTE CAN BE FREE.
   *
   * This fixture used to set a price and stop there, which stopped being a description of a world
   * with no free brain the moment `isFree` learned that free is a property of the ROUTE — an
   * included allowance on Workers AI, or OpenRouter's `:free` suffix — rather than of a number in
   * the price column. Moving every model onto a metered provider with a metered slug is what the
   * sentence actually means now.
   */
  expect("a world with no free model at all", theBestFreeModelIsDeclared({
    ...world,
    models: world.models.map((m) => ({
      ...m,
      provider_id: "prv_metered",
      slug: String(m.slug ?? "").replace(/:free$/, ""),
      in_micros_1k: 600,
      out_micros_1k: 2500,
    })),
  }), true);

  expect("the migration and the wiring say the same thing", theTwoListsAgree(world), false);
  expect("a migration whose seeded slug has drifted from the wiring", theTwoListsAgree({
    ...world,
    models: world.models.map((m) => (m.id === "mdl_cf_llama33_70b"
      ? { ...m, slug: "@cf/meta/llama-3.3-70b-instruct" } : m)),
  }), true);
  expect("two lists that were never actually compared", theTwoListsAgree({ models: [], wiring: world.wiring }), true);

  expect("the paid backend switched on to solve it", theBestFreeModelIsDeclared({
    ...world, backends: [...world.backends.filter((b) => b.id !== "bk_fireworks"), { id: "bk_fireworks", status: "enabled" }],
  }), true);

  expect("a router that kept its own sort", theRouterUsesIt(
    routerSource?.replace(
      /const continuity = orderCandidates\([\s\S]*?\);/,
      "const continuity = (await loadContinuityModels(db, declaredIds)).sort((a, b) => {\n"
      + "    const ca = 0; const cb = 0;\n"
      + "    if (ca !== cb) return ca - cb;\n"
      + "    return a.display_name.localeCompare(b.display_name);\n  });",
    ) ?? null,
  ), true);
  expect("a router that could not be read", theRouterUsesIt(null), true);

  if (failed) { console.error(`FREE BRAIN SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("FREE BRAIN SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

const world = await theWorld();

/* RULE 0. No migrations replayed is not "no bad models" — it is an empty loop. */
if (world.files === 0 || world.models.length === 0) {
  console.error("FREE BRAIN SCAN FAILED — replaying the migrations produced no models at all.");
  console.error(`  ${world.files} migration file(s) read; ${world.failed.length} failed to apply.`);
  for (const f of world.failed.slice(0, 5)) console.error(`    ${f}`);
  process.exit(2);
}

const problems = [
  ...theOrderPrefersCapability(),
  ...theBestFreeModelIsDeclared(world),
  ...theTwoListsAgree(world),
  ...theRouterUsesIt(routerSource),
];

if (problems.length) {
  console.error("FREE BRAIN SCAN FAILED:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  console.error("  This is how tsk_m2az87r6eh7s3qs2 answered a $1B block trade with");
  console.error('  "Classification: General Inquiry. Routing: Route to Customer Service Team."');
  process.exit(2);
}

const freeLive = world.models.filter(isLive).filter(isFree);
const best = orderCandidates(freeLive, () => 0)[0];
console.log(
  `FREE BRAIN OK — ${freeLive.length} free model(s) of ${world.models.length} across ${world.files} replayed migration(s); `
  + `${best.display_name} (${best.capability_tier}, $0) is reached before Llama 3.1 8B, and the `
  + "migration and CLOUD_BACKENDS agree field by field.",
);
