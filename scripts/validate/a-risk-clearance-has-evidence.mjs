#!/usr/bin/env node
/**
 * A RISK CLEARANCE ABOVE `low` HAS A BENCHMARK AND AN APPROVED CARD BEHIND IT.
 *
 * ─── What this guards ───────────────────────────────────────────────────────
 *
 * `models.max_risk` is the single column that decides whether her work can run at all. A task
 * classified `medium` needs a model cleared to `medium`; on 12 September 2026 none existed, and
 * `tsk_m2bk7zfffhjatvsf` — her own instruction about the spirit page — failed four times without
 * ever reaching a model. `routing_decisions` said it plainly: three of four candidates refused at
 * `capability`, "model is cleared to low risk, task is medium".
 *
 * The obvious fix is one UPDATE. That is exactly the fix §3.1 forbids, and `router/index.ts` says so
 * in the file that raises the error:
 *
 *   "IT WIDENS NOTHING. Raising a model's risk clearance is a PROMOTION, and §3.1 requires benchmark
 *    evidence and an approved card — not a quiet UPDATE by whoever hit the wall first."
 *
 * And `routes/models.ts` names both halves and why neither alone will do:
 *
 *   "Evidence AND a card. ... evidence without approval is an implementation deciding what she runs
 *    on, and approval without evidence is a decision made on nothing."
 *
 * That rule lived in COMMENTS and in ONE HTTP HANDLER — `PATCH /api/models/routes/:id`, which
 * governs route defaults and never looks at `max_risk` at all. `PATCH /api/models/:id` accepts
 * `max_risk` in its allowed-fields list with no gate whatsoever, and a migration can write the
 * column directly. So the rule could not reach the thing it governed. This is the reachable half.
 *
 * ─── What it asserts, on the shipped migrations ────────────────────────────
 *
 * Every model that ends up above `low` once every migration is replayed must have:
 *
 *   1. APPROVED BENCHMARK ROWS across DISTINCT workload profiles — real evidence, `verdict =
 *      'approved'`, which `router/bench.ts` can never write and a harness therefore cannot forge;
 *   2. AN APPROVED `model_promotion` CARD naming the model AND naming `max_risk` and the level it
 *      was raised to — so a card for a different decision cannot be pointed at this one;
 *   3. A CARD THAT CITES ITS EVIDENCE, and every file it cites must EXIST IN THE REPOSITORY. A card
 *      citing an artifact nobody can open is approval made on nothing, which is the failure mode the
 *      governing text names by hand.
 *
 * And, because promoting a model is not allowed to become a way to spend money:
 *
 *   4. NOTHING IS PROMOTED TO `high` BY A MIGRATION. High risk is the owner's, at the console, on
 *      evidence that does not exist yet.
 *   5. THE PAID BACKEND STAYS OFF. A clearance bought by enabling Fireworks fails here.
 *
 * ─── RULE 0 ─────────────────────────────────────────────────────────────────
 *
 * ZERO MODELS EXAMINED IS A FAILURE. "No model has an unevidenced clearance" is trivially true of a
 * database with no models in it, and that sentence over an empty loop is precisely the shape this
 * repository keeps catching: a guard that cannot reach what it governs. If the replay produces no
 * models, or no model above `low`, this exits non-zero and says which.
 *
 *   node scripts/validate/a-risk-clearance-has-evidence.mjs
 *   node scripts/validate/a-risk-clearance-has-evidence.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** `routes/models.ts` asks for five approved workloads before a model counts as benchmarked. */
export const MIN_APPROVED_WORKLOADS = 5;

const RISK_ORDER = { low: 0, medium: 1, high: 2 };

/**
 * The world: every shipped migration replayed in order, then the three tables this rule spans read
 * back out of it. Replaying rather than reading the SQL as text is the whole point — a clearance
 * granted in 0155 and revoked in 0231 must be judged on where it ENDS UP, not on which files
 * mention it.
 */
export function theWorld(dir = join(ROOT, "migrations")) {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const failed = [];
  for (const f of files) {
    try { db.exec(readFileSync(join(dir, f), "utf8")); }
    catch (e) { failed.push(`${f}: ${e.message.split("\n")[0]}`); }
  }
  const models = db.prepare(`SELECT id, display_name, max_risk, benchmark_status, enabled FROM models`).all();
  const benchmarks = db.prepare(`SELECT id, model_id, workload_id, verdict, quality_score, note FROM model_benchmarks`).all();
  const cards = db.prepare(`SELECT id, kind, status, payload, decided_by, summary FROM approvals WHERE kind = 'model_promotion'`).all();
  const backends = db.prepare(`SELECT id, status FROM execution_backends`).all();
  return { models, benchmarks, cards, backends, files: files.length, failed };
}

const above = (risk) => (RISK_ORDER[String(risk)] ?? -1) > RISK_ORDER.low;

/** A card counts for a model only if it is approved AND says, in its payload, what it changed. */
export function cardsFor(cards, modelId) {
  return (cards ?? []).filter((c) => {
    if (c.status !== "approved") return false;
    let p;
    try { p = JSON.parse(c.payload ?? "null"); } catch { return false; }
    if (!p || p.model_id !== modelId) return false;
    // A route-default card is a different decision and may not be reused as a clearance.
    return p.change === "max_risk" && typeof p.to === "string";
  });
}

/** Files a card cites, so they can be required to exist. */
function citedFiles(card) {
  let p;
  try { p = JSON.parse(card.payload ?? "null"); } catch { return []; }
  return [p?.evidence, p?.card].filter((v) => typeof v === "string" && v.length > 0);
}

// ─── The rules ───────────────────────────────────────────────────────────────

export function everyClearanceHasEvidence(world, { fileExists = (f) => existsSync(join(ROOT, f)) } = {}) {
  const bad = [];
  const { models, benchmarks, cards } = world;

  const promoted = (models ?? []).filter((m) => above(m.max_risk));

  for (const m of promoted) {
    const approved = (benchmarks ?? []).filter((b) => b.model_id === m.id && b.verdict === "approved");
    const distinct = new Set(approved.map((b) => b.workload_id));

    if (distinct.size < MIN_APPROVED_WORKLOADS) {
      bad.push(
        `${m.id} (${m.display_name}) is cleared to ${m.max_risk} on ${distinct.size} approved workload `
        + `benchmark(s); ${MIN_APPROVED_WORKLOADS} distinct are required. A clearance raised on less `
        + "than the evidence bar is the quiet UPDATE §3.1 forbids.",
      );
    }

    const forModel = cardsFor(cards, m.id);
    if (forModel.length === 0) {
      bad.push(
        `${m.id} (${m.display_name}) is cleared to ${m.max_risk} with NO approved model_promotion card `
        + "naming a max_risk change. Approval and evidence are both required; this has neither half "
        + "recorded where anyone can read it.",
      );
      continue;
    }

    // The card must name the clearance the model actually ended up with, not a lower one.
    const covers = forModel.some((c) => {
      const p = JSON.parse(c.payload);
      return String(p.to) === String(m.max_risk);
    });
    if (!covers) {
      bad.push(
        `${m.id} sits at max_risk '${m.max_risk}' and its approved card(s) clear it only to `
        + `${forModel.map((c) => JSON.parse(c.payload).to).join(", ")}. The row has drifted above the `
        + "decision behind it.",
      );
    }

    // A card citing an artifact nobody can open is approval made on nothing.
    for (const c of forModel) {
      const cited = citedFiles(c);
      if (cited.length === 0) {
        bad.push(`${c.id} clears ${m.id} to ${JSON.parse(c.payload).to} and cites no evidence file at all.`);
        continue;
      }
      for (const f of cited) {
        if (!fileExists(f)) {
          bad.push(`${c.id} cites \`${f}\` as the evidence for promoting ${m.id}, and that file is not in the repository.`);
        }
      }
    }

    // The card must be a decision somebody made, not a row that arrived approved with no decider.
    for (const c of forModel) {
      if (!c.decided_by) bad.push(`${c.id} is approved with no decided_by. An approval nobody made is not an approval.`);
    }
  }

  /*
   * NOTHING IS PROMOTED TO `high` BY A MIGRATION. Separate from the loop above, because a model
   * raised to high WITH five benchmarks and a card would otherwise pass — and high risk is the
   * band where "benchmarked" stops being enough on its own.
   */
  for (const m of models ?? []) {
    if (String(m.max_risk) === "high") {
      bad.push(
        `${m.id} (${m.display_name}) is cleared to HIGH risk by the shipped migrations. High risk is `
        + "the owner's decision at the console, on evidence that does not exist in this repository.",
      );
    }
  }

  /*
   * AND A CLEARANCE MAY NOT BE BOUGHT. The standing cost rule is $0; `validate:free-brain` guards
   * the same fact from the routing side and this guards it from the promotion side, because "we
   * enabled the paid backend so a stronger model could take medium work" is the obvious wrong fix.
   */
  const fireworks = (world.backends ?? []).find((b) => b.id === "bk_fireworks");
  if (fireworks && fireworks.status === "enabled") {
    bad.push("bk_fireworks has been enabled. A risk clearance is not allowed to cost money; the paid backend stays registered and off.");
  }

  /*
   * BENCHMARK STATUS AND THE BENCHMARK ROWS MAY NOT DISAGREE. Two components each keeping their own
   * list of the same fact is this repository's most-named defect, and `benchmark_status` is read by
   * the router's high-risk gate.
   */
  for (const m of models ?? []) {
    const distinct = new Set(
      (benchmarks ?? []).filter((b) => b.model_id === m.id && b.verdict === "approved").map((b) => b.workload_id),
    );
    if (m.benchmark_status === "benchmarked" && distinct.size < MIN_APPROVED_WORKLOADS) {
      bad.push(
        `${m.id} is marked benchmark_status 'benchmarked' on ${distinct.size} approved workload(s). `
        + "The router's high-risk gate trusts that column; it must mean what POST /api/models/benchmarks makes it mean.",
      );
    }
  }

  return bad;
}

/**
 * Rule: the column this validator governs is not writable without passing through the same gate.
 *
 * A guard that only reads migrations, over an API that can set the same column on a whim, is a guard
 * that cannot reach what it governs — the exact defect class this repository keeps naming. Before
 * this validator existed, `PATCH /api/models/:id` listed `max_risk` among its freely-updatable
 * fields with NO gate of any kind, while the promotion rule was enforced only in `PATCH /routes/:id`,
 * which governs route defaults and never reads `max_risk` at all.
 *
 * So the write path is checked for the GATE, not for a comment saying there should be one:
 *   - it must compare the requested level against the stored one, so that only an INCREASE is gated
 *     and revoking a clearance stays easy;
 *   - it must require approved benchmark rows;
 *   - it must require an approved `model_promotion` card naming `max_risk` and the level.
 */
export function theApiGatesTheRaise(source) {
  if (source === null) return ["src/worker/boss/routes/models.ts could not be read, so the write path is unverified."];
  const bad = [];
  const patch = source.match(/models\.patch\("\/:id"[\s\S]*?\n\}\);/);
  if (!patch) {
    bad.push("PATCH /api/models/:id was not found in routes/models.ts, so this rule is asserting nothing about the write path.");
    return bad;
  }
  const body = patch[0];
  if (!/"max_risk"/.test(body)) return bad; // The endpoint cannot set it at all: nothing to gate.

  if (!/RISK_RANK|riskAllows|riskRank/.test(body)) {
    bad.push(
      "PATCH /api/models/:id can set max_risk without comparing it to the stored level, so it cannot "
      + "tell a promotion from a revocation. Every risk change is either ungated or over-gated.",
    );
  }
  if (!/model_benchmarks[\s\S]{0,200}approved/.test(body)) {
    bad.push(
      "PATCH /api/models/:id can raise max_risk without requiring approved benchmark rows. That is a "
      + "clearance granted on no evidence — the quiet UPDATE §3.1 forbids, reachable over HTTP.",
    );
  }
  if (!/'model_promotion'[\s\S]{0,400}approved/.test(body)) {
    bad.push(
      "PATCH /api/models/:id can raise max_risk without an approved model_promotion card. Evidence "
      + "without approval is an implementation deciding what she runs on.",
    );
  }
  if (!/"change":"max_risk"/.test(body)) {
    bad.push(
      "PATCH /api/models/:id does not require the card to name `max_risk` as what it changes, so a "
      + "route-default promotion card could be reused to raise a risk clearance.",
    );
  }
  return bad;
}

// ─── Self-test ───────────────────────────────────────────────────────────────

const modelsRoutePath = join(ROOT, "src/worker/boss/routes/models.ts");
const modelsRouteSource = existsSync(modelsRoutePath) ? readFileSync(modelsRoutePath, "utf8") : null;

if (process.argv.includes("--self-test")) {
  let failed = 0;
  const expect = (label, actual, shouldCatch) => {
    if ((actual.length > 0) !== shouldCatch) {
      console.error(`  ✗ ${label} — expected ${shouldCatch ? "caught" : "clean"}, got ${JSON.stringify(actual).slice(0, 400)}`);
      failed += 1;
    } else console.log(`  ✓ ${label}`);
  };

  const world = theWorld();
  const promotedNow = world.models.filter((m) => above(m.max_risk));

  expect("the shipped migrations pass", everyClearanceHasEvidence(world), false);
  expect("the API write path gates the raise", theApiGatesTheRaise(modelsRouteSource), false);

  /* ─── THE NEGATIVE PROOFS. Each is the shipped state broken back, required to come back red. ─── */

  expect("the card stripped out, clearance left standing", everyClearanceHasEvidence({
    ...world, cards: [],
  }), true);

  expect("the benchmark rows deleted, card left standing", everyClearanceHasEvidence({
    ...world, benchmarks: world.benchmarks.filter((b) => b.model_id !== "mdl_cf_llama33_70b"),
  }), true);

  expect("the approved verdicts downgraded to needs_review", everyClearanceHasEvidence({
    ...world,
    benchmarks: world.benchmarks.map((b) => (b.model_id === "mdl_cf_llama33_70b" ? { ...b, verdict: "needs_review" } : b)),
  }), true);

  expect("five benchmarks that are all the SAME workload", everyClearanceHasEvidence({
    ...world,
    benchmarks: world.benchmarks.map((b) => (b.model_id === "mdl_cf_llama33_70b" ? { ...b, workload_id: "wl_drafting" } : b)),
  }), true);

  expect("the card left pending rather than approved", everyClearanceHasEvidence({
    ...world, cards: world.cards.map((c) => ({ ...c, status: "pending" })),
  }), true);

  expect("a route-default card reused as a risk clearance", everyClearanceHasEvidence({
    ...world,
    cards: world.cards.map((c) => ({ ...c, payload: JSON.stringify({ model_id: "mdl_cf_llama33_70b", route_id: "rt_ops_default" }) })),
  }), true);

  expect("the row drifted to high above a card that cleared it to medium", everyClearanceHasEvidence({
    ...world, models: world.models.map((m) => (m.id === "mdl_cf_llama33_70b" ? { ...m, max_risk: "high" } : m)),
  }), true);

  expect("the cited evidence file missing from the repository", everyClearanceHasEvidence(world, {
    fileExists: () => false,
  }), true);

  expect("a card approved with nobody recorded as deciding it", everyClearanceHasEvidence({
    ...world, cards: world.cards.map((c) => ({ ...c, decided_by: null })),
  }), true);

  expect("the seeded medium clearance on mdl_kimi_k2, as it stood before 0231", everyClearanceHasEvidence({
    ...world, models: world.models.map((m) => (m.id === "mdl_kimi_k2" ? { ...m, max_risk: "medium" } : m)),
  }), true);

  expect("benchmark_status 'benchmarked' with no approved rows behind it", everyClearanceHasEvidence({
    ...world,
    models: world.models.map((m) => (m.id === "mdl_cf_llama31_8b" ? { ...m, benchmark_status: "benchmarked" } : m)),
  }), true);

  expect("the paid backend switched on to carry the promoted work", everyClearanceHasEvidence({
    ...world, backends: [...world.backends.filter((b) => b.id !== "bk_fireworks"), { id: "bk_fireworks", status: "enabled" }],
  }), true);

  /* The ungated handler exactly as it shipped before this work, required to come back red. */
  expect("the ungated PATCH handler as it shipped", theApiGatesTheRaise(
    `models.patch("/:id", async (c) => {\n  const allowed = ["display_name", "max_risk"];\n  await update();\n  return ok(c);\n});`,
  ), true);
  expect("a handler that checks evidence but takes any promotion card", theApiGatesTheRaise(
    modelsRouteSource?.replace(/"change":"max_risk"/g, '"route_id":"rt_ops_default"') ?? null,
  ), true);
  expect("a handler that demands a card but no benchmark rows", theApiGatesTheRaise(
    modelsRouteSource?.replace(/model_benchmarks/g, "some_other_table") ?? null,
  ), true);
  expect("a write path that could not be read", theApiGatesTheRaise(null), true);

  /* RULE 0, self-tested: the empty world must FAIL, not pass. */
  expect("a world with no models at all is caught by Rule 0", rule0({ ...world, models: [] }), true);
  expect("a world with no promoted model at all is caught by Rule 0", rule0({ ...world, models: world.models.map((m) => ({ ...m, max_risk: "low" })) }), true);
  expect("the real world passes Rule 0", rule0(world), false);

  if (promotedNow.length === 0) {
    console.error("  ✗ the shipped migrations promote no model, so the scan below would examine nothing");
    failed += 1;
  }

  if (failed) { console.error(`RISK CLEARANCE SELF-TEST FAILED (${failed})`); process.exit(1); }
  console.log("RISK CLEARANCE SELF-TEST PASSED");
  process.exit(0);
}

/**
 * RULE 0 — the examination itself.
 *
 * A loop over nothing is not a pass. Both emptinesses are failures and they are different failures,
 * so they say different things.
 */
export function rule0(world) {
  const bad = [];
  if (!world.files || world.models.length === 0) {
    bad.push(
      `replaying the migrations produced ${world.models?.length ?? 0} model(s) from ${world.files ?? 0} file(s), `
      + "so this guard examined nothing. An empty loop reporting 'no unevidenced clearance' is the "
      + "opposite of the truth.",
    );
    for (const f of (world.failed ?? []).slice(0, 5)) bad.push(`  a migration failed to apply: ${f}`);
    return bad;
  }
  const promoted = world.models.filter((m) => above(m.max_risk));
  if (promoted.length === 0) {
    bad.push(
      "no model is cleared above `low` once every migration is replayed, so nothing was examined — AND "
      + "every task classified `medium` or above has no permitted executor and fails before it starts. "
      + "That is the wall tsk_m2bk7zfffhjatvsf hit four times, back again.",
    );
  }
  return bad;
}

// ─── The real scan ───────────────────────────────────────────────────────────

const world = theWorld();

const empty = rule0(world);
if (empty.length) {
  console.error("RISK CLEARANCE SCAN FAILED — Rule 0:");
  for (const e of empty) console.error(`  ✗ ${e}`);
  process.exit(2);
}

const problems = [...everyClearanceHasEvidence(world), ...theApiGatesTheRaise(modelsRouteSource)];

if (problems.length) {
  console.error("RISK CLEARANCE SCAN FAILED:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("");
  console.error("  A clearance above `low` needs benchmark evidence AND an approved card (§3.1).");
  console.error("  See migrations/0231_boss_a_medium_task_has_a_model.sql for what that looks like.");
  process.exit(2);
}

const promoted = world.models.filter((m) => above(m.max_risk));
console.log(
  `RISK CLEARANCE OK — ${promoted.length} model(s) above low risk of ${world.models.length} across `
  + `${world.files} replayed migration(s); each carries ${MIN_APPROVED_WORKLOADS}+ approved workload `
  + "benchmarks and an approved model_promotion card citing a file that exists. Nothing is at high, "
  + "and the paid backend is still off.",
);
for (const m of promoted) {
  const n = new Set(world.benchmarks.filter((b) => b.model_id === m.id && b.verdict === "approved").map((b) => b.workload_id)).size;
  const card = cardsFor(world.cards, m.id)[0];
  console.log(`  ${m.display_name} -> ${m.max_risk} on ${n} workload(s), card ${card?.id}`);
}
