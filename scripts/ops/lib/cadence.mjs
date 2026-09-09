/**
 * HOW OFTEN TWO PEOPLE ACTUALLY TALK, IN DAYS — the one definition, in one place.
 *
 * ─── Why this file exists at all ────────────────────────────────────────────
 *
 * `contacts-sync.mjs` computed this and wrote it to Boss OS. `people-worth-a-call.mjs` needs the
 * identical number to decide who has gone quiet, and the obvious thing — copying eight lines — is
 * this repository's most-produced defect: two components each keeping their own version of the same
 * rule, agreeing on the day they are written and drifting silently afterwards. The People roster's
 * scores and the sync that fed them were exactly that, and the result was two hundred rows reading
 * `trust 100 · recency 0` because one half had stopped meaning what the other half assumed.
 *
 * It cannot be imported from `contacts-sync.mjs`: that file calls `main()` at the top level, so an
 * import would run a mailbox sync as a side effect of asking a question about arithmetic.
 *
 * ─── The rule, unchanged from the day it was written ────────────────────────
 *
 * OBSERVED, WITH A FLOOR AND A CEILING. Fewer than 14 days would put a daily correspondent on the
 * overdue list constantly, which is noise; more than 120 means a relationship can decay for four
 * months before anything says so, which is the failure being prevented. Between those it is simply
 * the average gap between exchanges, widened by half so a normal pause is not called late.
 */
export function observedCadence(c) {
  const exchanges = c.sent + c.received;
  const first = Date.parse(c.first_at);
  const last = Date.parse(c.last_at);
  const spanDays = Math.max(1, (last - first) / 86_400_000);
  const avgGap = spanDays / Math.max(1, exchanges - 1);
  return Math.round(Math.min(120, Math.max(14, avgGap * 1.5)));
}
