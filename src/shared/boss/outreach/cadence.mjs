/**
 * THE OUTREACH CADENCE, ONE SOURCE FOR EVERY SENDER (owner ruling, 6 Nov 2026; risk brain R-EML-04).
 *
 *   · A first email and up to THREE follow-ups: four emails to one person at most, then never again.
 *   · The follow-ups go on day 3, day 7 and day 14, counted from the FIRST send (a weekend or a cap
 *     delays a touch; it never pulls the next one closer than MIN_TOUCH_GAP_DAYS to the last).
 *   · Any reply, bounce or opt-out stops that person at once (each sender's stop states).
 *   · Any spam complaint pauses the WHOLE sequence: a named stop she sees, never lifted by itself.
 *   · A follow-up past the second email goes only in words she approved (each sender's approval path).
 *
 * Every sender reads these numbers; tests and scripts/validate/lp-rules.mjs pin them. Pure, no I/O.
 */
export const DAY_MS = 86_400_000;
export const MAX_EMAILS_PER_PERSON = 4;
export const MAX_FOLLOW_UPS = MAX_EMAILS_PER_PERSON - 1;
/** Days after the FIRST send that touch n+1 is due (index 0 = the first email). */
export const TOUCH_DAYS = Object.freeze([0, 3, 7, 14]);
/** The smallest gap between two touches to one person (day 3 → day 7 is four; day 0 → day 3 is three). */
export const MIN_TOUCH_GAP_DAYS = 3;

/** Days between follow-up `step` (1, 2 or 3) and the email before it, for senders that count from the last send. */
export function afterDaysFor(step) {
  if (!(Number.isInteger(step) && step >= 1 && step <= MAX_FOLLOW_UPS)) throw new Error(`no follow-up number ${step}; the cadence has ${MAX_FOLLOW_UPS}`);
  return TOUCH_DAYS[step] - TOUCH_DAYS[step - 1];
}

/**
 * When touch `touches + 1` is due (ms), or null when the sequence is over (four sent) or not started.
 * `touches` = emails already sent; `firstSentAt` / `lastTouchAt` in ms.
 */
export function nextTouchDueAt({ touches, firstSentAt, lastTouchAt }) {
  const n = Number(touches ?? 0);
  if (!(n >= 1) || n >= MAX_EMAILS_PER_PERSON || !(Number(firstSentAt) > 0)) return null;
  const byFirst = Number(firstSentAt) + TOUCH_DAYS[n] * DAY_MS;
  const byLast = Number(lastTouchAt ?? firstSentAt) + MIN_TOUCH_GAP_DAYS * DAY_MS;
  // Due from the START of that Central day, not to the millisecond. The senders run once a day at a
  // fixed time and take a few seconds longer some days: counted to the millisecond, an email sent at
  // 09:31:10 on Tuesday was "not due" to Friday's run reading its plan at 09:31:05, and the touch
  // slipped to Monday behind a run that said "0 sent" (13 Nov 2026).
  return startOfCentralDay(Math.max(byFirst, byLast));
}

const CENTRAL = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
/** The first millisecond of the America/Chicago calendar day that `ms` falls in. Pure. */
export function startOfCentralDay(ms) {
  const part = Object.fromEntries(CENTRAL.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  const intoDay = (part.hour * 3600 + part.minute * 60 + part.second) * 1000 + (ms % 1000);
  return ms - intoDay;
}

/** The touch number due now (2, 3 or 4), or null. Never a fifth email, whatever the input. */
export function followUpDue(p, now = Date.now()) {
  const at = nextTouchDueAt(p);
  return at !== null && now >= at ? Number(p.touches) + 1 : null;
}

/** The named stop a spam complaint raises: the whole sequence pauses until she lifts it. */
export function complaintStop(sender, n = 1) {
  return `NAMED STOP [SPAM_COMPLAINT] ${n} spam complaint${n === 1 ? "" : "s"} on ${sender}: the whole sequence is paused and nobody gets another email until you look at it and lift the pause.`;
}

/** A short stable hash of approved words (FNV-1a, two lanes). Pure. */
export function wordsHash(text) {
  const s = String(text ?? "");
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
