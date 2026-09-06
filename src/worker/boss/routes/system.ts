import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";
import { rollBudgetWindows } from "../router/budget";
import { COST_MODES, COST_MODE_POLICY, isCostMode } from "../../shared/governance";

export const system = new Hono<{ Bindings: Env; Variables: Vars }>();

const COUNTED = {
  pending_approvals: `SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'`,
  open_tasks: `SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued','running','awaiting_approval')`,
  failed_tasks: `SELECT COUNT(*) AS n FROM tasks WHERE status = 'failed'`,
  employees: `SELECT COUNT(*) AS n FROM employees WHERE lifecycle IN ('active','provisional')`,
  capture_memories: `SELECT COUNT(*) AS n FROM memory_items WHERE tier = 'capture' AND status = 'active'`,
  canon_memories: `SELECT COUNT(*) AS n FROM memory_items WHERE tier = 'canon' AND status = 'active'`,
  vault_snapshots: `SELECT COUNT(*) AS n FROM vault_snapshots WHERE status = 'complete'`,
  open_orders: `SELECT COUNT(*) AS n FROM trading_orders WHERE status IN ('draft','awaiting_approval','sent')`,
  open_incidents: `SELECT COUNT(*) AS n FROM trading_incidents WHERE resolved_at IS NULL`,
  open_dead_letters: `SELECT COUNT(*) AS n FROM dead_letters WHERE status = 'open'`,
  agent_proposals_pending: `SELECT COUNT(*) AS n FROM agent_proposals WHERE status = 'proposed'`,
};

system.get("/status", async (c) => {
  await rollBudgetWindows(c.env.DB);

  const counts: Record<string, number> = {};
  for (const [key, sql] of Object.entries(COUNTED)) {
    const row = await c.env.DB.prepare(sql).first<{ n: number }>();
    counts[key] = row?.n ?? 0;
  }

  const [lanes, budgets, lastCron, lastSnapshot] = await Promise.all([
    c.env.DB.prepare(`SELECT id, name, isolated FROM lanes ORDER BY id`).all(),
    c.env.DB.prepare(`SELECT * FROM budgets ORDER BY lane, period`).all(),
    c.env.DB.prepare(`SELECT * FROM cron_runs ORDER BY started_at DESC LIMIT 1`).first(),
    c.env.DB.prepare(`SELECT id, ts, status, bytes FROM vault_snapshots ORDER BY ts DESC LIMIT 1`).first(),
  ]);

  const costMode = (await getSetting(c.env.DB, "cost_mode")) ?? "NORMAL";

  return ok(c, {
    version: c.env.BOSS_OS_VERSION,
    phase: "Phases 0–5",
    now: Date.now(),
    lanes: lanes.results ?? [],
    counts,
    budgets: budgets.results ?? [],
    cost_mode: costMode,
    cost_mode_policy: COST_MODE_POLICY[isCostMode(costMode) ? costMode : "NORMAL"],
    last_cron: lastCron,
    last_snapshot: lastSnapshot,
  });
});

/**
 * Deep health check.
 *
 * Touches every binding rather than asserting they exist. Reports what is
 * missing instead of failing on the first problem, so one run tells you
 * everything that needs fixing.
 */
system.get("/health", async (c) => {
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  const check = async (name: string, fn: () => Promise<string>) => {
    try {
      checks.push({ name, ok: true, detail: await fn() });
    } catch (err) {
      checks.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  };

  await check("d1", async () => {
    const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM lanes`).first<{ n: number }>();
    if (!row || row.n === 0) throw new Error("The lanes table is empty. Run the seed migrations.");
    return `${row.n} lanes`;
  });

  await check("d1_migrations", async () => {
    const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM trading_authority`).first<{ n: number }>();
    if (!row?.n) throw new Error("Migration 0004 has not been applied — the trading authority row is missing.");
    return "0001–0004 applied";
  });

  await check("r2_vault", async () => {
    const probe = `health/${newId("hc")}.txt`;
    await c.env.VAULT.put(probe, "ok");
    const got = await c.env.VAULT.get(probe);
    const text = await got?.text();
    await c.env.VAULT.delete(probe);
    if (text !== "ok") throw new Error("Wrote to R2 but could not read the same object back");
    return "read/write ok";
  });

  await check("kv_sessions", async () => {
    const key = `health:${newId("hc")}`;
    await c.env.SESSIONS.put(key, "ok", { expirationTtl: 60 });
    const got = await c.env.SESSIONS.get(key);
    await c.env.SESSIONS.delete(key);
    if (got !== "ok") throw new Error("Wrote to KV but could not read the same key back");
    return "read/write ok";
  });

  await check("queue_binding", async () => {
    if (!c.env.TASKS || typeof c.env.TASKS.send !== "function") {
      throw new Error("The TASKS queue binding is missing. Check wrangler.jsonc.");
    }
    return "bound";
  });

  await check("secrets", async () => {
    const missing: string[] = [];
    if (!c.env.BOSS_PASSCODE) missing.push("BOSS_PASSCODE");
    if (!c.env.SESSION_SECRET) missing.push("SESSION_SECRET");
    if (missing.length) throw new Error(`Missing required secrets: ${missing.join(", ")}`);

    const providers = await c.env.DB
      .prepare(`SELECT id, name, api_key_var FROM providers WHERE enabled = 1`)
      .all<{ id: string; name: string; api_key_var: string }>();
    const unset = (providers.results ?? [])
      .filter((p) => !(c.env as unknown as Record<string, string | undefined>)[p.api_key_var])
      .map((p) => `${p.name} (${p.api_key_var})`);
    if (unset.length) throw new Error(`Enabled providers with no key set: ${unset.join(", ")}`);
    return "required secrets present";
  });

  await check("cron", async () => {
    const last = await c.env.DB
      .prepare(`SELECT started_at, status FROM cron_runs ORDER BY started_at DESC LIMIT 1`)
      .first<{ started_at: number; status: string }>();
    if (!last) throw new Error("The nightly cron has never run here");
    const ageHours = (Date.now() - last.started_at) / 3_600_000;
    if (ageHours > 48) throw new Error(`The last cron run was ${Math.round(ageHours)} hours ago`);
    return `last run ${Math.round(ageHours)}h ago, ${last.status}`;
  });

  const failed = checks.filter((c2) => !c2.ok);
  return ok(c, {
    ok: failed.length === 0,
    version: c.env.BOSS_OS_VERSION,
    checked_at: Date.now(),
    failing: failed.map((f) => f.name),
    checks,
  });
});

// ─── Diagnostics ─────────────────────────────────────────────────────────────

system.get("/diagnostics", async (c) => {
  const level = c.req.query("level");
  const params: unknown[] = [];
  let sql = `SELECT * FROM system_events`;
  if (level) { sql += ` WHERE level = ?`; params.push(level); }
  sql += ` ORDER BY ts DESC LIMIT 200`;
  const [events, crons] = await Promise.all([
    c.env.DB.prepare(sql).bind(...params).all(),
    c.env.DB.prepare(`SELECT * FROM cron_runs ORDER BY started_at DESC LIMIT 10`).all(),
  ]);
  return ok(c, { events: events.results ?? [], cron_runs: crons.results ?? [] });
});

system.get("/dead-letters", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT * FROM dead_letters WHERE status = 'open' ORDER BY ts DESC LIMIT 100`).all();
  return ok(c, rows.results ?? []);
});

/** Puts a dead-lettered task back on the queue after the cause was fixed. */
system.post("/dead-letters/:id/requeue", async (c) => {
  const id = c.req.param("id");
  const dl = await c.env.DB
    .prepare(`SELECT * FROM dead_letters WHERE id = ? AND status = 'open'`).bind(id)
    .first<{ id: string; task_id: string | null; lane: string | null }>();
  if (!dl) throw notFound("No open dead letter with that id");
  if (!dl.task_id) throw conflict("That dead letter has no task to requeue");

  const task = await c.env.DB
    .prepare(`SELECT id, lane FROM tasks WHERE id = ?`).bind(dl.task_id)
    .first<{ id: string; lane: string }>();
  if (!task) throw conflict("The task behind that dead letter no longer exists");

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL WHERE id = ?`).bind(task.id),
    c.env.DB.prepare(`UPDATE dead_letters SET status = 'requeued', resolved_at = ? WHERE id = ?`).bind(Date.now(), id),
  ]);
  await c.env.TASKS.send({ taskId: task.id, lane: task.lane });
  await audit(c.env.DB, { actor: "boss", lane: task.lane, entityType: "task", entityId: task.id, action: "requeued_from_dlq" });
  return ok(c, { requeued: true, task_id: task.id });
});

system.post("/dead-letters/:id/dismiss", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.DB
    .prepare(`UPDATE dead_letters SET status = 'dismissed', resolved_at = ? WHERE id = ? AND status = 'open'`)
    .bind(Date.now(), id)
    .run();
  if (!res.meta.changes) throw notFound("No open dead letter with that id");
  return ok(c, { dismissed: true });
});

// ─── Cost ────────────────────────────────────────────────────────────────────

/** Which lanes, employees, models, and task kinds actually cost money. */
system.get("/cost", async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 30)));
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const [byLane, byEmployee, byModel, byKind, daily, blocked] = await Promise.all([
    c.env.DB.prepare(
      `SELECT lane, COALESCE(SUM(cost_micros),0) AS cost, COUNT(*) AS calls
         FROM usage_ledger WHERE ts >= ? GROUP BY lane ORDER BY cost DESC`,
    ).bind(since).all(),
    c.env.DB.prepare(
      `SELECT u.employee_id, e.name, COALESCE(SUM(u.cost_micros),0) AS cost, COUNT(*) AS calls
         FROM usage_ledger u LEFT JOIN employees e ON e.id = u.employee_id
        WHERE u.ts >= ? AND u.employee_id IS NOT NULL
        GROUP BY u.employee_id ORDER BY cost DESC LIMIT 20`,
    ).bind(since).all(),
    c.env.DB.prepare(
      `SELECT u.model_id, m.display_name, COALESCE(SUM(u.cost_micros),0) AS cost,
              COALESCE(SUM(u.in_tokens),0) AS in_tokens, COALESCE(SUM(u.out_tokens),0) AS out_tokens
         FROM usage_ledger u LEFT JOIN models m ON m.id = u.model_id
        WHERE u.ts >= ? GROUP BY u.model_id ORDER BY cost DESC LIMIT 20`,
    ).bind(since).all(),
    c.env.DB.prepare(
      `SELECT t.intake_kind, COALESCE(SUM(u.cost_micros),0) AS cost, COUNT(DISTINCT t.id) AS tasks
         FROM usage_ledger u JOIN tasks t ON t.id = u.task_id
        WHERE u.ts >= ? AND t.intake_kind IS NOT NULL
        GROUP BY t.intake_kind ORDER BY cost DESC`,
    ).bind(since).all(),
    c.env.DB.prepare(
      `SELECT CAST(ts / 86400000 AS INTEGER) * 86400000 AS day,
              COALESCE(SUM(cost_micros),0) AS cost
         FROM usage_ledger WHERE ts >= ? GROUP BY day ORDER BY day`,
    ).bind(since).all(),
    c.env.DB.prepare(
      `SELECT outcome, COUNT(*) AS n FROM routing_decisions
        WHERE ts >= ? AND outcome != 'routed' GROUP BY outcome ORDER BY n DESC`,
    ).bind(since).all(),
  ]);

  return ok(c, {
    window_days: days,
    by_lane: byLane.results ?? [],
    by_employee: byEmployee.results ?? [],
    by_model: byModel.results ?? [],
    by_intake_kind: byKind.results ?? [],
    daily: daily.results ?? [],
    non_routed_decisions: blocked.results ?? [],
  });
});

system.get("/audit", async (c) => {
  const entity = c.req.query("entity_id");
  const params: unknown[] = [];
  let sql = `SELECT * FROM audit_log`;
  if (entity) { sql += ` WHERE entity_id = ?`; params.push(entity); }
  sql += ` ORDER BY ts DESC LIMIT 100`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return ok(c, rows.results ?? []);
});

system.get("/usage", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT u.*, m.display_name AS model_name FROM usage_ledger u
         LEFT JOIN models m ON m.id = u.model_id
        ORDER BY u.ts DESC LIMIT 100`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

system.get("/settings", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM settings ORDER BY key`).all();
  return ok(c, rows.results ?? []);
});

system.put("/settings/:key", async (c) => {
  const key = c.req.param("key");
  const { value } = await c.req.json<{ value: string }>();

  // Live trading is not a settings toggle. It lives behind the authority
  // envelope, which refuses until every gate is met.
  if (key === "trading_live_enabled" && String(value) === "true") {
    throw conflict(
      "Live trading cannot be switched on from settings",
      "Record the micro-live gates under Trading. This build has no live broker adapter regardless.",
    );
  }
  if (key === "cost_mode" && !COST_MODES.includes(String(value) as never)) {
    throw badRequest("That is not a cost mode", `Use one of: ${COST_MODES.join(", ")}.`);
  }

  await setSetting(c.env.DB, key, String(value));
  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "setting", entityId: key,
    action: "updated", detail: { value: String(value) },
  });
  if (key === "cost_mode") {
    await logEvent(c.env.DB, { level: "warn", scope: "settings", event: "cost_mode_changed", detail: { value } });
  }
  return ok(c, { key, value });
});

system.get("/cost-modes", (c) =>
  ok(c, COST_MODES.map((m) => COST_MODE_POLICY[m])),
);

/** Runs the maintenance cron by hand, for a restore drill or after a fix. */
system.post("/maintenance", async (c) => {
  const rolled = await rollBudgetWindows(c.env.DB);
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "system", action: "maintenance_run" });
  return ok(c, { budget_rows_rolled: rolled });
});
