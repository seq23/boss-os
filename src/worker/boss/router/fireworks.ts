import type { ProviderAdapter } from "./types";

/** Fireworks speaks the OpenAI chat-completions shape. */
export const fireworks: ProviderAdapter = {
  id: "prv_fireworks",
  async complete(req, apiKey, baseUrl) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
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
      throw new Error(`Fireworks returned ${res.status}: ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as any;
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      inTokens: json.usage?.prompt_tokens ?? 0,
      outTokens: json.usage?.completion_tokens ?? 0,
    };
  },
};
