/**
 * THE FIXER'S REPORTS REACH BOSS OS, AND TODAY SAYS ONLY WHAT IS TRUE NOW (26 Oct 2026).
 *
 * Pins, each against the night that broke it:
 *   · 7 Search Readiness queue passes were refused NAMED STOP [NO_SEARCH_EVIDENCE] rc=11 because a
 *     queue pass reads no mailbox. Queue passes now carry queue evidence; mailbox passes keep the
 *     full mailbox rule (mailbox, queries, date range, message count) — now actually checked.
 *   · One pass was refused for an '@' that was JSON-LD's "@type". An ADDRESS is still refused.
 *   · `LAND <repo> <pr>: landed` printed once per row (up to 10 times for one PR), and ~/bin/land
 *     ran once per row too. Once per PR now.
 *   · "no repository claims" porchandparty901.com while sites.json mapped it to p-n-p: one list now,
 *     and every domain an audit has reported maps to a repo or says why none.
 *   · An off-limits alert for a repo that left the list on 16 Oct, and "(49 sites in all)" for 49 rows.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { searchEvidenceGap, carriesAddress, queueEvidence, scopeSnapshot, findingItemId } from "../src/shared/boss/siteAudit/evidence.mjs";
import { repoForDomain, domainOfRow, AUDITED_ELSEWHERE, DOMAIN_REPOS } from "../src/shared/boss/siteAudit/domainRepos.mjs";
import { auditFindingAlerts } from "../src/shared/boss/siteAudit/todayAlerts.mjs";
// @ts-expect-error — plain .mjs with no types; the functions under test are the ones the runner calls.
import { landAll, landLines } from "../scripts/ops/site-audit-lib.mjs";
import { loadSites } from "../src/shared/boss/searchReadiness/audit.mjs";

const ROOT = join(__dirname, "..");

/** The `searched` objects the refused queue passes of 25–26 Oct 2026 actually wrote (addresses removed). */
const REFUSED_SHAPES = [
  { source: "/x/fix-queue.json", queries: ["fix-queue.json briefs where repo == dream-wedding-builder"], note: "Scoped" },
  { source: "search-readiness fix queue", queue: "/x/fix-queue.json", mailbox: null, queries: [], since: "2026-10-26" },
  { source: "search-readiness fix queue (scoped pass: section 1b only, no mail read)", queue: "~/.boss-os/search-readiness/fix-queue.json", scope: ["sr-aplayermode.com-b6"] },
];

describe("search evidence fits the kind of pass", () => {
  it("a mailbox pass needs the mailbox, the queries, the date range and the message count", () => {
    const full = { mailbox: "the owner's personal mailbox", queries: ["from:sa@ahrefs.com newer_than:14d"], since: "2026-10-02", until: "2026-10-16", messages: 0 };
    expect(searchEvidenceGap(full)).toBeNull();
    for (const drop of ["mailbox", "queries", "since", "until", "messages"]) {
      const s: any = { ...full }; delete s[drop];
      expect(searchEvidenceGap(s), drop).toMatch(/mailbox pass/);
    }
    expect(searchEvidenceGap({ ...full, queries: [] })).toMatch(/queries/);
    expect(searchEvidenceGap(null)).toMatch(/missing/);
  });

  it("every shape the refused queue passes wrote fails the mailbox rule, and passes once queue evidence is built", () => {
    for (const s of REFUSED_SHAPES) expect(searchEvidenceGap(s)).not.toBeNull();
    const queue = { written_at: "2026-10-26T09:41:45.890Z", briefs: [
      { id: "sr-aplayermode.com-b6", repo: "sprylabs-hpc-site" }, { id: "sr-aplayermode.com-c2", repo: "sprylabs-hpc-site" },
      { id: "sr-uscisexam.com-a6", repo: "local-guides-generator" }] };
    const scope = scopeSnapshot({ queue, queueFile: "/x/fix-queue.json", repo: "sprylabs-hpc-site", briefIds: ["sr-aplayermode.com-b6"] });
    expect(scope).toMatchObject({ item_ids: ["sr-aplayermode.com-b6"], briefs_in_queue_for_repo: 2 });
    const ev = queueEvidence({ scope, repo: "sprylabs-hpc-site", findings: [{ project: "checklist:aplayermode.com", headline: "c2: no breadcrumbs" }] });
    expect(ev.item_ids).toEqual(["sr-aplayermode.com-b6", "sr-aplayermode.com-c2"]);
    expect(searchEvidenceGap(ev)).toBeNull();
  });

  it("a queue pass is still strict: no queue file, no write date, no repo or no brief ids is refused", () => {
    const ok = { mode: "queue", queue_file: "/x/fix-queue.json", queue_written_at: "2026-10-26T00:00:00Z", repo: "p-n-p", item_ids: ["sr-porchandparty901.com-a6"] };
    expect(searchEvidenceGap(ok)).toBeNull();
    for (const drop of ["queue_file", "queue_written_at", "repo"]) { const s: any = { ...ok }; delete s[drop]; expect(searchEvidenceGap(s), drop).toMatch(/queue pass/); }
    expect(searchEvidenceGap({ ...ok, item_ids: [] })).toMatch(/item_ids/);
  });

  it("brief ids come from the checklist project and the headline's item id", () => {
    expect(findingItemId({ project: "checklist:dentistryguides.com", headline: "j9: 50 of 55 coverage pages missing" })).toBe("sr-dentistryguides.com-j9");
    expect(findingItemId({ project: "Porchandparty901", headline: "4XX page: 2 URLs" })).toBeNull();
  });
});

describe("no address crosses, but JSON-LD words do", () => {
  it("refuses an address anywhere and lets @type, @id and @graph through", () => {
    expect(carriesAddress("Organization @type lacks sameAs; @id and @graph are fine")).toBe(false);
    expect(carriesAddress("write to someone@example.com for the fix")).toBe(true);
  });
});

describe("one land per pull request, one LAND line per pull request", () => {
  it("five rows on one PR are landed once and printed once", () => {
    const calls: string[][] = [];
    const pr = "https://github.com/seq23/boss-os/pull/151";
    const payload = { findings: [
      ...[1, 2, 3, 4, 5].map((n) => ({ disposition: "fixed_pr", repo: "boss-os", pr_url: pr, headline: `h${n}` })),
      { disposition: "fixed_pr", repo: "boss-os", pr_url: "https://github.com/seq23/boss-os/pull/152", headline: "other" },
    ] };
    landAll(payload, { run: (c: string, a: string[]) => { calls.push([c, ...a]); return { status: 0, out: "LANDED" }; }, landBin: "/bin/land" });
    expect(calls.filter((c) => c.includes("/bin/land"))).toHaveLength(2);
    expect(payload.findings.every((f: any) => f.land === "landed")).toBe(true);
    expect(landLines(payload)).toEqual([`LAND boss-os ${pr}: landed`, "LAND boss-os https://github.com/seq23/boss-os/pull/152: landed"]);
  });
});

/** Every Ahrefs project the account has reported, read from production on 26 Oct 2026. */
const AHREFS_PROJECTS_SEEN = [
  "Approvalprep", "Billionairehighperformancecoach", "Dentistryguides", "Founderoperatorlibrary", "Hicksconsulting",
  "Hormonesivhair", "Horselegalguide", "Memphisvendorlibrary", "Neuroevalguides", "Porchandparty901",
  "Professionalresourcelibrary", "Spry", "Spryexecutiveos", "Theaccidentguides", "Thedentistryguides",
  "Theindustryguides", "Uscisexam", "Virtualagency-os", "Weddingbudgetspreadsheet", "Weddingchecklistpdf",
  "Weddingseatingchartmaker", "Weddingtimelinetemplate", "Westpeekproductions",
];

describe("one domain → repository list", () => {
  it("every audited domain maps to a repo or is explicitly marked as having none, with its reason", () => {
    const domains = [...new Set([...loadSites().grid_repos.map((s: any) => s.domain), ...AHREFS_PROJECTS_SEEN.map((p) => domainOfRow({ project: p }))])];
    for (const d of domains) {
      const r = repoForDomain(d);
      expect(r, `${d} is in no list — add it to sites.json or AUDITED_ELSEWHERE`).not.toBeNull();
      if (r!.repo === null) expect(r!.why!.length, d).toBeGreaterThan(30);
    }
  });

  it("porchandparty901.com is seq23/p-n-p; the grid manifest and AUDITED_ELSEWHERE never name one domain twice", () => {
    expect(repoForDomain("porchandparty901.com")?.repo).toBe("p-n-p");
    expect(repoForDomain("https://www.porchandparty901.com/")?.repo).toBe("p-n-p");
    const grid = new Set(loadSites().grid_repos.map((s: any) => s.domain));
    for (const e of AUDITED_ELSEWHERE) expect(grid.has(e.domain), e.domain).toBe(false);
    expect(DOMAIN_REPOS.size).toBe(grid.size + AUDITED_ELSEWHERE.length);
  });

  it("the fixer's prompt maps through this list, not by grepping REPO_IDENTITY.md alone", async () => {
    const prompt = (await import("node:fs")).readFileSync(join(ROOT, "scripts/ops/ahrefs-audit-fix-prompt.md"), "utf8");
    expect(prompt).toMatch(/site-audit-lib\.mjs repo-for <domain>/);
  });
});

describe("Today says only what is still true", () => {
  const rows = [
    { disposition: "no_repo", project: "Porchandparty901", domain: "porchandparty901.com", repo: null, errors: 118 },
    { disposition: "no_repo", project: "Spry", domain: "spry.vc", repo: null, errors: 0 },
    { disposition: "off_limits", project: "Theindustryguides", domain: "theindustryguides.com", repo: "local-guides-citation-velocity", errors: 13 },
  ];
  it("a no_repo row for a mapped or deliberately-unmapped domain and an off_limits row for a fixable repo say nothing", () => {
    expect(auditFindingAlerts(rows)).toEqual([]);
  });
  it("a domain no list knows still alerts; an off-limits client repo says why", () => {
    const a = auditFindingAlerts([
      { disposition: "no_repo", project: "Brandnewsite", domain: "brandnewsite.com", repo: null, errors: 5 },
      { disposition: "off_limits", project: "Dianne", domain: "dianne.example", repo: "dianne-place-recovery-services", errors: 2 },
    ]);
    expect(a[0]!.text).toMatch(/brandnewsite\.com/);
    expect(a[1]!.text).toMatch(/Why it is off limits: A client's repository/);
  });
  it("counts sites, not rows", () => {
    const many = [50, 4, 4, 3].map((errors, i) => ({ disposition: "surfaced", project: i === 0 ? "Theaccidentguides" : "Porchandparty901", domain: null, repo: null, errors }));
    expect(auditFindingAlerts(many)[0]!.text).toBe("Danielle left 4 findings on 2 sites for a person to decide; the worst is 50 errors on theaccidentguides.com.");
  });
});

/*
 * THE REPORTER, END TO END, against a local stand-in for Boss OS: a queue pass delivers with queue
 * evidence the runner wrote; a mailbox pass missing its date range stops with rc 11 and sends nothing.
 */
describe("ahrefs-audit-report.mjs delivers a queue pass and refuses a thin mailbox pass", () => {
  const posts: any[] = [];
  const server = createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url?.endsWith("/auth/unlock")) { res.setHeader("set-cookie", "boss_session=t; Path=/"); res.end("{}"); return; }
      posts.push(JSON.parse(body || "{}"));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, data: { written: 1, refused: [] } }));
    });
  });
  afterAll(() => server.close());
  const run = async (dir: string, env: Record<string, string>) => {
    await new Promise<void>((r) => server.listening ? r() : server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as any).port;
    return new Promise<{ code: number; out: string }>((resolve) => {
      const p = spawn(process.execPath, [join(ROOT, "scripts/ops/ahrefs-audit-report.mjs")], {
        env: { ...process.env, BOSS_OS_ORIGIN: `http://127.0.0.1:${port}`, BOSS_OS_SITE_AUDIT_DIR: dir, BOSS_PASSCODE: "x", ...env },
      });
      let out = ""; p.stdout.on("data", (c) => (out += c)); p.stderr.on("data", (c) => (out += c));
      p.on("close", (code) => resolve({ code: code ?? -1, out }));
    });
  };
  const finding = { project: "checklist:porchandparty901.com", domain: "porchandparty901.com", repo: "p-n-p", mapped_by: "wrangler_toml", disposition: "in_flight", headline: "a6: lastmod", because: "An open PR carries it.", suggested_action: "Nothing; it lands with that PR." };

  it("queue mode: sends the runner's snapshot as searched, maps the repo by the grid manifest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sr-"));
    writeFileSync(join(dir, "findings.json"), JSON.stringify({ run_id: "t", searched: { mailbox: null, queries: [] }, findings: [finding] }));
    writeFileSync(join(dir, "scope.json"), JSON.stringify({ mode: "queue", queue_file: "/x/fix-queue.json", queue_written_at: "2026-10-26T00:00:00Z", repo: "p-n-p", item_ids: ["sr-porchandparty901.com-a6"] }));
    const r = await run(dir, { SR_SCOPE_REPO: "p-n-p" });
    expect(r.out).not.toMatch(/NAMED STOP/);
    expect(r.code).toBe(0);
    const sent = posts.at(-1);
    expect(sent.searched).toMatchObject({ mode: "queue", repo: "p-n-p", item_ids: ["sr-porchandparty901.com-a6"] });
    expect(sent.findings[0].mapped_by).toBe("grid_manifest");
  });

  it("mailbox mode: a searched with no date range stops NO_SEARCH_EVIDENCE rc 11 and posts nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sr-"));
    writeFileSync(join(dir, "findings.json"), JSON.stringify({ run_id: "t", searched: { mailbox: "the owner's mailbox", queries: ["q"], messages: 3 }, findings: [{ ...finding, project: "Porchandparty901" }] }));
    const before = posts.length;
    const r = await run(dir, { SR_SCOPE_REPO: "" });
    expect(r.code).toBe(11);
    expect(r.out).toMatch(/NO_SEARCH_EVIDENCE[\s\S]*date range/);
    expect(posts.length).toBe(before);
  });
});
