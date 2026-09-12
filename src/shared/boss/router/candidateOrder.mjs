/**
 * WHICH FREE MODEL GOES FIRST — THE TIE-BREAK THAT WAS SILENTLY A CAPABILITY DECISION.
 *
 * ─── The failure this exists to end ────────────────────────────────────────
 *
 * 12 September 2026. She emailed "please help me find a seller of $1B+ of OpenAI shares", and
 * `tsk_m2az87r6eh7s3qs2` came back with "Classification: General Inquiry. Routing: Route to Customer
 * Service Team." The routing decision behind it, `rtd_m2b0p2mdcrt61m4g`, named three candidates:
 * two Fireworks models rejected because Fireworks is disabled, and `mdl_cf_llama31_8b` used.
 *
 * `mdl_cf_llama33_70b` is not in that list. Enabled, `capability_tier` general, on the enabled
 * Workers AI backend, and free — Cloudflare's included allowance, `in_micros_1k` and `out_micros_1k`
 * both 0, the same $0 as the 8B. It was never REJECTED. It was never SCREENED.
 *
 * Because the continuity tier is sorted cheapest-first and, at equal cost, by
 * `display_name.localeCompare`. "Llama 3.1 8B" sorts before "Llama 3.3 70B". The 8B is called, it
 * answers, the loop stops. An alphabetical tie-break was overruling Stage 2 — capability — on every
 * mail-driven task this system has ever run, and it was invisible because nothing about it is wrong
 * on cost, on privacy, on availability or on budget.
 *
 * ─── What this module is, and what it deliberately is not ──────────────────
 *
 * It orders SURVIVORS. Everything here runs at Stage 5, after privacy, capability, availability and
 * budget have each had their say; it can never resurrect a candidate an earlier stage refused, and
 * it never widens eligibility. Cost still comes first, and this only speaks when cost is a tie.
 *
 * Plain ESM with a hand-written `.d.mts`, like its neighbours in `shared/boss/intake/`, so
 * `scripts/validate` exercises THIS function rather than a copy of its judgement.
 */

/**
 * How capable a tier is, as an order. The same three words `governance.ts` uses for `allowedTiers`.
 * An unknown tier ranks 0 — below everything named — because a tier nobody has classified is not
 * evidence of capability, and guessing upward is how a cheap model wins a job it cannot do.
 */
export const CAPABILITY_RANK = { fast: 1, general: 2, frontier: 3 };

export function capabilityRank(tier) {
  return CAPABILITY_RANK[String(tier ?? "")] ?? 0;
}

/**
 * Cheapest first; at equal cost, the more capable tier; then the name, so the order is total and a
 * routing decision is reproducible.
 *
 * `costOf` is passed in rather than computed here: the estimate depends on the prompt and the
 * route's output ceiling, which are the router's business and not this module's.
 */
export function orderCandidates(models, costOf) {
  return [...(models ?? [])].sort((a, b) => {
    const ca = costOf(a);
    const cb = costOf(b);
    if (ca !== cb) return ca - cb;
    const ta = capabilityRank(a.capability_tier);
    const tb = capabilityRank(b.capability_tier);
    if (ta !== tb) return tb - ta;
    return String(a.display_name ?? "").localeCompare(String(b.display_name ?? ""));
  });
}
