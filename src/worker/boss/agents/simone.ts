import type { Env } from "../env";
import { newId } from "../lib/id";
import { activeRoster } from "../intake/inboundMail";
import { privateLexicon, scanForModelAccess } from "../router/modelAccess";

export const SIMONE = "emp_chief";
export const SIMONE_LEASE_MS = 3 * 60 * 60_000;
const CHIEF = "json_extract(input, '$.agent') = 'simone'";

export interface SimoneMessage {
  source: "boss_inbound_mail" | "tell_simone" | "boss_page" | "simone_daily";
  subject: string;
  body: string;
  context?: string;
  mail_id?: string;
  from?: string;
  message_id?: string;
  reply_chain?: string[];
  to?: string;
}

export async function fileSimoneMessage(env: Env, message: SimoneMessage, key?: string, now = Date.now()) {
  const id = key ? `tsk_simone_${key}` : newId("tsk");
  const input = { ...message, agent: "simone" };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tasks (id, lane, employee_id, title, input, status, created_at, intake_kind,
         execution_assignment, risk, sensitivity, audience, cost_mode)
       VALUES (?, 'ops', ?, ?, ?, 'queued', ?, 'one_off', 'AI_EXECUTE_WITH_NOTICE', 'low', 'internal', 'internal', 'FREE_ONLY')
       ON CONFLICT(id) DO NOTHING`,
    ).bind(id, SIMONE, message.subject.slice(0, 180) || "Message to Simone", JSON.stringify(input), now),
    env.DB.prepare(
      `INSERT INTO task_events (id, task_id, ts, event) VALUES (?, ?, ?, 'intake') ON CONFLICT(id) DO NOTHING`,
    ).bind(`tev_${id}_intake`, id, now),
  ]);
  return id;
}

interface ClaimedTask {
  id: string;
  input: string;
  attempts: number;
  model_access: string | null;
  sensitivity: string | null;
}

export async function claimSimone(env: Env, now = Date.now()) {
  const roster = await activeRoster(env);
  const row = await env.DB.prepare(
    `UPDATE tasks SET status = 'running', started_at = ?, attempts = COALESCE(attempts, 0) + 1
       WHERE id = (
         SELECT id FROM tasks WHERE employee_id = ? AND ${CHIEF}
           AND (status = 'queued' OR (status = 'running' AND started_at <= ?))
         ORDER BY created_at, id LIMIT 1
       ) RETURNING id, input, attempts, model_access, sensitivity`,
  ).bind(now, SIMONE, now - SIMONE_LEASE_MS).first<ClaimedTask>();
  if (!row) return null;
  const message: SimoneMessage = JSON.parse(row.input);
  const access = scanForModelAccess(
    [{ role: "user", content: [message.subject, message.body, message.context].filter(Boolean).join("\n") }],
    await privateLexicon(env.DB), { modelAccess: row.model_access, sensitivity: row.sensitivity },
  );
  return { id: row.id, lease: row.attempts, message, privateOnly: access.privateOnly, roster };
}

export async function simoneMessageStatus(env: Env, id: string) {
  const row = await env.DB.prepare(
    `SELECT status, output FROM tasks WHERE id = ? AND employee_id = ? AND ${CHIEF}
       AND json_extract(input, '$.source') IN ('tell_simone', 'boss_page')`,
  ).bind(id, SIMONE).first<{ status: string; output: string | null }>();
  if (!row) return null;
  const result = row.output ? JSON.parse(row.output) : null;
  return { status: row.status, reply: result?.text ?? null };
}

export async function releaseSimone(env: Env, id: string, lease: number, code: string) {
  const result = await env.DB.prepare(
    `UPDATE tasks SET status = 'queued', started_at = NULL, error = ?
       WHERE id = ? AND employee_id = ? AND ${CHIEF} AND status = 'running' AND attempts = ?`,
  ).bind(code, id, SIMONE, lease).run();
  return Boolean(result.meta.changes);
}

export async function replySimone(env: Env, result: { id: string; lease: number; text: string; work: string[] }, now = Date.now()) {
  const text = result.text.trim();
  if (!text || !result.work.length || !result.work.every((item) => typeof item === "string" && item.trim())) return false;
  const db = env.DB;
  const noticeId = `tnt_${result.id}_simone`;
  const current = `id = ? AND employee_id = ? AND ${CHIEF} AND status = 'running' AND attempts = ?`;
  const receipts = JSON.stringify(result.work);
  const writes = await db.batch([
    db.prepare(
      `INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, needs_her)
       SELECT ?, id, lane, 'Simone', 'simone_result', json_extract(input, '$.subject'), ?, ?, 1
       FROM tasks WHERE ${current} AND json_extract(input, '$.source') = 'boss_inbound_mail'
       ON CONFLICT(id) DO NOTHING`,
    ).bind(noticeId, text, now, result.id, SIMONE, result.lease),
    db.prepare(
      `INSERT INTO task_events (id, task_id, ts, event, detail)
       SELECT ?, id, ?, 'completed', ? FROM tasks WHERE ${current}
       ON CONFLICT(id) DO NOTHING`,
    ).bind(`tev_${result.id}_complete`, now, receipts, result.id, SIMONE, result.lease),
    db.prepare(
      `UPDATE tasks SET status = 'done', output = ?, finished_at = ?, error = NULL WHERE ${current}`,
    ).bind(JSON.stringify({ text, work: result.work }), now, result.id, SIMONE, result.lease),
  ]);
  return Boolean(writes[2]?.meta.changes);
}
