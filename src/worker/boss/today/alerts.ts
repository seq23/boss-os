import type { Env } from "../env";

/**
 * WHAT SHE CAN DO WITH AN ALERT, WHICH UNTIL NOW WAS READ IT.
 *
 *   "i also need to be able to refresh critical alerts and / or dismiss / mark resolved? i dont know
 *    u need to figure it out and add it"
 *
 * The KDP alert sat for a week saying something untrue and there was no control anywhere that could
 * have touched it. Three verbs, and the naive version of each breaks something established earlier:
 * refresh that re-fetches instead of re-checking tells her the same stale thing; resolved that takes
 * her word for it is the claim `TERMINAL_CHECKS` exists to refuse; dismiss that is permanent is the
 * blindness this whole day has been about.
 */

export interface Alert {
  severity: string;
  text: string;
  source_type: string;
  source_id: string | null;
}

const RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * The identity of an alert, stable across a rewording.
 *
 * `source_id` WHERE THERE IS ONE, because that is the thing the alert is about and its sentence is
 * expected to change — the whole point of this morning's work is that the status text updates every
 * run. Keying on the text would mean a dismissal silently expiring the moment the underlying
 * determination changed, which looks like the dismissal failing.
 *
 * Where there is no source id, a cheap stable hash of the text is the only identity available, and
 * a reworded alert legitimately reads as a new one.
 */
export function alertKey(a: Alert): string {
  if (a.source_id) return `${a.source_type}:${a.source_id}`;
  let h = 2166136261;
  for (let i = 0; i < a.text.length; i += 1) {
    h ^= a.text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `text:${(h >>> 0).toString(36)}`;
}

/**
 * Drop what she has chosen not to look at — unless it got worse.
 *
 * A DISMISSAL IS A JUDGEMENT ABOUT A SEVERITY, NOT ABOUT A SUBJECT. Deciding not to look at a
 * medium today is not deciding not to look at the critical it becomes on Friday, so an alert that
 * comes back louder ignores its own dismissal. That is the difference between a snooze and the
 * silence that let a dead credential run for days.
 */
/** The one read `applyDismissals` makes, so a caller can carry it in a batch with the producers. */
export const dismissalsStatement = (env: Env, now: number) => env.DB
  .prepare(
    `SELECT alert_key, alert_text, reason, severity_at_dismissal, until
       FROM alert_dismissals WHERE until > ?`,
  )
  .bind(now);

export async function applyDismissals(
  env: Env,
  alerts: Alert[],
  now = Date.now(),
  // Rows already read by `dismissalsStatement`, when the caller batched them earlier.
  pre?: Promise<{ results?: any[] }>,
): Promise<{ shown: Alert[]; dismissed: { key: string; text: string; reason: string; until: number }[] }> {
  const rows = await (pre ?? dismissalsStatement(env, now).all<any>()).catch(() => ({ results: [] as any[] }));

  const live = new Map<string, any>();
  for (const d of (rows as { results?: any[] }).results ?? []) live.set(d.alert_key, d);
  if (live.size === 0) return { shown: alerts, dismissed: [] };

  const shown: Alert[] = [];
  const dismissed: { key: string; text: string; reason: string; until: number }[] = [];

  for (const a of alerts) {
    const d = live.get(alertKey(a));
    if (!d) { shown.push(a); continue; }
    if ((RANK[a.severity] ?? 0) > (RANK[d.severity_at_dismissal] ?? 0)) {
      // Louder than when she put it aside, so the dismissal does not apply to this version of it.
      shown.push({
        ...a,
        text: `${a.text} (You dismissed a quieter version of this on ${new Date(d.dismissed_at ?? now).toISOString().slice(0, 10)}; it has got worse since.)`,
      });
      continue;
    }
    dismissed.push({ key: d.alert_key, text: d.alert_text, reason: d.reason, until: d.until });
  }

  return { shown, dismissed };
}

/**
 * TWO ALERTS THAT SAY THE SAME WORDS ARE ONE ALERT, WHOEVER PRODUCED THEM.
 *
 * She read eleven alerts of which five were the identical string `queue: task_failed`. The
 * grouping in `today/errorAlerts.ts` is what fixed that cause; this is the guarantee that no
 * FUTURE producer can reintroduce the shape. A repeated sentence carries no information the first
 * one did not — the second copy's only effect is to push a different alert off the screen.
 *
 * The LOUDEST copy survives, and it keeps its own `source_id`, so collapsing can never quieten an
 * alert or detach it from the thing it is about.
 */
export function dedupeAlerts(alerts: Alert[]): Alert[] {
  const byText = new Map<string, Alert>();
  for (const a of alerts) {
    const seen = byText.get(a.text);
    if (!seen || (RANK[a.severity] ?? 0) > (RANK[seen.severity] ?? 0)) byText.set(a.text, a);
  }
  // Insertion order is the order producers ran in, which is the priority this surface is built on.
  return alerts.filter((a) => byText.get(a.text) === a);
}
