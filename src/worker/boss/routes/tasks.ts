import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { classify } from "../intake/classify";
import { admitTask, suggestOwner } from "../tasks/admit";
import { costPolicy } from "../../../shared/boss/governance";

export const tasks = new Hono<{ Bindings: Env; Variables: Vars }>();

tasks.get("/", async (c) => {
  const status = c.req.query("status");
  const params: unknown[] = [];
  let sql = `SELECT t.*, e.name AS employee_name FROM tasks t
               LEFT JOIN employees e ON e.id = t.employee_id`;
  if (status) { sql += ` WHERE t.status = ?`; params.push(status); }
  sql += ` ORDER BY t.created_at DESC LIMIT 100`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return ok(c, rows.results ?? []);
});

tasks.get("/:id", async (c) => {
  const id = c.req.param("id");
  const task = await c.env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first();
  if (!task) throw notFound("No task with that id");
  const [events, evidence, envelope, routing] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM task_events WHERE task_id = ? ORDER BY ts`).bind(id).all(),
    c.env.DB.prepare(`SELECT * FROM evidence_packets WHERE task_id = ? ORDER BY ts DESC`).bind(id).all(),
    c.env.DB.prepare(`SELECT * FROM permission_envelopes WHERE task_id = ?`).bind(id).first(),
    c.env.DB.prepare(`SELECT * FROM routing_decisions WHERE task_id = ? ORDER BY ts DESC`).bind(id).all(),
  ]);
  return ok(c, {
    task,
    events: events.results ?? [],
    evidence: evidence.results ?? [],
    envelope,
    routing: routing.results ?? [],
  });
});

/** Classification preview — what intake would decide, without creating anything. */
tasks.post("/classify", async (c) => {
  const b = await c.req.json<any>();
  if (!b?.title) throw badRequest("Classification needs a title");
  const classification = classify({
    title: b.title, prompt: b.prompt ?? b.input?.prompt ?? null, lane: b.lane ?? "ops",
    intakeKind: b.intake_kind, risk: b.risk, sensitivity: b.sensitivity,
  });
  const suggested = await suggestOwner(c.env, classification.intakeKind, b.lane ?? "ops");
  return ok(c, { classification, suggested });
});

/**
 * Task intake.
 *
 * Every task is classified, given an execution assignment and a permission
 * envelope, and only then queued. USER_ONLY and DEFER work never reaches the
 * queue at all — the system is explicitly allowed to decide that the Boss should
 * do it, or that it should not be done.
 */
tasks.post("/", async (c) => {
  const b = await c.req.json<any>();
  const result = await admitTask(c.env, b);
  if (!result.created) {
    return ok(c, { created: false, classification: result.classification, reason: result.reason }, 200);
  }
  const row = await c.env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(result.task_id).first();
  return ok(c, {
    created: true, task: row, classification: result.classification,
    envelope: result.envelope, cost_mode: costPolicy(result.cost_mode),
  }, 201);
});

/** Requeues a failed or held task by hand. */
tasks.post("/:id/requeue", async (c) => {
  const id = c.req.param("id");
  const task = await c.env.DB
    .prepare(`SELECT id, lane, status FROM tasks WHERE id = ?`).bind(id)
    .first<{ id: string; lane: string; status: string }>();
  if (!task) throw notFound("No task with that id");
  if (task.status === "running") throw conflict("That task is already running");
  if (task.status === "done") throw conflict("That task is already done", "Create a new task instead.");

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL WHERE id = ?`).bind(id),
    c.env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'requeued',NULL)`)
      .bind(newId("tev"), id, now),
  ]);
  await c.env.TASKS.send({ taskId: id, lane: task.lane });
  await audit(c.env.DB, { actor: "boss", lane: task.lane, entityType: "task", entityId: id, action: "requeued" });
  return ok(c, { requeued: true });
});

tasks.post("/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const now = Date.now();
  const res = await c.env.DB
    .prepare(
      `UPDATE tasks SET status = 'cancelled', finished_at = COALESCE(finished_at, ?), error = 'Cancelled by the Boss'
        WHERE id = ? AND status NOT IN ('done','cancelled')`,
    )
    .bind(now, id)
    .run();
  if (!res.meta.changes) throw conflict("That task is already finished or cancelled");
  await c.env.DB
    .prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'cancelled',NULL)`)
    .bind(newId("tev"), id, now)
    .run();
  return ok(c, { cancelled: true });
});

/** Picks the existing employee whose department owns this kind of work. */
