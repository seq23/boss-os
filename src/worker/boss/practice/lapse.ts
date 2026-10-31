import type { Env } from "../env";
import { dayIdInZone, wallClock } from "../../../shared/boss/timezone";
import { LAWS, COMMITMENTS, coachingFocus } from "../today/faculty";
import { LINES, type LapseTier } from "./lines";

/**
 * TOUGH-LOVE CONSISTENCY EMAILS (owner, 31 Oct 2026):
 *
 *   "when i go on long streaks of not opening the boss os app and not doing coaching and not hitting
 *    my gates u should email me … And remind me in some clever way that being a A player requires
 *    discipline. I need tough love sometimes and reminders to be consistent."
 *
 * THE LADDER. A streak is the number of Central days since the last day she engaged at all — opened
 * the app, talked to the coach, or closed a gate. Nothing counts as engaging but those three.
 *   day 2       firm nudge
 *   day 4       tough love
 *   day 7+      a hard truth, and again every 3 days (7, 10, 13 …)
 * Any other day sends nothing. At most one lapse email a day (`practice_nudges`, PRIMARY KEY (day,
 * kind)), from 10:00 Central, to her only. The ladder resets the moment she engages: the streak is
 * computed from the newest engagement every time, so one app open puts it back to zero.
 *
 * NOTHING SAID IS STORED. `practice_engagement` holds a day, a kind and two times. Coaching is
 * LOCAL_ONLY (migration 0177); this file reads only that a talk happened. Pinned by
 * `tests/boss/practiceLapse.test.ts`.
 */

export const LAPSE_FROM_HOUR = 10; // mid-morning, Central
export const LAPSE_UNTIL_HOUR = 21; // a Mac that slept through 10:00 still sends the same day, never at night
export const MIDDAY_FROM_HOUR = 12;
export const MIDDAY_UNTIL_HOUR = 15;
export const HARD_REPEAT_DAYS = 3;

export function lapseTier(streakDays: number): LapseTier | null {
  if (streakDays === 2) return "firm";
  if (streakDays === 4) return "tough";
  if (streakDays >= 7 && (streakDays - 7) % HARD_REPEAT_DAYS === 0) return "hard";
  return null;
}

/** Whole Central calendar days between two day ids (YYYY-MM-DD). */
export function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.UTC(+fromDay.slice(0, 4), +fromDay.slice(5, 7) - 1, +fromDay.slice(8, 10));
  const b = Date.UTC(+toDay.slice(0, 4), +toDay.slice(5, 7) - 1, +toDay.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** A stable small number for a day, so the bank rotates by day rather than at random. */
function dayIndex(day: string): number {
  return Math.round(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86_400_000);
}

/** Her own words for each rung: the laws about missing and restarting first, then her standards. */
const QUOTE_POOL: Record<LapseTier, { label: string; text: string }[]> = (() => {
  const law = (n: number) => {
    const l = LAWS.find((x) => x.n === n)!;
    return { label: `Law ${l.n}, ${l.title}`, text: l.text };
  };
  const commit = (title: string) => {
    const c = COMMITMENTS.find((x) => x.title === title)!;
    return { label: `Your contract, ${c.title}`, text: c.text[0]!.toUpperCase() + c.text.slice(1) };
  };
  return {
    firm: [law(1), commit("Consistency"), law(2), commit("Self-command")],
    tough: [law(10), commit("Discipline"), law(3), commit("Follow-through")],
    hard: [commit("A-player behavior"), law(5), law(6), law(1)],
  };
})();

const STREAK_WORDS = "no gates, no coaching, app not opened";

export interface PracticeNotice {
  subject: string;
  happened: string;
  details: string[];
  decide: { title: string; body: string; buttons: { label: string; url: string }[] }[];
}

/** The email for one rung of the ladder. Pure: the test reads it directly. */
export function lapseNotice(tier: LapseTier, streakDays: number, day: string, origin: string): PracticeNotice {
  const i = dayIndex(day);
  const quotes = QUOTE_POOL[tier];
  const quote = quotes[i % quotes.length]!;
  const lines = LINES[tier];
  const line = lines[i % lines.length]!;
  // ONE tiny action. The coach on the tough rung (a talk is the fastest honest restart), the Morning
  // gate otherwise; the hard rung alternates between them so a week of silence gets both doors.
  const coach = tier === "tough" || (tier === "hard" && ((streakDays - 7) / HARD_REPEAT_DAYS) % 2 === 1);
  const action = coach
    ? { title: "One tiny thing: a 5-minute coach talk", body: "Five minutes, one question at a time. Nothing you say is saved.", label: "5-minute coach talk ›", url: `${origin}/?view=coach` }
    : { title: "One tiny thing: open today's Morning gate", body: "Tick one line. That is the whole ask.", label: "Open today's Morning gate ›", url: `${origin}/?view=gate&gate=morning` };
  const subject = tier === "firm"
    ? `${streakDays} days off the system. Five minutes puts you back.`
    : tier === "tough"
      ? `${streakDays} days. Some tough love.`
      : `${streakDays} days. A hard truth.`;
  return {
    subject,
    happened: `${streakDays} days: ${STREAK_WORDS}.`,
    details: [
      `In your own words (${quote.label}): "${quote.text}"`,
      line,
    ],
    decide: [{ title: action.title, body: action.body, buttons: [{ label: action.label, url: action.url }] }],
  };
}

/** The midday push: the morning's law, back at noon, with the Midday gate one tap away. */
export function middayNotice(law: { n: number; title: string; text: string }, origin: string): PracticeNotice {
  return {
    subject: `Midday: did you hold Law ${law.n}?`,
    happened: `Law ${law.n}, ${law.title}: "${law.text}"`,
    details: ["Water, one meal from your safe lane, two minutes standing, and one honest answer about the law."],
    decide: [{ title: "Your Midday gate", body: "Did you hold it today?", buttons: [{ label: "Open the Midday gate ›", url: `${origin}/?view=gate&gate=midday` }] }],
  };
}

// ─── Reading engagement ──────────────────────────────────────────────────────

/**
 * The last Central day she engaged, or null when nothing has ever been recorded. Engaging is one of
 * three things: an app open, a coach talk (that it happened, nothing more), a gate closed.
 */
export async function lastEngagedDay(env: Env): Promise<{ day: string | null; tracking: boolean }> {
  const [eng, gate] = await env.DB.batch([
    env.DB.prepare(`SELECT MAX(day_id) AS d, COUNT(*) AS n FROM practice_engagement`),
    env.DB.prepare(
      `SELECT MAX(id) AS d FROM days
        WHERE morning_completed_at IS NOT NULL OR midday_completed_at IS NOT NULL OR night_completed_at IS NOT NULL`,
    ),
  ]);
  const e = (eng?.results?.[0] ?? {}) as { d: string | null; n: number };
  const g = (gate?.results?.[0] ?? {}) as { d: string | null };
  const days = [e.d, g.d].filter((d): d is string => Boolean(d)).sort();
  return { day: days.length ? days[days.length - 1]! : null, tracking: (e.n ?? 0) > 0 };
}

export async function recordEngagement(env: Env, kind: "app_open" | "coach_morning" | "coach_evening", now = Date.now()): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO practice_engagement (day_id, kind, first_at, last_at) VALUES (?,?,?,?)
       ON CONFLICT(day_id, kind) DO UPDATE SET last_at = excluded.last_at`,
    )
    .bind(dayIdInZone(now), kind, now, now)
    .run();
}

// ─── What is due now ─────────────────────────────────────────────────────────

export interface DueNudge { day: string; kind: "lapse" | "midday" | "ancestral_urgent"; tier?: LapseTier; streak_days?: number; notice: PracticeNotice }

/** Claims a (day, kind) unless it was already SENT. A claim whose send failed is retried. */
async function claim(env: Env, day: string, kind: string, tier: string | null, streak: number | null, now: number): Promise<boolean> {
  await env.DB
    .prepare(`INSERT INTO practice_nudges (day, kind, tier, streak_days, claimed_at) VALUES (?,?,?,?,?) ON CONFLICT(day, kind) DO NOTHING`)
    .bind(day, kind, tier, streak, now)
    .run();
  const row = await env.DB.prepare(`SELECT sent_at FROM practice_nudges WHERE day = ? AND kind = ?`).bind(day, kind).first<{ sent_at: number | null }>();
  return !row?.sent_at;
}

export interface LapseVerdict { due: boolean; reason: string; tier?: LapseTier; streak_days?: number }

/** Pure: whether the ladder sends today, given the clock and the last engaged day. */
export function lapseVerdict(now: number, last: { day: string | null; tracking: boolean }): LapseVerdict {
  const today = dayIdInZone(now);
  const hour = wallClock(now).h;
  if (!last.tracking || !last.day) return { due: false, reason: "tracking starts the first time she opens the app" };
  const streak = daysBetween(last.day, today);
  if (streak <= 0) return { due: false, reason: "she engaged today", streak_days: 0 };
  const tier = lapseTier(streak);
  if (!tier) return { due: false, reason: `day ${streak} is not a rung of the ladder`, streak_days: streak };
  if (hour < LAPSE_FROM_HOUR || hour >= LAPSE_UNTIL_HOUR) return { due: false, reason: `outside ${LAPSE_FROM_HOUR}:00–${LAPSE_UNTIL_HOUR}:00 Central`, tier, streak_days: streak };
  return { due: true, reason: `day ${streak}: ${tier}`, tier, streak_days: streak };
}

export async function dueNudges(env: Env, origin: string, now = Date.now(), extra: (env: Env, now: number) => Promise<DueNudge[]> = async () => []): Promise<{ due: DueNudge[]; lines: string[] }> {
  const today = dayIdInZone(now);
  const due: DueNudge[] = [];
  const lines: string[] = [];

  const last = await lastEngagedDay(env);
  const v = lapseVerdict(now, last);
  let lapsing = false;
  if (v.due && v.tier && v.streak_days) {
    lapsing = true;
    if (await claim(env, today, "lapse", v.tier, v.streak_days, now)) {
      due.push({ day: today, kind: "lapse", tier: v.tier, streak_days: v.streak_days, notice: lapseNotice(v.tier, v.streak_days, today, origin) });
    } else lines.push("lapse: already sent today");
  } else lines.push(`lapse: ${v.reason}`);

  // THE MIDDAY PUSH: only on a day she is in the system (a lapse email already speaks for the day),
  // only while the Midday gate is open, once.
  const hour = wallClock(now).h;
  const streak = last.day ? daysBetween(last.day, today) : null;
  if (hour < MIDDAY_FROM_HOUR || hour >= MIDDAY_UNTIL_HOUR) lines.push("midday: not midday");
  else if (lapsing || streak === null || streak >= 2) lines.push("midday: she is lapsing; the ladder speaks instead");
  else {
    const day = await env.DB.prepare(`SELECT midday_completed_at, day_mode FROM days WHERE id = ?`).bind(today).first<{ midday_completed_at: number | null; day_mode: string | null }>();
    if (day?.midday_completed_at) lines.push("midday: the gate is closed");
    else {
      const focus = await coachingFocus(env, today, day?.day_mode ?? null);
      if (await claim(env, today, "midday", null, null, now)) due.push({ day: today, kind: "midday", notice: middayNotice(focus.law, origin) });
      else lines.push("midday: already sent today");
    }
  }

  for (const n of await extra(env, now)) {
    if (await claim(env, n.day, n.kind, null, null, now)) due.push(n);
    else lines.push(`${n.kind}: already sent today`);
  }
  return { due, lines };
}

export async function markNudgeSent(env: Env, day: string, kind: string, now = Date.now()): Promise<boolean> {
  const r = await env.DB.prepare(`UPDATE practice_nudges SET sent_at = ? WHERE day = ? AND kind = ? AND sent_at IS NULL`).bind(now, day, kind).run();
  return (r.meta?.changes ?? 0) > 0;
}
