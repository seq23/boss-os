import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { draftDuty } from "../duties/author";
import { fileDraft, renderDraft } from "../duties/mailLane";
import { preApprovalIn } from "../../../shared/boss/duties/lane.mjs";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { overlappingCharters, type RosterMember } from "@shared/boss/rosterOverlap";

export const employees = new Hono<{ Bindings: Env; Variables: Vars }>();

const LIFECYCLE = ["proposed", "provisional", "active", "under_review", "merged", "retired", "suspended"];

/**
 * ── THE ROSTER, WITH WHAT EACH SEAT ACTUALLY OWNS ─────────────────────────
 *
 *   "is there an area where i can see all employees pre-set duties?"
 *
 * The detail screen has shown one employee's duties for a while; there was nowhere to see all of
 * them at once, which is the question she was asking. Two things this is honest about that were
 * previously invisible:
 *
 *   · A SEAT WITH NO DUTY IS SHOWN AS AN EMPTY SEAT rather than omitted. Zora has a charter and no
 *     work, and she may want to give her some — this morning she said Simone can hand design work to
 *     a colleague, and Zora is the obvious candidate.
 *   · A DUTY THAT HAS NEVER SUCCEEDED SAYS SO. `duty_practice_week` fired every Sunday for eleven
 *     weeks into a handler that did not exist, and every signal read as success because a duty's
 *     success criterion is that it ran.
 */
employees.get("/roster", async (c) => {
  const now = Date.now();
  const [people, duties] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT id, name, role, department, lane, charter FROM employees
          WHERE lifecycle NOT IN ('retired','merged') ORDER BY department, name`,
      )
      .all<any>(),
    c.env.DB
      .prepare(
        `SELECT id, name, employee_id, cadence, weekday, weekdays, local_hour, local_minute,
                timezone, executor, next_due_at, last_run_at, suspended, suspended_reason,
                success_criteria, task_input, last_outcome, last_outcome_at, last_failure_reason
           FROM standing_duties ORDER BY employee_id, next_due_at`,
      )
      .all<any>(),
  ]);

  const byEmployee = new Map<string, any[]>();
  for (const d of duties.results ?? []) {
    let model: string | null = null;
    let localJob: string | null = null;
    let delivers: string | null = null;
    try {
      const input = JSON.parse(d.task_input ?? "{}");
      model = input?.requested?.model ?? null;
      localJob = input?.local_job ?? null;
      delivers = input?.delivers ?? null;
    } catch {
      // A malformed input is that duty's problem; one bad row must not make the roster unreadable.
    }
    const perRun = model?.includes("sonnet") ? 0.3 : 0.05;
    /*
     * `weekdays` IS PART OF THE CADENCE AND WAS BEING IGNORED. Brokerage sourcing is `daily` with
     * weekdays [1,3,5] — Mon/Wed/Fri — and pricing it as thirty runs a month reported $9 against a
     * real ~$3.90. An over-estimate is not harmless here: it is the number she checks the $25
     * ceiling against, and one that cries wolf gets discounted along with the real ones.
     */
    let days = 0;
    try { days = (JSON.parse(d.weekdays ?? "null") ?? []).length; } catch { days = 0; }
    const runsPerMonth = d.cadence === "daily" ? (days > 0 ? days * 4.3 : 30) : 4.3;
    const perMonth = Math.round(perRun * runsPerMonth * 100) / 100;
    const list = byEmployee.get(d.employee_id) ?? [];
    list.push({
      ...d,
      model,
      /*
       * A DUTY WITH NO MODEL NAMED INHERITS THE MOST EXPENSIVE ONE AVAILABLE. That is what made a
       * single briefing cost $3.88, and it is invisible unless something says it out loud.
       */
      model_warning: model ? null : "This duty names no model, so it runs the most expensive one available.",
      local_job: localJob,
      delivers,
      estimated_per_run_usd: perRun,
      estimated_per_month_usd: perMonth,
      /*
       * NEVER HAVING RUN IS A DIFFERENT FACT FROM RUNNING BADLY, and both are different from being
       * switched off with a reason. All three used to render the same way: as a row.
       */
      state: d.suspended === 1 ? "suspended" : d.last_run_at ? "running" : "never fired",
      overdue: d.suspended !== 1 && d.next_due_at < now - 86_400_000,
    });
    byEmployee.set(d.employee_id, list);
  }

  const roster = (people.results ?? []).map((e: any) => ({
    ...e,
    duties: byEmployee.get(e.id) ?? [],
    /*
     * SAID, NOT IMPLIED BY AN EMPTY LIST. An employee with a charter and no work is a real state and
     * the screen should name it — it is how she decides who to give something to.
     */
    empty_seat: (byEmployee.get(e.id) ?? []).length === 0,
  }));

  const monthly = roster
    .flatMap((e: any) => e.duties)
    .filter((d: any) => d.suspended !== 1)
    .reduce((sum: number, d: any) => sum + d.estimated_per_month_usd, 0);

  return ok(c, {
    intent:
      "Who acts without being asked, when, and what it costs. An empty seat is a person you could " +
      "give something to; a duty that has never fired is one to look at rather than trust.",
    roster,
    monthly_estimate_usd: Math.round(monthly * 100) / 100,
    ceiling_usd: 25,
    empty_seats: roster.filter((e: any) => e.empty_seat).map((e: any) => e.name),
  });
});

/**
 * ── SHE DESCRIBES A DUTY; THIS DRAFTS IT AND PUTS IT TO HER ───────────────
 *
 *   "and i can add duties? and maybe the system can help me prompt that. like for instance if i say
 *    'simone - handle all KDP and ebook publishing stuff' then a proper prompt builds"
 *
 * NOTHING IS CREATED HERE. The draft goes into the Inbox as a judgement call, so she sees the
 * cadence, the model, the cost against the ceiling and the actual prompt before anything exists —
 * and Approve is what creates it, through the same loop as the covers.
 *
 * A DRAFT THAT CANNOT WORK IS REFUSED RATHER THAN RAISED. Every refusal in the draft is an invariant
 * a validator would otherwise catch after the fact, and after the fact means on its first run, at
 * 6am, in front of her.
 */
employees.post("/duties/draft", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const employeeId = String(b?.employee_id ?? "").trim();
  const phrase = String(b?.phrase ?? "").trim();
  if (!employeeId) throw badRequest("Say who owns it", "Send employee_id — the seat this duty belongs to.");
  if (phrase.length < 8) throw badRequest("Say what the duty is", "A phrase like \"every friday, check the LP replies sheet and tell me who went quiet\" is enough; two words is not.");

  const seat = await c.env.DB
    .prepare(`SELECT id, name, role, lane, department FROM employees WHERE id = ?`).bind(employeeId)
    .first<{ id: string; name: string; role: string; lane: string; department: string | null }>();
  if (!seat) throw notFound("No employee with that id");

  if (b?.preview === true) {
    const draft = await draftDuty(c.env, employeeId, phrase, b?.overrides ?? {});
    const draftId = "dd_preview";
    return ok(c, { draft, letter: renderDraft({ draft, draftId, signer: seat }), pre_approved: preApprovalIn(phrase) });
  }

  /*
   * THE SAME FILING AS THE MAIL DOOR. `fileDraft` writes the `duty_drafts` row, refuses a draft
   * that cannot run (a NAMED STOP, nothing in the Inbox), creates at once on a pre-approval phrase
   * in her words, and otherwise raises the `duty_created` judgement call whose Approve creates it
   * — through `raiseJudgementCall`, not a fetch from the Worker to itself.
   */
  const filed = await fileDraft(c.env, {
    employeeId, phrase, overrides: b?.overrides ?? {}, door: "screen", sender: "boss", now: Date.now(),
    preApproved: preApprovalIn(phrase), signer: seat,
  });
  if (filed.state === "refused") {
    throw badRequest("This duty would not work, so it was not raised", filed.draft.refusals.join(" "));
  }
  return ok(c, {
    draft: filed.draft, draft_id: filed.draftId, state: filed.state, judgement_id: filed.judgementId,
    duty_id: filed.created?.id ?? null, first_run_at: filed.created?.first_run_at ?? null, letter: filed.letter,
  }, 201);
});

/**
 * The lane's own record — every draft, whichever door, with its state and what it became. The
 * Duties screen shows the ones waiting on her beside the schedule they would join.
 */
employees.get("/duties/drafts", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT d.id, d.door, d.employee_id, e.name AS employee_name, d.routed_by, d.tag, d.phrase, d.state,
              d.judgement_id, d.approval_id, d.pre_approved_phrase, d.approved_by, d.approved_at, d.held_note,
              d.supersedes, d.duty_id, d.first_run_at, d.refusals_json, d.created_at, d.updated_at
         FROM duty_drafts d LEFT JOIN employees e ON e.id = d.employee_id
        ORDER BY d.created_at DESC LIMIT 50`,
    )
    .all<any>();
  return ok(c, {
    intent: "What you asked for and what it became. A draft waiting on you is in your Inbox and your mail; a refused one names the stop.",
    drafts: (rows.results ?? []).map((r: any) => {
      let refusals: string[] = [];
      try { refusals = JSON.parse(r.refusals_json ?? "[]"); } catch { refusals = []; }
      return { ...r, refusals, refusals_json: undefined };
    }),
    how: "Email boss@sequoiataylor.com with `#<seat> new duty` and the duty in your words, or use Add a duty here. Reply `approved` to create it, `changes: …` to redraft.",
  });
});

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
