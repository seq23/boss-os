import { ProviderCallError, statusIsRetryable, type ProviderAdapter } from "./types";

/**
 * Anthropic, called directly.
 *
 * ─── Why direct rather than through OpenRouter ─────────────────────────────
 *
 * OpenRouter is already wired and is the better trade for utility work: one key, trivial model
 * switching, and free variants that make routine calls genuinely $0. It is the WRONG trade for the
 * one route this adapter exists to serve. Coaching is the conversation carrying her interior life,
 * and `coaching/run.ts` is built around minimising who sees those words — an intermediary is
 * precisely the thing that design is spending effort to avoid. So: OpenRouter for cheap work,
 * direct for the one route where the party list matters.
 *
 * ─── One host, one path ────────────────────────────────────────────────────
 *
 * The base URL is a constant in `backends.ts` and never read from a request body, which is what
 * keeps the egress allowlist honest. Same rule as every other adapter here.
 *
 * ─── The shape difference that matters ─────────────────────────────────────
 *
 * Anthropic's Messages API takes the system prompt as a TOP-LEVEL FIELD rather than as the first
 * message. Passing it as a `system`-role message would not error — it would be rejected as an
 * invalid role, or worse, silently treated as user text — so the split happens here rather than
 * being left to whoever calls this next.
 */
export const anthropic: ProviderAdapter = {
  id: "prv_anthropic",
  async complete(req, ctx) {
    if (!ctx.apiKey) {
      /*
       * A NAMED STOP, NOT A FALLBACK. She approved a specific backend; if its key is absent the
       * honest outcome is a refusal she can read and act on. Quietly answering from something else
       * would mean a different party read her words than the one she consented to, which is the
       * same consent defect as a button naming a provider that is not the one serving.
       */
      throw new ProviderCallError("ANTHROPIC_API_KEY is not in this Worker's environment", null, false);
    }

    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

    const res = await fetch(`${ctx.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ctx.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.modelSlug,
        max_tokens: req.maxOutputTokens,
        temperature: req.temperature,
        ...(system ? { system } : {}),
        messages,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new ProviderCallError(
        `Anthropic returned ${res.status}: ${detail.slice(0, 300)}`,
        res.status,
        statusIsRetryable(res.status),
      );
    }

    const json = (await res.json()) as any;
    const text = (json?.content ?? [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("");
    // An empty completion reported as a success hands the caller a blank reply labelled as an
    // answer, which on this route is a coach that said nothing while appearing to have spoken.
    if (!text) {
      throw new ProviderCallError("Anthropic answered with no text content", null, false);
    }
    return {
      text,
      inTokens: json?.usage?.input_tokens ?? 0,
      outTokens: json?.usage?.output_tokens ?? 0,
    };
  },
};
