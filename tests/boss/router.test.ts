import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { routeCompletion, BudgetExceeded, RoutingBlocked, theWall } from "../../src/worker/boss/router";
import { rollBudgetWindows, windowStart, laneBudgetState } from "../../src/worker/boss/router/budget";
import { setSpendLever, spendLeverState } from "../../src/worker/boss/router/spend";
import { BREAKER_THRESHOLD, breakerState } from "../../src/worker/boss/router/breaker";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { insertTask, row, all, api, apiJson, stubFetch, completionResponse } from "./helpers";

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const baseRequest = {
  routeId: "rt_ops_default",
  lane: "ops",
  // A task kind is REQUIRED, not optional. `execution_backends.allowed_kinds`
  // decides what a backend may be handed, and a request that names no kind is an
  // absent input — refused, never defaulted to something permissive.
  intakeKind: "drafting",
  messages: [{ role: "user" as const, content: "Say something short." }],
};

/**
 * THE PAID PATH IS NO LONGER THE DEFAULT PATH, AND THAT IS THE POINT OF STAGE 4.
 *
 * Two things now stand between a queued task and a metered vendor call: the
 * backend must be COMMISSIONED (migration 0173 registers every backend and
 * enables none — "a registry that arrives switched on is a registry whose first
 * run is also its first test"), and the SPEND LEVER must be off FREE_ONLY, which
 * is where it sits by default because the owner's standing instruction is to keep
 * this system as close to $0 as possible.
 *
 * Every test below that expects a paid Fireworks model to run calls this first.
 * Tests that expect a refusal deliberately do not.
 */
async function commissionFireworks(position: "MODERATE" | "OPEN" = "MODERATE") {
  await env.DB
    .prepare(`UPDATE execution_backends SET status = 'enabled', status_reason = 'commissioned in a test' WHERE id = 'bk_fireworks'`)
    .run();
  await setSpendLever(env.DB, { position }, "test");
}

/** The Workers AI binding this Worker does not have in test config, supplied by hand. */
function withAi(text = "Free tier answer.", usage = { prompt_tokens: 20, completion_tokens: 10 }) {
  const calls: string[] = [];
  const bound = Object.create(env) as typeof env & { AI: { run: (m: string, i: unknown) => Promise<unknown> } };
  (bound as any).AI = {
    async run(model: string) {
      calls.push(model);
      return { response: text, usage };
    },
  };
  return { bound, calls };
}

async function provisionWorkersAi() {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_workers_ai'`).run();
  const res = await api("/api/models/provision/bk_workers_ai", { method: "POST", body: {} });
  expect(res.status).toBe(201);
}

describe("Phase 2 — model router", () => {
  it("routes to the primary model and records the decision and the cost", async () => {
    await commissionFireworks();
    restore = stubFetch(() => completionResponse("Done.", 1000, 500));

    const result = await routeCompletion(env, { ...baseRequest, taskId: "tsk_r1" });

    expect(result.modelId).toBe("mdl_kimi_k2");
    // 1000 in @600/1k + 500 out @2500/1k = 600 + 1250
    expect(result.costMicros).toBe(1850);
    expect(result.degraded).toBe(false);
    expect(result.notice).toBeNull();
    const decision = await row(`SELECT outcome, chosen_model_id FROM routing_decisions WHERE task_id = 'tsk_r1'`);
    expect(decision!.outcome).toBe("routed");
    const usage = await row(`SELECT cost_micros, status FROM usage_ledger WHERE task_id = 'tsk_r1'`);
    expect(usage!.cost_micros).toBe(1850);
    // Spend accrues against the backend as well as the lane, so one window can be read per backend.
    const backend = await row(`SELECT spent_micros FROM execution_backends WHERE id = 'bk_fireworks'`);
    expect(backend!.spent_micros).toBe(1850);
  });

  it("falls back once when the primary fails, and says so", async () => {
    await commissionFireworks();
    let call = 0;
    restore = stubFetch(() => {
      call++;
      return call === 1 ? new Response("upstream on fire", { status: 500 }) : completionResponse("Recovered.", 100, 100);
    });

    const result = await routeCompletion(env, { ...baseRequest, taskId: "tsk_r2" });

    expect(result.usedFallback).toBe(true);
    expect(result.modelId).toBe("mdl_qwen_fast");
    const decision = await row(`SELECT outcome, candidates FROM routing_decisions WHERE task_id = 'tsk_r2'`);
    expect(decision!.outcome).toBe("fallback");
    expect(JSON.parse(decision!.candidates).length).toBeGreaterThanOrEqual(2);
  });

  it("hard stops on the lane budget and never calls a provider", async () => {
    await commissionFireworks();
    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("nope"); });
    await env.DB.prepare(`UPDATE budgets SET spent_micros = limit_micros WHERE lane = 'ops' AND period = 'day'`).run();

    await expect(routeCompletion(env, { ...baseRequest, taskId: "tsk_r3" })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(called).toBe(false);
    const decision = await row(`SELECT outcome, candidates FROM routing_decisions WHERE task_id = 'tsk_r3'`);
    expect(decision!.outcome).toBe("blocked_budget");
    expect(decision!.candidates).toContain("has spent its");
  });

  it("refuses to spend at all in SHUTDOWN_MANUAL", async () => {
    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("nope"); });

    await expect(
      routeCompletion(env, { ...baseRequest, taskId: "tsk_r4", costMode: "SHUTDOWN_MANUAL" }),
    ).rejects.toBeInstanceOf(RoutingBlocked);
    expect(called).toBe(false);
    const decision = await row(`SELECT outcome FROM routing_decisions WHERE task_id = 'tsk_r4'`);
    expect(decision!.outcome).toBe("blocked_policy");
  });

  it("keeps a general model out of EMERGENCY_LOW_COST and records why", async () => {
    await commissionFireworks();
    restore = stubFetch(() => completionResponse("cheap", 10, 10));
    const result = await routeCompletion(env, { ...baseRequest, taskId: "tsk_r5", costMode: "EMERGENCY_LOW_COST" });

    // kimi is tier 'general' and must be skipped; qwen is 'fast'.
    expect(result.modelId).toBe("mdl_qwen_fast");
    const decision = await row(`SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_r5'`);
    const candidates = JSON.parse(decision!.candidates);
    expect(candidates[0].reason).toContain("does not allow general");
    expect(candidates[0].stage).toBe("capability");
  });

  it("refuses a model whose risk ceiling is below the task", async () => {
    await commissionFireworks();
    restore = stubFetch(() => completionResponse("should not run"));

    await expect(
      routeCompletion(env, { ...baseRequest, taskId: "tsk_r6a", risk: "high" }),
    ).rejects.toBeInstanceOf(RoutingBlocked);

    const decision = await row(`SELECT outcome, candidates FROM routing_decisions WHERE task_id = 'tsk_r6a'`);
    expect(decision!.outcome).toBe("blocked_no_model");
    expect(decision!.candidates).toContain("cleared to");
  });

  it("blocks high-risk work from an unbenchmarked model even when the risk ceiling allows it", async () => {
    await commissionFireworks();
    restore = stubFetch(() => completionResponse("should not run"));
    // Clear the risk ceiling so the benchmark gate is the only thing left.
    await env.DB.prepare(`UPDATE models SET max_risk = 'high' WHERE id IN ('mdl_kimi_k2','mdl_qwen_fast')`).run();

    await expect(
      routeCompletion(env, { ...baseRequest, taskId: "tsk_r6b", risk: "high" }),
    ).rejects.toBeInstanceOf(RoutingBlocked);

    const decision = await row(`SELECT outcome, candidates FROM routing_decisions WHERE task_id = 'tsk_r6b'`);
    expect(decision!.outcome).toBe("blocked_no_model");
    expect(decision!.candidates).toContain("unbenchmarked");
  });

  it("lets a benchmarked model carry high-risk work", async () => {
    await commissionFireworks();
    restore = stubFetch(() => completionResponse("ok", 10, 10));
    await env.DB
      .prepare(`UPDATE models SET max_risk = 'high', benchmark_status = 'benchmarked' WHERE id = 'mdl_kimi_k2'`)
      .run();

    const result = await routeCompletion(env, { ...baseRequest, taskId: "tsk_r6c", risk: "high" });
    expect(result.modelId).toBe("mdl_kimi_k2");
  });

  it("asks for a routing card rather than sending restricted content to a cloud model", async () => {
    await commissionFireworks();
    restore = stubFetch(() => completionResponse("should not run"));

    await expect(
      routeCompletion(env, { ...baseRequest, taskId: "tsk_r7", sensitivity: "restricted" }),
    ).rejects.toMatchObject({ outcome: "ask_human", approvable: true });

    const decision = await row(`SELECT outcome FROM routing_decisions WHERE task_id = 'tsk_r7'`);
    expect(decision!.outcome).toBe("ask_human");
  });

  it("lets restricted content through once the card has been approved", async () => {
    await commissionFireworks();
    restore = stubFetch(() => completionResponse("allowed", 10, 10));
    const result = await routeCompletion(env, {
      ...baseRequest, taskId: "tsk_r8", sensitivity: "restricted", cloudForRestrictedAllowed: true,
    });
    expect(result.modelId).toBeTruthy();
  });

  it("refuses a model whose estimate exceeds the envelope", async () => {
    await commissionFireworks();
    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("nope"); });

    // The envelope is the permission a human granted THIS task, so breaching it is
    // a spend refusal a human can lift — not a terminal policy failure.
    await expect(
      routeCompletion(env, { ...baseRequest, taskId: "tsk_r9", budgetMicros: 1 }),
    ).rejects.toBeInstanceOf(BudgetExceeded);
    expect(called).toBe(false);
    const decision = await row(`SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_r9'`);
    expect(decision!.candidates).toContain("permission envelope");
  });

  it("charges an errored call nothing", async () => {
    await commissionFireworks();
    restore = stubFetch(() => new Response("boom", { status: 500 }));
    const before = await laneBudgetState(env.DB, "ops");

    await expect(routeCompletion(env, { ...baseRequest, taskId: "tsk_r10" })).rejects.toBeTruthy();

    const after = await laneBudgetState(env.DB, "ops");
    expect(after.remainingMicros).toBe(before.remainingMicros);
  });
});

// ─── Stage 4 · continuity: availability, cost, and the honest label ──────────

describe("Stage 4 — the spend lever governs money, and nothing else", () => {
  it("REFUSES paid work at FREE_ONLY, names the lever, and calls nobody", async () => {
    // The negative test for the default position. No lever is set, which is the
    // shipped state, and the shipped state is $0.
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_fireworks'`).run();
    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("should not run"); });

    await expect(routeCompletion(env, { ...baseRequest, taskId: "tsk_lever1" })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(called).toBe(false);

    const decision = await row(`SELECT outcome, candidates FROM routing_decisions WHERE task_id = 'tsk_lever1'`);
    expect(decision!.outcome).toBe("blocked_budget");
    // The refusal has to read like a sentence and name what would change it.
    expect(decision!.candidates).toContain("spend lever is at $0");
    expect(decision!.candidates).toContain("MODERATE");
    expect(JSON.parse(decision!.candidates)[0].stage).toBe("budget");
  });

  it("runs that same work once the lever is moved, and only then", async () => {
    await commissionFireworks("MODERATE");
    restore = stubFetch(() => completionResponse("Allowed now.", 100, 100));
    const result = await routeCompletion(env, { ...baseRequest, taskId: "tsk_lever2" });
    expect(result.modelId).toBe("mdl_kimi_k2");
    expect(result.freeTier).toBe(false);
  });

  it("resolves an absent or unrecognised position to FREE_ONLY rather than to OPEN", async () => {
    await env.DB.prepare(`DELETE FROM settings WHERE key = 'spend_lever'`).run();
    expect((await spendLeverState(env.DB)).position).toBe("FREE_ONLY");

    for (const bad of ["open", "OPEN ", "unlimited", "", "MODERATE_PLUS"]) {
      await env.DB
        .prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('spend_lever', ?, ?)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .bind(bad, Date.now())
        .run();
      const state = await spendLeverState(env.DB);
      expect(state.position).toBe("FREE_ONLY");
      expect(state.uncapped).toBe(false);
    }
  });

  it("seeds MODERATE's figure from the lane budget she already set, and lets her change it", async () => {
    await env.DB.prepare(`DELETE FROM settings WHERE key = 'spend_lever_moderate_micros'`).run();
    await setSpendLever(env.DB, { position: "MODERATE" }, "test");
    const seeded = await spendLeverState(env.DB);
    const opsMonth = await row(`SELECT limit_micros FROM budgets WHERE lane = 'ops' AND period = 'month'`);
    expect(seeded.moderateMicros).toBe(opsMonth!.limit_micros);
    expect(seeded.moderateSource).toBe("seeded_from_lane_budget");

    await setSpendLever(env.DB, { position: "MODERATE", moderateMicros: 5_000_000 }, "test");
    const edited = await spendLeverState(env.DB);
    expect(edited.moderateMicros).toBe(5_000_000);
    expect(edited.moderateSource).toBe("owner_set");
  });

  it("expresses OPEN in the database as hard_stop 0, keeps the limits visible, and reverses cleanly", async () => {
    await setSpendLever(env.DB, { position: "OPEN" }, "test");
    const open = await all(`SELECT lane, period, limit_micros, hard_stop FROM budgets`);
    expect(open.every((b) => b.hard_stop === 0)).toBe(true);
    // limit_micros is untouched: a number nobody is enforcing is still a number she reads.
    expect(open.every((b) => b.limit_micros > 0)).toBe(true);
    expect((await spendLeverState(env.DB)).uncapped).toBe(true);

    await setSpendLever(env.DB, { position: "FREE_ONLY" }, "test");
    const closed = await all(`SELECT hard_stop FROM budgets`);
    expect(closed.every((b) => b.hard_stop === 1)).toBe(true);
  });

  it("audits every move, from what to what", async () => {
    await setSpendLever(env.DB, { position: "MODERATE", moderateMicros: 3_000_000 }, "boss");
    await setSpendLever(env.DB, { position: "OPEN" }, "boss");
    const moves = await all(
      `SELECT actor, action, detail FROM audit_log WHERE entity_type = 'spend_lever' ORDER BY ts DESC LIMIT 2`,
    );
    expect(moves.length).toBe(2);
    const latest = JSON.parse(moves[0].detail);
    expect(latest.to).toBe("OPEN");
    expect(latest.from).toBe("MODERATE");
    expect(latest.laneHardStopsSetTo).toBe(0);
    expect(moves[0].actor).toBe("boss");
  });

  it("does not retroactively fail completed work when the lever drops", async () => {
    await commissionFireworks("MODERATE");
    restore = stubFetch(() => completionResponse("Done while allowed.", 100, 100));
    const done = await routeCompletion(env, { ...baseRequest, taskId: "tsk_lever3" });
    expect(done.costMicros).toBeGreaterThan(0);

    await setSpendLever(env.DB, { position: "FREE_ONLY" }, "test");

    // The completed run's ledger row and its spend are untouched...
    const usage = await row(`SELECT status, cost_micros FROM usage_ledger WHERE task_id = 'tsk_lever3'`);
    expect(usage!.status).toBe("ok");
    expect(usage!.cost_micros).toBeGreaterThan(0);
    // ...and only the NEXT spend is refused.
    await expect(routeCompletion(env, { ...baseRequest, taskId: "tsk_lever4" })).rejects.toBeInstanceOf(BudgetExceeded);
  });
});

describe("Stage 4 — availability, and a degraded tier that says so", () => {
  it("will not route to a backend that is registered but not commissioned", async () => {
    await setSpendLever(env.DB, { position: "MODERATE" }, "test");
    await env.DB
      .prepare(`UPDATE execution_backends SET status = 'registered', status_reason = 'Awaiting Stage 4.' WHERE id = 'bk_fireworks'`)
      .run();
    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("should not run"); });

    await expect(routeCompletion(env, { ...baseRequest, taskId: "tsk_avail1" })).rejects.toBeTruthy();
    expect(called).toBe(false);
    const decision = await row(`SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_avail1'`);
    expect(decision!.candidates).toContain("not enabled");
  });

  it("degrades to a free Workers AI model when the paid primary is down, and LABELS it", async () => {
    await commissionFireworks("MODERATE");
    await provisionWorkersAi();
    const { bound, calls } = withAi("Continuity answer.");
    // Every Fireworks call fails: this is the outage.
    restore = stubFetch(() => new Response("service unavailable", { status: 500 }));

    const result = await routeCompletion(bound, { ...baseRequest, taskId: "tsk_deg1" });

    expect(calls.length).toBe(1);
    expect(result.degraded).toBe(true);
    expect(result.freeTier).toBe(true);
    expect(result.costMicros).toBe(0);
    expect(result.backendId).toBe("bk_workers_ai");
    // THE LABEL, in the one field every screen already renders.
    expect(result.modelName).toContain("DEGRADED TIER");
    expect(result.modelName).toContain("Workers AI");
    expect(result.notice).toContain("not a promise of equal quality");
    expect(result.degradedReason).toBeTruthy();

    const decision = await row(`SELECT outcome, reason FROM routing_decisions WHERE task_id = 'tsk_deg1'`);
    expect(decision!.outcome).toBe("degraded");
    expect(decision!.reason).toContain("continuity backend");
    const logged = await row(
      `SELECT event FROM system_events WHERE event = 'degraded_route' ORDER BY ts DESC LIMIT 1`,
    );
    expect(logged!.event).toBe("degraded_route");
  });

  /**
   * 12 September 2026. `rtd_m2b0p2mdcrt61m4g` named three candidates for a request to find a buyer
   * for $1B of OpenAI stock — two Fireworks models rejected, and `mdl_cf_llama31_8b` used. The free
   * 70B was not rejected; it was ABSENT. Both Workers AI models cost exactly 0, the continuity tier
   * broke the tie alphabetically, "Llama 3.1 8B" won, it answered, and the loop stopped.
   */
  it("REACHES THE FREE 70B BEFORE THE FREE 8B, and names it in the decision at zero", async () => {
    await commissionFireworks("MODERATE");
    await provisionWorkersAi();
    const { bound, calls } = withAi("A considered answer.");
    restore = stubFetch(() => new Response("service unavailable", { status: 500 }));

    const result = await routeCompletion(bound, { ...baseRequest, taskId: "tsk_free70b" });

    // The model that actually ran, and the slug that actually went to the binding.
    expect(result.modelId).toBe("mdl_cf_llama33_70b");
    expect(calls[0]).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(result.costMicros).toBe(0);
    expect(result.freeTier).toBe(true);
    // And the honesty label survives: it is still the continuity tier, so she is still told.
    expect(result.degraded).toBe(true);
    expect(result.modelName).toContain("DEGRADED TIER");

    const decision = await row(`SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_free70b'`);
    const candidates = JSON.parse(decision!.candidates) as {
      model_id: string; verdict: string; estimate_micros?: number;
    }[];
    const seventy = candidates.find((c) => c.model_id === "mdl_cf_llama33_70b");
    expect(seventy).toBeTruthy();
    expect(seventy!.verdict).toBe("used");
    expect(seventy!.estimate_micros).toBe(0);
    // The 8B was never called: the better free model got there first.
    expect(calls).not.toContain("@cf/meta/llama-3.1-8b-instruct-fp8");
  });

  /**
   * `tsk_m2bk7zfffhjatvsf`: a `failed` task on her desk reading "No model on this route satisfied
   * policy", which could mean privacy, capability, availability, budget or an outage. It meant one
   * thing, true of all four candidates at once — every model in this system is cleared to `low` risk
   * and the task classified `medium`. A red light with no remedy is the thing this repo forbids.
   */
  it("SAYS WHAT THE WALL IS when every candidate hit the same one", async () => {
    await commissionFireworks("MODERATE");
    await provisionWorkersAi();
    const { bound } = withAi("never reached");
    restore = stubFetch(() => completionResponse("never reached"));
    // Every model is cleared to low risk; ask for a high-risk run.
    await env.DB.prepare(`UPDATE models SET max_risk = 'low'`).run();

    const err = await routeCompletion(bound, { ...baseRequest, taskId: "tsk_wall", risk: "high" })
      .then(() => null, (e) => e as RoutingBlocked);

    expect(err).toBeInstanceOf(RoutingBlocked);
    expect(err!.outcome).toBe("blocked_no_model");
    // The sentence names the stage, the reason and HOW MANY, rather than sending her to a JSON column.
    expect(err!.message).toMatch(/refused at capability/);
    expect(err!.message).toMatch(/\d+ of \d+/);
    expect(err!.message).toMatch(/cleared to low risk/);
    // AND THE REMEDY IS A DECISION SHE CAN MAKE, including the one this may never make for her.
    expect(err!.hint).toMatch(/risk promotion/);
    expect(err!.hint).toMatch(/benchmark/);

    // AND THE DECISION ROW SAYS THE SAME THING. A log vaguer than the error it explains is the
    // log the error was telling her to go and read.
    const decision = await row(`SELECT reason FROM routing_decisions WHERE task_id = 'tsk_wall'`);
    expect(decision!.reason).toMatch(/refused at capability/);
  });

  /**
   * THE FIRST VERSION OF THIS FIRED ON NOTHING. It required every rejection to share a stage and a
   * reason, and the real decision had one Fireworks model refused at `availability` alongside three
   * refused at `capability` — so it said nothing at all. The LARGEST group is the wall.
   */
  it("names the wall even when one candidate hit a different one", () => {
    const wall = theWall([
      { model_id: "a", backend_id: null, tier: "route", stage: "availability", verdict: "rejected", reason: "Fireworks is registered, not enabled" },
      { model_id: "b", backend_id: null, tier: "route", stage: "capability", verdict: "rejected", reason: "model is cleared to low risk, task is medium" },
      { model_id: "c", backend_id: null, tier: "continuity", stage: "capability", verdict: "rejected", reason: "model is cleared to low risk, task is medium" },
      { model_id: "d", backend_id: null, tier: "continuity", stage: "capability", verdict: "rejected", reason: "model is cleared to low risk, task is medium" },
    ] as never);
    expect(wall!.sentence).toContain("3 of 4 refused at capability");
    expect(wall!.remedy).toMatch(/risk promotion/);
    // Nothing rejected is not a wall — it must not invent one.
    expect(theWall([])).toBeNull();
  });

  it("carries the degraded label onto the task the screen actually reads", async () => {
    await commissionFireworks("MODERATE");
    await provisionWorkersAi();
    const { bound } = withAi("Continuity draft.");
    restore = stubFetch(() => new Response("down", { status: 500 }));
    const taskId = await insertTask({ status: "queued", employee_id: "emp_chief" });

    await handleTask(bound, { taskId, lane: "ops" });

    const task = await row(`SELECT status, output FROM tasks WHERE id = ?`, taskId);
    expect(task!.status).toBe("awaiting_approval");
    // The consumer stores { text, model } and the approval card is built from it.
    expect(JSON.parse(task!.output).model).toContain("DEGRADED TIER");
    const evidence = await row(`SELECT risks_remaining FROM evidence_packets WHERE task_id = ?`, taskId);
    expect(evidence!.risks_remaining).toContain("fallback");
  });

  it("reports an absent binding as absent rather than pretending Workers AI is available", async () => {
    await provisionWorkersAi();
    await setSpendLever(env.DB, { position: "MODERATE" }, "test");
    await env.DB.prepare(`UPDATE execution_backends SET status = 'registered' WHERE id = 'bk_fireworks'`).run();
    restore = stubFetch(() => completionResponse("should not run"));

    // `env` in this suite has no AI binding, which is the honest state of the
    // deployed Worker until wrangler.toml declares one.
    await expect(routeCompletion(env, { ...baseRequest, taskId: "tsk_nobinding" })).rejects.toBeTruthy();
    const decision = await row(`SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_nobinding'`);
    expect(decision!.candidates).toContain("No AI binding is attached");
  });
});

describe("Stage 4 — a cheaper route never bypasses a rule above it", () => {
  it("refuses a FREE backend for restricted content instead of escaping to it", async () => {
    // The cheapest possible route is sitting right there, enabled and working.
    await provisionWorkersAi();
    await commissionFireworks("OPEN");
    const { bound, calls } = withAi("must not run");
    let fetched = false;
    restore = stubFetch(() => { fetched = true; return completionResponse("must not run"); });

    await expect(
      routeCompletion(bound, { ...baseRequest, taskId: "tsk_priv1", sensitivity: "restricted" }),
    ).rejects.toMatchObject({ outcome: "ask_human", approvable: true });

    // Nothing was called. Restricted material has no automatic escape to cloud.
    expect(calls.length).toBe(0);
    expect(fetched).toBe(false);
    const decision = await row(`SELECT outcome, candidates FROM routing_decisions WHERE task_id = 'tsk_priv1'`);
    expect(decision!.outcome).toBe("ask_human");
    const notes = JSON.parse(decision!.candidates);
    expect(notes.every((n: any) => n.verdict === "rejected")).toBe(true);
    expect(notes.some((n: any) => n.stage === "privacy")).toBe(true);
  });

  it("refuses a free unbenchmarked model for high-risk work rather than saving money on it", async () => {
    await provisionWorkersAi();
    await commissionFireworks("OPEN");
    await env.DB.prepare(`UPDATE models SET max_risk = 'high' WHERE 1 = 1`).run();
    const { bound, calls } = withAi("must not run");
    restore = stubFetch(() => completionResponse("must not run"));

    await expect(
      routeCompletion(bound, { ...baseRequest, taskId: "tsk_qual1", risk: "high" }),
    ).rejects.toBeInstanceOf(RoutingBlocked);
    expect(calls.length).toBe(0);
    const decision = await row(`SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_qual1'`);
    expect(decision!.candidates).toContain("unbenchmarked");
  });

  it("puts cost last: the free model is only reached after the route's own models are", async () => {
    await provisionWorkersAi();
    await commissionFireworks("MODERATE");
    const { bound, calls } = withAi("free");
    restore = stubFetch(() => completionResponse("paid primary", 10, 10));

    const result = await routeCompletion(bound, { ...baseRequest, taskId: "tsk_order1" });

    // A free candidate existed and was NOT chosen: the route's approved default
    // is not silently replaced by whatever is cheapest. Promotion does that, and
    // promotion needs evidence and an approved card.
    expect(result.modelId).toBe("mdl_kimi_k2");
    expect(calls.length).toBe(0);
  });
});

describe("Stage 4 — bounded retries and the circuit breaker", () => {
  it("retries a 503 once and does not retry a 500", async () => {
    await commissionFireworks("MODERATE");
    let calls = 0;
    restore = stubFetch(() => {
      calls++;
      return calls === 1 ? new Response("later", { status: 503 }) : completionResponse("recovered", 10, 10);
    });
    const result = await routeCompletion(env, { ...baseRequest, taskId: "tsk_retry1" });
    expect(result.modelId).toBe("mdl_kimi_k2");
    expect(calls).toBe(2);

    let hardCalls = 0;
    restore?.();
    restore = stubFetch(() => {
      hardCalls++;
      return hardCalls === 1 ? new Response("bad", { status: 500 }) : completionResponse("second model", 10, 10);
    });
    const second = await routeCompletion(env, { ...baseRequest, taskId: "tsk_retry2" });
    // A 500 is not retried: the run moves to the next model instead.
    expect(second.modelId).toBe("mdl_qwen_fast");
    expect(hardCalls).toBe(2);
  });

  it("opens after repeated failures and then skips the backend WITHOUT calling it", async () => {
    await commissionFireworks("MODERATE");
    let calls = 0;
    restore = stubFetch(() => { calls++; return new Response("down", { status: 500 }); });

    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      await expect(routeCompletion(env, { ...baseRequest, taskId: `tsk_cb${i}` })).rejects.toBeTruthy();
    }
    const state = await breakerState(env.DB, "bk_fireworks");
    expect(state.open).toBe(true);

    const callsBefore = calls;
    await expect(routeCompletion(env, { ...baseRequest, taskId: "tsk_cb_open" })).rejects.toBeTruthy();
    // NOT ONE further provider call was made while the breaker was open.
    expect(calls).toBe(callsBefore);
    const decision = await row(`SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_cb_open'`);
    expect(decision!.candidates).toContain("circuit breaker is open");
  });

  it("closes the breaker on a success, so an outage that ends is over", async () => {
    await commissionFireworks("MODERATE");
    restore = stubFetch(() => new Response("down", { status: 500 }));
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      await expect(routeCompletion(env, { ...baseRequest, taskId: `tsk_cb2${i}` })).rejects.toBeTruthy();
    }
    expect((await breakerState(env.DB, "bk_fireworks")).open).toBe(true);

    const { status } = await apiJson("/api/models/breaker/bk_fireworks/reset", { method: "POST", body: {} });
    expect(status).toBe(200);
    expect((await breakerState(env.DB, "bk_fireworks")).open).toBe(false);
  });
});

describe("Phase 5 — budget windows roll", () => {
  it("clears a stale window instead of blocking forever", async () => {
    // Before the start of this month, so both the day and month rows are stale.
    await env.DB
      .prepare(`UPDATE budgets SET spent_micros = limit_micros, window_started_at = ? WHERE lane = 'ops'`)
      .bind(windowStart("month", Date.now()) - 86_400_000)
      .run();

    expect((await laneBudgetState(env.DB, "ops")).blocked).toBe(true);
    await rollBudgetWindows(env.DB);
    expect((await laneBudgetState(env.DB, "ops")).blocked).toBe(false);
  });

  it("leaves a still-current window alone", async () => {
    await env.DB
      .prepare(
        `UPDATE budgets SET spent_micros = limit_micros, window_started_at = ?
          WHERE lane = 'ops' AND period = 'day'`,
      )
      .bind(windowStart("day", Date.now()))
      .run();
    await rollBudgetWindows(env.DB);
    expect((await laneBudgetState(env.DB, "ops")).blocked).toBe(true);
  });

  it("resets per-employee daily allowances too", async () => {
    await env.DB
      .prepare(`UPDATE employees SET spent_micros_day = 999999, spend_window_started_at = ? WHERE id = 'emp_chief'`)
      .bind(windowStart("day", Date.now()) - 86_400_000)
      .run();
    await rollBudgetWindows(env.DB);
    const emp = await row(`SELECT spent_micros_day FROM employees WHERE id = 'emp_chief'`);
    expect(emp!.spent_micros_day).toBe(0);
  });
});

describe("Phase 2 — queue execution and evidence", () => {
  it("writes an evidence packet and raises an approval on a normal run", async () => {
    await commissionFireworks("MODERATE");
    restore = stubFetch(() => completionResponse("Here is the draft.", 200, 100));
    const taskId = await insertTask({ status: "queued", employee_id: "emp_chief" });

    await handleTask(env, { taskId, lane: "ops" });

    const task = await row(`SELECT status, approval_id, cost_micros FROM tasks WHERE id = ?`, taskId);
    expect(task!.status).toBe("awaiting_approval");
    expect(task!.cost_micros).toBeGreaterThan(0);

    const evidence = await row(`SELECT * FROM evidence_packets WHERE task_id = ?`, taskId);
    expect(evidence!.final_status).toBe("awaiting_approval");
    expect(evidence!.worker_used).toBe("model_router");
    expect(evidence!.approval_needed).toBe(1);
    expect(JSON.parse(evidence!.checks_run)).toContain("budget");
  });

  it("holds the task for a spend approval instead of failing when the budget is gone", async () => {
    await commissionFireworks("MODERATE");
    restore = stubFetch(() => completionResponse("should not run"));
    await env.DB.prepare(`UPDATE budgets SET spent_micros = limit_micros WHERE lane = 'ops' AND period = 'day'`).run();
    const taskId = await insertTask({ status: "queued", employee_id: "emp_chief" });

    await handleTask(env, { taskId, lane: "ops" });

    const task = await row(`SELECT status, approval_id FROM tasks WHERE id = ?`, taskId);
    expect(task!.status).toBe("awaiting_approval");
    const approval = await row(`SELECT kind FROM approvals WHERE id = ?`, task!.approval_id);
    expect(approval!.kind).toBe("spend");
    const evidence = await row(`SELECT final_status FROM evidence_packets WHERE task_id = ?`, taskId);
    expect(evidence!.final_status).toBe("held");
  });

  it("writes an evidence packet even when the run fails", async () => {
    await commissionFireworks("MODERATE");
    restore = stubFetch(() => new Response("down", { status: 503 }));
    const taskId = await insertTask({ status: "queued", employee_id: "emp_chief" });

    await expect(handleTask(env, { taskId, lane: "ops" })).rejects.toBeTruthy();

    const task = await row(`SELECT status FROM tasks WHERE id = ?`, taskId);
    expect(task!.status).toBe("failed");
    const evidence = await row(`SELECT final_status FROM evidence_packets WHERE task_id = ?`, taskId);
    expect(evidence!.final_status).toBe("failed");
  });

  it("refuses to run work for a suspended employee", async () => {
    restore = stubFetch(() => completionResponse("should not run"));
    await env.DB.prepare(`UPDATE employees SET lifecycle = 'suspended' WHERE id = 'emp_chief'`).run();
    const taskId = await insertTask({ status: "queued", employee_id: "emp_chief" });

    await handleTask(env, { taskId, lane: "ops" });

    const task = await row(`SELECT status, error FROM tasks WHERE id = ?`, taskId);
    expect(task!.status).toBe("failed");
    expect(task!.error).toContain("suspended");
  });

  it("records a dead letter rather than losing an exhausted message", async () => {
    const { handleDeadLetter } = await import("../../src/worker/boss/queue/consumer");
    const taskId = await insertTask({ status: "failed" });

    await handleDeadLetter(env, { taskId, lane: "ops" }, "Retries exhausted");

    const dl = await row(`SELECT task_id, status, error FROM dead_letters WHERE task_id = ?`, taskId);
    expect(dl!.status).toBe("open");
    expect(dl!.error).toContain("exhausted");
  });
});
