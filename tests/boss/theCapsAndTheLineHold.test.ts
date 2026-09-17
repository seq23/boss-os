import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routeCompletion, BudgetExceeded, RoutingBlocked } from "../../src/worker/boss/router";
import { setSpendLever } from "../../src/worker/boss/router/spend";
import { bypassFor, isLive, predictSpend, type BypassRow } from "../../src/worker/boss/router/bypass";
import { scanForConfidential, confidentialLexicon, mayHoldConfidential } from "../../src/worker/boss/router/confidential";
import { row, all, api, apiJson, stubFetch, completionResponse } from "./helpers";

/**
 * EXERCISING EVERY PATH, BECAUSE UNTIL SOMETHING HAS FAILED NONE OF THIS IS A CLAIM.
 *
 * Fifteen calls on one model, all at $0, is not evidence that routing, fallback, a budget stop or a
 * bypass work. It is evidence that one model answered fifteen times. So every path below is driven
 * DELIBERATELY into its failure: the free allowance gone, the key missing, the per-run ceiling
 * breached, the day and the month spent, a bypass live and then expired, and LP material offered to
 * a route whose terms permit training on it.
 *
 * Each one asserts THREE things, because any two of them can be true while the control does
 * nothing: the run was refused, NO PROVIDER WAS CALLED, and the decision log says why in words a
 * person can act on. The middle one is the assertion that catches a guard which refuses after the
 * money has been spent.
 */

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const baseRequest = {
  routeId: "rt_ops_default",
  lane: "ops",
  intakeKind: "drafting",
  messages: [{ role: "user" as const, content: "Say something short." }],
};

/** The Workers AI binding the test runtime does not have, supplied by hand. */
function withAi(text = "Free tier answer.", usage = { prompt_tokens: 20, completion_tokens: 10 }) {
  const calls: string[] = [];
  const bound = Object.create(env) as typeof env;
  (bound as any).AI = {
    async run(model: string) { calls.push(model); return { response: text, usage }; },
  };
  return { bound, calls };
}

async function provisionWorkersAi() {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_workers_ai'`).run();
  const res = await api("/api/models/provision/bk_workers_ai", { method: "POST", body: {} });
  expect(res.status).toBe(201);
}

/** What it takes to make the PAID Fireworks path reachable now that enabling follows the key. */
async function commissionFireworks(position: "MODERATE" | "OPEN" = "MODERATE") {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_fireworks'`).run();
  await env.DB.prepare(`UPDATE providers SET enabled = 1 WHERE id = 'prv_fireworks'`).run();
  await setSpendLever(env.DB, { position }, "test");
}

async function raiseBypass(body: Record<string, unknown>) {
  return apiJson("/api/models/caps/bypass", { method: "POST", body });
}

const HOUR = 3_600_000;

/**
 * THE RUNAWAY THIS CAP EXISTS FOR IS A LONG GENERATION, NOT A LONG PROMPT.
 *
 * `mdl_cf_llama33_70b` is published at $0.293 per M input tokens and $2.253 per M output — nearly
 * eight times the rate — so output is where a single call gets expensive. Asking the route for
 * 400,000 output tokens estimates at 400 x 2253 = 901,200 micros, which is over the $0.75 ceiling
 * and under the $1.75 the ops day allows. That gap is deliberate: it isolates the PER-RUN cap, so a
 * refusal here cannot be the daily budget wearing its coat.
 *
 * A first version of this test used a four-million-character prompt instead and did not breach
 * anything — 1M input tokens on this model is about $0.29 — which is worth recording, because it is
 * the same arithmetic that makes the output rate the number to watch.
 *
 * At 400,000 output tokens the estimate is 901,201 micros for the 70B and 114,801 for the 8B, so
 * the cap bites on one and not the other. That asymmetry is used deliberately below: it is what
 * lets the "a cheaper model may still carry it" case be told apart from the "nothing may run" one.
 */
async function askForARunawayGeneration() {
  await env.DB
    .prepare(`UPDATE routes SET max_output_tokens = 400000 WHERE id = 'rt_ops_default'`)
    .run();
}

/**
 * Leave the 70B as the only route that can run.
 *
 * Without this, a per-run refusal is not a refusal at all: the router drops the candidate that
 * breached the cap and the 8B — which fits inside it — carries the work. That is the CORRECT
 * behaviour and it has its own test below. This narrows the field so the other half, the one where
 * nothing is left, can be asserted on its own rather than inferred.
 */
async function onlyTheSeventyBRuns() {
  await env.DB.prepare(`UPDATE models SET enabled = 0 WHERE id = 'mdl_cf_llama31_8b'`).run();
}

describe("1 · the shipped seed follows its keys", () => {
  /**
   * THE TWO LIES, ASSERTED AS FIXED IN THE DATA RATHER THAN IN A MIGRATION COMMENT.
   *
   * A migration's prose is not a guarantee; a later migration can undo it silently. This reads the
   * database the product actually ships with.
   */
  it("has Fireworks disabled because there is no key, and OpenRouter reachable because there is one", async () => {
    const fireworks = await row<{ enabled: number }>(`SELECT enabled FROM providers WHERE id = 'prv_fireworks'`);
    expect(fireworks!.enabled).toBe(0);

    // And the registry row says WHY, so the reason is on the screen she reads rather than in a file.
    const backend = await row<{ status_reason: string }>(
      `SELECT status_reason FROM execution_backends WHERE id = 'bk_fireworks'`,
    );
    expect(backend!.status_reason).toContain("FIREWORKS_API_KEY");

    // The credential that DOES exist now has something it can reach.
    const openrouter = await row<{ enabled: number }>(`SELECT enabled FROM providers WHERE id = 'prv_openrouter'`);
    expect(openrouter!.enabled).toBe(1);

    // And only :free slugs are registered, so the lane it gained costs nothing at any lever
    // position — including OPEN, where nothing would refuse it.
    const orModels = await all<{ slug: string; in_micros_1k: number; out_micros_1k: number }>(
      `SELECT slug, in_micros_1k, out_micros_1k FROM models WHERE provider_id = 'prv_openrouter'`,
    );
    expect(orModels.length).toBeGreaterThan(0);
    for (const m of orModels) {
      expect(m.slug.endsWith(":free")).toBe(true);
      expect(m.in_micros_1k).toBe(0);
      expect(m.out_micros_1k).toBe(0);
    }
  });

  /** Every price either cites a vendor or says, in the row, that it could not be confirmed. */
  it("lets no price stand without provenance, and promotes no guess", async () => {
    const models = await all<{ id: string; pricing_state: string; price_source: string | null }>(
      `SELECT id, pricing_state, price_source FROM models`,
    );
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.pricing_state).not.toBe("UNKNOWN");
      expect(m.price_source ?? "").not.toBe("");
    }

    // The two that actually run are priced from the vendor's own published figures.
    const seventy = models.find((m) => m.id === "mdl_cf_llama33_70b")!;
    expect(seventy.pricing_state).toBe("SOURCED");
    expect(seventy.price_source).toContain("developers.cloudflare.com");
    expect(seventy.price_source).toContain("Neurons");

    // And 0174's standard survives: the one that could not be confirmed is still unconfirmed.
    const kimi = models.find((m) => m.id === "mdl_kimi_k2")!;
    expect(kimi.pricing_state).toBe("ILLUSTRATIVE");
    expect(kimi.price_source).toContain("a tracker is not the vendor");
  });
});

describe("2 · the confidential line, offered exactly the content it exists to refuse", () => {
  it("refuses a route whose terms permit training, and no approval lifts it", async () => {
    await provisionWorkersAi();
    // Only the training-permitting route is left standing, so the refusal cannot be satisfied
    // elsewhere and has to be visible.
    await env.DB.prepare(`UPDATE providers SET enabled = 0 WHERE id = 'prv_workers_ai'`).run();
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_openrouter'`).run();

    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("must not run"); });

    const err = await routeCompletion(env, {
      ...baseRequest,
      taskId: "tsk_conf1",
      // An LP name this system holds, and a deal term, in the words a draft would really use.
      messages: [{ role: "user", content: "Draft a note about the $2.5M commitment and the side letter." }],
      // THE CARD IS APPROVED, and it changes nothing. That is the assertion.
      cloudForRestrictedAllowed: true,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(RoutingBlocked);
    // NOBODY WAS CALLED. A refusal issued after the content left would not be a refusal.
    expect(called).toBe(false);

    const decision = await row<{ candidates: string }>(
      `SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_conf1'`,
    );
    const candidates = JSON.parse(decision!.candidates) as { stage: string; verdict: string; reason: string }[];
    const refused = candidates.filter((x) => x.reason.includes("training on what is sent"));
    expect(refused.length).toBeGreaterThan(0);
    for (const r of refused) {
      expect(r.stage).toBe("privacy");
      expect(r.verdict).toBe("rejected");
    }
    // And it says plainly that no approval helps, so nobody goes looking for a card that would.
    expect(refused[0]!.reason).toContain("No approval lifts this");
  });

  it("still runs the same content on a route that does not train", async () => {
    await provisionWorkersAi();
    const { bound, calls } = withAi("Drafted.");

    const result = await routeCompletion(bound, {
      ...baseRequest,
      taskId: "tsk_conf2",
      messages: [{ role: "user", content: "Draft a note about the $2.5M commitment and the side letter." }],
    });

    expect(calls.length).toBe(1);
    const chosen = await row<{ data_use: string }>(`SELECT data_use FROM models WHERE id = ?`, result.modelId);
    expect(chosen!.data_use).toBe("NO_TRAINING_CONTRACTUAL");
  });

  /**
   * THE REFUSAL NEVER QUOTES WHAT IT FOUND.
   *
   * `routing_decisions.candidates` is read months later, by a person, on a screen. A refusal that
   * repeated the LP's name into the log would have moved the leak rather than stopped it.
   */
  it("names the kind of thing it found and never the thing itself", async () => {
    const lexicon = await confidentialLexicon(env.DB);
    const verdict = scanForConfidential(
      [{ role: "user", content: "Northgate Partners committed $2.5M with an MFN side letter." }],
      lexicon,
    );
    expect(verdict.confidential).toBe(true);
    expect(verdict.reason).not.toContain("Northgate");
    expect(verdict.reason).not.toContain("2.5M");
    expect(verdict.kinds.join(" ")).toMatch(/money figure|side-letter|commitment/);
  });

  it("treats a scan it could not complete as a hit, rather than as a clean bill", () => {
    const broken = { names: [], established: false, note: "the lexicon could not be read" };
    const verdict = scanForConfidential([{ role: "user", content: "hello" }], broken);
    expect(verdict.confidential).toBe(true);
  });

  it("lets exactly one data-use value hold confidential material", () => {
    expect(mayHoldConfidential("NO_TRAINING_CONTRACTUAL")).toBe(true);
    for (const v of ["TRAINS_ON_PROMPTS", "UNKNOWN", "", null, undefined, "NO_TRAINING", "anything"]) {
      expect(mayHoldConfidential(v as never)).toBe(false);
    }
  });
});

describe("3 · the per-run ceiling", () => {
  it("refuses a run over $0.75 before calling anybody, and says by how much", async () => {
    await provisionWorkersAi();
    await askForARunawayGeneration();
    await onlyTheSeventyBRuns();
    const { bound, calls } = withAi();

    const err = await routeCompletion(bound, { ...baseRequest, taskId: "tsk_cap1" }).catch((e) => e);

    expect(err).toBeInstanceOf(BudgetExceeded);
    expect(calls.length).toBe(0);

    const decision = await row<{ candidates: string }>(
      `SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_cap1'`,
    );
    // The refusal PREDICTS: it names the task, the ceiling, and the shortfall.
    expect(decision!.candidates).toContain("more than");
    expect(decision!.candidates).toContain("what a single run may cost");
    expect(decision!.candidates).toContain("bypass");

    // And it was recorded where a person looks for it rather than only thrown.
    const event = await row<{ detail: string }>(
      `SELECT detail FROM system_events WHERE event = 'per_run_cap_would_be_breached' ORDER BY ts DESC LIMIT 1`,
    );
    expect(event).toBeTruthy();
    expect(JSON.parse(event!.detail).over_by_micros).toBeGreaterThan(0);
  });

  it("checks a FREE route too, because free means an allowance nobody can measure", async () => {
    // The ceiling refused above was a WORKERS AI run — a route `backends/guard.ts` calls free. That
    // is the point rather than an oversight: "free" means an included allowance a Worker has no way
    // to measure, and a generation large enough to breach a per-run ceiling is large enough to be
    // her decision whether or not today's allowance happens to absorb it.
    const perRun = await row<{ value: string }>(`SELECT value FROM settings WHERE key = 'per_run_cap_micros'`);
    expect(Number(perRun!.value)).toBe(750_000);
  });

  /**
   * AND A CAP IS NOT AN OUTAGE. The 70B breaches the ceiling; the 8B fits under it and takes the
   * work. Removing one candidate is what a per-run cap is supposed to do, and the run still happens
   * — LABELLED, so a cheaper model doing worse work is never silent.
   */
  it("drops only the candidate that breached it, and says the run degraded", async () => {
    await provisionWorkersAi();
    await askForARunawayGeneration();
    const { bound, calls } = withAi("the cheaper model answered");

    const result = await routeCompletion(bound, { ...baseRequest, taskId: "tsk_cap2" });

    expect(result.modelId).toBe("mdl_cf_llama31_8b");
    expect(calls[0]).toBe("@cf/meta/llama-3.1-8b-instruct-fp8");
    expect(result.degraded).toBe(true);
    expect(result.modelName).toContain("DEGRADED TIER");

    // And the expensive one is on the record as refused at BUDGET, with the shortfall named.
    const decision = await row<{ candidates: string }>(
      `SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_cap2'`,
    );
    const candidates = JSON.parse(decision!.candidates) as { model_id: string; stage: string; reason: string }[];
    const refused = candidates.find((x) => x.model_id === "mdl_cf_llama33_70b");
    expect(refused!.stage).toBe("budget");
    expect(refused!.reason).toContain("what a single run may cost");
  });
});

describe("4 · the day and the month", () => {
  it("stops at the daily ceiling without calling a provider, and free work keeps running", async () => {
    await commissionFireworks("MODERATE");
    await provisionWorkersAi();

    // Spend the ops day.
    await env.DB.prepare(`UPDATE budgets SET spent_micros = limit_micros WHERE lane = 'ops' AND period = 'day'`).run();

    let paidCalled = false;
    restore = stubFetch(() => { paidCalled = true; return completionResponse("paid, must not run"); });
    const { bound, calls } = withAi("free, still running");

    const result = await routeCompletion(bound, { ...baseRequest, taskId: "tsk_day1" });

    // THE PAID ROUTE WAS NEVER CALLED...
    expect(paidCalled).toBe(false);
    // ...AND THE FREE ONE STILL RAN. A continuity system that switches itself off when the paid
    // budget is gone has switched off at the moment it exists for.
    expect(calls.length).toBe(1);
    expect(result.costMicros).toBe(0);
    expect(result.freeTier).toBe(true);
  });

  it("stops at the monthly ceiling the same way", async () => {
    await commissionFireworks("MODERATE");
    await env.DB.prepare(`UPDATE budgets SET spent_micros = limit_micros WHERE lane = 'ops' AND period = 'month'`).run();

    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("must not run"); });

    await expect(routeCompletion(env, { ...baseRequest, taskId: "tsk_month1" })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(called).toBe(false);

    const decision = await row<{ candidates: string }>(
      `SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_month1'`,
    );
    expect(decision!.candidates).toContain("budget");
  });
});

describe("5 · the bypass", () => {
  it("is refused every way it can be malformed, and each refusal says what is missing", async () => {
    const future = Date.now() + HOUR;
    const cases: [string, Record<string, unknown>][] = [
      ["no scope", { amount_micros: 1, reason: "a good long reason", expires_at: future }],
      ["a scope nobody defined", { scope: "forever", amount_micros: 1, reason: "a good long reason", expires_at: future }],
      ["no amount", { scope: "per_run", reason: "a good long reason", expires_at: future }],
      ["a zero amount", { scope: "per_run", amount_micros: 0, reason: "a good long reason", expires_at: future }],
      ["a negative amount", { scope: "per_run", amount_micros: -5, reason: "a good long reason", expires_at: future }],
      ["no reason", { scope: "per_run", amount_micros: 1, expires_at: future }],
      ["a reason too short to mean anything", { scope: "per_run", amount_micros: 1, reason: "urgent", expires_at: future }],
      ["no expiry", { scope: "per_run", amount_micros: 1, reason: "a good long reason" }],
      ["an expiry in the past", { scope: "per_run", amount_micros: 1, reason: "a good long reason", expires_at: Date.now() - HOUR }],
      ["a day bypass naming no lane", { scope: "day", amount_micros: 1, reason: "a good long reason", expires_at: future }],
      ["a lane that does not exist", { scope: "day", lane: "nope", amount_micros: 1, reason: "a good long reason", expires_at: future }],
    ];

    for (const [name, body] of cases) {
      const res = await raiseBypass(body);
      expect(res.status, `${name} should be refused`).toBeGreaterThanOrEqual(400);
    }

    // RULE 0 FOR THIS TEST: nothing was written by any of them.
    const rows = await all(`SELECT id FROM spend_bypass`);
    expect(rows.length).toBe(0);
  });

  it("cannot be attributed to anyone but the owner, and the database is what refuses", async () => {
    // Not the route — the ROW. A caller that found another way in still cannot write this.
    await expect(
      env.DB
        .prepare(
          `INSERT INTO spend_bypass (id, scope, lane, amount_micros, reason, raised_by, created_at, expires_at)
           VALUES ('byp_forged','per_run',NULL,1000000,'an automation granting itself headroom','duty_camille',?,?)`,
        )
        .bind(Date.now(), Date.now() + HOUR)
        .run(),
    ).rejects.toThrow();
  });

  it("lifts the per-run ceiling while it is live, and the spend is stamped with which decision paid", async () => {
    await provisionWorkersAi();
    await askForARunawayGeneration();
    await onlyTheSeventyBRuns();
    const { bound, calls } = withAi("a long answer");

    // Without one: refused.
    await expect(
      routeCompletion(bound, { ...baseRequest, taskId: "tsk_byp0" }),
    ).rejects.toBeInstanceOf(BudgetExceeded);
    expect(calls.length).toBe(0);

    const raised = await raiseBypass({
      scope: "per_run",
      amount_micros: 50_000_000,
      reason: "the quarterly LP letter is one long generation and it is worth it",
      expires_at: Date.now() + HOUR,
    });
    expect(raised.status).toBe(200);
    const bypassId = raised.body.data.bypass.id as string;

    // With one: it runs.
    const result = await routeCompletion(bound, { ...baseRequest, taskId: "tsk_byp1" });
    expect(calls.length).toBe(1);

    // AND THE MONTH CAN BE READ AS "THE BUDGET, PLUS THIS DECISION".
    const ledger = await row<{ bypass_id: string | null }>(
      `SELECT bypass_id FROM usage_ledger WHERE task_id = 'tsk_byp1' AND status = 'ok'`,
    );
    expect(ledger!.bypass_id).toBe(bypassId);
    expect(result.modelId).toBeTruthy();
  });

  it("is over the moment it expires, and an expired one is not a smaller bypass", async () => {
    const now = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO spend_bypass (id, scope, lane, amount_micros, reason, raised_by, created_at, expires_at)
         VALUES ('byp_expired','per_run',NULL,50000000,'expired an hour ago and must not still be lifting anything','owner',?,?)`,
      )
      .bind(now - 2 * HOUR, now - HOUR)
      .run();

    const state = await bypassFor(env.DB, "per_run", null, now);
    expect(state.active).toBeNull();

    // And the run it would have allowed is refused again.
    await provisionWorkersAi();
    await askForARunawayGeneration();
    await onlyTheSeventyBRuns();
    const { bound, calls } = withAi();
    await expect(
      routeCompletion(bound, { ...baseRequest, taskId: "tsk_byp2" }),
    ).rejects.toBeInstanceOf(BudgetExceeded);
    expect(calls.length).toBe(0);
  });

  it("is over the moment she revokes it", async () => {
    const raised = await raiseBypass({
      scope: "per_run", amount_micros: 50_000_000,
      reason: "raised and then thought better of",
      expires_at: Date.now() + HOUR,
    });
    const id = raised.body.data.bypass.id as string;
    expect((await bypassFor(env.DB, "per_run", null)).active).toBeTruthy();

    const revoked = await apiJson(`/api/models/caps/bypass/${id}/revoke`, { method: "POST", body: { reason: "not needed" } });
    expect(revoked.status).toBe(200);
    expect((await bypassFor(env.DB, "per_run", null)).active).toBeNull();

    // Marked, never deleted: the decision she changed her mind about is still on the record.
    const kept = await row<{ revoked_at: number }>(`SELECT revoked_at FROM spend_bypass WHERE id = ?`, id);
    expect(kept!.revoked_at).toBeGreaterThan(0);
  });

  it("refuses every shape of a row that is not a live bypass", () => {
    const now = Date.now();
    const good: BypassRow = {
      id: "byp_x", scope: "per_run", lane: null, amount_micros: 1000, reason: "a perfectly good reason",
      raised_by: "owner", created_at: now - 1000, expires_at: now + HOUR, revoked_at: null,
    };
    expect(isLive(good, now)).toBe(true);

    expect(isLive({ ...good, raised_by: "duty_camille" }, now)).toBe(false);
    expect(isLive({ ...good, revoked_at: now - 1 }, now)).toBe(false);
    expect(isLive({ ...good, expires_at: now - 1 }, now)).toBe(false);
    expect(isLive({ ...good, expires_at: NaN }, now)).toBe(false);
    expect(isLive({ ...good, created_at: now + HOUR }, now)).toBe(false);
    expect(isLive({ ...good, amount_micros: 0 }, now)).toBe(false);
    expect(isLive({ ...good, reason: "short" }, now)).toBe(false);
    expect(isLive({ ...good, scope: "everything" }, now)).toBe(false);
  });

  it("predicts the shortfall before the work stops, and names the cap that will stop it", () => {
    const p = predictSpend({
      what: "the quarterly LP letter",
      estimateMicros: 1_200_000,
      perRunCapMicros: 750_000,
      dayRemainingMicros: 1_750_000,
      monthRemainingMicros: 52_500_000,
    });
    expect(p.willExceed).toBe(true);
    expect(p.cap).toBe("per_run");
    expect(p.overBy).toBe(450_000);
    expect(p.sentence).toContain("the quarterly LP letter");
    expect(p.sentence).toContain("$0.45");
    expect(p.sentence).toContain("bypass");

    // The per-run ceiling is checked FIRST, because it is the one a single task can hit alone.
    // Telling her the month is fine about a call that dies on the per-run ceiling is useless.
    const dayBound = predictSpend({
      what: "a smaller job", estimateMicros: 500_000, perRunCapMicros: 750_000,
      dayRemainingMicros: 100_000, monthRemainingMicros: 52_500_000,
    });
    expect(dayBound.cap).toBe("day");

    expect(
      predictSpend({
        what: "a fine job", estimateMicros: 1000, perRunCapMicros: 750_000,
        dayRemainingMicros: 1_750_000, monthRemainingMicros: 52_500_000,
      }).willExceed,
    ).toBe(false);
  });
});

describe("6 · a key that does not exist", () => {
  it("does not offer a Fireworks model at all, rather than failing at the call", async () => {
    await provisionWorkersAi();
    const { bound } = withAi();
    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("no key, must not be reached"); });

    await routeCompletion(bound, { ...baseRequest, taskId: "tsk_nokey" });

    // Nothing reached the network. Before 0247 both of this route's declared models were on a
    // provider with no key, and every run discovered that one candidate at a time.
    expect(called).toBe(false);
    const decision = await row<{ candidates: string }>(
      `SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_nokey'`,
    );
    const candidates = JSON.parse(decision!.candidates) as { model_id: string }[];
    expect(candidates.some((x) => x.model_id === "mdl_kimi_k2")).toBe(true);
    // It is recorded as unavailable rather than silently absent — the log still explains itself.
    expect(decision!.candidates).toContain("disabled or missing");
  });
});

describe("7 · the task-kind rules govern something now", () => {
  it("keeps a cheap model off judgement work, and the refusal names the stage", async () => {
    const fast = await all<{ id: string; approved_task_kinds: string }>(
      `SELECT id, approved_task_kinds FROM models WHERE capability_tier = 'fast'`,
    );
    expect(fast.length).toBeGreaterThan(0);
    for (const m of fast) {
      const approved = JSON.parse(m.approved_task_kinds) as string[];
      expect(approved.length).toBeGreaterThan(0);
      for (const judgement of [
        "coaching", "decision_support", "trading", "approval_request",
        "new_agent_proposal", "relationship", "west_peek_bridge", "research",
      ]) {
        expect(approved, `${m.id} must not be approved for ${judgement}`).not.toContain(judgement);
      }
    }
  });

  it("refuses a fast model a job outside its allowlist, at the capability stage, before any call", async () => {
    await provisionWorkersAi();
    // Leave only the 8B standing, so the refusal cannot be satisfied by the 70B.
    await env.DB.prepare(`UPDATE models SET enabled = 0 WHERE id != 'mdl_cf_llama31_8b'`).run();
    const { bound, calls } = withAi();

    const err = await routeCompletion(bound, {
      ...baseRequest, taskId: "tsk_kind1", intakeKind: "decision_support",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(RoutingBlocked);
    expect(calls.length).toBe(0);
    const decision = await row<{ candidates: string }>(
      `SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_kind1'`,
    );
    const candidates = JSON.parse(decision!.candidates) as { stage: string; reason: string }[];
    const refused = candidates.find((x) => x.reason.includes("not approved for decision_support"));
    expect(refused).toBeTruthy();
    expect(refused!.stage).toBe("capability");
  });
});

describe("8 · the caps surface reads the same numbers the router enforces", () => {
  it("reports the per-run ceiling, and shows it lifted while a bypass is live", async () => {
    const before = await apiJson("/api/models/caps");
    expect(before.status).toBe(200);
    expect(before.body.data.per_run.cap_micros).toBe(750_000);
    expect(before.body.data.per_run.lifted_by).toBeNull();

    await raiseBypass({
      scope: "per_run", amount_micros: 2_000_000,
      reason: "one big generation this afternoon",
      expires_at: Date.now() + HOUR,
    });

    const after = await apiJson("/api/models/caps");
    expect(after.body.data.per_run.cap_micros).toBe(2_000_000);
    expect(after.body.data.per_run.lifted_by).toBeTruthy();
    // The default is still visible beside it, so "lifted to" never reads as "always was".
    expect(after.body.data.per_run.default_micros).toBe(750_000);
  });

  it("answers 'will this fit' before anything is queued", async () => {
    const res = await apiJson("/api/models/caps/predict", {
      method: "POST",
      body: { what: "the quarterly LP letter", estimate_micros: 1_200_000, lane: "ops" },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.prediction.willExceed).toBe(true);
    expect(res.body.data.prediction.sentence).toContain("the quarterly LP letter");
  });
});
