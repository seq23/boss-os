import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { tokenIn, REPO_CHANGE_SEAT } from "../../../shared/boss/repoChange/lane.mjs";

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
  asked_at: number | null; ask_message_id: string | null; answered_at: number | null; answers_text: string | null; answer_mail_id: string | null;
  branch: string | null; pr_url: string | null; pr_number: number | null; built_at: number | null; build_written_by: string | null; proof_json: string | null;
  checks_state: string | null; checks_detail: string | null; checks_green_at: number | null;
  merge_sha: string | null; landed_at: number | null; live_proof_json: string | null;
  claimed_at: number | null; claimed_by: string | null; claimed_phase: string | null; run_log: string | null;
  done_at: number | null; done_message_id: string | null; failure: string | null;
  created_at: number; updated_at: number;
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
  env: Env, input: { seatId: string; subject: string; text: string; mailId: string; now: number },
): Promise<{ changeId: string; resumed: boolean; note: string } | null> {
  if (input.seatId !== REPO_CHANGE_SEAT) return null;
  const changeId = tokenIn(`${input.subject}\n${input.text}`);
  if (!changeId) return null;
  const row = await repoChangeById(env, changeId);
  if (!row) return { changeId, resumed: false, note: `Your message names ${changeId}, and no repo change has that id. Nothing was changed.` };

  if (row.phase !== "asking") {
    await taskEvent(env, row.task_id, "repo_change_note", { repo_change_id: row.id, mail_id: input.mailId, phase: row.phase, text: input.text.slice(0, 4000) });
    return {
      changeId, resumed: false,
      note: `Noted on ${row.id} (${row.repo ?? "package"}), which is ${describePhase(row)} — a reply changes nothing at this stage. If you want something different, send a new #danielle instruction.`,
    };
  }

  const answers = input.text.trim();
  if (!answers) {
    return { changeId, resumed: false, note: `Your reply to ${row.id} carried no readable text, so nothing was recorded and the change is still waiting on you.` };
  }
  await env.DB
    .prepare(`UPDATE repo_changes SET phase = 'build', answered_at = ?, answers_text = ?, answer_mail_id = ?, updated_at = ? WHERE id = ? AND phase = 'asking'`)
    .bind(input.now, answers.slice(0, 20_000), input.mailId, input.now, row.id)
    .run();
  await taskEvent(env, row.task_id, "repo_change_answered", { repo_change_id: row.id, mail_id: input.mailId, chars: answers.length });
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
    note: `Got it — your reply is on the record as the plan approval for ${row.id} (${row.repo ?? "the package"})${asks ? `, answering ${asks} question${asks === 1 ? "" : "s"}` : ""}. ` +
      "Danielle builds it on your Mac at the next tick, opens the pull request, and lands it once the checks are green. You will get one more email with the PR, the merge commit and the live proof.",
  };
}

export function describePhase(row: { phase: string; pr_url?: string | null }): string {
  switch (row.phase) {
    case "plan": return "waiting for the Mac to write the plan";
    case "asking": return "waiting for your reply to the plan";
    case "build": return "approved and waiting for the Mac to build it";
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
