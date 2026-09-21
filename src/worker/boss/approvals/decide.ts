import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { conflict, notFound } from "../lib/http";
import { recordHumanVerdict } from "../router/experience";
import { executeDecision, type ApprovalRow } from "./execute";
import { assertProtectedAction, decisionRight } from "../governance/gate";

/**
 * HER DECISION, AS ONE FUNCTION.
 *
 * ─── Why this is extracted from `routes/approvals.ts` ────────────────────
 *
 * `POST /approvals/:id/decide` was the only way to decide a docket, and it is reached from the
 * Inbox button. The duty lane needs the SAME decision to happen when she replies `approved` to a
 * draft by email — recorded the same way, gated by the same governance layer, executed by the same
 * `executeDecision`, claimed by the same idempotent UPDATE. A second copy of that in the mail lane
 * is the "two components each keeping their own list" defect; a fetch from the Worker to its own
 * route is a second authentication and an outbound call `validate:network-boundary` refuses. So
 * the mechanism moves here and both callers use it. `raise.ts` took the same road for the same
 * reason.
 *
 * The route still validates its body and resolves its batch; this does everything after that.
 */

export type Decision = "approved" | "rejected" | "deferred";

export interface DecideInput {
  id: string;
  decision: Decision;
  note?: string | null;
  batch?: { id: string; decision: string; reason: string } | null;
  /** Who is recorded on the row: "boss" from the screen; her address from a verified mail. */
  decidedBy: string;
}

export interface Decided {
  approval: Record<string, unknown> | null;
  execution: Awaited<ReturnType<typeof executeDecision>> | null;
}

export async function decideApproval(env: Env, input: DecideInput): Promise<Decided> {
  const { id, decision, batch, decidedBy } = input;
  let note = input.note ?? undefined;
  const now = Date.now();
  const current = await env.DB
    .prepare(`SELECT * FROM approvals WHERE id = ?`).bind(id).first<ApprovalRow & { expires_at: number | null }>();
  if (!current) throw notFound("No approval with that id");
  if (current.status !== "pending" && current.status !== "deferred") {
    throw conflict(`This was already ${current.status}`, "Raise a new approval instead of re-deciding.");
  }

  /*
   * Canon §2–§3 and §18. The governance layer is consulted before the decision
   * is recorded: a right can name someone other than the Boss as the decider,
   * and a protected class is held while a high-risk state is in force.
   * Deferring is never held — postponing is always available.
   */
  if (decision !== "deferred") {
    const right = await decisionRight(env.DB, current.kind);
    if (right && right.decider !== "boss") {
      throw conflict(
        `${right.label} is not the Boss's call to make here`,
        `The decision rights table names ${right.decider}. ${right.rationale}`,
      );
    }
    await assertProtectedAction(env, current.kind, { type: "approval", id });
  }


  /*
   * The status is re-checked inside the write, not only in the guard above.
   * Two decisions arriving together — a double tap, a client retry — would both
   * pass a read-then-write check and both run `executeDecision`, which moves
   * capital, crosses the firm boundary and patches capabilities. Claiming the
   * row is what makes this idempotent: exactly one caller changes it, and the
   * loser is told it was already decided rather than executing a second time.
   */
  const claim = await env.DB
    .prepare(
      `UPDATE approvals SET status = ?, decided_at = ?, decided_by = ?, decision_note = ?, batch_id = ?
        WHERE id = ? AND status IN ('pending','deferred')`,
    )
    .bind(decision, now, decidedBy, note ?? null, batch?.id ?? null, id)
    .run();

  if ((claim.meta.changes ?? 0) === 0) {
    const latest = await env.DB.prepare(`SELECT status FROM approvals WHERE id = ?`).bind(id).first<{ status: string }>();
    throw conflict(
      `This was already ${latest?.status ?? "decided"}`,
      "Another decision landed first. Raise a new approval instead of re-deciding.",
    );
  }

  const eventDetail = note || batch ? { ...(note ? { note } : {}), ...(batch ? { batch_id: batch.id } : {}) } : null;
  await env.DB
    .prepare(`INSERT INTO approval_events (id, approval_id, ts, event, detail) VALUES (?,?,?,?,?)`)
    .bind(newId("ape"), id, now, decision, eventDetail ? JSON.stringify(eventDetail) : null)
    .run();

  await audit(env.DB, {
    actor: "boss", lane: current.lane, entityType: "approval", entityId: id,
    action: decision, detail: eventDetail ?? undefined,
  });

  /*
   * A PERSON JUST JUDGED WORK A MODEL DID, AND THAT IS THE ONLY EVIDENCE WORTH ANYTHING.
   *
   * `router/experience.ts` will never call a model proven on router-recorded rows alone — "the call
   * returned" is not "the work stood". This is the other half: it traces the approval back through
   * `routing_decisions` to the model and the task kind, and records what she actually decided.
   *
   * IT CANNOT FAIL THE DECISION. Recording evidence about a judgement must never be able to undo
   * the judgement, and `recordHumanVerdict` records nothing rather than guessing when any link in
   * that trace is missing.
   */
  if (current.origin_type === "task" && (decision === "approved" || decision === "rejected")) {
    await recordHumanVerdict(env.DB, { taskId: current.origin_id, decision, note: note ?? undefined });
  }

  // Deferring is explicitly not a decision about the payload, so nothing runs.
  let execution = null;
  if (decision === "approved" || decision === "rejected") {
    // The batch she decided this in rides along, so a rewrite queued by a send-back can name it.
    execution = await executeDecision(env, { ...current, batch_id: batch?.id ?? null } as typeof current, decision, note ?? null);
  }

  /*
   * THE BATCH COUNTS WHAT ACTUALLY HAPPENED. `done` is a decision that was recorded; a decision whose
   * execution then failed is still a decision she made, so it counts as done and the execution
   * status says the rest. `failed` is reserved for a docket the route refused — the client records
   * that when its own call throws, through `/batches/:id/failed`.
   */
  if (batch) {
    await env.DB
      .prepare(`UPDATE approval_batches SET done_count = done_count + 1, updated_at = ? WHERE id = ?`)
      .bind(now, batch.id)
      .run();
  }

  const row = await env.DB.prepare(`SELECT * FROM approvals WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  return { approval: row ?? null, execution };
}
