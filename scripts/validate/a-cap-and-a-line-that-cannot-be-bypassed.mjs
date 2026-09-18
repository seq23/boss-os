#!/usr/bin/env node
/**
 * A CAP THAT STOPS SOMETHING, A LINE THAT REFUSES SOMETHING, AND A BYPASS ONLY SHE CAN RAISE.
 *
 * ─── What this exists to stop coming back ───────────────────────────────────
 *
 * Every control in this area had the same shape before it was fixed: present, readable, and
 * governing nothing.
 *
 *   · `approved_task_kinds` and `forbidden_task_kinds` were NULL on every model. `evaluateModel`
 *     read both and enforced both, and had never had anything to enforce.
 *   · `per_run` existed once, in `duties/author.ts`, as an ESTIMATE that nothing compared anything
 *     against — so a single runaway call could take a third of the ops day before the daily cap
 *     noticed, and the daily cap would then report the damage rather than prevent it.
 *   · Every model was `privacy_class: cloud`, so no rule in the system could separate the route
 *     that may hold an LP name from the route that may not.
 *   · Fireworks was enabled with no key; OpenRouter had a key and no row to reach.
 *
 * ─── What is checked, by RUNNING the shipped code against the real seed ─────
 *
 *   1. ENABLING FOLLOWS THE KEY. No provider is enabled whose credential this Worker does not
 *      hold, and no credential is held that nothing can reach.
 *   2. EVERY PRICE CARRIES ITS PROVENANCE. No model is `UNKNOWN` and none has an empty source. A
 *      figure marked SOURCED must cite a URL; one that could not be confirmed must say so.
 *   3. THE CONFIDENTIAL LINE IS STRUCTURAL. Exactly one `data_use` value may hold LP names, the
 *      column defaults to a restricted state so a model added later is restricted by default, and
 *      the refusal is NOT APPROVABLE — no card lifts it.
 *   4. THE SCAN FAILS CLOSED. An unestablished lexicon is a hit, and the refusal never quotes the
 *      material it found.
 *   5. THE PER-RUN CAP IS ENFORCED, not merely stored: the router compares an estimate against it
 *      before the call, and the default is passed to `getNumber` so an unreadable row holds the cap
 *      rather than removing it.
 *   6. THE BYPASS FAILS CLOSED ON EVERY AXIS, and `raised_by` is constrained by the SCHEMA rather
 *      than by the route — so no employee, duty or automation can grant itself headroom even if it
 *      finds another way in.
 *   7. NOTHING TURNS `hard_stop` OFF. A bypass moves a ceiling; it never removes one.
 *   8. FREE IS A PROPERTY OF THE ROUTE, NOT OF A PRICE COLUMN. Nowhere may decide "free" by
 *      comparing `in_micros_1k` to zero — that definition broke the moment the models were priced,
 *      in three separate places, and it is the one mistake most likely to come back.
 *
 * RULE 0: zero models examined, or zero bypass shapes exercised, is a HARD FAILURE. An empty seed
 * would let every rule above pass over nothing.
 *
 *   node scripts/validate/a-cap-and-a-line-that-cannot-be-bypassed.mjs
 *   node scripts/validate/a-cap-and-a-line-that-cannot-be-bypassed.mjs --self-test
 */

import { readFileSync, readdirSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const POLICY = "src/worker/boss/router/policy.ts";
const ROUTER = "src/worker/boss/router/index.ts";
const BYPASS = "src/worker/boss/router/bypass.ts";
const CONFIDENTIAL = "src/worker/boss/router/modelAccess.ts";
const GUARD = "src/worker/boss/backends/guard.ts";
const TODAY = "src/worker/boss/routes/today.ts";
const FREE_BRAIN = "scripts/validate/the-best-free-model-is-a-candidate.mjs";

/** Secrets this Worker actually holds in production. Stated, because the check is about absence. */
const PRODUCTION_SECRETS = new Set(["BOSS_PASSCODE", "BOSS_SESSION_SECRET", "OPENROUTER_API_KEY", "AI"]);

const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join("\n");

/** Replay every migration into an in-memory database, so the seed examined is the shipped seed. */
export function replaySeed() {
  const dir = join(ROOT, "migrations");
  const db = new DatabaseSync(":memory:");
  let applied = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    try {
      db.exec(sql);
      applied += 1;
    } catch {
      // A migration node:sqlite cannot parse is skipped rather than fatal — the same tolerance
      // `the-best-free-model-is-a-candidate.mjs` takes. The count below is what makes that safe:
      // if too many were skipped there is nothing to examine and Rule 0 fires.
    }
  }
  return { db, applied };
}

function rows(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch {
    return [];
  }
}

export function check({ models, providers, settings, bypassSchema, sources, applied }) {
  const bad = [];

  // ── RULE 0 ─────────────────────────────────────────────────────────────────
  if (!Array.isArray(models) || models.length === 0) {
    return ["no model rows were examined, so every rule below passed over nothing"];
  }
  if (!Number.isFinite(applied) || applied < 100) {
    bad.push(`only ${applied} migrations replayed; the seed examined is not the shipped seed`);
  }

  // ── 1. Enabling follows the key ────────────────────────────────────────────
  for (const p of providers) {
    if (Number(p.enabled) !== 1) continue;
    if (!PRODUCTION_SECRETS.has(String(p.api_key_var))) {
      bad.push(
        `${p.id} is enabled and its credential ${p.api_key_var} is not one this Worker holds. `
        + `Enabling follows the key; a provider enabled without one fails on every call it is `
        + `selected for, and the route discovers it one candidate at a time.`,
      );
    }
  }
  const reachable = new Set(providers.filter((p) => Number(p.enabled) === 1).map((p) => p.api_key_var));
  if (!reachable.has("OPENROUTER_API_KEY")) {
    bad.push(
      "OPENROUTER_API_KEY is set on this Worker and no enabled provider uses it — a paid credential "
      + "nothing can reach. Give it a lane or remove the key; leaving it is the worst of the three.",
    );
  }

  // ── 2. Every price carries its provenance ──────────────────────────────────
  for (const m of models) {
    if (m.pricing_state === "UNKNOWN") {
      bad.push(`${m.id} has pricing_state UNKNOWN — a price nobody has checked, in a cost ledger`);
    }
    if (!String(m.price_source ?? "").trim()) {
      bad.push(`${m.id} has no price_source. A price with no provenance is the same defect as a wrong price.`);
    }
    if (m.pricing_state === "SOURCED" && !String(m.price_source ?? "").includes("http")) {
      bad.push(`${m.id} is marked SOURCED and cites no URL, so the claim cannot be re-checked`);
    }
  }

  // ── 3. The confidential line is structural ─────────────────────────────────
  const confidential = code(sources[CONFIDENTIAL] ?? "");
  const policy = code(sources[POLICY] ?? "");

  // `mayHoldConfidential` returns a comparison against exactly one literal. Matching the RETURN
  // rather than a parameter name keeps the check about the behaviour: an `||` added to that line
  // widens the gate, and this notices.
  if (!/return dataUse === "NO_TRAINING_CONTRACTUAL";/.test(confidential)) {
    bad.push(
      `${CONFIDENTIAL} does not gate on exactly one data_use value. Everything else — including a `
      + "value somebody invents later, including null — must be restricted.",
    );
  }
  if (!/ctx\.modelAccess === "private_model_only" && !isPrivateModelRoute\(model\.data_use\)/.test(policy)) {
    bad.push(`${POLICY} does not refuse a training-permitting route for confidential content`);
  }
  // THE REFUSAL MUST NOT BE APPROVABLE. A card that could lift it would be approving a permanent
  // presence in somebody's corpus, which is not a thing any card in this system means.
  const rule = /if \(ctx\.modelAccess === "private_model_only"[\s\S]{0,900}?\n  \}/.exec(policy)?.[0] ?? "";
  if (!/approvable: false/.test(rule)) {
    bad.push(
      `${POLICY}'s confidential refusal is approvable. Restricted-to-cloud is approvable because the `
      + "exposure ends when the run does; training does not end when the run ends.",
    );
  }
  for (const m of models) {
    if (!["NO_TRAINING_CONTRACTUAL", "TRAINS_ON_PROMPTS", "UNKNOWN"].includes(String(m.data_use))) {
      bad.push(`${m.id} carries an unrecognised data_use ${JSON.stringify(m.data_use)}`);
    }
    if (!String(m.data_use_source ?? "").trim()) {
      bad.push(`${m.id} has no data_use_source — a finding with no method behind it`);
    }
  }
  // A model added later must be restricted until somebody writes down why it is not.
  const migrations = sources.__migrations ?? "";
  if (!/ADD COLUMN data_use TEXT NOT NULL DEFAULT 'UNKNOWN'/.test(migrations)) {
    bad.push("models.data_use does not default to UNKNOWN, so a model added later would not be restricted by default");
  }

  // ── 4. The scan fails closed, and never quotes what it found ───────────────
  if (!/if \(!lexicon\.established\)[\s\S]{0,200}privateVerdict\(\["scan unavailable"\]/.test(confidential)) {
    bad.push(`${CONFIDENTIAL} does not treat an unestablished scan as a hit`);
  }

  // ── 5. The per-run cap is enforced, not merely stored ──────────────────────
  const router = code(sources[ROUTER] ?? "");
  /*
   * THE COMPARISON, WHEREVER THE SPEND GRADIENT LEAVES THE CAP.
   *
   * 0253 narrows the per-run ceiling for ORDINARY work by a continuous factor, so the figure the
   * estimate is compared against is now `effectivePerRunCap`. The rule is unchanged and this got
   * STRICTER rather than looser: the comparison must still happen, AND the narrowed figure must be
   * derived from `perRunCap` rather than from anything else — a gradient that replaced the ceiling
   * instead of scaling it would be the cap going missing behind a new name.
   */
  if (!/if \(estimate > (effectivePerRunCap|perRunCap)\)/.test(router)) {
    bad.push(
      `${ROUTER} never compares an estimate against the per-run cap. A cap that is stored and not `
      + "compared is the exact shape `per_run` already had in duties/author.ts.",
    );
  }
  if (/effectivePerRunCap/.test(router) && !/const effectivePerRunCap = Math\.max\(0, Math\.floor\(perRunCap \* effect\.perRunFactor\)\);/.test(router)) {
    bad.push(
      `${ROUTER} compares against an effective per-run cap that is not derived from perRunCap. The gradient `
      + "may SCALE the ceiling and may never replace it.",
    );
  }
  if (!/getNumber\(db, "per_run_cap_micros", 750_000\)/.test(router)) {
    bad.push(`${ROUTER} does not pass the $0.75 default, so an unreadable setting would remove the cap`);
  }
  if (settings.per_run_cap_micros !== "750000") {
    bad.push(`the seeded per-run cap is ${JSON.stringify(settings.per_run_cap_micros)}, expected 750000`);
  }

  // ── 6. The bypass fails closed, and the SCHEMA is what refuses ─────────────
  if (!bypassSchema) {
    bad.push("there is no spend_bypass table, so there is no bounded way over a cap at all");
  } else {
    const required = [
      [/raised_by[^,]*CHECK\s*\(\s*raised_by\s*=\s*'owner'\s*\)/, "raised_by is not CHECKed to 'owner' — an automation could grant itself headroom"],
      [/expires_at\s+INTEGER NOT NULL/, "expires_at is nullable, so a bypass could outlive its reason"],
      [/amount_micros\s+INTEGER NOT NULL CHECK \(amount_micros > 0\)/, "amount_micros is not a required positive number, so a bypass could be an open-ended switch"],
      [/reason\s+TEXT NOT NULL CHECK \(length\(trim\(reason\)\) >= 12\)/, "reason is not required at a length that means anything"],
      [/scope\s+TEXT NOT NULL CHECK \(scope IN \('per_run','day','month'\)\)/, "scope is unconstrained, so a bypass could silently cover every cap"],
    ];
    for (const [re, why] of required) {
      if (!re.test(bypassSchema)) bad.push(`spend_bypass: ${why}`);
    }
  }

  const bypass = code(sources[BYPASS] ?? "");
  for (const [re, why] of [
    [/row\.raised_by !== "owner"/, "does not re-check the actor"],
    [/row\.revoked_at !== null/, "does not honour a revocation"],
    [/row\.expires_at <= now/, "does not honour an expiry"],
    [/row\.created_at > now/, "would honour a future-dated bypass"],
    [/row\.amount_micros <= 0/, "would honour a zero or negative amount"],
  ]) {
    if (!re.test(bypass)) bad.push(`${BYPASS}'s isLive ${why}`);
  }

  // ── 7. Nothing turns hard_stop off ─────────────────────────────────────────
  for (const [file, src] of Object.entries(sources)) {
    if (file.startsWith("__")) continue;
    if (file === "src/worker/boss/router/spend.ts") continue; // the lever's OPEN position, by her decision
    if (/hard_stop\s*=\s*0/.test(code(src))) {
      bad.push(
        `${file} sets hard_stop = 0. A bypass moves a ceiling and never removes one — that mechanism's `
        + "end state is silence, where work stops being refused and nobody is told anything.",
      );
    }
  }

  // ── 8. Free is a property of the route, not of a price column ──────────────
  const ZERO_PRICE_MEANS_FREE = /in_micros_1k\s*\)?\s*===?\s*0\s*&&[\s\S]{0,40}out_micros_1k/;
  for (const file of [ROUTER, TODAY, FREE_BRAIN]) {
    const src = code(sources[file] ?? "");
    if (ZERO_PRICE_MEANS_FREE.test(src) && !/FREE_BY_ALLOWANCE|routeIsBilled/.test(src)) {
      bad.push(
        `${file} decides "free" by comparing a price column to zero. That definition broke the moment `
        + "the models were priced — free is the included allowance, which is a property of the backend, "
        + "and `routeIsBilled` in backends/guard.ts is the one statement of it.",
      );
    }
  }
  if (!/export function routeIsBilled/.test(code(sources[GUARD] ?? ""))) {
    bad.push(`${GUARD} does not export routeIsBilled, so every reader is free to invent its own definition`);
  }

  return bad;
}

// ─── Gathering ──────────────────────────────────────────────────────────────

function gather() {
  const { db, applied } = replaySeed();
  const models = rows(db, `SELECT id, provider_id, pricing_state, price_source, data_use, data_use_source FROM models`);
  const providers = rows(db, `SELECT id, api_key_var, enabled FROM providers`);
  const settingRows = rows(db, `SELECT key, value FROM settings`);
  const settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));
  const bypassSchema =
    rows(db, `SELECT sql FROM sqlite_master WHERE type='table' AND name='spend_bypass'`)[0]?.sql ?? null;
  db.close();

  const sources = {};
  for (const f of [POLICY, ROUTER, BYPASS, CONFIDENTIAL, GUARD, TODAY, FREE_BRAIN]) {
    sources[f] = existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), "utf8") : "";
  }
  sources.__migrations = readdirSync(join(ROOT, "migrations"))
    .filter((x) => x.endsWith(".sql"))
    .map((x) => readFileSync(join(ROOT, "migrations", x), "utf8"))
    .join("\n");

  return { models, providers, settings, bypassSchema, sources, applied };
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const good = gather();
  const cases = [
    { name: "the shipped shape passes", input: good, expect: 0 },
    {
      name: "RULE 0: an empty seed passes over nothing",
      input: { ...good, models: [] },
      expect: 1,
    },
    {
      name: "THE ACTUAL DEFECT: a provider enabled without its key",
      input: {
        ...good,
        providers: good.providers.map((p) => (p.api_key_var === "FIREWORKS_API_KEY" ? { ...p, enabled: 1 } : p)),
      },
      expect: 1,
    },
    {
      name: "a credential nothing can reach",
      input: {
        ...good,
        providers: good.providers.map((p) => (p.api_key_var === "OPENROUTER_API_KEY" ? { ...p, enabled: 0 } : p)),
      },
      expect: 1,
    },
    {
      name: "THE ACTUAL DEFECT: a price nobody checked",
      input: { ...good, models: good.models.map((m) => ({ ...m, pricing_state: "UNKNOWN" })) },
      expect: 1,
    },
    {
      name: "a SOURCED price that cites nothing",
      input: {
        ...good,
        models: good.models.map((m) => ({ ...m, pricing_state: "SOURCED", price_source: "trust me" })),
      },
      expect: 1,
    },
    {
      name: "THE ACTUAL DEFECT: the confidential refusal made approvable",
      input: {
        ...good,
        sources: {
          ...good.sources,
          [POLICY]: good.sources[POLICY].replace("approvable: false,", "approvable: true,"),
        },
      },
      expect: 1,
    },
    {
      name: "the confidential rule removed from the router's first stage",
      input: {
        ...good,
        sources: {
          ...good.sources,
          [POLICY]: good.sources[POLICY].replace(
            'ctx.modelAccess === "private_model_only" && !isPrivateModelRoute(model.data_use)',
            "false",
          ),
        },
      },
      expect: 1,
    },
    {
      name: "a scan failure treated as a clean bill",
      input: {
        ...good,
        sources: {
          ...good.sources,
          [CONFIDENTIAL]: good.sources[CONFIDENTIAL].replace("if (!lexicon.established)", "if (false)"),
        },
      },
      expect: 1,
    },
    {
      name: "THE ACTUAL DEFECT: a per-run cap stored and never compared",
      input: {
        ...good,
        sources: { ...good.sources, [ROUTER]: good.sources[ROUTER].replace(/if \((estimate > (?:effectivePerRunCap|perRunCap))\)/, "if (false)") },
      },
      expect: 1,
    },
    {
      name: "THE NEW DEFECT: a gradient that REPLACES the per-run ceiling instead of scaling it",
      input: {
        ...good,
        sources: {
          ...good.sources,
          [ROUTER]: good.sources[ROUTER].replace(
            "const effectivePerRunCap = Math.max(0, Math.floor(perRunCap * effect.perRunFactor));",
            "const effectivePerRunCap = Number.MAX_SAFE_INTEGER;",
          ),
        },
      },
      expect: 1,
    },
    {
      name: "a per-run default that would vanish with an unreadable setting",
      input: {
        ...good,
        sources: {
          ...good.sources,
          [ROUTER]: good.sources[ROUTER].replace('getNumber(db, "per_run_cap_micros", 750_000)', "Number.MAX_SAFE_INTEGER"),
        },
      },
      expect: 1,
    },
    {
      name: "THE ACTUAL DEFECT: an automation able to raise its own bypass",
      input: { ...good, bypassSchema: (good.bypassSchema ?? "").replace("CHECK (raised_by = 'owner')", "") },
      expect: 1,
    },
    {
      name: "a bypass with no expiry",
      input: { ...good, bypassSchema: (good.bypassSchema ?? "").replace("expires_at    INTEGER NOT NULL", "expires_at INTEGER") },
      expect: 1,
    },
    {
      name: "an isLive that stopped honouring revocation",
      input: {
        ...good,
        sources: { ...good.sources, [BYPASS]: good.sources[BYPASS].replace("row.revoked_at !== null", "false") },
      },
      expect: 1,
    },
    {
      name: "something turning hard_stop off",
      input: {
        ...good,
        sources: { ...good.sources, [BYPASS]: `${good.sources[BYPASS]}\nconst x = \`UPDATE budgets SET hard_stop = 0\`;\n` },
      },
      expect: 1,
    },
    {
      name: "THE ACTUAL DEFECT: free decided by a zero in the price column",
      input: {
        ...good,
        sources: {
          ...good.sources,
          [TODAY]: good.sources[TODAY]
            .replace(/routeIsBilled/g, "wasBilled")
            .replace("const free = slugs.length > 0 && slugs.every((slug) => !wasBilled(b.id, slug));",
                     "const free = Number(stats.in_micros_1k) === 0 && Number(stats.out_micros_1k) === 0;"),
        },
      },
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
    }
  }
  if (failed) {
    console.error(`\na-cap-and-a-line self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`a-cap-and-a-line self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const world = gather();
  const problems = check(world);
  if (problems.length) {
    console.error("A CAP AND A LINE SCAN FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }
  console.log(
    `A CAP AND A LINE OK — ${world.applied} migrations replayed; ${world.models.length} models all `
    + `priced with provenance and all carrying a data-use finding, `
    + `${world.providers.filter((p) => Number(p.enabled) === 1).length} enabled provider(s) all holding `
    + `their key, the per-run ceiling at $${(Number(world.settings.per_run_cap_micros) / 1e6).toFixed(2)} `
    + `compared before every call, the confidential refusal unliftable by any card, spend_bypass `
    + `constrained to the owner by the schema, and nothing deciding "free" from a price column.`,
  );
}
