/**
 * NO GOT IT AFTER FIVE MINUTES IS AN ALARM (15 Nov 2026, the West Peek OS #452 rule brought to Boss OS).
 *
 * Her email is answered in the same run that reads it. When that run is stopped before it finishes (a
 * killed Worker runs no catch), or the reply fails, nothing says so: the row sits at RECEIVED, or its
 * reply at `due` / `failed`, and she simply never hears. Every five minutes (the `*\/5` cron, run from
 * `scheduled` in src/worker/index.ts) this finds each email of hers from the last day that is more than
 * five minutes old with no Got it, and writes ONE notice for it in her notices (`mail_no_got_it`,
 * needs_her: her Mac's drain emails it as an alarm). A redelivery that has since been answered is not
 * an alarm. Never throws.
 *
 * RULE 0: it returns its census (`checked`, `raised`) and logs `OUTPUT <n> mail_no_got_it_alarms`.
 * Floor 0: a quiet five minutes is the normal case, and it says so with the count it checked.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";

export const UNACKNOWLEDGED_MS = 5 * 60_000;
/**
 * The five-minute cron in wrangler.toml; `scheduled` runs only this alarm on it. It lives HERE, not in
 * src/worker/index.ts: every named export of a Worker's entry module is read as an entrypoint, and a
 * string there stops the runtime from starting (15 Nov 2026, e2e on #420).
 */
export const MAIL_ALARM_CRON = "*/5 * * * *";
const LOOKBACK_MS = 24 * 3600_000;

export async function runMailAlarm(env: Env, now = Date.now()): Promise<{ checked: number; raised: number; output: string }> {
  let checked = 0;
  let raised = 0;
  try {
    const rows = (await env.DB.prepare(
      `SELECT m.id, m.subject, m.outcome, m.reply_state, m.reply_error, m.message_id, m.received_at
         FROM boss_inbound_mail m
        WHERE m.authorised = 1 AND m.received_at < ?1 AND m.received_at >= ?2
          AND (m.outcome = 'RECEIVED' OR m.reply_state IN ('due', 'failed'))
          AND NOT EXISTS (SELECT 1 FROM boss_task_notices n WHERE n.task_id = m.id AND n.kind = 'mail_no_got_it')
          AND NOT EXISTS (SELECT 1 FROM boss_inbound_mail later WHERE m.message_id IS NOT NULL AND later.message_id = m.message_id
                            AND later.received_at > m.received_at AND (later.reply_state IN ('sent', 'none_due', 'shown_on_screen') OR later.outcome = 'NOT_READ_TWICE'))
        ORDER BY m.received_at LIMIT 20`,
    ).bind(now - UNACKNOWLEDGED_MS, now - LOOKBACK_MS).all<{ id: string; subject: string | null; outcome: string; reply_state: string | null; reply_error: string | null; message_id: string | null; received_at: number }>()).results ?? [];
    checked = rows.length;
    for (const r of rows) {
      const subject = (r.subject ?? "").slice(0, 160) || "no subject";
      const killed = r.outcome === "RECEIVED";
      const body = [
        killed
          ? `What broke: your email "${subject}" was being read and the read was stopped before it finished, so no Got it went.`
          : `What broke: your email "${subject}" was read and its work was filed, but the Got it ${r.reply_state === "failed" ? `could not be sent${r.reply_error ? ` (${r.reply_error.slice(0, 160)})` : ""}` : "never went"}.`,
        `What was lost: Nothing. Your email is kept${killed ? "; nothing in it has started yet" : " and its work is on the job"}.`,
        killed
          ? "What is being done: your mail server sends it again by itself and it is read then; if two reads are stopped, the team reads it by hand."
          : "What is being done: the work goes on without the Got it; the answer comes when the job is done.",
        "The one thing to do: nothing, unless it is urgent; then reply to your email with the key part typed out.",
      ].join("\n");
      await env.DB.prepare(
        `INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, needs_her) VALUES (?,?,'ops','Kendra','mail_no_got_it',?,?,?,1)`,
      ).bind(newId("tnt"), r.id, `No Got it yet: ${subject.slice(0, 120)}`, body, now).run();
      raised += 1;
    }
  } catch (err) {
    console.error("mail alarm failed", err);
    await logEvent(env.DB, { level: "error", scope: "intake", event: "boss_mail_alarm_failed", lane: "ops", detail: { error: String(err instanceof Error ? err.message : err).slice(0, 300) } }).catch(() => undefined);
  }
  const output = `OUTPUT ${raised} mail_no_got_it_alarms (checked ${checked})`;
  if (raised) console.log(output);
  return { checked, raised, output };
}
