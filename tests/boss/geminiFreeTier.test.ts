/**
 * GEMINI FREE TIER + WHAT COUNTS AS PRIVATE (owner, 4 Nov 2026). Google Gemini direct, free tier only
 * (TRAINS_ON_PROMPTS): public work may use it, private-model-only work never does. Private now means
 * the names of LPs who COMMITTED, and deal terms; LP prospects are public. Meeting-prep research runs
 * on it: Google-grounded first, then the guest's own pages, then a named stop. Synthetic names only.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routeCompletion } from "../../src/worker/boss/router";
import { routeIsBilled } from "../../src/worker/boss/backends/guard";
import { GEMINI_FREE_MODELS, GEMINI_HOST } from "../../src/worker/boss/router/backends";
import { researchPerson } from "../../src/worker/boss/routes/research";
import { classifyModelAccess } from "../../src/worker/boss/intake/classify";
import { isConfidentialDraft } from "../../src/worker/boss/duties/seatOrder";
import { row, stubFetch } from "./helpers";

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const withKey = () => { const e = Object.create(env); (e as any).GEMINI_API_KEY = "test-key-not-a-real-credential"; return e as typeof env; };

function geminiAnswer(text: string, sources: { uri: string; title: string }[] = []) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, ...(sources.length ? { groundingMetadata: { groundingChunks: sources.map((web) => ({ web })) } } : {}) }],
    usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 20 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

/** Records every Gemini call (model, grounded?) and answers with `answer(model, body)`. */
function stubGemini(answer: (model: string, body: any) => Response) {
  const calls: { model: string; grounded: boolean }[] = [];
  const other: string[] = [];
  restore = stubFetch(async (req) => {
    if (!req.url.startsWith(GEMINI_HOST)) { other.push(req.url); return new Response("not here", { status: 500 }); }
    const model = decodeURIComponent(/models\/([^:]+):generateContent/.exec(req.url)![1]!);
    const body = await req.json() as any;
    calls.push({ model, grounded: Boolean(body.tools?.some((t: any) => t.google_search)) });
    return answer(model, body);
  });
  return { calls, other };
}

const route = (content: string, extra: Record<string, unknown> = {}) => ({
  routeId: "rt_ops_default", lane: "ops", intakeKind: "research", sensitivity: "private", risk: "low",
  messages: [{ role: "user" as const, content }], ...extra,
});

beforeEach(async () => {
  await env.DB.exec("DELETE FROM prospects; DELETE FROM lp_reply_drafts;");
});

describe("4a · Gemini direct, free tier", () => {
  it("only the verified free ids are free; gemini-4-argon and the 3.1 Pro previews never are", () => {
    for (const slug of GEMINI_FREE_MODELS) expect(routeIsBilled("bk_gemini", slug)).toBe(false);
    for (const slug of ["gemini-4-argon", "gemini-3.1-pro-preview", "gemini-3.1-pro-preview-customtools", "gemini-2.5-pro", "gemini-2.5-flash-lite"]) {
      expect(routeIsBilled("bk_gemini", slug)).toBe(true);
    }
    // The same models through OpenRouter stay paid.
    expect(routeIsBilled("bk_openrouter", "google/gemini-2.5-flash")).toBe(true);
  });

  it("every Gemini row trains on prompts, and the backend reaches one host", async () => {
    const rows = (await env.DB.prepare(`SELECT slug, data_use FROM models WHERE provider_id = 'prv_gemini'`).all<any>()).results;
    expect(rows.map((r) => r.slug).sort()).toEqual([...GEMINI_FREE_MODELS].sort());
    expect(new Set(rows.map((r) => r.data_use))).toEqual(new Set(["TRAINS_ON_PROMPTS"]));
    expect(GEMINI_HOST).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect((await row<any>(`SELECT status FROM execution_backends WHERE id = 'bk_openai'`))!.status).not.toBe("enabled");
  });

  it("public summarise work can route to a free Gemini model", async () => {
    const g = stubGemini(() => geminiAnswer("- one\n- two"));
    const r = await routeCompletion(withKey(), route("Summarise this public article about rooftop gardens.", { jobKey: "summarise", taskId: "tsk_gem_public" }));
    expect(r.providerId).toBe("prv_gemini");
    expect(r.freeTier).toBe(true);
    expect(g.calls.length).toBe(1);
  });

  it("private_model_only work never routes to it", async () => {
    const g = stubGemini(() => geminiAnswer("should never be asked"));
    await routeCompletion(withKey(), route("Summarise this.", { modelAccess: "private_model_only", taskId: "tsk_gem_private" })).catch(() => null);
    expect(g.calls).toEqual([]);
    const cands = JSON.parse((await row<any>(`SELECT candidates FROM routing_decisions WHERE task_id = 'tsk_gem_private'`))!.candidates);
    const gem = cands.filter((c: any) => String(c.model_id).startsWith("mdl_gemini_"));
    expect(gem.length).toBeGreaterThan(0);
    for (const c of gem) expect(c).toMatchObject({ stage: "privacy", verdict: "rejected" });
  });

  it("a grounded call on a model where search is not free is refused before it is made", async () => {
    const g = stubGemini(() => geminiAnswer("x"));
    const err = await routeCompletion(withKey(), route("Search for rooftop gardens.", { onlyProviderId: "prv_gemini", webSearch: true, jobKey: "summarise", taskId: "tsk_gem_search_paid" })).catch((e) => e);
    expect(err).toBeTruthy();
    expect(g.calls.filter((c) => c.grounded && c.model !== "gemini-2.5-flash")).toEqual([]);
  });
});

describe("4b · private means a COMMITTED LP's name, and deal terms; prospects are public", () => {
  const prospect = async (committed: boolean) => {
    await env.DB.prepare(`INSERT INTO prospects (id, email, name, firm, source, created_at, updated_at, committed_at) VALUES ('prs_t1', 'pat@familyoffice.example', 'Pat Example', 'Example Family Office', 'test', 0, 0, ?)`).bind(committed ? Date.now() : null).run();
    await env.DB.prepare(`INSERT INTO lp_reply_drafts (id, address, name, firm, bucket, reply_from, first_seen, created_at, updated_at, committed_at) VALUES ('lpr_t1', 'pat@familyoffice.example', 'Pat Example', 'West Peek Ventures', 'call', 'me@example.com', '2026-11-01', 0, 0, ?)`).bind(committed ? Date.now() : null).run();
  };

  it("a prospect's meeting prep and research route to a free model", async () => {
    await prospect(false);
    const g = stubGemini(() => geminiAnswer("Notes."));
    const r = await routeCompletion(withKey(), route("Meeting prep: write three questions for Pat Example of Example Family Office.", { jobKey: "summarise", taskId: "tsk_prospect_prep" }));
    expect(r.providerId).toBe("prv_gemini");
    expect(g.calls.length).toBe(1);
    expect(classifyModelAccess({ text: "Research LP prospect Pat Example before the intro call", intakeKind: "research" }).access).toBe("public_model_approved");
    expect(isConfidentialDraft({ draft_kind: "lp_reply" })).toBe(false);
  });

  it("a committed LP's name still never reaches a training route", async () => {
    await prospect(true);
    const g = stubGemini(() => geminiAnswer("should never be asked"));
    await routeCompletion(withKey(), route("Meeting prep: write three questions for Pat Example of Example Family Office.", { jobKey: "summarise", taskId: "tsk_committed_prep" })).catch(() => null);
    expect(g.calls).toEqual([]);
    expect((await row<any>(`SELECT model_access FROM routing_decisions WHERE task_id = 'tsk_committed_prep'`))!.model_access).toBe("private_model_only");
    expect(isConfidentialDraft({ draft_kind: "lp_reply", lp_committed: true })).toBe(true);
    expect(isConfidentialDraft({ draft_kind: "deal_terms" })).toBe(true);
    expect(classifyModelAccess({ text: "Quarterly update for our LPs", intakeKind: "drafting" }).access).toBe("private_model_only");
    expect(classifyModelAccess({ text: "Send the term sheet to the prospect", intakeKind: "drafting" }).access).toBe("private_model_only");
  });
});

describe("meeting-prep research: Google-grounded, then their pages, then a named stop", () => {
  const who = { name: "Pat Example", email: "pat@familyoffice.example", firm: "Example Family Office", domain: "familyoffice.example", today: "2026-11-04" };
  const GROUNDED = '```json\n{"found":true,"title":{"text":"Managing Director","url":"https://news.example/pat"},"firm":{"text":"Example Family Office","url":"https://made-up.example/never-returned"},"background":null,"focus":null,"upcoming":[]}\n```';

  it("grounded on gemini-2.5-flash: only facts on a page Google returned survive", async () => {
    const g = stubGemini(() => geminiAnswer(GROUNDED, [{ uri: "https://news.example/pat", title: "News" }]));
    const r = await researchPerson(withKey(), who, async () => { throw new Error("no browsing needed"); });
    expect(r.ok).toBe(true);
    expect(r.via).toBe("google_search");
    expect(g.calls).toEqual([{ model: "gemini-2.5-flash", grounded: true }]);
    expect(r.json.title).toEqual({ text: "Managing Director", url: "https://news.example/pat" });
    expect(r.json.firm).toBeNull(); // its link was never a page Google returned: dropped, not written from memory
  });

  it("search unavailable: their pages are fetched and a free Gemini 3 Flash writes only from them", async () => {
    const PAGE = "Example Family Office invests in late-stage software. Pat Example, Managing Director, leads secondaries. ".repeat(4);
    const written = '```json\n{"found":true,"title":{"text":"Managing Director","url":"https://familyoffice.example/team"},"firm":{"text":"Example Family Office","url":"https://familyoffice.example/"},"background":{"text":"Invented history","url":"https://elsewhere.example/"},"focus":null,"upcoming":[]}\n```';
    const g = stubGemini((model) => (model === "gemini-2.5-flash" ? new Response("quota", { status: 429 }) : geminiAnswer(written)));
    const fetched: string[] = [];
    const r = await researchPerson(withKey(), who, async (_e, url) => { fetched.push(url); return { ok: url.endsWith("/team") || url.endsWith(".example/"), text: PAGE, finalUrl: url }; });
    expect(r.ok).toBe(true);
    expect(r.via).toBe("their_pages");
    expect(fetched).toEqual(["https://familyoffice.example/", "https://familyoffice.example/about", "https://familyoffice.example/team"]);
    expect(g.calls.some((c) => ["gemini-3.6-flash", "gemini-3-flash-preview"].includes(c.model) && !c.grounded)).toBe(true);
    expect(r.json.title.url).toBe("https://familyoffice.example/team");
    expect(r.json.background).toBeNull();
  });

  it("neither works: a named stop with the reason, and nothing written", async () => {
    stubGemini(() => new Response("quota", { status: 429 }));
    const r = await researchPerson(withKey(), who, async () => ({ ok: false, text: null, finalUrl: null }));
    expect(r).toMatchObject({ ok: false, stop: "RESEARCH_NO_SOURCES" });
    expect(r.why).toMatch(/Google search was not available/);
    expect(r.why).toMatch(/their website \(familyoffice.example\) could not be read/);
  });

  // Loop olp_m6mnjapa3tdhv3d3: gemini-2.5-flash retires 1 Dec 2026. Its errors must not end prep.
  const PAGE2 = "Example Family Office invests in late-stage software. Pat Example, Managing Director, leads secondaries. ".repeat(4);
  const WRITTEN = '```json\n{"found":true,"title":{"text":"Managing Director","url":"https://familyoffice.example/team"},"firm":null,"background":null,"focus":null,"upcoming":[]}\n```';
  const readsPages = async (_e: unknown, url: string) => ({ ok: url.endsWith("/team"), text: PAGE2, finalUrl: url });

  it("2.5-flash retired (404): the next free Gemini writes the prep from their pages", async () => {
    const g = stubGemini((model) => (model === "gemini-2.5-flash" ? new Response("models/gemini-2.5-flash is not found", { status: 404 }) : geminiAnswer(WRITTEN)));
    const r = await researchPerson(withKey(), who, readsPages);
    expect(r).toMatchObject({ ok: true, via: "their_pages" });
    expect(r.json.title.url).toBe("https://familyoffice.example/team");
    const writers = g.calls.filter((c) => c.model !== "gemini-2.5-flash");
    expect(writers.length).toBeGreaterThan(0);
    expect(["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash-preview"]).toContain(writers[0]!.model);
    expect(writers[0]!.grounded).toBe(false);
    expect(g.calls.filter((c) => c.grounded).map((c) => c.model)).toEqual(["gemini-2.5-flash"]); // never a billed grounded search
  });

  it("every free Gemini failing: an OpenRouter free model writes it, never a paid one", async () => {
    const e = withKey() as any; e.OPENROUTER_API_KEY = "test-key-not-a-real-credential";
    const gem: string[] = [], or: string[] = [];
    restore = stubFetch(async (req) => {
      if (req.url.startsWith(GEMINI_HOST)) { gem.push(req.url); return new Response("gone", { status: 404 }); }
      if (req.url.includes("openrouter.ai")) {
        const body = await req.json() as any; or.push(body.model);
        return new Response(JSON.stringify({ choices: [{ message: { content: WRITTEN } }], usage: { cost: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not here", { status: 500 });
    });
    const r = await researchPerson(e, who, readsPages);
    expect(r).toMatchObject({ ok: true, via: "their_pages" });
    expect(gem.length).toBeGreaterThan(1); // 2.5-flash, then the next free Gemini models, before OpenRouter
    expect(or.length).toBeGreaterThan(0);
    for (const m of or) expect(m).toMatch(/:free$/);
  });

  it("a committed LP never reaches Gemini: the answer says private", async () => {
    await env.DB.prepare(`INSERT INTO prospects (id, email, name, firm, source, created_at, updated_at, committed_at) VALUES ('prs_t2', 'pat@familyoffice.example', 'Pat Example', 'Example Family Office', 'test', 0, 0, ?)`).bind(Date.now()).run();
    const g = stubGemini(() => geminiAnswer(GROUNDED));
    const r = await researchPerson(withKey(), who, async () => ({ ok: false, text: null, finalUrl: null }));
    expect(r).toMatchObject({ ok: false, private: true });
    expect(g.calls).toEqual([]);
  });
});
