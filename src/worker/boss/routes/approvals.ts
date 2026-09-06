import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { getNumber } from "../lib/settings";
import { isLane } from "../../shared/lanes";
import { executeDecision, type ApprovalRow } from "../approvals/execute";
import { assertProtectedAction, decisionRight } from "../governance/gate";

export const approvals = new Hono<{ Bindings: Env; Variables: Vars }>();

const DECISIONS = ["approved", "rejected", "deferred"] as const;

approvals.get("/", async (c) => {
  const status = c.req.query("status") ?? "pending";
  const lane = c.req.query("lane");
  const params: unknown[] = [status];
  let sql = `SELECT * FROM approvals WHERE status = ?`;
  if (lane && isLane(lane)) { sql += ` AND lane = ?`; params.push(lane); }
  sql += ` ORDER BY CASE risk WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, requested_at DESC LIMIT 100`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return ok(c, rows.results ?? []);
});

/** Full docket: the approval, its event trail, and whatever it will act on. */
approvals.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT * FROM approvals WHERE id = ?`).bind(id).first<any>();
  if (!row) throw notFound("No approval with that id");

  const events = await c.env.DB
    .prepare(`SELECT * FROM approval_events WHERE approval_id = ? ORDER BY ts`)
    .bind(id).all();

  return ok(c, {
    approval: row,
    events: events.results ?? [],
    origin: await loadOrigin(c.env, row),
  });
});

/** Resolves what an approval is actually about, so the detail screen can show it. */
async function loadOrigin(env: Env, approval: any): Promise<unknown> {
  const payload = (() => {
    try { return approval.payload ? JSON.parse(approval.payload) : {}; } catch { return {}; }
  })();

  switch (approval.kind) {
    case "task_output":
    case "spend": {
      const taskId = payload.task_id ?? approval.origin_id;
      if (!taskId) return null;
      const task = await env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(taskId).first();
      const evidence = await env.DB
        .prepare(`SELECT * FROM evidence_packets WHERE task_id = ? ORDER BY ts DESC LIMIT 1`)
        .bind(taskId).first();
      return { type: "task", task, evidence };
    }
    case "memory_promotion": {
      const itemId = payload.item_id ?? approval.origin_id;
      if (!itemId) return null;
      return {
        type: "memory",
        item: await env.DB.prepare(`SELECT * FROM memory_items WHERE id = ?`).bind(itemId).first(),
        to_tier: payload.to_tier ?? null,
      };
    }
    case "trade": {
      const orderId = payload.order_id ?? approval.origin_id;
      if (!orderId) return null;
      return {
        type: "order",
        order: await env.DB.prepare(`SELECT * FROM trading_orders WHERE id = ?`).bind(orderId).first(),
      };
    }
    case "agent_creation": {
      const proposalId = payload.proposal_id ?? approval.origin_id;
      if (!proposalId) return null;
      return {
        type: "agent_proposal",
        proposal: await env.DB.prepare(`SELECT * FROM agent_proposals WHERE id = ?`).bind(proposalId).first(),
      };
    }
    default:
      return null;
  }
}

approvals.post("/", async (c) => {
  const body = await c.req.json<any>();
  if (!body?.title) throw badRequest("An approval needs a title", "Send { title, lane, kind }.");
  const lane = isLane(body.lane) ? body.lane : "ops";
  const id = newId("apr");
  const now = Date.now();
  const defaultExpiry = await getNumber(c.env.DB, "approval_expiry_default_ms", 7 * 24 * 60 * 60 * 1000);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk,
                              payload, status, requested_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`,
    ).bind(
      id, lane, body.title, body.summary ?? null, body.kind ?? "manual",
      body.origin_type ?? null, body.origin_id ?? null, body.risk ?? "low",
      body.payload ? JSON.stringify(body.payload) : null, now,
      body.expires_at ?? now + defaultExpiry,
    ),
    c.env.DB.prepare(
      `INSERT INTO approval_events (id, approval_id, ts, event, detail) VALUES (?,?,?,'raised',NULL)`,
    ).bind(newId("ape"), id, now),
  ]);

  await audit(c.env.DB, { actor: "system", lane, entityType: "approval", entityId: id, action: "raised" });
  const row = await c.env.DB.prepare(`SELECT * FROM approvals WHERE id = ?`).bind(id).first();
  return ok(c, row, 201);
});

/**
 * Decide, then execute.
 *
 * The decision row is written first so an execution failure can never lose the
 * fact that the Boss decided. Execution status is reported back separately, so
 * the UI can say "approved, but the order was refused" instead of pretending.
 */
approvals.post("/:id/decide", async (c) => {
  const id = c.req.param("id");
  const { decision, note } = await c.req.json<{ decision: string; note?: string }>();
  if (!DECISIONS.includes(decision as (typeof DECISIONS)[number])) {
    throw badRequest("Decision must be approved, rejected, or deferred");
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    throw badRequest("A decision note must be text");
  }

  const current = await c.env.DB
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
    const right = await decisionRight(c.env.DB, current.kind);
    if (right && right.decider !== "boss") {
      throw conflict(
        `${right.label} is not the Boss's call to make here`,
        `The decision rights table names ${right.decider}. ${right.rationale}`,
      );
    }
    await assertProtectedAction(c.env, current.kind, { type: "approval", id });
  }

  const now = Date.now();

  /*
   * The status is re-checked inside the write, not only in the guard above.
   * Two decisions arriving together — a double tap, a client retry — would both
   * pass a read-then-write check and both run `executeDecision`, which moves
   * capital, crosses the firm boundary and patches capabilities. Claiming the
   * row is what makes this idempotent: exactly one caller changes it, and the
   * loser is told it was already decided rather than executing a second time.
   */
  const claim = await c.env.DB
    .prepare(
      `UPDATE approvals SET status = ?, decided_at = ?, decided_by = 'boss', decision_note = ?
        WHERE id = ? AND status IN ('pending','deferred')`,
    )
    .bind(decision, now, note ?? null, id)
    .run();

  if ((claim.meta.changes ?? 0) === 0) {
    const latest = await c.env.DB.prepare(`SELECT status FROM approvals WHERE id = ?`).bind(id).first<{ status: string }>();
    throw conflict(
      `This was already ${latest?.status ?? "decided"}`,
      "Another decision landed first. Raise a new approval instead of re-deciding.",
    );
  }

  await c.env.DB
    .prepare(`INSERT INTO approval_events (id, approval_id, ts, event, detail) VALUES (?,?,?,?,?)`)
    .bind(newId("ape"), id, now, decision, note ? JSON.stringify({ note }) : null)
    .run();

  await audit(c.env.DB, {
    actor: "boss", lane: current.lane, entityType: "approval", entityId: id,
    action: decision, detail: note ? { note } : undefined,
  });

  // Deferring is explicitly not a decision about the payload, so nothing runs.
  let execution = null;
  if (decision === "approved" || decision === "rejected") {
    execution = await executeDecision(c.env, current, decision, note ?? null);
  }

  const row = await c.env.DB.prepare(`SELECT * FROM approvals WHERE id = ?`).bind(id).first();
  return ok(c, { approval: row, execution });
});

/**
 * Expiry sweep. Anything still pending past `expires_at` expires, and its origin
 * is terminated the same way a rejection would terminate it — an expired
 * approval that leaves a task stuck awaiting_approval is a lie about the state.
 */
export async function runExpirySweep(env: Env): Promise<{ expired: number; executed: number; failed: number }> {
  const now = Date.now();
  const due = await env.DB
    .prepare(
      `SELECT * FROM approvals
        WHERE status IN ('pending','deferred') AND expires_at IS NOT NULL AND expires_at <= ?
        ORDER BY expires_at LIMIT 200`,
    )
    .bind(now)
    .all<ApprovalRow>();

  let expired = 0, executed = 0, failed = 0;

  for (const approval of due.results ?? []) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE approvals SET status = 'expired', decided_at = ?, decided_by = 'system' WHERE id = ?`,
      ).bind(now, approval.id),
      env.DB.prepare(
        `INSERT INTO approval_events (id, approval_id, ts, event, detail) VALUES (?,?,?,'expired',?)`,
      ).bind(newId("ape"), approval.id, now, JSON.stringify({ reason: "Passed its expiry without a decision" })),
    ]);
    expired++;

    await audit(env.DB, {
      actor: "system", lane: approval.lane, entityType: "approval", entityId: approval.id,
      action: "expired",
    });

    const result = await executeDecision(env, approval, "expired", "Expired without a decision");
    if (result.status === "executed") executed++;
    else if (result.status === "failed") failed++;
  }

  if (expired) {
    await logEvent(env.DB, {
      level: "info", scope: "cron", event: "expiry_sweep", detail: { expired, executed, failed },
    });
  }
  return { expired, executed, failed };
}

approvals.post("/sweep/expire", async (c) => {
  const result = await runExpirySweep(c.env);
  return ok(c, result);
});
