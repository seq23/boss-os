import { ProviderCallError, statusIsRetryable, type ProviderAdapter } from "./types";

/**
 * OpenAI, called directly.
 *
 * ─── Why two frontier providers rather than one ────────────────────────────
 *
 * Her question was "so open ai or anthropic - maybe using openrouter?", and the honest answer is
 * that both are capable of this and picking on reputation proves nothing. The router exists to make
 * backends swappable, so she can run a week on one and a week on the other and keep whichever she
 * trusts more WHEN IT DISAGREES WITH HER — which is the property she actually asked for and the
 * only one that can be tested rather than asserted.
 *
 * Addendum §1 applies as well: no critical capability may depend permanently on one external
 * provider. Coaching now has two.
 *
 * ─── And the part a vendor choice will not deliver ─────────────────────────
 *
 * She asked for "the best thinking brains and the most integrity". The first is a model choice. The
 * SECOND IS THE SYSTEM PROMPT: a frontier model will flatter her happily if the prompt invites it,
 * and a coach that agrees with everything is worse than none because she acts on it. See
 * `buildCoachingPrompt` in `coaching/session.ts`, where that is asked for explicitly.
 */
export const openai: ProviderAdapter = {
  id: "prv_openai",
  async complete(req, ctx) {
    if (!ctx.apiKey) {
      // A named stop rather than a fallback — see the note in the Anthropic adapter. She consented
      // to one backend, and something else answering is a consent defect, not a graceful degradation.
      throw new ProviderCallError("OPENAI_API_KEY is not in this Worker's environment", null, false);
    }

    const res = await fetch(`${ctx.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ctx.apiKey}` },
      body: JSON.stringify({
        model: req.modelSlug,
        messages: req.messages,
        max_completion_tokens: req.maxOutputTokens,
        temperature: req.temperature,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new ProviderCallError(
        `OpenAI returned ${res.status}: ${detail.slice(0, 300)}`,
        res.status,
        statusIsRetryable(res.status),
      );
    }

    const json = (await res.json()) as any;
    const text = json?.choices?.[0]?.message?.content ?? "";
    if (!text) {
      throw new ProviderCallError("OpenAI answered with no text content", null, false);
    }
    return {
      text,
      inTokens: json?.usage?.prompt_tokens ?? 0,
      outTokens: json?.usage?.completion_tokens ?? 0,
    };
  },
};
