import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { badRequest, conflict } from "../lib/http";
import { getSetting } from "../lib/settings";
import { isLane } from "../../../shared/boss/lanes";
import { classify, KIND_TO_DEPARTMENT } from "../intake/classify";
import { buildEnvelope } from "../intake/envelope";

/**
 * TASK INTAKE, IN ONE PLACE, BECAUSE THERE WERE TWO AND ONLY ONE OF THEM WORKED.
 *
 * WHAT WENT WRONG. `POST /api/boss/tasks` classified a task, gave it an execution assignment and a
 * permission envelope, wrote `intake_kind`, and then either queued it or raised an approval.
 * `duties/materialise.ts` — the thing that turns her standing duties into work every morning — did
 * none of that. It ran a bare INSERT with seven columns and stopped.
 *
 * The result is the portfolio's most-named defect wearing its most convincing disguise: RUNS BUT
 * INERT. The duty fired on time, every time. `standing_duties.last_run_at` advanced. A row appeared
 * in `tasks` with status 'queued'. Every observable signal said the system was working, and the
 * Executive Intelligence Report had never once been produced, because nothing was ever sent to the
 * queue — `boss_task_queue` was empty while two tasks sat "queued" since the 6th.
 *
 * `intake_kind` was null on those rows too, which is not cosmetic: the spend report groups by it,
 * the capability metrics filter on it, and the router uses it to decide which backend may take the
 * work. A task with no kind is invisible to all three.
 *
 * THE FIX IS NOT TO ADD A `TASKS.send()` TO MATERIALISE. That would leave two intake paths that
 * have to be kept in step by whoever notices next — "two components each keeping their own list
 * with no link", which is how this happened in the first place. Both callers now go through here,
 * so a task created by a duty is indistinguishable from one created by hand.
 */

export interface AdmitInput {
  title: string;
  lane?: string;
  input?: Record<string, unknown>;
  employee_id?: string | null;
  template_id?: string | null;
  intake_kind?: string | null;
  risk?: string | null;
  sensitivity?: string | null;
  cost_mode?: string | null;
}

export interface AdmitResult {
  created: boolean;
  task_id: string | null;
  classification: ReturnType<typeof classify>;
  /** Present only when a task was actually created. */
  envelope?: { id: string; budget_micros: number };
  /** Whether it reached the queue, or is waiting on a person. */
  queued: boolean;
  cost_mode: string;
  reason?: string;
}

/** The first active employee that fits the kind, then the lane, then nobody. */
export async function suggestOwner(
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

/**
 * Admit one task: classify it, own it, envelope it, and then either queue it or raise the approval.
 *
 * Throws the same `AppError`s the route threw, so the HTTP behaviour is unchanged — they carry
 * their own status codes and are handled by the error middleware wherever they are raised.
 */
export async function admitTask(env: Env, b: AdmitInput): Promise<AdmitResult> {
  if (!b?.title) throw badRequest("A task needs a title", "Send { title, lane, input }.");
  const lane = isLane(b.lane) ? b.lane : "ops";
  const input = b.input ?? {};

  let templateId: string | null = null;
  let intakeKind = b.intake_kind ?? null;
  let employeeHint = b.employee_id ?? null;

  if (b.template_id) {
    const tpl = await env.DB
      .prepare(`SELECT id, lane, intake_kind, owner_employee_id, approval_rule FROM task_templates WHERE id = ? AND enabled = 1`)
      .bind(b.template_id)
      .first<{ id: string; lane: string; intake_kind: string; owner_employee_id: string | null; approval_rule: string }>();
    if (!tpl) throw badRequest("No enabled template with that id", "List templates at GET /api/intake/templates.");
    templateId = tpl.id;
    if (!intakeKind) intakeKind = tpl.intake_kind;
    if (!employeeHint) employeeHint = tpl.owner_employee_id;
  }

  const classification = classify({
    title: b.title, prompt: (input.prompt as string | undefined) ?? null, lane,
    intakeKind: intakeKind ?? undefined, risk: b.risk ?? undefined, sensitivity: b.sensitivity ?? undefined,
  });

  const employeeId: string | null =
    employeeHint ?? (await suggestOwner(env, classification.intakeKind, lane))?.id ?? null;

  if (employeeId) {
    const emp = await env.DB
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
  const costMode = b.cost_mode ?? (await getSetting(env.DB, "cost_mode")) ?? "NORMAL";
  const assignment = classification.executionAssignment;

  // DELETE is a real answer: the system is allowed to refuse fake work.
  if (assignment === "DELETE") {
    await audit(env.DB, {
      actor: "system", lane, entityType: "task", action: "refused",
      detail: { title: b.title, reason: classification.reason },
    });
    return { created: false, task_id: null, classification, queued: false, cost_mode: costMode, reason: classification.reason };
  }

  const queued = assignment === "AI_DRAFT" || assignment === "AI_EXECUTE_WITH_APPROVAL" ||
                 assignment === "AI_EXECUTE_WITH_NOTICE";
  const status = queued ? "queued" : "awaiting_approval";

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tasks (id, lane, employee_id, title, input, status, created_at,
                          intake_kind, template_id, execution_assignment, risk, sensitivity, cost_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id, lane, employeeId, b.title, Object.keys(input).length ? JSON.stringify(input) : null,
      status, now, classification.intakeKind, templateId, assignment,
      classification.risk, classification.sensitivity, costMode,
    ),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'intake',?)`)
      .bind(newId("tev"), id, now, JSON.stringify(classification)),
  ]);

  const envelope = await buildEnvelope(env.DB, { taskId: id, lane, employeeId, classification, costMode });
  await env.DB.prepare(`UPDATE tasks SET envelope_id = ? WHERE id = ?`).bind(envelope.id, id).run();

  if (queued) {
    await env.TASKS.send({ taskId: id, lane });
  } else {
    // USER_ONLY, HUMAN_CONTRACTOR, and DEFER surface as a decision, not a run.
    const aprId = newId("apr");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
         VALUES (?,?,?,?,'manual','tasks',?,?,?,'pending',?,?)`,
      ).bind(
        aprId, lane, b.title,
        `Intake assigned this ${assignment}. ${classification.reason}`,
        id, classification.risk, JSON.stringify({ task_id: id, assignment }), now,
        now + 7 * 24 * 60 * 60 * 1000,
      ),
      env.DB.prepare(`UPDATE tasks SET approval_id = ? WHERE id = ?`).bind(aprId, id),
    ]);
  }

  await audit(env.DB, {
    actor: "boss", lane, entityType: "task", entityId: id, action: "intake",
    detail: { kind: classification.intakeKind, assignment, risk: classification.risk },
  });
  await logEvent(env.DB, {
    level: "info", scope: "intake", event: "task_admitted", lane, entityId: id,
    detail: { kind: classification.intakeKind, assignment, cost_mode: costMode, budget_micros: envelope.budget_micros },
  });

  return { created: true, task_id: id, classification, envelope, queued, cost_mode: costMode };
}
