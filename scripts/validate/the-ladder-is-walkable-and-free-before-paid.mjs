#!/usr/bin/env node
/**
 * THE LADDER IS ONE LADDER, IT IS WALKABLE, AND IT IS WALKED DOWNWARDS.
 *
 * ─── What this exists to stop ───────────────────────────────────────────────
 *
 * Her instruction, 17 September 2026: "we can move down the line from claude to anyone that is $0
 * that is next best and last resort paid." Migration 0256 registered thirteen lanes to do that.
 *
 * REGISTERING A LANE IS NOT THE SAME AS BEING ABLE TO REACH IT, and this repository has been caught
 * by that gap three separate ways already:
 *
 *   · `bk_openrouter` sat at `registered` from 0173 to 0256. `evaluateBackend` refuses a backend
 *     that is not enabled at its FIRST rule, so both free models registered in 0247 were priced,
 *     documented, and unreachable by anything for the whole of that time. Nothing was red.
 *   · `models.approved_task_kinds` was NULL on every row until 0251, while `evaluateModel` read it
 *     and enforced it faithfully — machinery that runs and governs nothing.
 *   · `NORMAL.allowedTiers` is `["fast","general"]`. Any rung registered `frontier` is refused at
 *     Stage 2 on every ordinary run, so the ladder stops above it and the rungs below are
 *     decoration. A last resort nothing can reach is not a last resort.
 *
 * And the hop limits are the same defect in arithmetic: thirteen rungs under `maxFallbackHops: 1`
 * and `MAX_FREE_HOPS: 2` means a run tries two free lanes and one paid one and stops. Ten lanes
 * would never be reached, and nothing anywhere would say so.
 *
 * ─── How it is proven ───────────────────────────────────────────────────────
 *
 * By REPLAYING every shipped migration into in-memory SQLite and asking the router's own questions
 * of the result, and by calling the SHIPPED comparator — `shared/boss/router/candidateOrder.mjs` —
 * rather than a copy of its judgement. The model rows come from `CLOUD_BACKENDS`, bundled out of
 * the TypeScript the way `provision-backend.mjs` reads it, so this cannot become the second list.
 *
 * RULE 0: zero rungs examined is a FAILURE, loudly. A validator that reports "the ladder is
 * walkable" over an empty ladder is worse than no validator, because it is believed.
 *
 *   node scripts/validate/the-ladder-is-walkable-and-free-before-paid.mjs
 *   node scripts/validate/the-ladder-is-walkable-and-free-before-paid.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { orderCandidates } from "../../src/shared/boss/router/candidateOrder.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROUTER = "src/worker/boss/router/index.ts";
const ADAPTER = "src/worker/boss/router/openrouter.ts";
const GOVERNANCE = "src/shared/boss/governance.ts";

/** The cost mode the owner is actually in. Settings can move it; this is what 0239 measured. */
const LIVE_COST_MODE = "NORMAL";

/**
 * The world the router routes in, replayed from the shipped migrations.
 *
 * `enabled = 1` is read from the row rather than assumed, because half the point of 0256 is that
 * four lanes are registered DISABLED with their refusals quoted — and a disabled lane must be
 * invisible to every rule below except the one that checks it is not on the ladder.
 */
export async function theWorld(dir = join(ROOT, "migrations")) {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const failed = [];
  for (const f of files) {
    try { db.exec(readFileSync(join(dir, f), "utf8")); }
    catch (e) { failed.push(`${f}: ${e.message.split("\n")[0]}`); }
  }
  const models = db.prepare(
    `SELECT m.id, m.provider_id, m.slug, m.display_name, m.capability_tier, m.enabled,
            m.in_micros_1k, m.out_micros_1k, m.context_tokens, m.data_use, m.reasoning,
            m.ladder_rung, m.price_source, p.enabled AS provider_enabled
       FROM models m JOIN providers p ON p.id = m.provider_id`,
  ).all().map((m) => ({ ...m }));
  const backends = db.prepare(
    `SELECT id, status, class, monthly_ceiling_micros, spend_kind, cost_basis FROM execution_backends`,
  ).all().map((b) => ({ ...b }));

  const out = join(mkdtempSync(join(tmpdir(), "ladder-")), "wiring.mjs");
  await build({
    entryPoints: [join(ROOT, "src/worker/boss/router/backends.ts")],
    bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "silent",
  });
  const { CLOUD_BACKENDS } = await import(out);

  return { models, backends, wiring: CLOUD_BACKENDS, files: files.length, failed };
}

const onLadder = (m) => m.ladder_rung !== null && m.ladder_rung !== undefined;
const isLive = (m) => Number(m.enabled) === 1 && Number(m.provider_enabled) === 1;
const isFreeSlug = (m) => String(m.slug ?? "").endsWith(":free") || String(m.provider_id) === "prv_workers_ai";
const rungs = (models) => models.filter(isLive).filter(onLadder).sort((a, b) => a.ladder_rung - b.ladder_rung);

/**
 * Read `allowedTiers` for the live cost mode out of `governance.ts` itself.
 *
 * FROM THE SOURCE, NOT FROM A COPY OF THE LIST. If someone widens or narrows NORMAL, this validator
 * must move with it — a hardcoded `["fast","general"]` here would go on passing while the ladder
 * silently became unreachable, which is the exact failure class this file is about.
 */
export function allowedTiersFor(source, mode = LIVE_COST_MODE) {
  if (source === null) return null;
  const block = new RegExp(`${mode}:\\s*\\{[\\s\\S]*?allowedTiers:\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!block) return null;
  return block[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/** Read a numeric constant out of a source file, so the limits are never a second copy either. */
export function numberFrom(source, name) {
  if (source === null) return null;
  const m = new RegExp(`${name}\\s*[:=]\\s*(\\d+)`).exec(source);
  return m ? Number(m[1]) : null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RULE 1 — EVERY RUNG IS REACHABLE IN THE LIVE COST MODE.
 * ═══════════════════════════════════════════════════════════════════════════ */
export function everyRungIsReachable({ models }, allowedTiers) {
  const bad = [];
  const ladder = rungs(models);

  /* RULE 0. */
  if (ladder.length === 0) {
    return ["no enabled model carries a ladder_rung, so there is no ladder to walk and this guard examined nothing."];
  }
  if (!allowedTiers || allowedTiers.length === 0) {
    return [`allowedTiers for ${LIVE_COST_MODE} could not be read from ${GOVERNANCE}, so reachability is unverified.`];
  }

  for (const m of ladder) {
    if (!allowedTiers.includes(String(m.capability_tier))) {
      bad.push(
        `rung ${m.ladder_rung} ${m.display_name} is tier "${m.capability_tier}" and cost mode ` +
        `${LIVE_COST_MODE} allows only ${allowedTiers.join(", ")} — it is refused at Stage 2 on every ` +
        "ordinary run, so this rung and the reason for registering it are decoration.",
      );
    }
  }
  return bad;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RULE 2 — THE HOP LIMITS REACH THE BOTTOM OF THE LADDER.
 *
 * Thirteen lanes under a limit of one is the whole point of the brief. The free half and the paid
 * half are bounded by two DIFFERENT limits, so both are checked against the half they govern.
 * ═══════════════════════════════════════════════════════════════════════════ */
export function theHopLimitsReachTheBottom({ models }, maxFreeHops, maxFallbackHops) {
  const bad = [];
  const ladder = rungs(models);
  const free = ladder.filter(isFreeSlug);
  const paid = ladder.filter((m) => !isFreeSlug(m));

  if (ladder.length === 0) return ["there is no ladder, so the hop limits govern nothing."];
  if (maxFreeHops === null) return [`MAX_FREE_HOPS could not be read from ${ROUTER}, so the free walk is unverified.`];
  if (maxFallbackHops === null) return [`maxFallbackHops for ${LIVE_COST_MODE} could not be read from ${GOVERNANCE}.`];

  /*
   * THE FREE LIMIT MUST COVER EVERY FREE RUNG. A free attempt costs no money, so there is no
   * argument for stopping short of a lane that is sitting there for nothing — the limit exists to
   * bound latency, not spend, and a bound that hides registered lanes is the wrong bound.
   */
  if (maxFreeHops < free.length) {
    bad.push(
      `MAX_FREE_HOPS is ${maxFreeHops} and there are ${free.length} free rungs, so ${free.length - maxFreeHops} ` +
      "of them can never be reached on a single run however hard the earlier ones fail. A free attempt " +
      "spends nothing, so this bound is hiding lanes rather than protecting a budget.",
    );
  }

  /*
   * THE PAID LIMIT IS DELIBERATELY NOT REQUIRED TO COVER EVERY PAID RUNG, and that asymmetry is the
   * point rather than an oversight. A paid hop spends money, so "reach them all" is not a goal —
   * three is the depth the owner authorised. What is forbidden is a limit so low that the ladder
   * cannot be walked at all, which is where it was: at 1, the second-cheapest paid lane was
   * unreachable and the ladder had no depth to speak of.
   */
  if (paid.length > 1 && maxFallbackHops < 2) {
    bad.push(
      `${LIVE_COST_MODE}.maxFallbackHops is ${maxFallbackHops} with ${paid.length} paid rungs registered. ` +
      "One hop means a run tries the cheapest paid lane and stops, so every rung below it is decoration " +
      "and an outage on one lane ends the run rather than falling to the next.",
    );
  }
  return bad;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RULE 3 — THE ORDER IS FREE BEFORE PAID, AND THE SHIPPED COMPARATOR PRODUCES IT.
 *
 * By CALLING the comparator, not by reading it. The cost function mirrors the router's: a free
 * route is 0 because `routeIsBilled` says so, a metered one is its list price.
 * ═══════════════════════════════════════════════════════════════════════════ */
export function theOrderIsFreeBeforePaid({ models }, order = orderCandidates) {
  const bad = [];
  const ladder = rungs(models);
  if (ladder.length === 0) return ["there is no ladder to order."];

  const costOf = (m) => (isFreeSlug(m) ? 0 : Number(m.in_micros_1k) + Number(m.out_micros_1k));
  // Shuffled deterministically, so passing cannot depend on the rows arriving already sorted.
  const shuffled = [...ladder].sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)));
  const got = order(shuffled, costOf);

  let seenPaid = null;
  for (const m of got) {
    if (!isFreeSlug(m)) { seenPaid ??= m; continue; }
    if (seenPaid) {
      bad.push(
        `${m.display_name} costs nothing and the comparator puts it AFTER ${seenPaid.display_name}, ` +
        "which is billed. Paying before a free lane has been tried is the one thing the ladder exists to prevent.",
      );
      break;
    }
  }

  /* Within the free half, the seeded rung decides — not the alphabet, which is the 12 September bug. */
  const freeGot = got.filter(isFreeSlug);
  for (let i = 1; i < freeGot.length; i++) {
    if (freeGot[i].ladder_rung < freeGot[i - 1].ladder_rung) {
      bad.push(
        `among the free rungs the comparator put ${freeGot[i - 1].display_name} (rung ` +
        `${freeGot[i - 1].ladder_rung}) before ${freeGot[i].display_name} (rung ${freeGot[i].ladder_rung}). ` +
        "Every free route ties on price, so if the rung is not deciding then the alphabet is — which is " +
        "how rtd_m2b0p2mdcrt61m4g sent a $1B block trade to an 8B model.",
      );
      break;
    }
  }

  /*
   * THE PAID HALF: RUNG ORDER AND PRICE ORDER MUST AGREE.
   *
   * They are two statements of the same intention — cheapest first — and two statements of one fact
   * is this repository's most-named defect. A rung renumbered without repricing, or a price
   * corrected without renumbering, is caught here rather than discovered on an invoice.
   */
  const paidGot = ladder.filter((m) => !isFreeSlug(m));
  for (let i = 1; i < paidGot.length; i++) {
    if (costOf(paidGot[i]) < costOf(paidGot[i - 1])) {
      bad.push(
        `paid rung ${paidGot[i].ladder_rung} (${paidGot[i].display_name}) is CHEAPER than rung ` +
        `${paidGot[i - 1].ladder_rung} (${paidGot[i - 1].display_name}). The rung order and the price ` +
        "order are two statements of 'cheapest first' and they now disagree.",
      );
      break;
    }
  }
  return bad;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RULE 4 — THE CONFIDENTIAL LINE. THE BIGGEST THING 0256 CHANGED.
 *
 * Private work went from ONE eligible lane to nine. That is only true if the rows say so AND the
 * adapter makes the claim enforceable, so both halves are asserted.
 * ═══════════════════════════════════════════════════════════════════════════ */
export function privateWorkHasLanesAndFreeOnesAreNotAmongThem({ models }, adapterSource) {
  const bad = [];
  const ladder = rungs(models);
  if (ladder.length === 0) return ["there is no ladder, so nothing was checked about which lanes may hold an LP name."];

  const priv = ladder.filter((m) => m.data_use === "NO_TRAINING_CONTRACTUAL");

  /* RULE 0 for this rule: an empty private set would pass a naive "no free lane is private" check. */
  if (priv.length === 0) {
    bad.push(
      "no lane on the ladder is recorded NO_TRAINING_CONTRACTUAL, so LP names and deal terms have " +
      "nowhere to run at all. This rule would otherwise pass over an empty set.",
    );
  }

  /* THE LINE ITSELF. A `:free` lane may never be marked private-capable. */
  for (const m of priv) {
    if (String(m.slug ?? "").endsWith(":free")) {
      bad.push(
        `${m.display_name} is a :free route AND is marked NO_TRAINING_CONTRACTUAL. A free endpoint is ` +
        "free because the provider keeps the prompt; OpenRouter itself refuses these under " +
        'data_collection="deny" with "No endpoints found matching your data policy (Free model ' +
        'training)". LP names and deal terms must not be able to reach it.',
      );
    }
  }

  /*
   * AND THE CLAIM IS ENFORCED AT THE WIRE, KEYED ON THE ROW.
   *
   * A `data_use` column saying "this route does not train" is a note in a database until something
   * asks the vendor to honour it. `openrouter.ts` sends `provider: { data_collection: "deny" }`, and
   * it must be driven by the MODEL ROW rather than by the caller's label — otherwise the claim is
   * true only on the calls somebody remembered to mark, which is a promise, not a control.
   */
  if (adapterSource === null) {
    bad.push(`${ADAPTER} could not be read, so the private-lane guarantee is unverified.`);
  } else {
    if (!/data_collection["']?\s*:\s*["']deny["']/.test(adapterSource)) {
      bad.push(
        `${ADAPTER} never sends provider.data_collection="deny". Every paid rung is marked ` +
        "NO_TRAINING_CONTRACTUAL on the strength of that flag, so without it those rows assert a " +
        "privacy property that nothing establishes.",
      );
    }
    if (!/requireNoTraining/.test(adapterSource)) {
      bad.push(`${ADAPTER} does not read requireNoTraining, so the flag cannot be driven by the model row.`);
    }
  }
  return bad;
}

/** The router must set that flag from the row, through the same predicate policy.ts uses. */
export function theRouterDrivesTheFlagFromTheRow(routerSource) {
  if (routerSource === null) return [`${ROUTER} could not be read, so what ships is unverified.`];
  const bad = [];
  if (!/requireNoTraining:\s*isPrivateModelRoute\(model\.data_use\)/.test(routerSource)) {
    bad.push(
      `${ROUTER} does not set requireNoTraining from isPrivateModelRoute(model.data_use). Keying it off ` +
      "the caller's label instead would mean a row could claim to be private-capable and be called " +
      "without the vendor ever being asked to honour the claim.",
    );
  }
  if (!/m\.reasoning,\s*m\.ladder_rung/.test(routerSource)) {
    bad.push(`${ROUTER} does not select m.ladder_rung, so the comparator sorts every candidate as unplaced and the ladder is inert.`);
  }
  return bad;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RULE 5 — A LANE THAT WOULD NOT SERVE IS NOT ON THE LADDER, AND SAYS WHY.
 * ═══════════════════════════════════════════════════════════════════════════ */
export function aDeadLaneIsOffTheLadderAndSaysWhy({ models, wiring }) {
  const bad = [];
  const disabled = models.filter((m) => String(m.provider_id) === "prv_openrouter" && Number(m.enabled) === 0);
  const wired = new Set((wiring ?? []).flatMap((b) => b.models.map((w) => w.id)));

  if (disabled.length === 0) {
    bad.push(
      "no OpenRouter model is registered disabled. 0256 probed four lanes that would not complete and " +
      "recorded them with their refusals; if none is left, either the evidence was dropped or this " +
      "guard is looking at the wrong thing. An empty check is not a pass.",
    );
  }

  for (const m of disabled) {
    if (onLadder(m)) {
      bad.push(`${m.display_name} is disabled but still carries ladder_rung ${m.ladder_rung}. A lane that cannot serve must not hold a place in the walk.`);
    }
    /* A refusal without its reason is a status nobody can act on — 0247's rule about Fireworks. */
    if (!m.price_source || String(m.price_source).length < 80) {
      bad.push(`${m.display_name} is disabled with no substantive reason recorded, so the next person has to rediscover why.`);
    }
    /*
     * AND IT IS NOT IN `CLOUD_BACKENDS`. That constant is what provisioning writes model rows from,
     * so a dead lane listed there gets re-created enabled by the next provisioning run — the row
     * would heal itself back into the ladder and nobody would see it happen.
     */
    if (wired.has(m.id)) {
      bad.push(
        `${m.display_name} is disabled in the migrations and PRESENT in CLOUD_BACKENDS. Provisioning ` +
        "writes rows from that constant, so this lane would be re-created as routable.",
      );
    }
  }
  return bad;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RULE 6 — THE BACKEND THE LADDER RUNS ON IS ACTUALLY SWITCHED ON, WITH A FIGURE.
 * ═══════════════════════════════════════════════════════════════════════════ */
export function theBackendIsEnabledWithACap({ backends }) {
  const bad = [];
  const or = backends.find((b) => b.id === "bk_openrouter");
  if (!or) return ["bk_openrouter is not in execution_backends at all, so no rung on it can ever run."];
  if (or.status !== "enabled") {
    bad.push(
      `bk_openrouter is "${or.status}". evaluateBackend refuses a backend that is not enabled at its ` +
      "FIRST rule, so every rung registered on it is unreachable — which is exactly the state 0247 left " +
      "behind and 0256 exists to fix.",
    );
  }
  /*
   * AND A CEILING OF ZERO IS NOT A $0 POLICY, whatever 0173's comment claimed. `effectiveAllowance`
   * leaves a zero out of the `min()` entirely, so an enabled backend with no figure of its own may
   * spend the whole lane budget the day the lever moves.
   */
  if (or.status === "enabled" && Number(or.monthly_ceiling_micros) <= 0) {
    bad.push(
      "bk_openrouter is enabled with monthly_ceiling_micros 0. effectiveAllowance treats 0 as NO SUB-CAP " +
      "STATED rather than as $0, so this backend has no figure of its own and would spend against the " +
      "lane budget alone the moment the spend lever leaves FREE_ONLY.",
    );
  }

  const codex = backends.find((b) => b.id === "bk_codex");
  if (!codex) {
    bad.push("bk_codex is not registered, so rung 0b — the second $0 subscription seat — does not exist.");
  } else {
    if (codex.class !== "agent_executed") bad.push(`bk_codex is class "${codex.class}"; a CLI on the owner's Mac is agent_executed, and a cloud_model row would make the Worker try to reach it over the network.`);
    if (codex.cost_basis !== "plan_equivalent") {
      bad.push(
        `bk_codex records cost_basis "${codex.cost_basis}". It runs on her ChatGPT Plus seat and no card ` +
        "is charged; 0239 is explicit that a figure which looks like a bill and is not one had her reading " +
        "a fake invoice for a week.",
      );
    }
  }
  return bad;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RULE 7 — THE LADDER ACTUALLY ADDED REASONING, WHICH IS WHY IT WAS BUILT.
 * ═══════════════════════════════════════════════════════════════════════════ */
export function theFreeTierGainedAReasoningBrain({ models }) {
  const bad = [];
  const free = rungs(models).filter(isFreeSlug);
  if (free.length === 0) return ["there are no free rungs, so the $0 tier has nothing in it."];

  const reasoning = free.filter((m) => Number(m.reasoning) === 1);
  if (reasoning.length === 0) {
    bad.push(
      "no free rung is a reasoning model. That was the state before 0256 — Llama 3.3 70B and Gemma 3 27B, " +
      "neither of which reasons — and closing it is the entire reason the free half of this ladder exists.",
    );
    return bad;
  }
  /* And it must be reached FIRST, or the gain is theoretical. */
  if (Number(free[0].reasoning) !== 1) {
    bad.push(
      `the first free rung is ${free[0].display_name}, which is not a reasoning model, while ` +
      `${reasoning[0].display_name} is and sits below it. A reasoning lane that is only reached after a ` +
      "weaker one has already answered is a lane that never runs.",
    );
  }
  return bad;
}

// ─── Sources ─────────────────────────────────────────────────────────────────

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);
const routerSource = read(ROUTER);
const adapterSource = read(ADAPTER);
const governanceSource = read(GOVERNANCE);

// ─── Self-test ───────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  let failed = 0;
  const expect = (label, actual, shouldCatch) => {
    if ((actual.length > 0) !== shouldCatch) {
      console.error(`  ✗ ${label} — expected ${shouldCatch ? "caught" : "clean"}, got ${JSON.stringify(actual)}`);
      failed += 1;
    } else console.log(`  ✓ ${label}`);
  };

  const world = await theWorld();
  const tiers = allowedTiersFor(governanceSource);
  const freeHops = numberFrom(routerSource, "MAX_FREE_HOPS");
  const fallbackHops = governanceSource === null ? null : (() => {
    const b = /NORMAL:\s*\{[\s\S]*?maxFallbackHops:\s*(\d+)/.exec(governanceSource);
    return b ? Number(b[1]) : null;
  })();

  // ── The shipped state is clean ──
  expect("every rung is reachable in the live cost mode", everyRungIsReachable(world, tiers), false);
  expect("the hop limits reach the bottom of the ladder", theHopLimitsReachTheBottom(world, freeHops, fallbackHops), false);
  expect("the shipped comparator puts free before paid", theOrderIsFreeBeforePaid(world), false);
  expect("private work has lanes and no free one is among them", privateWorkHasLanesAndFreeOnesAreNotAmongThem(world, adapterSource), false);
  expect("the router drives the privacy flag from the row", theRouterDrivesTheFlagFromTheRow(routerSource), false);
  expect("a dead lane is off the ladder and says why", aDeadLaneIsOffTheLadderAndSaysWhy(world), false);
  expect("the backend is enabled with a figure of its own", theBackendIsEnabledWithACap(world), false);
  expect("the free tier gained a reasoning brain", theFreeTierGainedAReasoningBrain(world), false);

  /*
   * ─── THE NEGATIVE PROOF ─────────────────────────────────────────────────────
   * Each shipped defect restored, and required to come back red. A guard that has never been shown
   * to fail is a guard nobody has tested.
   */

  // The `frontier` trap: a rung nothing can reach in NORMAL.
  expect("a rung registered frontier, which NORMAL refuses", everyRungIsReachable({
    ...world,
    models: world.models.map((m) => (m.id === "mdl_or_sonnet5" ? { ...m, capability_tier: "frontier" } : m)),
  }, tiers), true);

  // The state before this branch: one paid hop, two free hops, thirteen lanes.
  expect("maxFallbackHops back at 1, as it shipped", theHopLimitsReachTheBottom(world, freeHops, 1), true);
  expect("MAX_FREE_HOPS back at 2, as it shipped", theHopLimitsReachTheBottom(world, 2, fallbackHops), true);

  // The alphabetical tie-break — the 12 September defect, restored.
  const alphabetical = (models, costOf) => [...models].sort((a, b) => {
    const c = costOf(a) - costOf(b);
    return c !== 0 ? c : String(a.display_name).localeCompare(String(b.display_name));
  });
  expect("a comparator that ignores the rung and sorts free lanes alphabetically",
    theOrderIsFreeBeforePaid(world, alphabetical), true);

  // A comparator that lets a seeded rung outrank cost, which would pay before trying free.
  const rungFirst = (models, costOf) => [...models].sort((a, b) =>
    (a.ladder_rung ?? Infinity) - (b.ladder_rung ?? Infinity) || costOf(a) - costOf(b));
  expect("a comparator where the rung outranks cost", theOrderIsFreeBeforePaid({
    ...world,
    models: world.models.map((m) => (m.id === "mdl_or_gemini_flash_lite" ? { ...m, ladder_rung: 5 } : m)),
  }, rungFirst), true);

  // A paid rung renumbered without being repriced.
  expect("a paid rung whose number and price disagree", theOrderIsFreeBeforePaid({
    ...world,
    models: world.models.map((m) => (m.id === "mdl_or_sonnet5" ? { ...m, ladder_rung: 205 } : m)),
  }), true);

  // The confidential line broken: a free lane marked private-capable.
  expect("a :free lane marked NO_TRAINING_CONTRACTUAL", privateWorkHasLanesAndFreeOnesAreNotAmongThem({
    ...world,
    models: world.models.map((m) => (m.id === "mdl_or_nemotron_ultra_free" ? { ...m, data_use: "NO_TRAINING_CONTRACTUAL" } : m)),
  }, adapterSource), true);

  // No private lane at all — the empty-set case that a naive check would pass.
  expect("a world where nothing may hold an LP name", privateWorkHasLanesAndFreeOnesAreNotAmongThem({
    ...world, models: world.models.map((m) => ({ ...m, data_use: "TRAINS_ON_PROMPTS" })),
  }, adapterSource), true);

  // The adapter stops asking the vendor to honour the claim.
  expect("an adapter that no longer sends data_collection deny",
    privateWorkHasLanesAndFreeOnesAreNotAmongThem(world, adapterSource?.replace(/data_collection: "deny"/g, "x: 1") ?? null), true);
  expect("an adapter that could not be read", privateWorkHasLanesAndFreeOnesAreNotAmongThem(world, null), true);

  // The router keying the flag off the caller's label instead of the row.
  expect("a router that keys the flag off the caller's label",
    theRouterDrivesTheFlagFromTheRow(routerSource?.replace(
      "requireNoTraining: isPrivateModelRoute(model.data_use)",
      'requireNoTraining: ctx.modelAccess === "private_model_only"') ?? null), true);
  expect("a router that stopped selecting ladder_rung",
    theRouterDrivesTheFlagFromTheRow(routerSource?.replace(/m\.reasoning, m\.ladder_rung,\n/g, "") ?? null), true);

  // A lane that would not serve, put back on the ladder.
  expect("a dead lane given a rung", aDeadLaneIsOffTheLadderAndSaysWhy({
    ...world,
    models: world.models.map((m) => (m.id === "mdl_or_qwen38_free" ? { ...m, ladder_rung: 125 } : m)),
  }), true);
  expect("a dead lane left in CLOUD_BACKENDS, which provisioning would re-create", aDeadLaneIsOffTheLadderAndSaysWhy({
    ...world,
    wiring: world.wiring.map((b) => (b.backendId === "bk_openrouter"
      ? { ...b, models: [...b.models, { id: "mdl_or_qwen38_free", slug: "qwen/qwen3.8-27b:free" }] } : b)),
  }), true);
  expect("a world where no refusal was recorded at all", aDeadLaneIsOffTheLadderAndSaysWhy({
    ...world, models: world.models.filter((m) => Number(m.enabled) === 1),
  }), true);

  // bk_openrouter back at `registered` — the state 0247 left behind.
  expect("bk_openrouter back at registered, as it shipped", theBackendIsEnabledWithACap({
    ...world,
    backends: world.backends.map((b) => (b.id === "bk_openrouter" ? { ...b, status: "registered" } : b)),
  }), true);
  expect("bk_openrouter enabled with a $0 ceiling, which means NO sub-cap", theBackendIsEnabledWithACap({
    ...world,
    backends: world.backends.map((b) => (b.id === "bk_openrouter" ? { ...b, monthly_ceiling_micros: 0 } : b)),
  }), true);
  expect("bk_codex recorded as if a card were charged", theBackendIsEnabledWithACap({
    ...world,
    backends: world.backends.map((b) => (b.id === "bk_codex" ? { ...b, cost_basis: "invoiced" } : b)),
  }), true);

  // The free tier back to having no reasoning model — the gap this closed.
  expect("a free tier with no reasoning model, as before 0256", theFreeTierGainedAReasoningBrain({
    ...world, models: world.models.map((m) => ({ ...m, reasoning: 0 })),
  }), true);
  expect("a reasoning lane placed below a weaker free one", theFreeTierGainedAReasoningBrain({
    ...world,
    models: world.models.map((m) => (m.id === "mdl_cf_llama33_70b" ? { ...m, ladder_rung: 1 } : m)),
  }), true);

  // Rule 0 itself.
  expect("a world with no ladder at all", everyRungIsReachable({
    ...world, models: world.models.map((m) => ({ ...m, ladder_rung: null })),
  }, tiers), true);

  if (failed) { console.error(`LADDER SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("LADDER SELF-TEST PASSED");
  process.exit(0);
}

// ─── The real scan ───────────────────────────────────────────────────────────

const world = await theWorld();
const tiers = allowedTiersFor(governanceSource);
const freeHops = numberFrom(routerSource, "MAX_FREE_HOPS");
const fallbackHops = governanceSource === null ? null : (() => {
  const b = /NORMAL:\s*\{[\s\S]*?maxFallbackHops:\s*(\d+)/.exec(governanceSource);
  return b ? Number(b[1]) : null;
})();

/* RULE 0. No migrations replayed, or no ladder, is not "no problems" — it is an empty loop. */
const ladder = rungs(world.models);
if (world.files === 0 || world.models.length === 0 || ladder.length === 0) {
  console.error("LADDER SCAN FAILED — there was nothing to examine.");
  console.error(`  ${world.files} migration(s) read, ${world.models.length} model(s), ${ladder.length} rung(s).`);
  for (const f of world.failed.slice(0, 5)) console.error(`    ${f}`);
  process.exit(2);
}

const problems = [
  ...everyRungIsReachable(world, tiers),
  ...theHopLimitsReachTheBottom(world, freeHops, fallbackHops),
  ...theOrderIsFreeBeforePaid(world),
  ...privateWorkHasLanesAndFreeOnesAreNotAmongThem(world, adapterSource),
  ...theRouterDrivesTheFlagFromTheRow(routerSource),
  ...aDeadLaneIsOffTheLadderAndSaysWhy(world),
  ...theBackendIsEnabledWithACap(world),
  ...theFreeTierGainedAReasoningBrain(world),
];

if (problems.length) {
  console.error("LADDER SCAN FAILED:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  console.error('  Her instruction: "we can move down the line from claude to anyone that is $0');
  console.error('  that is next best and last resort paid."');
  process.exit(2);
}

const free = ladder.filter(isFreeSlug);
const paid = ladder.filter((m) => !isFreeSlug(m));
const priv = ladder.filter((m) => m.data_use === "NO_TRAINING_CONTRACTUAL");
const dead = world.models.filter((m) => String(m.provider_id) === "prv_openrouter" && Number(m.enabled) === 0);
console.log(
  `LADDER OK — ${ladder.length} rung(s) walkable in ${LIVE_COST_MODE}: ${free.length} free then ${paid.length} paid, ` +
  `cheapest first. ${free.filter((m) => Number(m.reasoning) === 1).length} free reasoning lane(s), the first of them ` +
  `${free[0].display_name}. ${priv.length} lane(s) may hold an LP name, none of them :free, each asking the vendor to ` +
  `honour it per request. ${dead.length} probed lane(s) registered disabled with their refusals. ` +
  `Hops: ${freeHops} free, ${fallbackHops} paid.`,
);
