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
 * Where a model sits on the one ladder — `models.ladder_rung`, migration 0256. Lower is tried first.
 *
 * AN UNPLACED MODEL SORTS LAST, not first. A row nobody put on the ladder has not been considered
 * against the others, and letting it default to 0 would let a model jump the whole queue by having
 * no opinion recorded about it. `Infinity` is the honest reading of "not placed".
 */
export function ladderRung(rung) {
  const n = Number(rung);
  return Number.isFinite(n) ? n : Infinity;
}

/**
 * Cheapest first; at equal cost, the LADDER; then the more capable tier; then the name, so the
 * order is total and a routing decision is reproducible.
 *
 * ─── WHY THE LADDER SITS WHERE IT DOES ──────────────────────────────────────
 *
 * Below cost, because cost is Stage 5's whole definition and a seeded preference may never buy a
 * dearer route. Above capability and the alphabet, because those two are what the ladder replaces:
 * every free route costs 0, so they ALL tie on price, and the tie used to fall through to
 * `display_name.localeCompare` — which is the defect recorded at the top of this file, the one that
 * sent a $1B block trade to an 8B model because "Llama 3.1" sorts before "Llama 3.3".
 *
 * Four free reasoning lanes were added in 0256. Without a rung they would have been ordered by
 * spelling, exactly as before, and the fix would have lasted until the next model with an early
 * initial. The alphabet is still the final tie-break, and it now only ever decides between two rows
 * that cost the same, sit on the same rung and share a tier — which is to say, between rows that
 * genuinely have nothing to choose between them.
 *
 * IT IS A SEED, NOT A VERDICT. The router folds `experienceRank` into `costOf` at a weight larger
 * than any price, so a lane whose work gets reworked or rejected sinks beneath one that has never
 * been tried. The ladder decides only what happens before there is evidence.
 *
 * `costOf` is passed in rather than computed here: the estimate depends on the prompt and the
 * route's output ceiling, which are the router's business and not this module's.
 */
export function orderCandidates(models, costOf) {
  return [...(models ?? [])].sort((a, b) => {
    const ca = costOf(a);
    const cb = costOf(b);
    if (ca !== cb) return ca - cb;
    const ra = ladderRung(a.ladder_rung);
    const rb = ladderRung(b.ladder_rung);
    if (ra !== rb) return ra - rb;
    const ta = capabilityRank(a.capability_tier);
    const tb = capabilityRank(b.capability_tier);
    if (ta !== tb) return tb - ta;
    return String(a.display_name ?? "").localeCompare(String(b.display_name ?? ""));
  });
}

/**
 * WHOSE PAID MODEL GOES FIRST, when the work needs a strong one and free has run out.
 *
 * She pays for Claude and for ChatGPT and wants them in that order whenever money is spent on work
 * that needs a highly capable model: Claude family, then OpenAI, then anything else. The vendor is
 * read from what the row IS — a direct Anthropic/OpenAI provider, or the `anthropic/` / `openai/`
 * prefix OpenRouter gives their slugs — never from a display name.
 *
 * This is an ORDER over paid survivors and nothing more. The router applies it only to a billed
 * route, so a free rung still beats every paid one, and it runs at Stage 5 after privacy,
 * capability, availability and the spend lever have each refused what they refuse.
 */
export function vendorFamily(model) {
  const provider = String(model?.provider_id ?? "");
  const slug = String(model?.slug ?? "").toLowerCase();
  if (provider === "prv_anthropic" || slug.startsWith("anthropic/") || slug.startsWith("claude")) return 0;
  if (provider === "prv_openai" || slug.startsWith("openai/") || slug.startsWith("gpt-")) return 1;
  return 2;
}

