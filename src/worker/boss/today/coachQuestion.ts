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
  morningGateLast: string | null; // the last day before today the Morning gate was done (YYYY-MM-DD), null if never
  nightGateLast: string | null;   // the same for the Night gate
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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-07" → "Sep 7". */
export const shortDay = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

/** Past a week a run reads plainly from its real start, never as a count that could be a cap. */
export const LONG_RUN_DAYS = 7;

/**
 * Pure: a gate's run, said plainly and never overstated (31 Oct 2026, owner: the card said "skipped
 * 30 days running" when the gate was last done on 7 Sep). `missed` is the exact run before today;
 * `last` the day it was last done. A long run is said from that day: "hasn't been done since Sep 7
 * (54 days)", where 54 is the days from that day to today (missed + 1). Never done at all: the run is
 * counted only from the first day any gate was recorded, and said so.
 */
export function gateFact(name: "morning" | "night", missed: number, last: string | null): string {
  if (missed <= LONG_RUN_DAYS) return `the ${name} gate was skipped ${days(missed)} running`;
  if (last) return `the ${name} gate hasn't been done since ${shortDay(last)} (${days(missed + 1)})`;
  return `the ${name} gate hasn't been done once in the ${days(missed)} on record`;
}

interface Problem { kind: CoachKind; score: number; fact: string; question: string }

/** Pure: every problem the signals show, each with its cost-weighted score. */
export function problems(s: CoachSignals): Problem[] {
  const out: Problem[] = [];
  if (s.waitingDays >= 3 && s.waitingWho) out.push({ kind: "waiting", score: s.waitingDays * 3, fact: `${s.waitingWho === "an LP" ? "An LP" : "Someone"} has waited ${days(s.waitingDays)} for one reply`, question: "What's the real reason, and what do you send before noon?" });
  if (s.noMoneyMoveDays >= 2) out.push({ kind: "money", score: s.noMoneyMoveDays * 3, fact: `no money move in ${days(s.noMoneyMoveDays)}`, question: "What one move today would you be proud of on Friday?" });
  if (s.appAwayDays >= 2) out.push({ kind: "app", score: s.appAwayDays * 2.5, fact: `the app went unopened for ${days(s.appAwayDays)}`, question: "You built this so you wouldn't have to remember. What were you avoiding when you stopped opening it?" });
  if (s.morningGateMissed >= 2) out.push({ kind: "morning_gate", score: s.morningGateMissed * 2, fact: gateFact("morning", s.morningGateMissed, s.morningGateLast), question: "What's the smallest version you'd do even on your worst day?" });
  if (s.nightGateMissed >= 2) out.push({ kind: "night_gate", score: s.nightGateMissed * 1.5, fact: gateFact("night", s.nightGateMissed, s.nightGateLast), question: "What would it take to close tonight in five minutes?" });
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

/**
 * How many consecutive days before `today` match `pred`, reading back from yesterday — and NEVER past
 * `since`, the first day the thing was recorded at all. A day before tracking began is not a day she
 * skipped (31 Oct 2026, the first live read said "the app went unopened for 30 days" on the day the
 * opens started being recorded). And NO CAP (31 Oct 2026, owner): a 30-day look-back said "skipped 30
 * days running" of a gate last done 54 days before; the count runs to the last match or `since`.
 */
export function runBack(today: string, rows: Map<string, Record<string, unknown>>, pred: (r: Record<string, unknown> | undefined) => boolean, since: string | null): number {
  if (!since || since >= today) return 0;
  let n = 0;
  for (let i = 1; ; i++) {
    const d = new Date(Date.parse(`${today}T12:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
    if (d < since) break;
    if (!pred(rows.get(d))) break;
    n += 1;
  }
  return n;
}

/** Read the signals: counts from D1, never a name. `waiting` is the carried list's longest wait. */
export async function coachSignals(env: Env, today: string, waiting: { days: number; lp: boolean } | null): Promise<CoachSignals> {
  const db = env.DB;
  const dayStart = Date.parse(`${today}T05:00:00Z`);
  const [daysR, engR, rosR, ancR, calR, firstR] = await db.batch([
    // Every day on record (one row a day): the runs are exact, never capped at a look-back.
    db.prepare(`SELECT id, morning_completed_at AS m, night_completed_at AS n FROM days WHERE id < ?`).bind(today),
    db.prepare(`SELECT DISTINCT day_id, kind FROM practice_engagement WHERE kind IN ('app_open', 'coach_morning', 'coach_evening') AND day_id < ?`).bind(today),
    db.prepare(`SELECT MAX(day_id) AS d FROM run_of_show WHERE block_key = 'first_wealth_block' AND done_at IS NOT NULL`),
    db.prepare(`SELECT COALESCE(SUM(minutes), 0) AS m FROM ancestor_entries WHERE month = ?`).bind(today.slice(0, 7)),
    db.prepare(`SELECT COUNT(*) AS n FROM diary_entries WHERE cancelled_at IS NULL AND scheduled_at >= ? AND scheduled_at < ?`).bind(dayStart, dayStart + 86_400_000),
    // Where each record begins: engagement (opens, talks) and gates (the first day any gate closed).
    db.prepare(`SELECT (SELECT MIN(day_id) FROM practice_engagement) AS eng, (SELECT MIN(id) FROM days WHERE morning_completed_at IS NOT NULL OR midday_completed_at IS NOT NULL OR night_completed_at IS NOT NULL) AS gate`),
  ]).catch(() => [] as any[]);
  const dayRows = new Map<string, Record<string, unknown>>(((daysR?.results ?? []) as any[]).map((r) => [r.id, r]));
  const eng = (engR?.results ?? []) as { day_id: string; kind: string }[];
  const engDays = (kinds: string[]) => new Map(eng.filter((e) => kinds.includes(e.kind)).map((e) => [e.day_id, { x: 1 }] as [string, Record<string, unknown>]));
  const opened = engDays(["app_open", "coach_morning", "coach_evening"]);
  const talked = engDays(["coach_morning", "coach_evening"]);
  const first = ((firstR?.results?.[0] ?? {}) as { eng?: string | null; gate?: string | null });
  const engSince = first.eng ?? null;
  const gateSince = first.gate ?? null;
  const lastDone = (k: "m" | "n") => [...dayRows.values()].filter((r) => r[k]).map((r) => String(r.id)).sort().pop() ?? null;
  const lastMove = ((rosR?.results?.[0] ?? {}) as { d?: string | null }).d ?? null;
  const minutes = Number(((ancR?.results?.[0] ?? {}) as { m?: number }).m ?? 0);
  const anc = ancestralHourState(today, minutes);
  return {
    appAwayDays: runBack(today, opened, (r) => !r, engSince),
    morningGateMissed: runBack(today, dayRows, (r) => !r?.m, gateSince),
    nightGateMissed: runBack(today, dayRows, (r) => !r?.n, gateSince),
    morningGateLast: lastDone("m"),
    nightGateLast: lastDone("n"),
    talksMissed: runBack(today, talked, (r) => !r, engSince),
    waitingDays: waiting?.days ?? 0,
    waitingWho: waiting ? (waiting.lp ? "an LP" : "someone") : null,
    noMoneyMoveDays: lastMove ? Math.max(0, daysBetween(lastMove, today)) : 0,
    ancestralDaysLeft: anc.show && !anc.done ? anc.days_left : null,
    meetingsToday: Number(((calR?.results?.[0] ?? {}) as { n?: number }).n ?? 0),
    streakDays: runBack(today, dayRows, (r) => Boolean(r?.m), gateSince),
  };
}

/** The situation the coach is handed for today: the same counts the Coaching card's question reads. */
export async function coachSituation(env: Env, today: string): Promise<string> {
  const { waitingOnYou } = await import("./waiting");
  const { items } = await waitingOnYou(env, today);
  const longest = items[0] ?? null;
  return chooseQuestion(await coachSignals(env, today, longest ? { days: longest.days, lp: Boolean(longest.reply) || longest.wealth } : null)).situation;
}
