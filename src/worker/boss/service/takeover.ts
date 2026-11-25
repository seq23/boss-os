/**
 * A JOB SHE HAS TAKEN OVER IN A SESSION (15 Nov 2026, the West Peek OS #453 rule brought to Boss OS).
 *
 * When she (or a Claude Code session of hers) takes a job over to do it by hand, the job carries
 * `input.taken_over` and nothing runs it here: the queue skips it exactly as it skips a job she held
 * (`held_by_her`, queue/consumer.ts). A reply of hers on that job's thread is never a new job and
 * never lost: her words are added to the job word for word, and her Got it says it is being handled
 * in a session. `POST /api/tasks/:id/take-over` marks it; `POST /api/tasks/:id/hand-back` returns it
 * to the queue with everything she said meanwhile.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";

export interface TakenOver { id: string; title: string; input: Record<string, any> }

const parse = (s: string | null) => { try { return JSON.parse(s ?? "{}") ?? {}; } catch { return {}; } };

/** A taken-over job her reply's thread names (the References chain against the emails that opened jobs), or null. */
export async function takenOverJob(env: Env, chain: readonly string[], sender?: string): Promise<TakenOver | null> {
  if (!chain.length) return null;
  const marks = chain.map(() => "?").join(",");
  const rows = (await env.DB.prepare(
    `SELECT t.id, t.title, t.input FROM tasks t
       JOIN boss_inbound_mail m ON json_extract(t.input, '$.mail_id') = m.id
      WHERE m.message_id IN (${marks}) AND m.authorised = 1 AND (? IS NULL OR m.from_addr = ?) AND t.status NOT IN ('done', 'cancelled')
      ORDER BY t.created_at DESC LIMIT 20`,
  ).bind(...chain, sender ?? null, sender ?? null).all<{ id: string; title: string; input: string | null }>()).results ?? [];
  for (const r of rows) {
    const input = parse(r.input);
    if (input.taken_over) return { id: r.id, title: r.title, input };
  }
  return null;
}

/** Her words go on the taken-over job, word for word; nothing is queued. */
export async function addToTakenOver(env: Env, job: TakenOver, m: { own: string; mailId: string; now: number }): Promise<void> {
  const body = typeof job.input.body === "string" ? job.input.body : "";
  const input = { ...job.input, body: `${body}${body ? "\n\n" : ""}Her next email, while this was being handled in a session (nothing was run here): ${m.own.trim().slice(0, 8000)}` };
  await env.DB.prepare(`UPDATE tasks SET input = ? WHERE id = ?`).bind(JSON.stringify(input), job.id).run();
  await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'reply_while_taken_over',?)`)
    .bind(newId("tev"), job.id, m.now, JSON.stringify({ mail_id: m.mailId })).run();
}

/** The Got it for that reply. Pure. */
export function takenOverReply(job: { title: string }): string {
  return `Got it. "${job.title}" is being handled in a session right now, so your email went straight onto it, word for word: nothing is lost, and nothing starts on it here meanwhile.`;
}
