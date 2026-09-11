import type { Env } from "../env";

/**
 * A QUESTION SHE HAS NOT ANSWERED IS WORK THAT IS NOT HAPPENING.
 *
 * An employee that asks for clarity and is never answered is in exactly the state this system was
 * built to make impossible: it looks fine from the inside — the message was received, routed,
 * answered politely — while the thing she actually asked for has not been started and nothing on
 * her screen says so. Silence looks identical to done.
 *
 * ─── EVALUATED ON READ, LIKE THE BOOK NAG ──────────────────────────────────
 *
 * Not a cron and not a row in `owned_deliverables`. A cron that stops firing takes the escalation
 * with it silently, and a deliverable COMPLETES — this condition opens and closes as often as she
 * writes an unclear message. It is arithmetic over `boss_inbound_mail`, computed every time she
 * opens Today, so it cannot fail without the whole page failing.
 *
 * ─── IT ESCALATES ONLY ON AGE ──────────────────────────────────────────────
 *
 * A question asked an hour ago is not a problem, it is a conversation. A question asked on Monday
 * and unanswered on Thursday is a week of buyer hunting that did not happen.
 */

export interface QuestionAlert {
  severity: "medium" | "high" | "critical";
  text: string;
  source_type: string;
  source_id: string | null;
}

const DAY = 86_400_000;

/** A question is a conversation for this long. After it, it is a blockage. */
export const QUESTION_PATIENCE_HOURS = 18;

export async function unansweredQuestionAlerts(env: Env, now = Date.now()): Promise<QuestionAlert[]> {
  const { results } = await env.DB
    .prepare(
      `SELECT m.id, m.received_at, m.subject, m.why, e.name AS employee
         FROM boss_inbound_mail m
         LEFT JOIN employees e ON e.id = m.employee_id
        WHERE m.outcome = 'NEEDS_CLARITY' AND m.answered_at IS NULL
        ORDER BY m.received_at`,
    )
    .all<{ id: string; received_at: number; subject: string | null; why: string; employee: string | null }>();

  const open = (results ?? []).filter((r) => now - r.received_at >= QUESTION_PATIENCE_HOURS * 3_600_000);
  if (open.length === 0) return [];

  const oldest = open[0]!;
  const days = Math.floor((now - oldest.received_at) / DAY);
  const severity = days >= 7 ? "critical" : days >= 3 ? "high" : "medium";

  return [{
    severity,
    text:
      `${open.length} question${open.length === 1 ? "" : "s"} from your employees ${open.length === 1 ? "is" : "are"} waiting on you — `
      + `the oldest is ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`} old, from ${oldest.employee ?? "your inbox"}`
      + `${oldest.subject ? ` about "${oldest.subject}"` : ""}. `
      + "Nothing was started on it and nothing was invented: reply to that email and it goes straight into work.",
    source_type: "intake",
    source_id: oldest.id,
  }];
}
