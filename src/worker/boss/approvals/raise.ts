import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { RESUME_HANDLERS } from "./resume";

/**
 * PUTTING SOMETHING IN FRONT OF HER, FROM INSIDE THE WORKER.
 *
 * ─── Why this is extracted rather than copied ──────────────────────────────
 *
 * `POST /api/boss/judgement` has been the only way to raise a judgement call, and it is reached
 * over HTTP by a local script. That is right for the covers, where the bytes come from her Mac. It
 * is wrong for a letter composed inside the Worker in response to her own click: a request the
 * Worker makes to itself is a second authentication, a second failure mode, and an outbound fetch
 * that `validate:network-boundary` would refuse.
 *
 * So the mechanism moves here and BOTH callers use it. The alternative — a second insert of the
 * same three rows in `wealth.ts` — is the defect class her own rules name first: two components
 * each keeping their own list, drifting apart the moment one is changed.
 *
 * ─── The refusal moves with it ─────────────────────────────────────────────
 *
 * The check that made "Approve resumes the work" structural travels with the mechanism rather than
 * staying behind in the route. A judgement call cannot be born with a `resume_kind` that has no
 * handler, no matter which caller creates it — which is the only construction that survives a
 * second caller being added, as one just was.
 */

export interface RaiseInput {
  title: string;
  question: string;
  resumeKind: string;
  employeeId: string;
  lane: string;
  risk?: "low" | "medium" | "high";
  deliverableId?: string | null;
  /**
   * Supersede any awaiting judgement of this resume kind. A second attempt at the same work
   * replaces the first on her screen rather than sitting beside it: two live dockets about one
   * decision is a way to approve the wrong one.
   */
  supersedeKind?: string | null;
  /** Carried on the row and read back by the resume handler. See `duty_created` for the precedent. */
  resumeDetail?: unknown;
}

export interface Raised {
  id: string;
  approvalId: string;
  attempt: number;
}

export class NoSuchResumeKind extends Error {}

export async function raiseJudgementCall(env: Env, input: RaiseInput, now = Date.now()): Promise<Raised> {
  if (!RESUME_HANDLERS[input.resumeKind]) {
    throw new NoSuchResumeKind(
      `"${input.resumeKind}" is not a resume kind this system has. ` +
        `One of: ${Object.keys(RESUME_HANDLERS).join(", ")}. ` +
        "An approval that starts nothing is worse than no approval — it teaches her that answering does not matter.",
    );
  }

  const id = newId("jdg");
  const approvalId = newId("apr");
  let attempt = 1;

  if (input.supersedeKind) {
    const prior = await env.DB
      .prepare(
        `SELECT id, approval_id, attempt FROM judgement_calls
          WHERE resume_kind = ? AND state = 'awaiting' ORDER BY created_at DESC`,
      )
      .bind(input.supersedeKind)
      .all<any>();
    for (const p of prior.results ?? []) {
      attempt = Math.max(attempt, (p.attempt ?? 1) + 1);
      await env.DB.batch([
        env.DB.prepare(`UPDATE judgement_calls SET state = 'superseded', updated_at = ? WHERE id = ?`).bind(now, p.id),
        env.DB.prepare(
          `UPDATE approvals SET status = 'rejected', decided_at = ?, decided_by = 'system',
                                decision_note = 'Superseded by a newer attempt' WHERE id = ? AND status = 'pending'`,
        ).bind(now, p.approval_id),
      ]);
    }
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk,
                              payload, status, requested_at, expires_at)
       VALUES (?,?,?,?,'judgement_call','judgement_calls',?,?,?,'pending',?,NULL)`,
    ).bind(
      approvalId, input.lane, input.title, input.question, id,
      input.risk ?? "medium",
      JSON.stringify({ judgement_id: id, resume_kind: input.resumeKind }),
      now,
    ),
    env.DB.prepare(
      `INSERT INTO judgement_calls
         (id, approval_id, employee_id, deliverable_id, title, question, resume_kind, state,
          attempt, resume_detail, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'awaiting',?,?,?,?)`,
    ).bind(
      id, approvalId, input.employeeId, input.deliverableId ?? null, input.title, input.question,
      input.resumeKind, attempt,
      input.resumeDetail === undefined ? null : JSON.stringify(input.resumeDetail),
      now, now,
    ),
    env.DB.prepare(
      `INSERT INTO approval_events (id, approval_id, ts, event, detail) VALUES (?,?,?,'raised',?)`,
    ).bind(newId("ape"), approvalId, now, JSON.stringify({ judgement_id: id, attempt })),
  ]);

  await audit(env.DB, {
    actor: "system", lane: input.lane as any, entityType: "judgement_call", entityId: id,
    action: "raised", detail: { resume_kind: input.resumeKind, attempt },
  });

  return { id, approvalId, attempt };
}
