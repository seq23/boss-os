import { ProviderCallError, statusIsRetryable, type ProviderAdapter } from "./types";

/** Mirrors GEMINI_FREE_SEARCH_MODELS (backends.ts), kept here so the adapter imports no wiring. */
const FREE_SEARCH = new Set(["gemini-2.5-flash"]);

/**
 * THINKING HAS ITS OWN ALLOWANCE, ON TOP OF THE ANSWER'S (6 Nov 2026).
 *
 * On the 2.5 and 3.x models `maxOutputTokens` counts thinking AND answer together. A grounded
 * search on a famous founder thought for ~1,700 tokens against a 1,500 cap, stopped at MAX_TOKENS
 * mid-JSON, and Google returns `groundingChunks` only on a finished answer: every prep said "Google
 * search returned no pages". So the caller's cap is the ANSWER's, and thinking gets a bounded budget
 * added to it. Free tier only (this adapter), so the extra tokens cost nothing.
 */
export const THINKING_ALLOWANCE = 4096;
export const thinks = (slug: string) => /^gemini-(2\.5|[3-9])/.test(slug);
export function generationConfig(slug: string, maxOutputTokens: number, temperature: number | undefined) {
  return thinks(slug)
    ? { maxOutputTokens: maxOutputTokens + THINKING_ALLOWANCE, temperature, thinkingConfig: { thinkingBudget: THINKING_ALLOWANCE } }
    : { maxOutputTokens, temperature };
}

/**
 * GOOGLE GEMINI, DIRECT, ON THE FREE TIER (owner, 4 Nov 2026).
 *
 * One host (`GEMINI_HOST` in backends.ts, never read from a request), one key (`GEMINI_API_KEY`, a
 * Worker secret). Only the free-tier model ids in `GEMINI_FREE_MODELS` are recorded free
 * (guard.ts `routeIsBilled`); the same models through OpenRouter stay the paid fallback.
 *
 * THE FREE TIER TRAINS ON WHAT IT IS SENT. Google's terms let it use free-tier prompts to improve its
 * products, so every row here is `data_use = 'TRAINS_ON_PROMPTS'` (migration 0338) and `policy.ts`
 * refuses it any private-model-only work before this file runs. A call that still asks for no
 * training is refused here too: this route cannot honour it, so it fails closed.
 *
 * GROUNDING WITH GOOGLE SEARCH. `webSearch` adds the `google_search` tool; the pages the answer was
 * grounded on come back as `sources` (groundingMetadata.groundingChunks), so a caller can keep only
 * facts whose link Google itself reported.
 */
export const gemini: ProviderAdapter = {
  id: "prv_gemini",
  async complete(req, ctx) {
    if (!ctx.apiKey) throw new ProviderCallError("GEMINI_API_KEY is not set on this Worker", null, false);
    if (req.requireNoTraining) {
      throw new ProviderCallError("The Gemini free tier may keep what it is sent, so it cannot take work that must not be trained on", null, false);
    }
    // Search grounding is free only on the 2.5 models; anywhere else it would be billed, so refuse.
    if (req.webSearch && !FREE_SEARCH.has(req.modelSlug)) {
      throw new ProviderCallError(`Google Search grounding is not free on ${req.modelSlug}, so this search was not made`, null, false);
    }
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = req.messages.filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const res = await fetch(`${ctx.baseUrl}/models/${encodeURIComponent(req.modelSlug)}:generateContent`, {
      method: "POST",
      // The call is abandoned when the router's deadline fires; see deadlines.ts.
      signal: req.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": ctx.apiKey },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: generationConfig(req.modelSlug, req.maxOutputTokens, req.temperature),
        ...(req.webSearch ? { tools: [{ google_search: {} }] } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new ProviderCallError(`Gemini returned ${res.status}: ${detail.slice(0, 300)}`, res.status, statusIsRetryable(res.status));
    }
    const json = (await res.json()) as any;
    const cand = json?.candidates?.[0];
    if (!cand) {
      throw new ProviderCallError(`Gemini returned no answer${json?.promptFeedback?.blockReason ? ` (${json.promptFeedback.blockReason})` : ""}`, null, false);
    }
    const text = (cand.content?.parts ?? []).map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
    // Chunk index → position in `sources`, so a support still points at the right page after a
    // non-web chunk is dropped.
    const chunks: any[] = cand.groundingMetadata?.groundingChunks ?? [];
    const sources: { title: string; url: string }[] = [];
    const at = new Map<number, number>();
    chunks.forEach((g: any, i: number) => {
      const w = g?.web;
      if (typeof w?.uri !== "string" || !/^https:\/\//.test(w.uri)) return;
      at.set(i, sources.length);
      sources.push({ title: String(w.title ?? w.uri).slice(0, 200), url: String(w.uri) });
    });
    const supports = (cand.groundingMetadata?.groundingSupports ?? [])
      .map((s: any) => ({
        start: Number(s?.segment?.startIndex ?? 0),
        end: Number(s?.segment?.endIndex ?? 0),
        sources: (Array.isArray(s?.groundingChunkIndices) ? s.groundingChunkIndices : [])
          .map((i: unknown) => at.get(Number(i))).filter((i: unknown): i is number => typeof i === "number"),
      }))
      .filter((s: { start: number; end: number; sources: number[] }) => Number.isFinite(s.end) && s.end > s.start && s.sources.length > 0);
    return {
      text,
      inTokens: json?.usageMetadata?.promptTokenCount ?? 0,
      outTokens: json?.usageMetadata?.candidatesTokenCount ?? 0,
      ...(sources.length ? { sources } : {}),
      ...(supports.length ? { supports } : {}),
    };
  },
};
