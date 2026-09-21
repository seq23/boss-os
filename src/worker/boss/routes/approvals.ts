import { Hono } from "hono";
import { recordHumanVerdict } from "../router/experience";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { getNumber } from "../lib/settings";
import { isLane } from "../../../shared/boss/lanes";
import { executeDecision, type ApprovalRow } from "../approvals/execute";
import { decideApproval, type Decision } from "../approvals/decide";
import { pendingApprovals } from "../approvals/pending";

export const approvals = new Hono<{ Bindings: Env; Variables: Vars }>();

const DECISIONS = ["approved", "rejected", "deferred"] as const;

/**
 * The dockets, and — for the pending case — the one number every surface reads.
 *
 * `X-Pending-Total` rather than a changed body shape: the response has been a bare array since it
 * was written and three callers destructure it as one. The header carries the total the badge and
 * the Today card need without a migration of every reader, and `approvals/pending.ts` guarantees it
 * was counted over the same query the rows came from. See that file for what went wrong without it.
 */
approvals.get("/", async (c) => {
  const status = c.req.query("status") ?? "pending";
  const lane = c.req.query("lane");

  if (status === "pending") {
    const { rows, total, truncated } = await pendingApprovals(c.env.DB, lane && isLane(lane) ? lane : null);
    c.header("X-Pending-Total", String(total));
    c.header("X-Pending-Truncated", truncated ? "1" : "0");
    return ok(c, rows);
  }

  const params: unknown[] = [status];
  let sql = `SELECT * FROM approvals WHERE status = ?`;
  if (lane && isLane(lane)) { sql += ` AND lane = ?`; params.push(lane); }
  sql += ` ORDER BY CASE risk WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, requested_at DESC LIMIT 100`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return ok(c, rows.results ?? []);
});

/**
 * THINGS SHE HAS BEEN TOLD, WHICH ARE NOT THINGS SHE MUST ANSWER.
 *
 * Confirmed on production, 9 September 2026: `kind = 'notice'` had eight rows and every one of them
 * was `approved`. An employee said "I emailed you the LP outcomes" and the Inbox put Approve /
 * Reject / Later under it. She pressed Approve eight times to make a sentence go away.
 *
 * REGISTERED BEFORE `/:id` ON PURPOSE. Hono matches in order, so a parameterised route declared
 * first would swallow this path and answer "no approval with that id" — a 404 that reads like a bug
 * in the client.
 *
 * It reads `pendingApprovals` like everything else, so the notices here and the decisions on the
 * list can never be two different readings of the table.
 */
approvals.get("/notices", async (c) => {
  const { notices } = await pendingApprovals(c.env.DB);
  return ok(c, notices);
});

// === Inbox overhaul ===
//
// One reason for many dockets. Her words, 19 September 2026: "I need to be able to reject all
// things at once with an overarching reason why — right now I had 13 messages to reject." Confirmed
// on production: eleven of the thirteen carry the decision note "same".
//
// A batch is one act with one reason. It is NOT one decision: the client still calls
// `POST /:id/decide` once per docket with the batch id, so every item passes the same governance
// check, writes the same event, and its own record reads as a decision about it — with the whole
// sentence, not "same". Progress is therefore visible per item ("7 of 13 rejected") and a failure
// on one docket fails one docket.

/** How short a shared reason may be. "same" is four characters; the defect is the reason. */
export const MIN_BATCH_REASON_CHARS = 12;

approvals.post("/batches", async (c) => {
  const body = await c.req.json<any>().catch(() => null);
  const decision = String(body?.decision ?? "");
  const reason = String(body?.reason ?? "").trim();
  const count = Number(body?.count);

  /*
   * REJECTED ONLY. Approving is judging work she has looked at; thirteen letters approved as one act
   * are thirteen letters she may not have read, and "Silence is never approval" (canon D7) is the
   * rule this would erode. Rejecting with a reason sends nothing and loses nothing but a card.
   */
  if (decision !== "rejected") {
    throw badRequest(
      "Only a rejection can be given to many dockets at once",
      "Approving is a judgement about work you have read, one docket at a time. Reject the ones you do not want, then approve the rest individually.",
    );
  }
  if (reason.length < MIN_BATCH_REASON_CHARS) {
    throw badRequest(
      `The shared reason needs at least ${MIN_BATCH_REASON_CHARS} characters`,
      "It is written onto every record; \"same\" tells the person redoing the work nothing.",
    );
  }
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw badRequest("A batch names how many dockets it covers", "Send count between 1 and 200.");
  }

  const id = newId("apb");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO approval_batches (id, decision, reason, requested_count, created_at, updated_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .bind(id, decision, reason, count, now, now)
    .run();
  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "approval_batch", entityId: id,
    action: "opened", detail: { decision, count, reason },
  });
  return ok(c, { id, decision, reason, requested_count: count, done_count: 0, failed_count: 0 }, 201);
});

/** The batch and its items, so a record can show "one of 13, with this reason". */
approvals.get("/batches/:id", async (c) => {
  const id = c.req.param("id");
  const batch = await c.env.DB.prepare(`SELECT * FROM approval_batches WHERE id = ?`).bind(id).first<any>();
  if (!batch) throw notFound("No batch with that id");
  const items = await c.env.DB
    .prepare(`SELECT id, title, status, decided_at, decision_note FROM approvals WHERE batch_id = ? ORDER BY decided_at`)
    .bind(id)
    .all();
  return ok(c, { batch, items: items.results ?? [] });
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
    case "backend_run": {
      const runId = payload.run_id ?? approval.origin_id;
      if (!runId) return null;
      const run = await env.DB.prepare(`SELECT * FROM backend_runs WHERE id = ?`).bind(runId).first<any>();
      if (!run) return null;
      // The evidence is the point of the card: she is approving a proposal, and the proposal is
      // what the run says it did. An approval that cannot show its evidence is a rubber stamp.
      const evidence = await env.DB
        .prepare(`SELECT * FROM evidence_packets WHERE task_id = ? ORDER BY ts DESC LIMIT 1`)
        .bind(run.task_id).first();
      return { type: "backend_run", run, evidence };
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
  const parsed = await c.req.json<{ decision: string; note?: string; batch_id?: string }>();
  const { decision, batch_id } = parsed;
  let note = parsed.note;
  if (!DECISIONS.includes(decision as (typeof DECISIONS)[number])) {
    throw badRequest("Decision must be approved, rejected, or deferred");
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    throw badRequest("A decision note must be text");
  }

  /*
   * ONE OF MANY. A batch id ties this decision to the act that carried the shared reason. The
   * batch's decision must match — a batch opened to reject cannot be used to approve — and the
   * reason is copied onto THIS record, so the docket reads the whole sentence on its own.
   */
  let batch: { id: string; decision: string; reason: string } | null = null;
  if (batch_id !== undefined && batch_id !== null) {
    if (typeof batch_id !== "string") throw badRequest("A batch id must be text");
    batch = await c.env.DB
      .prepare(`SELECT id, decision, reason FROM approval_batches WHERE id = ?`)
      .bind(batch_id)
      .first<{ id: string; decision: string; reason: string }>();
    if (!batch) throw notFound("No batch with that id");
    if (batch.decision !== decision) {
      throw conflict(`That batch was opened to ${batch.decision === "rejected" ? "reject" : batch.decision}`, "A batch carries one decision. Open another for a different one.");
    }
    if (!note || !note.trim()) note = batch.reason;
  }

  /*
   * THE DECISION ITSELF LIVES IN `approvals/decide.ts`, so the mail door — her `approved` on a
   * duty draft's thread — takes exactly this path with no HTTP call from the Worker to itself.
   * The route validates the body and the batch; `decideApproval` does the rest.
   */
  const { approval: row, execution } = await decideApproval(c.env, { id, decision: decision as Decision, note: note ?? null, batch, decidedBy: "boss" });
  return ok(c, { approval: row, execution, batch_id: batch?.id ?? null });
});

/** A docket the batch could not decide — refused by name — is counted on the act, not lost. */
approvals.post("/batches/:id/failed", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<any>().catch(() => null);
  const res = await c.env.DB
    .prepare(`UPDATE approval_batches SET failed_count = failed_count + 1, updated_at = ? WHERE id = ?`)
    .bind(Date.now(), id)
    .run();
  if (!res.meta.changes) throw notFound("No batch with that id");
  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "approval_batch", entityId: id,
    action: "item_failed", detail: { approval_id: body?.approval_id ?? null, error: body?.error ?? null },
  });
  return ok(c, { id });
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
