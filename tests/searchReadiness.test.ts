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
  morningLines, haversineMiles, workQueue, queueRunLine, repairLine,
} from "../src/shared/boss/searchReadiness/audit.mjs";
import { renderChecklistPage, loadTemplate } from "../src/shared/boss/searchReadiness/page.mjs";
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
    expect(paths).toContain("/germantown-tn/memory-care/");
    expect(expandCoverage(pnp).map((t: any) => t.path)).toContain("/areas/cordova-tn-grazing-tables");
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
    for (const s of ["checklist.json", "sites.json", "npm run sites:audit", "fix-queue.json", "npm run sites:page", "grid repos", "tests/searchReadiness.test.ts"]) expect(sec).toContain(s);
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
    expect(driver).toMatch(/SR_SCOPE_REPO="\$R" SR_SCOPE_BRIEFS="\$IDS" bash scripts\/ops\/ahrefs-audit-fix\.sh/);
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
