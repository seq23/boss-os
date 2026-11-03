/**
 * THE LEADS LINE IN THE MONDAY AUDIT (owner, 3 Nov 2026). virtualagency-os.com had Google clicks for
 * months and zero inquiries and nothing said so. Each behaviour is proven negatively: no source says
 * "not tracked yet" (never 0), a failed source says "not read" (never 0), clicks with zero leads goes
 * red, and a client site is never read or reported.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { leadVerdict, leadRedLine, leadSourceProblems, leadsMorningLines, isOwnSite, LEADS } from "../src/shared/boss/searchReadiness/site-leads.mjs";
import { readLeads } from "../scripts/ops/lib/site-leads-read.mjs";
import { redLines } from "../src/shared/boss/searchReadiness/search-outcomes.mjs";
import { loadChecklist, morningLines } from "../src/shared/boss/searchReadiness/audit.mjs";
import { renderStandings } from "../src/shared/boss/searchReadiness/page.mjs";
import { lineProblems } from "../src/shared/boss/mail/plain.mjs";

const sitesJson = JSON.parse(readFileSync(new URL("../src/shared/boss/searchReadiness/sites.json", import.meta.url), "utf8"));
const checklist = loadChecklist();
const NOW = Date.parse("2026-11-03T12:00:00Z");
const DAY = 86_400_000;
const own = (extra: any = {}) => ({ domain: "own.example", repo: "own-repo", category: "side_business", ...extra });
const client = (extra: any = {}) => ({ domain: "client.example", repo: "client-repo", category: "client", ...extra });
const d1Src = { kind: "d1", action: "quote requests", code: "x", params: { db: "lead-db", sql: "SELECT COUNT(*) AS n FROM requests WHERE datetime(submitted_at) >= datetime(:since_iso)" } };
const clicks = (n: number) => ({ status: "green", current: { impressions: 500, clicks: n }, previous: { impressions: 500, clicks: n } });

describe("the leads verdict", () => {
  it("a site with no source says not tracked yet with what would track it, never 0", () => {
    const none = leadVerdict({ site: own(), read: null, outcome: clicks(40) })!;
    expect(none.status).toBe("not_tracked");
    expect(none.line).toMatch(/^leads: not tracked yet — \S/);
    expect(none.line).not.toMatch(/leads: 0/);
    expect(none.red).toBe(false);
    const named = leadVerdict({ site: own({ lead_source: { kind: "none", action: "a signup", track_with: "a ref tag on the link" } }), read: null, outcome: clicks(40) })!;
    expect(named.line).toBe("leads: not tracked yet — a ref tag on the link");
    // Negative: the same site with a source that read 0 is a number, so the two can never be confused.
    expect(leadVerdict({ site: own({ lead_source: d1Src }), read: { ok: true, current: 0, previous: 0 }, outcome: clicks(0) })!.line).toBe("leads: 0 (was 0)");
  });

  it("a failed source says not read with its reason, never 0 and never red", () => {
    const v = leadVerdict({ site: own({ lead_source: d1Src }), read: { ok: false, why: "lead-db: no such table" }, outcome: clicks(40) })!;
    expect(v.status).toBe("not_read");
    expect(v.line).toBe("leads: not read: lead-db: no such table");
    expect(v.red).toBe(false);
    const garbled = leadVerdict({ site: own({ lead_source: d1Src }), read: { ok: true, current: undefined, previous: 2 }, outcome: clicks(40) })!;
    expect(garbled.status).toBe("not_read");
  });

  it("10+ Google clicks in 28 days and zero leads is red: people come, nobody acts", () => {
    const site = own({ lead_source: d1Src });
    const red = leadVerdict({ site, read: { ok: true, current: 0, previous: 3 }, outcome: clicks(10) })!;
    expect(red.red).toBe(true);
    expect(red.line).toBe("leads: 0 (was 3)");
    expect(leadRedLine(site, red)).toMatch(/10 visits.*people come, nobody acts/);
    expect(redLines([{ site, outcome: clicks(10), leads: red }]).filter((l) => l.kind === "leads").map((l) => l.domain)).toEqual(["own.example"]);
    // 9 clicks and no lead: plain, not red, and it says why it is not judged.
    const few = leadVerdict({ site, read: { ok: true, current: 0, previous: 3 }, outcome: clicks(9) })!;
    expect(few.red).toBe(false);
    expect(few.line).toBe("leads: 0 (was 3) — too few visits to judge");
    expect(leadRedLine(site, few)).toBeNull();
    expect(redLines([{ site, outcome: clicks(9), leads: few }]).filter((l) => l.kind === "leads")).toEqual([]);
    // 14 clicks and one lead: not red, no hedge.
    const one = leadVerdict({ site, read: { ok: true, current: 1, previous: 0 }, outcome: clicks(14) })!;
    expect(one.red).toBe(false);
    expect(one.line).toBe("leads: 1 (was 0)");
    expect(redLines([{ site, outcome: clicks(14), leads: one }]).filter((l) => l.kind === "leads")).toEqual([]);
    // No clicks, or clicks not read, are never red.
    expect(leadVerdict({ site, read: { ok: true, current: 0, previous: 0 }, outcome: clicks(0) })!.red).toBe(false);
    expect(leadVerdict({ site, read: { ok: true, current: 0, previous: 0 }, outcome: { status: "not_read", why: "x" } })!.red).toBe(false);
  });
});

describe("client sites are never read or reported", () => {
  it("readLeads refuses a client site before any request exists", async () => {
    const fetch = vi.fn();
    await expect(readLeads(client({ lead_source: d1Src }), { env: {}, now: NOW, fetch })).rejects.toThrow(/never read/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a client site has no verdict, no red line, no email line and no page line", () => {
    const c = client({ lead_source: d1Src });
    expect(leadVerdict({ site: c, read: { ok: true, current: 0, previous: 0 }, outcome: clicks(50) })).toBeNull();
    const forged = { status: "read", red: true, current: 0, previous: 0, clicks: 50, action: "x", line: "leads: 0 (was 0)" };
    expect(redLines([{ site: c, outcome: clicks(50), leads: forged }]).filter((l) => l.kind === "leads")).toEqual([]);
    expect(leadsMorningLines([{ site: c, leads: forged }])).toEqual([]);
    // Positive control: the same forged verdict on her own site does produce the lines.
    expect(redLines([{ site: own(), outcome: clicks(50), leads: forged }]).filter((l) => l.kind === "leads").length).toBe(1);
    expect(leadsMorningLines([{ site: own(), leads: forged }]).length).toBe(1);
  });

  it("a lead_source on a client row is a shape problem; the real sites.json carries none", () => {
    expect(leadSourceProblems({ grid_repos: [own(), client({ lead_source: d1Src })] }).join(" ")).toMatch(/client\.example.*never read/);
    const real = sitesJson.grid_repos;
    expect(real.filter((s: any) => s.category === "client").length).toBeGreaterThan(0);
    expect(real.filter((s: any) => s.category === "client" && s.lead_source !== undefined)).toEqual([]);
  });
});

describe("sites.json lead sources", () => {
  it("are clean, and every own site names one (a new own site gets one in the same PR)", () => {
    expect(leadSourceProblems(sitesJson)).toEqual([]);
    const mine = sitesJson.grid_repos.filter(isOwnSite);
    expect(mine.length).toBeGreaterThan(10);
    expect(mine.filter((s: any) => !s.lead_source).map((s: any) => s.domain)).toEqual([]);
  });

  it("the shape check catches each broken source", () => {
    const broken: [string, any][] = [
      ["unknown kind", { kind: "guess", action: "x", code: "x" }],
      ["no action", { ...d1Src, action: "" }],
      ["none without what would track it", { kind: "none", action: "x" }],
      ["no code cited", { ...d1Src, code: "" }],
      ["d1 selecting rows", { ...d1Src, params: { db: "x", sql: "SELECT email AS n FROM leads WHERE created_at >= :since_iso" } }],
      ["airtable without a table", { kind: "airtable", action: "x", code: "x", params: { key: "K", base: "b" } }],
      ["web analytics without paths", { kind: "cf_web_analytics", action: "x", code: "x", params: { host: "h" } }],
    ];
    const missed = broken.filter(([, src]) => leadSourceProblems({ grid_repos: [own({ lead_source: src })] }).length === 0).map(([n]) => n);
    expect(missed).toEqual([]);
    expect(leadSourceProblems({ grid_repos: [client()] }).join(" ")).toMatch(/examine nothing/);
  });
});

describe("the reader", () => {
  it("a count source gives the last 28 days and the 28 before (56-day count minus 28-day count)", async () => {
    const at = { [String(LEADS.WINDOW_DAYS)]: 3, [String(2 * LEADS.WINDOW_DAYS)]: 7 };
    const fetch = vi.fn(async (url: string, init?: any) => {
      if (url.endsWith("/d1/database?per_page=100")) return new Response(JSON.stringify({ result: [{ name: "lead-db", uuid: "u1" }] }));
      const sql = JSON.parse(init.body).sql as string;
      const since = Date.parse((sql.match(/'([\d-]+ [\d:]+)'/)?.[1] ?? "").replace(" ", "T") + "Z");
      const days = Math.round((NOW - since) / DAY);
      return new Response(JSON.stringify({ success: true, result: [{ results: [{ n: at[String(days)] }] }] }));
    });
    const r = await readLeads(own({ lead_source: d1Src }), { env: { CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" }, now: NOW, fetch });
    expect(r).toEqual({ ok: true, current: 3, previous: 4 });
  });

  it("a source that fails comes back not read, never 0", async () => {
    const r = await readLeads(own({ lead_source: d1Src }), { env: {}, now: NOW, fetch: vi.fn() });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).why).toMatch(/CLOUDFLARE_ACCOUNT_ID/);
    expect(leadVerdict({ site: own({ lead_source: d1Src }), read: r, outcome: clicks(5) })!.line).toMatch(/^leads: not read: /);
  });

  it("Web Analytics counts each window for the action path, sent from this site only", async () => {
    const bodies: any[] = [];
    const fetch = vi.fn(async (url: string, init?: any) => {
      if (url.includes("/rum/site_info/list")) return new Response(JSON.stringify({ success: true, result: [{ site_tag: "tag1", ruleset: { zone_name: "action.example" } }] }));
      const b = JSON.parse(init.body); bodies.push(b);
      return new Response(JSON.stringify({ data: { viewer: { accounts: [{ rumPageloadEventsAdaptiveGroups: [{ count: bodies.length === 1 ? 20 : 10 }] }] } } }));
    });
    const src = { kind: "cf_web_analytics", action: "x", code: "x", params: { host: "action.example", paths: ["/download"], referer_host: "own.example" } };
    const r = await readLeads(own({ lead_source: src }), { env: { CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" }, now: NOW, fetch });
    expect(r).toMatchObject({ ok: true, current: 20, previous: 10 });
    const f = JSON.stringify(bodies[0].variables.f);
    expect(f).toContain('"siteTag":"tag1"');
    expect(f).toContain('"requestPath":"/download"');
    expect(f).toContain('"refererHost":"own.example"');
    expect(bodies[0].variables.f.AND[0].datetime_geq).toBe(new Date(NOW - 28 * DAY).toISOString());
    expect(bodies[1].variables.f.AND[0].datetime_lt).toBe(new Date(NOW - 28 * DAY).toISOString());
    // A host with no Web Analytics site is not read, never 0.
    const miss = await readLeads(own({ lead_source: { ...src, params: { ...src.params, host: "nowhere.example" } } }), { env: { CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" }, now: NOW, fetch });
    expect(miss).toMatchObject({ ok: false });
  });
});

describe("where the line shows", () => {
  const site = own({ lead_source: d1Src });
  const leads = leadVerdict({ site, read: { ok: true, current: 0, previous: 2 }, outcome: clicks(10) })!;
  const untracked = own({ domain: "quiet.example" });
  const results = [
    { site, results: [], outcome: clicks(10), leads },
    { site: untracked, results: [], outcome: clicks(0), leads: leadVerdict({ site: untracked, read: null, outcome: clicks(0) }) },
    { site: client(), results: [], outcome: clicks(9) },
  ];

  it("the Monday email carries the leads next to Google's visits, in plain words", () => {
    const lines = morningLines(checklist, results, { redLines: redLines(results) });
    const all = lines.join("\n");
    expect(all).toMatch(/own\.example 10 Google visits → 0 \(was 2\)/);
    expect(all).toMatch(/not tracked yet on 1 site \(quiet\.example\)/);
    expect(all).toMatch(/Red: own\.example: .*nobody acts/);
    expect(all).not.toMatch(/client\.example/);
    for (const l of lines) expect(lineProblems(l), l).toEqual([]);
  });

  it("the checklist page row carries the site's leads line; a client row carries none", () => {
    const html = renderStandings({ day: "2026-11-03", sites: results.map((r) => ({ ...r, failing: [] })) }, checklist, { categories: null });
    const row = (d: string) => html.split("\n").find((l) => l.includes(`data-site="${d}"`)) ?? "";
    expect(row("own.example")).toMatch(/data-leads="read">leads: 0 \(was 2\)/);
    expect(row("quiet.example")).toMatch(/leads: not tracked yet/);
    expect(row("client.example")).not.toMatch(/leads:/);
  });
});
