/**
 * BRAINS (owner, 31 Oct 2026). One document per business, read first by every employee. The API,
 * the revisions, the scoreboard, edits by email, the prompt injection, the Monday check, and the
 * rule that a non-Claude route never receives a confidential span. Synthetic data only.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiJson, all, completionResponse, row, stubFetch } from "./helpers";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { buildPrompt, buildPromptParts } from "../../src/worker/boss/queue/consumer";
import { routeCompletion } from "../../src/worker/boss/router";
import { dispatchRunForTask } from "../../src/worker/boss/backends/dispatch";
import { runBrainsCohesion, currentCohesion, recordMacCohesion, COHESION_KEY } from "../../src/worker/boss/brains/store";
import { BRAINS, seedFor, CONFIDENTIAL_OPEN, CONFIDENTIAL_CLOSE } from "../../src/shared/boss/brains/brain.mjs";

const SECRET = "Synthetic LP Zeta commits 40 at a 2x step-up";
const PRIVATE_LINE = `Our LPs: ${CONFIDENTIAL_OPEN}${SECRET}${CONFIDENTIAL_CLOSE} and more to come.`;

async function resetBrains() {
  await env.DB.exec("DELETE FROM brain_revisions;");
  for (const b of BRAINS) {
    await env.DB.prepare(`UPDATE brains SET body_md = ?, updated_at = ?, updated_by = 'seed' WHERE slug = ?`).bind(seedFor(b.slug, b.title), Date.now(), b.slug).run();
  }
  await env.DB.prepare(`DELETE FROM settings WHERE key = ?`).bind(COHESION_KEY).run();
}

function mail(subject: string, body: string) {
  const from = "Sequoia <seq.taylor@gmail.com>";
  const headers = new Headers({ from, subject, "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com", "message-id": `<${Math.random().toString(36).slice(2)}@mail.gmail.com>` });
  const raw = `From: ${from}\r\nSubject: ${subject}\r\n\r\n${body}`;
  return { from: "seq.taylor@gmail.com", to: "boss@sequoiataylor.com", headers, raw: new Response(raw).body!, rawSize: raw.length };
}

beforeEach(resetBrains);

describe("the brains API", () => {
  it("lists all nine, each with its gaps and a stale flag", async () => {
    const r = await apiJson<any>("/api/brains");
    expect(r.status).toBe(200);
    const list = r.body.data.brains;
    expect(list.map((b: any) => b.slug)).toEqual(BRAINS.map((b) => b.slug));
    expect(list).toHaveLength(9);
    expect(list.slice(0, 3).map((b: any) => b.slug)).toEqual(["brokerage", "west-peek-ventures", "west-peek"]);
    const pnp = list.find((b: any) => b.slug === "porch-and-party");
    expect(pnp).toMatchObject({ title: "Porch & Party 901", missing_count: 8, stale: false });
    expect(list.find((b: any) => b.slug === "team").missing_count).toBe(0);
  });

  it("marks a brain untouched for 90+ days stale", async () => {
    await env.DB.prepare(`UPDATE brains SET updated_at = ? WHERE slug = 'spry'`).bind(Date.now() - 94 * 86_400_000).run();
    const list = (await apiJson<any>("/api/brains")).body.data.brains;
    expect(list.find((b: any) => b.slug === "spry")).toMatchObject({ stale: true, days_since: 94 });
    expect(list.find((b: any) => b.slug === "time-2-read").stale).toBe(false);
  });

  it("refuses a request without a session, like the rest of /api/boss", async () => {
    const worker = (await import("../../src/worker/boss/index")).default;
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://boss.test/api/brains"), env as any, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("saves one section, keeps the rest, and records a revision", async () => {
    const r = await apiJson<any>("/api/brains/time-2-read", { method: "PUT", body: { section: "Priorities", text: "1. Institutions first\n2. Positioning study" } });
    expect(r.status).toBe(200);
    expect(r.body.data.body_md).toContain("## Priorities\n1. Institutions first\n2. Positioning study");
    expect(r.body.data.body_md).toContain("## Company\n[MISSING]");
    expect(r.body.data.missing_count).toBe(7);
    const revs = (await apiJson<any>("/api/brains/time-2-read/revisions")).body.data.revisions;
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ changed_by: "Sequoia", note: "Priorities edited" });
    expect(revs[0].body_md).toBe(r.body.data.body_md);
  });

  it("saves the whole document too, and refuses an unknown section or brain", async () => {
    const whole = await apiJson<any>("/api/brains/team", { method: "PUT", body: { body_md: "# Who's who — your AI teams\n\nSimone runs the day." } });
    expect(whole.status).toBe(200);
    expect((await apiJson<any>("/api/brains/spry", { method: "PUT", body: { section: "Gossip", text: "x" } })).status).toBe(400);
    expect((await apiJson<any>("/api/brains/nope", { method: "PUT", body: { section: "Company", text: "x" } })).status).toBe(400);
    expect((await apiJson<any>("/api/brains/nope")).status).toBe(404);
  });

  it("the scoreboard reads each Numbers table, says 'not tracked yet', never invents, skips personal and team", async () => {
    await apiJson("/api/brains/spry", { method: "PUT", body: { section: "Numbers", text: "| Metric | Definition | Source | Value | Last updated |\n|---|---|---|---|---|\n| Sales | units a month | Gumroad | 2 | 2026-10-30 |\n| Visitors | a month | Search Console | [MISSING] | |" } });
    const rows = (await apiJson<any>("/api/brains/scoreboard")).body.data.rows;
    const spry = rows.filter((r: any) => r.slug === "spry");
    expect(spry).toEqual([
      expect.objectContaining({ metric: "Sales", value: "2", words: "2", last_updated: "2026-10-30" }),
      expect.objectContaining({ metric: "Visitors", value: null, words: "not tracked yet" }),
    ]);
    expect(rows.filter((r: any) => r.slug === "porch-and-party")).toEqual([expect.objectContaining({ metric: null, value: null, words: "not tracked yet" })]);
    expect(rows.some((r: any) => r.slug === "personal" || r.slug === "team")).toBe(false);
    // One row set per live business brain, in order (restructure 1 Nov 2026): the community is new,
    // the retired industry-guides is not scored.
    expect([...new Set(rows.map((r: any) => r.slug))]).toEqual(["brokerage", "west-peek-ventures", "west-peek", "porch-and-party", "time-2-read", "spry", "friends"]);
  });

  it("industry-guides is retired into spry: GET and PUT resolve to spry, its history is kept, the list never shows it", async () => {
    // The old row stays in D1 as history (migration 0326 retitles it; nothing is deleted).
    const old = await row<any>(`SELECT slug, title FROM brains WHERE slug = 'industry-guides'`);
    expect(old).toMatchObject({ slug: "industry-guides", title: "Industry Guides (retired 1 Nov 2026: now in Spry Labs)" });
    await env.DB.prepare(`INSERT INTO brain_revisions (id, slug, body_md, changed_at, changed_by, note) VALUES ('brv_old_ig', 'industry-guides', '# old', 1, 'Sequoia', 'before the fold')`).run();

    const got = await apiJson<any>("/api/brains/industry-guides");
    expect(got.status).toBe(200);
    expect(got.body.data).toMatchObject({ slug: "spry", title: "Spry Labs — the umbrella for every side business" });

    const put = await apiJson<any>("/api/brains/industry-guides", { method: "PUT", body: { section: "Priorities", text: "1. guides", note: "via old link" } });
    expect(put.status).toBe(200);
    expect(put.body.data.slug).toBe("spry");
    expect((await row<any>(`SELECT body_md FROM brains WHERE slug = 'spry'`)).body_md).toContain("1. guides");
    expect((await row<any>(`SELECT body_md FROM brains WHERE slug = 'industry-guides'`)).body_md).not.toContain("1. guides");

    const revs = (await apiJson<any>("/api/brains/industry-guides/revisions")).body.data.revisions;
    expect(revs.map((r: any) => r.note)).toEqual(["via old link", "before the fold"]);

    const list = (await apiJson<any>("/api/brains")).body.data.brains;
    expect(list.map((b: any) => b.slug)).not.toContain("industry-guides");
    expect(list.find((b: any) => b.slug === "west-peek")).toMatchObject({ title: "West Peek — the community", missing_count: 8 });
  });
});

describe("brain edits by email", () => {
  it("adds a settled decision to the P&P brain, records 'by email', and confirms", async () => {
    const r = await handleBossInboundMail(mail("brain", "P&P brain: add settled decision Book only local vendors because they show up on time\n\nThanks"), env as any);
    expect(r.outcome).toBe("BRAIN_EDITED");
    expect(r.reply).toMatch(/P&P brain: added to Settled decisions/);
    const b = await row<any>(`SELECT body_md, updated_by FROM brains WHERE slug = 'porch-and-party'`);
    expect(b.body_md).toMatch(/## Settled decisions\n- \d{4}-\d{2}-\d{2} — Book only local vendors — they show up on time\n/);
    expect(b.body_md).not.toContain("Thanks");
    const rev = await all<any>(`SELECT note, changed_by FROM brain_revisions WHERE slug = 'porch-and-party'`);
    expect(rev).toEqual([{ note: "by email", changed_by: "Sequoia" }]);
  });

  it("replaces time-2-read's priorities with her numbered list", async () => {
    const r = await handleBossInboundMail(mail("priorities", "time-2-read priorities: 1 land three institutions 2 finish the positioning study"), env as any);
    expect(r.outcome).toBe("BRAIN_EDITED");
    const b = await row<any>(`SELECT body_md FROM brains WHERE slug = 'time-2-read'`);
    expect(b.body_md).toContain("## Priorities\n1. land three institutions\n2. finish the positioning study\n");
  });

  it("an ordinary email is not a brain edit", async () => {
    const r = await handleBossInboundMail(mail("lunch", "Can you move my lunch to Friday?"), env as any);
    expect(r.outcome).not.toBe("BRAIN_EDITED");
    expect(await all(`SELECT id FROM brain_revisions`)).toEqual([]);
  });
});

describe("employees read their brains first", () => {
  beforeEach(async () => {
    await apiJson("/api/brains/porch-and-party", { method: "PUT", body: { section: "Company", text: `Porch rentals in Memphis. ${PRIVATE_LINE}` } });
    await apiJson("/api/brains/personal", { method: "PUT", body: { section: "Priorities", text: "1. Close the gates daily" } });
    await apiJson("/api/brains/team", { method: "PUT", body: { body_md: "# Who's who — your AI teams\n\nCamille: Porch & Party. Monique: LPs and outreach." } });
  });

  it("Camille reads P&P at the top; Toni reads no business brain; everyone reads the who's who", async () => {
    const camille = await buildPrompt(env as any, { id: "t1", title: "x", employee_id: "emp_research" }, { prompt: "Write the briefing." });
    // At the top: the brain is the first thing the employee reads, before the firm's notices and the job.
    expect(camille.slice(0, 160)).toContain("THE BUSINESS YOU SERVE");
    expect(camille).toContain("Porch rentals in Memphis.");
    expect(camille).toContain("WHO'S WHO");
    expect(camille).toContain("Monique: LPs and outreach.");
    const toni = await buildPrompt(env as any, { id: "t2", title: "x", employee_id: "emp_risk" }, { prompt: "Check the book." });
    expect(toni).not.toContain("Porch rentals");
    expect(toni).toContain("WHO'S WHO");
  });

  it("Simone reads every business and Personal, summarised, but not the team doc as a business", async () => {
    const p = await buildPrompt(env as any, { id: "t3", title: "x", employee_id: "emp_chief" }, { prompt: "Plan the day." });
    expect(p).toContain("THE BUSINESSES YOU SERVE");
    for (const t of [
      "### Spry Ventures (spry.vc) — the brokerage", "### West Peek Ventures — the fund", "### West Peek — the community",
      "### Porch & Party 901", "### Time-2-Read — a Spry Labs company", "### Spry Labs — the umbrella for every side business",
      "### Friends' businesses", "### Personal",
    ]) expect(p).toContain(t);
    expect(p).not.toContain("### Who's who");
    expect(p).not.toContain("### Industry Guides");
    expect(p).toContain("Close the gates daily");
  });

  it("the private span reaches the Claude seat's prompt and no other", async () => {
    const task = { id: "t4", title: "x", employee_id: "emp_research" };
    const claude = await buildPromptParts(env as any, task, { prompt: "go" }, { backendId: "bk_claude_code" });
    const codex = await buildPromptParts(env as any, task, { prompt: "go" }, { backendId: "bk_codex" });
    const cloud = await buildPrompt(env as any, task, { prompt: "go" });
    expect(claude.firmContext).toContain(SECRET);
    expect(codex.firmContext).not.toContain(SECRET);
    expect(cloud).not.toContain(SECRET);
    expect(cloud).toContain("(private part removed)");
  });
});

describe("a non-Claude route never receives a confidential span", () => {
  let restore: (() => void) | null = null;
  afterEach(() => { restore?.(); restore = null; });

  it("the router cuts every message before the request body exists — even an unclosed mark", async () => {
    const bodies: string[] = [];
    restore = stubFetch(async (req) => { bodies.push(await req.text()); return completionResponse("ok", 10, 10); });
    const e = Object.create(env) as any; e.OPENROUTER_API_KEY = "k";
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', exhausted_until = NULL WHERE id = 'bk_openrouter'`).run();
    await routeCompletion(e, {
      routeId: "rt_ops_default", lane: "ops", sensitivity: "private", risk: "low", intakeKind: "drafting",
      messages: [
        { role: "system", content: `You serve the fund. ${PRIVATE_LINE}` },
        { role: "user", content: `Draft it. ${CONFIDENTIAL_OPEN}${SECRET} with no closing mark` },
      ],
    } as any).catch(() => null);
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b).not.toContain(SECRET);
      expect(b).not.toMatch(/confidential\s*--/i);
    }
  });

  it("a dispatch to any seat but Claude's is written without the span; Claude's keeps it", async () => {
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id IN ('bk_codex','bk_claude_code')`).run();
    const tsk = `tsk_brain_${Math.random().toString(36).slice(2, 8)}`;
    await env.DB.prepare(`INSERT INTO tasks (id, lane, employee_id, title, input, status, created_at, intake_kind, execution_assignment, risk, sensitivity, cost_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(tsk, "ops", "emp_research", "brain test", "{}", "running", Date.now(), "drafting", "AI_DRAFT", "low", "private", "NORMAL").run();
    const base = { taskId: tsk, lane: "ops", title: "brain test", prompt: `go ${PRIVATE_LINE}`, firmContext: PRIVATE_LINE, kind: "research", envelopeId: null, requested: { note: PRIVATE_LINE }, sensitivity: "private", estimatedCostMicros: 0 } as any;
    const codex = await dispatchRunForTask(env as any, { ...base, backendId: "bk_codex" });
    const claude = await dispatchRunForTask(env as any, { ...base, backendId: "bk_claude_code" });
    expect(codex.refused).toBeNull();
    const r = await row<any>(`SELECT requested FROM backend_runs WHERE id = ?`, codex.run_id);
    expect(r.requested).not.toContain(SECRET);
    expect(r.requested).toContain("(private part removed)");
    expect(claude.refused).toBeNull();
    const c = await row<any>(`SELECT requested FROM backend_runs WHERE id = ?`, claude.run_id);
    expect(c.requested).toContain(SECRET);
    // Either way, nothing written for a non-Claude seat holds the span.
    const leaked = await all<any>(`SELECT id FROM backend_runs WHERE backend_id != 'bk_claude_code' AND requested LIKE ?`, `%${SECRET}%`);
    expect(leaked).toEqual([]);
  });
});

describe("the Monday check rides the hourly tick", () => {
  const MONDAY = Date.parse("2026-11-02T15:00:00Z"); // 09:00 Central
  const TUESDAY = Date.parse("2026-11-03T15:00:00Z");

  it("runs once on a Monday, skips other days, and says why", async () => {
    expect(await runBrainsCohesion(env as any, TUESDAY)).toEqual({ ran: false, reason: "not_monday" });
    const first = await runBrainsCohesion(env as any, MONDAY);
    expect(first).toMatchObject({ ran: true, week: "2026-11-02", brains: 9 });
    expect(await runBrainsCohesion(env as any, MONDAY + 3_600_000)).toEqual({ ran: false, reason: "done_this_week" });
  });

  it("one plain line: stale and gaps, or all fresh — never red", async () => {
    await env.DB.prepare(`UPDATE brains SET updated_at = ? WHERE slug = 'porch-and-party'`).bind(MONDAY - 94 * 86_400_000).run();
    const r = await currentCohesion(env as any, MONDAY);
    expect(r.brains_line).toBe("Brains: P&P brain not updated in 94 days · 64 gaps across 8 brains");
    // Rule 0: no Mac record this week — the one line says so, and still carries the stale brain.
    expect(r.line).toMatch(/^Cohesion: the Mac's weekly check did not run this week.*; P&P brain not updated in 94 days$/);
    await env.DB.prepare(`UPDATE brains SET body_md = '# x', updated_at = ?`).bind(MONDAY).run();
    await env.DB.prepare(`DELETE FROM settings WHERE key = ?`).bind(COHESION_KEY).run();
    expect((await apiJson<any>("/api/brains/cohesion")).body.data.line).toMatch(/^Cohesion: /);
    expect((await currentCohesion(env as any, MONDAY)).brains_line).toBe("Brains: all fresh");
    expect((await currentCohesion(env as any, MONDAY)).line).not.toMatch(/all clear/);
  });

  it("the Mac posts its check; this week's record makes the line, last week's never does", async () => {
    const LAST_MONDAY = MONDAY - 7 * 86_400_000;
    await recordMacCohesion(env as any, { strays_moved: [], repos_missing_pointer: [], skills_flagged: [], copy_fresh_after: true, unchecked: [] }, LAST_MONDAY);
    expect((await currentCohesion(env as any, MONDAY)).line).toMatch(/did not run this week/);
    const res = await apiJson<any>("/api/brains/cohesion/mac", { method: "POST", body: { strays_moved: [{ from: "a", to: "b" }], repos_missing_pointer: ["dream-wedding-builder"], skills_flagged: [], copy_fresh_after: true, unchecked: [] } });
    expect(res.status).toBe(200);
    expect(res.body.data.recorded.repos_missing_pointer).toEqual(["dream-wedding-builder"]);
    expect(res.body.data.line).toBe("Cohesion: moved 1 stray memory note to the archive; the dream-wedding-builder repo is missing its brain pointer");
    await recordMacCohesion(env as any, { strays_moved: [], repos_missing_pointer: [], skills_flagged: [], copy_fresh_after: true, unchecked: [] }, MONDAY);
    expect((await currentCohesion(env as any, MONDAY)).line).toBe("Cohesion: all clear");
    expect((await apiJson<any>("/api/brains/cohesion/mac", { method: "POST", body: "nope" })).status).toBe(400);
  });
});
