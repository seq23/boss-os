import type { Env } from "../env";

/** Only delivered mornings count, once per address/day. Owner action starts a new streak. */
export async function recordPersonReminders(env: Env, day: string, payload: any, now = Date.now()): Promise<void> {
  const cards = [...(payload?.decide ?? []), ...(payload?.still_yours ?? [])].filter((d) => !d.answered_at);
  const rows = (await env.DB.prepare(`SELECT * FROM lp_reply_drafts`).all<any>()).results ?? [];
  for (const row of rows) {
    const address = String(row.address).trim().toLowerCase();
    const keys = [row.id, address].flatMap((v) => [`lp:${v}`, `lp-again:${v}`, `lpnudge:${v}`]);
    if (!cards.some((d) => keys.includes(d.key))) continue;
    const acted = Math.max(Number(row.decided_at) || 0, Number(row.sent_at) || 0, Number(row.nudged_at) || 0);
    // An action after this morning was built means this was already answered, not a reminder.
    const digest = await env.DB.prepare(`SELECT created_at, updated_at FROM morning_digests WHERE day = ?`).bind(day).first<{ created_at: number; updated_at: number }>();
    if (digest && acted >= digest.updated_at) continue;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO person_reminders (address, reminder_count, acted_at, last_day, updated_at) VALUES (?,1,?,?,?)
        ON CONFLICT(address) DO UPDATE SET
          reminder_count = CASE WHEN excluded.acted_at > person_reminders.acted_at THEN 1 WHEN person_reminders.last_day = excluded.last_day THEN person_reminders.reminder_count ELSE person_reminders.reminder_count + 1 END,
          acted_at = excluded.acted_at, last_day = excluded.last_day, updated_at = excluded.updated_at`).bind(address, acted, day, now),
      env.DB.prepare(`INSERT OR IGNORE INTO quiet_people (address, created_at) SELECT address, ? FROM person_reminders WHERE address = ? AND reminder_count >= 3`).bind(now, address),
    ]);
  }
}

/** Kept mornings must honour quieting too, including old item links. */
export async function pruneQuietPeople<T>(env: Env, value: T): Promise<T> {
  const rows = (await env.DB.prepare(`SELECT l.id, l.address FROM lp_reply_drafts l JOIN quiet_people q ON q.address = lower(trim(l.address))`).all<{ id: string; address: string }>()).results ?? [];
  const keys = new Set(rows.flatMap((r) => [r.id, r.address].flatMap((v) => [`lp:${v}`, `lp-again:${v}`, `lpnudge:${v}`])));
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.filter((x) => !keys.has(x?.key)).map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return keys.size ? walk(value) : value;
}
