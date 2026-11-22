/**
 * STRUCTURED OUTPUT IN THE PROVIDERS (eng sweep row 8, 22 Nov 2026). A request that carries `json`
 * gets each provider's own schema mode, so no reader fishes fields out of prose. The readers that use it
 * (first read, meaning) walk the free ladder (`freeLadder`), never `routeCompletion`; the router-level
 * `json` option had no caller and was removed (fresh review of #510, R3). Synthetic text only.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readJsonObject, type CompletionRequest, type ProviderAdapter } from "../../src/worker/boss/router/types";
import { anthropic } from "../../src/worker/boss/router/anthropic";
import { gemini } from "../../src/worker/boss/router/gemini";
import { openai } from "../../src/worker/boss/router/openai";
import { openrouter } from "../../src/worker/boss/router/openrouter";
import { fireworks } from "../../src/worker/boss/router/fireworks";
import { workersAi } from "../../src/worker/boss/router/workersAi";
import { stubFetch } from "./helpers";

const SHAPE = { name: "verdict", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } };
const req = (modelSlug: string): CompletionRequest => ({ modelSlug, messages: [{ role: "user", content: "Is the sky blue?" }], maxOutputTokens: 100, temperature: 0, json: SHAPE } as CompletionRequest);

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

describe("readJsonObject", () => {
  it("reads one object, through a fence or a think block; never an array, prose or a broken object", () => {
    expect(readJsonObject('{"ok":true}')).toEqual({ ok: true });
    expect(readJsonObject('<think>hmm</think>\n```json\n{"ok":false}\n```')).toEqual({ ok: false });
    expect(readJsonObject("[1,2]")).toBeNull();
    expect(readJsonObject("OK: yes")).toBeNull();
    expect(readJsonObject('{"ok":')).toBeNull();
    expect(readJsonObject("")).toBeNull();
  });
});

describe("each provider is asked in its own schema mode", () => {
  async function bodyOf(adapter: ProviderAdapter, slug: string, reply: unknown): Promise<{ body: any; text: string }> {
    let body: any = null;
    restore = stubFetch(async (r) => {
      body = JSON.parse(await r.text());
      return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
    });
    const out = await adapter.complete(req(slug), { baseUrl: "https://provider.test", apiKey: "test-key-not-a-real-credential" });
    return { body, text: out.text };
  }

  it("Anthropic: one forced tool, and the text is its input as JSON", async () => {
    const { body, text } = await bodyOf(anthropic, "claude-test", { content: [{ type: "tool_use", name: "verdict", input: { ok: true } }], usage: {} });
    expect(body.tools[0]).toMatchObject({ name: "verdict", input_schema: SHAPE.schema });
    expect(body.tool_choice).toEqual({ type: "tool", name: "verdict" });
    expect(JSON.parse(text)).toEqual({ ok: true });
  });

  it("Gemini: JSON mode held to the schema", async () => {
    const { body } = await bodyOf(gemini, "gemini-2.0-flash", { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: {} });
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", responseJsonSchema: SHAPE.schema });
  });

  it("OpenAI chat, OpenRouter and Fireworks: response_format json_schema; OpenRouter only on providers that honour it", async () => {
    const chat = { choices: [{ message: { content: '{"ok":true}' } }], usage: {} };
    for (const [adapter, slug] of [[openai, "gpt-test"], [openrouter, "vendor/model:free"], [fireworks, "accounts/fireworks/models/test"]] as const) {
      const { body } = await bodyOf(adapter, slug, chat);
      const rf = body.response_format ?? body.text?.format;
      expect(rf?.type, adapter.id).toBe("json_schema");
      expect(JSON.stringify(rf), adapter.id).toContain('"required":["ok"]');
      if (adapter === openrouter) expect(body.provider.require_parameters).toBe(true);
    }
  });

  it("Workers AI: response_format with the schema", async () => {
    let seen: any = null;
    const ai = { run: async (_m: string, input: any) => { seen = input; return { response: { ok: true } }; } };
    const out = await workersAi.complete(req("@cf/meta/llama-3.3-70b-instruct-fp8-fast"), { baseUrl: "", ai: ai as never });
    expect(seen.response_format).toEqual({ type: "json_schema", json_schema: SHAPE.schema });
    expect(JSON.parse(out.text)).toEqual({ ok: true });
  });
});
