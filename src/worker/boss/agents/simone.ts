import type { Env } from "../env";
import { newId, sha256Hex } from "../lib/id";
import { AppError } from "../lib/http";
import { activeRoster } from "../intake/inboundMail";
import { admitTask } from "../tasks/admit";
import { readAssignments, type SimoneAssignment } from "../../../shared/boss/intake/simoneRouting.mjs";
import { shortTitle } from "../../../shared/boss/intake/triage.mjs";
import { constraintsOnRecord } from "../service/constraints";
import { dueLine, heldDue } from "../../../shared/boss/service/dueTime.mjs";
import { sizeUsdIn } from "../../../shared/boss/intake/handoff.mjs";

export const SIMONE = "emp_chief";
export const SIMONE_LEASE_MS = 3 * 60 * 60_000;
export const SIMONE_AVAILABLE = "json_extract(input, '$.taken_over') IS NULL AND json_extract(input, '$.held_by_her') IS NULL";
const CHIEF = "CASE WHEN json_valid(input) THEN json_extract(input, '$.agent') END = 'simone'";

export interface SimoneMessage {
  source: "boss_inbound_mail" | "tell_simone" | "boss_page" | "simone_daily";
  subject: string;
  body: string;
  context?: string;
  mail_id?: string;
  has_mail_material?: boolean;
  from?: string;
  message_id?: string;
  reply_chain?: string[];
  simone_handoff_plan?: SimoneAssignment[];
  simone_handoff_reply?: { text?: string; work?: string[] };
  thread_jobs?: Array<{ id: string; employee: string; title: string; status: string }>;
  to?: string;
}

export async function fileSimoneMessage(env: Env, message: SimoneMessage, key?: string, now?: number): Promise<string>;
export async function fileSimoneMessage(env: Env, message: SimoneMessage, key: string, now: number, arrival: { objectKey: string | null }): Promise<string | null>;
export async function fileSimoneMessage(env: Env, message: SimoneMessage, key?: string, now = Date.now(), arrival?: { objectKey: string | null }) {
  const id = key ? `tsk_${(await sha256Hex(`simone:${key}`)).slice(0, 32)}` : newId("tsk");
  const input = { ...message, agent: "simone" };
  const [, , linked] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tasks (id, lane, employee_id, title, input, status, created_at, intake_kind,
         execution_assignment, risk, sensitivity, audience, cost_mode)
       VALUES (?, 'ops', ?, ?, ?, 'queued', ?, 'one_off', 'AI_EXECUTE_WITH_NOTICE', 'low', 'internal', 'internal', 'FREE_ONLY')
       ON CONFLICT(id) DO NOTHING`,
    ).bind(id, SIMONE, message.subject.slice(0, 180) || "Message to Simone", JSON.stringify(input), now),
    env.DB.prepare(
      `INSERT INTO task_events (id, task_id, ts, event) VALUES (?, ?, ?, 'intake') ON CONFLICT(id) DO NOTHING`,
    ).bind(`tev_${id}_intake`, id, now),
    ...(arrival ? [env.DB.prepare(
      `UPDATE boss_inbound_mail SET outcome = 'SIMONE_QUEUED', why = 'Simone has the message on her work list.',
         employee_id = ?, task_id = ?, object_key = ?, reply_state = 'agent_pending'
       WHERE id = ? AND authorised = 1 AND outcome = 'RECEIVED'
         AND id = (SELECT json_extract(input, '$.mail_id') FROM tasks WHERE id = ?)`,
    ).bind(SIMONE, id, arrival.objectKey, message.mail_id, id), env.DB.prepare(
      `UPDATE boss_inbound_mail SET outcome = 'DUPLICATE', why = 'This delivery already has a Simone run.',
         object_key = ?, reply_state = 'none_due'
       WHERE id = ? AND authorised = 1 AND outcome = 'RECEIVED'`,
    ).bind(arrival.objectKey, message.mail_id)] : []),
  ]);
  return !arrival || linked?.meta.changes ? id : null;
}

interface ClaimedTask {
  id: string;
  input: string;
  attempts: number;
  created_at: number;
}

export async function claimSimone(env: Env, now = Date.now(), cloud = false) {
  const [roster, constraints] = await Promise.all([activeRoster(env), constraintsOnRecord(env.DB)]);
  const row = await env.DB.prepare(
    `UPDATE tasks SET status = 'running', started_at = ?, attempts = COALESCE(attempts, 0) + 1
       WHERE id = (
         SELECT id FROM tasks WHERE employee_id = ? AND ${CHIEF} AND ${SIMONE_AVAILABLE}
           AND (status = 'queued' OR (status = 'running' AND started_at <= ?))
           AND (? = 0 OR (json_extract(input, '$.source') IN ('boss_inbound_mail', 'tell_simone', 'boss_page') AND created_at <= ?))
         ORDER BY attempts, created_at, id LIMIT 1
       ) RETURNING id, input, attempts, created_at`,
  ).bind(now, SIMONE, now - SIMONE_LEASE_MS, Number(cloud), now - 30 * 60_000).first<ClaimedTask>();
  if (!row) return null;
  const message: SimoneMessage = JSON.parse(row.input);
  return {
    id: row.id, lease: row.attempts, message, roster, constraints,
    receivedAt: new Date(row.created_at).toISOString(), pendingHandoffs: message.simone_handoff_plan,
  };
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

export async function replySimone(env: Env, result: { id: string; lease: number; text: string; work: string[]; stop?: "ACTION_RESTRICTED" }, now = Date.now()) {
  const text = result.text.trim();
  const refused = result.stop === "ACTION_RESTRICTED";
  if (!text || (!refused && !result.work.length) || !result.work.every((item) => typeof item === "string" && item.trim())) return false;
  const db = env.DB;
  const noticeId = `tnt_${result.id}_simone`;
  const leased = `id = ? AND employee_id = ? AND ${CHIEF} AND ${SIMONE_AVAILABLE} AND status = 'running' AND attempts = ?`;
  const newer = await db.prepare(`UPDATE tasks SET input = json_remove(input, '$.steer_pending'), status = 'queued', started_at = NULL
    WHERE ${leased} AND json_extract(input, '$.steer_pending') = 1`).bind(result.id, SIMONE, result.lease).run();
  if (newer.meta.changes) return false;
  const current = `${leased} AND json_extract(input, '$.steer_pending') IS NULL`;
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
       SELECT ?, id, ?, ?, ? FROM tasks WHERE ${current}
       ON CONFLICT(id) DO NOTHING`,
    ).bind(`tev_${result.id}_reply`, now, refused ? "refused" : "completed", receipts, result.id, SIMONE, result.lease),
    db.prepare(
      `UPDATE boss_inbound_mail SET reply_state = 'due'
       WHERE outcome = 'SIMONE_QUEUED' AND reply_state = 'agent_pending' AND authorised = 1
         AND id = (SELECT json_extract(input, '$.mail_id') FROM tasks WHERE ${current})`,
    ).bind(result.id, SIMONE, result.lease),
    db.prepare(
      `UPDATE tasks SET status = ?, output = ?, finished_at = ?, error = ? WHERE ${current}`,
    ).bind(refused ? "cancelled" : "done", JSON.stringify({ text, work: result.work }), now, result.stop ?? null,
      result.id, SIMONE, result.lease),
  ]);
  return Boolean(writes.at(-1)?.meta.changes);
}

/** Materialize only verbatim owner instructions, using the team’s normal permission envelopes and queue. */
export async function handoffSimone(env: Env, request: { id: string; lease: number; assignments: unknown; text?: string; work?: string[] }) {
  const row = await env.DB.prepare(
    `SELECT input FROM tasks WHERE id = ? AND employee_id = ? AND ${CHIEF}
       AND ${SIMONE_AVAILABLE} AND status = 'running' AND attempts = ?`,
  ).bind(request.id, SIMONE, request.lease).first<Pick<ClaimedTask, "input">>();
  if (!row) return null;
  const message: SimoneMessage = JSON.parse(row.input);
  if (message.source === "simone_daily") return null;
  const roster = await activeRoster(env);
  const proposed = readAssignments(message.simone_handoff_plan ?? request.assignments, { message, roster });
  if (!proposed?.length) return null;
  const saved = await env.DB.prepare(`UPDATE tasks SET input = CASE
      WHEN json_type(input, '$.simone_handoff_plan') IS NULL
      THEN json_set(input, '$.simone_handoff_plan', json(?), '$.simone_handoff_reply', json(?)) ELSE input END
    WHERE id = ? AND employee_id = ? AND ${CHIEF} AND ${SIMONE_AVAILABLE} AND status = 'running' AND attempts = ? RETURNING input`)
    .bind(JSON.stringify(proposed), JSON.stringify({ text: request.text, work: request.work }),
      request.id, SIMONE, request.lease).first<{ input: string }>();
  if (!saved) return null;
  const stored: SimoneMessage = JSON.parse(saved.input);
  const assignments = readAssignments(stored.simone_handoff_plan, { message, roster });
  if (!assignments?.length) return null;
  const out: { name: string; id: string; start?: SimoneAssignment["start"] }[] = [];
  const refused: string[] = [];
  for (const assignment of assignments) {
    const seat = roster.find((employee) => employee.id === assignment.employee)!;
    const key = await sha256Hex(JSON.stringify([request.id, seat.id, assignment.words]));
    const id = `tsk_${key.slice(0, 32)}`;
    const startAt = assignment.start ? Date.parse(assignment.start.at) : null;
    const hunt = assignment.hunt && {
      asset: assignment.hunt.asset, size_usd: sizeUsdIn(assignment.hunt.size), side: assignment.hunt.side,
    };
    const existing = await env.DB.prepare(`SELECT status, envelope_id FROM tasks WHERE id = ?`).bind(id)
      .first<{ status: string; envelope_id: string | null }>();
    if (existing) {
      if (!existing.envelope_id) throw new Error("Simone handoff has no permission envelope");
      if (existing.status === "queued") {
        const delay = startAt === null ? 0 : Math.ceil((startAt - Date.now()) / 1000);
        await env.TASKS.send({ taskId: id, lane: seat.lane }, delay > 0 ? { delaySeconds: delay } : undefined);
      }
    } else {
      try {
        const admitted = await admitTask(env, {
          title: shortTitle(assignment.words, 80) || "Work from Simone", lane: seat.lane, employee_id: seat.id,
          cost_mode: "FREE_ONLY",
          not_before: startAt,
          input: {
            source: message.source === "boss_inbound_mail" ? message.source : "boss_page",
            body: assignment.words, mail_id: message.mail_id,
            ...(message.context ? { untrusted_context: message.context } : {}),
            ...(assignment.delivery === "repository" ? { build_ask: true } : {}),
            ...(assignment.start ? { not_before: assignment.start, due: heldDue(null, assignment.start) } : {}),
            ...(hunt ? { hunt } : {}),
            ...(assignment.follows ? { follows_task: assignment.follows } : {}),
            from: message.from, subject: message.subject, simone_handoff: request.id,
          },
        }, {
          id, chrome: assignment.delivery === "chrome",
          ...(assignment.delivery === "research_page" ? { researchQuestion: assignment.words } : {}),
        });
        if (!admitted.created) {
          refused.push(admitted.reason ?? `${seat.name} did not accept the request.`);
          continue;
        }
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 400) throw error;
        refused.push(error.message);
        continue;
      }
    }
    out.push({ name: seat.name, id, ...(assignment.start ? { start: assignment.start } : {}) });
  }
  return { handoffs: out, refused, reply: stored.simone_handoff_reply };
}

export async function finishSimoneHandoff(env: Env, request: { id: string; lease: number; assignments: unknown; text?: string; work?: string[] }) {
  const completed = await handoffSimone(env, request);
  if (!completed) return { replied: false, refused: false };
  const { handoffs, refused, reply } = completed;
  const names = [...new Set(handoffs.map(({ name }) => name))];
  const note = names.length ? `I handed this to ${new Intl.ListFormat("en-US", { type: "conjunction" }).format(names)}.` : null;
  const holds = handoffs.flatMap(({ name, start }) => start && Date.parse(start.at) > Date.now()
    ? [`${name}’s work is held until ${dueLine({ due_at: start.at, due_words: start.words })!.replace(/^due /, "")}.`] : []);
  const work = [...(reply?.work ?? []), ...handoffs.map(({ id }) => id)];
  const stopped = !work.length && refused.length > 0;
  const replied = await replySimone(env, {
    id: request.id, lease: request.lease, text: [reply?.text, note, ...holds, ...refused].filter(Boolean).join("\n\n"),
    work,
    ...(stopped ? { stop: "ACTION_RESTRICTED" as const } : {}),
  });
  return { replied, refused: replied && stopped };
}
