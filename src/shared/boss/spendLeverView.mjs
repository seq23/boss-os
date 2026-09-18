/**
 * WHAT THE SPEND LEVER PANEL SHOWS, DERIVED IN ONE PLACE THAT A TEST CAN RUN.
 *
 * ─── The defect this exists because of ──────────────────────────────────────
 *
 * On 18 September 2026 `settings.spend_lever` read MODERATE, `spend_lever_moderate_micros` read
 * 25000000, and the Settings screen said FREE ONLY — $0. Nothing threw. The panel stored the whole
 * `{ lever, positions, lane_budgets, backend_spend }` envelope and read `envelope.position`, one
 * level too shallow on every line, so every read fell through to a fallback derived from
 * `budgets.hard_stop` — and `setSpendLever` writes `hard_stop = 1` for MODERATE as well as
 * FREE_ONLY, so that fallback was a two-state guess at a three-state lever which could never say
 * MODERATE and defaulted to the reassuring end.
 *
 * WHY IT LIVES HERE RATHER THAN INLINE IN THE TSX. A derivation written inside a component is one
 * no test can reach without rendering, and this one was wrong for as long as it existed while every
 * test passed. Exported, it is fifteen lines a validator can run against the exact envelope the
 * route returns — which is the difference between a rule written down and a rule something fails on.
 *
 * IT NEVER INVENTS A POSITION. When the lever cannot be read, `position` is null and `known` is
 * false. Guessing "free only" on the one screen whose job is saying whether money may be spent is
 * the worst available default: it is the answer that makes her stop looking.
 */

/**
 * @param envelope the body of `GET /api/boss/system/spend-lever`, or null if it could not be read
 * @param opsMonth the ops-month row from `budgets`, used only as a stated fallback
 */
export function leverView(envelope, opsMonth = null) {
  const state = envelope?.lever ?? null;
  const position = state && typeof state.position === "string" ? state.position : null;
  const known = position !== null;
  const open = position === "OPEN";

  /*
   * THE FIGURE IS MEASURED IN THE LEVER'S OWN SCOPE, WHICH IS PER BACKEND. `spendLeverState`'s
   * label says so in words — "up to $X of paid work per month, per backend" — so the number set
   * against that ceiling is one backend's spend, not the ops lane's total. The backend closest to
   * the ceiling is the one the next call gets refused on, so that is the one worth showing.
   */
  const backendSpend = Array.isArray(envelope?.backend_spend)
    ? envelope.backend_spend.map((b) => Number(b?.spent_micros ?? 0)).filter((n) => Number.isFinite(n))
    : [];
  const spent = known && backendSpend.length > 0
    ? Math.max(...backendSpend)
    : Number(opsMonth?.spent_micros ?? 0);

  const allowance = Number(state?.allowanceMicros ?? (known ? 0 : opsMonth?.limit_micros ?? 0));
  const moderate = Number(state?.moderateMicros ?? opsMonth?.limit_micros ?? 0);
  const pct = allowance > 0 ? Math.min(100, Math.round((spent / allowance) * 100)) : 0;

  return {
    position, known, open, spent, allowance, moderate, pct,
    remedy: known && typeof state?.remedy === "string" ? state.remedy : null,
    /** The scope of `spent`, so the label can never claim a scope the figure does not have. */
    spentScope: known && backendSpend.length > 0 ? "dearest_backend" : "ops_month",
  };
}
