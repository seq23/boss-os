/**
 * STRUCTURED OUTPUT IN THE ROUTER (eng sweep row 8, 22 Nov 2026). A caller that asks for `json`
 * gets each provider's own schema mode on the request, and on the free walk an answer that is not
 * one JSON object moves the walk on, the way a failed `accept` check does. The result carries the
 * parsed object, so no caller fishes fields out of prose. Synthetic text only.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routeCompletion } from "../../src/worker/boss/router";
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

describe("the free walk", () => {
  const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
  const withKey = () => { const e = Object.create(env); (e as any).GEMINI_API_KEY = "test-key-not-a-real-credential"; return e as typeof env; };
  beforeEach(async () => { await env.DB.exec("DELETE FROM model_job_outcome"); });

  it("passes over a free answer that is not one JSON object, and hands back the parsed object", async () => {
    const calls: string[] = [];
    restore = stubFetch(async (r) => {
      if (!r.url.startsWith(GEMINI)) return new Response("not here", { status: 500 });
      calls.push(r.url);
      const text = calls.length === 1 ? "OK: yes, it is blue." : '{"ok":true}';
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const out = await routeCompletion(withKey(), {
      routeId: "rt_ops_default", lane: "ops", intakeKind: "research", sensitivity: "public", risk: "low", jobKey: "json-shape-test",
      onlyProviderId: "prv_gemini", freeOnly: true, json: SHAPE,
      messages: [{ role: "user", content: "Is the sky blue?" }],
    } as never);
    expect(calls.length, "the prose answer did not end the walk").toBe(2);
    expect(out.json).toEqual({ ok: true });
  });

  it("an OpenRouter free model that will not take JSON mode is passed over cleanly, and the walk reaches one that will", async () => {
    const seen: string[] = [];
    const chat = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } });
    restore = stubFetch(async (r) => {
      if (r.url.includes("openrouter")) {
        const model = JSON.parse(await r.text()).model as string;
        seen.push(model);
        if (seen.length === 1) return new Response(JSON.stringify({ error: { message: "No endpoints found that can handle the requested parameters.", code: 404 } }), { status: 404, headers: { "content-type": "application/json" } });
        return chat('{"ok":true}');
      }
      // Gemini's free quota is spent, so the walk goes on to OpenRouter.
      return new Response(JSON.stringify({ error: { code: 429, message: "quota" } }), { status: 429, headers: { "content-type": "application/json" } });
    });
    const e = withKey(); (e as any).OPENROUTER_API_KEY = "test-key-not-a-real-credential";
    const out = await routeCompletion(e, {
      routeId: "rt_ops_default", lane: "ops", intakeKind: "research", sensitivity: "public", risk: "low", jobKey: "json-openrouter-test",
      freeOnly: true, json: SHAPE,
      messages: [{ role: "user", content: "Is the sky blue?" }],
    } as never);
    expect(seen.length, seen.join(" > ")).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size, "the refusing model was not asked again").toBe(seen.length);
    expect(out.json).toEqual({ ok: true });
  });
});
