import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { routeCompletion, BudgetExceeded, RoutingBlocked } from "../src/server/router";
import { rollBudgetWindows, windowStart, laneBudgetState } from "../src/server/router/budget";
import { handleTask } from "../src/server/queue/consumer";
import { insertTask, row, all, stubFetch, completionResponse } from "./helpers";

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const baseRequest = {
  routeId: "rt_ops_default",
  lane: "ops",
  messages: [{ role: "user" as const, content: "Say something short." }],
};

describe("Phase 2 — model router", () => {
  it("routes to the primary model and records the decision and the cost", async () => {
    restore = stubFetch(() => completionResponse("Done.", 1000, 500));

    const result = await routeCompletion(env, { ...baseRequest, taskId: "tsk_r1" });

    expect(result.modelId).toBe("mdl_kimi_k2");
    // 1000 in @600/1k + 500 out @2500/1k = 600 + 1250
    expect(result.costMicros).toBe(1850);
    const decision = await row(`SELECT outcome, chosen_model_id FROM routing_decisions WHERE task_id = 'tsk_r1'`);
    expect(decision!.outcome).toBe("routed");
    const usage = await row(`SELECT cost_micros, status FROM usage_ledger WHERE task_id = 'tsk_r1'`);
    expect(usage!.cost_micros).toBe(1850);
  });

  it("falls back once when the primary fails, and says so", async () => {
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
    expect(JSON.parse(decision!.candidates)).toHaveLength(2);
  });

  it("hard stops on the lane budget and never calls a provider", async () => {
    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("nope"); });
    await env.DB.prepare(`UPDATE budgets SET spent_micros = limit_micros WHERE lane = 'ops' AND period = 'day'`).run();

    await expect(routeCompletion(env, { ...baseRequest, taskId: "tsk_r3" })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(called).toBe(false);
    const decision = await row(`SELECT outcome FROM routing_decisions WHERE task_id = 'tsk_r3'`);
    expect(decision!.outcome).toBe("blocked_budget");
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
    restore = stubFetch(() => completionResponse("cheap", 10, 10));
    const result = await routeCompletion(env, { ...baseRequest, taskId: "tsk_r5", costMode: "EMERGENCY_LOW_COST" });

    // kimi is tier 'general' and must be skipped; qwen is 'fast'.
    expect(result.modelId).toBe("mdl_qwen_fast");
    const decision = await row(`SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_r5'`);
    const candidates = JSON.parse(decision!.candidates);
    expect(candidates[0].reason).toContain("does not allow general");
  });

  it("refuses a model whose risk ceiling is below the task", async () => {
    restore = stubFetch(() => completionResponse("should not run"));

    await expect(
      routeCompletion(env, { ...baseRequest, taskId: "tsk_r6a", risk: "high" }),
    ).rejects.toBeInstanceOf(RoutingBlocked);

    const decision = await row(`SELECT outcome, candidates FROM routing_decisions WHERE task_id = 'tsk_r6a'`);
    expect(decision!.outcome).toBe("blocked_no_model");
    expect(decision!.candidates).toContain("cleared to");
  });

  it("blocks high-risk work from an unbenchmarked model even when the risk ceiling allows it", async () => {
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
    restore = stubFetch(() => completionResponse("ok", 10, 10));
    await env.DB
      .prepare(`UPDATE models SET max_risk = 'high', benchmark_status = 'benchmarked' WHERE id = 'mdl_kimi_k2'`)
      .run();

    const result = await routeCompletion(env, { ...baseRequest, taskId: "tsk_r6c", risk: "high" });
    expect(result.modelId).toBe("mdl_kimi_k2");
  });

  it("asks for a routing card rather than sending restricted content to a cloud model", async () => {
    restore = stubFetch(() => completionResponse("should not run"));

    await expect(
      routeCompletion(env, { ...baseRequest, taskId: "tsk_r7", sensitivity: "restricted" }),
    ).rejects.toMatchObject({ outcome: "ask_human", approvable: true });

    const decision = await row(`SELECT outcome FROM routing_decisions WHERE task_id = 'tsk_r7'`);
    expect(decision!.outcome).toBe("ask_human");
  });

  it("lets restricted content through once the card has been approved", async () => {
    restore = stubFetch(() => completionResponse("allowed", 10, 10));
    const result = await routeCompletion(env, {
      ...baseRequest, taskId: "tsk_r8", sensitivity: "restricted", cloudForRestrictedAllowed: true,
    });
    expect(result.modelId).toBeTruthy();
  });

  it("refuses a model whose estimate exceeds the envelope", async () => {
    let called = false;
    restore = stubFetch(() => { called = true; return completionResponse("nope"); });

    await expect(
      routeCompletion(env, { ...baseRequest, taskId: "tsk_r9", budgetMicros: 1 }),
    ).rejects.toBeInstanceOf(RoutingBlocked);
    expect(called).toBe(false);
  });

  it("charges an errored call nothing", async () => {
    restore = stubFetch(() => new Response("boom", { status: 500 }));
    const before = await laneBudgetState(env.DB, "ops");

    await expect(routeCompletion(env, { ...baseRequest, taskId: "tsk_r10" })).rejects.toBeTruthy();

    const after = await laneBudgetState(env.DB, "ops");
    expect(after.remainingMicros).toBe(before.remainingMicros);
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
    const { handleDeadLetter } = await import("../src/server/queue/consumer");
    const taskId = await insertTask({ status: "failed" });

    await handleDeadLetter(env, { taskId, lane: "ops" }, "Retries exhausted");

    const dl = await row(`SELECT task_id, status, error FROM dead_letters WHERE task_id = ?`, taskId);
    expect(dl!.status).toBe("open");
    expect(dl!.error).toContain("exhausted");
  });
});
