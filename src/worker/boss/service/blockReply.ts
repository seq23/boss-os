/**
 * HER EMAIL REPLY TO A STOPPED TASK DOES WHAT IT SAYS — ANY EMPLOYEE, ANY KIND (R8, R20; 6 Oct 2026).
 *
 * Every notice about a stopped task carries `[tsk_…]` in its subject and ends with the three parts,
 * whose clearing step is a reply: "try again", "drop it", or her answer. This is the door those
 * replies take, before any other reading of the message:
 *
 *   DROP   — "drop it" / "cancel it" / "never mind": the task is cancelled, and says so;
 *   RETRY  — "try again", or a short positive reply ("yes", "go ahead", "ok"): it runs again;
 *   ANSWER — anything else is her answer: it is added to the task's words and the task runs again.
 *
 * A REPLY IS PERMISSION — INSIDE BOSS OS'S AUTHORITY MODEL. Only a task that FAILED is reopened here.
 * A task held in the Approval Inbox (`awaiting_approval`) is never released by an email: that is a
 * Tier 2 or a budget decision, and docs/AUTHORITY_MODEL.md keeps those to her own hand. The reply
 * says so in three parts instead of pretending it acted.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { blockReplyDoor, taskTokenIn, waitDetail } from "../../../shared/boss/service/waits.mjs";

export interface BlockReplyOutcome { note: string; taskId: string; door: "RETRY" | "DROP" | "ANSWER" | "HELD" }

export async function answerBlockFromMail(
  env: Env,
  m: { subject: string; text: string; mailId: string; now: number },
): Promise<BlockReplyOutcome | null> {
  const taskId = taskTokenIn(m.subject) ?? taskTokenIn(m.text.split(/\r?\n/).slice(0, 3).join("\n"));
  if (!taskId) return null;
  const task = await env.DB
    .prepare(`SELECT id, lane, title, status, input FROM tasks WHERE id = ?`)
    .bind(taskId)
    .first<{ id: string; lane: string; title: string; status: string; input: string | null }>();
  if (!task) return null;
  if (task.status === "awaiting_approval") {
    // Her words are written on the record (the task's events), and nothing is released by them.
    await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'reply_while_held',?)`)
      .bind(newId("tev"), task.id, m.now, JSON.stringify({ mail_id: m.mailId, text: m.text.trim().slice(0, 2000) }))
      .run();
    return {
      taskId, door: "HELD",
      note: `"${task.title}" (${task.id}) is held for an approval, so a reply does not release it. ${waitDetail("TIER2_DECISION", { what: task.title })}`,
    };
  }
  if (task.status !== "failed") return null;
  const door = blockReplyDoor(m.text);
  const now = m.now;
  if (door === "DROP") {
    await env.DB.batch([
      env.DB.prepare(`UPDATE tasks SET status = 'cancelled', finished_at = ? WHERE id = ?`).bind(now, task.id),
      env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'dropped_by_reply',?)`)
        .bind(newId("tev"), task.id, now, JSON.stringify({ mail_id: m.mailId })),
    ]);
    await audit(env.DB, { actor: "boss", lane: task.lane, entityType: "task", entityId: task.id, action: "dropped_by_reply", detail: { mail_id: m.mailId } });
    return { taskId, door, note: `Dropped "${task.title}" (${task.id}) on your reply. Nothing more will be tried or sent about it.` };
  }
  let input: Record<string, unknown> = {};
  try { input = task.input ? JSON.parse(task.input) : {}; } catch { input = {}; }
  const answer = door === "ANSWER" ? m.text.trim().slice(0, 8000) : "";
  if (answer) {
    const before = typeof input.body === "string" ? input.body : "";
    input = { ...input, body: `${before}${before ? "\n\n" : ""}Her reply after the stop: ${answer}` };
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL, input = ? WHERE id = ?`)
      .bind(JSON.stringify(input), task.id),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'requeued_by_reply',?)`)
      .bind(newId("tev"), task.id, now, JSON.stringify({ mail_id: m.mailId, door })),
  ]);
  await env.TASKS.send({ taskId: task.id, lane: task.lane });
  await audit(env.DB, { actor: "boss", lane: task.lane, entityType: "task", entityId: task.id, action: "requeued_by_reply", detail: { mail_id: m.mailId, door } });
  return {
    taskId, door,
    note: door === "ANSWER"
      ? `"${task.title}" (${task.id}) is running again with your reply added to it. The result comes to you by email.`
      : `"${task.title}" (${task.id}) is running again on your word. The result comes to you by email.`,
  };
}
