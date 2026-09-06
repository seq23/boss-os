import { ProviderCallError, type ProviderAdapter } from "./types";

/**
 * Workers AI — the free half of Stage 4.
 *
 * IT IS A BINDING, NOT A CLIENT. Nothing here calls `fetch`, so there is no
 * hostname, no API key, and nothing to add to the egress allowlist. The whole
 * surface is `env.AI.run(model, inputs)`, which is why this file is the cheapest
 * backend to trust as well as the cheapest to run.
 *
 * WHAT $0 HONESTLY MEANS HERE. The account carries an included daily allowance;
 * inside it this work genuinely costs nothing. Beyond it Cloudflare bills
 * neurons, and a Worker cannot read how much of its own allowance is left. So
 * the ledger records 0 and the usage row SAYS SO in its detail, rather than
 * implying the call was measured and found free. That is an absent input
 * recorded as absent.
 */
export const workersAi: ProviderAdapter = {
  id: "prv_workers_ai",
  async complete(req, ctx) {
    if (!ctx.ai) {
      throw new ProviderCallError(
        "The AI binding is not configured on this Worker, so Workers AI cannot run. " +
          "Add an [ai] binding named AI in wrangler.toml.",
        null,
        false,
      );
    }

    let raw: unknown;
    try {
      raw = await ctx.ai.run(req.modelSlug, {
        messages: req.messages,
        max_tokens: req.maxOutputTokens,
        temperature: req.temperature,
      });
    } catch (err) {
      // A binding failure has no HTTP status. Treat it as retryable once: the
      // usual causes (a cold model, a capacity blip) clear on a second attempt,
      // and the circuit breaker stops it repeating beyond that.
      throw new ProviderCallError(`Workers AI failed: ${(err as Error).message}`.slice(0, 300), null, true);
    }

    const json = raw as any;
    const text: string = json?.response ?? json?.result?.response ?? "";
    if (typeof text !== "string" || text.length === 0) {
      throw new ProviderCallError("Workers AI returned no text", null, false);
    }
    // Workers AI reports usage on newer models and omits it on older ones. An
    // omitted count is reported as 0 rather than estimated — the ledger's job is
    // to record what the provider said, not to invent a plausible number.
    return {
      text,
      inTokens: Number(json?.usage?.prompt_tokens ?? 0),
      outTokens: Number(json?.usage?.completion_tokens ?? 0),
    };
  },
};
