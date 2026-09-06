import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { executeOrder, cancelOrder, type OrderRow } from "../trading/execute";
import { applyPatchChanges } from "../routes/capability";
import { checkCategory } from "../bridge/categories";

/**
 * Approval execution.
 *
 * A decision and the thing the decision authorises are two different facts.
 * Phase 0 recorded only the decision, which is what made the inbox a shell: you
 * could approve a trade and nothing would ever be sent. Everything here closes
 * that gap, and does it symmetrically — a rejection terminates the origin rather
 * than orphaning it in `awaiting_approval` forever.
 */

export type Disposition = "approved" | "rejected" | "expired";

export interface ApprovalRow {
  id: string;
  lane: string;
  title: string;
  kind: string;
  origin_type: string | null;
  origin_id: string | null;
  payload: string | null;
  status: string;
}

export interface ExecutionResult {
  status: "executed" | "failed" | "not_applicable";
  detail: Record<string, unknown>;
}

function payloadOf(approval: ApprovalRow): Record<string, any> {
  if (!approval.payload) return {};
  try {
    return JSON.parse(approval.payload) as Record<string, any>;
  } catch {
    return {};
  }
}

export async function executeDecision(
  env: Env,
  approval: ApprovalRow,
  disposition: Disposition,
  note?: string | null,
): Promise<ExecutionResult> {
  const started = Date.now();
  let result: ExecutionResult;

  try {
    switch (approval.kind) {
      case "task_output":
        result = await handleTaskOutput(env, approval, disposition);
        break;
      case "memory_promotion":
        result = await handleMemoryPromotion(env, approval, disposition, note);
        break;
      case "trade":
        result = await handleTrade(env, approval, disposition);
        break;
      case "spend":
        result = await handleSpend(env, approval, disposition);
        break;
      case "model_route":
        result = await handleModelRoute(env, approval, disposition);
        break;
      case "agent_creation":
        result = await handleAgentCreation(env, approval, disposition, note);
        break;
      case "prompt_library_promotion":
        result = await handlePromptLibraryPromotion(env, approval, disposition, note);
        break;
      case "capability_patch":
        result = await handleCapabilityPatch(env, approval, disposition, note);
        break;
      case "bridge_handoff":
        result = await handleBridgeHandoff(env, approval, disposition, note);
        break;
      case "strategy_promotion":
        result = await handleStrategyPromotion(env, approval, disposition, note);
        break;
      case "trading_scale_up":
        result = await handleScaleUp(env, approval, disposition, note);
        break;
      case "backend_run":
        result = await handleBackendRun(env, approval, disposition, note);
        break;
      default:
        result = {
          status: "not_applicable",
          detail: { reason: `Nothing to execute for a ${approval.kind} approval` },
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { status: "failed", detail: { error: message } };
    await logEvent(env.DB, {
      level: "error", scope: "approvals", event: "execution_failed",
      lane: approval.lane, entityId: approval.id,
      detail: { kind: approval.kind, disposition, message },
    });
  }

  const now = Date.now();
  await env.DB.batch([
    env.DB
      .prepare(`UPDATE approvals SET executed_at = ?, execution_status = ?, execution_detail = ? WHERE id = ?`)
      .bind(now, result.status, JSON.stringify(result.detail), approval.id),
    env.DB
      .prepare(`INSERT INTO approval_events (id, approval_id, ts, event, detail) VALUES (?,?,?,?,?)`)
      .bind(
        newId("ape"), approval.id, now,
        result.status === "executed" ? "executed"
          : result.status === "failed" ? "execution_failed" : "execution_skipped",
        JSON.stringify(result.detail),
      ),
  ]);

  await audit(env.DB, {
    actor: "system", lane: approval.lane, entityType: "approval", entityId: approval.id,
    action: `execution_${result.status}`,
    detail: { kind: approval.kind, disposition, ...result.detail },
  });

  await logEvent(env.DB, {
    level: result.status === "failed" ? "warn" : "info",
    scope: "approvals", event: "decision_executed", lane: approval.lane, entityId: approval.id,
    durationMs: Date.now() - started,
    detail: { kind: approval.kind, disposition, status: result.status },
  });

  return result;
}

// ─── task_output ─────────────────────────────────────────────────────────────
// Approve releases the output the employee produced. Reject cancels the task so
// it never sits in awaiting_approval with no way out.

async function handleTaskOutput(
  env: Env, approval: ApprovalRow, disposition: Disposition,
): Promise<ExecutionResult> {
  const taskId = payloadOf(approval).task_id ?? approval.origin_id;
  if (!taskId) return { status: "not_applicable", detail: { reason: "No task on this approval" } };

  const task = await env.DB
    .prepare(`SELECT id, status FROM tasks WHERE id = ?`).bind(taskId)
    .first<{ id: string; status: string }>();
  if (!task) return { status: "failed", detail: { error: `Task ${taskId} no longer exists` } };

  const now = Date.now();
  if (disposition === "approved") {
    await env.DB.batch([
      env.DB.prepare(`UPDATE tasks SET status = 'done', finished_at = COALESCE(finished_at, ?) WHERE id = ?`)
        .bind(now, taskId),
      env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'released',?)`)
        .bind(newId("tev"), taskId, now, JSON.stringify({ approval_id: approval.id })),
    ]);
    return { status: "executed", detail: { task_id: taskId, task_status: "done" } };
  }

  const reason = disposition === "expired" ? "The approval expired" : "The output was rejected";
  await env.DB.batch([
    env.DB.prepare(`UPDATE tasks SET status = 'cancelled', finished_at = COALESCE(finished_at, ?), error = ? WHERE id = ?`)
      .bind(now, reason, taskId),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'cancelled',?)`)
      .bind(newId("tev"), taskId, now, JSON.stringify({ approval_id: approval.id, reason })),
  ]);
  return { status: "executed", detail: { task_id: taskId, task_status: "cancelled", reason } };
}

// ─── backend_run ─────────────────────────────────────────────────────────────

/**
 * A run an execution backend proposed — Stage 1 of `docs/boss/PLAN_v21.md`, canon Phase 9 §33.
 *
 * ADDED TO THE EXISTING MECHANISM, NOT ALONGSIDE IT. The plan's own rule: "One approval mechanism.
 * `backend_run` extends the existing one; it does not add a second." So this is one more case in
 * the switch above, using the same payload, the same events, the same audit trail.
 *
 * APPROVING APPLIES NOTHING, AND THAT IS THE DESIGN RATHER THAN AN OMISSION. No backend commits,
 * merges, pushes or deploys — the forbidden list says so in every seeded row. A run ends as a
 * proposal with evidence; approving it is the owner accepting that proposal, and what happens next
 * happens on her machine, by her hand.
 *
 * A REFUSED RUN CANNOT BE APPROVED. Approving a refusal would be talking a guard out of a decision
 * it already made at the boundary, which is precisely the escalation path the addendum forbids.
 *
 * REJECTING DOES NOT REWRITE HISTORY. A run that succeeded still succeeded; the owner declining
 * its proposal is a fact about the proposal, not about what the run did. Only a run still in
 * flight is cancelled.
 */
async function handleBackendRun(
  env: Env, approval: ApprovalRow, disposition: Disposition, note?: string | null,
): Promise<ExecutionResult> {
  const p = payloadOf(approval);
  const runId = p.run_id ?? approval.origin_id;
  if (!runId) return { status: "not_applicable", detail: { reason: "No backend run on this approval" } };

  const run = await env.DB
    .prepare(
      `SELECT id, task_id, backend_id, status, summary, refusal_reason, evidence_id
         FROM backend_runs WHERE id = ?`,
    )
    .bind(runId)
    .first<{
      id: string; task_id: string | null; backend_id: string; status: string;
      summary: string | null; refusal_reason: string | null; evidence_id: string | null;
    }>();
  if (!run) return { status: "failed", detail: { error: `Backend run ${runId} no longer exists` } };

  if (run.status === "refused") {
    return {
      status: "not_applicable",
      detail: {
        run_id: runId,
        reason: "That run was refused at the boundary and never executed, so there is nothing to approve.",
        refusal_reason: run.refusal_reason,
      },
    };
  }

  const now = Date.now();

  if (disposition === "approved") {
    if (run.task_id) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE tasks SET status = 'done', finished_at = COALESCE(finished_at, ?) WHERE id = ?`)
          .bind(now, run.task_id),
        env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'released',?)`)
          .bind(newId("tev"), run.task_id, now, JSON.stringify({ approval_id: approval.id, backend_run_id: runId })),
      ]);
    }
    await audit(env.DB, {
      actor: "boss", lane: approval.lane, entityType: "backend_run", entityId: runId,
      action: "backend_run_accepted",
      detail: { backend_id: run.backend_id, task_id: run.task_id, note: note ?? null },
    });
    return {
      status: "executed",
      detail: {
        run_id: runId,
        backend_id: run.backend_id,
        task_id: run.task_id,
        evidence_id: run.evidence_id,
        outcome: "accepted",
        nothing_applied: true,
        note: "Accepting a proposal changes no repository. Nothing here commits, merges, pushes or deploys.",
      },
    };
  }

  const reason =
    disposition === "expired"
      ? "The proposal expired without a decision, so it was not accepted"
      : (note ?? "The proposed run was not accepted");

  const statements: D1PreparedStatement[] = [];
  if (run.status === "running") {
    statements.push(
      env.DB
        .prepare(`UPDATE backend_runs SET status = 'cancelled', finished_at = ?, error = ? WHERE id = ?`)
        .bind(now, reason, runId),
    );
  }
  if (run.task_id) {
    statements.push(
      env.DB.prepare(`UPDATE tasks SET status = 'cancelled', finished_at = COALESCE(finished_at, ?), error = ? WHERE id = ?`)
        .bind(now, reason, run.task_id),
      env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'cancelled',?)`)
        .bind(newId("tev"), run.task_id, now, JSON.stringify({ approval_id: approval.id, backend_run_id: runId, reason })),
    );
  }
  if (statements.length) await env.DB.batch(statements);

  return {
    status: "executed",
    detail: {
      run_id: runId,
      backend_id: run.backend_id,
      task_id: run.task_id,
      outcome: "rejected",
      run_status: run.status === "running" ? "cancelled" : run.status,
      reason,
    },
  };
}

// ─── memory_promotion ────────────────────────────────────────────────────────
// Nothing becomes durable memory without approval, so this is the only path that
// writes a promoted tier.

/**
 * Advancing a strategy up the Capital Deployment Ladder.
 *
 * The scorecard proved the evidence; this is the approval that moves the stage.
 * A rejected promotion leaves the strategy exactly where it was — the ladder
 * never advances on a score alone.
 */
async function handleStrategyPromotion(
  env: Env, approval: ApprovalRow, disposition: Disposition, note?: string | null,
): Promise<ExecutionResult> {
  const p = payloadOf(approval);
  const scorecardId = p.scorecard_id ?? approval.origin_id;
  if (!scorecardId) return { status: "not_applicable", detail: { reason: "No scorecard on this approval" } };

  const card = await env.DB
    .prepare(`SELECT id, strategy_id, stage_to, verdict, status FROM promotion_scorecards WHERE id = ?`)
    .bind(scorecardId)
    .first<{ id: string; strategy_id: string; stage_to: string; verdict: string; status: string }>();
  if (!card) return { status: "failed", detail: { error: `Scorecard ${scorecardId} no longer exists` } };
  if (card.status !== "proposed") return { status: "not_applicable", detail: { reason: `That scorecard is already ${card.status}` } };

  const now = Date.now();
  if (disposition === "approved") {
    if (card.verdict !== "pass") {
      return { status: "failed", detail: { error: "That scorecard does not pass, and a failing card cannot advance a stage" } };
    }
    await env.DB.batch([
      env.DB.prepare(`UPDATE trading_strategies SET stage = ? WHERE id = ?`).bind(card.stage_to, card.strategy_id),
      env.DB.prepare(`UPDATE promotion_scorecards SET status = 'applied' WHERE id = ?`).bind(scorecardId),
    ]);
    return { status: "executed", detail: { strategy_id: card.strategy_id, stage: card.stage_to } };
  }

  await env.DB
    .prepare(`UPDATE promotion_scorecards SET status = 'rejected' WHERE id = ?`)
    .bind(scorecardId)
    .run();
  return {
    status: "executed",
    detail: {
      scorecard_id: scorecardId,
      outcome: "rejected",
      reason: disposition === "expired" ? "The promotion expired without a decision" : (note ?? "Not approved"),
    },
  };
}

/** Opening a rung of the scale ladder. No autonomous capital increase, ever. */
async function handleScaleUp(
  env: Env, approval: ApprovalRow, disposition: Disposition, note?: string | null,
): Promise<ExecutionResult> {
  const p = payloadOf(approval);
  const rungNo = p.rung_no ?? Number(approval.origin_id);
  if (rungNo === undefined || Number.isNaN(Number(rungNo))) {
    return { status: "not_applicable", detail: { reason: "No rung on this approval" } };
  }

  const rung = await env.DB
    .prepare(`SELECT rung_no, label, capital_micros, reached_at FROM scale_rungs WHERE rung_no = ?`)
    .bind(Number(rungNo))
    .first<{ rung_no: number; label: string; capital_micros: number; reached_at: number | null }>();
  if (!rung) return { status: "failed", detail: { error: `Rung ${rungNo} no longer exists` } };
  if (rung.reached_at) return { status: "not_applicable", detail: { reason: "That rung is already open" } };

  const now = Date.now();
  if (disposition === "approved") {
    await env.DB.prepare(`UPDATE scale_rungs SET reached_at = ? WHERE rung_no = ?`).bind(now, rung.rung_no).run();
    return { status: "executed", detail: { rung_no: rung.rung_no, label: rung.label, capital_micros: rung.capital_micros } };
  }

  return {
    status: "executed",
    detail: {
      rung_no: rung.rung_no,
      outcome: "not_opened",
      reason: disposition === "expired" ? "The request expired, so no capital opened" : (note ?? "Not approved"),
    },
  };
}

/**
 * Canon §48 — the firm boundary.
 *
 * Approving is what lets a handoff cross; the category check already happened
 * when it was proposed, and it is re-checked here because a category list is
 * only worth what it is worth at the moment of crossing.
 */
async function handleBridgeHandoff(
  env: Env, approval: ApprovalRow, disposition: Disposition, note?: string | null,
): Promise<ExecutionResult> {
  const p = payloadOf(approval);
  const handoffId = p.handoff_id ?? approval.origin_id;
  if (!handoffId) return { status: "not_applicable", detail: { reason: "No handoff on this approval" } };

  const handoff = await env.DB
    .prepare(`SELECT id, direction, category, status FROM bridge_handoffs WHERE id = ?`).bind(handoffId)
    .first<{ id: string; direction: string; category: string; status: string }>();
  if (!handoff) return { status: "failed", detail: { error: `Handoff ${handoffId} no longer exists` } };
  if (handoff.status !== "proposed") {
    return { status: "not_applicable", detail: { reason: `That handoff is already ${handoff.status}` } };
  }

  const now = Date.now();
  if (disposition === "approved") {
    const verdict = checkCategory(handoff.category, handoff.direction as "outbound" | "inbound");
    if (!verdict.allowed) {
      // The list moved, or the row did. Either way it does not cross.
      await env.DB
        .prepare(`UPDATE bridge_handoffs SET status = 'refused', refusal_reason = ?, decided_at = ? WHERE id = ?`)
        .bind(`Re-checked at the moment of crossing and refused: ${verdict.reason}`, now, handoffId)
        .run();
      return { status: "failed", detail: { handoff_id: handoffId, error: verdict.reason } };
    }

    await env.DB
      .prepare(`UPDATE bridge_handoffs SET status = 'crossed', decided_at = ?, crossed_at = ? WHERE id = ?`)
      .bind(now, now, handoffId)
      .run();
    return { status: "executed", detail: { handoff_id: handoffId, direction: handoff.direction, category: handoff.category } };
  }

  const reason =
    disposition === "expired"
      ? "The approval expired without a decision, so nothing crossed"
      : (note ?? "Not approved to cross");
  await env.DB
    .prepare(`UPDATE bridge_handoffs SET status = 'rejected', refusal_reason = ?, decided_at = ? WHERE id = ?`)
    .bind(reason, now, handoffId)
    .run();
  return { status: "executed", detail: { handoff_id: handoffId, outcome: "rejected", reason } };
}

/**
 * Canon §78 — a critical capability does not change on somebody's say-so.
 *
 * Approving applies the patch to the Capability Package and bumps its version.
 * Rejecting and expiry close the patch, so a core capability is never left with
 * a change that is neither applied nor abandoned.
 */
async function handleCapabilityPatch(
  env: Env, approval: ApprovalRow, disposition: Disposition, note?: string | null,
): Promise<ExecutionResult> {
  const p = payloadOf(approval);
  const patchId = p.patch_id ?? approval.origin_id;
  if (!patchId) return { status: "not_applicable", detail: { reason: "No patch on this approval" } };

  const patch = await env.DB
    .prepare(`SELECT id, capability_id, changes, status FROM capability_patches WHERE id = ?`).bind(patchId)
    .first<{ id: string; capability_id: string; changes: string; status: string }>();
  if (!patch) return { status: "failed", detail: { error: `Patch ${patchId} no longer exists` } };
  if (patch.status !== "proposed") {
    return { status: "not_applicable", detail: { reason: `That patch is already ${patch.status}` } };
  }

  const now = Date.now();
  if (disposition === "approved") {
    await applyPatchChanges(env, patch.capability_id, JSON.parse(patch.changes), now);
    await env.DB
      .prepare(`UPDATE capability_patches SET status = 'applied', applied_at = ?, review_note = ? WHERE id = ?`)
      .bind(now, note ?? null, patchId)
      .run();
    return { status: "executed", detail: { patch_id: patchId, capability_id: patch.capability_id, changes: JSON.parse(patch.changes) } };
  }

  const reason =
    disposition === "expired"
      ? "The review expired without a decision, so the core capability was left as it was"
      : (note ?? "Patch rejected");
  await env.DB
    .prepare(`UPDATE capability_patches SET status = 'rejected', review_note = ? WHERE id = ?`)
    .bind(reason, patchId)
    .run();
  return { status: "executed", detail: { patch_id: patchId, outcome: "rejected", reason } };
}

/**
 * Canon §76.17 — the prompt library's review gate.
 *
 * Promotion proposed the prompt; this is what admits it. Rejection and expiry
 * are symmetric with every other gate: the entry closes rather than sitting in
 * `proposed` forever, pretending a decision is still coming.
 */
async function handlePromptLibraryPromotion(
  env: Env, approval: ApprovalRow, disposition: Disposition, note?: string | null,
): Promise<ExecutionResult> {
  const p = payloadOf(approval);
  const libraryId = p.library_id ?? approval.origin_id;
  if (!libraryId) return { status: "not_applicable", detail: { reason: "No library entry on this approval" } };

  const entry = await env.DB
    .prepare(`SELECT id, status, title FROM prompt_library WHERE id = ?`).bind(libraryId)
    .first<{ id: string; status: string; title: string }>();
  if (!entry) return { status: "failed", detail: { error: `Library entry ${libraryId} no longer exists` } };
  if (entry.status !== "proposed") {
    return { status: "not_applicable", detail: { reason: `That entry is already ${entry.status}` } };
  }

  const now = Date.now();
  const status = disposition === "approved" ? "approved" : "rejected";
  const reason =
    disposition === "expired"
      ? "The review expired without a decision, so the prompt was not admitted"
      : (note ?? (disposition === "approved" ? "Reviewed and admitted" : "Not admitted"));

  await env.DB
    .prepare(`UPDATE prompt_library SET status = ?, review_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`)
    .bind(status, reason, now, now, libraryId)
    .run();

  return { status: "executed", detail: { library_id: libraryId, title: entry.title, outcome: status, reason } };
}

async function handleMemoryPromotion(
  env: Env, approval: ApprovalRow, disposition: Disposition, note?: string | null,
): Promise<ExecutionResult> {
  const p = payloadOf(approval);
  const itemId = p.item_id ?? approval.origin_id;
  const toTier = p.to_tier;
  if (!itemId || !toTier) {
    return { status: "not_applicable", detail: { reason: "No memory item or target tier on this approval" } };
  }

  const item = await env.DB
    .prepare(`SELECT id, tier, status FROM memory_items WHERE id = ?`).bind(itemId)
    .first<{ id: string; tier: string; status: string }>();
  if (!item) return { status: "failed", detail: { error: `Memory ${itemId} no longer exists` } };

  const now = Date.now();
  if (disposition === "approved") {
    await env.DB.batch([
      env.DB.prepare(`UPDATE memory_items SET tier = ?, promoted_at = ?, status = 'active' WHERE id = ?`)
        .bind(toTier, now, itemId),
      env.DB.prepare(
        `UPDATE promotion_events SET outcome = 'applied', note = ? WHERE approval_id = ? AND outcome = 'proposed'`,
      ).bind(note ?? null, approval.id),
    ]);
    return { status: "executed", detail: { item_id: itemId, from_tier: item.tier, to_tier: toTier } };
  }

  // Rejected or expired: the item keeps its current tier and the proposal closes.
  // The capture is not deleted — a rejected promotion is a judgement about
  // durability, not about whether the note was ever taken.
  const outcome = disposition === "expired" ? "rejected" : "rejected";
  const reason = disposition === "expired" ? "The promotion approval expired" : (note ?? "Promotion rejected");
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE promotion_events SET outcome = ?, note = ? WHERE approval_id = ? AND outcome = 'proposed'`,
    ).bind(outcome, reason, approval.id),
    env.DB.prepare(`UPDATE memory_items SET rejected_at = ? WHERE id = ?`).bind(now, itemId),
  ]);
  return { status: "executed", detail: { item_id: itemId, kept_tier: item.tier, outcome, reason } };
}

// ─── trade ───────────────────────────────────────────────────────────────────

async function handleTrade(
  env: Env, approval: ApprovalRow, disposition: Disposition,
): Promise<ExecutionResult> {
  const orderId = payloadOf(approval).order_id ?? approval.origin_id;
  if (!orderId) return { status: "not_applicable", detail: { reason: "No order on this approval" } };

  const order = await env.DB
    .prepare(`SELECT * FROM trading_orders WHERE id = ?`).bind(orderId).first<OrderRow>();
  if (!order) return { status: "failed", detail: { error: `Order ${orderId} no longer exists` } };

  if (disposition === "approved") {
    const outcome = await executeOrder(env.DB, order);
    if (outcome.status === "filled") {
      return {
        status: "executed",
        detail: { order_id: orderId, filled_qty: outcome.qty, price: outcome.price, mode: order.mode, simulated: order.mode === "paper" },
      };
    }
    return { status: "failed", detail: { order_id: orderId, error: outcome.error, hint: outcome.hint } };
  }

  const reason = disposition === "expired" ? "The trade approval expired" : "The trade was rejected";
  const cancelled = await cancelOrder(env.DB, orderId, reason);
  return {
    status: cancelled ? "executed" : "not_applicable",
    detail: { order_id: orderId, order_status: cancelled ? "cancelled" : "already terminal", reason },
  };
}

// ─── spend ───────────────────────────────────────────────────────────────────
// A spend approval holds a task at the gate. Approving puts it back on the queue.

async function handleSpend(
  env: Env, approval: ApprovalRow, disposition: Disposition,
): Promise<ExecutionResult> {
  const p = payloadOf(approval);
  const taskId = p.task_id ?? approval.origin_id;
  if (!taskId) return { status: "not_applicable", detail: { reason: "No held task on this approval" } };

  const task = await env.DB
    .prepare(`SELECT id, lane, status FROM tasks WHERE id = ?`).bind(taskId)
    .first<{ id: string; lane: string; status: string }>();
  if (!task) return { status: "failed", detail: { error: `Task ${taskId} no longer exists` } };

  const now = Date.now();
  if (disposition === "approved") {
    await env.DB.batch([
      env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL, approval_id = NULL WHERE id = ?`)
        .bind(taskId),
      env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'requeued',?)`)
        .bind(newId("tev"), taskId, now, JSON.stringify({ approval_id: approval.id, budget_micros: p.budget_micros ?? null })),
    ]);
    await env.TASKS.send({ taskId, lane: task.lane });
    return { status: "executed", detail: { task_id: taskId, task_status: "queued" } };
  }

  const reason = disposition === "expired" ? "The spend approval expired" : "The spend was rejected";
  await env.DB.batch([
    env.DB.prepare(`UPDATE tasks SET status = 'cancelled', finished_at = COALESCE(finished_at, ?), error = ? WHERE id = ?`)
      .bind(now, reason, taskId),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'cancelled',?)`)
      .bind(newId("tev"), taskId, now, JSON.stringify({ approval_id: approval.id, reason })),
  ]);
  return { status: "executed", detail: { task_id: taskId, task_status: "cancelled", reason } };
}

// ─── model_route ─────────────────────────────────────────────────────────────
// The sensitive-routing card. Approving grants one task's restricted content
// permission to reach a cloud model, on the record, and puts it back on the
// queue. The grant is written onto that task's envelope and nowhere else, so it
// cannot leak into the next task.

async function handleModelRoute(
  env: Env, approval: ApprovalRow, disposition: Disposition,
): Promise<ExecutionResult> {
  const taskId = payloadOf(approval).task_id ?? approval.origin_id;
  if (!taskId) return { status: "not_applicable", detail: { reason: "No task on this routing card" } };

  const task = await env.DB
    .prepare(`SELECT id, lane, envelope_id FROM tasks WHERE id = ?`).bind(taskId)
    .first<{ id: string; lane: string; envelope_id: string | null }>();
  if (!task) return { status: "failed", detail: { error: `Task ${taskId} no longer exists` } };

  const now = Date.now();
  if (disposition === "approved") {
    if (!task.envelope_id) {
      return { status: "failed", detail: { error: "That task has no permission envelope to grant against" } };
    }
    await env.DB.batch([
      env.DB.prepare(`UPDATE permission_envelopes SET cloud_for_restricted_allowed = 1 WHERE id = ?`)
        .bind(task.envelope_id),
      env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL, approval_id = NULL WHERE id = ?`)
        .bind(taskId),
      env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'routing_permitted',?)`)
        .bind(newId("tev"), taskId, now, JSON.stringify({ approval_id: approval.id, grant: "cloud_for_restricted" })),
    ]);
    await env.TASKS.send({ taskId, lane: task.lane });
    return {
      status: "executed",
      detail: { task_id: taskId, envelope_id: task.envelope_id, grant: "cloud_for_restricted", task_status: "queued" },
    };
  }

  const reason = disposition === "expired" ? "The routing card expired" : "Cloud routing was refused";
  await env.DB.batch([
    env.DB.prepare(`UPDATE tasks SET status = 'cancelled', finished_at = COALESCE(finished_at, ?), error = ? WHERE id = ?`)
      .bind(now, reason, taskId),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'cancelled',?)`)
      .bind(newId("tev"), taskId, now, JSON.stringify({ approval_id: approval.id, reason })),
  ]);
  return { status: "executed", detail: { task_id: taskId, task_status: "cancelled", reason } };
}

// ─── agent_creation ──────────────────────────────────────────────────────────
// The Agent Creation Gate. An employee only becomes real here, and only with a
// full charter, permissions, cost ceiling, and retirement criteria attached.

async function handleAgentCreation(
  env: Env, approval: ApprovalRow, disposition: Disposition, note?: string | null,
): Promise<ExecutionResult> {
  const proposalId = payloadOf(approval).proposal_id ?? approval.origin_id;
  if (!proposalId) return { status: "not_applicable", detail: { reason: "No proposal on this approval" } };

  const proposal = await env.DB
    .prepare(`SELECT * FROM agent_proposals WHERE id = ?`).bind(proposalId).first<any>();
  if (!proposal) return { status: "failed", detail: { error: `Proposal ${proposalId} no longer exists` } };
  if (proposal.status !== "proposed") {
    return { status: "not_applicable", detail: { reason: `Proposal is already ${proposal.status}` } };
  }

  const now = Date.now();
  if (disposition !== "approved") {
    const reason = disposition === "expired" ? "The proposal expired unreviewed" : (note ?? "Proposal rejected");
    await env.DB
      .prepare(`UPDATE agent_proposals SET status = 'blocked', decided_at = ?, block_reason = ? WHERE id = ?`)
      .bind(now, reason, proposalId)
      .run();
    return { status: "executed", detail: { proposal_id: proposalId, outcome: "blocked", reason } };
  }

  // New employees start provisional with a review date, never straight to active.
  const employeeId = newId("emp");
  const permissions = (() => {
    try { return JSON.parse(proposal.permissions); } catch { return {}; }
  })();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO employees
         (id, lane, name, role, charter, route_id, autonomy, status, created_at,
          department, lifecycle, risk_level, budget_micros_day, review_at, proposal_id)
       VALUES (?,?,?,?,?,?,'ask','active',?,?,'provisional',?,?,?,?)`,
    ).bind(
      employeeId, proposal.lane, proposal.name, proposal.role, proposal.purpose,
      proposal.lane === "trading" ? "rt_trading_default" : "rt_ops_default",
      now, permissions.department ?? null, permissions.risk_level ?? "medium",
      proposal.cost_limit_micros ?? 0, now + 30 * 24 * 60 * 60 * 1000, proposalId,
    ),
    env.DB.prepare(
      `UPDATE agent_proposals SET status = 'approved', decided_at = ?, employee_id = ? WHERE id = ?`,
    ).bind(now, employeeId, proposalId),
  ]);

  await audit(env.DB, {
    actor: "boss", lane: proposal.lane, entityType: "employee", entityId: employeeId,
    action: "hired_provisional", detail: { proposal_id: proposalId },
  });

  return {
    status: "executed",
    detail: { proposal_id: proposalId, employee_id: employeeId, lifecycle: "provisional", review_in_days: 30 },
  };
}
