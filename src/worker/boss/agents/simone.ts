import type { Env } from "../env";
import { newId } from "../lib/id";
import { activeRoster } from "../intake/inboundMail";
import { admitTask } from "../tasks/admit";
import { SIMONE_ROUTING, readAssignments, routingInstructions, routingRequest, type SimoneAssignment } from "../../../shared/boss/intake/simoneRouting.mjs";
import { readJsonObject } from "../router/types";
import { routeCompletion } from "../router";
import { macSeen } from "../queue/freeRung";
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

export async function claimSimone(env: Env, now = Date.now(), cloud = false) {
  const roster = await activeRoster(env);
  const row = await env.DB.prepare(
    `UPDATE tasks SET status = 'running', started_at = ?, attempts = COALESCE(attempts, 0) + 1
       WHERE id = (
         SELECT id FROM tasks WHERE employee_id = ? AND ${CHIEF}
           AND (status = 'queued' OR (status = 'running' AND started_at <= ?))
           AND (? = 0 OR (json_extract(input, '$.source') = 'boss_inbound_mail' AND created_at <= ?))
         ORDER BY created_at, id LIMIT 1
       ) RETURNING id, input, attempts, model_access, sensitivity`,
  ).bind(now, SIMONE, now - SIMONE_LEASE_MS, Number(cloud), now - 30 * 60_000).first<ClaimedTask>();
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

/** Materialize only verbatim owner instructions, using the team’s normal permission envelopes and queue. */
export async function handoffSimone(env: Env, request: { id: string; lease: number; assignments: unknown }) {
  const row = await env.DB.prepare(
    `SELECT input FROM tasks WHERE id = ? AND employee_id = ? AND ${CHIEF}
       AND status = 'running' AND attempts = ?`,
  ).bind(request.id, SIMONE, request.lease).first<{ input: string }>();
  if (!row) return null;
  const message: SimoneMessage = JSON.parse(row.input);
  const roster = await activeRoster(env);
  const assignments: SimoneAssignment[] | null = readAssignments(request.assignments, { message, roster });
  if (!assignments?.length) return null;
  const out: { name: string; id: string }[] = [];
  for (const assignment of assignments) {
    const seat = roster.find((employee) => employee.id === assignment.employee)!;
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([seat.id, assignment.words])));
    const key = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const id = `${request.id}_handoff_${key}`;
    const existing = await env.DB.prepare(`SELECT status, envelope_id FROM tasks WHERE id = ?`).bind(id)
      .first<{ status: string; envelope_id: string | null }>();
    if (existing) {
      if (!existing.envelope_id) throw new Error("Simone handoff has no permission envelope");
      if (existing.status === "queued") await env.TASKS.send({ taskId: id, lane: seat.lane });
    } else {
      const admitted = await admitTask(env, {
        title: message.subject.slice(0, 180) || "Work from Simone", lane: seat.lane, employee_id: seat.id,
        input: {
          source: message.source, body: assignment.words, mail_id: message.mail_id,
          from: message.from, subject: message.subject, simone_handoff: request.id,
        },
      }, id);
      if (!admitted.created) throw new Error("Simone handoff could not be admitted");
    }
    out.push({ name: seat.name, id });
  }
  return out;
}

export async function finishSimoneHandoff(env: Env, request: { id: string; lease: number; assignments: unknown; text?: string; work?: string[] }) {
  const handoffs = await handoffSimone(env, request);
  if (!handoffs) return false;
  const names = [...new Set(handoffs.map(({ name }) => name))];
  const note = `I handed this to ${new Intl.ListFormat("en-US", { type: "conjunction" }).format(names)}.`;
  return replySimone(env, {
    ...request, text: [request.text, note].filter(Boolean).join("\n\n"),
    work: [...(request.work ?? []), ...handoffs.map(({ id }) => id)],
  });
}

export async function routeSimoneWhenMacIsDown(env: Env, now = Date.now(), route = routeCompletion) {
  if (await macSeen(env, now)) return "mac_online";
  const call = await claimSimone(env, now, true);
  if (!call) return "idle";
  let code = call.privateOnly ? "PRIVATE_MODEL_ONLY" : "MODEL_UNAVAILABLE";
  try {
    if (!call.privateOnly) {
      const parse = (text: string) => readAssignments(readJsonObject(text)?.assignments, call);
      const messages = [
        { role: "system" as const, content: `${routingInstructions}\nReturn JSON with an assignments array of employee and words objects.` },
        { role: "user" as const, content: routingRequest(call) },
      ];
      for (const onlyProviderId of ["prv_workers_ai", "prv_gemini"]) {
        const result = await route(env, {
          onlyProviderId, messages, routeId: "rt_ops_default", lane: "ops", employeeId: SIMONE,
          taskId: call.id, intakeKind: "classification", costMode: "FREE_ONLY", freeOnly: true,
          maxOutputTokens: 2048, json: SIMONE_ROUTING, accept: (text) => parse(text) === null ? "invalid Simone handoff" : null,
        }).catch(() => null);
        const assignments = result ? parse(result.text) : null;
        if (assignments === null) continue;
        if (assignments.length && await finishSimoneHandoff(env, { ...call, assignments })) return "handed_off";
        code = "WAITING_FOR_MAC";
        break;
      }
    }
  } catch {
    code = "HANDOFF_UNAVAILABLE";
  }
  await releaseSimone(env, call.id, call.lease, code);
  return code;
}
