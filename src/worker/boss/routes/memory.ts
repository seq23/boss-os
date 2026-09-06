import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { isLane } from "../../../shared/boss/lanes";

export const memory = new Hono<{ Bindings: Env; Variables: Vars }>();

const TIERS = ["capture", "working", "canon"] as const;
type Tier = (typeof TIERS)[number];

const SENSITIVITIES = ["public", "internal", "private", "restricted"] as const;

const tierRank = (t: string) => TIERS.indexOf(t as Tier);

memory.get("/", async (c) => {
  const tier = c.req.query("tier");
  const status = c.req.query("status") ?? "active";
  // Retired memory is kept and stops surfacing. Asking for it explicitly is the
  // only way to see it, which is what "stops surfacing" has to mean.
  const retired = c.req.query("retired");
  const params: unknown[] = [status];
  let sql = `SELECT * FROM memory_items WHERE status = ?`;
  if (retired === "only") sql += ` AND retired_at IS NOT NULL`;
  else if (retired !== "include") sql += ` AND retired_at IS NULL`;
  if (tier) { sql += ` AND tier = ?`; params.push(tier); }
  sql += ` ORDER BY created_at DESC LIMIT 200`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return ok(c, rows.results ?? []);
});

memory.get("/rules", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM promotion_rules ORDER BY from_tier`).all();
  return ok(c, rows.results ?? []);
});

memory.get("/events", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT p.*, m.title FROM promotion_events p
         LEFT JOIN memory_items m ON m.id = p.item_id
        ORDER BY p.ts DESC LIMIT 100`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

memory.get("/:id", async (c) => {
  const id = c.req.param("id");
  const item = await c.env.DB.prepare(`SELECT * FROM memory_items WHERE id = ?`).bind(id).first();
  if (!item) throw notFound("No memory with that id");
  const events = await c.env.DB
    .prepare(`SELECT * FROM promotion_events WHERE item_id = ? ORDER BY ts DESC`).bind(id).all();
  return ok(c, { item, events: events.results ?? [] });
});

/**
 * Capture.
 *
 * Everything enters at `capture`. Conversation is not knowledge, so this
 * endpoint refuses to write straight into a promoted tier — the only way up is
 * the gate.
 */
memory.post("/", async (c) => {
  const b = await c.req.json<any>();
  if (!b?.title || !b?.body) throw badRequest("A memory needs a title and a body");
  if (b.tier && b.tier !== "capture") {
    throw conflict(
      "Memory cannot be created above capture",
      "Capture it, then promote it through the gate. Nothing becomes durable memory without approval.",
    );
  }
  const lane = isLane(b.lane) ? b.lane : "ops";
  // The same privacy classes the router already understands. Restricted memory
  // is held like any other and leaves the system like nothing else.
  const sensitivity = b.sensitivity === undefined || b.sensitivity === null ? "private" : String(b.sensitivity);
  if (!SENSITIVITIES.includes(sensitivity as (typeof SENSITIVITIES)[number])) {
    throw badRequest(`"${sensitivity}" is not a sensitivity class`, `One of: ${SENSITIVITIES.join(", ")}.`);
  }
  const id = newId("mem");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO memory_items (id, lane, tier, title, body, source_type, source_id, confidence, created_at, status, sensitivity)
       VALUES (?,?,'capture',?,?,?,?,?,?,'active',?)`,
    )
    .bind(id, lane, b.title, b.body, b.source_type ?? "manual", b.source_id ?? null, b.confidence ?? 0.5, now, sensitivity)
    .run();
  await audit(c.env.DB, { actor: "boss", lane, entityType: "memory", entityId: id, action: "captured" });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM memory_items WHERE id = ?`).bind(id).first(), 201);
});

/** Records that a memory was actually used. Hits are what earn promotion. */
memory.post("/:id/hit", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.DB
    .prepare(`UPDATE memory_items SET hits = hits + 1, last_hit_at = ? WHERE id = ? AND status = 'active'`)
    .bind(Date.now(), id)
    .run();
  if (!res.meta.changes) throw notFound("No active memory with that id");
  return ok(c, await c.env.DB.prepare(`SELECT id, hits, last_hit_at FROM memory_items WHERE id = ?`).bind(id).first());
});

/**
 * Raises one promotion candidate: an approval card and the `promotion_events`
 * row that records why it exists. Nothing moves tier here — the gate does that
 * when the card is approved.
 *
 * Callers outside this file (the meeting capture in Phase 13) use this rather
 * than writing their own pair of inserts, so there stays exactly one shape of
 * promotion candidate in the system.
 */
export async function proposePromotion(
  db: D1Database,
  item: { id: string; lane: string; tier: string; title: string; body: string },
  toTier: string,
  opts: { reason?: string | null; now?: number } = {},
): Promise<{ approval_id: string; promotion_event_id: string; from_tier: string; to_tier: string }> {
  const aprId = newId("apr");
  const eventId = newId("pre");
  const now = opts.now ?? Date.now();
  const reason = opts.reason ?? null;

  await db.batch([
    db.prepare(
      `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
       VALUES (?,?,?,?,'memory_promotion','memory_items',?,'low',?,'pending',?,?)`,
    ).bind(
      aprId, item.lane, `Promote to ${toTier}: ${item.title}`, String(item.body).slice(0, 400), item.id,
      JSON.stringify({ item_id: item.id, to_tier: toTier, reason }), now,
      now + 7 * 24 * 60 * 60 * 1000,
    ),
    db.prepare(
      `INSERT INTO promotion_events (id, item_id, rule_id, ts, from_tier, to_tier, approval_id, outcome, note)
       VALUES (?,?,NULL,?,?,?,?,'proposed',?)`,
    ).bind(eventId, item.id, now, item.tier, toTier, aprId, reason),
  ]);

  return { approval_id: aprId, promotion_event_id: eventId, from_tier: item.tier, to_tier: toTier };
}

/** Asks for a promotion by hand. It still goes through the approval gate. */
memory.post("/:id/promote", async (c) => {
  const id = c.req.param("id");
  const { to_tier, reason } = await c.req.json<{ to_tier: string; reason?: string }>();
  if (!TIERS.includes(to_tier as Tier)) {
    throw badRequest("That is not a memory tier", `Use one of: ${TIERS.join(", ")}.`);
  }
  const item = await c.env.DB
    .prepare(`SELECT * FROM memory_items WHERE id = ?`).bind(id)
    .first<{ id: string; lane: string; tier: string; title: string; body: string; status: string; retired_at: number | null }>();
  if (!item) throw notFound("No memory with that id");
  if (item.status !== "active") throw conflict(`That memory is ${item.status}`);
  if (item.retired_at !== null) {
    throw conflict("That memory is retired", "Restore it first. Promoting something that stopped being true is how canon rots.");
  }
  if (tierRank(to_tier) <= tierRank(item.tier)) {
    throw conflict(
      `That memory is already at ${item.tier}`,
      "Promotion only moves upward. Use the archive path to demote or retire it.",
    );
  }

  const existing = await c.env.DB
    .prepare(
      `SELECT p.id FROM promotion_events p JOIN approvals a ON a.id = p.approval_id
        WHERE p.item_id = ? AND p.outcome = 'proposed' AND a.status = 'pending'`,
    )
    .bind(id)
    .first();
  if (existing) throw conflict("A promotion for this memory is already waiting", "Decide that one first.");

  const proposal = await proposePromotion(c.env.DB, item, to_tier, { reason: reason ?? null });

  await audit(c.env.DB, {
    actor: "boss", lane: item.lane, entityType: "memory", entityId: id,
    action: "promotion_proposed", detail: { to_tier },
  });
  return ok(c, { approval_id: proposal.approval_id, from_tier: item.tier, to_tier }, 201);
});

/**
 * Retirement — canon §45, and the thing the implementation was missing.
 *
 * Retiring is not deleting and not archiving. The memory was true and stopped
 * being true, or stopped being useful; the record stays, its promotion history
 * stays, its filings stay, and it stops surfacing everywhere — lists, surfaces,
 * the Manual, exports and the promotion sweep. Restoring is symmetric, and both
 * are recorded with a reason, because why something stopped being true is often
 * the more valuable knowledge.
 */
memory.post("/:id/retire", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));
  const reason = String(b?.reason ?? "").trim();
  if (!reason) {
    throw badRequest(
      "Retiring a memory needs a reason",
      "Why it stopped being true is usually worth more than the memory was.",
    );
  }

  const item = await c.env.DB
    .prepare(`SELECT id, status, retired_at FROM memory_items WHERE id = ?`).bind(id)
    .first<{ id: string; status: string; retired_at: number | null }>();
  if (!item) throw notFound("No memory with that id");
  if (item.retired_at !== null) throw conflict("That memory is already retired");

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE memory_items SET retired_at = ?, retired_reason = ? WHERE id = ?`).bind(now, reason, id),
    c.env.DB
      .prepare(`INSERT INTO knowledge_retirements (id, item_id, action, ts, reason, actor) VALUES (?,?,'retired',?,?,'boss')`)
      .bind(newId("ret"), id, now, reason),
  ]);

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "memory", entityId: id, action: "retired", detail: { reason } });
  return ok(c, {
    retired: true,
    item: await c.env.DB.prepare(`SELECT * FROM memory_items WHERE id = ?`).bind(id).first(),
    note: "Kept, and no longer surfaced. Regenerate the Manual to drop it from the current version.",
  });
});

memory.post("/:id/unretire", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));
  const now = Date.now();

  const res = await c.env.DB
    .prepare(`UPDATE memory_items SET retired_at = NULL, retired_reason = NULL WHERE id = ? AND retired_at IS NOT NULL`)
    .bind(id)
    .run();
  if (!res.meta.changes) throw conflict("That memory is not retired");

  await c.env.DB
    .prepare(`INSERT INTO knowledge_retirements (id, item_id, action, ts, reason, actor) VALUES (?,?,'restored',?,?,'boss')`)
    .bind(newId("ret"), id, now, b?.reason ? String(b.reason) : null)
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "memory", entityId: id, action: "unretired" });
  return ok(c, { restored: true, item: await c.env.DB.prepare(`SELECT * FROM memory_items WHERE id = ?`).bind(id).first() });
});

/** Archive keeps the record and takes it out of circulation. */
memory.post("/:id/archive", async (c) => {
  const id = c.req.param("id");
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }));
  const now = Date.now();
  const res = await c.env.DB
    .prepare(`UPDATE memory_items SET status = 'archived', archived_at = ? WHERE id = ? AND status = 'active'`)
    .bind(now, id)
    .run();
  if (!res.meta.changes) throw conflict("That memory is not active", "It may already be archived or rejected.");
  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "memory", entityId: id, action: "archived",
    detail: reason ? { reason } : undefined,
  });
  return ok(c, { archived: true, id });
});

memory.post("/:id/restore", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.DB
    .prepare(`UPDATE memory_items SET status = 'active', archived_at = NULL WHERE id = ? AND status = 'archived'`)
    .bind(id)
    .run();
  if (!res.meta.changes) throw conflict("That memory is not archived");
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "memory", entityId: id, action: "unarchived" });
  return ok(c, { restored: true, id });
});

/**
 * Evaluate promotion rules and stage the results.
 *
 * Rules that require approval raise an approval card; the tier only moves when
 * that card is approved. Rules that do not still write a promotion event, so
 * every tier change has a traceable cause. Items with a promotion already
 * pending are skipped rather than stacking duplicate cards each night.
 */
export async function runPromotionSweep(env: Env): Promise<{ promoted: number; proposed: number; skipped: number }> {
  const rules = await env.DB.prepare(`SELECT * FROM promotion_rules WHERE enabled = 1`).all<any>();
  let promoted = 0, proposed = 0, skipped = 0;
  const now = Date.now();

  for (const rule of rules.results ?? []) {
    let cond: any = {};
    try { cond = JSON.parse(rule.condition || "{}"); } catch { cond = {}; }

    const items = await env.DB
      .prepare(
        `SELECT m.* FROM memory_items m
          WHERE m.lane = ? AND m.tier = ? AND m.status = 'active' AND m.retired_at IS NULL
            AND m.hits >= ? AND m.confidence >= ? AND m.created_at <= ?
            AND NOT EXISTS (
              SELECT 1 FROM promotion_events p
               WHERE p.item_id = m.id AND p.outcome = 'proposed'
            )
          LIMIT 100`,
      )
      .bind(
        rule.lane, rule.from_tier, cond.min_hits ?? 0, cond.min_confidence ?? 0,
        now - (cond.min_age_ms ?? 0),
      )
      .all<any>();

    for (const item of items.results ?? []) {
      if (tierRank(rule.to_tier) <= tierRank(item.tier)) { skipped++; continue; }

      if (rule.requires_approval) {
        const aprId = newId("apr");
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
             VALUES (?,?,?,?,'memory_promotion','memory_items',?,'low',?,'pending',?,?)`,
          ).bind(
            aprId, rule.lane, `Promote to ${rule.to_tier}: ${item.title}`,
            String(item.body).slice(0, 400), item.id,
            JSON.stringify({ item_id: item.id, to_tier: rule.to_tier, rule_id: rule.id }),
            now, now + 7 * 24 * 60 * 60 * 1000,
          ),
          env.DB.prepare(
            `INSERT INTO promotion_events (id, item_id, rule_id, ts, from_tier, to_tier, approval_id, outcome)
             VALUES (?,?,?,?,?,?,?,'proposed')`,
          ).bind(newId("pre"), item.id, rule.id, now, rule.from_tier, rule.to_tier, aprId),
        ]);
        proposed++;
      } else {
        await env.DB.batch([
          env.DB.prepare(`UPDATE memory_items SET tier = ?, promoted_at = ? WHERE id = ?`)
            .bind(rule.to_tier, now, item.id),
          env.DB.prepare(
            `INSERT INTO promotion_events (id, item_id, rule_id, ts, from_tier, to_tier, outcome, note)
             VALUES (?,?,?,?,?,?,'applied',?)`,
          ).bind(
            newId("pre"), item.id, rule.id, now, rule.from_tier, rule.to_tier,
            `Rule ${rule.name} applied automatically`,
          ),
          env.DB.prepare(
            `INSERT INTO audit_log (id, ts, actor, lane, entity_type, entity_id, action, detail)
             VALUES (?,?,'system',?,'memory',?,'promoted',?)`,
          ).bind(
            newId("aud"), now, rule.lane, item.id,
            JSON.stringify({ from: rule.from_tier, to: rule.to_tier, rule_id: rule.id }),
          ),
        ]);
        promoted++;
      }
    }
  }

  await logEvent(env.DB, {
    level: "info", scope: "memory", event: "promotion_sweep", detail: { promoted, proposed, skipped },
  });
  return { promoted, proposed, skipped };
}

memory.post("/sweep", async (c) => {
  const result = await runPromotionSweep(c.env);
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "memory", action: "sweep", detail: result });
  return ok(c, result);
});
