/**
 * THE SEARCH READINESS CHECKLIST, ENFORCED (owner, 25 Oct 2026) — the guard.
 *
 * Fails if the manifest loses an item against the page (71 on the pinned page, plus j9), if any grid
 * repo site has no checkable coverage entry, if a site she named drops out of the list, if an
 * automatic item has no check behind it, or if the rendered page and the manifest stop being one
 * definition. Also reads the "Search Readiness" section of CLAUDE.md, so the rule is not only prose.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  loadChecklist, loadSites, CHECKS, applies, expandCoverage, coverageProblems, runChecks, fixBriefs,
  morningLines, haversineMiles, workQueue, queueRunLine, repairLine, definitionChoice, nextFixStatus,
  indexnowKeyFiles, INDEXNOW_KEY_NAME, loadsClarity, samplePages,
} from "../src/shared/boss/searchReadiness/audit.mjs";
import { renderChecklistPage, loadTemplate, standingsSummary } from "../src/shared/boss/searchReadiness/page.mjs";
import { lineProblems } from "../src/shared/boss/mail/plain.mjs";
import { MORNING_SECTIONS } from "../src/shared/boss/mail/morning.mjs";

const checklist = loadChecklist();
const sites = loadSites();

/** The 71 items on the pinned page as published on 25 Oct 2026. Losing any one fails. */
const PAGE_IDS = [
  ..."a1 a2 a3 a4 a5 a6 a7 a8 a9 a10".split(" "), ..."b1 b2 b3 b4 b5 b6 b7 b8 b9".split(" "),
  ..."c1 c2 c3 c4 c5 c6".split(" "), ..."d1 d2 d3 d4".split(" "), ..."e1 e2 e3 e4 e5 e6 e7 e8".split(" "),
  ..."f1 f2 f3 f4 f5 f6".split(" "), ..."g1 g2 g3 g4 g5".split(" "), ..."h1 h2 h3 h4 h5".split(" "),
  ..."j1 j2 j3 j4 j5 j6 j7 j8".split(" "), ..."i1 i2 i3 i4 i5 i6 i7 i8 i9 i10".split(" "),
];

/** Every site the owner named on 25 Oct 2026. A site falling out of sites.json fails here. */
const REQUIRED_DOMAINS = [
  "time-2-read.com", "theindustryguides.com", "uscisexam.com", "dentistryguides.com", "theaccidentguides.com",
  "neuroevalguides.com", "hormonesivhair.com", "memphisseniorcarehomes.com", "approvalprep.com",
  "weddingchecklistpdf.com", "weddingbudgetspreadsheet.com", "weddingseatingchartmaker.com", "weddingtimelinetemplate.com",
  "aplayermode.com", "founderoperatorlibrary.com", "memphisvendorlibrary.com", "professionalresourcelibrary.com",
  "howweknowdeep.com", "porchandparty901.com", "virtualagency-os.com", "horselegalguide.com", "hicksconsulting.org",
  "billionairehighperformancecoach.com", "spryexecutiveos.com",
];

describe("the manifest holds every item on the page", () => {
  it("has at least the page's 71 items, every page id, plus j9 (hyperlocal coverage)", () => {
    expect(PAGE_IDS).toHaveLength(71);
    expect(checklist.page_item_count).toBe(71);
    const ids = checklist.items.map((i: any) => i.id);
    expect(ids.length).toBeGreaterThanOrEqual(72);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of PAGE_IDS) expect(ids, `item ${id} was lost from the manifest`).toContain(id);
    // The four lessons of 26 Oct 2026, each an automatic check (never prose only).
    expect(ids.length).toBeGreaterThanOrEqual(76);
    const lessons = { b10: ["B", "title_names_own_site", "html"], e9: ["E", "clarity_scoped", "html"], h6: ["H", "build_cache_key", "repo"], j10: ["J", "blocked_lead_domains", "repo"] } as const;
    for (const [id, [phase, type, source]] of Object.entries(lessons)) {
      const it = checklist.items.find((i: any) => i.id === id);
      expect(it, `lesson ${id} was lost`).toBeTruthy();
      expect(it.phase).toBe(phase);
      expect(it.check).toMatchObject({ mode: "auto", type, source });
    }
    expect(checklist.items.find((i: any) => i.id === "j10").title_html).toContain("BLOCKED_LEAD_DOMAINS");
    const j9 = checklist.items.find((i: any) => i.id === "j9");
    expect(j9.phase).toBe("J");
    expect(j9.check).toMatchObject({ mode: "auto", type: "hyperlocal_coverage", source: "coverage" });
  });

  it("every item has a why, a how and a check; every automatic check is implemented; manual ones say why and stay few", () => {
    const manual = checklist.items.filter((i: any) => i.check.mode === "manual");
    for (const i of checklist.items) {
      expect(i.why_html.length, i.id).toBeGreaterThan(20);
      expect(i.how_html.length, i.id).toBeGreaterThan(10);
      expect(checklist.phases.map((p: any) => p.id)).toContain(i.phase);
      expect(i.check.applies_to.length, i.id).toBeGreaterThan(0);
      if (i.check.mode === "auto") {
        expect(typeof CHECKS[i.check.type], `${i.id} → ${i.check.type}`).toBe("function");
        expect(["http", "html", "sitemap", "robots", "canonical", "schema", "gsc", "repo", "github", "crawl", "coverage", "psi"]).toContain(i.check.source);
        expect(i.check.how.length).toBeGreaterThan(20);
      } else {
        expect(i.check.mode).toBe("manual");
        expect(i.check.reason.length, i.id).toBeGreaterThan(40);
      }
    }
    expect(manual.length).toBeLessThanOrEqual(20);
  });
});

describe("every grid repo site has a coverage manifest", () => {
  it("lists every site she named, none excluded, never anything West Peek", () => {
    const domains = sites.grid_repos.map((s: any) => s.domain);
    for (const d of REQUIRED_DOMAINS) expect(domains, `${d} is missing from sites.json`).toContain(d);
    expect(domains).not.toContain("heygetonmylevel.com");
    expect(sites.excluded.map((e: any) => e.domain)).toContain("heygetonmylevel.com");
    for (const d of domains) expect(d).not.toMatch(/westpeek|joinwestpeek/i);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("every site has a category, a kind and a checkable coverage entry", () => {
    for (const s of sites.grid_repos) {
      expect(["side_business", "client", "own_business"], s.domain).toContain(s.category);
      expect(checklist.kinds, s.domain).toContain(s.kind);
      expect(coverageProblems(s), s.domain).toEqual([]);
      expect(s.repo === null ? s.no_repo_why : s.repo, s.domain).toBeTruthy();
    }
  });

  it("time-2-read.com is audited against its repo, dailystory, never as \"no repo\" (25 Oct 2026)", () => {
    const t = sites.grid_repos.find((s: any) => s.domain === "time-2-read.com");
    expect(t.repo).toBe("dailystory");
    expect(t.no_repo_why).toBeUndefined();
  });

  it("aplayermode.com is audited against the repo that serves its apex, never the app repo (25 Oct 2026)", () => {
    // aplayermode.com/* is answered by workers/aplayermode-com in sprylabs-hpc-site, whose
    // aplayermode/ directory holds the page, its robots.txt, sitemap.xml, llms.txt and its OWN
    // IndexNow key (1cf2f6839abec33933cb3e6ea81027b8.txt, live and 200). seq23/aplayer-mode is the
    // Expo app and the API, on app. and api. only. Pointing the repo-side items at it wrote six
    // briefs — e3, e4, e5, i3, i6, i8 — for files that were never missing. The mapping was corrected
    // on 25 Oct and nothing pinned it, so this is the pin: a revert fails here.
    const a = sites.grid_repos.find((s: any) => s.domain === "aplayermode.com");
    expect(a.repo).toBe("sprylabs-hpc-site");
    expect(a.repo).not.toBe("aplayer-mode");
    expect(a._repo_why, "the correction keeps its reason, so it is not undone as a typo").toMatch(/workers\/aplayermode-com/);
  });

  it("the two hyperlocal sites are seeded in full: towns in the radius, neighborhoods, anchors, service × town", () => {
    const senior = sites.grid_repos.find((s: any) => s.domain === "memphisseniorcarehomes.com");
    const pnp = sites.grid_repos.find((s: any) => s.domain === "porchandparty901.com");
    for (const s of [senior, pnp]) {
      expect(s.kind).toBe("hyperlocal");
      for (const t of s.coverage.towns) expect(haversineMiles(s.coverage.center, t)).toBeLessThanOrEqual(s.coverage.radius_miles);
      const kinds = new Set(expandCoverage(s).map((t: any) => t.kind));
      for (const k of ["service_town", "neighborhood", "anchor"]) expect(kinds, s.domain).toContain(k);
    }
    expect(senior.coverage.towns.length).toBeGreaterThanOrEqual(20);
    expect(senior.coverage.anchors.filter((a: any) => a.type === "hospital").length).toBeGreaterThanOrEqual(10);
    expect(senior.coverage.neighborhoods.length).toBeGreaterThanOrEqual(10);
    const paths = expandCoverage(senior).map((t: any) => t.path);
    expect(paths).toContain("/oakland-tn/");
    expect(paths).toContain("/midtown-memphis-tn/");
    expect(paths).toContain("/methodist-le-bonheur-germantown-hospital/");
    expect(paths).toContain("/memory-care-germantown-tn/");
    // The generator's own care-type slugs; a folded town keeps its town page but no service pages.
    expect(paths).toContain("/tunica-ms/");
    expect(paths).not.toContain("/assisted-living-tunica-ms/");
    expect(paths.filter((p: string) => /^\/(assisted-living|memory-care)-/.test(p)).length).toBe(28);
    expect(expandCoverage(pnp).map((t: any) => t.path)).toContain("/areas/cordova-tn-grazing-tables");
  });

  it("a town that narrows its services must say why", () => {
    const senior = sites.grid_repos.find((s: any) => s.domain === "memphisseniorcarehomes.com");
    const bad = JSON.parse(JSON.stringify(senior));
    bad.coverage.towns[0].services = [];
    delete bad.coverage.towns[0].services_why;
    expect(coverageProblems(bad).join(" ")).toMatch(/services_why/);
  });

  it("the generator's guide sites read their own city list", () => {
    const g = sites.grid_repos.find((s: any) => s.domain === "dentistryguides.com");
    expect(g.coverage.model).toBe("repo_cities");
    const out = expandCoverage(g, [{ slug: "albany-ny", status: "live", marketLabel: "Albany, NY" }, { slug: "x-tx", status: "planned" }]);
    expect(out).toEqual([{ kind: "town", name: "Albany, NY", path: "/albany-ny/" }]);
    expect(() => expandCoverage(g, null)).toThrow(/city file/);
  });

  it("the Spry Labs download page is protected, with its hash and buy link", () => {
    for (const d of ["billionairehighperformancecoach.com", "spryexecutiveos.com"]) {
      const s = sites.grid_repos.find((x: any) => x.domain === d);
      expect(s.protected_pages[0]).toMatchObject({ path: "/download", sha256: expect.stringMatching(/^[0-9a-f]{64}$/), buy_link: expect.stringMatching(/^https:\/\/sprylabs\.gumroad\.com\//) });
      expect(s.protected_pages[0].rule).toMatch(/single-page change/);
    }
  });
});

// ─── The checks themselves, on fixtures ───────────────────────────────────────

const page = (url: string, body: string, head = "") => ({ url, status: 200, html: `<html><head>${head}</head><body>${body}</body></html>`, headers: {}, fromSitemap: true });
const site = sites.grid_repos.find((s: any) => s.domain === "memphisseniorcarehomes.com");
const baseCtx = (over: any = {}) => ({
  site, host: "memphisseniorcarehomes.com", home: page("https://memphisseniorcarehomes.com/", "<h1>x</h1>"), pages: [], files: {},
  robots: { status: 200, type: "text/plain", text: "User-agent: *\nAllow: /\nSitemap: https://memphisseniorcarehomes.com/sitemap.xml" },
  sitemap: { ok: true, children: [], urls: new Set<string>() }, portfolio: [], now: Date.parse("2026-10-25T12:00:00Z"), ...over,
});

describe("checks catch what they guard", () => {
  it("an empty child sitemap fails a5 — the memphisseniorcarehomes.com shape", () => {
    const r = CHECKS.sitemap_valid(baseCtx({ sitemap: { ok: true, urls: new Set(["https://memphisseniorcarehomes.com/a/"]), children: [
      { url: "https://memphisseniorcarehomes.com/sitemap-core.xml", status: 200, count: 1 },
      { url: "https://memphisseniorcarehomes.com/sitemap-cities.xml", status: 200, count: 0 }] } }));
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/sitemap-cities\.xml is empty/);
  });

  it("robots that blocks an AI crawler fails a4; one that allows them passes", () => {
    const params = { ai_agents: ["GPTBot", "ClaudeBot"] };
    expect(CHECKS.robots_ok(baseCtx(), params).status).toBe("pass");
    expect(CHECKS.robots_ok(baseCtx({ robots: { status: 200, type: "text/plain", text: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://x/s.xml" } }), params).detail).toMatch(/GPTBot is disallowed/);
  });

  it("a missing coverage page fails j9 and is listed by URL", () => {
    const r = CHECKS.hyperlocal_coverage(baseCtx({ coverage: { targets: [
      { kind: "town", url: "https://memphisseniorcarehomes.com/memphis-tn/", inSitemap: true, status: 200 },
      { kind: "anchor", url: "https://memphisseniorcarehomes.com/memphis-va-medical-center/", inSitemap: false, status: 404 }] } }));
    expect(r.status).toBe("fail");
    expect(r.missing).toEqual(["https://memphisseniorcarehomes.com/memphis-va-medical-center/"]);
  });

  it("a canonical pointing elsewhere fails a2", () => {
    const ctx = baseCtx({ pages: [page("https://memphisseniorcarehomes.com/a/", "<h1>A</h1>", '<link rel="canonical" href="https://other.com/a/">')] });
    expect(CHECKS.canonical_self(ctx).status).toBe("fail");
  });

  // 26 Oct 2026: a2 called three correct sites broken. weddingbudgetspreadsheet.com,
  // weddingseatingchartmaker.com and weddingtimelinetemplate.com each answer 308 at /
  // to their one money page, whose canonical is itself - which is right. Our fetches
  // follow redirects, so the money page's HTML arrived under the request URL
  // `https://host/` and the check compared the canonical against the URL it asked for
  // rather than the URL the HTML came from.
  it("a / that 308s to a page whose canonical is itself passes a2", () => {
    const served = "https://weddingbudgetspreadsheet.com/wedding-budget-spreadsheet";
    const redirected = { ...page("https://weddingbudgetspreadsheet.com/", "<h1>Budget</h1>", `<link rel="canonical" href="${served}">`), final: served, redirected: true };
    const r = CHECKS.canonical_self(baseCtx({ host: "weddingbudgetspreadsheet.com", pages: [redirected] }));
    expect(r.status).toBe("pass");
  });

  it("a / that 308s to a page canonicalised somewhere else still fails a2, and the detail names both URLs", () => {
    const served = "https://weddingbudgetspreadsheet.com/wedding-budget-spreadsheet";
    const redirected = { ...page("https://weddingbudgetspreadsheet.com/", "<h1>Budget</h1>", '<link rel="canonical" href="https://other.com/x/">'), final: served, redirected: true };
    const r = CHECKS.canonical_self(baseCtx({ host: "weddingbudgetspreadsheet.com", pages: [redirected] }));
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("https://weddingbudgetspreadsheet.com/ → " + served);
    expect(r.detail).toContain("https://other.com/x/");
  });

  it("a repo serving several hosts passes e3 on the key that answers on THIS host", () => {
    // sprylabs-hpc-site's shape: one key at the root for two hosts, a second under aplayermode/ for
    // the third, because an IndexNow key is valid only on the host that serves it. Reading only the
    // first key reported "no IndexNow key file" on a host whose key was live (25 Oct 2026).
    const root = "200dca426298c70aabc048344605cccae8dabc0b460f1b3e21eb6e857ef83af1";
    const own = "1cf2f6839abec33933cb3e6ea81027b8";
    const repo = { ok: true, indexnowKey: root, indexnowKeys: [root, own] };
    const served = CHECKS.indexnow_key!(baseCtx({ repo, files: {
      [`/${root}.txt`]: { status: 404, text: "" },
      [`/${own}.txt`]: { status: 200, text: own },
    } }) as any);
    expect(served.status).toBe("pass");
    expect(served.detail).toContain(own);
    const none = CHECKS.indexnow_key!(baseCtx({ repo, files: {
      [`/${root}.txt`]: { status: 404, text: "" },
      [`/${own}.txt`]: { status: 404, text: "" },
    } }) as any);
    expect(none.status).toBe("fail");
    expect(none.detail).toMatch(/no IndexNow key file answers on this host/);
    expect(none.missing).toHaveLength(2);
    // A repo with no key file at all still fails for that reason.
    expect(CHECKS.indexnow_key!(baseCtx({ repo: { ok: true, indexnowKeys: [] } }) as any).detail)
      .toMatch(/no IndexNow key file in the repo/);
  });

  it("an IndexNow key may be a UUID, and only a file whose body is its own key counts", () => {
    // porchandparty901.com's key IS a UUID: 5f1f13a4-...-9c2d90c3b7d2.txt, committed at the root of
    // p-n-p, served 200 with its key inside, submitted by that repo's deploy lane and guarded by
    // that repo's own validator. The detector was lowercase hex with no dashes, so it did not match,
    // and e3 and i8 failed every run with "no IndexNow key file in the repo" - two fix briefs a week
    // against a site that had one all along (26 Oct 2026). IndexNow's rule is 8-128 characters of
    // a-z, A-Z, 0-9 and dashes.
    const uuid = "5f1f13a4-3d84-4d13-8ed9-9c2d90c3b7d2";
    const hex = "200dca426298c70aabc048344605cccae8dabc0b460f1b3e21eb6e857ef83af1";
    const nested = "aplayermode/1cf2f6839abec33933cb3e6ea81027b8";
    const tree: Record<string, string> = {
      [`${uuid}.txt`]: `${uuid}\n`,
      [`${hex}.txt`]: hex,
      [`${nested}.txt`]: nested.split("/").pop()!,
      "indexnow.txt": "indexnow",
      // Allowing dashes is not enough on its own: these are all 8-128 characters of the same
      // alphabet, and only the body test tells them apart from a key.
      "llms-full.txt": "# everything about the site",
      "llms.txt": "# llms",
      "robots.txt": "User-agent: *",
      "apple-touch-icon.txt": "not a key",
    };
    expect(indexnowKeyFiles(Object.keys(tree), (f: string) => tree[f])).toEqual([
      `${uuid}.txt`, `${hex}.txt`, `${nested}.txt`, "indexnow.txt",
    ]);
    // The UUID the regression was about matches by name as well.
    expect(INDEXNOW_KEY_NAME.test(`${uuid}.txt`)).toBe(true);
    // A key file whose body is NOT its key is not a key file: that is exactly how a search engine
    // verifies ownership, so a repo that fails it would fail verification too.
    expect(indexnowKeyFiles([`${uuid}.txt`], () => "something else")).toEqual([]);
    // Too short to be a key at all.
    expect(INDEXNOW_KEY_NAME.test("short.txt")).toBe(false);
    // With no reader, the name shape is all there is, and the caller is told as much in the comment.
    expect(indexnowKeyFiles([`${uuid}.txt`, "robots.txt"], undefined)).toEqual([`${uuid}.txt`]);
    // And the check itself passes once such a key answers on the host.
    const r = CHECKS.indexnow_key!(baseCtx({
      repo: { ok: true, indexnowKeys: [uuid] },
      files: { [`/${uuid}.txt`]: { status: 200, text: `${uuid}\n` } },
    }) as any);
    expect(r.status).toBe("pass");
    expect(r.detail).toContain(uuid);
  });

  it("aplayermode.com is mapped to the repo that serves it, not to the app repo", () => {
    // The apex is answered by workers/aplayermode-com in sprylabs-hpc-site; seq23/aplayer-mode is
    // the Expo app and the API (app./api. hosts). The wrong mapping failed six repo-side items
    // (e3, e4, e5, i3, i6, i8) against a repo that never served this host (25 Oct 2026).
    const apm = sites.grid_repos.find((s: any) => s.domain === "aplayermode.com");
    expect(apm.repo).toBe("sprylabs-hpc-site");
    expect(apm._repo_why).toMatch(/workers\/aplayermode-com/);
    // Every grid site's repo is one the audit can read: a repo name no other site uses is fine,
    // but a site must never name a repo that holds no site at all.
    for (const s of sites.grid_repos as any[]) expect(typeof s.repo === "string" && s.repo.length > 0).toBe(true);
  });

  it("a protected page is left out of cosmetic items, and its failure brief carries the rule", () => {
    const spry = sites.grid_repos.find((s: any) => s.domain === "spryexecutiveos.com");
    const bare = page("https://spryexecutiveos.com/download", "<h1>Buy</h1><img src=a.png>");
    const ctx = { ...baseCtx({ site: spry, host: "spryexecutiveos.com", pages: [bare], protectedPaths: ["/download"] }) };
    const results = runChecks(checklist, ctx);
    expect(results.find((r: any) => r.id === "b8").status).not.toBe("fail");
    const briefs = fixBriefs(checklist, [{ site: spry, host: "spryexecutiveos.com", results: [{ id: "a2", status: "fail", detail: "https://spryexecutiveos.com/download has no canonical", evidence: ["https://spryexecutiveos.com/download has no canonical"] }] }]);
    expect(briefs[0].protected[0]).toMatchObject({ path: "/download", buy_link: expect.stringContaining("gumroad") });
    expect(briefs[0]).toMatchObject({ repo: "sprylabs-hpc-site", item_id: "a2", disposition: "fix" });
  });

  it("b2 and c1 on the Spry Labs download page are accepted exceptions: only that page, only those two checks (26 Oct 2026)", () => {
    for (const domain of ["billionairehighperformancecoach.com", "spryexecutiveos.com"]) {
      const s = sites.grid_repos.find((x: any) => x.domain === domain);
      const exc = s.protected_pages.find((p: any) => p.path === "/download").accepted_exceptions.map((x: any) => x.item);
      expect(exc).toEqual(["b2", "c1"]);
      const bare = page(`https://${domain}/download`, "<title>Buy</title><h1>Buy</h1>");
      const other = page(`https://${domain}/about`, "<title>About</title><h1>About</h1>");
      const status = (pages: any[], id: string) => runChecks(checklist, baseCtx({ site: s, host: domain, pages, protectedPaths: [] })).find((r: any) => r.id === id)?.status;
      // The download page alone: b2 and c1 do not fail; every other check still runs on it.
      expect(status([bare], "b2")).not.toBe("fail");
      expect(status([bare], "c1")).not.toBe("fail");
      expect(status([bare], "a2")).toBe("fail");
      // Another page on the same site still fails b2 and c1: the exception is that page only.
      expect(status([bare, other], "b2")).toBe("fail");
      expect(status([bare, other], "c1")).toBe("fail");
    }
    // No other site, and no other page, carries an exception.
    const all = sites.grid_repos.flatMap((x: any) => (x.protected_pages ?? []).filter((p: any) => p.accepted_exceptions?.length).map((p: any) => `${x.domain}${p.path}`));
    expect(all.sort()).toEqual(["billionairehighperformancecoach.com/download", "spryexecutiveos.com/download"]);
  });

  it("every applicable automatic item gets a verdict line (nothing silently skipped)", () => {
    const results = runChecks(checklist, baseCtx());
    const want = checklist.items.filter((i: any) => applies(i, site)).map((i: any) => i.id);
    expect(results.map((r: any) => r.id)).toEqual(want);
    for (const r of results) expect(["pass", "fail", "not_checked", "no_repo", "manual"]).toContain(r.status);
  });
});

describe("the morning email section", () => {
  it("is a registered section and its lines pass the plain-email gate", () => {
    expect(MORNING_SECTIONS).toContain("grid_repos");
    const results = [
      { site: site, results: [{ id: "j9", status: "fail", detail: "x", missing: ["a", "b"] }, { id: "a5", status: "fail", detail: "y" }] },
      { site: sites.grid_repos[0], results: [{ id: "a1", status: "pass", detail: "ok" }] },
    ];
    const lines = morningLines(checklist, results, { queued: 2 });
    expect(lines[0]).toMatch(/We checked all 2 grid repo sites/);
    expect(lines.join(" ")).toMatch(/memphisseniorcarehomes\.com is missing 2/);
    expect(lines.join(" ")).toMatch(/Danielle fixes these every Tuesday: no repair run on record yet, 2 left\./);
    expect(lines.join(" ")).not.toMatch(/Thursday/);
    for (const l of lines) expect(lineProblems(l), l).toEqual([]);
  });
});

describe("the page and the manifest are one definition", () => {
  it("renders every item and its check from the manifest", () => {
    const html = renderChecklistPage(checklist, loadTemplate());
    for (const i of checklist.items) expect(html, i.id).toContain(`data-id="${i.id}"`);
    expect((html.match(/class="item"/g) ?? []).length).toBe(checklist.items.length);
    expect((html.match(/class="check(?: manual)?"/g) ?? []).length).toBe(checklist.items.length);
    expect(html).not.toMatch(/<!--PHASE:/);
  });
});

describe("CLAUDE.md says the rule, and the rule is this code", () => {
  it("names the manifest, the audit, the queue and the page", () => {
    const md = readFileSync("CLAUDE.md", "utf8");
    const sec = md.slice(md.indexOf("## Search Readiness"));
    expect(sec.length).toBeGreaterThan(200);
    for (const s of ["checklist.json", "sites.json", "npm run sites:audit", "fix-queue.json", "npm run sites:page", "grid repos", "tests/searchReadiness.test.ts", "Where every site stands", "BLOCKED_LEAD_DOMAINS", "b10", "e9", "h6", "j10"]) expect(sec).toContain(s);
  });
});

describe("the run measures with the branch's definition, never a stale checkout's (26 Oct 2026)", () => {
  // Her checkout runs the audit under launchd and nothing updates it. On 26 Oct it sat at #147
  // while main held the corrected aplayermode.com → sprylabs-hpc-site mapping, so the run measured
  // the apex against the Expo app repo and wrote five fix briefs (e3, e4, e5, i3, i6) for files
  // that were present all along in the repo that serves that host. Stale definitions invent work.
  const stale = JSON.stringify({ grid_repos: [{ domain: "aplayermode.com", repo: "aplayer-mode" }] });
  const fixed = JSON.stringify({ grid_repos: [{ domain: "aplayermode.com", repo: "sprylabs-hpc-site" }] });

  it("prefers origin's copy when the checkout has drifted, and says so", () => {
    const c = definitionChoice({ local: stale, remote: fixed, path: "sites.json" });
    expect(c.source).toBe("origin");
    expect(c.stale).toBe(true);
    expect(JSON.parse(c.text!).grid_repos[0].repo).toBe("sprylabs-hpc-site");
    expect(c.why).toMatch(/differs from origin/);
  });

  it("is quiet when the checkout matches origin", () => {
    const c = definitionChoice({ local: fixed, remote: fixed, path: "sites.json" });
    expect(c).toMatchObject({ source: "checkout", stale: false });
  });

  it("measures with the checkout, marked unverified, when origin cannot be read (offline)", () => {
    const c = definitionChoice({ local: fixed, remote: null, path: "sites.json" });
    expect(c).toMatchObject({ source: "checkout", stale: false, unverified: true });
    expect(c.text).toBe(fixed);
  });

  it("never measures with half-written JSON: a broken copy is not a definition", () => {
    expect(definitionChoice({ local: fixed, remote: "{ not json", path: "sites.json" }))
      .toMatchObject({ source: "checkout", unverified: true });
    expect(definitionChoice({ local: "{ not json", remote: fixed, path: "sites.json" }))
      .toMatchObject({ source: "origin", stale: true });
    expect(definitionChoice({ local: "", remote: "", path: "sites.json" }))
      .toMatchObject({ source: "none", text: null });
  });

  it("the runner reads both definition files from origin and records which it used", () => {
    const runner = readFileSync("scripts/ops/search-readiness-audit.mjs", "utf8");
    expect(runner).toMatch(/definitionChoice/);
    expect(runner).toMatch(/CHECKLIST_PATH/);
    expect(runner).toMatch(/SITES_PATH/);
    // The results and the queue carry the definition, so a brief can be traced to what made it.
    expect(runner).toMatch(/definition: defs\.source/);
    expect(runner.match(/definition: defs\.source/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("CLAUDE.md states the rule", () => {
    const md = readFileSync("CLAUDE.md", "utf8");
    const sec = md.slice(md.indexOf("## Search Readiness"));
    expect(sec).toMatch(/origin/);
    expect(sec).toMatch(/stale/i);
  });
});

describe("the scheduled audit runs current code (26 Oct 2026)", () => {
  // definitionChoice fixes the DATA. The CODE is loaded before any of it can run, and the launchd
  // job (com.seq.boss-sites-audit) runs npm run sites:audit in her own checkout, which nothing
  // updated: it sat at #147. sites:audit now fast-forwards that checkout first — and only that.
  const sh = readFileSync("scripts/ops/self-update-checkout.sh", "utf8");

  it("sites:audit fast-forwards before it measures", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["sites:audit"]).toContain("scripts/ops/self-update-checkout.sh");
    expect(pkg.scripts["sites:audit"]).toContain("search-readiness-audit.mjs");
    expect(pkg.scripts["sites:audit"].indexOf("self-update-checkout"))
      .toBeLessThan(pkg.scripts["sites:audit"].indexOf("search-readiness-audit"));
  });

  it("it is a fast-forward on the default branch of a clean tree, and nothing else", () => {
    expect(sh).toContain("merge --ff-only");
    expect(sh).toContain("git status --porcelain");          // dirty tree: left alone
    expect(sh).toContain("merge-base --is-ancestor");        // strict fast-forward only
    expect(sh).toMatch(/not \$DEFAULT; left alone/);         // never a branch switch
    // Her checkout is never rewritten, rebased, stashed or committed into by this script.
    for (const forbidden of ["reset --hard", "git rebase", "git stash", "git commit", "checkout -B", "push"]) {
      expect(sh, `${forbidden} must never appear in the self-update step`).not.toContain(forbidden);
    }
  });

  it("every refusal exits 0, so the audit always runs", () => {
    expect(sh.match(/exit 0/g)!.length).toBeGreaterThanOrEqual(7);
    expect(sh).not.toMatch(/exit [1-9]/);
  });
});

describe("the fix queue is worked to empty, then weekly on Tuesday (owner, 25 Oct 2026)", () => {
  const prot = [{ path: "/download", rule: "PROTECTED" }];
  const briefs = [
    { repo: "a", disposition: "fix" }, { repo: "a", disposition: "fix" }, { repo: "b", disposition: "fix" },
    { repo: "sprylabs-hpc-site", disposition: "fix", protected: prot },
    { repo: null, disposition: "no_repo" },
  ];
  it("plans every workable brief by repo, and never plans a protected or no_repo one", () => {
    const w = workQueue(briefs);
    expect(w).toMatchObject({ total: 5, workable: 3, protected: 1, no_repo: 1 });
    expect(w.repos).toEqual([{ repo: "a", n: 2 }, { repo: "b", n: 1 }]);
    expect(w.repos.map((r) => r.repo)).not.toContain("sprylabs-hpc-site");
  });
  it("hands a pass at most 10 briefs of one repo — 61 in one pass ran out of turns and landed nothing", () => {
    const many = Array.from({ length: 23 }, (_, i) => ({ id: `sr-x-${i}`, repo: "big", disposition: "fix" }));
    const w = workQueue([...many, { id: "p", repo: "big", disposition: "fix", protected: prot }]);
    expect(w.chunks.map((c) => c.ids.length)).toEqual([10, 10, 3]);
    expect(w.chunks.flatMap((c) => c.ids)).toEqual(many.map((b) => b.id));
    expect(w.chunks.every((c) => c.repo === "big")).toBe(true);
    const driver = readFileSync("scripts/ops/search-readiness-fix.sh", "utf8");
    expect(driver).toMatch(/SR_SCOPE_REPO="\$rr" SR_SCOPE_BRIEFS="\$ids" bash scripts\/ops\/ahrefs-audit-fix\.sh/);
    expect(driver).toMatch(/CHUNK \/\{print \$2" "\$3" "\$4\}/);
    expect(readFileSync("scripts/ops/ahrefs-audit-fix.sh", "utf8")).toMatch(/SR_SCOPE_BRIEFS/);
  });
  it("NEGATIVE: an empty queue plans nothing — the driver names that stop rather than passing silently", () => {
    expect(workQueue([]).repos).toEqual([]);
    expect(workQueue(undefined as any).workable).toBe(0);
  });
  it("the Monday email says it in her words: \"Danielle fixes these every Tuesday: N fixed last week, M left\"", () => {
    const line = repairLine({ fixed: 230 }, 12);
    expect(line).toBe("Danielle fixes these every Tuesday: 230 fixed last week, 12 left.");
    expect(lineProblems(line)).toEqual([]);
    const site = sites.grid_repos[0];
    const lines = morningLines(checklist, [{ site, results: [{ id: "a5", status: "fail", detail: "y" }] }], { queued: 12, lastRepair: { fixed: 230 } });
    expect(lines).toContain("Danielle fixes these every Tuesday: 230 fixed last week, 12 left.");
    expect(queueRunLine({ started: 242, fixed: 230, left: 12, protectedLeft: 2, noRepo: 13 })).toMatch(/Spry Labs download page/);
  });
  it("the line sums the week's runs and the run in progress, never a stale file's count (26 Oct 2026: '0 fixed' mid-run while 129 were fixed)", () => {
    const at = (iso: string) => ({ at: iso });
    let st = nextFixStatus({ at: "2026-10-19T10:00:00Z", fixed: 0 }, { started: 139, fixed: 83, left: 56, ...at("2026-10-26T05:56:00Z") });
    expect(repairLine(st, 17, Date.parse("2026-10-26T10:01:00Z"))).toBe("Danielle fixes these every Tuesday: 83 fixed last week, 17 left. Danielle is fixing them now.");
    st = nextFixStatus(st, { started: 139, fixed: 129, left: 10, protectedLeft: 4, done: true, ...at("2026-10-26T10:36:00Z") });
    expect(repairLine(st, 10, Date.parse("2026-10-26T11:00:00Z"))).toBe("Danielle fixes these every Tuesday: 129 fixed last week, 10 left.");
    expect(repairLine(st, 10, Date.parse("2026-11-03T11:00:00Z"))).toBe("Danielle fixes these every Tuesday: 0 fixed last week, 10 left.");
  });
  it("launchd only ticks and asks the duty row; the audit stays Monday; the fixer takes a one-repo scope", () => {
    const installer = readFileSync("scripts/ops/install-agent-launchd.sh", "utf8");
    const block = installer.slice(installer.indexOf('SRF_LABEL="com.seq.boss-sr-fix"'), installer.indexOf("SRFEOF\n\n"));
    expect(block).toContain("duty-run.sh search-readiness-fix.sh --only-if-due -- bash $REPO/scripts/ops/search-readiness-fix.sh");
    expect(block, "a Weekday in the plist is a second clock").not.toMatch(/Weekday/);
    expect(block).toMatch(/<key>Hour<\/key><integer>7<\/integer><key>Minute<\/key><integer>30<\/integer>/);
    const audit = installer.slice(installer.indexOf('SR_LABEL="com.seq.boss-sites-audit"'), installer.indexOf("SREOF\n\n"));
    expect(audit).toMatch(/<key>Weekday<\/key><integer>1<\/integer><key>Hour<\/key><integer>6<\/integer>/);
    expect(readFileSync("scripts/ops/ahrefs-audit-fix.sh", "utf8")).toMatch(/SR_SCOPE_REPO/);
    const driver = readFileSync("scripts/ops/search-readiness-fix.sh", "utf8");
    expect(driver).toMatch(/fixed nothing; stopping/);
  });
});

describe("known limits and one page counted once (25 Oct 2026)", () => {
  const html = (t: string) => `<html><head><title>${t}</title></head><body>x</body></html>`;
  it("a page sampled twice is not a duplicate title; two different pages with one title still are", () => {
    const t = "Time2Read - Interactive Reading Adventures for Kids";
    const same = CHECKS.title_band!({ pages: [
      { url: "https://time-2-read.com/", status: 200, html: html(t) },
      { url: "https://time-2-read.com", status: 200, html: html(t) },
    ] } as any);
    expect(same.status).toBe("pass");
    const two = CHECKS.title_band!({ pages: [
      { url: "https://time-2-read.com/", status: 200, html: html(t) },
      { url: "https://time-2-read.com/about", status: 200, html: html(t) },
    ] } as any);
    expect(two.status).toBe("fail");
    expect(two.detail).toMatch(/on 2 pages \(https:\/\/time-2-read\.com\/, https:\/\/time-2-read\.com\/about\)/);
  });
  it("a site marked clarity: false passes the Clarity check with its reason; any other site still needs Clarity", () => {
    const hwk = sites.grid_repos.find((s: any) => s.domain === "howweknowdeep.com");
    expect(hwk.clarity).toBe(false);
    const off = CHECKS.clarity!({ site: hwk, home: { html: "<html></html>" }, files: {} } as any);
    expect(off.status).toBe("pass");
    expect(off.detail).toMatch(/YouTube/);
    const t2r = sites.grid_repos.find((s: any) => s.domain === "time-2-read.com");
    expect(CHECKS.clarity!({ site: t2r, home: { html: "<html></html>" }, files: {} } as any).status).toBe("fail");
    expect(sites.grid_repos.filter((s: any) => s.clarity === false).map((s: any) => s.domain)).toEqual(["howweknowdeep.com"]);
  });
  it("a known limit stays in the queue with its reason and is never workable", () => {
    const site = sites.grid_repos.find((s: any) => s.domain === "time-2-read.com");
    expect(site.known_limits.map((k: any) => k.item).sort()).toEqual(["a1", "a9"]);
    const results = ["a1", "a9", "b1", "e6", "i8", "i10"].map((id) => ({ id, status: "fail", detail: "x" }));
    const briefs = fixBriefs(checklist, [{ site, host: site.domain, results }]);
    const by = Object.fromEntries(briefs.map((b: any) => [b.item_id, b]));
    for (const id of ["a1", "a9"]) { expect(by[id].disposition).toBe("known_limit"); expect(by[id].known_limit.length).toBeGreaterThan(20); }
    // Clarity went live on time-2-read.com on 25 Oct 2026 (project z3erswoh8e): a failing e6/i8 is real fix work, never excused.
    for (const id of ["b1", "e6", "i8"]) expect(by[id].disposition).toBe("fix");
    expect(workQueue(briefs)).toMatchObject({ total: 6, workable: 4 });
  });

  it("a known limit set from a measurement or a dated decision expires on review_after and is worked again (26 Oct 2026)", () => {
    const dent = sites.grid_repos.find((s: any) => s.domain === "dentistryguides.com");
    expect(dent.known_limits.map((k: any) => k.item).sort()).toEqual(["a3", "j9"]);
    for (const k of dent.known_limits) expect(k.review_after).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const results = [{ id: "j9", status: "fail", detail: "50 missing" }];
    const before = fixBriefs(checklist, [{ site: dent, host: dent.domain, results }], { now: Date.parse("2026-10-26T12:00:00Z") });
    expect(before[0].disposition).toBe("known_limit");
    const after = fixBriefs(checklist, [{ site: dent, host: dent.domain, results }], { now: Date.parse("2027-01-10T12:00:00Z") });
    expect(after[0].disposition).toBe("fix");
  });
});

// ─── The four lessons of 26 Oct 2026, each caught by its check ─────────────────

describe("the 26 Oct 2026 lessons catch what they guard", () => {
  const html = (title: string, body = "x", head = "") => `<html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;
  const at = (url: string, h: string) => ({ url, status: 200, html: h });
  const CLARITY = '<script src="https://www.clarity.ms/tag/abc"></script>';
  const t2r = sites.grid_repos.find((s: any) => s.domain === "time-2-read.com");

  it("e9: Clarity on an article with no form fails; on the form page only, it passes — and e6 accepts the form page", () => {
    const article = at("https://time-2-read.com/blog/a/", html("Story time for kids at Time2Read", "<p>words</p>" + CLARITY));
    const form = at("https://time-2-read.com/signup/", html("Sign up for Time2Read reading", '<form action="/api/lead"><input name=email></form>' + CLARITY));
    const bad = CHECKS.clarity_scoped!({ site: t2r, pages: [article, form] } as any);
    expect(bad.status).toBe("fail");
    expect(bad.detail).toMatch(/blog\/a/);
    expect(CHECKS.clarity_scoped!({ site: t2r, pages: [form, at("https://time-2-read.com/x/", html("Plain page for Time2Read readers"))] } as any).status).toBe("pass");
    expect(CHECKS.clarity!({ site: t2r, home: { html: "<html></html>" }, files: {}, pages: [form] } as any).status).toBe("pass");
    const buy = at("https://x.com/p/", html("Buy it", '<a href="https://sprylabs.gumroad.com/l/x">Buy</a>' + CLARITY));
    expect(CHECKS.clarity_scoped!({ site: t2r, pages: [buy] } as any).status).toBe("pass");
  });

  it("e9: the privacy disclosure is not a recording tag; actual inline and external loaders still count", () => {
    const privacy = html("Privacy | Porch & Party", '<p>We use Microsoft Clarity. Read <a href="https://clarity.microsoft.com/terms">the terms</a>.</p>');
    expect(loadsClarity(privacy)).toBe(false);
    for (const inert of [
      `<!-- ${CLARITY} -->`, `<template>${CLARITY}</template>`, `<noscript>${CLARITY}</noscript>`,
      '<script type="application/ld+json">{"description":"Microsoft Clarity at clarity.ms"}</script>',
    ]) expect(loadsClarity(inert)).toBe(false);
    expect(CHECKS.clarity_scoped!({ pages: [at("https://porchandparty901.com/privacy-policy", privacy)] } as any).status).toBe("pass");
    expect(CHECKS.clarity!({ home: { html: privacy }, pages: [] } as any).status).toBe("fail");
    const inline = '<script data-clarity-loader>var s=document.createElement("script");s.src="https://www.clarity.ms/tag/"+id;document.head.appendChild(s)</script>';
    for (const tag of [CLARITY, inline, '<script src="/clarity-consent.js"></script>']) {
      expect(loadsClarity(tag)).toBe(true);
      expect(CHECKS.clarity_scoped!({ pages: [at("https://porchandparty901.com/privacy-policy", privacy + tag)] } as any).status).toBe("fail");
    }
  });

  it("e6/i8: a 99-page sample must inspect /request even when the evenly spaced pages skip it", () => {
    const base = "https://porchandparty901.com";
    const urls = Array.from({ length: 99 }, (_, i) => `${base}/areas/place-${i}`);
    urls[79] = `${base}/request`;
    urls[77] = `${base}/privacy-policy`;
    urls[98] = `${base}/protected`;
    const sampled = samplePages(new Set(urls), 12, ["/protected"]);
    expect(sampled).toContain(`${base}/request`);
    expect(sampled).toContain(`${base}/protected`);
    expect(new Set(sampled).size).toBe(sampled.length);
    expect(sampled.length).toBeLessThanOrEqual(21);
    const pages = sampled.map((url: string) => at(url, url.endsWith("/request") ? html("Request", '<form action="/request"></form>' + CLARITY) : html("Information")));
    const key = "test-indexnow-key";
    const ctx = { home: { html: html("Porch & Party") }, pages, repo: { ok: true, indexnowKeys: [key] }, files: { [`/${key}.txt`]: { status: 200, text: key } } } as any;
    expect(CHECKS.clarity!(ctx).status).toBe("pass");
    expect(CHECKS.clarity_indexnow!(ctx).status).toBe("pass");
    expect(CHECKS.clarity_scoped!(ctx).status).toBe("pass");
    const broken = { ...ctx, pages: pages.map((p: any) => ({ ...p, html: p.html.replace(CLARITY, "") })) };
    expect(CHECKS.clarity!(broken).status).toBe("fail");
    expect(CHECKS.clarity_indexnow!(broken).status).toBe("fail");
    const runner = readFileSync("scripts/ops/search-readiness-audit.mjs", "utf8");
    expect(runner).toMatch(/import\s*\{[^}]*samplePages[^}]*\}\s*from[^;]+searchReadiness\/audit\.mjs/s);
    expect(runner).not.toMatch(/function samplePages\(/);
  });

  it("b10: a title naming a sibling site fails, one naming neither fails, one naming its own site passes", () => {
    const ctx = (title: string) => ({ host: "dentistryguides.com", home: { html: html("Dentistry Guides") }, portfolio: ["dentistryguides.com", "theaccidentguides.com", "uscisexam.com"],
      pages: [at("https://dentistryguides.com/a/", html(title))] }) as any;
    expect(CHECKS.title_names_own_site!(ctx("Medicaid dental coverage | Dentistry Guides")).status).toBe("pass");
    const sib = CHECKS.title_names_own_site!(ctx("Medicaid dental coverage | The Accident Guides"));
    expect(sib.status).toBe("fail");
    expect(sib.detail).toMatch(/names theaccidentguides/);
    expect(CHECKS.title_names_own_site!(ctx("Medicaid dental coverage")).detail).toMatch(/does not name the site/);
  });

  it("h6: a build cache keyed on a subset fails; one keyed on git ls-files minus only the workflows passes; no build cache passes", () => {
    const wf = (key: string) => ({ name: "validate.yml", text: `jobs:\n  b:\n    steps:\n      - uses: actions/cache@v4\n        with:\n          path: .build-cache\n          key: ${key}\n` });
    const repo = (workflows: any[], scripts: Record<string, string> = {}) => ({ repo: { ok: true, workflows, files: Object.keys(scripts), show: (f: string) => scripts[f] ?? null } }) as any;
    expect(CHECKS.build_cache_key!(repo([wf("b-${{ hashFiles('src/**', 'package-lock.json') }}")])).status).toBe("fail");
    expect(CHECKS.build_cache_key!(repo([wf("b-${{ hashFiles('**', '!.github/workflows/**') }}")])).status).toBe("pass");
    const hash = `listing="$(git ls-files -s | grep -Ev '\\s\\.github/workflows/' | sort)"`;
    expect(CHECKS.build_cache_key!(repo([wf("b-${{ steps.key.outputs.key }}")], { ".github/scripts/build_input_hash.sh": hash })).status).toBe("pass");
    const narrow = `listing="$(git ls-files -s | grep -Ev '\\s(\\.github/workflows|artifacts)/' | sort)"`;
    expect(CHECKS.build_cache_key!(repo([wf("b-${{ steps.key.outputs.key }}")], { ".github/scripts/build_input_hash.sh": narrow })).status).toBe("fail");
    // Workflows are the one exclusion: a key that hashes them too is not this rule (a restored tree must never carry them).
    expect(CHECKS.build_cache_key!(repo([wf("b-${{ steps.key.outputs.key }}")], { ".github/scripts/build_input_hash.sh": 'git ls-files -s | sort | sha256sum' })).status).toBe("fail");
    expect(CHECKS.build_cache_key!(repo([{ name: "ci.yml", text: "      - uses: actions/cache@v4\n        with:\n          path: ~/.npm\n          key: npm-${{ hashFiles('package-lock.json') }}\n" }])).detail).toMatch(/no workflow restores a cached build/);
  });

  it("j10: a lead endpoint reading BLOCKED_LEAD_DOMAINS passes; a hardcoded list fails; an endpoint that reads neither fails", () => {
    const repo = (files: Record<string, string>) => ({ repo: { ok: true, files: Object.keys(files), show: (f: string) => files[f] ?? null } }) as any;
    expect(CHECKS.blocked_lead_domains!(repo({ "functions/api/request-assistance.js": "const b = blockedDomainFor(email, env.BLOCKED_LEAD_DOMAINS);" })).status).toBe("pass");
    const hard = CHECKS.blocked_lead_domains!(repo({ "functions/api/lead.js": "const BLOCKED_DOMAINS = ['junk.example', 'spam.example'];" }));
    expect(hard.status).toBe("fail");
    expect(hard.detail).toMatch(/written into public code/);
    expect(CHECKS.blocked_lead_domains!(repo({ "functions/api/lead.js": "export const onRequestPost = () => new Response('ok')" })).detail).toMatch(/no lead endpoint reads BLOCKED_LEAD_DOMAINS/);
    expect(CHECKS.blocked_lead_domains!(repo({ "src/index.js": "x" })).status).toBe("pass");
  });
});

describe("the page shows where every site stands, counted from the results file", () => {
  it("one row per site, and the summary counts are computed, never typed", () => {
    const results = { day: "2026-10-26", sites: [
      { site: { domain: "a.com", repo: "ra" }, results: [{ id: "a1", status: "pass" }, { id: "b1", status: "fail" }, { id: "a10", status: "not_checked" }, { id: "d1", status: "manual" }], failing: ["b1"] },
      { site: { domain: "b.com", repo: "rb" }, results: [{ id: "a1", status: "pass" }], failing: [] },
    ] };
    expect(standingsSummary(results)).toMatchObject({ sites: 2, checks: 3, failing: 1, notChecked: 1 });
    const out = renderChecklistPage(checklist, loadTemplate(), { results });
    expect(out).toContain('id="standings"');
    expect(out).toContain('data-standings="2/3/1"');
    expect((out.match(/<tr data-site=/g) ?? []).length).toBe(2);
    expect(out).toMatch(/<b>b1<\/b> Title 30/);
    expect(renderChecklistPage(checklist, loadTemplate())).not.toContain('id="standings"');
  });
});
