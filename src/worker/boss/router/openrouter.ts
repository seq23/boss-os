import { ProviderCallError, statusIsRetryable, type ProviderAdapter } from "./types";

/**
 * OpenRouter — the availability half of Stage 4.
 *
 * WHY IT EXISTS. Addendum §1: no critical capability may depend permanently on
 * one external provider. This is the second cloud vendor, reached the same way
 * Fireworks is: through the Boss router, which has already applied data
 * sensitivity, capability, availability and budget before this file runs.
 *
 * ONE HOST, ONE PATH. The base URL is held in `backends.ts` as a constant and is
 * never read from a request body, so no caller can point this adapter somewhere
 * new. That is what makes the single egress-allowlist entry honest.
 *
 * FREE MODELS ARE THE POINT. OpenRouter publishes `:free` variants; the router
 * treats a zero price as spendable at the FREE_ONLY lever position ONLY when the
 * slug is one of those, because a zero in a price column is as likely to be an
 * unrecorded price as a real one.
 *
 * ─── THE PRIVACY CLAIM ENFORCES ITSELF ──────────────────────────────────────
 *
 * Migration 0249 recorded every OpenRouter route as TRAINS_ON_PROMPTS, because whether a route
 * trains is an account setting on a web page that this Worker cannot read. 0256 supersedes that
 * for the paid rungs, and NOT by trusting a vendor's reputation — by using the control OpenRouter
 * exposes on the request itself:
 *
 *   provider: { data_collection: "deny" }
 *
 * OpenRouter refuses to route that call to any endpoint which collects. It is enforced by the
 * vendor, per call, and it FAILS CLOSED: a request it cannot satisfy comes back 404 rather than
 * quietly going somewhere that trains. Proven both ways on 17 September 2026 — all six paid rungs
 * served under the flag, and two `:free` rungs were refused with "No endpoints found matching your
 * data policy (Free model training)".
 *
 * IT IS SENT FOR EVERY NON-TRAINING MODEL, NOT ONLY FOR WORK LABELLED PRIVATE, and that is the
 * whole design. If the flag were conditional on the caller's label, a row could claim to be
 * private-capable and then be called without the claim ever being tested — the claim would be true
 * only when somebody remembered, which is the shape this repository refuses everywhere else. Tying
 * it to the ROW instead means a model recorded as non-training cannot be reached without OpenRouter
 * being asked to honour that recording, and if OpenRouter ever stops honouring it, these lanes stop
 * serving instead of leaking. The cost of sending it always is nothing: the same six lanes served.
 *
 * AND IT IS NOT SENT FOR THE FREE LANES, because they would 404. That is not a hole — a free lane
 * is recorded TRAINS_ON_PROMPTS, so `policy.ts` has already refused it any private work before this
 * file runs. The two mechanisms guard the same line from opposite sides.
 */
export const openrouter: ProviderAdapter = {
  id: "prv_openrouter",
  async complete(req, ctx) {
    if (!ctx.apiKey) {
      throw new ProviderCallError("OPENROUTER_API_KEY is not set on this Worker", null, false);
    }
    const res = await fetch(`${ctx.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ctx.apiKey}`,
        // OpenRouter attributes traffic by these two headers. Neither carries a
        // record: the title is the product name and nothing else travels.
        "x-title": "Boss OS",
      },
      body: JSON.stringify({
        model: req.modelSlug,
        messages: req.messages,
        max_tokens: req.maxOutputTokens,
        temperature: req.temperature,
        ...(req.requireNoTraining ? { provider: { data_collection: "deny" } } : {}),
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new ProviderCallError(
        `OpenRouter returned ${res.status}: ${detail.slice(0, 300)}`,
        res.status,
        statusIsRetryable(res.status),
      );
    }

    const json = (await res.json()) as any;
    // OpenRouter can answer 200 with an error body when an upstream model is
    // unavailable. Treating that as a success would hand the caller an empty
    // draft labelled as a completed run.
    if (json?.error) {
      throw new ProviderCallError(
        `OpenRouter returned an error body: ${String(json.error?.message ?? json.error).slice(0, 300)}`,
        null,
        false,
      );
    }
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      inTokens: json.usage?.prompt_tokens ?? 0,
      outTokens: json.usage?.completion_tokens ?? 0,
    };
  },
};
