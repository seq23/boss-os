import type { Env } from "../env";
import { wallClock } from "../../../shared/boss/timezone";
import { ancestralHourNow } from "../spirit/ancestralHour";
import type { DueNudge } from "./lapse";

/**
 * "DANGEROUSLY CLOSE" (owner, 31 Oct 2026: "if im dangerously close to missing ancestral hour for the
 * month - email me"). On the LAST day of the month, if the hour is still not done by 6pm Central,
 * one more short, urgent email. Once (`practice_nudges`, kind `ancestral_urgent`).
 *
 * It never doubles up on the ancestral reminder (spirit/ancestralHour.ts): when that last-day reminder
 * went at or after 6pm, or is claimed and still going, she has just been told, so this stays quiet.
 * The "Done ✓" button reuses that reminder's tap, so either email marks the hour done.
 */
export const URGENT_FROM_HOUR = 18;
export const URGENT_UNTIL_HOUR = 23;

export async function ancestralUrgent(env: Env, now: number, origin: string): Promise<DueNudge[]> {
  const h = wallClock(now).h;
  if (h < URGENT_FROM_HOUR || h >= URGENT_UNTIL_HOUR) return [];
  const s = await ancestralHourNow(env.DB, now);
  if (!s.is_last_day || s.done) return [];
  const sixPm = now - ((h - URGENT_FROM_HOUR) * 60 + wallClock(now).min) * 60_000;
  const row = await env.DB.prepare(`SELECT tap_token, sent_at FROM ancestral_hour_reminders WHERE day = ?`).bind(s.day)
    .first<{ tap_token: string; sent_at: number | null }>();
  if (row && (!row.sent_at || row.sent_at >= sixPm)) return [];
  const left = 24 - h;
  return [{
    day: s.day,
    kind: "ancestral_urgent",
    notice: {
      subject: `Ancestral hour: ${left} hours left in ${s.month_name}`,
      happened: `Today is the last day of ${s.month_name} and your ancestral hour is not done yet${s.minutes > 0 ? ` (${s.minutes} of ${s.target_minutes} minutes)` : ""}. About ${left} hours left. Light the candle; the hour is yours.`,
      details: [],
      decide: [{
        title: "Ancestral hour",
        body: "Tap Done when the hour is finished.",
        buttons: [{ label: "Done ✓", url: row ? `${origin}/tap/${row.tap_token}?do=done` : `${origin}/?tab=spirit` }],
      }],
    },
  }];
}
