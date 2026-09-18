import { ProviderCallError, statusIsRetryable, type ProviderAdapter } from "./types";

/** Fireworks speaks the OpenAI chat-completions shape. */
export const fireworks: ProviderAdapter = {
  id: "prv_fireworks",
  async complete(req, ctx) {
    if (!ctx.apiKey) {
      // Recorded as absent, never guessed: an adapter reached without its
      // credential says which credential is missing rather than failing obscurely.
      throw new ProviderCallError("FIREWORKS_API_KEY is not set on this Worker", null, false);
    }
    const res = await fetch(`${ctx.baseUrl}/chat/completions`, {
      method: "POST",
      // The call is abandoned when the router's deadline fires; see deadlines.ts.
      signal: req.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ctx.apiKey}`,
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
        `Fireworks returned ${res.status}: ${detail.slice(0, 300)}`,
        res.status,
        statusIsRetryable(res.status),
      );
    }

    const json = (await res.json()) as any;
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      inTokens: json.usage?.prompt_tokens ?? 0,
      outTokens: json.usage?.completion_tokens ?? 0,
    };
  },
};
