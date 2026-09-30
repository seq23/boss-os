import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routeCompletion } from "../../src/worker/boss/router";
import { stampResearchSources } from "../../src/worker/boss/queue/consumer";
import { stubFetch } from "./helpers";

/**
 * THE RESEARCH RUNG (30 Sep 2026): when both subscription seats are spent and she has opened the
 * spend lever, the briefing is written by OpenAI WITH its own web-search tool, so it can open a page
 * and cite it. The plain cloud rungs cannot, and their briefing was a short brief with no sources.
 *
 * PROVEN here: the request shape, the confinement to OpenAI, the citation capture, the per-search
 * charge in the ledger, the refusal at FREE_ONLY. UNPROVEN: a live call — that needs her key.
 */

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const responsesBody = {
  output: [
    { type: "web_search_call", id: "ws_1", status: "completed" },
    { type: "web_search_call", id: "ws_2", status: "completed" },
    {
      type: "message",
      content: [{
        type: "output_text",
        text: '{"status":"complete","sections":[]}',
        annotations: [
          { type: "url_citation", url: "https://www.reuters.com/markets/a?utm_source=x", title: "A" },
          { type: "url_citation", url: "https://www.reuters.com/markets/a?utm_source=x", title: "A again" },
          { type: "url_citation", url: "https://home.treasury.gov/b", title: "B" },
        ],
      }],
    },
  ],
  usage: { input_tokens: 10_000, output_tokens: 2_000 },
};

async function openOpenAI() {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', exhausted_until = NULL WHERE id = 'bk_openai'`).run();
  await env.DB.prepare(`UPDATE providers SET enabled = 1 WHERE id = 'prv_openai'`).run();
  await env.DB.prepare(`UPDATE models SET enabled = 1 WHERE id = 'mdl_openai_research'`).run();
}
async function setLever(v: string) {
  await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('spend_lever',?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(v, Date.now()).run();
}
afterEach(async () => { await env.DB.prepare(`DELETE FROM settings WHERE key = 'spend_lever'`).run(); });

const request = () => ({
  routeId: "rt_ops_default", lane: "ops", sensitivity: "private", risk: "low", intakeKind: "research",
  preferStrongVendors: true, webSearch: true, maxOutputTokens: 16_000,
  messages: [{ role: "system" as const, content: "You are an operator." }, { role: "user" as const, content: "Write this morning's briefing." }],
});

describe("the research rung", () => {
  beforeEach(async () => { await openOpenAI(); await setLever("OPEN"); });

  it("calls OpenAI's Responses API with the web_search tool, and only OpenAI", async () => {
    const seen: { url: string; body: any }[] = [];
    restore = stubFetch(async (req) => {
      seen.push({ url: req.url, body: await req.json() });
      return new Response(JSON.stringify(responsesBody), { status: 200, headers: { "content-type": "application/json" } });
    });
    const e = Object.create(env) as any; e.OPENAI_API_KEY = "sk-test";
    const r = await routeCompletion(e, request() as any);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://api.openai.com/v1/responses");
    expect(seen[0]!.body.tools).toEqual([{ type: "web_search" }]);
    expect(seen[0]!.body.max_output_tokens).toBe(16_000);
    expect(seen[0]!.body.instructions).toContain("operator");
    expect(seen[0]!.body.input).toEqual([{ role: "user", content: "Write this morning's briefing." }]);
    expect(r.providerId).toBe("prv_openai");
    expect(r.text).toContain('"status":"complete"');
    // One entry per distinct page the tool returned.
    expect(r.sources?.map((s) => s.title)).toEqual(["A", "B"]);
  });

  it("charges the two searches on top of the tokens", async () => {
    restore = stubFetch(() => new Response(JSON.stringify(responsesBody), { status: 200, headers: { "content-type": "application/json" } }));
    const e = Object.create(env) as any; e.OPENAI_API_KEY = "sk-test";
    const r = await routeCompletion(e, request() as any);
    // 10k in × 2000/1k + 2k out × 8000/1k + 2 searches × 10,000
    expect(r.costMicros).toBe(20_000 + 16_000 + 20_000);
  });

  it("is refused at FREE_ONLY before any call, so the free rungs still get the walk", async () => {
    await setLever("FREE_ONLY");
    let called = false;
    restore = stubFetch(() => { called = true; return new Response("{}", { status: 200 }); });
    const e = Object.create(env) as any; e.OPENAI_API_KEY = "sk-test";
    await expect(routeCompletion(e, request() as any)).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("stops with a named reason when the key is missing rather than answering elsewhere", async () => {
    let called = false;
    restore = stubFetch(() => { called = true; return new Response("{}", { status: 200 }); });
    await expect(routeCompletion(env as any, request() as any)).rejects.toThrow();
    expect(called).toBe(false);
  });
});

describe("stampResearchSources", () => {
  const at = Date.UTC(2026, 8, 30, 12, 0, 0);
  const cited = [{ title: "A", url: "https://www.reuters.com/markets/a?utm_source=x" }];

  it("stamps the read time itself and ignores whatever the model typed", () => {
    const out = stampResearchSources({ sources: [{ name: "A", url: "https://www.reuters.com/markets/a", read_at: "1999-01-01T00:00:00Z" }], gaps: [] }, cited, at) as any;
    expect(out.sources[0].read_at).toBe("2026-09-30T12:00:00.000Z");
    // Same page modulo the tracking query: verified, so nothing is added to gaps.
    expect(out.gaps).toEqual([]);
  });

  it("names a listed source the search never returned, without renumbering the rest", () => {
    const out = stampResearchSources({ sources: [{ name: "A", url: "https://www.reuters.com/markets/a" }, { name: "Made up", url: "https://example.com/x" }] }, cited, at) as any;
    expect(out.sources).toHaveLength(2);
    expect(out.gaps).toHaveLength(1);
    expect(out.gaps[0].why).toContain("https://example.com/x");
  });

  it("returns null for a reply with no report", () => {
    expect(stampResearchSources(null, cited, at)).toBeNull();
  });
});
