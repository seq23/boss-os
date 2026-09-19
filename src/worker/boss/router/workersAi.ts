import { ProviderCallError, type ProviderAdapter } from "./types";

/**
 * Resolve the work, or reject the moment the signal fires — whichever happens first.
 *
 * An absent signal means no deadline was supplied, which only a direct test or bench call does; the
 * router always supplies one.
 */
async function withDeadline<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await work;
  if (signal.aborted) throw new Error("the deadline for this call had already passed");
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new Error("the call passed its deadline and was abandoned")),
        { once: true },
      );
    }),
  ]);
}

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
      /*
       * RACED AGAINST THE DEADLINE, BECAUSE A BINDING TAKES NO SIGNAL.
       *
       * `env.AI.run` has no `signal` option, so the abort cannot be handed to it the way the four
       * fetch adapters hand it to `fetch`. Racing is the honest second-best: the run stops waiting
       * and the ladder moves on, even though the binding call itself continues in the background.
       * Leaving this adapter alone because the mechanism is imperfect would have left the ONE
       * always-enabled, always-free backend as the single unbounded call on the path — which is the
       * one most likely to be reached, since it is where every fallback lands.
       */
      raw = await withDeadline(
        ctx.ai.run(req.modelSlug, {
          messages: req.messages,
          max_tokens: req.maxOutputTokens,
          temperature: req.temperature,
        }),
        req.signal,
      );
    } catch (err) {
      // A binding failure has no HTTP status. Treat it as retryable once: the
      // usual causes (a cold model, a capacity blip) clear on a second attempt,
      // and the circuit breaker stops it repeating beyond that.
      throw new ProviderCallError(`Workers AI failed: ${(err as Error).message}`.slice(0, 300), null, true);
    }

    const json = raw as any;
    let text: unknown = json?.response ?? json?.result?.response ?? "";
    /*
     * A STRUCTURED REPLY IS STILL A REPLY. Seen on 19 Sep 2026 with Llama 3.3 70B asked for a bare
     * JSON array of search queries: the binding handed back `response` already parsed (an array,
     * not a string), and this adapter threw "returned no text" over a perfectly good answer. The
     * caller asked for JSON and parses JSON, so the honest thing is to hand it the JSON text.
     */
    if (text !== null && typeof text === "object") text = JSON.stringify(text);
    if (typeof text !== "string" || text.length === 0) {
      const keys = json && typeof json === "object" ? Object.keys(json).join(",") : typeof json;
      throw new ProviderCallError(`Workers AI returned no text (reply keys: ${keys || "none"})`, null, false);
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
