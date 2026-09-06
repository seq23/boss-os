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
