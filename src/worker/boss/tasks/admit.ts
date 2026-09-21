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
  /**
   * `public_model_approved` or `private_model_only`. WHICH MODELS MAY SEE THE INPUT.
   * Omitted means the classifier decides; see `intake/classify.ts`.
   */
  model_access?: string | null;
  /** `internal` or `external`. WHO MAY RECEIVE THE OUTPUT. It never reaches the router. */
  audience?: string | null;
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

  /*
   * ─── "#danielle <grid repo> <drive folder> <instructions>" IS A REPO CHANGE ────────────
   *
   * Plan B, 20 Sep 2026. On Danielle's desk only, and only when the words name a grid repo or a
   * Drive folder: the task becomes a repo change — `input.repo_change` on the card, a `repo_changes`
   * row for the lane's state — and its kind is `repository`, the kind the classifier already keeps
   * behind approval. Her reply to the plan is that approval. A message naming a repo the grid
   * EXCLUDES (West Peek, a client micro-site) is refused here with the grid's own reason, so the
   * mailbox tells her why instead of quietly opening ordinary work on a request that plainly
   * asked for a change to a repository this desk may not touch.
   *
   * Every door passes through here — mail, Team → New task, the API — so the shape is one shape.
   */
  const { parseRepoChange, REPO_CHANGE_SEAT } = await import("../../../shared/boss/repoChange/lane.mjs");
  const repoChange = employeeHint === REPO_CHANGE_SEAT && !(input.repo_change && typeof input.repo_change === "object")
    ? parseRepoChange([b.title, input.body as string | undefined, input.prompt as string | undefined].filter(Boolean).join("\n"))
    : null;
  if (repoChange && "excluded" in repoChange) {
    throw badRequest(
      `${repoChange.excluded.repo} is out of scope for Danielle: ${repoChange.excluded.why}`,
      "Name a repository from the grid, or a Drive folder for one of them.",
    );
  }
  const change = repoChange && !("excluded" in repoChange) ? repoChange : null;
  const changeId = change ? newId("rc") : null;
  if (change && changeId) {
    (input as Record<string, unknown>).repo_change = {
      change_id: changeId, repo: change.repo, property: change.property,
      drive_folder: change.drive_folder, drive_url: change.drive_url,
    };
    if (!intakeKind) intakeKind = "repository";
  }

  const classification = classify({
    title: b.title, prompt: (input.prompt as string | undefined) ?? null, lane,
    intakeKind: intakeKind ?? undefined, risk: b.risk ?? undefined, sensitivity: b.sensitivity ?? undefined,
    model_access: b.model_access ?? undefined, audience: b.audience ?? undefined,
  });

  /*
   * ─── "FIND FIRMS THAT DID X AND DRAFT THE ASK" IS ONE SHAPE OF WORK, ON EVERY DOOR ─────────
   *
   * Her instruction of 19 Sep 2026 — "find me a list of firms that have reported IPO participation
   * … and draft an email for me to ask if I can send investors to them" — used to reach a cloud
   * rung as free text and come back as a paragraph promising to look. `parseFirmScan` is a grammar
   * that recognises the shape here, at the one point every door passes through, so Team → New
   * task, the mail intake and the API all produce the same work: a `ask_scans` row owned by
   * Camille, run by `research/firmScan.ts`. A sentence the grammar cannot read is untouched.
   */
  const { parseFirmScan } = await import("../research/firmScan");
  const firmScan = input.firm_scan && typeof input.firm_scan === "object"
    ? null
    : parseFirmScan([b.title, input.prompt as string | undefined, input.body as string | undefined]);
  const scanId = firmScan ? newId("fsc") : null;
  if (firmScan && scanId) {
    (input as Record<string, unknown>).firm_scan = { scan_id: scanId, find: firmScan.find, ask: firmScan.ask };
    if (!employeeHint) employeeHint = "emp_research";
  }

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
                          intake_kind, template_id, execution_assignment, risk, sensitivity,
                          model_access, audience, cost_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id, lane, employeeId, b.title, Object.keys(input).length ? JSON.stringify(input) : null,
      status, now, classification.intakeKind, templateId, assignment,
      classification.risk, classification.sensitivity,
      // THE TWO AXES LAND ON THE ROW, so the card says what it is rather than leaving the router to
      // re-derive it from the prompt every time. The router still scans; this is the declaration
      // the scan corroborates.
      classification.modelAccess, classification.audience, costMode,
    ),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'intake',?)`)
      .bind(newId("tev"), id, now, JSON.stringify(classification)),
  ]);

  if (firmScan && scanId) {
    await env.DB
      .prepare(
        `INSERT INTO ask_scans (id, task_id, instruction, find_text, ask_text, state, requested_at, updated_at)
         VALUES (?,?,?,?,?,'queued',?,?)`,
      )
      .bind(scanId, id, firmScan.raw, firmScan.find, firmScan.ask, now, now)
      .run();
  }

  if (change && changeId) {
    await env.DB
      .prepare(
        `INSERT INTO repo_changes (id, task_id, mail_id, repo, property_key, drive_folder, drive_url, instruction, phase, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,'plan',?,?)`,
      )
      .bind(
        changeId, id, typeof input.mail_id === "string" ? input.mail_id : null,
        change.repo, change.property, change.drive_folder, change.drive_url,
        change.instruction, now, now,
      )
      .run();
  }

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
