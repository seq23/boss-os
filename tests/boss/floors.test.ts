import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { briefingFloor } from "../../src/worker/boss/duties/briefingSpec";
import { honestNothingNew, researchPageFloor, rowsFloor, sourcesReachable } from "../../src/worker/boss/duties/floors";
import { deliverExecutiveReport } from "../../src/worker/boss/duties/deliverReport";
import { seatFailedTwice } from "../../src/worker/boss/duties/seatOrder";
import { readResearchDelivery } from "../../src/shared/boss/research/page.mjs";
import { briefingArrivingBy, BRIEFING_RUN_MS } from "../../src/worker/boss/routes/today";
import { all, api, row, stubFetch, uid } from "./helpers";
import STANDARD from "../fixtures/briefing/standard-2026-10-22.delivers.json";
import BELOW from "../fixtures/briefing/below-2026-10-27.delivers.json";
import TOOLS from "../fixtures/floors/tools-2026-10-15.json";
import SOURCING from "../fixtures/floors/sourcing-2026-10-21.json";
import RESEARCH from "../fixtures/floors/research-2026-11-06.json";

/**
 * THE FLOORS (owner, 13 Nov 2026): "i want all of this to be perfect figure out how ot make sure my
 * briefs get wrriten to the impeccable standard we have had".
 *
 * The review found that nothing checked the finished work: a half-depth briefing wore the same
 * "partial" every good day wore, backlink prospecting "succeeded" every week with zero rows ever, a
 * tools run lost 23 tools to an invalid delivers.json and was auto-accepted, and three research
 * pages were stored "delivered" with no source. Each floor below is proven against the real day it
 * would have caught and the real run that sets the standard (tests/fixtures; private ones masked).
 */

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });
const answers = (status: (url: string) => number) => { restore = stubFetch((req) => new Response("x", { status: status(req.url) })); };

const NOW = Date.now();
async function seats() {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', spent_micros = 0, window_started_at = NULL, exhausted_until = NULL, exhausted_reason = NULL WHERE id IN ('bk_claude_code','bk_codex')`).run();
}
async function task(input: Record<string, unknown>) {
  const id = uid("tsk");
  await env.DB.prepare(`INSERT INTO tasks (id, lane, title, input, status, created_at) VALUES (?, 'ops', 'A duty run', ?, 'running', ?)`)
    .bind(id, JSON.stringify({ duty_id: "duty_test", ...input }), NOW).run();
  return id;
}
async function run(taskId: string, seat: string, ladder: string[], jobClass = "short") {
  const id = uid("brn");
  await env.DB.prepare(`INSERT INTO backend_runs (id, task_id, backend_id, envelope_id, requested, cost_micros, started_at, status) VALUES (?,?,?,NULL,?,0,?, 'running')`)
    .bind(id, taskId, seat, JSON.stringify({ backend_ladder: ladder, job_class: jobClass }), Date.now()).run();
  return id;
}
const report = async (runId: string, taskId: string, seat: string, extra: Record<string, unknown>) => {
  const res = await api("/api/backends/report", {
    method: "POST",
    body: { device_id: "dev_test", evidence: {
      run_id: runId, task_id: taskId, backend_id: seat, status: "succeeded", summary: "Done.", files_touched: [], commands: [],
      checks_run: { run: 0, passed: 0, failed: 0, detail: [] }, remaining_risks: [], violations: [], rollback_ref: null, refusal_reason: null,
      error: null, cost_micros: 0, started_at: NOW, finished_at: NOW + 1000, seat_exhausted: null, ...extra,
    } },
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as any).data;
};

describe("the briefing floor, on the real days", () => {
  it("passes the standard (22 Oct 2026) and says what it counted", () => {
    const v = briefingFloor(STANDARD);
    expect(v).toMatchObject({ pass: true, misses: [], measured: { sections: 11, headlines: 5, gaps: 0 } });
    expect(Number(v.measured.sources)).toBeGreaterThanOrEqual(20);
    expect(Number(v.measured.why_chars)).toBeGreaterThanOrEqual(1000);
  });

  it("FAILS a real half-depth briefing (27 Oct 2026) that had every section, five headlines and 22 sources", () => {
    const v = briefingFloor(BELOW);
    expect(v.pass).toBe(false);
    expect(v.measured).toMatchObject({ sections: 11, headlines: 5 });
    expect(v.misses.join(" | ")).toMatch(/reasoning under each headline is thinner than usual \(about \d+ characters/);
    expect(v.misses.join(" | ")).toMatch(/6 things could not be verified/);
  });

  it("catches each shortfall on its own, a headline carried over word for word, and sources that do not open", () => {
    const cut = (mut: (f: any) => void) => { const f = JSON.parse(JSON.stringify(STANDARD)); mut(f); return briefingFloor(f); };
    const top = (f: any) => f.sections.find((x: any) => x.key === "top_5_headlines");
    expect(cut((f) => { top(f).items.pop(); }).misses).toEqual(["4 of 5 headlines"]);
    expect(cut((f) => { f.sources = f.sources.slice(0, 19); }).misses).toEqual(["19 sources (the standard is 20)"]);
    expect(cut((f) => { f.sections = f.sections.filter((x: any) => x.key !== "key_events"); }).misses).toEqual(["10 of 11 sections are filled to depth"]);
    expect(cut((f) => { f.gaps = [1, 2, 3, 4].map((i) => ({ wanted: `thing ${i}` })); }).misses).toEqual(["4 things could not be verified (the standard allows 3)"]);
    expect(cut((f) => { f.gaps = [1, 2, 3].map((i) => ({ wanted: `thing ${i}` })); }).pass, "three honest gaps are within the standard").toBe(true);
    // A local file path is not a source: it never counts toward the twenty.
    expect(cut((f) => { f.sources = f.sources.map((x: any, i: number) => (i < 10 ? { ...x, url: `/Users/someone/notes-${i}.md` } : x)); }).pass).toBe(false);

    const yesterday = top(STANDARD as any).items.map((h: any) => h.headline);
    expect(briefingFloor(STANDARD, { previousHeadlines: yesterday }).misses).toEqual(["5 headlines repeat the last briefing word for word"]);
    expect(briefingFloor(STANDARD, { previousHeadlines: ["Something else entirely"] }).pass).toBe(true);

    expect(briefingFloor(STANDARD, { reach: { reachable: 9, answered: 27, checked: 27 } }).misses[0]).toMatch(/only 9 of 27 sources opened/);
    expect(briefingFloor(STANDARD, { reach: { reachable: 22, answered: 27, checked: 27 } }).pass).toBe(true);
    // The check that could not see says so; it is never read as "every source is dead", nor as a count.
    const blind = briefingFloor(STANDARD, { reach: { reachable: 0, answered: 0, checked: 27 } });
    expect(blind.pass).toBe(true);
    expect(blind.measured.sources_reachable).toMatch(/^not read:/);
  });
});

describe("does a cited source answer a plain GET?", () => {
  it("a bot wall's 403 and a 429 count; 404, 410, a server error and a silence do not; a file path is never fetched", async () => {
    const asked: string[] = [];
    restore = stubFetch((req) => {
      asked.push(req.url);
      const code = Number(new URL(req.url).pathname.slice(1));
      if (code === 0) throw new Error("no route to host");
      return new Response("x", { status: code });
    });
    const out = await sourcesReachable([
      "https://a.example.com/200", "https://b.example.com/403", "https://c.example.com/429", "https://d.example.com/404",
      "https://e.example.com/410", "https://f.example.com/503", "https://g.example.com/0",
      "/Users/someone/PROPERTIES.json", "file:///tmp/notes.md", "notes.md", 7, null,
    ]);
    expect(out).toMatchObject({ reachable: 3, answered: 6, checked: 7 });
    expect(out.dead.map((u) => new URL(u).pathname).sort()).toEqual(["/0", "/404", "/410", "/503"]);
    expect(asked.every((u) => u.startsWith("https://"))).toBe(true);
  });

  it("stops asking once enough have answered, and never asks more than its cap", async () => {
    let n = 0;
    restore = stubFetch(() => { n++; return new Response("x"); });
    await sourcesReachable(Array.from({ length: 60 }, (_, i) => `https://s${i}.example.com/a`), { need: 15 });
    expect(n).toBeLessThanOrEqual(16);
    n = 0;
    restore?.(); restore = stubFetch(() => { n++; return new Response("x", { status: 404 }); });
    await sourcesReachable(Array.from({ length: 60 }, (_, i) => `https://s${i}.example.com/a`), { need: 15 });
    expect(n).toBe(40);
  });
});

describe("the list floors: tools, backlink prospects, brokerage sourcing", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM tool_suggestions`).run();
    await env.DB.prepare(`DELETE FROM link_prospects`).run();
    await env.DB.prepare(`DELETE FROM sourcing_candidates WHERE name LIKE 'Masked %'`).run();
  });

  it("passes the real tools run of 15 Oct 2026 (13 tools)", async () => {
    answers(() => 200);
    const v = await rowsFloor(env as any, "tool_suggestions", TOOLS as any);
    expect(v).toMatchObject({ pass: true, measured: { rows: 13, new_rows: 13 } });
  });

  it("FAILS what 12 Nov 2026 delivered: an invalid delivers.json reaches this side as nothing at all", async () => {
    const v = await rowsFloor(env as any, "tool_suggestions", null, { why: "delivers.json could not be read: Unexpected token" });
    expect(v!.pass).toBe(false);
    expect(v!.misses[0]).toMatch(/no readable delivers\.json reached Boss OS \(delivers\.json could not be read/);
  });

  it("FAILS what backlink prospecting delivered every week: zero prospects (\"missing PROPERTIES.json\")", async () => {
    for (const payload of [{ prospects: [] }, {}, { status: "partial", gaps: ["blocked: missing PROPERTIES.json"] }, { prospects: [{ url: "", property: "" }] }]) {
      const v = await rowsFloor(env as any, "link_prospects", payload as any);
      expect(v!.pass, JSON.stringify(payload)).toBe(false);
      expect(v!.misses[0]).toMatch(/^it delivered zero prospects/);
    }
  });

  it("a row already on the list is last run's item repeated, never new work", async () => {
    answers(() => 200);
    const three = { tools: (TOOLS as any).tools.slice(0, 3) };
    expect((await rowsFloor(env as any, "tool_suggestions", three))!.pass).toBe(true);
    for (const t of three.tools) {
      await env.DB.prepare(`INSERT INTO tool_suggestions (id, name, url, serves, what_it_does, free_tier, status, run_id, created_at, updated_at) VALUES (?,?,?,'ops',?,0,'new','brn_before',?,?)`)
        .bind(uid("tol"), t.name, t.url, t.what_it_does, NOW, NOW).run();
    }
    const again = await rowsFloor(env as any, "tool_suggestions", three);
    expect(again).toMatchObject({ pass: false, measured: { rows: 3, new_rows: 0 } });
    expect(again!.misses[0]).toMatch(/0 new tools \(the floor is 3\); 3 repeated the list as it stood/);
  });

  it("new rows whose links do not open are a miss; a check that could not see says so and is not a miss", async () => {
    const three = { tools: (TOOLS as any).tools.slice(3, 6) };
    answers(() => 404);
    const dead = await rowsFloor(env as any, "tool_suggestions", three);
    expect(dead!.pass).toBe(false);
    expect(dead!.misses[0]).toMatch(/only 0 of 3 new tool links opened/);
    restore?.(); restore = null; // the network is off: nothing answers at all
    const blind = await rowsFloor(env as any, "tool_suggestions", three);
    expect(blind!.pass).toBe(true);
    expect(blind!.measured.links_reachable).toMatch(/^not read:/);
  });

  it("sourcing: the standard run passes; zero candidates is a miss unless the search is on record", async () => {
    answers(() => 200);
    expect(await rowsFloor(env as any, "sourcing_candidates", SOURCING as any)).toMatchObject({ pass: true, measured: { rows: 1, new_rows: 1 } });
    const none = await rowsFloor(env as any, "sourcing_candidates", { candidates: [] });
    expect(none!.pass).toBe(false);
    expect(none!.misses[0]).toMatch(/zero candidates \(and did not say what it searched\)/);

    const weak = { candidates: [], nothing_new: { searches: ["one query"], considered: [] } };
    expect(honestNothingNew("sourcing_candidates", weak)).toMatchObject({ ok: false });
    expect((await rowsFloor(env as any, "sourcing_candidates", weak))!.misses[0]).toMatch(/1 searches run, 0 firms considered/);

    const honest = { candidates: [], nothing_new: {
      searches: ["q1", "q2", "q3", "q4", "q5"],
      considered: [{ name: "Masked Buyer B", why_not: "already on the list" }, { name: "Masked Buyer C", why_not: "below the ticket floor" }, { name: "Masked Buyer D", why_not: "no source" }],
    } };
    const ok = await rowsFloor(env as any, "sourcing_candidates", honest);
    expect(ok!.pass).toBe(true);
    expect(ok!.measured.nothing_new).toMatch(/5 searches run, 3 firms considered and turned down/);
    // "Nothing new" is a sourcing answer only: no other list may pass on words.
    expect((await rowsFloor(env as any, "link_prospects", { prospects: [], nothing_new: honest.nothing_new }))!.pass).toBe(false);
  });
});

describe("the research page floor", () => {
  it("passes the standard page (6 Nov 2026, 16 sources); a page with no source, a file path, or only dead links is a miss", async () => {
    answers(() => 200);
    const std = readResearchDelivery(RESEARCH);
    expect(std.ok).toBe(true);
    expect(await researchPageFloor((std as any).page, null)).toMatchObject({ pass: true, measured: { sources: 16 } });

    const bare = readResearchDelivery({ ...RESEARCH, research_page: { ...(RESEARCH as any).research_page, sources: [] } });
    expect((await researchPageFloor((bare as any).page, null)).misses).toEqual(["the page cites no source"]);
    const local = readResearchDelivery({ ...RESEARCH, research_page: { ...(RESEARCH as any).research_page, sources: [{ title: "Notes", url: "/Users/someone/notes.md" }] } });
    expect((await researchPageFloor((local as any).page, null)).pass).toBe(false);
    restore?.(); answers(() => 404);
    expect((await researchPageFloor((std as any).page, null)).misses[0]).toMatch(/none of its \d+ sources opened/);
    expect((await researchPageFloor(null, "the run's delivers.json carried no research_page object")).pass).toBe(false);
  });
});

describe("a missed floor at the door (/api/backends/report)", () => {
  beforeEach(async () => {
    await seats();
    await env.DB.prepare(`DELETE FROM link_prospects`).run();
    await env.DB.prepare(`DELETE FROM tool_suggestions`).run();
    await env.DB.prepare(`DELETE FROM executive_reports`).run();
  });

  it("zero rows from the weaker seat hands the run UP to the stronger seat, by name; zero from the last seat is a FAILED task, never accepted", async () => {
    const taskId = await task({ delivers: "link_prospects" });
    const runId = await run(taskId, "bk_codex", ["bk_codex", "bk_claude_code"]);
    const first = await report(runId, taskId, "bk_codex", { summary: "Blocked: missing PROPERTIES.json.", delivers: { prospects: [] } });
    expect(first).toMatchObject({ released: true, next_seat: "bk_claude_code" });
    const ev = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'ladder_release'`, taskId);
    expect(JSON.parse(ev.detail)).toMatchObject({ from: "bk_codex", next: "bk_claude_code", exhausted_until: null });
    expect(JSON.parse(ev.detail).why).toMatch(/NAMED STOP \[FLOOR_MISSED\] link_prospects is below its floor: it delivered zero prospects/);
    expect((await row<any>(`SELECT status, backend_id FROM backend_runs WHERE id = ?`, runId))).toMatchObject({ status: "running", backend_id: "bk_claude_code" });

    const last = await report(runId, taskId, "bk_claude_code", { delivers: { prospects: [] } });
    expect(last.released).not.toBe(true);
    const done = await row<any>(`SELECT status, error FROM backend_runs WHERE id = ?`, runId);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/^NAMED STOP \[FLOOR_MISSED\]/);
    const t = await row<any>(`SELECT status, error FROM tasks WHERE id = ?`, taskId);
    expect(t.status).toBe("failed");
    expect(t.error).toMatch(/^NAMED STOP \[FLOOR_MISSED\] link_prospects is below its floor/);
    expect(await all<any>(`SELECT 1 FROM task_events WHERE task_id = ? AND event = 'auto_accepted'`, taskId)).toEqual([]);
  });

  it("a miss never moves a job DOWN: the stronger seat's miss is not handed to the weaker one", async () => {
    const taskId = await task({ delivers: "link_prospects" });
    const runId = await run(taskId, "bk_claude_code", ["bk_claude_code", "bk_codex"]);
    const out = await report(runId, taskId, "bk_claude_code", { delivers: { prospects: [] } });
    expect(out.released).not.toBe(true);
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, runId)).status).toBe("failed");
  });

  it("two misses in a row count against that seat for that kind of job, and a pass clears it", async () => {
    const cls = `floor_test_${uid("c")}`;
    for (let i = 0; i < 2; i++) {
      const taskId = await task({ delivers: "tool_suggestions" });
      const runId = await run(taskId, "bk_codex", ["bk_codex"], cls);
      await report(runId, taskId, "bk_codex", { delivers: { tools: [] } });
    }
    expect(await seatFailedTwice(env.DB, "bk_codex", cls)).toBe(true);
    const taskId = await task({ delivers: "tool_suggestions" });
    const runId = await run(taskId, "bk_codex", ["bk_codex"], cls);
    await report(runId, taskId, "bk_codex", { delivers: { tools: (TOOLS as any).tools.slice(0, 4) } });
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, runId)).status).toBe("succeeded");
    expect(await seatFailedTwice(env.DB, "bk_codex", cls)).toBe(false);
  });

  it("the rows that ARE real are kept even when the run misses its floor", async () => {
    const taskId = await task({ delivers: "tool_suggestions" });
    const runId = await run(taskId, "bk_claude_code", ["bk_claude_code"]);
    await report(runId, taskId, "bk_claude_code", { delivers: { tools: (TOOLS as any).tools.slice(0, 2) } });
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("failed");
    expect(await all<any>(`SELECT 1 FROM tool_suggestions WHERE run_id = ?`, runId)).toHaveLength(2);
  });

  it("the briefing: a half-depth day is delivered as the best attempt under a named stop; the standard is 'complete'; the better one stands", async () => {
    // The half-depth day, from the only seat on its ladder: the run FAILS, the briefing is still hers to read.
    const t1 = await task({ delivers: "executive_reports" });
    const r1 = await run(t1, "bk_codex", ["bk_claude_code", "bk_codex"], "hard");
    await report(r1, t1, "bk_codex", { delivers: { ...BELOW, day_id: "2026-10-22" } });
    const below = await row<any>(`SELECT status, shortfalls, floor, backend_run_id FROM executive_reports WHERE day_id = '2026-10-22'`);
    expect(below.status).toBe("partial");
    expect(JSON.parse(below.shortfalls)[0]).toMatch(/^Below the standard today: the reasoning under each headline is thinner than usual \(about \d+ characters.*6 things could not be verified/);
    expect(JSON.parse(below.floor).pass).toBe(false);
    const failedRun = await row<any>(`SELECT status, error FROM backend_runs WHERE id = ?`, r1);
    expect(failedRun.status).toBe("failed");
    expect(failedRun.error).toMatch(/^NAMED STOP \[FLOOR_MISSED\] the briefing is below its floor/);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, t1)).status).toBe("done");
    expect(await all<any>(`SELECT 1 FROM task_events WHERE task_id = ? AND event = 'delivered_below_floor'`, t1)).toHaveLength(1);
    expect(await all<any>(`SELECT 1 FROM task_events WHERE task_id = ? AND event = 'auto_accepted'`, t1)).toEqual([]);

    // The standard arrives for the same day: it replaces the best attempt, and it is "complete".
    const t2 = await task({ delivers: "executive_reports" });
    const r2 = await run(t2, "bk_claude_code", ["bk_claude_code", "bk_codex"], "hard");
    await report(r2, t2, "bk_claude_code", { delivers: STANDARD });
    const good = await row<any>(`SELECT status, shortfalls, floor, backend_run_id FROM executive_reports WHERE day_id = '2026-10-22'`);
    expect(good).toMatchObject({ status: "complete", backend_run_id: r2 });
    expect(JSON.parse(good.shortfalls).join(" ")).not.toMatch(/Below the standard/);
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, r2)).status).toBe("succeeded");

    // A later half-depth attempt, or a failed run, never overwrites it.
    const out: any = {};
    await deliverExecutiveReport(env as any, { taskId: t1, runId: r1, runStatus: "succeeded", report: { ...BELOW, day_id: "2026-10-22" } as any, out });
    expect(out.kept_earlier).toBe(true);
    await deliverExecutiveReport(env as any, { taskId: t1, runId: r1, runStatus: "failed", report: null });
    expect(await row<any>(`SELECT status, backend_run_id FROM executive_reports WHERE day_id = '2026-10-22'`)).toMatchObject({ status: "complete", backend_run_id: r2 });
  });
});

describe("when a late briefing is expected (for the morning email's \"arriving by\")", () => {
  const at = Date.parse("2026-11-13T13:45:00Z"); // 07:45 Central
  it("a running run lands a run's length after it started; one waiting for usage, a run's length after the seat is back", () => {
    const started = Date.parse("2026-11-13T13:00:00Z");
    expect(briefingArrivingBy({ task_status: "running", task_created_at: started }, at)).toBe(Date.parse("2026-11-13T14:15:00Z"));
    const reset = Date.parse("2026-11-13T15:00:00Z");
    expect(briefingArrivingBy({ task_status: "queued", task_created_at: started, task_resume_at: reset }, at)).toBe(reset + BRIEFING_RUN_MS);
  });
  it("is never in the past, and is null when no run is on its way", () => {
    const longAgo = Date.parse("2026-11-13T10:00:00Z");
    expect(briefingArrivingBy({ task_status: "running", task_created_at: longAgo }, at)).toBe(Date.parse("2026-11-13T14:00:00Z"));
    for (const status of ["failed", "cancelled", "done", null]) expect(briefingArrivingBy({ task_status: status, task_created_at: longAgo }, at), String(status)).toBeNull();
    expect(briefingArrivingBy(null, at)).toBeNull();
  });
});


/** The run is told how it is checked (13 Nov 2026): the floor is only fair if the run knows it. */
describe("a row-delivering duty's task carries the delivery rules", () => {
  it("sourcing is told how to file an honest nothing-new, and that record then passes the floor", async () => {
    const { deliveryRules, honestNothingNew, NOTHING_NEW_FLOOR } = await import("../../src/worker/boss/duties/floors");
    const rules = deliveryRules("sourcing_candidates")!;
    expect(rules).toContain('"nothing_new"');
    const record = { nothing_new: { searches: Array.from({ length: NOTHING_NEW_FLOOR.searches }, (_, i) => `query ${i}`), considered: Array.from({ length: NOTHING_NEW_FLOOR.considered }, (_, i) => ({ name: `Firm ${i}`, why_not: "already on the list" })) } };
    expect(honestNothingNew("sourcing_candidates", record).ok).toBe(true);
    expect(honestNothingNew("sourcing_candidates", { gaps: [{ wanted: "nothing new today", why: "" }] }).ok).toBe(false);
    expect(deliveryRules("executive_reports")).toBeNull();
    expect(deliveryRules("tool_suggestions")).not.toContain("nothing_new");
  });

  it("the materialised task's prompt ends with them, for the repo's prompt and for her own edit", async () => {
    const { materialiseDueDuties } = await import("../../src/worker/boss/duties/materialise");
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(`UPDATE standing_duties SET suspended = 1`).run();
    for (const edit of [null, "Find tools for the brokerage only."]) {
      await env.DB.prepare(`DELETE FROM tasks WHERE id IN (SELECT last_task_id FROM standing_duties WHERE id = 'duty_tool_scout')`).run();
      await env.DB.prepare(`UPDATE standing_duties SET next_due_at = 0, suspended = 0, last_run_at = NULL, owner_prompt = ? WHERE id = 'duty_tool_scout'`).bind(edit).run();
      const out = await materialiseDueDuties(env as any, Date.parse("2026-11-16T15:00:00Z"));
      expect(out.fired.map((f: { duty: string }) => f.duty)).toContain("duty_tool_scout");
      const t = await env.DB.prepare(`SELECT input AS input_json FROM tasks WHERE id = (SELECT last_task_id FROM standing_duties WHERE id = 'duty_tool_scout')`).first<{ input_json: string }>();
      const prompt = String(JSON.parse(t!.input_json).prompt);
      expect(prompt).toMatch(/read the file back and parse it/);
      expect(prompt).toMatch(/at least 3 new/);
      if (edit) expect(prompt.startsWith(edit)).toBe(true);
    }
  });
});
