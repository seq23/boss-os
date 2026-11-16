import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { executeDecision, type ApprovalRow } from "../../src/worker/boss/approvals/execute";
import { runExpirySweep } from "../../src/worker/boss/routes/approvals";
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

  it("an answer she gives always releases or ends the task it belongs to, a held ('manual') one included (13 Nov 2026)", async () => {
    const held = async (over: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) => {
      const taskId = await insertTask({ status: "awaiting_approval", ...over });
      const aprId = await insertApproval({ kind: "manual", origin_type: "tasks", origin_id: taskId, payload: { task_id: taskId, assignment: "USER_ONLY", ...payload } });
      await env.DB.prepare(`UPDATE tasks SET approval_id = ? WHERE id = ?`).bind(aprId, taskId).run();
      return { taskId, aprId };
    };
    const decide = (id: string, decision: string) => apiJson(`/api/approvals/${id}/decide`, { method: "POST", body: { decision } });
    const statusOf = async (id: string) => (await row(`SELECT status, approval_id FROM tasks WHERE id = ?`, id))!;

    // Yes: the task runs. Before, the approval changed and the task stayed held for good.
    const yes = await held();
    expect((await decide(yes.aprId, "approved")).status).toBe(200);
    expect(await statusOf(yes.taskId)).toMatchObject({ status: "queued", approval_id: null });
    // No: it ends.
    const no = await held();
    await decide(no.aprId, "rejected");
    expect((await statusOf(no.taskId)).status).toBe("cancelled");
    // The trading lane and a human contractor's work never go to a model, whatever is approved.
    const trade = await held({ lane: "trading" });
    await decide(trade.aprId, "approved");
    expect((await statusOf(trade.taskId)).status).toBe("done");
    const hand = await held({}, { assignment: "HUMAN_CONTRACTOR" });
    await decide(hand.aprId, "approved");
    expect((await statusOf(hand.taskId)).status).toBe("done");
    // One answered before this rule (approved, nothing executed, still held) is released by the sweep, once.
    const old = await held();
    await env.DB.prepare(`UPDATE approvals SET status = 'approved', decided_at = 1, execution_status = 'not_applicable' WHERE id = ?`).bind(old.aprId).run();
    const untouched = await held(); // still pending: the sweep leaves it alone
    await runExpirySweep(env);
    expect(await statusOf(old.taskId)).toMatchObject({ status: "queued", approval_id: null });
    expect((await statusOf(untouched.taskId)).status).toBe("awaiting_approval");
  });

  it("a duty's run held on intake's own guess is released by the sweep and runs; her own, the trading lane and a declared trading kind stay held (15 Nov 2026)", async () => {
    const held = async (over: Record<string, unknown> = {}, intake: Record<string, unknown> = { intakeKind: "trading", matched: ["trading"] }) => {
      const taskId = await insertTask({ status: "awaiting_approval", intake_kind: "trading", execution_assignment: "USER_ONLY", risk: "high", sensitivity: "restricted", ...over });
      const aprId = await insertApproval({ kind: "manual", origin_type: "tasks", origin_id: taskId, payload: { task_id: taskId, assignment: "USER_ONLY" }, expires_at: Date.now() + 86_400_000 });
      await env.DB.batch([
        env.DB.prepare(`UPDATE tasks SET approval_id = ? WHERE id = ?`).bind(aprId, taskId),
        env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'intake',?)`).bind(`tev_${taskId}`, taskId, Date.now(), JSON.stringify(intake)),
      ]);
      return { taskId, aprId };
    };
    const quoted = "Monthly quality read: Brokerage sourcing, sell 2,000 shares";
    const duty = await held({ title: "Monthly quality read", input: JSON.stringify({ prompt: quoted, duty_id: "duty_quality_read", delivers: "quality_reads" }) });
    const repair = await held({ input: JSON.stringify({ prompt: quoted, origin: "repair", repair_kind: "fix" }) });
    const hers = await held({ input: JSON.stringify({ prompt: quoted, mail_id: "m1" }) });
    const lane = await held({ lane: "trading", input: JSON.stringify({ prompt: quoted, duty_id: "duty_x" }) });
    const declared = await held({ input: JSON.stringify({ prompt: quoted, duty_id: "duty_y" }) }, { intakeKind: "trading", matched: ["explicit_kind"] });

    await runExpirySweep(env);

    const task = (id: string) => row(`SELECT status, approval_id, intake_kind, execution_assignment, risk, sensitivity FROM tasks WHERE id = ?`, id);
    const apr = (id: string) => row(`SELECT status, decided_by, execution_status FROM approvals WHERE id = ?`, id);
    expect(await task(duty.taskId)).toMatchObject({ status: "queued", approval_id: null, intake_kind: "recurring_duty", sensitivity: "restricted" });
    expect((await task(duty.taskId))!.execution_assignment).not.toBe("USER_ONLY");
    expect(await apr(duty.aprId)).toMatchObject({ status: "approved", decided_by: "system", execution_status: "executed" });
    expect((await all(`SELECT event FROM task_events WHERE task_id = ?`, duty.taskId)).map((e) => e.event)).toEqual(expect.arrayContaining(["intake_overruled", "requeued"]));
    expect((await task(repair.taskId))!.status).toBe("queued");
    for (const still of [hers, lane, declared]) {
      expect((await task(still.taskId))!.status).toBe("awaiting_approval");
      expect((await apr(still.aprId))!.status).toBe("pending");
    }
    // Once: the next sweep finds nothing more to release.
    const again = await runExpirySweep(env);
    expect((await task(duty.taskId))!.status).toBe("queued");
    expect(again.failed).toBe(0);
  });

  it("a finished result of a dated check-in, a repair or a duty's run is accepted by the sweep; her own ask keeps its card (16 Nov 2026)", async () => {
    const held = async (input: Record<string, unknown>, over: Record<string, unknown> = {}) => {
      const taskId = await insertTask({ status: "awaiting_approval", input: JSON.stringify(input), ...over });
      const aprId = await insertApproval({ kind: "task_output", origin_type: "tasks", origin_id: taskId, payload: { task_id: taskId }, expires_at: Date.now() + 86_400_000 });
      await env.DB.prepare(`UPDATE tasks SET approval_id = ? WHERE id = ?`).bind(aprId, taskId).run();
      return { taskId, aprId };
    };
    const checkIn = await held({ origin: "repair", repair_kind: "waiting_on", waiting_on: "wo_local_guides", prompt: "Read Search Console per host." });
    const duty = await held({ duty_id: "duty_x", prompt: "weekly read" });
    const hers = await held({ mail_id: "m1", prompt: "draft the LP note" });
    const herCheckIn = await held({ origin: "repair", repair_kind: "waiting_on", from: "her@example.com" });
    const trading = await held({ duty_id: "duty_t" }, { lane: "trading" });

    await runExpirySweep(env);

    const apr = (id: string) => row(`SELECT status, decided_by FROM approvals WHERE id = ?`, id);
    const task = (id: string) => row(`SELECT status FROM tasks WHERE id = ?`, id);
    for (const gone of [checkIn, duty]) {
      expect(await apr(gone.aprId)).toMatchObject({ status: "approved", decided_by: "system" });
      expect((await task(gone.taskId))!.status).toBe("done");
    }
    for (const still of [hers, herCheckIn, trading]) expect((await apr(still.aprId))!.status).toBe("pending");
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
