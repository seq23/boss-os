import type { Env } from "../env";
import { audit } from "../lib/audit";
import { raiseJudgementCall } from "../approvals/raise";
import { admitTask } from "../tasks/admit";
import { editDuty, repoInstructions, OWNER_TZ, type OwnedDuty } from "./ownerEdits";
import { localDate } from "../../../shared/boss/duties/ownerEdits.mjs";
import { dutyChangeBody, dutyCodeHome, dutyEditRequestIn, editedInstructions } from "../../../shared/boss/duties/editByMail.mjs";
import type { LaneSeat } from "../../../shared/boss/duties/lane.mjs";

/**
 * HER RULING ON A DUTY SHE ALREADY HAS (owner incident, 1 Nov 2026) — the Worker half.
 *
 * "Change to Camille's Marketplace listings duty … your call" became a research page that told her
 * "Done" while the duty stayed as it was. A ruling is never research. This door reads which duty
 * the email changes (`dutyEditRequestIn`) and changes THAT duty:
 *   - written instructions → her words are added to them through `editDuty`, the employee page's
 *     own path (a `duty_versions` row, so Undo on the page puts it back). "your call" applies it at
 *     once; otherwise it is the same Inbox card a new duty gets, and approving it applies the edit
 *     (`duty_edit` in approvals/resume.ts).
 *   - fixed steps (a Mac job or Worker code) → a change for Danielle's repo lane in the repo that
 *     holds the steps, carrying her words and her pre-approval.
 * The reply says what changed, in plain words. Called below the sender refusal, like the other doors.
 */

export interface DutyEditResult {
  draftId: null;
  note: string;
  outcome: "DUTY_EDITED" | "DUTY_EDIT_DRAFTED" | "DUTY_CHANGE_ROUTED" | "DUTY_NOT_UNDERSTOOD";
  employeeId: string | null;
  taskId: string | null;
}

export async function editDutyFromMail(env: Env, input: {
  roster: LaneSeat[]; subject: string; text: string; mailId: string; now: number; sender: string;
}): Promise<DutyEditResult | null> {
  const duties = (await env.DB.prepare(`SELECT * FROM standing_duties WHERE removed_at IS NULL`).all<OwnedDuty>()).results ?? [];
  const req = dutyEditRequestIn(input.subject, input.text, { roster: input.roster, duties });
  if (!req) return null;
  const signer = input.roster.find((s) => String(s.role ?? "").toLowerCase() === "chief of staff")?.name ?? "Simone";

  if (req.ambiguous) {
    return {
      draftId: null, taskId: null, employeeId: req.seat?.id ?? null, outcome: "DUTY_NOT_UNDERSTOOD",
      note: [
        "You asked to change a duty, and more than one fits what you wrote, so nothing was changed yet:",
        ...req.ambiguous.map((d) => `- ${d.name}`),
        "",
        "Reply with the one you mean (its name is enough) and the change.",
        "",
        `— ${signer}`,
      ].join("\n"),
    };
  }

  const d = req.duty;
  const seatName = req.seat?.name ?? input.roster.find((s) => s.id === d.employee_id)?.name ?? "the team";
  const repo = repoInstructions(d, input.now);

  if (repo) {
    const current = d.owner_prompt ?? repo.text;
    const instructions = editedInstructions(current, req.phrase, localDate(OWNER_TZ, input.now));
    if (req.preApproved) {
      const r = await editDuty(env, d.id, { instructions }, input.now);
      await audit(env.DB, { actor: "boss", lane: d.lane, entityType: "standing_duty", entityId: d.id, action: "edited_by_mail", detail: { mail_id: input.mailId, version: r.version, pre_approved: req.preApproved } });
      return {
        draftId: null, taskId: null, employeeId: d.employee_id, outcome: "DUTY_EDITED",
        note: [
          `Changed. ${seatName}'s duty "${d.name}" now follows your change from its next run.`,
          "",
          `You said "${req.preApproved}", so it is applied now. You can read it, and undo it, on ${seatName}'s page.`,
          "",
          `— ${signer}`,
        ].join("\n"),
      };
    }
    await raiseJudgementCall(env, {
      employeeId: d.employee_id, lane: d.lane, risk: "medium",
      title: `Change ${seatName}'s duty — ${d.name}`,
      question: `Your change, word for word: "${req.phrase.slice(0, 1500)}". Approve and it is added to the duty's instructions from its next run (Undo on ${seatName}'s page puts it back), or send it back with what to change.`,
      resumeKind: "duty_edit",
      resumeDetail: { duty_id: d.id, instructions, mail_id: input.mailId },
    }, input.now);
    return {
      draftId: null, taskId: null, employeeId: d.employee_id, outcome: "DUTY_EDIT_DRAFTED",
      note: [
        `Ready to change ${seatName}'s duty "${d.name}" with your words. Nothing has changed yet.`,
        "",
        "Approve it in your Inbox and it applies from the next run. Next time, add \"your call\" and it applies at once.",
        "",
        `— ${signer}`,
      ].join("\n"),
    };
  }

  // Fixed steps: the code that runs the duty changes, so it goes to the seat that changes code.
  const home = dutyCodeHome(d);
  const body = dutyChangeBody(d, req.phrase, { source: "by email", preApproved: req.preApproved });
  const admitted = await admitTask(env, {
    title: `Change ${seatName}'s duty: ${d.name}`.slice(0, 160), lane: "ops", employee_id: "emp_repo",
    input: {
      source: "boss_inbound_mail", mail_id: input.mailId, from: input.sender, build_ask: true,
      routing: `Her ruling changes the existing duty ${d.id}, whose steps are fixed in code, so it went to Danielle's repo lane.`,
      duty_id: d.id, body,
    },
  });
  if (!admitted.created || !admitted.task_id) {
    return {
      draftId: null, taskId: null, employeeId: d.employee_id, outcome: "DUTY_NOT_UNDERSTOOD",
      note: `Your change to ${seatName}'s duty "${d.name}" could not be handed to Danielle (${admitted.reason ?? "intake refused it"}). Nothing was changed; the team is on it.\n\n— ${signer}`,
    };
  }
  await audit(env.DB, { actor: "boss", lane: "ops", entityType: "standing_duty", entityId: d.id, action: "change_routed_by_mail", detail: { mail_id: input.mailId, task_id: admitted.task_id, repo: home.github_repo } });
  return {
    draftId: null, taskId: admitted.task_id, employeeId: "emp_repo", outcome: "DUTY_CHANGE_ROUTED",
    note: [
      `${seatName}'s duty "${d.name}" runs on fixed steps, so Danielle is changing those steps with your words. It is not changed yet.`,
      "",
      req.preApproved ? `You said "${req.preApproved}", so she builds it without asking you. You hear once when it is live.` : "She sends you the plan before she builds it.",
      "",
      `— ${signer}`,
    ].join("\n"),
  };
}
