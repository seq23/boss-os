import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { tokenIn, readReply, needsPreview, isForced, REPO_CHANGE_SEAT } from "../../../shared/boss/repoChange/lane.mjs";

/**
 * THE REPO-CHANGE LANE'S WORKER HALF — the pieces the mail intake and the claim routes share.
 *
 * The rules (which phase may be claimed, when BUILD and LAND are permitted) live in
 * `src/shared/boss/repoChange/lane.mjs` and are imported, never restated. This file is the D1
 * plumbing around them: finding the row her reply answers, recording that answer, and writing the
 * task event that keeps the card's history honest.
 */

export interface RepoChangeRow {
  id: string; task_id: string; mail_id: string | null;
  repo: string | null; property_key: string | null; drive_folder: string | null; drive_url: string | null;
  instruction: string; phase: string;
  plan_text: string | null; decided_json: string | null; asks_json: string | null; planned_at: number | null; plan_written_by: string | null;
  asked_at: number | null; ask_message_id: string | null; answered_at: number | null; answers_text: string | null; answers_mode: string | null; answer_mail_id: string | null;
  held_at: number | null; held_text: string | null;
  branch: string | null; pr_url: string | null; pr_number: number | null; built_at: number | null; build_written_by: string | null; proof_json: string | null;
  checks_state: string | null; checks_detail: string | null; checks_green_at: number | null;
  merge_sha: string | null; landed_at: number | null; live_proof_json: string | null;
  claimed_at: number | null; claimed_by: string | null; claimed_phase: string | null; run_log: string | null;
  done_at: number | null; done_message_id: string | null; failure: string | null;
  created_at: number; updated_at: number;
  publish_ready: number | null; placeholders_json: string | null; preview_forced: number;
  preview_url: string | null; preview_sent_at: number | null; preview_message_id: string | null;
  land_approved_at: number | null; land_approval_text: string | null; land_approval_mail_id: string | null;
  forced_by: string | null; forced_at: number | null; forced_placeholders: string | null; forced_mail_id: string | null;
}

export async function repoChangeById(env: Env, id: string): Promise<RepoChangeRow | null> {
  return env.DB.prepare(`SELECT * FROM repo_changes WHERE id = ?`).bind(id).first<RepoChangeRow>();
}

export async function taskEvent(env: Env, taskId: string, event: string, detail: Record<string, unknown>): Promise<void> {
  await env.DB
    .prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,?,?)`)
    .bind(newId("tev"), taskId, Date.now(), event, JSON.stringify(detail))
    .run();
}

/**
 * ─── HER REPLY IS THE PLAN APPROVAL, AND IT RESUMES THE TASK INTO BUILD ────
 *
 * Matched on the `[rc_…]` token the plan email put in its subject — which her mail client keeps in
 * the "Re:" — so the match needs no Message-ID and survives a forward from her phone. Only a row in
 * `asking` can be answered: a reply to a change already building, landed or failed is recorded on
 * the task as a note and changes nothing, because "she wrote again" is not "she approved again".
 *
 * The caller has ALREADY established that the sender is her and DMARC passed — this is called from
 * inside the authorised region of `handleBossInboundMail`, below the refusal. `validate:repo-lane`
 * pins that position, because a plan approval that could be recorded from a stranger's mail would
 * make land-on-green a door anyone who knew the token could open.
 */
export async function answerFromMail(
  env: Env, input: { seatId: string; subject: string; text: string; mailId: string; now: number; sender: string },
): Promise<{ changeId: string; resumed: boolean; note: string } | null> {
  /*
   * THE TOKEN ROUTES, WHATEVER DESK THE TAG LANDED ON. `[rc_…]` names a change only Danielle's lane
   * can have created, so a reply that kept the token but lost the `#danielle` (a phone client that
   * trimmed the subject, a forward) is still her answer to that plan. The seat is recorded on the
   * event so a reply that arrived on another desk is visible as such.
   */
  const changeId = tokenIn(`${input.subject}\n${input.text}`);
  if (!changeId) return null;
  const row = await repoChangeById(env, changeId);
  if (!row) return { changeId, resumed: false, note: `Your message names ${changeId}, and no repo change has that id. Nothing was changed.` };

  /*
   * ─── HER SECOND WORD, AFTER THE PREVIEW ─────────────────────────────────
   *
   * A change that was not publish-ready (or one she asked to preview) sits in `previewing` with
   * the PR and the preview in her inbox. "approved" here is the LAND approval — recorded with its
   * own timestamp so `canLand` can see it came after the preview email. "preview" here sets
   * nothing: she is already looking at the preview, and the word that asked for one is not the
   * word that approves it. "no" / "changes:" holds, as at the plan.
   */
  if (row.phase === "previewing") {
    const reply = readReply(input.text);
    if (reply.mode === "empty") return { changeId, resumed: false, note: `Your reply to ${row.id} carried no readable text; the preview is still waiting on you.` };
    if (reply.mode === "approved") {
      const next = row.checks_green_at ? "land" : "landing";
      await env.DB
        .prepare(`UPDATE repo_changes SET phase = ?, land_approved_at = ?, land_approval_text = ?, land_approval_mail_id = ?, updated_at = ? WHERE id = ? AND phase = 'previewing'`)
        .bind(next, input.now, reply.text.slice(0, 20_000), input.mailId, input.now, row.id)
        .run();
      await taskEvent(env, row.task_id, "repo_change_preview_approved", { repo_change_id: row.id, mail_id: input.mailId, next, checks_green: Boolean(row.checks_green_at) });
      await audit(env.DB, { actor: "boss", lane: "ops", entityType: "repo_change", entityId: row.id, action: "preview_approved", detail: { task_id: row.task_id, mail_id: input.mailId, pr_url: row.pr_url } });
      return {
        changeId, resumed: true,
        note: `Got it — your approval of the preview is on the record for ${row.id} (${row.repo ?? "the package"}). ` +
          (row.checks_green_at ? "The checks are already green, so Danielle lands it at the next tick and emails you the merge commit and the live proof." : "Danielle lands it the moment the PR's checks are green, and emails you the merge commit and the live proof."),
      };
    }
    if (reply.mode === "forced") {
      const placeholders = await recordForce(env, row, input, "preview");
      const next = row.checks_green_at ? "land" : "landing";
      await env.DB.prepare(`UPDATE repo_changes SET phase = ?, updated_at = ? WHERE id = ? AND phase = 'previewing'`).bind(next, input.now, row.id).run();
      return {
        changeId, resumed: true,
        note: `Recorded: ${row.id} (${row.repo ?? "the package"}) goes to production BY YOUR INSTRUCTION with ${placeholders.length} placeholder${placeholders.length === 1 ? "" : "s"}${placeholders.length ? `: ${placeholders.join("; ")}` : ""}. ` +
          (row.checks_green_at ? "The checks are green; Danielle lands it at the next tick." : "Danielle lands it the moment the checks are green.") + " The DONE email will say so at the top.",
      };
    }
    if (reply.mode === "preview") {
      await taskEvent(env, row.task_id, "repo_change_note", { repo_change_id: row.id, mail_id: input.mailId, phase: row.phase, text: reply.text });
      return { changeId, resumed: false, note: `${row.id} is already at the preview${row.preview_url ? ` (${row.preview_url})` : ` (${row.pr_url})`}. "preview" does not land it; reply "approved" to land, or "changes: …" to hold.` };
    }
    if (reply.mode === "held") {
      await env.DB.prepare(`UPDATE repo_changes SET held_at = ?, held_text = ?, updated_at = ? WHERE id = ? AND phase = 'previewing'`).bind(input.now, reply.text.slice(0, 20_000), input.now, row.id).run();
      await taskEvent(env, row.task_id, "repo_change_held", { repo_change_id: row.id, mail_id: input.mailId, at: "preview", text: reply.text.slice(0, 2000) });
      return { changeId, resumed: false, note: `Held at the preview. ${row.id} (${row.repo ?? "the package"}) stays open and unlanded; your note is on the record: "${reply.text.slice(0, 300)}". Reply "approved" when it should land.` };
    }
    // Her own words at the preview are a note, not a landing: nothing lands on an ambiguous reply.
    await taskEvent(env, row.task_id, "repo_change_note", { repo_change_id: row.id, mail_id: input.mailId, phase: row.phase, text: reply.text.slice(0, 4000) });
    return { changeId, resumed: false, note: `Noted on ${row.id}'s preview: "${reply.text.slice(0, 300)}". Nothing landed — only the single word "approved" lands a previewed change; "changes: …" holds it.` };
  }

  if (row.phase !== "asking") {
    await taskEvent(env, row.task_id, "repo_change_note", { repo_change_id: row.id, mail_id: input.mailId, phase: row.phase, text: input.text.slice(0, 4000) });
    return {
      changeId, resumed: false,
      note: `Noted on ${row.id} (${row.repo ?? "package"}), which is ${describePhase(row)} — a reply changes nothing at this stage. If you want something different, send a new #danielle instruction.`,
    };
  }

  /*
   * ONE WORD IS THE WHOLE APPROVAL. "approved" (approve / yes / go / land it) means every ask takes
   * the recommended default the plan email printed beside it; a reply that starts "no" / "not
   * approved" / "stop" / "changes:" HOLDS the task exactly where it is; anything else is her
   * answers. `readReply` is the one reader, and the validator runs it over fixtures.
   */
  const reply = readReply(input.text);
  if (reply.mode === "empty") {
    return { changeId, resumed: false, note: `Your reply to ${row.id} carried no readable text, so nothing was recorded and the change is still waiting on you.` };
  }
  if (reply.mode === "held") {
    await env.DB
      .prepare(`UPDATE repo_changes SET held_at = ?, held_text = ?, updated_at = ? WHERE id = ? AND phase = 'asking'`)
      .bind(input.now, reply.text.slice(0, 20_000), input.now, row.id)
      .run();
    await taskEvent(env, row.task_id, "repo_change_held", { repo_change_id: row.id, mail_id: input.mailId, text: reply.text.slice(0, 2000) });
    await audit(env.DB, { actor: "boss", lane: "ops", entityType: "repo_change", entityId: row.id, action: "plan_held", detail: { task_id: row.task_id, mail_id: input.mailId } });
    return {
      changeId, resumed: false,
      note: `Held. ${row.id} (${row.repo ?? "the package"}) stays where it is and nothing builds. Your note is on the record: "${reply.text.slice(0, 300)}". ` +
        `When you want it to go, reply "approved" to this thread to take every recommended default, or reply with your answers.`,
    };
  }
  const answers = reply.text;
  // "preview" on the plan = approved with every default, AND the landing waits for a second word.
  const forced = reply.mode === "preview" ? 1 : 0;
  await env.DB
    .prepare(`UPDATE repo_changes SET phase = 'build', answered_at = ?, answers_text = ?, answers_mode = ?, answer_mail_id = ?, preview_forced = ?, updated_at = ? WHERE id = ? AND phase = 'asking'`)
    .bind(input.now, answers.slice(0, 20_000), reply.mode, input.mailId, forced, input.now, row.id)
    .run();
  // "approved to production" on a not-ready plan: the plan approval above, plus the force on record.
  let forcedPlaceholders: string[] | null = null;
  if (reply.mode === "forced") forcedPlaceholders = await recordForce(env, row, input, "plan");
  await taskEvent(env, row.task_id, "repo_change_answered", { repo_change_id: row.id, mail_id: input.mailId, mode: reply.mode, chars: answers.length, seat: input.seatId, on_danielles_desk: input.seatId === REPO_CHANGE_SEAT });
  await audit(env.DB, {
    actor: "boss", lane: "ops", entityType: "repo_change", entityId: row.id,
    action: "plan_approved", detail: { task_id: row.task_id, mail_id: input.mailId, repo: row.repo },
  });
  await logEvent(env.DB, {
    level: "info", scope: "intake", event: "repo_change_answered", lane: "ops", entityId: row.id,
    detail: { task_id: row.task_id, repo: row.repo },
  });
  const asks = safeList(row.asks_json).length;
  return {
    changeId, resumed: true,
    note: `Got it — your reply is on the record as the plan approval for ${row.id} (${row.repo ?? "the package"})` +
      `${reply.mode !== "answers" ? (asks ? `, and every one of the ${asks} question${asks === 1 ? "" : "s"} takes the recommended default` : "") : asks ? `, answering ${asks} question${asks === 1 ? "" : "s"}` : ""}. ` +
      (forcedPlaceholders
        ? `TO PRODUCTION BY YOUR INSTRUCTION, with ${forcedPlaceholders.length} placeholder${forcedPlaceholders.length === 1 ? "" : "s"}${forcedPlaceholders.length ? ` (${forcedPlaceholders.join("; ")})` : ""}: Danielle builds it, opens the PR, and lands it once the checks are green — no preview, no second word. The DONE email will say so at the top.`
        : needsPreview({ ...row, preview_forced: forced })
          ? "Danielle builds it on your Mac at the next tick and opens the pull request; you will get the preview by email and it lands only after you reply \"approved\" to that."
          : "Danielle builds it on your Mac at the next tick, opens the pull request, and lands it once the checks are green. You will get one more email with the PR, the merge commit and the live proof."),
  };
}

/**
 * ─── THE FORCE, RECORDED AND NAMED ──────────────────────────────────────
 *
 * Her verified address is the only place this can be called from (the mailbox refuses before
 * routing), and the row carries who, when, what shipped, and which mail said so. The finding is a
 * `warn` event plus an audit row — a force that nobody could later find is a bypass, not a decision.
 */
async function recordForce(env: Env, row: RepoChangeRow, input: { mailId: string; now: number; sender: string }, at: "plan" | "preview"): Promise<string[]> {
  const placeholders = safeList(row.placeholders_json).map(String);
  await env.DB
    .prepare(`UPDATE repo_changes SET forced_by = ?, forced_at = ?, forced_placeholders = ?, forced_mail_id = ?, updated_at = ? WHERE id = ?`)
    .bind(input.sender, input.now, JSON.stringify(placeholders), input.mailId, input.now, row.id)
    .run();
  await taskEvent(env, row.task_id, "repo_change_forced", { repo_change_id: row.id, mail_id: input.mailId, by: input.sender, at, placeholders, publish_ready: row.publish_ready });
  await audit(env.DB, { actor: "boss", lane: "ops", entityType: "repo_change", entityId: row.id, action: "forced_to_production", detail: { task_id: row.task_id, mail_id: input.mailId, by: input.sender, at, placeholders } });
  await logEvent(env.DB, { level: "warn", scope: "intake", event: "repo_change_forced_to_production", lane: "ops", entityId: row.id, detail: { by: input.sender, at, placeholders, repo: row.repo } });
  return placeholders;
}

export function describePhase(row: { phase: string; pr_url?: string | null; preview_url?: string | null }): string {
  switch (row.phase) {
    case "plan": return "waiting for the Mac to write the plan";
    case "asking": return "waiting for your reply to the plan";
    case "build": return "approved and waiting for the Mac to build it";
    case "preview": return `built${row.pr_url ? ` (${row.pr_url})` : ""}; the Mac is sending you the preview`;
    case "previewing": return `previewed${row.pr_url ? ` (${row.pr_url})` : ""} and waiting for your second "approved"`;
    case "landing": return `built${row.pr_url ? ` (${row.pr_url})` : ""} and waiting for the checks to go green`;
    case "land": return "green and waiting for the Mac to land it";
    case "done": return "landed and proven live";
    case "failed": return "stopped with a named reason";
    default: return row.phase;
  }
}

export function safeList(json: string | null | undefined): unknown[] {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
}
