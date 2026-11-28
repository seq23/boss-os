/**
 * ONE ROUND, ONE REPLY (15 Nov 2026, the West Peek OS rule brought to Boss OS).
 *
 * Emailing her system should feel like typing to Claude in a chat: everything she writes is read
 * once, acted on, and answered once. A ROUND is every email she sends on a job before that job's
 * answer is sent. Its id is the mail id of the email that opened the work (`input.round`, else
 * `input.mail_id`), so the jobs one email was split into are one round, and so is a later email that
 * joins them.
 *
 * Before this, a reply on a job's thread opened a NEW job: "stop" became work and stopped nothing,
 * and "also add X" was answered on its own, beside the first answer. One email split into three jobs
 * sent three answers.
 *
 *   · a later email on the thread while the work is queued or running is added to that job's words
 *     (`steerRound`); a job already running finishes, sees the new words, and runs once more before
 *     anything is sent (`steer_pending`), so ONE answer covers both emails;
 *   · "stop", "hold", "wait", "don't send" holds every open job of the round (`held_by_her`): nothing
 *     runs and nothing is sent until she says "go" (or writes again);
 *   · the answer waits until every job of the round has finished, then goes as ONE email covering
 *     each ask (`roundReady`, `flushRound`).
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { noticeOnce } from "./notices";
import { doneSubject } from "../../../shared/boss/service/doneSubject.mjs";

export interface RoundTask {
  id: string; lane: string; title: string; status: string; employee_id: string | null;
  input: Record<string, any>; created_at: number;
}

const OPEN = new Set(["queued", "running"]);

/** "stop", "hold", "wait", "don't send", "pause", "not yet" opening her own words. Pure. */
export function holdIn(own: string): string | null {
  const first = String(own ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const m = /^(stop|hold( off| on| it| this)?|wait|pause|not yet|don'?t send|do not send|don'?t do (it|this|that)|cancel that for now)\b/i.exec(first.replace(/^["'“]+/, ""));
  return m ? first.slice(0, 200) : null;
}

/** "go", "go ahead", "carry on", "continue", "resume", "approved", "ok", "send it". Pure. */
export function goIn(own: string): boolean {
  const t = String(own ?? "").trim().toLowerCase().replace(/[\s.!,]+$/g, "");
  return /^(go|go ahead|carry on|continue|resume|approved?|yes|ok(ay)?|send it|you can send( it)?|keep going)$/.test(t);
}

function parse(raw: string | null): Record<string, any> {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export function roundOf(input: Record<string, any>): string | null {
  const r = input?.round ?? input?.mail_id;
  return typeof r === "string" && r ? r : null;
}

export async function roundTasks(env: Env, round: string): Promise<RoundTask[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, lane, title, status, employee_id, input, created_at FROM tasks
      WHERE json_extract(input, '$.mail_id') = ?1 OR json_extract(input, '$.round') = ?1
      ORDER BY created_at, id`,
  ).bind(round).all<any>();
  return (results ?? []).map((r) => ({ ...r, input: parse(r.input) }));
}

/** The round her reply's thread names: the newest email of hers in the chain that opened work. */
async function roundForChain(env: Env, chain: string[], owner?: string): Promise<string | null> {
  if (!chain.length) return null;
  const marks = chain.map(() => "?").join(",");
  const rows = (await env.DB.prepare(
    `SELECT id FROM boss_inbound_mail WHERE message_id IN (${marks})
      AND (? IS NULL OR (authorised = 1 AND from_addr = ?)) ORDER BY received_at DESC LIMIT 20`,
  ).bind(...chain, owner ?? null, owner ?? null).all<{ id: string }>()).results ?? [];
  for (const r of rows) {
    const t = await env.DB.prepare(
      `SELECT input FROM tasks WHERE json_extract(input, '$.mail_id') = ? LIMIT 1`,
    ).bind(r.id).first<{ input: string | null }>();
    if (t) return roundOf(parse(t.input));
  }
  return null;
}

async function writeInput(env: Env, t: RoundTask, input: Record<string, any>, status?: string): Promise<void> {
  await env.DB.prepare(`UPDATE tasks SET input = ?${status ? ", status = ?, finished_at = NULL" : ""} WHERE id = ?`)
    .bind(...(status ? [JSON.stringify(input), status, t.id] : [JSON.stringify(input), t.id])).run();
}

async function event(env: Env, taskId: string, name: string, detail: Record<string, unknown>): Promise<void> {
  await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,?,?)`)
    .bind(newId("tev"), taskId, Date.now(), name, JSON.stringify(detail)).run();
}

export type SteerOutcome =
  | { outcome: "HELD" | "RELEASED" | "STEERED"; note: string; taskId: string }
  | { outcome: "JOIN"; round: string };

/**
 * Her reply on a job's thread while that round is still open. Null when the round has finished (its
 * answer went): then the email starts a new round, as before.
 */
export async function steerRound(env: Env, m: {
  chain: string[]; own: string; mailId: string; now: number; owner?: string; decision?: "hold" | "resume" | "amend";
}): Promise<SteerOutcome | null> {
  const round = await roundForChain(env, m.chain, m.owner);
  if (!round) return null;
  const tasks = await roundTasks(env, round);
  const held = tasks.filter((t) => t.input.held_by_her);
  const open = tasks.filter((t) => OPEN.has(t.status) && !t.input.held_by_her);
  if (!open.length && !held.length) return null;
  const titles = (ts: RoundTask[]) => ts.map((t) => `"${t.title}"`).join(", ");

  const hold = m.decision ? (m.decision === "hold" ? m.own.slice(0, 200) : null) : holdIn(m.own);
  if (hold) {
    for (const t of open) {
      await writeInput(env, t, { ...t.input, held_by_her: { words: hold, at: m.now, mail_id: m.mailId } });
      await event(env, t.id, "held_by_her", { mail_id: m.mailId, words: hold });
    }
    const all = [...open, ...held];
    return { outcome: "HELD", taskId: all[0]!.id, note: `Held: ${titles(all)}. Nothing more runs and nothing is sent until you reply "go".` };
  }

  const resume = m.decision ? m.decision === "resume" : goIn(m.own);
  const reschedule = async (t: RoundTask) => {
    if (t.input.agent !== "simone") await env.TASKS.send({ taskId: t.id, lane: t.lane });
  };
  const release = async (t: RoundTask, input: Record<string, any>) => {
    const { held_by_her: _h, ...rest } = input;
    // A job that finished while held runs again with everything she said; one still queued just goes.
    await writeInput(env, t, resume ? { ...rest, resumed_from_mail: m.mailId } : rest, "queued");
    await reschedule(t);
  };

  const alreadyResumed = resume ? open.filter((t) => t.input.resumed_from_mail === m.mailId) : [];
  if (resume && (held.length || alreadyResumed.length)) {
    for (const t of held) { await release(t, t.input); await event(env, t.id, "released_by_her", { mail_id: m.mailId }); }
    for (const t of alreadyResumed.filter((task) => task.status === "queued")) await reschedule(t);
    const resumed = [...held, ...alreadyResumed];
    return { outcome: "RELEASED", taskId: resumed[0]!.id, note: `Carrying on with ${titles(resumed)}. You'll get one answer when it's done.` };
  }
  if (m.decision === "resume") return null;

  const live = [...open, ...held];
  if (live.length !== 1) return { outcome: "JOIN", round };
  const t = live[0]!;
  const words = m.own.trim().slice(0, 8000);
  const note = `Added to "${t.title}", which is already in progress. You'll get one answer covering both emails.`;
  const readMails: string[] = Array.isArray(t.input.steered_mail_ids) ? t.input.steered_mail_ids : [];
  if (readMails.includes(m.mailId)) return { outcome: "STEERED", taskId: t.id, note };
  const body = typeof t.input.body === "string" ? t.input.body : "";
  const input = {
    ...t.input,
    body: `${body}${body ? "\n\n" : ""}Her next email, while this was in progress (answer it with the rest, in the same reply): ${words}`,
    steered_mail_ids: [...readMails, m.mailId],
    ...(t.status === "running" ? { steer_pending: true } : {}),
  };
  if (t.input.held_by_her) await release(t, input);
  else await writeInput(env, t, input);
  await event(env, t.id, "steered_by_reply", { mail_id: m.mailId, running: t.status === "running" });
  return { outcome: "STEERED", taskId: t.id, note };
}

/**
 * Called when a job she asked for by email finishes with an answer. Returns true when the answer must
 * NOT be sent now: the job is held, it takes her newer words first, or the round is not finished.
 */
export async function roundWaits(env: Env, taskId: string, text: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT id, lane, title, status, employee_id, input, created_at FROM tasks WHERE id = ?`).bind(taskId).first<any>();
  if (!row) return false;
  const input = parse(row.input);
  if (input.held_by_her) {
    await event(env, taskId, "answer_held_by_her", { text: text.slice(0, 20_000) });
    return true;
  }
  if (input.steer_pending) {
    const { steer_pending: _s, ...rest } = input;
    await env.DB.prepare(`UPDATE tasks SET input = ?, status = 'queued', finished_at = NULL WHERE id = ?`).bind(JSON.stringify(rest), taskId).run();
    await event(env, taskId, "rerun_for_her_next_email", {});
    await env.TASKS.send({ taskId, lane: row.lane });
    return true;
  }
  const round = roundOf(input);
  if (!round) return false;
  const tasks = (await roundTasks(env, round)).filter((t) => t.input.agent !== "simone");
  if (tasks.length < 2) return false;
  await event(env, taskId, "round_part", { round, text: text.slice(0, 20_000) });
  if (tasks.some((t) => t.id !== taskId && (OPEN.has(t.status) || t.input.held_by_her))) return true;
  await flushRound(env, round, { force: true });
  return true;
}

/** ONE email for the whole round, once every job in it has finished. Safe to call from any ending. */
export async function flushRound(env: Env, round: string, o: { force?: boolean } = {}): Promise<string | null> {
  const tasks = (await roundTasks(env, round)).filter((t) => t.input.agent !== "simone");
  if (tasks.length < 2) return null;
  if (tasks.some((t) => OPEN.has(t.status) || t.input.held_by_her)) return null;
  const parts: string[] = [];
  let any = false;
  for (const [i, t] of tasks.entries()) {
    const ev = await env.DB.prepare(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'round_part' ORDER BY ts DESC LIMIT 1`).bind(t.id).first<{ detail: string }>();
    const text = ev ? String(parse(ev.detail).text ?? "").trim() : "";
    if (text) any = true;
    const state = text ? text
      : t.status === "done" ? "Done."
      : t.status === "awaiting_approval" ? "Waiting for your approval in Boss OS."
      : t.status === "cancelled" ? "Dropped."
      : "Stopped and did not finish; reply to this email with \"try again\" and it runs again.";
    parts.push(`${i + 1}. ${t.title}`, state, "");
  }
  if (!any && !o.force) return null;
  const first = tasks[0]!;
  const name = first.employee_id ? (await env.DB.prepare(`SELECT name FROM employees WHERE id = ?`).bind(first.employee_id).first<{ name: string }>())?.name : null;
  return noticeOnce(env, {
    task: { id: first.id, lane: first.lane, title: first.title },
    fromName: name ?? "Simone", kind: `done#round:${round}`, needsHer: true,
    subject: doneSubject(String(first.input.subject || first.title).replace(/\s*\(\d+ of \d+\)$/, ""), parts.join("\n")),
    lines: [`Everything you asked for in this email, in one answer (${tasks.length} parts):`, "", ...parts].slice(0, 400),
  });
}
