import { ProviderCallError, statusIsRetryable, WEB_SEARCH_CALL_MICROS, type AdapterContext, type CompletionRequest, type ProviderAdapter } from "./types";

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

    if (req.webSearch) return completeWithSearch(req, ctx);

    const res = await fetch(`${ctx.baseUrl}/chat/completions`, {
      method: "POST",
      // The call is abandoned when the router's deadline fires; see deadlines.ts.
      signal: req.signal,
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

/**
 * A generation that may search the web first — the Responses API with its built-in `web_search`
 * tool, which is the only way a cloud model here can open a page and cite it.
 *
 * WHY THIS EXISTS (30 Sep 2026). The cloud rungs answered the executive briefing from the prompt
 * alone: no files, no web, so the report was a short brief with no sources and no current figures.
 * This is the rung that can produce the real thing when both of her subscription seats are spent
 * and she has opened the spend lever. It is never reached at FREE_ONLY — it is metered, and the
 * router's guard refuses metered rungs there before this adapter runs.
 *
 * `system` messages become `instructions` and the rest become the input, because that is the shape
 * the endpoint takes. The citations come from the `url_citation` annotations on the answer, which
 * are the pages the tool actually returned — not URLs the model typed — and the caller compares the
 * report's own source list against them.
 */
async function completeWithSearch(req: CompletionRequest, ctx: AdapterContext) {
  const instructions = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const input = req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch(`${ctx.baseUrl}/responses`, {
    method: "POST",
    signal: req.signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${ctx.apiKey}` },
    body: JSON.stringify({
      model: req.modelSlug,
      ...(instructions ? { instructions } : {}),
      input,
      tools: [{ type: "web_search" }],
      max_output_tokens: req.maxOutputTokens,
      temperature: req.temperature,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new ProviderCallError(
      `OpenAI returned ${res.status} on a web-search call: ${detail.slice(0, 300)}`,
      res.status,
      statusIsRetryable(res.status),
    );
  }

  const json = (await res.json()) as any;
  const output: any[] = Array.isArray(json?.output) ? json.output : [];
  let text = "";
  const sources: { title: string; url: string }[] = [];
  let searches = 0;
  for (const item of output) {
    if (item?.type === "web_search_call") searches++;
    if (item?.type !== "message") continue;
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (part?.type !== "output_text") continue;
      text += typeof part.text === "string" ? part.text : "";
      for (const a of Array.isArray(part.annotations) ? part.annotations : []) {
        if (a?.type === "url_citation" && typeof a.url === "string" && !sources.some((s) => s.url === a.url)) {
          sources.push({ title: typeof a.title === "string" ? a.title : a.url, url: a.url });
        }
      }
    }
  }
  if (!text && typeof json?.output_text === "string") text = json.output_text;
  if (!text) {
    const why = json?.incomplete_details?.reason ? ` (${json.incomplete_details.reason})` : "";
    throw new ProviderCallError(`OpenAI answered a web-search call with no text${why}`, null, false);
  }
  return {
    text,
    inTokens: json?.usage?.input_tokens ?? 0,
    outTokens: json?.usage?.output_tokens ?? 0,
    sources,
    extraCostMicros: searches * WEB_SEARCH_CALL_MICROS,
  };
}
