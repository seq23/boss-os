import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { classify } from "../intake/classify";
import { raiseJudgementCall } from "../approvals/raise";
import { decideApproval } from "../approvals/decide";
import { draftDuty, type DutyDraft } from "./author";
import { createDutyFromDraft, DutyCannotRun } from "./create";
import {
  draftToken, draftTokenIn, dutyRequestIn, overridesFrom, readDutyReply, NEW_DUTY_RE,
} from "../../../shared/boss/duties/lane.mjs";
import type { LaneSeat } from "../../../shared/boss/duties/lane.mjs";

/**
 * THE DUTY LANE'S WORKER HALF — the two doors and the one filing.
 *
 * ─── The rules are in `src/shared/boss/duties/lane.mjs` and are imported, never restated ─────
 *
 * This file is the D1 plumbing around them: reading her request off the mail, drafting through
 * `author.ts`, filing the draft as the SAME judgement call the Inbox shows, matching her reply to
 * the draft it answers, deciding that judgement call through `approvals/decide.ts` — the exact
 * path the Inbox button takes — and writing the row that remembers all of it.
 *
 * NOTHING HERE INSERTS A DUTY. `duties/create.ts` is the one writer, reached from the approval
 * loop or from a recorded pre-approval, and `validate:duty-birth` pins both facts.
 *
 * ─── Below the sender refusal, always ─────────────────────────────────────
 *
 * Both entry points are called from the authorised region of `handleBossInboundMail`, after
 * `if (!authorised) return`. A draft that a stranger could approve by knowing a token would make
 * the schedule a door anyone could open; the validator pins the call's position.
 */

export interface FiledDraft {
  draftId: string;
  draft: DutyDraft;
  state: "drafted" | "refused" | "created";
  judgementId: string | null;
  approvalId: string | null;
  created: { id: string; first_run_at: number } | null;
  /** The draft as prose — the reply she reads, and what the screen's preview shows. */
  letter: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");

function whenText(d: DutyDraft): string {
  const t = `${pad(d.local_hour)}:${pad(d.local_minute)} ${d.timezone}`;
  return d.cadence === "daily" ? `daily at ${t}` : `every ${DAY_NAMES[d.weekday ?? 1]} at ${t}`;
}

function firstRunText(at: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
  } catch {
    return new Date(at).toISOString();
  }
}

/**
 * THE DRAFT, IN WORDS SHE CAN ANSWER WITH ONE LINE.
 *
 * Every field the draft derived, with the reason beside it, and every refusal verbatim. The
 * refusals come first when there are any: a NAMED STOP is the only sentence that matters in that
 * reply, and it must not sit under eight lines of a draft that will not be created.
 */
export function renderDraft(input: {
  draft: DutyDraft; draftId: string; signer: LaneSeat; routedBy?: LaneSeat | null;
  created?: { id: string; first_run_at: number } | null; preApproved?: string | null;
}): string {
  const { draft: d, draftId, signer } = input;
  const lines: string[] = [];
  const who = d.employee_name;
  const token = draftToken(draftId);

  if (d.refusals.length > 0) {
    lines.push(`I have NOT created this duty for ${who}, because it could not run as asked. ${token}`, "");
    lines.push("Why not:");
    for (const r of d.refusals) lines.push(`  · ${r}`);
    lines.push("", "The draft, so you can see what would have been created:");
  } else if (input.created) {
    lines.push(
      `Created — you said "${input.preApproved}", so it is on the schedule now. ${token}`,
      "",
      `First run: ${firstRunText(input.created.first_run_at, d.timezone)} ${d.timezone} (${input.created.id}).`,
      "",
    );
  } else {
    lines.push(`Here is the duty as I would create it for ${who}. ${token}`, "");
  }

  lines.push(
    `Name:      ${d.name}`,
    `Owner:     ${who}${input.routedBy ? ` (routed by ${input.routedBy.name})` : ""}`,
    `Cadence:   ${whenText(d)}`,
    `           ${d.cadence_reason}`,
    `Executor:  ${d.executor === "agent" ? "an agent" : `a job on your Mac (${d.local_job})`}`,
    `           ${d.executor_reason}`,
    `Model:     ${d.model.includes("sonnet") ? "Sonnet (the better model)" : "Haiku"} — ${d.model}`,
    `           ${d.model_reason}`,
    `Delivery:  ${d.delivers ?? "posts its own result through duty-run.sh"}`,
    `           ${d.delivers_reason}`,
    `Cost:      about $${d.estimated_per_month_usd} a month, taking the schedule to $${d.monthly_total_after_usd} of $${d.ceiling_usd}${d.over_ceiling ? " — THAT IS OVER THE CEILING" : ""}`,
    "",
    "What she will be told, every run:",
    "",
    ...d.task_prompt.split("\n").map((l) => `    ${l}`),
    "",
  );

  if (d.refusals.length > 0) {
    lines.push("Nothing is waiting on you. Clear the stop above and send the same request again.");
  } else if (input.created) {
    lines.push("Nothing is waiting on you. It is also on Team → Duties, where you can see every run.");
  } else {
    lines.push("Reply `approved` to create it, `changes: …` to redraft.", "", "It is also in your Inbox as a card, if you would rather press the button there.");
  }
  lines.push("", `— ${signer.name}`);
  return lines.join("\n");
}

/**
 * FILE A DRAFT — both doors, one filing.
 *
 * Drafts through `author.ts`, writes the `duty_drafts` row, and then exactly one of:
 *   · refusals → state `refused`; nothing in the Inbox; the reply is the NAMED STOP
 *   · pre-approved → `createDutyFromDraft` with the phrase on the record; state `created`
 *   · otherwise → a `duty_created` judgement call, the draft on it, state `drafted`
 */
export async function fileDraft(env: Env, input: {
  employeeId: string; phrase: string; overrides?: Partial<DutyDraft>;
  door: "mail" | "screen"; mailId?: string | null; messageId?: string | null; tag?: string | null;
  routedBy?: LaneSeat | null; preApproved?: string | null; sender: string; now: number;
  supersedes?: string | null; signer: LaneSeat;
}): Promise<FiledDraft> {
  const draftId = newId("dd");
  const draft = await draftDuty(env, input.employeeId, input.phrase, input.overrides ?? {});
  const kind = classify({ title: input.phrase, intakeKind: "recurring_duty" }).intakeKind;

  const state: FiledDraft["state"] = draft.refusals.length > 0 ? "refused" : input.preApproved ? "created" : "drafted";
  await env.DB
    .prepare(
      `INSERT INTO duty_drafts
         (id, door, mail_id, request_message_id, employee_id, routed_by, tag, phrase, intake_kind, draft_json, refusals_json,
          state, pre_approved_phrase, supersedes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      draftId, input.door, input.mailId ?? null, input.messageId ?? null, input.employeeId, input.routedBy?.id ?? null,
      input.tag ?? null, input.phrase, kind, JSON.stringify(draft), JSON.stringify(draft.refusals),
      // A pre-approved draft that cannot run is refused, not created: the state is written below once we know.
      draft.refusals.length > 0 ? "refused" : "drafted",
      input.preApproved ?? null, input.supersedes ?? null, input.now, input.now,
    )
    .run();
  if (input.supersedes) {
    await env.DB.prepare(`UPDATE duty_drafts SET state = 'redrafted', updated_at = ? WHERE id = ? AND state = 'drafted'`).bind(input.now, input.supersedes).run();
  }

  if (state === "refused") {
    await logEvent(env.DB, { level: "warn", scope: "duties", event: "duty_draft_refused", lane: "ops", entityId: draftId, detail: { employee_id: input.employeeId, refusals: draft.refusals, door: input.door } });
    return { draftId, draft, state, judgementId: null, approvalId: null, created: null, letter: renderDraft({ draft, draftId, signer: input.signer, routedBy: input.routedBy }) };
  }

  if (state === "created") {
    /*
     * PRE-APPROVAL IN THE REQUEST. Her own words granted it; the phrase is on the row and on the
     * duty's provenance, and a finding names it. Written once, here, from the ORIGINAL request —
     * never from a later message.
     */
    let created: { id: string; first_run_at: number };
    try {
      created = await createDutyFromDraft(env, draft, {
        approved_by: input.sender, via: "pre_approved", phrase: input.preApproved, draft_id: draftId, mail_id: input.mailId ?? null,
      }, input.now);
    } catch (err) {
      if (!(err instanceof DutyCannotRun)) throw err;
      draft.refusals.push(...err.problems);
      await env.DB.prepare(`UPDATE duty_drafts SET state = 'refused', refusals_json = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(draft.refusals), input.now, draftId).run();
      return { draftId, draft, state: "refused", judgementId: null, approvalId: null, created: null, letter: renderDraft({ draft, draftId, signer: input.signer, routedBy: input.routedBy }) };
    }
    await env.DB
      .prepare(`UPDATE duty_drafts SET state = 'created', duty_id = ?, first_run_at = ?, approved_by = ?, approved_at = ?, approval_mail_id = ?, updated_at = ? WHERE id = ?`)
      .bind(created.id, created.first_run_at, input.sender, input.now, input.mailId ?? null, input.now, draftId)
      .run();
    await logEvent(env.DB, { level: "info", scope: "duties", event: "duty_pre_approved_in_request", lane: "ops", entityId: draftId, detail: { phrase: input.preApproved, duty_id: created.id, by: input.sender } });
    return { draftId, draft, state, judgementId: null, approvalId: null, created, letter: renderDraft({ draft, draftId, signer: input.signer, routedBy: input.routedBy, created, preApproved: input.preApproved }) };
  }

  /*
   * THE INBOX CARD — the same `duty_created` judgement call the screen has always filed, with the
   * draft stored on it so Approve creates exactly what she read. The row id and the door ride on
   * the draft so the resume handler can close the loop on this record.
   */
  const raised = await raiseJudgementCall(env, {
    employeeId: input.employeeId, lane: "ops", risk: draft.over_ceiling ? "high" : "medium",
    title: `New duty for ${draft.employee_name} — ${draft.name}`,
    question:
      `${whenText(draft)}, on ${draft.model.includes("sonnet") ? "the better model" : "Haiku"}, about $${draft.estimated_per_month_usd} a month — ` +
      `taking the schedule to $${draft.monthly_total_after_usd} of $${draft.ceiling_usd}. ` +
      (draft.over_ceiling ? "THAT IS OVER THE CEILING. " : "") +
      `${draft.cadence_reason} ${draft.model_reason} ${draft.executor_reason} ${draft.delivers_reason} ` +
      "Approve and it goes on the schedule as drafted, or send it back with what to change.",
    resumeKind: "duty_created",
    supersedeKind: input.supersedes ? "duty_created" : null,
    resumeDetail: { ...draft, draft_id: draftId, door: input.door, mail_id: input.mailId ?? null },
  }, input.now);
  await env.DB
    .prepare(`UPDATE duty_drafts SET judgement_id = ?, approval_id = ?, updated_at = ? WHERE id = ?`)
    .bind(raised.id, raised.approvalId, input.now, draftId)
    .run();
  return {
    draftId, draft, state, judgementId: raised.id, approvalId: raised.approvalId, created: null,
    letter: renderDraft({ draft, draftId, signer: input.signer, routedBy: input.routedBy }),
  };
}

// ─── The mail door: a request ────────────────────────────────────────────────

export interface MailLaneResult {
  draftId: string | null;
  note: string;
  outcome: "DUTY_DRAFTED" | "DUTY_REFUSED" | "DUTY_CREATED" | "DUTY_ANSWERED" | "DUTY_NOT_UNDERSTOOD";
  employeeId: string | null;
}

/**
 * `#<seat> new duty …` — read, drafted, filed, and answered with the draft. Null when the verb is
 * absent, so the ordinary path is untouched. When the verb is present the message STOPS here: a
 * duty request is the whole job, and handing the same words to a model afterwards is how a
 * paragraph about "handling a superior" lands in her approval queue.
 */
export async function newDutyFromMail(env: Env, input: {
  roster: LaneSeat[]; subject: string; text: string; mailId: string; messageId: string | null; now: number; sender: string;
}): Promise<MailLaneResult | null> {
  const req = dutyRequestIn(input.subject, input.text, input.roster);
  if (!req) return null;
  if ("error" in req) {
    return {
      draftId: null, employeeId: null, outcome: "DUTY_NOT_UNDERSTOOD",
      note: `${req.error} Nothing was drafted. The seats are ${input.roster.map((s) => `#${s.name.toLowerCase()}`).join(", ")}; write \`#<seat> new duty\` and the duty in your words.`,
    };
  }
  if (!req.phrase || req.phrase.trim().length < 8) {
    return {
      draftId: null, employeeId: req.seat.id, outcome: "DUTY_NOT_UNDERSTOOD",
      note: `You asked for a new duty for ${req.seat.name} and did not say what it is. Nothing was drafted. Reply with the duty in your words — "every friday, check the LP replies sheet and tell me who went quiet" is enough.`,
    };
  }

  const filed = await fileDraft(env, {
    employeeId: req.seat.id, phrase: req.phrase, door: "mail", mailId: input.mailId, messageId: input.messageId,
    tag: req.tag, routedBy: req.routedBy, preApproved: req.preApproved, sender: input.sender, now: input.now,
    signer: req.routedBy ?? req.seat,
  });
  await audit(env.DB, {
    actor: "boss", lane: "ops", entityType: "duty_draft", entityId: filed.draftId,
    action: filed.state === "created" ? "created_pre_approved" : filed.state, detail: { employee_id: req.seat.id, mail_id: input.mailId, tag: req.tag, pre_approved: req.preApproved },
  });
  return {
    draftId: filed.draftId, employeeId: req.seat.id,
    outcome: filed.state === "created" ? "DUTY_CREATED" : filed.state === "refused" ? "DUTY_REFUSED" : "DUTY_DRAFTED",
    note: filed.letter,
  };
}

// ─── The mail door: her reply ────────────────────────────────────────────────

interface DraftRow {
  id: string; employee_id: string; routed_by: string | null; tag: string | null; phrase: string; state: string;
  judgement_id: string | null; approval_id: string | null; draft_json: string; mail_id: string | null;
}

/**
 * Which draft her reply answers. Three roads, tried in order, none of them a guess:
 *   1. the `[dd_…]` token in her text (she typed or kept it)
 *   2. the References / In-Reply-To chain naming her original request's Message-ID
 *   3. a `Re:` subject that still carries `#<seat> new duty`, with exactly ONE draft waiting on that seat
 */
async function draftForReply(env: Env, input: { subject: string; text: string; chain: string; roster: LaneSeat[] }): Promise<DraftRow | null> {
  const byId = async (id: string) => env.DB.prepare(`SELECT * FROM duty_drafts WHERE id = ?`).bind(id).first<DraftRow>();
  const token = draftTokenIn(`${input.subject}\n${input.text}`);
  if (token) return byId(token);

  const ids = (input.chain.match(/<[^>]+>/g) ?? []).slice(0, 20);
  if (ids.length) {
    const marks = ids.map(() => "?").join(",");
    const row = await env.DB
      .prepare(`SELECT * FROM duty_drafts WHERE request_message_id IN (${marks}) ORDER BY created_at DESC LIMIT 1`)
      .bind(...ids)
      .first<DraftRow>();
    if (row) {
      // The latest draft in this thread: a redraft supersedes the one it replaced.
      const latest = await env.DB.prepare(`SELECT * FROM duty_drafts WHERE supersedes = ? ORDER BY created_at DESC LIMIT 1`).bind(row.id).first<DraftRow>();
      return latest ?? row;
    }
  }

  const m = NEW_DUTY_RE.exec(input.subject);
  if (m && /^\s*re\s*:/i.test(input.subject)) {
    const req = dutyRequestIn(input.subject, "", input.roster);
    if (req && !("error" in req)) {
      const waiting = await env.DB
        .prepare(`SELECT * FROM duty_drafts WHERE employee_id = ? AND state = 'drafted' ORDER BY created_at DESC LIMIT 2`)
        .bind(req.seat.id)
        .all<DraftRow>();
      const rows = waiting.results ?? [];
      if (rows.length === 1) return rows[0]!;
    }
  }
  return null;
}

/**
 * Her word on the thread. Null when the message is not a reply to a draft. Otherwise:
 *   approved → the judgement call is decided through `decideApproval` — the Inbox button's exact
 *              path — and the resume creates the duty; the reply names the first run
 *   changes  → a new draft with her text as overrides, superseding this one; the reply is the new draft
 *   held     → the judgement call is rejected (sent back); nothing created
 *   other    → a note on the row; nothing created
 */
export async function answerDutyFromMail(env: Env, input: {
  roster: LaneSeat[]; subject: string; text: string; inReplyTo: string | null; references: string | null;
  mailId: string; now: number; sender: string;
}): Promise<MailLaneResult | null> {
  const chain = `${input.references ?? ""} ${input.inReplyTo ?? ""}`;
  const isReply = /^\s*re\s*:/i.test(input.subject) || chain.trim().length > 0 || Boolean(draftTokenIn(`${input.subject}\n${input.text}`));
  if (!isReply) return null;
  const row = await draftForReply(env, { subject: input.subject, text: input.text, chain, roster: input.roster });
  if (!row) return null;

  const seat = input.roster.find((s) => s.id === row.employee_id) ?? { id: row.employee_id, name: row.employee_id };
  const signer = input.roster.find((s) => s.id === row.routed_by) ?? seat;
  const reply = readDutyReply(input.text);
  const token = draftToken(row.id);

  if (row.state !== "drafted") {
    const what = row.state === "created" ? "already created" : row.state === "refused" ? "refused as a named stop" : row.state === "redrafted" ? "replaced by a newer draft" : "held";
    return { draftId: row.id, employeeId: row.employee_id, outcome: "DUTY_ANSWERED", note: `${token} was ${what} — a reply changes nothing now. Send a new \`#${seat.name.toLowerCase()} new duty\` request if you want something different.\n\n— ${signer.name}` };
  }
  if (reply.mode === "empty") {
    return { draftId: row.id, employeeId: row.employee_id, outcome: "DUTY_ANSWERED", note: `Your reply to ${token} carried no readable text; the draft is still waiting on you. Reply \`approved\` to create it, \`changes: …\` to redraft.\n\n— ${signer.name}` };
  }

  if (reply.mode === "approved") {
    if (!row.approval_id) {
      return { draftId: row.id, employeeId: row.employee_id, outcome: "DUTY_ANSWERED", note: `${token} has no approval to decide — that is a fault on my side, not yours. It is in the audit log; nothing was created.\n\n— ${signer.name}` };
    }
    await env.DB
      .prepare(`UPDATE duty_drafts SET approved_by = ?, approved_at = ?, approval_mail_id = ?, updated_at = ? WHERE id = ? AND state = 'drafted'`)
      .bind(input.sender, input.now, input.mailId, input.now, row.id)
      .run();
    let decided;
    try {
      decided = await decideApproval(env, { id: row.approval_id, decision: "approved", note: null, decidedBy: input.sender });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { draftId: row.id, employeeId: row.employee_id, outcome: "DUTY_ANSWERED", note: `Your \`approved\` for ${token} was recorded, and the approval could not be decided: ${message}. Nothing was created; it is still in your Inbox.\n\n— ${signer.name}` };
    }
    const exec = decided.execution as { status?: string; detail?: { resumed?: string; error?: string } } | null;
    if (exec?.status !== "executed") {
      return { draftId: row.id, employeeId: row.employee_id, outcome: "DUTY_ANSWERED", note: `Your \`approved\` for ${token} was recorded, and the duty was NOT created: ${exec?.detail?.error ?? "the resume did not run"}. It stays in your Inbox with that reason.\n\n— ${signer.name}` };
    }
    await audit(env.DB, { actor: "boss", lane: "ops", entityType: "duty_draft", entityId: row.id, action: "approved_by_mail", detail: { mail_id: input.mailId, approval_id: row.approval_id } });
    const after = await env.DB.prepare(`SELECT duty_id, first_run_at FROM duty_drafts WHERE id = ?`).bind(row.id).first<{ duty_id: string | null; first_run_at: number | null }>();
    const draft = JSON.parse(row.draft_json) as DutyDraft;
    return {
      draftId: row.id, employeeId: row.employee_id, outcome: "DUTY_ANSWERED",
      note: [
        `Created. ${token}`,
        "",
        `${draft.employee_name} now runs "${draft.name}" ${whenText(draft)}.`,
        after?.first_run_at ? `First run: ${firstRunText(after.first_run_at, draft.timezone)} ${draft.timezone} (${after.duty_id}).` : `Duty: ${after?.duty_id ?? "(see Team → Duties)"}.`,
        "",
        "It is on Team → Duties, where you can see every run.",
        "",
        `— ${signer.name}`,
      ].join("\n"),
    };
  }

  if (reply.mode === "changes") {
    const prior = JSON.parse(row.draft_json) as DutyDraft;
    const overrides = overridesFrom(reply.text);
    const phrase = `${row.phrase}\nChanges: ${reply.text}`;
    const filed = await fileDraft(env, {
      employeeId: row.employee_id, phrase, overrides, door: "mail", mailId: input.mailId, messageId: null,
      tag: row.tag, routedBy: signer.id !== seat.id ? signer : null, preApproved: null, sender: input.sender, now: input.now,
      supersedes: row.id, signer,
    });
    // The old card leaves the Inbox: `supersedeKind` on the raise rejected its approval as superseded.
    await audit(env.DB, { actor: "boss", lane: "ops", entityType: "duty_draft", entityId: filed.draftId, action: "redrafted_by_mail", detail: { supersedes: row.id, mail_id: input.mailId, overrides, prior_name: prior.name } });
    return { draftId: filed.draftId, employeeId: row.employee_id, outcome: "DUTY_ANSWERED", note: `Redrafted with your changes ("${reply.text.slice(0, 200)}"). The earlier draft ${token} is withdrawn.\n\n${filed.letter}` };
  }

  if (reply.mode === "held") {
    if (row.approval_id) {
      await decideApproval(env, { id: row.approval_id, decision: "rejected", note: reply.text.slice(0, 600), decidedBy: input.sender }).catch(() => null);
    }
    await env.DB.prepare(`UPDATE duty_drafts SET state = 'held', held_note = ?, updated_at = ? WHERE id = ? AND state = 'drafted'`).bind(reply.text.slice(0, 2000), input.now, row.id).run();
    return { draftId: row.id, employeeId: row.employee_id, outcome: "DUTY_ANSWERED", note: `Held. ${token} is withdrawn and nothing was created; your note is on the record: "${reply.text.slice(0, 300)}". Send a new \`#${seat.name.toLowerCase()} new duty\` when you want it drafted again.\n\n— ${signer.name}` };
  }

  await env.DB.prepare(`UPDATE duty_drafts SET held_note = ?, updated_at = ? WHERE id = ?`).bind(reply.text.slice(0, 2000), input.now, row.id).run();
  return { draftId: row.id, employeeId: row.employee_id, outcome: "DUTY_ANSWERED", note: `Noted on ${token}: "${reply.text.slice(0, 300)}". Nothing was created — only \`approved\` creates it, and \`changes: …\` redrafts.\n\n— ${signer.name}` };
}
