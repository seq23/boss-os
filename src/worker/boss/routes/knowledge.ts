/**
 * Phase 15 — Knowledge OS surfaces.
 *
 * Canon §45's twelve surfaces, typed over the existing memory substrate. Filing
 * a memory onto a surface is a row in `knowledge_items`; the knowledge itself
 * never leaves `memory_items`, so promotion, retirement and the approval gate
 * keep working exactly as they did.
 *
 * Two surfaces are windows onto Phase 14 rather than storage of their own. The
 * Decision Vault and the Prediction Vault already exist; duplicating them here
 * would create a second copy that drifts.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { generateManual } from "../knowledge/manual";
import { exportKnowledge, verifyExport, RESTRICTED_CONFIRMATION } from "../knowledge/export";
import { assertProtectedAction } from "../governance/gate";

export const knowledge = new Hono<{ Bindings: Env; Variables: Vars }>();

const TIER_RANK: Record<string, number> = { capture: 0, working: 1, canon: 2 };

interface SurfaceRow {
  key: string;
  name: string;
  description: string;
  backing: string;
  tier_floor: string;
  surface_order: number;
  in_manual: number;
  offline: number;
}

async function loadSurface(db: D1Database, key: string): Promise<SurfaceRow> {
  const surface = await db.prepare(`SELECT * FROM knowledge_surfaces WHERE key = ?`).bind(key).first<SurfaceRow>();
  if (!surface) throw notFound("No knowledge surface with that key");
  return surface;
}

// ─── Surfaces ─────────────────────────────────────────────────────────────────

knowledge.get("/surfaces", async (c) => {
  const [surfaces, counts, decisions, predictions] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM knowledge_surfaces ORDER BY surface_order`).all<SurfaceRow>(),
    c.env.DB
      .prepare(
        `SELECT k.surface_key, COUNT(*) AS n
           FROM knowledge_items k JOIN memory_items m ON m.id = k.item_id
          WHERE m.status = 'active' AND m.retired_at IS NULL
          GROUP BY k.surface_key`,
      )
      .all<{ surface_key: string; n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM decisions`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM predictions`).first<{ n: number }>(),
  ]);

  const byKey = Object.fromEntries((counts.results ?? []).map((r) => [r.surface_key, r.n]));
  return ok(
    c,
    (surfaces.results ?? []).map((s) => ({
      ...s,
      in_manual: Boolean(s.in_manual),
      offline: Boolean(s.offline),
      items:
        s.backing === "decisions" ? decisions?.n ?? 0
        : s.backing === "predictions" ? predictions?.n ?? 0
        : byKey[s.key] ?? 0,
    })),
  );
});

knowledge.get("/surfaces/:key", async (c) => {
  const surface = await loadSurface(c.env.DB, c.req.param("key"));

  // The two Phase 14 surfaces are read from where the data actually lives.
  if (surface.backing === "decisions") {
    const rows = await c.env.DB
      .prepare(
        `SELECT id, title, kind, stakes, status, committed_at, outcome_recorded_at
           FROM decisions ORDER BY created_at DESC LIMIT 200`,
      )
      .all();
    return ok(c, { surface, backing: "decisions", items: rows.results ?? [], note: "Backed by the Phase 14 Decision Journal. Nothing here is a copy." });
  }
  if (surface.backing === "predictions") {
    const rows = await c.env.DB
      .prepare(
        `SELECT id, statement, probability_bps, status, outcome, resolves_at, resolved_at, brier_bps
           FROM predictions ORDER BY resolves_at DESC LIMIT 200`,
      )
      .all();
    return ok(c, { surface, backing: "predictions", items: rows.results ?? [], note: "Backed by the Phase 14 Prediction Vault. Nothing here is a copy." });
  }

  const includeRetired = c.req.query("retired") === "include";
  const rows = await c.env.DB
    .prepare(
      `SELECT m.id, m.title, m.body, m.tier, m.lane, m.sensitivity, m.hits, m.status,
              m.retired_at, m.retired_reason, k.note, k.filed_at
         FROM knowledge_items k
         JOIN memory_items m ON m.id = k.item_id
        WHERE k.surface_key = ? AND m.status = 'active' ${includeRetired ? "" : "AND m.retired_at IS NULL"}
        ORDER BY k.filed_at DESC LIMIT 200`,
    )
    .bind(surface.key)
    .all();

  return ok(c, { surface: { ...surface, in_manual: Boolean(surface.in_manual), offline: Boolean(surface.offline) }, backing: "memory", items: rows.results ?? [] });
});

/**
 * Files an existing memory onto a surface. It does not create memory: capture
 * remains the only door in, and the promotion gate the only way up.
 */
knowledge.post("/surfaces/:key/items", async (c) => {
  const key = c.req.param("key");
  const b = await c.req.json<any>().catch(() => null);
  const itemId = String(b?.item_id ?? "").trim();
  if (!itemId) throw badRequest("A memory id is required", "Capture it first at POST /api/memory, then file it here.");

  const surface = await loadSurface(c.env.DB, key);
  if (surface.backing !== "memory") {
    throw conflict(
      `${surface.name} is backed by ${surface.backing}`,
      "That surface reads the Phase 14 tables directly. Nothing is filed onto it by hand.",
    );
  }

  const item = await c.env.DB
    .prepare(`SELECT id, tier, status, retired_at FROM memory_items WHERE id = ?`)
    .bind(itemId)
    .first<{ id: string; tier: string; status: string; retired_at: number | null }>();
  if (!item) throw notFound("No memory with that id");
  if (item.status !== "active") throw conflict(`That memory is ${item.status}`);
  if (item.retired_at !== null) throw conflict("That memory is retired", "Restore it first if it is true again.");

  if ((TIER_RANK[item.tier] ?? 0) < (TIER_RANK[surface.tier_floor] ?? 0)) {
    throw conflict(
      `${surface.name} holds ${surface.tier_floor} memory and this is at ${item.tier}`,
      "Promote it through the gate first. A surface that accepts anything is a folder, not a canon.",
    );
  }

  const existing = await c.env.DB
    .prepare(`SELECT id FROM knowledge_items WHERE surface_key = ? AND item_id = ?`)
    .bind(key, itemId)
    .first<{ id: string }>();
  if (existing) throw conflict("That memory is already filed on this surface");

  const id = newId("kni");
  const now = Date.now();
  await c.env.DB
    .prepare(`INSERT INTO knowledge_items (id, surface_key, item_id, note, filed_by, filed_at) VALUES (?,?,?,?,'boss',?)`)
    .bind(id, key, itemId, b?.note === undefined || b?.note === null ? null : String(b.note), now)
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "knowledge_item", entityId: id, action: "filed", detail: { surface: key, item_id: itemId } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM knowledge_items WHERE id = ?`).bind(id).first(), 201);
});

knowledge.post("/surfaces/:key/items/:itemId/remove", async (c) => {
  const key = c.req.param("key");
  const itemId = c.req.param("itemId");
  const res = await c.env.DB
    .prepare(`DELETE FROM knowledge_items WHERE surface_key = ? AND item_id = ?`)
    .bind(key, itemId)
    .run();
  if (!res.meta.changes) throw notFound("That memory is not filed on this surface");

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "knowledge_item", entityId: itemId, action: "unfiled", detail: { surface: key } });
  // Unfiling removes the filing, never the memory.
  return ok(c, { unfiled: true, surface: key, item_id: itemId, memory_kept: true });
});

// ─── The Personal Operating Manual ────────────────────────────────────────────

knowledge.get("/manual", async (c) => {
  const latest = await c.env.DB.prepare(`SELECT * FROM manual_versions ORDER BY version DESC LIMIT 1`).first<any>();
  if (!latest) {
    return ok(c, {
      manual: null,
      note: "The manual has never been generated. It is assembled from promoted memory filed onto the manual surfaces, never typed.",
    });
  }
  return ok(c, {
    manual: { ...latest, sections: JSON.parse(latest.sections), source_item_ids: JSON.parse(latest.source_item_ids) },
  });
});

knowledge.get("/manual/versions", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT id, version, generated_at, item_count, sha256, supersedes_id, note FROM manual_versions ORDER BY version DESC LIMIT 50`)
    .all();
  return ok(c, rows.results ?? []);
});

knowledge.post("/manual/generate", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const manual = await generateManual(c.env.DB, Date.now(), b?.note ?? null);

  if (!manual.unchanged) {
    await audit(c.env.DB, {
      actor: "boss", lane: "ops", entityType: "manual", entityId: manual.id, action: "generated",
      detail: { version: manual.version, items: manual.item_count },
    });
    await logEvent(c.env.DB, { level: "info", scope: "knowledge", event: "manual_generated", entityId: manual.id, detail: { version: manual.version } });
  }

  return ok(c, manual, manual.unchanged ? 200 : 201);
});

// ─── Retirement ───────────────────────────────────────────────────────────────

knowledge.get("/retirements", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT r.*, m.title FROM knowledge_retirements r
         JOIN memory_items m ON m.id = r.item_id
        ORDER BY r.ts DESC LIMIT 100`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

// ─── Export ───────────────────────────────────────────────────────────────────

knowledge.get("/exports", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM knowledge_exports ORDER BY ts DESC LIMIT 50`).all();
  return ok(c, rows.results ?? []);
});

knowledge.post("/exports", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));

  // Canon §18: restricted content leaving the system cannot be recalled, so
  // that export — and only that one — is a protected action.
  if (b?.include_restricted) await assertProtectedAction(c.env, "restricted_export");

  const result = await exportKnowledge(c.env, {
    scope: b?.scope ? String(b.scope) : "all",
    includeRestricted: Boolean(b?.include_restricted),
    confirm: b?.confirm ?? null,
    note: b?.note ?? null,
  });

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "knowledge_export", entityId: result.id, action: "exported",
    detail: {
      scope: result.scope, items: result.item_count,
      restricted_included: result.restricted_included, restricted_excluded: result.restricted_excluded,
    },
  });
  await logEvent(c.env.DB, {
    level: result.restricted_included > 0 ? "warn" : "info",
    scope: "knowledge", event: "knowledge_exported", entityId: result.id,
    detail: { restricted_included: result.restricted_included },
  });

  return ok(c, { ...result, restricted_confirmation: RESTRICTED_CONFIRMATION }, 201);
});

knowledge.get("/exports/:id/verify", async (c) => ok(c, await verifyExport(c.env, c.req.param("id"))));
