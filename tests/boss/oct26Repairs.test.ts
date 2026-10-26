import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiJson, row, stubFetch } from "./helpers";
import { creditFrom, EARLY_RUN_GRACE_MS } from "../../src/worker/boss/routes/duties";
import { dutyStaleness } from "../../src/worker/boss/duties/staleness";
import { credentialAlerts } from "../../src/worker/boss/today/credentials";

/**
 * 26 OCT 2026 REPAIRS, AGAINST REAL D1 AND THE REAL ROUTES.
 *
 *   1. A run an hour early is its slot's run. The Mac was on Eastern time, so the weekly archive
 *      audit fired at 07:40 Central for an 08:40 Central slot; the slot was not credited and Today
 *      said "missed 1 scheduled run" for three days about a duty that had run.
 *   2. The Anthropic and OpenAI keys live only on the Worker, so nothing on the Mac could ever check
 *      them. The Worker now probes them itself when the Mac's check reports.
 *   3. The site-audit ingest: queue evidence accepted, the grid manifest maps a repo, a no_repo row
 *      for a mapped domain is refused, and a newer row supersedes older rows about the same thing.
 */

describe("an early run answers for its slot", () => {
  it("creditFrom: within the grace it is the slot; further out, or late, it is now", () => {
    const now = Date.UTC(2026, 9, 23, 12, 40);
    expect(creditFrom(now + 3_600_000, now)).toBe(now + 3_600_000);
    expect(creditFrom(now + EARLY_RUN_GRACE_MS + 1, now)).toBe(now);
    expect(creditFrom(now - 1, now)).toBe(now);
    expect(creditFrom(null, now)).toBe(now);
  });

  afterEach(() => vi.useRealTimers());
  // Friday 23 Oct 2026: the slot is 08:40 Central = 13:40 UTC; the Mac on Eastern fired at 12:40 UTC.
  const SLOT = Date.UTC(2026, 9, 23, 13, 40);
  const ran = async (at: number, due: number) => {
    await env.DB.prepare(`UPDATE standing_duties SET next_due_at = ? WHERE id = 'duty_archive_audit'`).bind(due).run();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at);
    const res = await apiJson("/api/duties/ran", { method: "POST", body: { local_job: "archive-audit.mjs", outcome: "ok", exit_code: 0 } });
    vi.useRealTimers();
    expect(res.status).toBeLessThan(300);
    return (await row<{ next_due_at: number }>(`SELECT next_due_at FROM standing_duties WHERE id = 'duty_archive_audit'`))!.next_due_at;
  };

  it("the 23 Oct shape: a run one hour before its slot advances the clock to the next Friday", async () => {
    expect(await ran(SLOT - 3_600_000, SLOT)).toBe(SLOT + 7 * 86_400_000);
  });

  it("staleness agrees: the 23 Oct early run is not a missed run three days later (Today said 'missed 1')", () => {
    const duty: any = { name: "Archive audit", suspended: 0, local_hour: 8, local_minute: 40, timezone: "America/Chicago", cadence: "weekly", weekday: 5, weekdays: null, last_run_at: SLOT - 3_600_000, created_at: SLOT - 30 * 86_400_000 };
    const s = dutyStaleness(duty, SLOT + 69 * 3_600_000);
    expect(s.stale).toBe(false);
    expect(s.next_expected).toBe(SLOT + 7 * 86_400_000);
    expect(dutyStaleness({ ...duty, last_run_at: SLOT - 2 * 86_400_000 }, SLOT + 69 * 3_600_000).stale).toBe(true);
  });

  it("NEGATIVE: a run two days ahead of its slot does not consume it", async () => {
    expect(await ran(SLOT - 2 * 86_400_000, SLOT)).toBe(SLOT);
  });
});

describe("the Worker checks the keys only it holds", () => {
  it("a report from the Mac makes the Worker probe the Anthropic and OpenAI keys, and the alerts clear", async () => {
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id IN ('bk_anthropic','bk_openai')`).run();
    await env.DB.prepare(`UPDATE credential_probes SET state = 'unknown', checked_at = NULL WHERE id IN ('cred_anthropic_key','cred_openai_key')`).run();
    (env as any).ANTHROPIC_API_KEY = "test-anthropic";
    (env as any).OPENAI_API_KEY = "test-openai";
    const seen: string[] = [];
    const restore = stubFetch((req) => {
      seen.push(new URL(req.url).host);
      return new Response(JSON.stringify({ data: [] }), { status: req.url.includes("openai") ? 401 : 200 });
    });
    try {
      const before = (await credentialAlerts(env as any)).filter((a) => /Nothing has ever checked The (Anthropic|OpenAI) key/.test(a.text));
      expect(before).toHaveLength(2);
      const res = await apiJson("/api/credentials/probe", { method: "POST", body: { probes: [{ id: "cred_gmail_connector", state: "live", detail: "ok" }] } });
      expect(res.status).toBe(201);
      expect(seen.sort()).toEqual(["api.anthropic.com", "api.openai.com"]);
      const a = await row<{ state: string; checked_at: number }>(`SELECT state, checked_at FROM credential_probes WHERE id = 'cred_anthropic_key'`);
      const o = await row<{ state: string }>(`SELECT state FROM credential_probes WHERE id = 'cred_openai_key'`);
      expect(a).toMatchObject({ state: "live" });
      expect(a!.checked_at).toBeGreaterThan(0);
      expect(o!.state).toBe("dead"); // 401 is a dead key, and it is said out loud
      const after = await credentialAlerts(env as any);
      expect(after.some((x) => /Nothing has ever checked The (Anthropic|OpenAI) key/.test(x.text))).toBe(false);
      expect(after.some((x) => /The OpenAI key is not working/.test(x.text))).toBe(true);
    } finally {
      restore();
      delete (env as any).ANTHROPIC_API_KEY; delete (env as any).OPENAI_API_KEY;
    }
  });
});

describe("the site-audit ingest", () => {
  const queueSearched = { mode: "queue", queue_file: "/x/fix-queue.json", queue_written_at: "2026-10-26T00:00:00Z", repo: "p-n-p", item_ids: ["sr-porchandparty901.com-j9"] };
  const f = (over: Record<string, unknown>) => ({ project: "checklist:porchandparty901.com", domain: "porchandparty901.com", repo: "p-n-p", disposition: "surfaced", headline: "j9: 32 pages missing", because: "measured", suggested_action: "build them", ...over });

  it("accepts a queue pass's evidence and maps the repo by the grid manifest", async () => {
    const res = await apiJson("/api/engineering/site-audit-findings", { method: "POST", body: { run_id: "t1", searched: queueSearched, findings: [f({ mapped_by: "wrangler_toml" })] } });
    expect(res.status).toBe(201);
    const r = await row<{ mapped_by: string }>(`SELECT mapped_by FROM site_audit_findings WHERE project = 'checklist:porchandparty901.com' AND headline = 'j9: 32 pages missing'`);
    expect(r!.mapped_by).toBe("grid_manifest");
  });

  it("refuses a mailbox pass without its date range, and a queue pass without brief ids", async () => {
    const thin = await apiJson("/api/engineering/site-audit-findings", { method: "POST", body: { run_id: "t2", searched: { mailbox: "m", queries: ["q"], messages: 1 }, findings: [f({})] } });
    expect(thin.status).toBe(400);
    const noIds = await apiJson("/api/engineering/site-audit-findings", { method: "POST", body: { run_id: "t2", searched: { ...queueSearched, item_ids: [] }, findings: [f({})] } });
    expect(noIds.status).toBe(400);
  });

  it("a newer row for the same item supersedes the older wording; a no_repo row for a mapped domain is refused", async () => {
    await apiJson("/api/engineering/site-audit-findings", { method: "POST", body: { run_id: "t1", searched: queueSearched, findings: [f({})] } });
    await apiJson("/api/engineering/site-audit-findings", { method: "POST", body: { run_id: "t3", searched: queueSearched, findings: [f({ headline: "j9: 32 of 64 pages missing, reworded" })] } });
    const older = await row<{ archived_at: number | null }>(`SELECT archived_at FROM site_audit_findings WHERE headline = 'j9: 32 pages missing'`);
    expect(older!.archived_at).not.toBeNull();
    const res = await apiJson<any>("/api/engineering/site-audit-findings", { method: "POST", body: {
      run_id: "t4", searched: queueSearched,
      findings: [f({ project: "Porchandparty901", repo: null, disposition: "no_repo", headline: "118 errors" }), f({ headline: "a6: lastmod" })],
    } });
    expect(res.status).toBe(201);
    expect(res.body.data.refused.join(" ")).toMatch(/p-n-p does/);
  });

  it("a late re-delivery of an older pass never supersedes what a later pass already wrote", async () => {
    const now = Date.now();
    await apiJson("/api/engineering/site-audit-findings", { method: "POST", body: { run_id: "late-new", ran_at: now - 60_000, searched: queueSearched, findings: [f({ headline: "j9: newest wording" })] } });
    await apiJson("/api/engineering/site-audit-findings", { method: "POST", body: { run_id: "late-old", ran_at: now - 6 * 3_600_000, searched: queueSearched, findings: [f({ headline: "j9: oldest wording" })] } });
    const newest = await row<{ archived_at: number | null }>(`SELECT archived_at FROM site_audit_findings WHERE headline = 'j9: newest wording'`);
    const oldest = await row<{ archived_at: number | null; found_at: number }>(`SELECT archived_at, found_at FROM site_audit_findings WHERE headline = 'j9: oldest wording'`);
    expect(newest!.archived_at).toBeNull();
    expect(oldest!.archived_at).not.toBeNull();
    expect(oldest!.found_at).toBe(now - 6 * 3_600_000);
  });
});

describe("what now passes clears its old finding (26 Oct 2026: three asks to her, all already true)", () => {
  it("a passing item archives the older open findings for that site and item only", async () => {
    const seed = (id: string, project: string, headline: string) => env.DB.prepare(
      `INSERT INTO site_audit_findings (id, project, domain, repo, mapped_by, disposition, headline, because, suggested_action, searched, status, run_id, found_at, updated_at)
       VALUES (?, ?, ?, 'local-guides-generator', 'grid_manifest', 'surfaced', ?, 'measured', 'remove the sitemap in Search Console', '{}', 'new', 'c1', ?, ?)`,
    ).bind(id, project, project.slice(10), headline, Date.now(), Date.now()).run();
    await seed("saf_c1", "checklist:guides.example", "e2: sitemap-guides.xml reports 1 error");
    await seed("saf_c2", "checklist:guides.example", "j9: 3 pages missing");
    await seed("saf_c3", "checklist:other.example", "e2: no property");
    const later = new Date(Date.now() + 60_000).toISOString();
    const cleared = await apiJson("/api/engineering/site-audit-findings/cleared", { method: "POST", body: { at: later, passes: [{ project: "checklist:guides.example", item: "e2" }] } });
    expect((cleared.body as any).data.archived).toBe(1);
    const live = await env.DB.prepare(`SELECT project, headline FROM site_audit_findings WHERE archived_at IS NULL AND project IN ('checklist:guides.example','checklist:other.example') ORDER BY headline`).all<any>();
    expect(live.results.map((r: any) => `${r.project} ${r.headline}`)).toEqual(["checklist:other.example e2: no property", "checklist:guides.example j9: 3 pages missing"]);
  });
});
