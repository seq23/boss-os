/**
 * ONE EMAIL PER THING SHE NEEDS TO HEAR, COMPOSED IN THREE PARTS (R7, R8, R10, R16 — 6 Oct 2026).
 *
 * Every notice the Worker writes for her about a stopped task goes through `noticeOnce`:
 *
 *   · the body ends with the wait in three parts (`waitDetail`) — what is waiting, why, and the
 *     email reply that clears it — so no notice can leave the clearing step out;
 *   · the subject carries the task's token (`[tsk_…]`), so her reply names the task it answers and
 *     `service/blockReply.ts` takes the door the reply chose, for any employee and any kind;
 *   · ONE row per (task, kind, key): a retry that fails again, or a key still missing on the next
 *     run, never emails her twice (R16: said once, re-raised only on a state change).
 *
 * The Worker cannot send mail from a queue consumer (its only outbound mail is `message.reply()` on
 * a live inbound event), so it writes the row and `scripts/ops/task-notices.mjs` sends it from her Mac.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { taskToken, waitDetail, type BossWaitKind, type BossWaitFill } from "../../../shared/boss/service/waits.mjs";

export interface NoticeInput {
  task: { id: string; lane: string; title: string };
  fromName: string;
  kind: string;
  subject: string;
  lines: string[];
  /** The wait in three parts. Omitted only for a DONE notice, where nothing waits on her. */
  wait?: { kind: BossWaitKind; fill?: BossWaitFill } | null;
  secretName?: string | null;
}

/** The notice body: what happened, then the three parts. Exported so the tests read the same text. */
export function noticeBody(lines: readonly string[], wait: { kind: BossWaitKind; fill?: BossWaitFill } | null | undefined, taskId: string): string {
  return [
    ...lines,
    ...(wait ? ["", waitDetail(wait.kind, wait.fill ?? {})] : []),
    "", `Task ${taskId}. Reply to this email; the token in the subject tells Boss OS which task you mean.`,
  ].join("\n");
}

/** Write it once. Returns the notice id, or null when an identical one (task, kind, key) already exists. */
export async function noticeOnce(env: Env, n: NoticeInput): Promise<string | null> {
  const already = await env.DB
    .prepare(`SELECT id FROM boss_task_notices WHERE task_id = ? AND kind = ? AND COALESCE(secret_name, '') = ? LIMIT 1`)
    .bind(n.task.id, n.kind, n.secretName ?? "")
    .first<{ id: string }>();
  if (already) return null;
  const id = newId("tnt");
  const token = taskToken(n.task.id);
  const subject = n.subject.includes(token) ? n.subject : `${n.subject.slice(0, 160)} ${token}`;
  await env.DB
    .prepare(
      `INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, secret_name)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(id, n.task.id, n.task.lane, n.fromName, n.kind, subject, noticeBody(n.lines, n.wait, n.task.id), Date.now(), n.secretName ?? null)
    .run();
  return id;
}
