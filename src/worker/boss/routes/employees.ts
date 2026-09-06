import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { overlappingCharters, type RosterMember } from "@shared/boss/rosterOverlap";

export const employees = new Hono<{ Bindings: Env; Variables: Vars }>();

const LIFECYCLE = ["proposed", "provisional", "active", "under_review", "merged", "retired", "suspended"];

employees.get("/", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT e.*, r.name AS route_name,
              (SELECT COUNT(*) FROM tasks t WHERE t.employee_id = e.id AND t.status IN ('queued','running')) AS open_tasks,
              (SELECT COUNT(*) FROM tasks t WHERE t.employee_id = e.id) AS total_tasks
         FROM employees e LEFT JOIN routes r ON r.id = e.route_id
        WHERE e.lifecycle NOT IN ('retired','merged') ORDER BY e.department, e.created_at`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

employees.get("/:id", async (c) => {
  const id = c.req.param("id");
  const employee = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first();
  if (!employee) throw notFound("No employee with that id");
  const [reviews, recent, spend] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM employee_reviews WHERE employee_id = ? ORDER BY ts DESC LIMIT 10`).bind(id).all(),
    c.env.DB.prepare(`SELECT id, title, status, cost_micros, created_at FROM tasks WHERE employee_id = ? ORDER BY created_at DESC LIMIT 20`).bind(id).all(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(cost_micros),0) AS total FROM usage_ledger WHERE employee_id = ?`).bind(id).first<{ total: number }>(),
  ]);
  /*
   * THE DUTIES SHE OWNS, AND THE DOCUMENTS SHE WORKS FROM.
   *
   * The owner asked two questions that turned out to be the same question: "why cant i click on an
   * employee name or pic and get a read on what they do for me?" and, of the Executive Intelligence
   * Report, "how do i find the input doc? where is that stored?"
   *
   * The charter says what someone is FOR. The duties say when they act without being asked. The
   * spec says what they follow when they do. All three lived somewhere the interface could not
   * reach - the charter behind an endpoint nothing called, and the spec at a repository path that
   * means nothing to anyone without a checkout.
   */
  const duties = await c.env.DB
    .prepare(
      `SELECT id, name, local_hour, local_minute, timezone, cadence, next_due_at, last_run_at,
              suspended, success_criteria, task_input
         FROM standing_duties WHERE employee_id = ? ORDER BY next_due_at`,
    )
    .bind(id)
    .all<{ task_input: string | null }>();

  // The spec paths a duty names, surfaced as data rather than left buried in its input JSON. The
  // reader still cannot open the file from here - it lives in the repository - but she can at least
  // see WHICH document governs the work, which is the question that was actually being asked.
  const specs = new Set<string>();
  for (const d of duties.results ?? []) {
    if (!d.task_input) continue;
    try {
      const parsed = JSON.parse(d.task_input) as { spec?: unknown };
      if (typeof parsed.spec === "string") specs.add(parsed.spec);
    } catch {
      // A malformed input is the duty's problem, not this endpoint's. Skipped rather than thrown:
      // one bad row must not make an employee unreadable.
    }
  }

  return ok(c, {
    employee,
    reviews: reviews.results ?? [],
    recent_tasks: recent.results ?? [],
    lifetime_cost_micros: spend?.total ?? 0,
    duties: duties.results ?? [],
    specs: [...specs],
  });
});

/**
 * Direct hire.
 *
 * The Agent Creation Gate is the governed path — it requires an assessment, a
 * charter, permissions, cost limits, and retirement criteria. This endpoint
 * exists for the seeded first slice and refuses to create an active employee
 * without at least a charter, so nothing joins the roster undefined.
 */
employees.post("/", async (c) => {
  const b = await c.req.json<any>();
  if (!b?.name || !b?.role) throw badRequest("An employee needs a name and a role");
  if (!b?.charter) {
    throw badRequest(
      "An employee needs a charter",
      "Say what it does and what it must never do. Use POST /api/intake/proposals for the governed path.",
    );
  }
  const lane = b.lane === "trading" ? "trading" : "ops";
  const id = newId("emp");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO employees (id, lane, name, role, charter, route_id, autonomy, status, created_at,
                              department, lifecycle, risk_level, budget_micros_day, review_at)
       VALUES (?,?,?,?,?,?,?,'active',?,?,'provisional',?,?,?)`,
    )
    .bind(
      id, lane, b.name, b.role, b.charter,
      b.route_id ?? (lane === "trading" ? "rt_trading_default" : "rt_ops_default"),
      b.autonomy ?? "ask", now, b.department ?? null, b.risk_level ?? "medium",
      b.budget_micros_day ?? 0, now + 30 * 24 * 60 * 60 * 1000,
    )
    .run();
  await audit(c.env.DB, { actor: "boss", lane, entityType: "employee", entityId: id, action: "hired_provisional" });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first(), 201);
});

employees.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>();
  const allowed = [
    "name", "role", "charter", "route_id", "autonomy", "status", "department",
    "lifecycle", "risk_level", "budget_micros_day", "review_at",
  ];
  const fields = allowed.filter((f) => f in b);
  if (!fields.length) throw badRequest("Nothing to change", `Send one of: ${allowed.join(", ")}.`);
  if ("lifecycle" in b && !LIFECYCLE.includes(b.lifecycle)) {
    throw badRequest("That is not a lifecycle state", `Use one of: ${LIFECYCLE.join(", ")}.`);
  }

  const res = await c.env.DB
    .prepare(`UPDATE employees SET ${fields.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`)
    .bind(...fields.map((f) => b[f]), id)
    .run();
  if (!res.meta.changes) throw notFound("No employee with that id");

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "employee", entityId: id, action: "updated", detail: fields,
  });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first());
});

/** Merging is how sprawl gets undone: the duties move, the duplicate retires. */
employees.post("/:id/merge", async (c) => {
  const id = c.req.param("id");
  const { into, note } = await c.req.json<{ into: string; note?: string }>();
  if (!into) throw badRequest("Merging needs a target employee", "Send { into: 'emp_...' }.");
  if (into === id) throw badRequest("An employee cannot merge into itself");

  const [source, target] = await Promise.all([
    c.env.DB.prepare(`SELECT id, lane, name FROM employees WHERE id = ?`).bind(id).first<any>(),
    c.env.DB.prepare(`SELECT id, lane, name FROM employees WHERE id = ?`).bind(into).first<any>(),
  ]);
  if (!source) throw notFound("No employee with that id");
  if (!target) throw badRequest("No employee to merge into");
  if (source.lane !== target.lane) {
    throw conflict("Employees cannot merge across lanes", "Lane isolation is not negotiable.");
  }

  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tasks SET employee_id = ? WHERE employee_id = ? AND status IN ('queued','awaiting_approval')`)
      .bind(into, id),
    c.env.DB.prepare(`UPDATE employees SET lifecycle = 'merged', status = 'retired', merged_into = ? WHERE id = ?`)
      .bind(into, id),
    c.env.DB.prepare(
      `INSERT INTO employee_reviews (id, employee_id, ts, period_start, period_end, outcome, note)
       VALUES (?,?,?,?,?,'merge',?)`,
    ).bind(newId("rev"), id, now, now, now, note ?? `Merged into ${target.name}`),
  ]);

  await audit(c.env.DB, {
    actor: "boss", lane: source.lane, entityType: "employee", entityId: id,
    action: "merged", detail: { into, note },
  });
  return ok(c, { merged: true, from: id, into });
});

/**
 * Agent sprawl check. Reports employees that have earned nothing, reviews that are due, and
 * charters that genuinely say the same thing - so the roster can be pruned deliberately.
 *
 * `duplicate_departments` IS GONE, AND SO IS THE CLAIM IT CARRIED. It was
 * `GROUP BY lane, department HAVING COUNT(*) > 1` - a count of who shares a department - and the
 * Team screen rendered it as "Two employees cover the same ground... Merge one before the roster
 * grows again." On the live roster that accused Chief of Staff and Task Intake, and Model Router
 * and Continuity: four employees who each do a job nobody else does. Continuity keeps the system
 * rebuildable and runs restore drills; Model Router decides where work runs, honouring privacy
 * class and budget. They share a label.
 *
 * Two people in a department is the normal shape of a department. Firing on the normal shape of
 * the thing you watch is the same defect as never firing, and worse when it fires as an accusation
 * with a recommended action - the standing advice was to merge away a job nobody else covers.
 *
 * What replaces it is two separate answers, because they were two different questions all along:
 *   `shared_departments`  - a roster FACT, no verb, no recommendation.
 *   `overlapping_charters` - measured similarity between standing orders, which is the closest
 *                            thing this schema has to what an employee is FOR.
 */
employees.get("/review/sprawl", async (c) => {
  const now = Date.now();
  const [roster, shared, rosterRows, idle, due] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM employees WHERE lifecycle IN ('active','provisional')`).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT lane, department, COUNT(*) AS n, GROUP_CONCAT(name, ', ') AS names
         FROM employees WHERE lifecycle IN ('active','provisional') AND department IS NOT NULL
        GROUP BY lane, department HAVING COUNT(*) > 1`,
    ).all(),
    c.env.DB.prepare(
      `SELECT id, name, lane, department, charter FROM employees
        WHERE lifecycle IN ('active','provisional')`,
    ).all<RosterMember>(),
    c.env.DB.prepare(
      `SELECT e.id, e.name, e.department, e.created_at
         FROM employees e
        WHERE e.lifecycle IN ('active','provisional')
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.employee_id = e.id)
          AND e.created_at < ?`,
    ).bind(now - 14 * 24 * 60 * 60 * 1000).all(),
    c.env.DB.prepare(
      `SELECT id, name, review_at FROM employees
        WHERE lifecycle IN ('active','provisional') AND review_at IS NOT NULL AND review_at <= ?`,
    ).bind(now).all(),
  ]);

  return ok(c, {
    roster_size: roster?.n ?? 0,
    // Stated, not accused. Two employees in one department is a fact about the roster.
    shared_departments: shared.results ?? [],
    // Evidence of actual duplication, or an empty list. Only this one carries a recommendation.
    overlapping_charters: overlappingCharters(rosterRows.results ?? []),
    idle_over_14_days: idle.results ?? [],
    reviews_due: due.results ?? [],
  });
});

/** Records a performance review from real task history. */
employees.post("/:id/review", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>();
  if (!b?.outcome || !["keep", "merge", "retire", "suspend", "watch"].includes(b.outcome)) {
    throw badRequest("A review needs an outcome", "Use keep, merge, retire, suspend, or watch.");
  }
  const employee = await c.env.DB.prepare(`SELECT id, lane FROM employees WHERE id = ?`).bind(id).first<any>();
  if (!employee) throw notFound("No employee with that id");

  const now = Date.now();
  const periodStart = b.period_start ?? now - 30 * 24 * 60 * 60 * 1000;
  const stats = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS run,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              COALESCE(SUM(cost_micros),0) AS cost
         FROM tasks WHERE employee_id = ? AND created_at >= ?`,
    )
    .bind(id, periodStart)
    .first<{ run: number; failed: number; cost: number }>();

  const approvals = await c.env.DB
    .prepare(
      `SELECT SUM(CASE WHEN a.status = 'approved' THEN 1 ELSE 0 END) AS approved, COUNT(*) AS total
         FROM approvals a JOIN tasks t ON t.approval_id = a.id
        WHERE t.employee_id = ? AND a.requested_at >= ?`,
    )
    .bind(id, periodStart)
    .first<{ approved: number | null; total: number }>();

  const rate = approvals?.total ? (approvals.approved ?? 0) / approvals.total : 0;
  const reviewId = newId("rev");

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO employee_reviews
         (id, employee_id, ts, period_start, period_end, tasks_run, tasks_failed, cost_micros, approval_rate, outcome, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      reviewId, id, now, periodStart, now, stats?.run ?? 0, stats?.failed ?? 0,
      stats?.cost ?? 0, rate, b.outcome, b.note ?? null,
    ),
    c.env.DB.prepare(`UPDATE employees SET review_at = ? WHERE id = ?`).bind(now + 30 * 24 * 60 * 60 * 1000, id),
  ];

  if (b.outcome === "retire") {
    statements.push(c.env.DB.prepare(`UPDATE employees SET lifecycle = 'retired', status = 'retired' WHERE id = ?`).bind(id));
  } else if (b.outcome === "suspend") {
    statements.push(c.env.DB.prepare(`UPDATE employees SET lifecycle = 'suspended', status = 'paused' WHERE id = ?`).bind(id));
  } else if (b.outcome === "keep") {
    statements.push(c.env.DB.prepare(`UPDATE employees SET lifecycle = 'active' WHERE id = ? AND lifecycle = 'provisional'`).bind(id));
  } else if (b.outcome === "watch") {
    statements.push(c.env.DB.prepare(`UPDATE employees SET lifecycle = 'under_review' WHERE id = ?`).bind(id));
  }

  await c.env.DB.batch(statements);
  await audit(c.env.DB, {
    actor: "boss", lane: employee.lane, entityType: "employee", entityId: id,
    action: `review_${b.outcome}`, detail: { tasks_run: stats?.run ?? 0, approval_rate: rate },
  });
  await logEvent(c.env.DB, {
    level: "info", scope: "employees", event: "review_recorded", entityId: id, detail: { outcome: b.outcome },
  });

  return ok(c, {
    review_id: reviewId, outcome: b.outcome,
    tasks_run: stats?.run ?? 0, tasks_failed: stats?.failed ?? 0,
    cost_micros: stats?.cost ?? 0, approval_rate: rate,
  }, 201);
});
