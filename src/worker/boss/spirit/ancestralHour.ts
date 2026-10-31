/**
 * THE ANCESTRAL HOUR, MADE URGENT AT THE END OF THE MONTH (owner, 31 Oct 2026):
 *
 *   "on the last day of the month and 3 days before u should make the ancestral hour urgent and
 *    noticeable and maybe email a reminder"
 *
 * ONE SOURCE FOR THE WINDOW. Before this, the ancestral-hour reminder (`spiritSignal`'s
 * `ancestors.standing`, day.ts) had no date rule at all: it stood all month until the hour was
 * recorded. Everything that now depends on the date — the Today card, the morning email's line, the
 * reminder emails and the one-tap "mark it done" — reads `ancestralWindow` / `ancestralHourState`
 * here, so the four cannot disagree about which days count.
 *
 * THE WINDOW is the last day of the month and the three days before it, on HER calendar (Central),
 * never UTC and never the Mac's own zone (her Mac is on Eastern: a tick at 23:30 Eastern on the 27th
 * is still 22:30 on the 27th in Central). 31 Oct → 28–31; 30 Nov → 27–30; 28 Feb → 25–28;
 * 29 Feb → 26–29.
 *
 * DONE is the existing truth, unchanged: the month's ancestor_entries reach the hour
 * (ANCESTOR_MINUTES_TARGET). "Done ✓" records the rest of the hour as an entry, so the Spirit tab's
 * standing reminder, the Today card, the morning line and the reminder emails all clear together.
 */
import { ANCESTOR_MINUTES_TARGET } from "./day";
import { dayIdInZone, wallClock } from "../../../shared/boss/timezone";

/** The last day and the three before it. */
export const ANCESTRAL_WINDOW_DAYS_BEFORE = 3;
/** Mid-morning on her clock: the reminder email goes on the first and last day of the window from here. */
export const ANCESTRAL_REMINDER_HOUR = 10;
/** No reminder email after this hour (Central): a 23:00 nudge helps nobody. The Today card still stands. */
export const ANCESTRAL_REMINDER_LAST_HOUR = 21;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Days in a month, 1-based month: Feb 2028 → 29, Feb 2027 → 28. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export type AncestralWindow = {
  day: string;
  month: string;
  month_name: string;
  last_day: string;
  first_day: string;
  in_window: boolean;
  /** Days left AFTER today, as the morning email has always counted them: 3 on the 28th of a 31-day month, 0 on the last day. */
  days_left: number;
  is_first_day: boolean;
  is_last_day: boolean;
};

/** The window for a Central day id (`YYYY-MM-DD`). Pure. */
export function ancestralWindow(day: string): AncestralWindow {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`"${day}" is not a YYYY-MM-DD day`);
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const last = daysInMonth(y, mo);
  const first = last - ANCESTRAL_WINDOW_DAYS_BEFORE;
  const pad = (n: number) => String(n).padStart(2, "0");
  const month = `${y}-${pad(mo)}`;
  return {
    day,
    month,
    month_name: MONTHS[mo - 1]!,
    last_day: `${month}-${pad(last)}`,
    first_day: `${month}-${pad(first)}`,
    in_window: d >= first && d <= last,
    days_left: last - d,
    is_first_day: d === first,
    is_last_day: d === last,
  };
}

export type AncestralHourState = AncestralWindow & {
  minutes: number;
  target_minutes: number;
  done: boolean;
  /** The Today card and the morning line show only inside the window. */
  show: boolean;
  /** warm = the gold accent; alarm = red, only on the last day and not yet done. */
  tone: "warm" | "alarm" | "done" | null;
  /** "🕯 Ancestral hour: 4 days left this month" / "… today is the last day". */
  headline: string | null;
  /** One plain sentence under the headline. */
  line: string | null;
};

/** "today is the last day" / "1 day left this month" / "3 days left this month". */
export function countdownWords(w: AncestralWindow): string {
  return w.is_last_day ? "today is the last day" : `${w.days_left} day${w.days_left === 1 ? "" : "s"} left this month`;
}

/** What the card, the morning line and the reminder all say, from the day and the month's minutes. Pure. */
export function ancestralHourState(day: string, minutes: number): AncestralHourState {
  const w = ancestralWindow(day);
  const done = minutes >= ANCESTOR_MINUTES_TARGET;
  const show = w.in_window;
  const countdown = countdownWords(w);
  return {
    ...w,
    minutes,
    target_minutes: ANCESTOR_MINUTES_TARGET,
    done,
    show,
    tone: !show ? null : done ? "done" : w.is_last_day ? "alarm" : "warm",
    headline: !show ? null : done ? `🕯 Ancestral hour: done for ${w.month_name} ✓` : `🕯 Ancestral hour: ${countdown}`,
    line: !show
      ? null
      : done
        ? "Recorded. Nothing else to do this month."
        : minutes > 0
          ? `${minutes} of ${ANCESTOR_MINUTES_TARGET} minutes so far in ${w.month_name}. Tap Done when the hour is finished.`
          : `An hour with your ancestors before ${w.month_name} ends. Tap Done when it is finished.`,
  };
}

/** The Central day and hour of an instant: the clock every rule above is read on. */
export function centralNow(now: number): { day: string; hour: number } {
  return { day: dayIdInZone(now), hour: wallClock(now).h };
}

export type ReminderVerdict =
  | { due: true; day: string; kind: "first" | "last" }
  | { due: false; reason: "outside_window" | "not_a_reminder_day" | "too_early" | "too_late" | "done" | "already_sent" };

/**
 * Is a reminder email due now? The first and the last day of the window, from mid-morning Central,
 * never when the month's hour is done, never twice for one day. Pure: `sentToday` is the caller's read.
 */
export function reminderVerdict(now: number, minutes: number, sentToday: boolean): ReminderVerdict {
  const { day, hour } = centralNow(now);
  const s = ancestralHourState(day, minutes);
  if (!s.in_window) return { due: false, reason: "outside_window" };
  if (!s.is_first_day && !s.is_last_day) return { due: false, reason: "not_a_reminder_day" };
  if (s.done) return { due: false, reason: "done" };
  if (sentToday) return { due: false, reason: "already_sent" };
  if (hour < ANCESTRAL_REMINDER_HOUR) return { due: false, reason: "too_early" };
  if (hour > ANCESTRAL_REMINDER_LAST_HOUR) return { due: false, reason: "too_late" };
  return { due: true, day, kind: s.is_last_day ? "last" : "first" };
}

/** The reminder email, in plain words: one line of what, one tap to mark it done. */
export function reminderNotice(state: AncestralHourState, doneUrl: string, _spiritUrl?: string) {
  const when = state.is_last_day ? `Today is the last day of ${state.month_name}` : `${state.days_left} day${state.days_left === 1 ? "" : "s"} left in ${state.month_name}`;
  return {
    subject: `Your ancestral hour: ${countdownWords(state)}`,
    happened: `${when} for your ancestral hour.${state.minutes > 0 ? ` ${state.minutes} of ${state.target_minutes} minutes are recorded so far.` : ""} When it is done, tap the button and the reminders stop for this month.`,
    details: [] as string[],
    decide: [{
      title: "Ancestral hour",
      body: `${countdownWords(state).replace(/^t/, "T")}.`,
      // One link, to mark it done (owner, 31 Oct 2026). `spiritUrl` is kept for callers that want it.
      buttons: [{ label: "Done ✓", url: doneUrl }],
    }],
  };
}

/** The 31-char one-tap token (`anc…`), the same shape and door as Simone's `cmd…` taps. */
export function ancestralTapToken(): string {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(28));
  return "anc" + [...r].map((b) => a[b % a.length]).join("");
}
export function isAncestralToken(token: string): boolean {
  return /^anc[A-Za-z0-9]{20,37}$/.test(token);
}

// ─── D1: the month's minutes, the reminder rows, and Done ──────────────────────

export async function monthMinutes(db: D1Database, month: string): Promise<number> {
  const r = await db.prepare(`SELECT COALESCE(SUM(minutes),0) AS minutes FROM ancestor_entries WHERE month = ?`).bind(month).first<{ minutes: number }>();
  return r?.minutes ?? 0;
}

/** Today's state for the Today card: her Central day, the month's minutes. */
export async function ancestralHourNow(db: D1Database, now = Date.now()): Promise<AncestralHourState> {
  const { day } = centralNow(now);
  return ancestralHourState(day, await monthMinutes(db, day.slice(0, 7)));
}

/**
 * DONE ✓: records the rest of the hour for the month, once. A second tap (the card, then the email)
 * finds the hour met and writes nothing. The entry is filed under HER month (Central), the same
 * month every read above uses.
 */
export async function markAncestralHourDone(db: D1Database, source: "today" | "email", now = Date.now()): Promise<{ recorded: boolean; state: AncestralHourState }> {
  const before = await ancestralHourNow(db, now);
  if (before.done) return { recorded: false, state: before };
  const id = `anc_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const remaining = before.target_minutes - before.minutes;
  await db.prepare(
    `INSERT INTO ancestor_entries (id, ts, month, who, relation, kind, minutes, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(id, now, before.month, "My ancestors", null, "ritual", remaining, `The ancestral hour, marked done from ${source === "email" ? "the reminder email" : "Today"}.`, now).run();
  return { recorded: true, state: await ancestralHourNow(db, now) };
}

/**
 * CLAIM THE DAY'S REMINDER, OR SAY WHY NOT. One row per Central day (PRIMARY KEY), so the email can
 * never go twice for one day: a sent row is final, and an unsent claim is re-offered only after
 * fifteen minutes (a run that crashed between claim and send), never to two overlapping ticks.
 */
export const CLAIM_HOLD_MS = 15 * 60 * 1000;
export async function claimReminder(db: D1Database, origin: string, now = Date.now()) {
  const { day } = centralNow(now);
  const state = ancestralHourState(day, await monthMinutes(db, day.slice(0, 7)));
  const row = await db.prepare(`SELECT day, tap_token, claimed_at, sent_at FROM ancestral_hour_reminders WHERE day = ?`).bind(day)
    .first<{ day: string; tap_token: string; claimed_at: number | null; sent_at: number | null }>();
  const verdict = reminderVerdict(now, state.minutes, Boolean(row?.sent_at));
  if (!verdict.due) return { due: false as const, reason: verdict.reason, day, state };
  if (row?.claimed_at && now - row.claimed_at < CLAIM_HOLD_MS) return { due: false as const, reason: "claimed" as const, day, state };
  const token = row?.tap_token ?? ancestralTapToken();
  if (row) {
    const r = await db.prepare(`UPDATE ancestral_hour_reminders SET claimed_at = ? WHERE day = ? AND sent_at IS NULL AND (claimed_at IS NULL OR claimed_at < ?)`)
      .bind(now, day, now - CLAIM_HOLD_MS).run();
    if (!r.meta.changes) return { due: false as const, reason: "claimed" as const, day, state };
  } else {
    const r = await db.prepare(`INSERT OR IGNORE INTO ancestral_hour_reminders (day, month, kind, tap_token, claimed_at, created_at) VALUES (?,?,?,?,?,?)`)
      .bind(day, state.month, verdict.kind, token, now, now).run();
    if (!r.meta.changes) return { due: false as const, reason: "claimed" as const, day, state };
  }
  const notice = reminderNotice(state, `${origin}/tap/${token}?do=done`, `${origin}/?tab=spirit`);
  return { due: true as const, day, kind: verdict.kind, state, notice };
}

export async function reminderSent(db: D1Database, day: string, now = Date.now()): Promise<boolean> {
  const r = await db.prepare(`UPDATE ancestral_hour_reminders SET sent_at = ? WHERE day = ? AND sent_at IS NULL`).bind(now, day).run();
  return Boolean(r.meta.changes);
}

export async function reminderByToken(db: D1Database, token: string) {
  return db.prepare(`SELECT day, month FROM ancestral_hour_reminders WHERE tap_token = ?`).bind(token).first<{ day: string; month: string }>();
}
