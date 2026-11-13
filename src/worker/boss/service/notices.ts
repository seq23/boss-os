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
import { needsHer } from "../../../shared/boss/mail/noticeGate.mjs";

export interface NoticeInput {
  task: { id: string; lane: string; title: string };
  fromName: string;
  kind: string;
  subject: string;
  lines: string[];
  /** The wait in three parts. Omitted only for a DONE notice, where nothing waits on her. */
  wait?: { kind: BossWaitKind; fill?: BossWaitFill } | null;
  secretName?: string | null;
  /**
   * Email or the Updates page (owner, 7 Nov 2026: email only when she must act). Omitted → read from
   * the kind by `needsHer` (noticeGate.mjs). The drain on her Mac reads this field and nothing else.
   */
  needsHer?: boolean;
}

/** The notice body: what happened, then the three parts. Exported so the tests read the same text. */
export function noticeBody(lines: readonly string[], wait: { kind: BossWaitKind; fill?: BossWaitFill } | null | undefined, taskId: string): string {
  return [
    ...lines,
    ...(wait ? ["", waitDetail(wait.kind, wait.fill ?? {})] : []),
    "", `Reply to this email and your answer goes straight back to this job. ${taskId}`,
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
  // A repair Boss OS opened itself never waits on her (noticeGate.mjs needsHer `repair`).
  const row = await env.DB.prepare(`SELECT input FROM tasks WHERE id = ?`).bind(n.task.id).first<{ input: string | null }>().catch(() => null);
  let repair = false;
  // A dated waiting-on check-in can need her own account (the Friday unsubscribe taps): not a repair here.
  try { const i = JSON.parse(row?.input ?? "{}") as { origin?: unknown; repair_kind?: unknown }; repair = i?.origin === "repair" && i?.repair_kind !== "waiting_on"; } catch { repair = false; }
  const her = repair ? needsHer({ kind: n.kind, repair }) : (n.needsHer ?? needsHer({ kind: n.kind }));
  const subject = n.subject.includes(token) ? n.subject : `${n.subject.slice(0, 160)} ${token}`;
  await env.DB
    .prepare(
      `INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, secret_name, needs_her)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(id, n.task.id, n.task.lane, n.fromName, n.kind, subject, noticeBody(n.lines, n.wait, n.task.id), Date.now(), n.secretName ?? null,
      her ? 1 : 0)
    .run();
  return id;
}

/** How long a duty may go without a finished run before she is told, once (owner, 13 Nov 2026: 2 days running). */
export const DUTY_NOT_RUNNING_MS = 24 * 3600_000;

/**
 * THE ONE ALARM FOR A DUTY THAT HAS NOT RUN 2 DAYS RUNNING. Called by queue/consumer.ts each time a duty's own
 * run waits or stops. It reads the duty's runs by their title (every run a duty makes carries its `task_title`): the
 * oldest run since the last finished one. Once that is a day old the duty has missed two days running,
 * and ONE notice is written for it (kind `duty_not_running`, keyed on the duty, not the attempt); none
 * again until a run finishes. Her Mac's drain lays it out as an alarm (task-notices.mjs
 * `dutyAlarmEmail`). Returns the notice id, or null when it is not time or she was already told.
 */
export async function dutyNotRunning(
  env: Env, duty: { id: string; name: string; task_title: string }, o: { now?: number; backAt?: string | null } = {},
): Promise<string | null> {
  const now = o.now ?? Date.now();
  const good = await env.DB.prepare(`SELECT MAX(COALESCE(finished_at, created_at)) AS at FROM tasks WHERE title = ? AND status IN ('done','awaiting_approval')`).bind(duty.task_title).first<{ at: number | null }>();
  const since = Number(good?.at ?? 0);
  const first = await env.DB.prepare(`SELECT MIN(created_at) AS at FROM tasks WHERE title = ? AND status NOT IN ('done','awaiting_approval','cancelled') AND created_at > ?`)
    .bind(duty.task_title, since).first<{ at: number | null }>();
  if (!first?.at || now - Number(first.at) < DUTY_NOT_RUNNING_MS) return null;
  const told = await env.DB.prepare(`SELECT id FROM boss_task_notices WHERE task_id = ? AND kind = 'duty_not_running' AND created_at > ? LIMIT 1`).bind(duty.id, since).first<{ id: string }>();
  if (told) return null;
  const name = String(duty.name || duty.task_title);
  const id = newId("tnt");
  const body = [
    `What broke: "${name}" has not run for 2 days. ${o.backAt ? "The AI it may use is out of usage." : "It stopped each time it was tried."}`,
    "What was lost: Nothing. The job is kept, and nothing was sent to anyone.",
    o.backAt
      ? `What is being done: It is set to start again by itself when the usage is back, ${o.backAt}.`
      : "What is being done: Danielle is finding out why and fixing it. It runs again when that is done.",
  ].join("\n");
  await env.DB.prepare(
    `INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, needs_her) VALUES (?,?,'ops','Kendra','duty_not_running',?,?,?,1)`,
  ).bind(id, duty.id, `Not running for 2 days: ${name.slice(0, 120)}`, body, now).run();
  return id;
}
