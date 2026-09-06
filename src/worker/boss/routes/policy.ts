import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { classify, tighten, AirlockRefusal } from "../policy/airlock";
import { localModelStatus } from "../continuity/sovereignty";

/**
 * Batch 8 — making the airlock legible.
 *
 * The plan asks for clear status on where a record lives, whether it may sync, whether an external
 * model may see it, what the local runtime is doing, and which provider is selected — and says the
 * boundary must be legible "without creating daily friction". Those two pull against each other,
 * and the resolution is that this surface ANSWERS rather than warns: it is somewhere you look, not
 * something that interrupts you. A banner on every screen would be read for a week and then not at
 * all, which is worse than no banner because it looks like protection.
 *
 * Nothing here can change residency. There is a tighten path and no loosen path, for the same
 * reason as in the airlock itself: loosening is a data-movement decision, not a setting.
 */
export const policy = new Hono<{ Bindings: Env; Variables: Vars }>();

policy.get("/overview", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT entity, subsystem, residency, ai_processing, merge_policy, reason
         FROM data_policy ORDER BY residency DESC, subsystem, entity`,
    )
    .all<any>();
  const all = rows.results ?? [];

  const local = await localModelStatus(c.env.DB).catch(() => null);
  const provider = await c.env.DB
    .prepare(`SELECT p.name, p.enabled FROM providers p ORDER BY p.enabled DESC LIMIT 1`)
    .first<{ name: string; enabled: number }>()
    .catch(() => null);
  const overrides = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM record_policy`).first<{ n: number }>();
  const devices = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active FROM sync_device`)
    .first<{ n: number; active: number }>();
  const conflicts = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM sync_conflict WHERE resolution = 'OPEN'`).first<{ n: number }>();

  return ok(c, {
    counts: {
      entities: all.length,
      local_only: all.filter((r: any) => r.residency === "LOCAL_ONLY").length,
      ai_local_only: all.filter((r: any) => r.ai_processing === "LOCAL_ONLY").length,
      ai_needs_approval: all.filter((r: any) => r.ai_processing === "EXTERNAL_WITH_APPROVAL").length,
      record_overrides: overrides?.n ?? 0,
    },
    /*
     * The private compute answer is honest rather than encouraging. No local runtime exists on this
     * deployment, so it says so — and says what would make it true — instead of reporting a state
     * that reads like readiness.
     */
    private_compute: local ?? {
      registered: false,
      status: "UNKNOWN",
      detail: "The local model status could not be read.",
    },
    provider_selected: provider ? { name: provider.name, enabled: Boolean(provider.enabled) } : null,
    sync: {
      devices: devices?.n ?? 0,
      devices_active: devices?.active ?? 0,
      open_conflicts: conflicts?.n ?? 0,
    },
    entities: all,
  });
});

/** What governs one record, so a screen can say it beside the thing itself. */
policy.get("/for/:entity", async (c) => {
  const recordId = c.req.query("record_id") ?? null;
  const c1 = await classify(c.env.DB, c.req.param("entity"), recordId);
  return ok(c, {
    entity: c.req.param("entity"),
    record_id: recordId,
    ...c1,
    stays_here: c1.residency === "LOCAL_ONLY",
    external_ai: c1.ai_processing,
  });
});

/**
 * Tighten one record. There is deliberately no endpoint that loosens one.
 */
policy.post("/tighten", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b?.entity || !b?.record_id) throw badRequest("Tightening needs entity and record_id");
  if (!b?.reason) throw badRequest("Tightening needs a reason", "It is what somebody reads when they wonder why this one is different.");
  try {
    const after = await tighten(c.env.DB, {
      entity: String(b.entity),
      recordId: String(b.record_id),
      residency: b.residency,
      ai_processing: b.ai_processing,
      reason: String(b.reason),
      by: String(b.by ?? "owner"),
    });
    return ok(c, after);
  } catch (err) {
    if (err instanceof AirlockRefusal) throw badRequest((err as Error).message);
    throw err;
  }
});
