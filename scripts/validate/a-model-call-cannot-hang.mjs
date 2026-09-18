#!/usr/bin/env node
/**
 * NO MODEL CALL MAY HANG, AND NO WALK DOWN THE LADDER MAY RUN UNBOUNDED.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 * On 18 September 2026 this repository had no deadline on a model call. Not a short one — none.
 * Grepping `src/worker/boss/router/` for `AbortSignal`, `AbortController`, `setTimeout` and `signal`
 * returned nothing, and all four `fetch()` calls went out bare. A provider that accepted the
 * connection and then stopped answering held the run open with nothing able to end it.
 *
 * MIGRATION 0256 MADE THE ARITHMETIC MUCH WORSE, CORRECTLY. Fifteen model rows, and
 * `maxFallbackHops` raised 1 → 3 because a thirteen-rung ladder under one paid hop is decoration.
 * The walk became up to ten free attempts plus four paid ones, each retryable — and none of them
 * bounded. The worst case was not a long wait; it had no upper bound. What the owner experiences as
 * "nothing is happening" is exactly the complaint that started that day.
 *
 * ─── And the trap on the way to fixing it ───────────────────────────────────
 *
 * In the sibling repository this same gap was closed by reading a comment that said "~3 min" and
 * writing 180s. The owner caught it at once: A DEADLINE EQUAL TO THE EXPECTED DURATION FAILS ABOUT
 * HALF THE CALLS BY CONSTRUCTION. Measuring that repo's completed runs then showed a 251.0s
 * maximum — four runs that day had already exceeded the number about to ship as the fix. A constant
 * chosen to match a sentence, with the sentence three files away, is this repository's own
 * "a specification no code reads is a wish", and it survived a full day undetected.
 *
 * So this file checks the numbers as well as the wiring:
 *
 *   1. EVERY ADAPTER THAT REACHES A PROVIDER HONOURS THE DEADLINE. A `fetch(` with no
 *      `signal: req.signal` is the original defect. `workersAi.ts` takes a binding rather than a
 *      fetch, so it must race the deadline instead — and it is the one that matters most, being
 *      where every fallback lands.
 *   2. THE ROUTER SUPPLIES ONE. An adapter that accepts a signal nobody passes is a guard that
 *      cannot reach what it governs.
 *   3. THE CHAIN IS BOUNDED BEFORE THE ATTEMPT, NOT DURING IT. The loop must stop when the budget
 *      cannot hold another call, rather than starting one it guarantees will be cut off.
 *   4. THE CHAIN BUDGET IS THE BINDING CONSTRAINT. If the worst case of per-attempt deadlines came
 *      in under the chain budget, the chain budget would be decoration and the real bound would be
 *      a number nobody wrote down.
 *   5. THE PER-ATTEMPT DEADLINE HAS HEADROOM OVER MEASUREMENT. It must stand well clear of the
 *      slowest call this repository has actually recorded, or it is the sibling's 180s again.
 *
 * RULE 0: examining zero adapters is a FAILURE. An empty adapter list would pass every check above
 * over nothing, which is the shape of the defect rather than the absence of it.
 *
 *   node scripts/validate/a-model-call-cannot-hang.mjs
 *   node scripts/validate/a-model-call-cannot-hang.mjs --self-test
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const ROUTER_DIR = "src/worker/boss/router";

/**
 * The slowest call this repository has actually measured, in ms.
 *
 * `bmk_70b_rc_repo` in `model_benchmarks`, 12 September 2026 — one of seven real generations
 * against mdl_cf_llama33_70b (1076 1292 1714 1916 2382 9312 19767). Its own note calls the outlier
 * "ten times its median on the other six probes".
 */
export const MEASURED_SLOWEST_MS = 19_767;

/** How far clear of the slowest measured call the per-attempt deadline must stand. */
export const REQUIRED_HEADROOM = 5;

/**
 * The slowest COMPLETED reasoning-model call measured anywhere in this portfolio, in ms.
 *
 * WHY A FIGURE FROM THE SIBLING REPOSITORY IS THE RIGHT BAR HERE, and why it is not a coupling.
 * Nothing is imported and nothing is shared — copy and diverge is the house rule and it is kept.
 * This is EVIDENCE, not code: the same class of provider call, measured where measurement exists.
 *
 * Boss OS has no latency at all for a reasoning model. `usage_ledger` has no duration column, and
 * the four free reasoning lanes registered by 0256 (rungs 100-130) have served zero production
 * requests, so the only Boss OS figures are seven probes against a 70B NON-reasoning model topping
 * out at 19.8s. Setting a reasoning deadline from that population would be setting it from the
 * wrong distribution and calling the result measured.
 *
 * What was measured, on completed runs, is n=12 with min 68.9s, median 153.6s and max 251.0s. The
 * sibling shipped 180s against that and it would have looked fixed while four of that day's runs
 * still failed. A deadline under 251s here would be the same mistake with the same evidence
 * already in hand, which is the one version of it there is no excuse for.
 */
export const MEASURED_SLOWEST_REASONING_MS = 251_000;

/**
 * Every adapter file in the router directory that actually reaches a provider.
 *
 * FOUND BY WHAT IT DOES, NOT BY A LIST. A list here would be the second copy of the thing whose
 * first copy is the set of files on disk, and a new provider added next year would be the one that
 * hangs.
 */
export function providerAdapters(files) {
  return files
    .filter((f) => /^[a-zA-Z]+\.ts$/.test(f.name))
    .filter((f) => /ProviderAdapter\s*=/.test(f.text))
    .map((f) => ({
      name: f.name,
      // A binding adapter calls no fetch; it must race the deadline instead.
      reachesByFetch: /\bfetch\s*\(/.test(f.text),
      passesSignal: /signal:\s*req\.signal/.test(f.text),
      racesDeadline: /withDeadline\s*\(/.test(f.text),
    }));
}

async function scan() {
  const problems = [];
  const files = readdirSync(join(ROOT, ROUTER_DIR), { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => ({ name: d.name, text: read(join(ROUTER_DIR, d.name)) }));

  const adapters = providerAdapters(files);

  // 1. Every adapter honours the deadline, by the mechanism available to it.
  for (const a of adapters) {
    if (a.reachesByFetch && !a.passesSignal) {
      problems.push(
        `${ROUTER_DIR}/${a.name} calls fetch() without \`signal: req.signal\`. A provider that accepts ` +
        `the connection and then stops answering holds the run open with nothing able to end it — the ` +
        `state every adapter in this directory was in on 18 Sep 2026.`,
      );
    }
    if (!a.reachesByFetch && !a.racesDeadline) {
      problems.push(
        `${ROUTER_DIR}/${a.name} reaches its provider through a binding and does not race the deadline. ` +
        `A binding takes no signal, so racing is the only mechanism available — and this is the adapter ` +
        `that matters most, because it is where every fallback lands.`,
      );
    }
  }

  // 2. The router supplies a signal.
  const routerSrc = read(join(ROUTER_DIR, "index.ts"));
  if (!/signal:\s*AbortSignal\.timeout\(/.test(routerSrc)) {
    problems.push(
      `${ROUTER_DIR}/index.ts never hands a deadline to an adapter. An adapter that accepts a signal ` +
      `nobody passes is a guard that cannot reach what it governs.`,
    );
  }

  // 3. The chain is bounded before the attempt.
  if (!/nextAttemptDeadlineMs\([\s\S]{0,200}?===\s*null[\s\S]{0,600}?break;/.test(routerSrc)) {
    problems.push(
      `${ROUTER_DIR}/index.ts does not stop the walk when the chain budget cannot hold another ` +
      `attempt. Starting a call the budget guarantees will be cut off spends her money and her time ` +
      `on an answer that cannot arrive.`,
    );
  }

  // 4 and 5. The numbers.
  const { ATTEMPT_DEADLINE_MS, CHAIN_BUDGET_MS } = await import("../../src/worker/boss/router/deadlines.ts")
    .catch(async () => {
      // Read the constants out of the source when this runtime cannot import TypeScript.
      const src = read(join(ROUTER_DIR, "deadlines.ts"));
      const num = (name) => {
        const m = new RegExp(`${name}\\s*=\\s*([0-9_]+)`).exec(src);
        return m ? Number(m[1].replace(/_/g, "")) : NaN;
      };
      return { ATTEMPT_DEADLINE_MS: num("ATTEMPT_DEADLINE_MS"), CHAIN_BUDGET_MS: num("CHAIN_BUDGET_MS") };
    });

  const freeHops = Number(/MAX_FREE_HOPS\s*=\s*(\d+)/.exec(routerSrc)?.[1] ?? NaN);
  if (!Number.isFinite(ATTEMPT_DEADLINE_MS) || !Number.isFinite(CHAIN_BUDGET_MS) || !Number.isFinite(freeHops)) {
    problems.push(
      `Could not read ATTEMPT_DEADLINE_MS, CHAIN_BUDGET_MS or MAX_FREE_HOPS. The numbers this ` +
      `validator exists to check are no longer where it looks for them, so it checked none of them.`,
    );
  } else {
    const worstCaseMs = freeHops * ATTEMPT_DEADLINE_MS;
    if (worstCaseMs <= CHAIN_BUDGET_MS) {
      problems.push(
        `The chain budget is decoration: ${freeHops} free hops at ${ATTEMPT_DEADLINE_MS}ms each is ` +
        `${worstCaseMs}ms, which already fits inside the ${CHAIN_BUDGET_MS}ms budget. The real bound ` +
        `would then be a number nobody wrote down.`,
      );
    }
    if (ATTEMPT_DEADLINE_MS <= MEASURED_SLOWEST_REASONING_MS) {
      problems.push(
        `ATTEMPT_DEADLINE_MS is ${ATTEMPT_DEADLINE_MS}ms, at or under the slowest COMPLETED reasoning ` +
        `call measured in this portfolio (${MEASURED_SLOWEST_REASONING_MS}ms). Rungs 100-130 are ` +
        `reasoning lanes with no Boss OS measurement of their own, so this is the governing figure — ` +
        `and a deadline under it cuts off calls that would have succeeded. The sibling shipped 180s ` +
        `against exactly this evidence and it would have looked fixed while still failing.`,
      );
    }
    if (ATTEMPT_DEADLINE_MS < MEASURED_SLOWEST_MS * REQUIRED_HEADROOM) {
      problems.push(
        `ATTEMPT_DEADLINE_MS is ${ATTEMPT_DEADLINE_MS}ms, under ${REQUIRED_HEADROOM}x the slowest call ` +
        `this repository has measured (${MEASURED_SLOWEST_MS}ms, bmk_70b_rc_repo). A deadline set close ` +
        `to the expected duration fails about half the calls by construction — the sibling repo shipped ` +
        `180s against a measured 251s maximum and it would have looked fixed while still failing.`,
      );
    }
  }

  return { examined: adapters.length, problems };
}

// ─── Self-test: the adapter reader, proved on text ──────────────────────────

function selfTest() {
  let failed = 0;
  const cases = [
    {
      name: "a fetch adapter carrying the signal is clean",
      files: [{ name: "openrouter.ts", text: `export const openrouter: ProviderAdapter = { async complete(req, ctx) { await fetch(u, { signal: req.signal }); } };` }],
      want: [{ name: "openrouter.ts", reachesByFetch: true, passesSignal: true, racesDeadline: false }],
    },
    {
      name: "THE ORIGINAL DEFECT: a fetch adapter with a bare fetch",
      files: [{ name: "openai.ts", text: `export const openai: ProviderAdapter = { async complete(req, ctx) { await fetch(u, { method: "POST" }); } };` }],
      want: [{ name: "openai.ts", reachesByFetch: true, passesSignal: false, racesDeadline: false }],
    },
    {
      name: "a binding adapter that races is clean and is not judged on fetch",
      files: [{ name: "workersAi.ts", text: `export const workersAi: ProviderAdapter = { async complete(req, ctx) { await withDeadline(ctx.ai.run(x), req.signal); } };` }],
      want: [{ name: "workersAi.ts", reachesByFetch: false, passesSignal: false, racesDeadline: true }],
    },
    {
      name: "a file that is not an adapter is not examined",
      files: [{ name: "budget.ts", text: `export function laneBudgetState() { return fetch; }` }],
      want: [],
    },
  ];
  for (const c of cases) {
    const got = providerAdapters(c.files);
    if (JSON.stringify(got) !== JSON.stringify(c.want)) {
      console.error(`  ✗ ${c.name}: expected ${JSON.stringify(c.want)}, got ${JSON.stringify(got)}`);
      failed += 1;
    }
  }
  if (failed) {
    console.error(`\nSELF-TEST FAILED: ${failed} case(s)`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASSED: ${cases.length}/${cases.length} cases.`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const { examined, problems } = await scan();

if (examined === 0) {
  console.error(
    "MODEL CALL DEADLINE SCAN EXAMINED NO ADAPTERS. No file in src/worker/boss/router/ declares a\n" +
    "ProviderAdapter the way this scan reads them, so every check ran over an empty list. That is a\n" +
    "broken scan, not a clean repo.",
  );
  process.exit(2);
}

if (problems.length > 0) {
  console.error("MODEL CALL DEADLINE SCAN FAILED:\n");
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  console.error(
    "An unbounded call is not a slow answer, it is no answer and no explanation — which she\n" +
    "experiences as nothing happening, and cannot diagnose from the outside.",
  );
  process.exit(1);
}

console.log(
  `MODEL CALL DEADLINE SCAN PASSED: ${examined} provider adapter(s), each honouring the deadline by ` +
  `the mechanism available to it; the router supplies one; the walk stops before a call the budget ` +
  `cannot hold; and the per-attempt deadline stands clear of the slowest call ever measured here.`,
);
selfTest();
