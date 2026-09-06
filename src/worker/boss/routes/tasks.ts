import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { getSetting } from "../lib/settings";
import { isLane } from "../../../shared/boss/lanes";
import { classify, KIND_TO_DEPARTMENT } from "../intake/classify";
import { buildEnvelope } from "../intake/envelope";
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
  if (!b?.title) throw badRequest("A task needs a title", "Send { title, lane, input }.");
  const lane = isLane(b.lane) ? b.lane : "ops";
  const input = b.input ?? {};

  let templateId: string | null = null;
  if (b.template_id) {
    const tpl = await c.env.DB
      .prepare(`SELECT id, lane, intake_kind, owner_employee_id, approval_rule FROM task_templates WHERE id = ? AND enabled = 1`)
      .bind(b.template_id)
      .first<{ id: string; lane: string; intake_kind: string; owner_employee_id: string | null; approval_rule: string }>();
    if (!tpl) throw badRequest("No enabled template with that id", "List templates at GET /api/intake/templates.");
    templateId = tpl.id;
    if (!b.intake_kind) b.intake_kind = tpl.intake_kind;
    if (!b.employee_id) b.employee_id = tpl.owner_employee_id;
  }

  const classification = classify({
    title: b.title, prompt: input.prompt ?? null, lane,
    intakeKind: b.intake_kind, risk: b.risk, sensitivity: b.sensitivity,
  });

  const employeeId: string | null =
    b.employee_id ?? (await suggestOwner(c.env, classification.intakeKind, lane))?.id ?? null;

  if (employeeId) {
    const emp = await c.env.DB
      .prepare(`SELECT id, lane, lifecycle FROM employees WHERE id = ?`).bind(employeeId)
      .first<{ id: string; lane: string; lifecycle: string }>();
    if (!emp) throw badRequest("No employee with that id");
    if (emp.lane !== lane) {
      throw conflict(
        `${emp.id} belongs to the ${emp.lane} lane, not ${lane}`,
        "Lanes are isolated. Pick an employee from the same lane.",
      );
    }
    if (["retired", "suspended", "merged"].includes(emp.lifecycle ?? "active")) {
      throw conflict(`That employee is ${emp.lifecycle}`, "Reinstate it in Team, or pick another.");
    }
  }

  const id = newId("tsk");
  const now = Date.now();
  const costMode = b.cost_mode ?? (await getSetting(c.env.DB, "cost_mode")) ?? "NORMAL";
  const assignment = classification.executionAssignment;

  // DELETE is a real answer: the system is allowed to refuse fake work.
  if (assignment === "DELETE") {
    await audit(c.env.DB, {
      actor: "system", lane, entityType: "task", action: "refused",
      detail: { title: b.title, reason: classification.reason },
    });
    return ok(c, { created: false, classification, reason: classification.reason }, 200);
  }

  const queued = assignment === "AI_DRAFT" || assignment === "AI_EXECUTE_WITH_APPROVAL" ||
                 assignment === "AI_EXECUTE_WITH_NOTICE";
  const status = queued ? "queued" : "awaiting_approval";

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO tasks (id, lane, employee_id, title, input, status, created_at,
                          intake_kind, template_id, execution_assignment, risk, sensitivity, cost_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id, lane, employeeId, b.title, Object.keys(input).length ? JSON.stringify(input) : null,
      status, now, classification.intakeKind, templateId, assignment,
      classification.risk, classification.sensitivity, costMode,
    ),
    c.env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'intake',?)`)
      .bind(newId("tev"), id, now, JSON.stringify(classification)),
  ]);

  const envelope = await buildEnvelope(c.env.DB, {
    taskId: id, lane, employeeId, classification, costMode,
  });
  await c.env.DB.prepare(`UPDATE tasks SET envelope_id = ? WHERE id = ?`).bind(envelope.id, id).run();

  if (queued) {
    await c.env.TASKS.send({ taskId: id, lane });
  } else {
    // USER_ONLY, HUMAN_CONTRACTOR, and DEFER surface as a decision, not a run.
    const aprId = newId("apr");
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
         VALUES (?,?,?,?,'manual','tasks',?,?,?,'pending',?,?)`,
      ).bind(
        aprId, lane, b.title,
        `Intake assigned this ${assignment}. ${classification.reason}`,
        id, classification.risk, JSON.stringify({ task_id: id, assignment }), now,
        now + 7 * 24 * 60 * 60 * 1000,
      ),
      c.env.DB.prepare(`UPDATE tasks SET approval_id = ? WHERE id = ?`).bind(aprId, id),
    ]);
  }

  await audit(c.env.DB, {
    actor: "boss", lane, entityType: "task", entityId: id, action: "intake",
    detail: { kind: classification.intakeKind, assignment, risk: classification.risk },
  });
  await logEvent(c.env.DB, {
    level: "info", scope: "intake", event: "task_admitted", lane, entityId: id,
    detail: { kind: classification.intakeKind, assignment, cost_mode: costMode, budget_micros: envelope.budget_micros },
  });

  const row = await c.env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first();
  return ok(c, { created: true, task: row, classification, envelope, cost_mode: costPolicy(costMode) }, 201);
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
async function suggestOwner(
  env: Env, intakeKind: string, lane: string,
): Promise<{ id: string; name: string } | null> {
  const department = KIND_TO_DEPARTMENT[intakeKind as keyof typeof KIND_TO_DEPARTMENT];
  if (department) {
    const byDept = await env.DB
      .prepare(
        `SELECT id, name FROM employees
          WHERE lane = ? AND department = ? AND lifecycle IN ('active','provisional') AND status = 'active'
          ORDER BY created_at LIMIT 1`,
      )
      .bind(lane, department)
      .first<{ id: string; name: string }>();
    if (byDept) return byDept;
  }
  return env.DB
    .prepare(
      `SELECT id, name FROM employees
        WHERE lane = ? AND lifecycle IN ('active','provisional') AND status = 'active'
        ORDER BY created_at LIMIT 1`,
    )
    .bind(lane)
    .first<{ id: string; name: string }>();
}
