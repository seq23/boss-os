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

/**
 * HAND A PIECE OF WORK TO A COLLEAGUE.
 *
 * ─── The capability that did not exist ─────────────────────────────────────
 *
 * Grep the repository for a statement that changes `tasks.employee_id` and, before this route, you
 * find exactly one: inside employee MERGE, in `routes/employees.ts`. So when she wrote "Route this
 * to whomever should handle this" on 12 September 2026, there was no mechanism behind the sentence.
 * The task sat on the Chief of Staff's desk because that is where untagged mail lands, and nothing
 * could move it.
 *
 * ─── The destination comes from the roster, and the reason is required ─────
 *
 * `employee_id` must name an ACTIVE seat read out of `employees` at the moment of the handoff, which
 * is what keeps this from becoming a second list of who works here. And `reason` is not optional:
 * a task that changed hands with no recorded why is a task nobody can account for later, and the
 * `audit_log` row is the whole point of doing this through an endpoint rather than an UPDATE.
 */
tasks.post("/:id/handoff", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));
  const to = String(b?.employee_id ?? "").trim();
  const reason = String(b?.reason ?? "").trim();
  if (!to) throw badRequest("A handoff needs an employee_id", "Read the roster from GET /api/boss/employees.");
  if (!reason) {
    throw badRequest(
      "A handoff needs a reason",
      "One sentence. A task that changed hands with no recorded why cannot be accounted for later.",
    );
  }

  const task = await c.env.DB
    .prepare(`SELECT id, lane, status, employee_id FROM tasks WHERE id = ?`).bind(id)
    .first<{ id: string; lane: string; status: string; employee_id: string | null }>();
  if (!task) throw notFound("No task with that id");
  if (task.status === "done" || task.status === "cancelled") {
    throw conflict("That task is already finished", "Open a new task for the colleague instead.");
  }

  /*
   * THE SEAT IS READ, NEVER ASSUMED. A retired or merged employee is not a destination: handing work
   * to a desk nobody sits at is the same as losing it, and it would look exactly like it worked.
   */
  const seat = await c.env.DB
    .prepare(
      `SELECT id, name, role, lane FROM employees
        WHERE id = ? AND status = 'active' AND lifecycle IN ('active','provisional')`,
    )
    .bind(to)
    .first<{ id: string; name: string; role: string; lane: string }>();
  if (!seat) throw badRequest(`${to} is not an active employee`, "Only an active seat can take work.");
  if (seat.id === task.employee_id) throw conflict("That task is already on that desk");

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tasks SET employee_id = ? WHERE id = ?`).bind(seat.id, id),
    c.env.DB
      .prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'handed_off',?)`)
      .bind(newId("tev"), id, now, JSON.stringify({ from: task.employee_id, to: seat.id, reason })),
  ]);
  await audit(c.env.DB, {
    actor: "boss", lane: task.lane, entityType: "task", entityId: id, action: "handed_off",
    detail: { from: task.employee_id, to: seat.id, to_name: seat.name, reason },
  });
  return ok(c, { handed_off: true, task_id: id, employee_id: seat.id, employee_name: seat.name, reason });
});

/**
 * THE HUNT CAME BACK — the other half of `input.hunt`.
 *
 * `buyer-hunt.mjs --from-boss` runs on her Mac, because the work is SEC full-text search plus eight
 * XML filings per name plus her local ledger, none of which exists in a Worker. This is where the
 * result lands, and it exists so that a hunt that RAN cannot leave the task that asked for it
 * sitting `queued` for ever — "exists but nothing closes it" is the same lost work in a new place.
 *
 * The task is finished here rather than left open: the deliverable is the list, the list is on the
 * card, and she was emailed it. A queued task nobody will ever pick up again is not a to-do, it is
 * noise on a screen she reads every morning.
 */
tasks.post("/:id/hunt-result", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));
  const result = String(b?.result ?? "").trim();
  if (!result) throw badRequest("A hunt result needs the list it produced", "An empty result is not an outcome.");

  const task = await c.env.DB
    .prepare(`SELECT id, lane, status, input FROM tasks WHERE id = ?`).bind(id)
    .first<{ id: string; lane: string; status: string; input: string }>();
  if (!task) throw notFound("No task with that id");

  /*
   * ONLY A TASK THAT ASKED FOR ONE. Without this, any task could be closed by posting a paragraph at
   * it, and `input.hunt` is the whole record that this piece of work was a hunt in the first place.
   */
  let hunt: unknown = null;
  try { hunt = JSON.parse(task.input ?? "{}")?.hunt ?? null; } catch { hunt = null; }
  if (!hunt) throw conflict("That task did not ask for a hunt", "Only a task carrying input.hunt can take a hunt result.");

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `UPDATE tasks SET status = 'done', finished_at = COALESCE(finished_at, ?),
                          output = ? WHERE id = ? AND status NOT IN ('cancelled')`,
      )
      .bind(now, JSON.stringify({ text: result, model: "buyer-hunt.mjs on her Mac — SEC N-PORT and her own ledger, no model" }), id),
    c.env.DB
      .prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'hunt_ran',?)`)
      .bind(newId("tev"), id, now, JSON.stringify({ asset: b?.asset ?? null, side: b?.side ?? null, size_usd: b?.size_usd ?? null, bytes: result.length })),
  ]);
  await audit(c.env.DB, {
    actor: "boss", lane: task.lane, entityType: "task", entityId: id, action: "hunt_ran",
    detail: { asset: b?.asset ?? null, side: b?.side ?? null, size_usd: b?.size_usd ?? null },
  });
  return ok(c, { recorded: true, task_id: id });
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
