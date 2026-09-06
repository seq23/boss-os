/**
 * Phase 21 — the Firm OS bridge.
 *
 * Canon §48, §79.10. One narrow crossing, audited in both directions, with an
 * allowlist that falls closed. A refused handoff is recorded rather than
 * discarded: the pattern of what somebody keeps trying to send is exactly the
 * thing a boundary needs to be able to show later.
 *
 * What crosses is a reference and a summary. The bridge never holds the object,
 * which is why it cannot leak one.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import {
  ALLOWED_CATEGORIES, FORBIDDEN_CATEGORIES, SEPARATION, SEPARATION_NOTE,
  checkCategory, type Direction,
} from "../bridge/categories";
import { raiseFlag } from "../governance/gate";

export const bridge = new Hono<{ Bindings: Env; Variables: Vars }>();

const DIRECTIONS = new Set<Direction>(["outbound", "inbound"]);
const PAYLOAD_KINDS = new Set(["memory", "document_artifact", "external", "note"]);

function requiredText(value: unknown, what: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw badRequest(`${what} is required`);
  return text;
}

bridge.get("/categories", async (c) =>
  ok(c, {
    allowed: ALLOWED_CATEGORIES,
    forbidden: FORBIDDEN_CATEGORIES,
    rule:
      "The list is hardcoded in the application, not stored in a table — a forbidden list that lives in a table is " +
      "one somebody can edit at 2am. Unknown categories are refused: the bridge is an allowlist that falls closed.",
  }),
);

bridge.get("/separation", async (c) => {
  const [handoffs, refused] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM bridge_handoffs WHERE status = 'crossed'`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM bridge_handoffs WHERE status = 'refused'`).first<{ n: number }>(),
  ]);
  const unproven = SEPARATION.filter((s) => s.proof === "externally_unproven");
  return ok(c, {
    separation: SEPARATION,
    proven_locally: SEPARATION.length - unproven.length,
    externally_unproven: unproven.map((s) => s.dimension),
    crossings: handoffs?.n ?? 0,
    refusals: refused?.n ?? 0,
    note: SEPARATION_NOTE,
  });
});

bridge.get("/handoffs", async (c) => {
  const status = c.req.query("status");
  const rows = await c.env.DB
    .prepare(`SELECT * FROM bridge_handoffs ${status ? "WHERE status = ?" : ""} ORDER BY requested_at DESC LIMIT 100`)
    .bind(...(status ? [status] : []))
    .all<any>();
  return ok(c, (rows.results ?? []).map((h) => ({ ...h, evidence: h.evidence ? JSON.parse(h.evidence) : null })));
});

bridge.get("/handoffs/:id", async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM bridge_handoffs WHERE id = ?`).bind(c.req.param("id")).first<any>();
  if (!row) throw notFound("No handoff with that id");
  return ok(c, { ...row, evidence: row.evidence ? JSON.parse(row.evidence) : null });
});

/**
 * Proposing a crossing. The category check runs first and in both directions;
 * a refusal is written down with its reason, raises a compliance flag, and
 * never creates an approval — there is nothing for the Boss to decide about a
 * category that does not cross.
 */
bridge.post("/handoffs", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const direction = requiredText(b?.direction, "A direction") as Direction;
  if (!DIRECTIONS.has(direction)) throw badRequest(`"${direction}" is not a direction`, "One of: outbound, inbound.");

  const category = requiredText(b?.category, "A category");
  const title = requiredText(b?.title, "A title");
  const summary = requiredText(b?.summary, "A summary of what it is");
  const payloadRef = requiredText(b?.payload_ref, "A payload reference");
  const payloadKind = requiredText(b?.payload_kind, "A payload kind");
  if (!PAYLOAD_KINDS.has(payloadKind)) {
    throw badRequest(`"${payloadKind}" is not a payload kind`, `One of: ${[...PAYLOAD_KINDS].join(", ")}.`);
  }

  const verdict = checkCategory(category, direction);
  const id = newId("bhf");
  const now = Date.now();

  if (!verdict.allowed) {
    await c.env.DB
      .prepare(
        `INSERT INTO bridge_handoffs
           (id, direction, category, title, summary, payload_ref, payload_kind, counterparty, status, refusal_reason, requested_at, decided_at, evidence, created_at)
         VALUES (?,?,?,?,?,?,?,?,'refused',?,?,?,?,?)`,
      )
      .bind(
        id, direction, category, title, summary, payloadRef, payloadKind,
        String(b?.counterparty ?? "firm"), verdict.reason, now, now,
        JSON.stringify({ check: "category", verdict }), now,
      )
      .run();

    await raiseFlag(c.env.DB, {
      watch_key: "bridge_refusal",
      severity: "medium",
      subject_type: "bridge_handoff",
      subject_id: id,
      summary: `A ${direction} handoff in category "${category}" was refused at the firm boundary.`,
      detail: { reason: verdict.reason, title },
    }, now);

    await audit(c.env.DB, {
      actor: "system", lane: "ops", entityType: "bridge_handoff", entityId: id, action: "refused",
      detail: { direction, category, reason: verdict.reason },
    });
    await logEvent(c.env.DB, {
      level: "warn", scope: "bridge", event: "handoff_refused", entityId: id,
      detail: { direction, category },
    });

    throw conflict(verdict.reason ?? "That category does not cross", "The refusal is on the record, with its reason.");
  }

  /*
   * A category can be allowed and the specific object still not be: restricted
   * memory does not leave the system at all, and the bridge is no exception.
   */
  const checks: { key: string; passed: boolean; detail: string }[] = [
    { key: "category_allowlist", passed: true, detail: `${category} may cross ${direction}.` },
  ];

  if (payloadKind === "memory") {
    const item = await c.env.DB
      .prepare(`SELECT id, sensitivity, retired_at FROM memory_items WHERE id = ?`)
      .bind(payloadRef.replace(/^memory:/, ""))
      .first<{ id: string; sensitivity: string; retired_at: number | null }>();
    if (!item) throw badRequest("No memory with that reference", "The bridge carries a reference to something real.");
    if (item.sensitivity === "restricted" || item.sensitivity === "private") {
      const reason =
        item.sensitivity === "restricted"
          ? "That memory is classed restricted, and restricted content does not leave the system at all."
          : "That memory is classed private. Reclassify it as internal or public if it is genuinely firm material.";
      await c.env.DB
        .prepare(
          `INSERT INTO bridge_handoffs
             (id, direction, category, title, summary, payload_ref, payload_kind, counterparty, status, refusal_reason, requested_at, decided_at, evidence, created_at)
           VALUES (?,?,?,?,?,?,?,?,'refused',?,?,?,?,?)`,
        )
        .bind(
          id, direction, category, title, summary, payloadRef, payloadKind,
          String(b?.counterparty ?? "firm"), reason, now, now,
          JSON.stringify({ check: "payload_sensitivity", sensitivity: item.sensitivity }), now,
        )
        .run();
      await raiseFlag(c.env.DB, {
        watch_key: "bridge_refusal", severity: "high", subject_type: "bridge_handoff", subject_id: id,
        summary: `A ${direction} handoff was refused: the referenced memory is ${item.sensitivity}.`,
        detail: { reason },
      }, now);
      throw conflict(reason, "Classification is what decides this, not the category.");
    }
    checks.push({ key: "payload_sensitivity", passed: true, detail: `The referenced memory is classed ${item.sensitivity}.` });
  }

  // Approved categories still need the Boss. The firm cannot approve its own
  // request, which is the other half of separation.
  const approvalId = newId("apr");
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
         VALUES (?,'ops',?,?,'bridge_handoff','bridge_handoffs',?,'medium',?,'pending',?,?)`,
      )
      .bind(
        approvalId, `${direction === "outbound" ? "Send to" : "Receive from"} the firm: ${title}`,
        summary, id, JSON.stringify({ handoff_id: id, direction, category, payload_ref: payloadRef }),
        now, now + 7 * 24 * 60 * 60 * 1000,
      ),
    c.env.DB
      .prepare(
        `INSERT INTO bridge_handoffs
           (id, direction, category, title, summary, payload_ref, payload_kind, counterparty, status, approval_id, requested_at, evidence, created_at)
         VALUES (?,?,?,?,?,?,?,?,'proposed',?,?,?,?)`,
      )
      .bind(
        id, direction, category, title, summary, payloadRef, payloadKind,
        String(b?.counterparty ?? "firm"), approvalId, now, JSON.stringify({ checks }), now,
      ),
  ]);

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "bridge_handoff", entityId: id, action: "proposed",
    detail: { direction, category, approval_id: approvalId },
  });

  return ok(
    c,
    {
      handoff: await c.env.DB.prepare(`SELECT * FROM bridge_handoffs WHERE id = ?`).bind(id).first(),
      approval_id: approvalId,
      checks,
      note: "Proposed, not crossed. Every crossing is approved in this inbox — the firm cannot approve its own request.",
    },
    201,
  );
});

/** What would happen to this category, without proposing anything. */
bridge.get("/check/:direction/:category", async (c) => {
  const direction = c.req.param("direction") as Direction;
  if (!DIRECTIONS.has(direction)) throw badRequest(`"${direction}" is not a direction`);
  return ok(c, checkCategory(c.req.param("category"), direction));
});
