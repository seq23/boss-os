import type { Env } from "../env";
import { daysBetween } from "../practice/lapse";
import { ancestralHourState } from "../spirit/ancestralHour";

/**
 * THE COACHING CARD IS HER 1:1, AND ITS QUESTION FITS HER LIFE RIGHT NOW (owner, Today v4, 31 Oct 2026).
 *
 * A daily question about discipline and keeping going, chosen from live signals:
 *   app not opened N days · gates skipped (which, how many) · coaching talks skipped · someone waiting
 *   long · no money move N days · the ancestral hour near its deadline · a packed calendar · a streak
 *   going well.
 *
 * THE RULE: the longest-running and costliest problem wins (`score` = days × cost). A streak is praised
 * only when nothing is slipping. The question is a pure function of the signals, so it changes the
 * moment they do and holds still while they do not.
 *
 * WHAT THE COACH IS TOLD: COUNTS AND SITUATIONS ONLY. "An LP", "3 days" — never a name, never an
 * address, never a title from the morning. `CoachSignals` holds numbers and kinds and nothing else,
 * so a name has no field to travel in. Never body, weight or food. Coaching stays LOCAL_ONLY: nothing
 * she says is stored, only that a talk happened (`practice_engagement`).
 */

export interface CoachSignals {
  appAwayDays: number;            // whole days since the app was last opened, before today
  morningGateMissed: number;      // consecutive days before today with no Morning gate
  nightGateMissed: number;        // consecutive days before today with no Night gate
  talksMissed: number;            // consecutive days before today with no coaching talk
  waitingDays: number;            // the longest anyone has waited on her
  waitingWho: "an LP" | "someone" | null;
  noMoneyMoveDays: number;        // days since the Wealth block's core part was last done
  ancestralDaysLeft: number | null; // days left this month for the ancestral hour, when not yet done and in its window
  meetingsToday: number;
  streakDays: number;             // consecutive days, up to yesterday, with the Morning gate done
}

export type CoachKind = "app" | "morning_gate" | "night_gate" | "talks" | "waiting" | "money" | "ancestral" | "calendar" | "streak" | "steady";

export interface CoachQuestion {
  kind: CoachKind;
  /** The question on the card. */
  question: string;
  /** The situation the coach is handed, counts only. */
  situation: string;
  /** Stable while the signals are: the card refreshes when this changes. */
  signature: string;
}

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

interface Problem { kind: CoachKind; score: number; fact: string; question: string }

/** Pure: every problem the signals show, each with its cost-weighted score. */
export function problems(s: CoachSignals): Problem[] {
  const out: Problem[] = [];
  if (s.waitingDays >= 3 && s.waitingWho) out.push({ kind: "waiting", score: s.waitingDays * 3, fact: `${s.waitingWho === "an LP" ? "An LP" : "Someone"} has waited ${days(s.waitingDays)} for one reply`, question: "What's the real reason, and what do you send before noon?" });
  if (s.noMoneyMoveDays >= 2) out.push({ kind: "money", score: s.noMoneyMoveDays * 3, fact: `no money move in ${days(s.noMoneyMoveDays)}`, question: "What one move today would you be proud of on Friday?" });
  if (s.appAwayDays >= 2) out.push({ kind: "app", score: s.appAwayDays * 2.5, fact: `the app went unopened for ${days(s.appAwayDays)}`, question: "You built this so you wouldn't have to remember. What were you avoiding when you stopped opening it?" });
  if (s.morningGateMissed >= 2) out.push({ kind: "morning_gate", score: s.morningGateMissed * 2, fact: `the morning gate was skipped ${days(s.morningGateMissed)} running`, question: "What's the smallest version you'd do even on your worst day?" });
  if (s.nightGateMissed >= 2) out.push({ kind: "night_gate", score: s.nightGateMissed * 1.5, fact: `the night gate was skipped ${days(s.nightGateMissed)} running`, question: "What would it take to close tonight in five minutes?" });
  if (s.talksMissed >= 3) out.push({ kind: "talks", score: s.talksMissed * 1.5, fact: `no coaching talk in ${days(s.talksMissed)}`, question: "What would you tell a founder who did that?" });
  if (s.ancestralDaysLeft !== null && s.ancestralDaysLeft <= 3) out.push({ kind: "ancestral", score: (4 - s.ancestralDaysLeft) * 3, fact: s.ancestralDaysLeft === 0 ? "the month closes today and the ancestral hour isn't logged" : `the month closes in ${days(s.ancestralDaysLeft)} and the ancestral hour isn't logged`, question: "When today, exactly?" });
  if (s.meetingsToday >= 4) out.push({ kind: "calendar", score: 2, fact: `${s.meetingsToday} meetings today`, question: "Which one thing still gets done between them, and when?" });
  return out.sort((a, b) => b.score - a.score);
}

/** Pure: the one question. The costliest problem leads; the next one, if any, is named beside it. */
export function chooseQuestion(s: CoachSignals): CoachQuestion {
  const sig = JSON.stringify(s);
  const list = problems(s);
  if (!list.length) {
    if (s.streakDays >= 3) {
      return { kind: "streak", signature: sig, question: `${s.streakDays}-day streak, and nothing is slipping. What made it easy, and how do you protect it tomorrow?`, situation: `Situation: a ${s.streakDays}-day morning-gate streak; nothing is slipping.` };
    }
    return { kind: "steady", signature: sig, question: "Nothing is slipping today. What is the one thing that would make today count?", situation: "Situation: nothing is slipping today." };
  }
  const [lead, next] = list;
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const facts = next ? `${cap(lead!.fact)}, and ${next.fact}.` : `${cap(lead!.fact)}.`;
  return {
    kind: lead!.kind, signature: sig,
    question: `${facts} ${lead!.question}`,
    situation: `Situation (counts only): ${list.slice(0, 3).map((p) => p.fact).join("; ")}.`,
  };
}

/** How many consecutive days before `today` match `pred`, reading back from yesterday. */
function runBack(today: string, rows: Map<string, Record<string, unknown>>, pred: (r: Record<string, unknown> | undefined) => boolean, max = 30): number {
  let n = 0;
  for (let i = 1; i <= max; i++) {
    const d = new Date(Date.parse(`${today}T12:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
    if (!pred(rows.get(d))) break;
    n += 1;
  }
  return n;
}

/** Read the signals: counts from D1, never a name. `waiting` is the carried list's longest wait. */
export async function coachSignals(env: Env, today: string, waiting: { days: number; lp: boolean } | null): Promise<CoachSignals> {
  const db = env.DB;
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - 31 * 86_400_000).toISOString().slice(0, 10);
  const dayStart = Date.parse(`${today}T05:00:00Z`);
  const [daysR, engR, rosR, ancR, calR] = await db.batch([
    db.prepare(`SELECT id, morning_completed_at AS m, night_completed_at AS n FROM days WHERE id >= ? AND id < ?`).bind(since, today),
    db.prepare(`SELECT day_id, kind FROM practice_engagement WHERE day_id >= ?`).bind(since),
    db.prepare(`SELECT MAX(day_id) AS d FROM run_of_show WHERE block_key = 'first_wealth_block' AND done_at IS NOT NULL`),
    db.prepare(`SELECT COALESCE(SUM(minutes), 0) AS m FROM ancestor_entries WHERE month = ?`).bind(today.slice(0, 7)),
    db.prepare(`SELECT COUNT(*) AS n FROM diary_entries WHERE cancelled_at IS NULL AND scheduled_at >= ? AND scheduled_at < ?`).bind(dayStart, dayStart + 86_400_000),
  ]).catch(() => [] as any[]);
  const dayRows = new Map<string, Record<string, unknown>>(((daysR?.results ?? []) as any[]).map((r) => [r.id, r]));
  const eng = (engR?.results ?? []) as { day_id: string; kind: string }[];
  const engDays = (kinds: string[]) => new Map(eng.filter((e) => kinds.includes(e.kind)).map((e) => [e.day_id, { x: 1 }] as [string, Record<string, unknown>]));
  const opened = engDays(["app_open", "coach_morning", "coach_evening"]);
  const talked = engDays(["coach_morning", "coach_evening"]);
  const tracking = eng.length > 0;
  const lastMove = ((rosR?.results?.[0] ?? {}) as { d?: string | null }).d ?? null;
  const minutes = Number(((ancR?.results?.[0] ?? {}) as { m?: number }).m ?? 0);
  const anc = ancestralHourState(today, minutes);
  return {
    appAwayDays: tracking ? runBack(today, opened, (r) => !r) : 0,
    morningGateMissed: runBack(today, dayRows, (r) => !r?.m),
    nightGateMissed: runBack(today, dayRows, (r) => !r?.n),
    talksMissed: tracking ? runBack(today, talked, (r) => !r) : 0,
    waitingDays: waiting?.days ?? 0,
    waitingWho: waiting ? (waiting.lp ? "an LP" : "someone") : null,
    noMoneyMoveDays: lastMove ? Math.max(0, daysBetween(lastMove, today)) : 0,
    ancestralDaysLeft: anc.show && !anc.done ? anc.days_left : null,
    meetingsToday: Number(((calR?.results?.[0] ?? {}) as { n?: number }).n ?? 0),
    streakDays: runBack(today, dayRows, (r) => Boolean(r?.m)),
  };
}

/** The situation the coach is handed for today: the same counts the Coaching card's question reads. */
export async function coachSituation(env: Env, today: string): Promise<string> {
  const { waitingOnYou } = await import("./waiting");
  const { items } = await waitingOnYou(env, today);
  const longest = items[0] ?? null;
  return chooseQuestion(await coachSignals(env, today, longest ? { days: longest.days, lp: Boolean(longest.reply) || longest.wealth } : null)).situation;
}
