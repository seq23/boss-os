/**
 * OUTCOMES, QUALITY AND THE FOLD QUEUE IN THE MONDAY AUDIT (owner, 2 Nov 2026: "go").
 *
 * The audit scored virtualagency-os.com 53 checks / 0 failing while it lost ~99% of its Google
 * impressions on 25-26 Aug 2026, because it checked presence, never outcomes. Each piece is proven
 * here, negatively: the real WPP-llm August rows must go red, a steady site must stay green, an
 * unread source must say "not read", and a templated sample must be called out.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { outcomeVerdict, outcomeWindows, redLines, slipLines, weeklyBriefs, pickLastWeekDay, OUTCOME } from "../src/shared/boss/searchReadiness/search-outcomes.mjs";
import { diagnoseDrop } from "../src/shared/boss/searchReadiness/drop-diagnosis.mjs";
import { parseRepoCategories } from "../src/shared/boss/repos/categories.mjs";
import { renderStandings } from "../src/shared/boss/searchReadiness/page.mjs";
import { qualitySample, pickSample, repeatedSlots, similarity } from "../src/shared/boss/searchReadiness/page-quality-sample.mjs";
import { consolidationQueue, nextFirstSeen } from "../src/shared/boss/searchReadiness/consolidation-queue.mjs";
import { loadChecklist, loadSites, morningLines, workQueue, fixBriefs } from "../src/shared/boss/searchReadiness/audit.mjs";
import { lineProblems } from "../src/shared/boss/mail/plain.mjs";

const wpp = JSON.parse(readFileSync(new URL("./fixtures/searchOutcomes/wpp-llm-2026.json", import.meta.url), "utf8"));
const checklist = loadChecklist();
const sites = loadSites().grid_repos;
const siteOf = (d: string) => sites.find((s: any) => s.domain === d);
const T = (d: string) => Date.parse(`${d}T12:00:00Z`);
const steady = (from: string, days: number, imp: number, clk: number) =>
  Array.from({ length: days }, (_, i) => ({ date: new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10), impressions: imp, clicks: clk }));

describe("the outcome alarm", () => {
  it("the WPP-llm August cliff goes red on the drop rule (real rows)", () => {
    const v = outcomeVerdict({ read: { ok: true, rows: wpp.rows }, sitemapUrls: null, now: T("2026-09-11") });
    expect(v.windows.current).toEqual({ start: "2026-08-12", end: "2026-09-08" });
    expect(v.previous.impressions).toBeGreaterThan(4000);
    expect(v.status).toBe("red");
    expect(v.reasons.map((r: any) => r.rule)).toContain("impressions_drop");
  });

  it("ten weeks later both windows are flat, and the density rule still catches it", () => {
    const flat = outcomeVerdict({ read: { ok: true, rows: wpp.rows }, sitemapUrls: null, now: T("2026-11-02") });
    expect(flat.status).toBe("green"); // nothing left to drop: why presence plus a drop rule alone was not enough
    const v = outcomeVerdict({ read: { ok: true, rows: wpp.rows }, sitemapUrls: wpp.sitemap_urls, now: T("2026-11-02") });
    expect(v.status).toBe("red");
    expect(v.reasons.map((r: any) => r.rule)).toEqual(["density"]);
  });

  it("a steady site stays green, and a drop on a tiny site is noise", () => {
    expect(outcomeVerdict({ read: { ok: true, rows: steady("2026-08-01", 120, 100, 5) }, sitemapUrls: 300, now: T("2026-11-02") }).status).toBe("green");
    const tiny = [...steady("2026-09-01", 28, 1, 0), ...steady("2026-10-03", 28, 0, 0)];
    expect(outcomeVerdict({ read: { ok: true, rows: tiny }, sitemapUrls: 20, now: T("2026-11-02") }).status).toBe("green");
  });

  it("clicks falling by more than half go red even when impressions hold", () => {
    const w = outcomeWindows(T("2026-11-02"));
    const rows = [...steady(w.previous.start, 28, 100, 2), ...steady(w.current.start, 28, 100, 0)];
    const v = outcomeVerdict({ read: { ok: true, rows }, now: T("2026-11-02") });
    expect(v.reasons.map((r: any) => r.rule)).toEqual(["clicks_drop"]);
  });

  it("an unread source says not read with its reason, never 0, and all-unread is one blind red line", () => {
    const v = outcomeVerdict({ read: { ok: false, why: "no Search Console key" }, sitemapUrls: 2300 });
    expect(v.status).toBe("not_read");
    expect(v.why).toBe("no Search Console key");
    expect(v.current).toBeUndefined();
    const blind = redLines([{ site: siteOf("uscisexam.com"), outcome: v }, { site: siteOf("approvalprep.com"), outcome: v }]);
    expect(blind).toHaveLength(1);
    expect(blind[0]!.kind).toBe("outcome_blind");
    const one = redLines([{ site: siteOf("uscisexam.com"), outcome: v }, { site: siteOf("approvalprep.com"), outcome: outcomeVerdict({ read: { ok: true, rows: [] } }) }]);
    expect(one).toEqual([]);
  });

  it("the red line heads the Monday section in plain words, and its brief is weekly, never stalling the loop", () => {
    const outcome = outcomeVerdict({ read: { ok: true, rows: wpp.rows }, sitemapUrls: wpp.sitemap_urls, now: T("2026-11-02") });
    const res = [{ site: siteOf("virtualagency-os.com"), host: "virtualagency-os.com", results: [{ id: "a1", status: "pass" }], outcome }];
    const red = redLines(res);
    expect(red.map((r) => r.domain)).toEqual(["virtualagency-os.com"]);
    const lines = morningLines(checklist, res, { redLines: red });
    expect(lines[0]).toMatch(/^Red: virtualagency-os\.com/);
    for (const l of lines) expect(lineProblems(l), l).toEqual([]);
    expect(morningLines(checklist, res, {})[0]).not.toMatch(/^Red/);
    const briefs = weeklyBriefs(res);
    expect(briefs).toHaveLength(1);
    expect(briefs[0]).toMatchObject({ kind: "outcome", disposition: "weekly", repo: "WPP-llm" });
    const q = workQueue([...fixBriefs(checklist, res), ...briefs]);
    expect(q.workable).toBe(0);
    expect(q.once).toEqual([{ repo: "WPP-llm", ids: [briefs[0].id] }]);
  });

  it("a report-only client repo's brief is recorded, never worked", () => {
    const outcome = outcomeVerdict({ read: { ok: true, rows: wpp.rows }, sitemapUrls: null, now: T("2026-09-11") });
    const b = weeklyBriefs([{ site: siteOf("detoxdenver.org"), host: "detoxdenver.org", outcome }]);
    expect(b[0].disposition).toBe("client_repo");
    expect(workQueue(b).once).toEqual([]);
  });
});

const page = (url: string, body: string, title = "What is a seller's permit and who needs one?") =>
  ({ url, status: 200, html: `<html><head><title>${title}</title><script type="application/ld+json">${JSON.stringify({ "@type": "Article", author: { name: "Dana Reyes" }, datePublished: "2026-09-01" })}</script></head><body><main><h1>${title}</h1>${body}</main></body></html>` });
/** Five genuinely different pages: a definition, a byline and date, question headings, a sourced figure. */
const TOPICS = [
  ["seller's permit", "state registration that lets a shop collect sales tax on taxable goods; most states issue it free through the revenue department before the first sale", "cdtfa.ca.gov"],
  ["notary bond", "surety bond a commissioned notary buys so that a member of the public harmed by a careless notarization can recover money from the insurer", "sos.ca.gov"],
  ["food handler card", "short certificate showing a restaurant worker passed an approved course on safe temperatures, cross contamination and personal hygiene", "fda.gov"],
  ["resale certificate", "signed form a wholesale buyer hands a supplier so the supplier skips sales tax on inventory bought only to sell again later", "streamlinedsalestax.org"],
  ["home occupation license", "city permission to run a quiet business from a residence, with limits on signs, customer parking, deliveries and employees", "nlc.org"],
];
const GOOD = (n: number) => { const [name, def, src] = TOPICS[n - 1]!; return `<p>A ${name} is a ${def}. Rules differ by state, so check before you apply.</p>
<p>By Dana Reyes. Updated September 1, 2026.</p><h2>Who needs a ${name}?</h2><p>Anyone whose work matches the ${name} rules where they operate.</p>
<h2>What does a ${name} cost?</h2><ul><li>${n * 10} dollars in some places</li><li>Free in others</li></ul><p>The <a href="https://${src}/">official source</a> lists $${n * 25} fees, ${n + 2}% surcharges and ${n * 3} day waits.</p>`; };
const FILLER = (city: string) => `<p>Welcome to our page about ${city}.</p>` +
  Array.from({ length: 6 }, () => `<p>We are the best choice for your needs in the area and we serve every customer with care in ${city}.</p>`).join("");

describe("quality sampling", () => {
  const site = siteOf("theaccidentguides.com");
  it("good pages are noted, not red", () => {
    const q = qualitySample({ site, host: "theaccidentguides.com", checklist, pages: [1, 2, 3, 4, 5].map((n) => page(`https://theaccidentguides.com/guides/p${n}`, GOOD(n), `What is a ${TOPICS[n - 1]![0]} and who needs one?`)) });
    expect(q.sampled).toBe(5);
    expect(q.red).toBe(false);
  });
  it("a templated sample mostly fails and is ONE red line, with its filler named", () => {
    const pages = ["Memphis", "Nashville", "Austin", "Denver", "Tulsa"].map((c) => page(`https://theaccidentguides.com/${c.toLowerCase()}`, FILLER(c), `Accident lawyers in ${c}`));
    const q = qualitySample({ site, host: "theaccidentguides.com", checklist, pages });
    expect(q.red).toBe(true);
    expect(q.pages.every((p: any) => p.failing.includes("filler"))).toBe(true);
    const red = redLines([{ site, outcome: { status: "green" }, quality: q }]);
    expect(red).toHaveLength(1);
    expect(red[0]!.kind).toBe("quality");
    for (const l of morningLines(checklist, [{ site, results: [], quality: q }], { redLines: red })) expect(lineProblems(l), l).toEqual([]);
    expect(weeklyBriefs([{ site, host: "theaccidentguides.com", quality: q }])[0]).toMatchObject({ kind: "quality", disposition: "weekly" });
  });
  it("the filler tests catch repetition and near-duplicates, not ordinary prose", () => {
    expect(repeatedSlots(FILLER("Memphis").replace(/<[^>]+>/g, " ")).length).toBeGreaterThan(0);
    expect(repeatedSlots(GOOD(3).replace(/<[^>]+>/g, " "))).toEqual([]);
    expect(similarity(FILLER("Memphis"), FILLER("Austin"))).toBeGreaterThan(0.5);
    expect(similarity(GOOD(1), FILLER("Austin"))).toBeLessThan(0.1);
  });
  it("no readable page is not read, never a pass; the sample skips the home and utility pages and rotates by week", () => {
    const q = qualitySample({ site, host: "x", checklist, pages: [{ url: "https://x/a", status: 503 }] });
    expect(q.status).toBe("not_read");
    expect(q.line).toMatch(/not read/);
    const urls = ["https://x.com/", "https://x.com/privacy", "https://x.com/sitemap.xml", ...Array.from({ length: 40 }, (_, i) => `https://x.com/g/${i}`)];
    const a = pickSample(urls, { week: "2026-W45" });
    expect(a).toHaveLength(5);
    expect(a.every((u) => /\/g\/\d+$/.test(u))).toBe(true);
    expect(pickSample(urls, { week: "2026-W46" })).not.toEqual(a);
  });
});

describe("the consolidation queue (f4 made real)", () => {
  const now = T("2026-11-02");
  const old = "2026-06-01", young = "2026-10-20";
  const urls = ["https://s.com/", "https://s.com/guides/", "https://s.com/guides/a", "https://s.com/guides/b", "https://s.com/guides/c", "https://s.com/guides/new", "https://s.com/download", "https://s.com/x/y"];
  const lastmods = Object.fromEntries(urls.map((u) => [u, /new/.test(u) ? young : old]));
  it("old zero-impression pages fold into their nearest hub; shown, young and protected pages stay", () => {
    const q = consolidationQueue({ sitemapUrls: urls, lastmods, gsc: { ok: true, pages: ["https://s.com/guides/a", "https://www.s.com/guides/"] }, now, protectedPaths: ["/download"] });
    expect(q.status).toBe("queued");
    const guides = q.hubs.find((h) => h.hub === "/guides/")!;
    expect(guides.urls).toEqual(["https://s.com/guides/b", "https://s.com/guides/c"]);
    expect(q.hubs.find((h) => h.hub === "/")!.urls).toEqual(["https://s.com/x/y"]);
    const b = weeklyBriefs([{ site: siteOf("uscisexam.com"), host: "s.com", consolidation: q }]);
    expect(b.map((x) => x.kind)).toEqual(["consolidate", "consolidate"]);
    expect(b[0].suggested_hub).toBe("https://s.com/guides/");
    expect(b[0].brief).toMatch(/301/);
  });
  it("the first-seen ledger dates a page with no lastmod, and keeps the earliest day", () => {
    const fs1 = nextFirstSeen({}, ["https://s.com/z"], "2026-07-01");
    expect(nextFirstSeen(fs1, ["https://s.com/z"], "2026-11-02")).toEqual({ "s.com/z": "2026-07-01" });
    expect(consolidationQueue({ sitemapUrls: ["https://s.com/z"], gsc: { ok: true, pages: [] }, firstSeen: fs1, now }).candidates).toBe(1);
    expect(consolidationQueue({ sitemapUrls: ["https://s.com/z"], gsc: { ok: true, pages: [] }, now }).candidates).toBe(0);
  });
  it("unread page rows are not read, never 'nothing to fold'", () => {
    const q = consolidationQueue({ sitemapUrls: urls, lastmods, gsc: { ok: false, why: "Search Console answered 403" }, now });
    expect(q).toMatchObject({ status: "not_read", why: "Search Console answered 403", hubs: [] });
  });
});

describe("constants stay what the owner approved", () => {
  it("drop > 50% red, ≥ 25% two weeks gold, prior ≥ 50 impressions, ≥ 200 pages at < 1 per 10", () => {
    expect(OUTCOME).toMatchObject({ DROP: 0.5, SLIP: 0.25, MIN_PRIOR_IMPRESSIONS: 50, DENSITY_MIN_URLS: 200, DENSITY_PER_PAGE: 0.1, WINDOW_DAYS: 28 });
  });
});

/**
 * THE EARLY WARNING AND THE DIAGNOSIS (owner, 3 Nov 2026). horselegalguide.com sat at -27% and
 * hicksconsulting.org at -21%, both unflagged under the 50% rule. Gold ("slipping") needs a quarter
 * down on two weekly audits in a row; one week is nothing; half is still red. Either one carries a
 * read-only diagnosis built from the page and search rows, with an unread source said "not read".
 */
describe("slipping: a quarter down two weeks running is gold", () => {
  const now = T("2026-11-02");
  const w = outcomeWindows(now);
  const rowsAt = (prev: number, cur: number) => [...steady(w.previous.start, 28, prev, 3), ...steady(w.current.start, 28, cur, 3)];
  const lastWeek = (prev: number, cur: number) => ({ current: { impressions: cur * 28 }, previous: { impressions: prev * 28 } });

  it("25%+ down this week and last week → gold, with its line", () => {
    const v = outcomeVerdict({ read: { ok: true, rows: rowsAt(30, 21) }, now, lastWeek: lastWeek(30, 22) });
    expect(v.status).toBe("gold");
    expect(v.reasons.map((r: any) => r.rule)).toEqual(["impressions_slipping"]);
    expect(v.slipping_weeks).toBe(2);
    const site = siteOf("uscisexam.com");
    expect(slipLines([{ site, outcome: v }])).toHaveLength(1);
    expect(redLines([{ site, outcome: v }])).toEqual([]); // gold is never red
  });

  it("one week only → nothing", () => {
    const v = outcomeVerdict({ read: { ok: true, rows: rowsAt(30, 21) }, now, lastWeek: lastWeek(30, 28) });
    expect(v.status).toBe("green");
    expect(v.slipping_weeks).toBe(1);
    expect(outcomeVerdict({ read: { ok: true, rows: rowsAt(30, 21) }, now, lastWeek: null }).status).toBe("green");
  });

  it("50%+ down is red, never gold, even when last week slipped too", () => {
    const v = outcomeVerdict({ read: { ok: true, rows: rowsAt(30, 12) }, now, lastWeek: lastWeek(30, 20) });
    expect(v.status).toBe("red");
    expect(v.reasons.map((r: any) => r.rule)).toEqual(["impressions_drop"]);
  });

  it("a slip below the volume floor is noise", () => {
    const v = outcomeVerdict({ read: { ok: true, rows: rowsAt(1, 0.5) }, now, lastWeek: lastWeek(1, 0.5) });
    expect(v.status).toBe("green");
  });

  it("with no stored week, last week is recomputed from rows that reach back far enough", () => {
    const from = new Date(Date.parse(w.previous.start) - 7 * 86_400_000).toISOString().slice(0, 10);
    // 30 a day until a week before the newest window, 21 that week, 18 since: both weeks slip a quarter
    const fell = [...steady(from, 28, 30, 3), ...steady(new Date(Date.parse(w.current.start) - 7 * 86_400_000).toISOString().slice(0, 10), 7, 21, 3), ...steady(w.current.start, 28, 18, 3)];
    const v = outcomeVerdict({ read: { ok: true, from, rows: fell }, now });
    expect(v.last_week.source).toBe("recomputed");
    expect(v.status).toBe("gold");
    expect(outcomeVerdict({ read: { ok: true, rows: fell }, now }).status).toBe("green"); // no `from`: nothing recomputed
  });

  it("last week is the newest dated audit 5 to 10 days back", () => {
    expect(pickLastWeekDay(["2026-10-25", "2026-10-26", "2026-10-28", "2026-10-30", "2026-11-02"], "2026-11-03")).toBe("2026-10-28");
    expect(pickLastWeekDay(["2026-11-01", "2026-10-01"], "2026-11-03")).toBeNull();
  });
});

describe("the drop diagnosis (read-only)", () => {
  const H = "https://horselegalguide.com";
  const pages = {
    ok: true,
    previous: [{ key: `${H}/boarding-contracts`, impressions: 400 }, { key: `${H}/liability-waivers`, impressions: 250 }, { key: `${H}/sale-disputes`, impressions: 120 }, { key: `${H}/vet-liens`, impressions: 89 }],
    current: [{ key: `${H}/boarding-contracts`, impressions: 310 }, { key: `${H}/liability-waivers`, impressions: 200 }, { key: `${H}/sale-disputes`, impressions: 115 }],
  };
  const queries = { ok: true, previous: [{ key: "horse boarding contract", impressions: 300 }, { key: "equine liability", impressions: 200 }], current: [{ key: "horse boarding contract", impressions: 240 }, { key: "equine liability", impressions: 190 }] };

  it("lists the top losing pages and the page that fell out, most likely cause first, at most six lines", () => {
    const d = diagnoseDrop({
      pages, queries,
      inspections: { ok: true, items: [{ url: `${H}/boarding-contracts`, verdict: "PASS", googleCanonical: `${H}/boarding-contracts`, userCanonical: `${H}/boarding-contracts/` }, { url: `${H}/vet-liens`, verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed" }] },
      sitemap: { now: 325, before: 325 }, commits: { ok: true, repo: "horse-legal-guide-velocity", count: 4, recent: 1 },
    });
    expect(d.status).toBe("diagnosed");
    expect(d.top_pages.map((r: any) => r.key)).toEqual([`${H}/boarding-contracts`, `${H}/vet-liens`, `${H}/liability-waivers`, `${H}/sale-disputes`]);
    expect(d.lost_pages).toEqual([`${H}/vet-liens`]);
    expect(d.text.length).toBeLessThanOrEqual(6);
    expect(d.text[0]).toMatch(/^CONFIRMED: 1 of 2 top losing pages are not in Google's index now \(Crawled - currently not indexed\)/);
    expect(d.text.some((l: string) => /^CONFIRMED: Pages that lost the most Google showings: \/boarding-contracts \(400 → 310\)/.test(l))).toBe(true);
    expect(d.text.some((l: string) => /^SUSPECTED: 4 commits landed in horse-legal-guide-velocity/.test(l))).toBe(true);
    // a trailing slash is the same address, never "Google chose a different one"
    expect(d.text.some((l: string) => /different main address/.test(l))).toBe(false);
  });

  it("an unread Search Console is 'not read: <reason>', never zero losses", () => {
    const why = "Search Console answered 403 for the page rows";
    const d = diagnoseDrop({ pages: { ok: false, why }, queries: { ok: false, why }, inspections: { ok: false, why }, sitemap: { now: 10, before: 10 }, commits: { ok: true, repo: "r", count: 0 } });
    expect(d.status).toBe("not_read");
    expect(d.text).toEqual([`not read: ${why}`]);
    expect(d.top_pages).toEqual([]);
  });

  it("an unread side source is named in the diagnosis, not dropped", () => {
    const d = diagnoseDrop({ pages, queries, inspections: { ok: false, why: "URL Inspection answered 429" }, sitemap: { now: 325, before: null }, commits: { ok: false, why: "gh could not read r's commits" } });
    expect(d.status).toBe("diagnosed");
    expect(d.text.at(-1)).toMatch(/^Not read: .*URL Inspection \(URL Inspection answered 429\).*commits \(gh could not read r's commits\)/);
  });
});

describe("where the warning and the diagnosis go", () => {
  const now = T("2026-11-02");
  const w = outcomeWindows(now);
  const rows = [...steady(w.previous.start, 28, 30, 3), ...steady(w.current.start, 28, 21, 3)];
  const gold = outcomeVerdict({ read: { ok: true, rows }, now, lastWeek: { current: { impressions: 600 }, previous: { impressions: 840 } } });
  const diagnosis = { status: "diagnosed", lines: [{ confidence: "CONFIRMED", text: "The sitemap lists 10 pages, down from 40 a week ago" }], text: ["CONFIRMED: The sitemap lists 10 pages, down from 40 a week ago."] };
  const categories = parseRepoCategories("## Repo categories\n**Mine**\n- Biz: uscisexam\n**Friends & clients**\n- Friends: horse-legal-guide-velocity, hicks-consulting-canonical\n**The system**\n- boss-os\n");

  it("her own site: a plain Slipping line with the most likely cause, after the red lines", () => {
    const res = [{ site: siteOf("uscisexam.com"), results: [], outcome: gold, diagnosis }];
    const lines = morningLines(checklist, res, { goldLines: slipLines(res) });
    expect(lines[0]).toMatch(/^Slipping: uscisexam\.com: Google showed it 588 times .* Most likely \(confirmed\): the sitemap lists 10 pages/);
    for (const l of lines) expect(lineProblems(l), l).toEqual([]);
    expect(weeklyBriefs(res.map((r) => ({ ...r, host: "uscisexam.com" })))[0]).toMatchObject({ kind: "outcome", disposition: "weekly" });
  });

  it("Horse and Hicks are repaired like her own sites, and their numbers stay in their own row", () => {
    const horse = siteOf("horselegalguide.com"), hicks = siteOf("hicksconsulting.org");
    const consolidation = { status: "queued", candidates: 2, hubs: [{ hub: "/guides/", hubUrl: `https://horselegalguide.com/guides/`, urls: ["https://horselegalguide.com/guides/a"], total: 1 }] };
    const quality = { red: true, line: "x", pages: [{ url: "u", failing: ["filler"], notes: [] }] };
    const res = [{ site: horse, host: "horselegalguide.com", results: [], outcome: gold, diagnosis, consolidation, quality }, { site: hicks, host: "hicksconsulting.org", results: [], outcome: { ...gold, status: "red" }, diagnosis, consolidation, quality }];
    const briefs = weeklyBriefs(res);
    expect(briefs.map((b: any) => [b.domain, b.kind, b.disposition])).toEqual([
      ["horselegalguide.com", "outcome", "weekly"], ["horselegalguide.com", "quality", "weekly"], ["horselegalguide.com", "consolidate", "weekly"],
      ["hicksconsulting.org", "outcome", "weekly"], ["hicksconsulting.org", "quality", "weekly"], ["hicksconsulting.org", "consolidate", "weekly"],
    ]);
    expect(briefs[0].evidence[0]).toMatch(/^CONFIRMED: The sitemap lists 10 pages/); // the diagnosis rides in the brief
    const lines = morningLines(checklist, res, { goldLines: slipLines(res), redLines: redLines(res), categories });
    expect(lines.join("\n")).not.toMatch(/588|sitemap lists/); // a client's numbers stay in its row
    expect(lines.some((l) => /^Friends' sites slipping in Google: horselegalguide\.com\./.test(l))).toBe(true);
    const html = renderStandings({ sites: res, red_lines: redLines(res), gold_lines: slipLines(res) }, checklist, { categories });
    const row = html.split("<tr").find((r) => r.includes('data-site="horselegalguide.com"'))!;
    expect(row).toMatch(/class="gold" data-outcome="gold"/);
    expect(row).toMatch(/CONFIRMED: The sitemap lists 10 pages/);
    expect(html).not.toMatch(/class="gold-lines"/); // her own gold list holds no friend's site
  });
});

/** ONE FULL STOP (3 Nov 2026): no outcome or diagnosis line ends in two. */
describe("the lines end in one full stop", () => {
  it("a red line and a diagnosis never end in '..'", () => {
    const red = redLines([{ site: siteOf("uscisexam.com"), outcome: { status: "red", reasons: [{ text: "fell." }] }, diagnosis: { status: "diagnosed", lines: [{ confidence: "CONFIRMED", text: "x ends." }] } }]);
    expect(red[0]!.line).not.toMatch(/\.\./);
    expect(red[0]!.line).toMatch(/\.$/);
    const d = diagnoseDrop({ pages: { ok: true, previous: [{ key: "https://s.com/a", impressions: 100 }], current: [] }, queries: { ok: false, why: "n" }, sitemap: {}, quality: { red: true, line: "most pages fall short. Danielle is fixing the template." } });
    expect(d.text.length).toBeGreaterThan(1);
    for (const l of d.text) expect(l).not.toMatch(/\.\.$/);
  });
});
