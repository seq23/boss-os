import type { Env } from "../env";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { nextDueAt } from "./cadence";
import { DELIVERABLE_KEYS, existingDuties, type DutyDraft } from "./author";
import { dutyProblems } from "../../../shared/boss/duties/lane.mjs";

/**
 * THE ONE PLACE A DUTY ROW IS BORN AT RUNTIME.
 *
 * ─── Why one function ─────────────────────────────────────────────────────
 *
 * Every standing duty before today was written by a migration. The duty lane creates them from
 * her sentence, and a row that can be created from a sentence can be created wrongly — no owner,
 * no model, a script that does not exist, a delivery key nothing handles. Every one of those is a
 * duty that fires on time and does nothing, which is the defect this repository produces most.
 *
 * So there is exactly one `INSERT INTO standing_duties` in the Worker, it is here, and it runs the
 * owner ↔ executor ↔ script check (`dutyProblems`, the shared lane's one rule) before the write.
 * `validate:duty-birth` pins that no second INSERT appears anywhere under `src/worker`, that this
 * function is reached only from the approval loop (`duty_created` in `approvals/resume.ts`) or
 * from a recorded pre-approval (the mail lane, phrase on the row), and that the check sits above
 * the write.
 *
 * ─── Provenance is a column, not a comment ────────────────────────────────
 *
 * `authored_from` on the duty's input says which door and which approval created it, so a duty
 * with nobody's word behind it is not merely unlikely but visible.
 */

export interface DutyProvenance {
  /** Her address, or "boss" from the Inbox button. */
  approved_by: string;
  /** How her yes arrived. */
  via: "inbox" | "mail" | "pre_approved" | "screen";
  /** The pre-approval phrase from her ORIGINAL request, when `via` is pre_approved. */
  phrase?: string | null;
  judgement_id?: string | null;
  draft_id?: string | null;
  mail_id?: string | null;
}

export interface CreatedDuty {
  id: string;
  first_run_at: number;
}

export class DutyCannotRun extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(`This duty cannot run, so it was not created: ${problems.join(" ")}`);
    this.problems = problems;
  }
}

/** The check, against the rows that exist NOW — a handler or a script can vanish between draft and yes. */
export async function dutyCanRun(env: Env, draft: DutyDraft): Promise<string[]> {
  const employee = await env.DB
    .prepare(`SELECT id, name, status, lifecycle FROM employees WHERE id = ?`)
    .bind(draft.employee_id)
    .first<{ id: string; name: string; status: string; lifecycle: string }>();
  const active = Boolean(employee && employee.status === "active" && ["active", "provisional"].includes(employee.lifecycle));
  const problems = dutyProblems(
    { ...draft, employee_name: employee?.name ?? draft.employee_name, employee_active: active },
    await existingDuties(env),
    DELIVERABLE_KEYS,
  );
  if (!employee) problems.unshift(`There is no employee ${draft.employee_id}, so nobody would own this.`);
  if (Array.isArray(draft.refusals) && draft.refusals.length > 0) problems.push(...draft.refusals);
  return [...new Set(problems)];
}

export async function createDutyFromDraft(env: Env, draft: DutyDraft, provenance: DutyProvenance, now = Date.now()): Promise<CreatedDuty> {
  if (provenance.via === "pre_approved" && !provenance.phrase) {
    throw new DutyCannotRun(["A pre-approval must record the phrase that granted it; none was given."]);
  }
  const problems = await dutyCanRun(env, draft);
  if (problems.length > 0) throw new DutyCannotRun(problems);

  const id = `duty_${String(draft.name ?? "new").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40)}_${now.toString(36).slice(-4)}`;
  /*
   * THE FIRST RUN IS THE REAL NEXT OCCURRENCE, not "tomorrow". The reply she gets names it, and a
   * Friday duty that first fires on a Tuesday because tomorrow is a Tuesday is a wrong promise.
   */
  const firstRunAt = nextDueAt(
    { cadence: draft.cadence, weekday: draft.weekday, local_hour: draft.local_hour, local_minute: draft.local_minute, timezone: draft.timezone },
    now,
  );

  await env.DB
    .prepare(
      `INSERT INTO standing_duties
         (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
          next_due_at, executor, task_kind, task_title, task_input, success_criteria)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, draft.name, draft.employee_id, "ops",
      draft.local_hour, draft.local_minute, draft.timezone,
      draft.cadence, draft.weekday,
      firstRunAt,
      draft.executor, "ops", draft.name,
      JSON.stringify({
        // NAMED, ALWAYS. A duty with no model runs the dearest one available.
        requested: { model: draft.model, max_seconds: 600 },
        ...(draft.delivers ? { delivers: draft.delivers } : {}),
        ...(draft.local_job ? { local_job: draft.local_job } : {}),
        prompt: draft.task_prompt,
        authored_from: provenance.via === "pre_approved"
          ? `her own words, pre-approved in the request ("${provenance.phrase}") by ${provenance.approved_by}`
          : `her own words, drafted and approved ${provenance.via === "mail" ? "by reply from" : "in the Inbox by"} ${provenance.approved_by}`,
        provenance: {
          via: provenance.via, approved_by: provenance.approved_by, at: now,
          ...(provenance.phrase ? { pre_approved_phrase: provenance.phrase } : {}),
          ...(provenance.judgement_id ? { judgement_id: provenance.judgement_id } : {}),
          ...(provenance.draft_id ? { draft_id: provenance.draft_id } : {}),
          ...(provenance.mail_id ? { mail_id: provenance.mail_id } : {}),
        },
      }),
      draft.success_criteria,
    )
    .run();

  if (provenance.draft_id) {
    await env.DB
      .prepare(`UPDATE duty_drafts SET state = 'created', duty_id = ?, first_run_at = ?, approved_by = COALESCE(approved_by, ?), approved_at = COALESCE(approved_at, ?), updated_at = ? WHERE id = ?`)
      .bind(id, firstRunAt, provenance.approved_by, now, now, provenance.draft_id)
      .run()
      .catch(() => undefined);
  }

  await audit(env.DB, {
    actor: "boss", lane: "ops", entityType: "standing_duty", entityId: id,
    action: "created", detail: { via: provenance.via, approved_by: provenance.approved_by, phrase: provenance.phrase ?? null, draft_id: provenance.draft_id ?? null, first_run_at: firstRunAt },
  });
  await logEvent(env.DB, {
    level: "info", scope: "duties", event: "duty_created", lane: "ops", entityId: id,
    detail: { employee_id: draft.employee_id, executor: draft.executor, cadence: draft.cadence, via: provenance.via },
  });

  return { id, first_run_at: firstRunAt };
}
