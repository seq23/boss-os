/**
 * BRAVE SEARCH, THE SECOND RESEARCH ROUTE (owner, 5 Nov 2026). Meeting-guest research tries Gemini's
 * Google-grounded search, then Brave Search (at most 20 searches a day, claimed before the call),
 * then the guest's own pages, then a named stop. Brave's results are free, never billed, and the
 * writer keeps only facts that cite one of the pages it was given. Synthetic names only.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freeDailyCap, routeIsBilled } from "../../src/worker/boss/backends/guard";
import { GEMINI_HOST } from "../../src/worker/boss/router/backends";
import { realLinks, researchPerson } from "../../src/worker/boss/routes/research";
import { claimFreeSearch, centralDay } from "../../src/worker/boss/research/searchQuota";
import { BRAVE_SEARCH_HOST, braveSearch } from "../../src/worker/effects/braveSearchClient";
import { stubFetch } from "./helpers";

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const keys = (brave = true) => {
  const e = Object.create(env);
  (e as any).GEMINI_API_KEY = "test-key-not-a-real-credential";
  if (brave) (e as any).BRAVE_SEARCH_API_KEY = "test-brave-key-not-real";
  return e as typeof env;
};

const who = { name: "Pat Example", email: "pat@familyoffice.example", firm: "Example Family Office", domain: "familyoffice.example", today: "2026-11-05" };
const PAGE = "Example Family Office invests in late-stage software. Pat Example, Managing Director, leads secondaries. ".repeat(4);

function geminiAnswer(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 20 } }), { status: 200, headers: { "content-type": "application/json" } });
}

/** Grounded search is down (429); the writer answers `written`. Records each model asked. */
function groundingDown(written: string) {
  const models: string[] = [];
  restore = stubFetch(async (req) => {
    if (!req.url.startsWith(GEMINI_HOST)) return new Response("not here", { status: 500 });
    const model = decodeURIComponent(/models\/([^:]+):generateContent/.exec(req.url)![1]!);
    models.push(model);
    return model === "gemini-2.5-flash" ? new Response("quota", { status: 429 }) : geminiAnswer(written);
  });
  return models;
}

const results = [
  { url: "https://news.example/pat-example", title: "Pat Example joins Example Family Office", text: "Pat Example is Managing Director." },
  { url: "https://conference.example/speakers", title: "Speakers", text: "Pat Example speaks on 12 November 2026." },
];

beforeEach(async () => {
  await env.DB.exec("DELETE FROM free_search_quota_days; DELETE FROM prospects;");
});

describe("Brave Search is free, and capped at 20 a day", () => {
  it("the cap is stated once, in FREE_ROUTES, and the route is never billed", () => {
    expect(freeDailyCap("svc_brave_search")).toBe(20);
    expect(routeIsBilled("svc_brave_search")).toBe(false);
    expect(freeDailyCap("svc_something_else")).toBe(0);
  });

  it("25 claims in one day: exactly 20 go through; the next day starts again", async () => {
    const now = Date.parse("2026-11-05T15:00:00Z");
    const claims = [];
    for (let i = 0; i < 25; i++) claims.push(await claimFreeSearch(env.DB, "svc_brave_search", now));
    expect(claims.filter((c) => c.ok)).toHaveLength(20);
    expect(claims.at(-1)).toEqual({ ok: false, used: 20, cap: 20 });
    expect((await claimFreeSearch(env.DB, "svc_brave_search", now + 86_400_000)).ok).toBe(true);
  });

  it("the day is hers (Central): 11 pm Central on the 5th is still the 5th", () => {
    expect(centralDay(Date.parse("2026-11-06T04:30:00Z"))).toBe("2026-11-05");
  });
});

describe("the Brave client", () => {
  it("sends the key in Brave's header, never the URL, and keeps only https public results, fenced", async () => {
    const seen: Request[] = [];
    const r = await braveSearch("test-brave-key-not-real", '"Pat Example" Example Family Office', (async (input: any, init: any) => {
      seen.push(new Request(input, init));
      return new Response(JSON.stringify({ web: { results: [
        { url: "https://news.example/pat-example", title: "<strong>Pat</strong> Example", description: "Pat Example is <strong>Managing Director</strong>.", extra_snippets: ["Leads secondaries."] },
        { url: "http://insecure.example/pat", title: "Insecure", description: "dropped" },
        { url: "https://localhost/pat", title: "Local", description: "dropped" },
      ] } }), { status: 200 });
    }) as typeof fetch);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url.startsWith(BRAVE_SEARCH_HOST)).toBe(true);
    expect(seen[0]!.url).not.toContain("test-brave-key");
    expect(seen[0]!.headers.get("X-Subscription-Token")).toBe("test-brave-key-not-real");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results.map((x) => x.url)).toEqual(["https://news.example/pat-example"]);
    expect(r.results[0]!.title).toBe("Pat Example");
    expect(r.results[0]!.text).toContain("UNTRUSTED");
    expect(r.results[0]!.text).toContain("Pat Example is Managing Director. Leads secondaries.");
  });

  it("no key: nothing is sent", async () => {
    let called = false;
    const r = await braveSearch(undefined, "Pat Example", (async () => { called = true; return new Response("{}"); }) as typeof fetch);
    expect(r).toEqual({ ok: false, detail: "Brave Search has no key on this Worker" });
    expect(called).toBe(false);
  });
});

describe("meeting-prep research: Google, then Brave, then their pages", () => {
  it("Google search down: Brave finds the pages and a free model writes only from them", async () => {
    const written = '```json\n{"found":true,"title":{"text":"Managing Director","url":"https://news.example/pat-example"},"firm":{"text":"Example Family Office","url":"https://news.example/pat-example"},"background":{"text":"Invented history","url":"https://made-up.example/"},"focus":null,"upcoming":[{"text":"Speaks on 12 November 2026","url":"https://conference.example/speakers"}]}\n```';
    const models = groundingDown(written);
    const queries: string[] = [];
    const browsed: string[] = [];
    const r = await researchPerson(
      keys(), who,
      async (_e, url) => { browsed.push(url); return url.startsWith("https://news.example") ? { ok: true, text: PAGE, finalUrl: url } : { ok: false, text: null, finalUrl: null }; },
      async (_e, q) => { queries.push(q); return { ok: true, results }; },
    );
    expect(r.ok).toBe(true);
    expect(r.via).toBe("brave_search");
    expect(queries).toEqual(['"Pat Example" Example Family Office']);
    expect(browsed).toEqual(["https://news.example/pat-example", "https://conference.example/speakers"]);
    // gemini-2.5-flash is only the grounded search (asked again on its 429); the writer is a Gemini 3 Flash.
    expect(models[0]).toBe("gemini-2.5-flash");
    const writers = models.filter((m) => m !== "gemini-2.5-flash");
    expect(writers.length).toBeGreaterThan(0);
    expect(writers.every((m) => ["gemini-3.6-flash", "gemini-3-flash-preview"].includes(m))).toBe(true);
    expect(r.json.title).toEqual({ text: "Managing Director", url: "https://news.example/pat-example" });
    expect(r.json.upcoming).toEqual([{ text: "Speaks on 12 November 2026", url: "https://conference.example/speakers" }]);
    expect(r.json.background).toBeNull(); // cites a page Brave never returned: dropped
    expect((await env.DB.prepare(`SELECT used FROM free_search_quota_days WHERE service = 'svc_brave_search'`).first<{ used: number }>())!.used).toBe(1);
  });

  it("today's 20 are used: Brave is not called, and research moves to their own pages", async () => {
    await env.DB.prepare(`INSERT INTO free_search_quota_days (service, day, used, updated_at) VALUES ('svc_brave_search', ?, 20, 0)`).bind(centralDay(Date.now())).run();
    const written = '```json\n{"found":true,"title":{"text":"Managing Director","url":"https://familyoffice.example/team"},"firm":null,"background":null,"focus":null,"upcoming":[]}\n```';
    groundingDown(written);
    let searched = false;
    const r = await researchPerson(
      keys(), who,
      async (_e, url) => ({ ok: url.endsWith("/team"), text: PAGE, finalUrl: url }),
      async () => { searched = true; return { ok: true, results }; },
    );
    expect(searched).toBe(false);
    expect(r).toMatchObject({ ok: true, via: "their_pages" });
  });

  it("nothing works: the named stop says why Brave did not help", async () => {
    groundingDown("```json\n{\"found\":false,\"why\":\"no pages\"}\n```");
    const r = await researchPerson(
      keys(), who,
      async () => ({ ok: false, text: null, finalUrl: null }),
      async () => ({ ok: true, results: [] }),
    );
    expect(r).toMatchObject({ ok: false, stop: "RESEARCH_NO_SOURCES" });
    expect(r.why).toMatch(/Brave Search found no pages/);
  });

  it("no Brave key: the route is skipped and named, never fatal", async () => {
    groundingDown("```json\n{\"found\":false,\"why\":\"no pages\"}\n```");
    let searched = false;
    const r = await researchPerson(keys(false), who, async () => ({ ok: false, text: null, finalUrl: null }), async () => { searched = true; return { ok: true, results }; });
    expect(searched).toBe(false);
    expect(r.why).toMatch(/Brave Search has no key on this Worker/);
  });

  it("a committed LP is never searched on Brave", async () => {
    await env.DB.prepare(`INSERT INTO prospects (id, email, name, firm, source, created_at, updated_at, committed_at) VALUES ('prs_b1', 'pat@familyoffice.example', 'Pat Example', 'Example Family Office', 'test', 0, 0, ?)`).bind(Date.now()).run();
    groundingDown("never asked");
    let searched = false;
    const r = await researchPerson(keys(), who, async () => ({ ok: false, text: null, finalUrl: null }), async () => { searched = true; return { ok: true, results }; });
    expect(r).toMatchObject({ ok: false, private: true });
    expect(searched).toBe(false);
  });
});

describe("Google's grounding links reach her prep as the real pages", () => {
  it("replaces each redirect with the page it points to, and keeps Google's link when one will not resolve", async () => {
    const R = (n: number) => `https://vertexaisearch.cloud.google.com/grounding-api-redirect/ABC${n}`;
    const sources = [{ title: "example.org", url: R(1) }, { title: "example.net", url: R(2) }];
    const json = { found: true, title: { text: "CEO", url: R(1) }, firm: null, background: { text: "Founded it", url: R(2) }, focus: null, upcoming: [{ text: "Talk", url: R(1) }] };
    const follow = async (u: string) => (u === R(1) ? "https://example.org/about" : null);
    const out = await realLinks(json, sources, follow);
    expect(out.json.title.url).toBe("https://example.org/about");
    expect(out.json.upcoming[0].url).toBe("https://example.org/about");
    expect(out.json.background.url).toBe(R(2));
    expect(out.sources.map((s) => s.url)).toEqual(["https://example.org/about", R(2)]);
  });
});
