import type { Env } from "../env";
import { newId } from "../lib/id";
import { SIMONE } from "./simone";

const READS = {
  morning: `SELECT day, updated_at, sent_at FROM morning_digests ORDER BY day DESC LIMIT 3`,
  invitations: `SELECT id, title, starts_at, ends_at, status FROM owner_invitations ORDER BY starts_at DESC LIMIT 30`,
  errands: `SELECT id, state, updated_at FROM boss_commands WHERE kind = 'errand' ORDER BY updated_at DESC LIMIT 30`,
  meeting_prep: `SELECT id, state, updated_at FROM boss_commands WHERE kind = 'meeting_prep' ORDER BY updated_at DESC LIMIT 30`,
  kdp: `SELECT title_ref, label, state, updated_at FROM kdp_titles ORDER BY updated_at DESC LIMIT 30`,
  mail_tail: `SELECT id, received_at, authorised, subject, outcome, reply_state FROM boss_inbound_mail ORDER BY received_at DESC LIMIT 30`,
  team: `SELECT t.id, t.title, t.status, t.started_at, t.finished_at, e.name AS employee FROM tasks t
    JOIN employees e ON e.id = t.employee_id WHERE t.lane = 'ops' AND t.employee_id <> 'emp_chief'
      AND t.status IN ('failed','running','queued') ORDER BY t.created_at DESC LIMIT 30`,
} as const;

export async function simoneTool(env: Env, request: { id: string; lease: number; tool: string; task?: unknown }, now = Date.now()) {
  const active = await env.DB.prepare(`SELECT id FROM tasks WHERE id = ? AND employee_id = ? AND status = 'running'
    AND attempts = ? AND json_extract(input, '$.agent') = 'simone'`).bind(request.id, SIMONE, request.lease).first();
  if (!active) return { ok: false, code: "STALE_SIMONE_RUN" } as const;
  if (Object.hasOwn(READS, request.tool)) {
    const { results } = await env.DB.prepare(READS[request.tool as keyof typeof READS]).all();
    return { ok: true, rows: results } as const;
  }
  if (request.tool !== "retry_team_task") return { ok: false, code: "TOOL_NOT_ALLOWED" } as const;
  if (typeof request.task !== "string" || request.task.length > 160) return { ok: false, code: "TASK_REQUIRED" } as const;
  // Keep approvals, repo lanes and external effects out of the repair tool. There is no generic API proxy.
  const changed = await env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL
    WHERE id = ? AND status = 'failed' AND lane = 'ops' AND employee_id <> ? AND risk = 'low' AND audience = 'internal'
      AND execution_assignment = 'AI_EXECUTE_WITH_NOTICE' AND intake_kind IN ('research','one_off') AND envelope_id IS NOT NULL
      AND attempts < 3
      AND NOT EXISTS (SELECT 1 FROM repo_changes WHERE task_id = tasks.id)
    RETURNING id, lane`).bind(request.task, SIMONE).first<{ id: string; lane: string }>();
  if (!changed) return { ok: false, code: "TASK_NOT_RETRYABLE" } as const;
  try {
    await env.TASKS.send({ taskId: changed.id, lane: changed.lane });
  } catch {
    await env.DB.prepare(`UPDATE tasks SET status = 'failed', error = 'QUEUE_UNAVAILABLE', finished_at = ?
      WHERE id = ? AND status = 'queued'`).bind(now, changed.id).run();
    return { ok: false, code: "QUEUE_UNAVAILABLE" } as const;
  }
  await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'requeued',?)`)
    .bind(newId("tev"), changed.id, now, JSON.stringify({ by: "Simone", run: request.id })).run();
  return { ok: true, receipt: changed.id } as const;
}
