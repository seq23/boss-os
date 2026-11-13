/**
 * DRIFT PREVENTION (owner, 13 Nov 2026). Every floor check keeps what it measured; the weekly line
 * flags a slide before a floor is missed; the monthly read is filed only with a verdict and a reason.
 * Made-up records only.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { DELIVERABLES, composeQualityRead, driftLine, driftReport, qualityReadsFloor, recordMeasures } from "../../src/worker/boss/duties/drift";
import { deliverQualityReads } from "../../src/worker/boss/duties/deliverReport";
import { jobClassOf, routeOrder } from "../../src/shared/boss/aiRoles.mjs";

const NOW = Date.parse("2026-11-16T14:00:00Z");
const WEEK = 7 * 24 * 3600_000;
const BRIEF = DELIVERABLES[0];
const run = (weeksAgo: number, measured: Record<string, unknown>, pass = true) => ({ at: NOW - weeksAgo * WEEK - 3600_000, pass, route: "bk_claude_code", measured });

describe("the weekly drift line", () => {
  it("a measure more than 25% under its best week two weeks running is flagged, with the numbers", () => {
    const l = driftLine(BRIEF, [run(5, { sources: 30, headlines: 5, sections: 11 }), run(1, { sources: 21, headlines: 5, sections: 11 }), run(0, { sources: 20, headlines: 5, sections: 11 })], NOW);
    expect(l.flagged).toBe(true);
    expect(l.text).toMatch(/Slipping: sources 20 against a best week of 30, two weeks running/);
  });

  it("one soft week is not a flag, and neither is a slide of 25% or less", () => {
    const oneWeek = driftLine(BRIEF, [run(5, { sources: 30, headlines: 5, sections: 11 }), run(1, { sources: 29, headlines: 5, sections: 11 }), run(0, { sources: 20, headlines: 5, sections: 11 })], NOW);
    expect(oneWeek.flagged).toBe(false);
    const small = driftLine(BRIEF, [run(5, { sources: 30, headlines: 5, sections: 11 }), run(1, { sources: 23, headlines: 5, sections: 11 }), run(0, { sources: 23, headlines: 5, sections: 11 })], NOW);
    expect(small.flagged).toBe(false);
    expect(small.text).toMatch(/Holding\./);
  });

  it("one exceptional morning does not flag every ordinary week after it: a week is measured against the best WEEK", () => {
    const day = (daysAgo: number, sources: number) => ({ at: NOW - daysAgo * 24 * 3600_000 - 3600_000, pass: true, route: "bk_claude_code", measured: { sources, headlines: 5, sections: 11 } });
    const runs = [day(30, 52), ...[29, 28, 27, 26].map((d) => day(d, 30)), ...[13, 12, 11, 10, 9].map((d) => day(d, 30)), ...[6, 5, 4, 3, 2, 1, 0].map((d) => day(d, 30))];
    const l = driftLine(BRIEF, runs, NOW);
    expect(l.flagged).toBe(false);
    expect(l.text).toMatch(/^Daily briefing: averaging 30 sources this week, best week 37,/);
  });

  it("a floor miss this week is flagged whatever the trend", () => {
    const l = driftLine(BRIEF, [run(0, { sources: 30, headlines: 4, sections: 11 }, false)], NOW);
    expect(l.flagged).toBe(true);
    expect(l.text).toMatch(/Missed its standard once this week/);
  });

  it("nothing checked this week reads 'not measured', never as fine; a measure nobody recorded is named", () => {
    const none = driftLine(BRIEF, [run(3, { sources: 30 })], NOW);
    expect(none.text).toBe("Daily briefing: not measured this week (no run was checked).");
    const partial = driftLine(BRIEF, [run(0, { sources: 24, headlines: 5, sections: 11, sources_reachable: "not read: no source answered the check at all" })], NOW);
    expect(partial.text).toMatch(/Not measured: sources that open\./);
    expect(partial.text).toMatch(/no earlier week on record yet/);
    expect(partial.measures[0]!.trend).toEqual([null, null, null, 24]);
  });

  it("is read from what the floor checks stored: one row per deliverable, with the route that ran it", async () => {
    await env.DB.exec("DELETE FROM delivery_measures; DELETE FROM quality_reads;");
    await recordMeasures(env, { deliverable: "tool_suggestions", runId: "run_a", route: "bk_codex", now: NOW - 3600_000, verdict: { pass: true, misses: [], measured: { rows: 5, new_rows: 5, links_reachable: 5 } } });
    await recordMeasures(env, { deliverable: "link_prospects", runId: "run_b", route: "bk_claude_code", now: NOW - 7200_000, verdict: { pass: false, misses: ["it delivered zero prospects"], measured: { rows: 0, new_rows: 0 } } });
    const r = await driftReport(env, NOW);
    expect(r.lines.map((l) => l.deliverable)).toEqual(DELIVERABLES.map((d) => d.key));
    const tools = r.lines.find((l) => l.deliverable === "tool_suggestions")!;
    expect(tools).toMatchObject({ flagged: false, runs_this_week: 1, routes: ["bk_codex"] });
    expect(tools.text).toMatch(/^Tools worth knowing: 5 new tools this week/);
    expect(r.lines.find((l) => l.deliverable === "link_prospects")!.flagged).toBe(true);
    expect(r.lines.find((l) => l.deliverable === "executive_reports")!.text).toMatch(/not measured this week/);
  });
});

describe("the monthly read", () => {
  beforeEach(async () => { await env.DB.exec("DELETE FROM delivery_measures; DELETE FROM quality_reads; DELETE FROM executive_reports; DELETE FROM tool_suggestions;"); });

  it("is hard work: Claude's seat first, Codex's as the backup, and no free route", () => {
    const cls = jobClassOf({ intakeKind: "review", delivers: "quality_reads" });
    for (const privateWork of [false, true]) {
      const routes = routeOrder({ jobClass: cls, privateWork }).routes;
      expect(routes[0]).toBe("claude");
      expect(routes.filter((r: string) => r !== "claude" && r !== "codex")).toEqual([]);
    }
  });

  it("nothing on record: there is no read to ask for", async () => {
    expect(await composeQualityRead(env)).toBeNull();
  });

  it("asks for a read of each deliverable that has a real output, beside the best one on record", async () => {
    const item = (h: string) => ({ key: "top_5_headlines", items: [{ headline: h, why_it_matters: "Because the example fund repriced its example stake." }] });
    for (const [day, status, head, n] of [["2026-11-02", "complete", "The sharp example headline", 30], ["2026-11-13", "partial", "The newest example headline", 12]] as const) {
      await env.DB.prepare(`INSERT INTO executive_reports (id, day_id, generated_at, status, sections, sources) VALUES (?,?,?,?,?,?)`)
        .bind(`rep_${day}`, day, NOW, status, JSON.stringify([item(head)]), JSON.stringify(Array.from({ length: n }, (_, i) => ({ url: `https://news.example/${i}` })))).run();
    }
    const ask = (await composeQualityRead(env))!;
    expect(ask.expect).toEqual(["executive_reports"]);
    expect(ask.prompt.indexOf("The newest example headline")).toBeLessThan(ask.prompt.indexOf("The sharp example headline"));
    expect(ask.prompt).toMatch(/Day 2026-11-13: 1 sections, 12 sources/);
  });

  it("a read counts only with a verdict and a checkable reason for every deliverable handed over", async () => {
    const why = "The reasoning names the buyer, the price and what changes for her, as the best example does.";
    expect(qualityReadsFloor(null, ["executive_reports"]).pass).toBe(false);
    expect(qualityReadsFloor({ reads: [{ deliverable: "executive_reports", verdict: "fine", why }] }, ["executive_reports"]).pass).toBe(false);
    expect(qualityReadsFloor({ reads: [{ deliverable: "executive_reports", verdict: "holds", why: "Good." }] }, ["executive_reports"]).pass).toBe(false);
    const short = qualityReadsFloor({ reads: [{ deliverable: "executive_reports", verdict: "holds", why }] }, ["executive_reports", "tool_suggestions"]);
    expect(short).toMatchObject({ pass: false, misses: ["no read for tool_suggestions"] });
    const payload = { reads: [{ deliverable: "executive_reports", verdict: "holds", why }, { deliverable: "tool_suggestions", verdict: "slipped", why: "Three of the five tools repeat last month's list and carry no independent evidence." }] };
    expect(qualityReadsFloor(payload, ["executive_reports", "tool_suggestions"])).toMatchObject({ pass: true, measured: { reads: 2, slipped: 1 } });

    await env.DB.prepare(`INSERT INTO tasks (id, lane, title, input, status, created_at) VALUES ('tsk_read', 'ops', 'Monthly quality read', ?, 'running', ?)`).bind(JSON.stringify({ delivers: "quality_reads" }), NOW).run();
    expect(await deliverQualityReads(env as any, { taskId: "tsk_read", runId: "run_read", payload, route: "bk_claude_code", now: NOW - 3600_000 })).toEqual({ inserted: 2 });
    const r = await driftReport(env, NOW);
    expect(r.reads.map((x) => [x.label, x.verdict])).toEqual([["Daily briefing", "holds"], ["Tools worth knowing", "slipped"]]);
    expect((await driftReport(env, NOW + 2 * WEEK)).reads).toEqual([]); // shown for the week after it lands, then not again
  });
});
