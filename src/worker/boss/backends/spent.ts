/**
 * A SEAT WHOSE PLAN IS OUT OF USAGE (29 Sep 2026, migration 0274).
 *
 * The cooldown a runner's report asks for, bounded both ways, and the sentence the guard shows. Kept
 * beside the guard rather than inside it because three places need the same numbers — the report
 * route that writes the row, the guard that refuses on it, and the printed ladder that marks the seat
 * ineligible — and three copies is how they would disagree about whether a seat was available.
 *
 * MUST MATCH `scripts/lib/seat-usage-limit.mjs` (DEFAULT/MIN/MAX_COOLDOWN_SECONDS); `tests/boss`
 * pins the two to each other.
 */
export const SEAT_SPENT_DEFAULT_COOLDOWN_S = 30 * 60;
export const SEAT_SPENT_MIN_COOLDOWN_S = 60;
export const SEAT_SPENT_MAX_COOLDOWN_S = 24 * 60 * 60;

/** Seconds to skip a spent seat: the notice's own reset time when it gave one, bounded; a default when not. */
export function spentCooldownSeconds(requested: unknown): number {
  const n = typeof requested === "number" ? requested : Number(requested);
  if (!Number.isFinite(n) || n <= 0) return SEAT_SPENT_DEFAULT_COOLDOWN_S;
  return Math.min(SEAT_SPENT_MAX_COOLDOWN_S, Math.max(SEAT_SPENT_MIN_COOLDOWN_S, Math.round(n)));
}

/** Is this backend inside a reported spent-plan cooldown at `now`? Pure. */
export function isPlanSpent(row: { exhausted_until?: number | null } | null | undefined, now: number): boolean {
  const until = row?.exhausted_until;
  return typeof until === "number" && Number.isFinite(until) && until > now;
}

/** "in about 25 minutes" — a person's sentence, not a timestamp. */
export function untilWords(untilMs: number, now: number): string {
  const s = Math.max(0, Math.round((untilMs - now) / 1000));
  if (s < 90) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? "" : "s"}`;
}
