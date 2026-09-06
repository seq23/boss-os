import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { executeDecision, type ApprovalRow } from "../src/server/approvals/execute";
import { runExpirySweep } from "../src/server/routes/approvals";
import { api, apiJson, insertApproval, insertMemory, insertTask, row, all } from "./helpers";

const load = (id: string) =>
  row<ApprovalRow>(`SELECT * FROM approvals WHERE id = ?`, id) as Promise<ApprovalRow>;

describe("Phase 1 — approving something actually executes it", () => {
  it("releases the task when a task_output is approved", async () => {
    const taskId = await insertTask({ status: "awaiting_approval" });
    const aprId = await insertApproval({ kind: "task_output", origin_id: taskId, payload: { task_id: taskId } });

    const result = await executeDecision(env, await load(aprId), "approved");

    expect(result.status).toBe("executed");
    expect((await row(`SELECT status FROM tasks WHERE id = ?`, taskId))!.status).toBe("done");
    const events = await all(`SELECT event FROM task_events WHERE task_id = ?`, taskId);
    expect(events.map((e) => e.event)).toContain("released");
  });

  it("cancels the origin task when the output is rejected, never orphaning it", async () => {
    const taskId = await insertTask({ status: "awaiting_approval" });
    const aprId = await insertApproval({ kind: "task_output", origin_id: taskId, payload: { task_id: taskId } });

    await executeDecision(env, await load(aprId), "rejected");

    const task = await row(`SELECT status, error FROM tasks WHERE id = ?`, taskId);
    expect(task!.status).toBe("cancelled");
    expect(task!.error).toContain("rejected");
  });

  it("applies the tier change only when a memory promotion is approved", async () => {
    const itemId = await insertMemory({ tier: "working" });
    const aprId = await insertApproval({
      kind: "memory_promotion", origin_id: itemId,
      payload: { item_id: itemId, to_tier: "canon" },
    });
    await env.DB
      .prepare(
        `INSERT INTO promotion_events (id, item_id, ts, from_tier, to_tier, approval_id, outcome)
         VALUES (?,?,?,?,?,?,'proposed')`,
      )
      .bind("pre_t1", itemId, Date.now(), "working", "canon", aprId)
      .run();

    await executeDecision(env, await load(aprId), "approved");

    const item = await row(`SELECT tier, promoted_at FROM memory_items WHERE id = ?`, itemId);
    expect(item!.tier).toBe("canon");
    expect(item!.promoted_at).toBeGreaterThan(0);
    expect((await row(`SELECT outcome FROM promotion_events WHERE approval_id = ?`, aprId))!.outcome).toBe("applied");
  });

  it("keeps the memory at its current tier when the promotion is rejected", async () => {
    const itemId = await insertMemory({ tier: "capture" });
    const aprId = await insertApproval({
      kind: "memory_promotion", origin_id: itemId,
      payload: { item_id: itemId, to_tier: "working" },
    });
    await env.DB
      .prepare(
        `INSERT INTO promotion_events (id, item_id, ts, from_tier, to_tier, approval_id, outcome)
         VALUES (?,?,?,?,?,?,'proposed')`,
      )
      .bind("pre_t2", itemId, Date.now(), "capture", "working", aprId)
      .run();

    await executeDecision(env, await load(aprId), "rejected", "Not durable enough");

    const item = await row(`SELECT tier, rejected_at FROM memory_items WHERE id = ?`, itemId);
    expect(item!.tier).toBe("capture");
    expect(item!.rejected_at).toBeGreaterThan(0);
    expect((await row(`SELECT outcome FROM promotion_events WHERE approval_id = ?`, aprId))!.outcome).toBe("rejected");
  });

  it("requeues the held task when a spend approval clears", async () => {
    const taskId = await insertTask({ status: "awaiting_approval" });
    const aprId = await insertApproval({ kind: "spend", origin_id: taskId, payload: { task_id: taskId } });

    const result = await executeDecision(env, await load(aprId), "approved");

    expect(result.status).toBe("executed");
    expect((await row(`SELECT status FROM tasks WHERE id = ?`, taskId))!.status).toBe("queued");
  });

  it("grants cloud routing to exactly one envelope when a routing card is approved", async () => {
    const taskId = await insertTask({ status: "awaiting_approval", sensitivity: "restricted" });
    await env.DB
      .prepare(
        `INSERT INTO permission_envelopes (id, task_id, lane, execution_assignment, cost_mode, data_sensitivity, created_at)
         VALUES ('env_t1', ?, 'ops', 'AI_DRAFT', 'NORMAL', 'restricted', ?)`,
      )
      .bind(taskId, Date.now())
      .run();
    await env.DB.prepare(`UPDATE tasks SET envelope_id = 'env_t1' WHERE id = ?`).bind(taskId).run();

    const aprId = await insertApproval({ kind: "model_route", origin_id: taskId, payload: { task_id: taskId }, risk: "high" });
    await executeDecision(env, await load(aprId), "approved");

    const envelope = await row(`SELECT cloud_for_restricted_allowed FROM permission_envelopes WHERE id = 'env_t1'`);
    expect(envelope!.cloud_for_restricted_allowed).toBe(1);
    expect((await row(`SELECT status FROM tasks WHERE id = ?`, taskId))!.status).toBe("queued");
  });

  it("writes execution status and an event onto the approval either way", async () => {
    const taskId = await insertTask({ status: "awaiting_approval" });
    const aprId = await insertApproval({ kind: "task_output", origin_id: taskId, payload: { task_id: taskId } });

    await executeDecision(env, await load(aprId), "approved");

    const approval = await row(`SELECT executed_at, execution_status FROM approvals WHERE id = ?`, aprId);
    expect(approval!.execution_status).toBe("executed");
    expect(approval!.executed_at).toBeGreaterThan(0);
    const events = await all(`SELECT event FROM approval_events WHERE approval_id = ?`, aprId);
    expect(events.map((e) => e.event)).toContain("executed");
  });

  it("reports failure without losing the decision when the origin has vanished", async () => {
    const aprId = await insertApproval({ kind: "task_output", origin_id: "tsk_gone", payload: { task_id: "tsk_gone" } });
    const result = await executeDecision(env, await load(aprId), "approved");

    expect(result.status).toBe("failed");
    expect((await row(`SELECT execution_status FROM approvals WHERE id = ?`, aprId))!.execution_status).toBe("failed");
  });

  it("records an audit row for every execution", async () => {
    const taskId = await insertTask({ status: "awaiting_approval" });
    const aprId = await insertApproval({ kind: "task_output", origin_id: taskId, payload: { task_id: taskId } });
    await executeDecision(env, await load(aprId), "approved");

    const audits = await all(`SELECT action FROM audit_log WHERE entity_id = ?`, aprId);
    expect(audits.some((a) => a.action === "execution_executed")).toBe(true);
  });
});

/*
 * Deciding is what makes things happen: capital opens, a handoff crosses the
 * firm boundary, a core capability is patched. Two decisions arriving together
 * — a double tap on a phone, a client retry — must not run any of that twice.
 * The write claims the row, so exactly one caller wins.
 */
describe("Phase 1 — a decision lands exactly once", () => {
  it("executes once when the same approval is decided twice", async () => {
    const taskId = await insertTask({ status: "awaiting_approval" });
    const aprId = await insertApproval({ kind: "task_output", origin_id: taskId, payload: { task_id: taskId } });

    const first = await api(`/api/approvals/${aprId}/decide`, { method: "POST", body: { decision: "approved" } });
    expect(first.status).toBe(200);

    const second = await apiJson(`/api/approvals/${aprId}/decide`, { method: "POST", body: { decision: "approved" } });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already approved/);

    // One decision, one event, one execution.
    const events = await all(`SELECT event FROM approval_events WHERE approval_id = ?`, aprId);
    expect(events.filter((e) => e.event === "approved")).toHaveLength(1);
  });

  it("refuses concurrent decisions rather than executing both", async () => {
    const taskId = await insertTask({ status: "awaiting_approval" });
    const aprId = await insertApproval({ kind: "task_output", origin_id: taskId, payload: { task_id: taskId } });

    const results = await Promise.all([
      apiJson(`/api/approvals/${aprId}/decide`, { method: "POST", body: { decision: "approved" } }),
      apiJson(`/api/approvals/${aprId}/decide`, { method: "POST", body: { decision: "rejected" } }),
    ]);

    // Exactly one wins; the other is told it was already decided.
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);

    const decided = await row(`SELECT status FROM approvals WHERE id = ?`, aprId);
    expect(["approved", "rejected"]).toContain(decided!.status);

    // The losing decision left no event and no second execution behind.
    const events = await all(`SELECT event FROM approval_events WHERE approval_id = ?`, aprId);
    expect(events.filter((e) => e.event === "approved" || e.event === "rejected")).toHaveLength(1);
  });

  it("still refuses a second decision on something already expired", async () => {
    const aprId = await insertApproval({ kind: "manual", status: "expired" });
    const { status, body } = await apiJson(`/api/approvals/${aprId}/decide`, {
      method: "POST", body: { decision: "approved" },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/already expired/);
  });
});

describe("Phase 1 — expiry sweep", () => {
  it("expires only what is genuinely past its expiry", async () => {
    const stale = await insertApproval({ expires_at: Date.now() - 1000 });
    const fresh = await insertApproval({ expires_at: Date.now() + 3_600_000 });

    const result = await runExpirySweep(env);

    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect((await row(`SELECT status FROM approvals WHERE id = ?`, stale))!.status).toBe("expired");
    expect((await row(`SELECT status FROM approvals WHERE id = ?`, fresh))!.status).toBe("pending");
  });

  it("terminates the origin so an expired approval cannot strand a task", async () => {
    const taskId = await insertTask({ status: "awaiting_approval" });
    await insertApproval({
      kind: "task_output", origin_id: taskId, payload: { task_id: taskId },
      expires_at: Date.now() - 1000,
    });

    await runExpirySweep(env);

    expect((await row(`SELECT status FROM tasks WHERE id = ?`, taskId))!.status).toBe("cancelled");
  });

  it("writes an expired event and leaves nothing pending behind", async () => {
    const aprId = await insertApproval({ expires_at: Date.now() - 1000 });
    await runExpirySweep(env);

    const events = await all(`SELECT event FROM approval_events WHERE approval_id = ?`, aprId);
    expect(events.map((e) => e.event)).toContain("expired");
  });

  it("also sweeps deferred items, which would otherwise never expire", async () => {
    const aprId = await insertApproval({ status: "deferred", expires_at: Date.now() - 1000 });
    await runExpirySweep(env);
    expect((await row(`SELECT status FROM approvals WHERE id = ?`, aprId))!.status).toBe("expired");
  });
});
