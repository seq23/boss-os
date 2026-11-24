/**
 * THE AI ANSWERS LOOP, THE PURE HALF (her ask 22 Nov 2026; rules in src/shared/boss/growth/aiAnswers.mjs).
 * HOW IT BREAKS, each proven here (the D1 half is tests/boss/aiAnswers.test.ts):
 *   - outage: every OpenSEO stop, a short read, a summary that disagrees, a plugin that did not load and
 *     bad JSON for one site are "not read" for THAT site, never 0 or "no misses";
 *   - money: unread or moved credits, an unread or over-plan estimate are named stops;
 *   - abuse: a page off the host, off the engine prefix or missing from the sitemap is never served;
 *   - the card and the scoreboard measure: a 6-day-old week shows its number, a 9-day-old one and a
 *     newer not-read week are "not read".
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_SITES, ENGINES, aiCard, creditsProblem, domainOf, expectedWeek, isoWeek, missId, openseoReached, pageOnHost, planProblem, readSite, sessionTranscript,
} from "../src/shared/boss/growth/aiAnswers.mjs";
import { entriesFrom, parseRun, post, prefixFrom, sitePages, buildContext, transcriptText } from "../scripts/ops/ai-visibility-report.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { strengthenedOf } from "../src/shared/boss/searchLoop/week.mjs";
import { d1Sql } from "../scripts/ops/lib/scorecard-readers.mjs";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-24T18:00:00Z"); // Tue 24 Nov 2026, 12:00 Central
const RUN_AT = Date.parse("2026-11-24T04:00:00Z");
const HOST = "keepmyproof.com";
const PREFIX = "/questions/";
const Q1 = "https://keepmyproof.com/questions/rent-receipts/";
const ABOUT = "https://keepmyproof.com/about/";

type Over = { cited?: (p: string, e: string) => boolean; mentioned?: (p: string, e: string) => boolean; status?: (p: string, e: string) => string };
/** A whole, honest block: 2 prompts × 3 engines, p1 cited on chatgpt, p2 cited nowhere. */
function block(host = HOST, o: Over = {}, runAt = RUN_AT): any {
  const prompts = [{ id: "p1", text: "best app to keep proof of rent payments" }, { id: "p2", text: "how to prove I paid rent in cash" }];
  const cited = o.cited ?? ((p, e) => p === "p1" && e === "chatgpt");
  const mentioned = o.mentioned ?? ((p) => p === "p1");
  const status = o.status ?? (() => "answered");
  const observations = prompts.flatMap((p) => ENGINES.map((e) => ({
    id: `${p.id}-${e}`, prompt_id: p.id, engine: e, status: status(p.id, e),
    mentioned: mentioned(p.id, e), cited: cited(p.id, e), rivals: ["https://www.rival.com/x"], sources: ["review-site.com", `https://${host}/x`],
  })));
  const ans = observations.filter((x) => x.status === "answered");
  return {
    site: host, tracker: { prompts, engines: [...ENGINES] },
    run: { id: "run-1", createdAt: new Date(runAt).toISOString(), expected: 6, completed: observations.filter((x) => x.status !== "failed").length, failed: observations.filter((x) => x.status === "failed").length },
    summary_own: { mentions: ans.filter((x) => x.mentioned).length, citations: ans.filter((x) => x.cited).length },
    observations,
    lanes: [{ prompt_id: "p2", lane: "own", page_url: Q1, fit_url: null, source_domain: null, channel: null, why: "the rent page could answer it" }],
  };
}
const PAGES = { engine: new Set([Q1]), all: new Set([Q1, ABOUT]) };
const read = (b: any, o: any = {}) => readSite(b, { host: HOST, now: NOW, prefix: PREFIX, pages: PAGES, ...o });

describe("readSite: one site's week, recounted", () => {
  it("a whole block is read and every count is the code's own", () => {
    const r: any = read(block());
    expect(r.status).toBe("read");
    expect(r.week).toBe("2026-W48");
    expect([r.prompts, r.answered, r.cited, r.mentioned]).toEqual([2, 2, 1, 1]);
    expect(r.engines.chatgpt).toEqual({ answered: 2, mentioned: 1, cited: 1 });
    expect(r.misses.map((m: any) => [m.prompt_id, m.lane, m.page_url])).toEqual([["p2", "own", Q1]]);
    // Domains only, and never our own host as a "source" or a rival.
    expect(r.misses[0].cited_sources).toEqual(["review-site.com"]);
    expect(r.misses[0].rivals).toEqual(["rival.com"]);
    expect(JSON.stringify(r)).not.toMatch(/https:\/\/www\.rival/);
  });

  it.each([
    "OPENSEO_UNREACHABLE", "OPENSEO_CREDITS", "OPENSEO_NO_TRACKER", "OPENSEO_NOT_YET", "OPENSEO_NO_ANSWERS", "PLUGIN_NOT_LOADED",
  ])("the session's stop %s is not read, never zero", (stop) => {
    const r: any = read({ site: HOST, stop });
    expect(r).toMatchObject({ status: "not_read", stop });
    expect(r.cited).toBeUndefined();
  });

  it("an unknown stop, another site's block, a non-object are refused as a bad reply", () => {
    expect(read({ site: HOST, stop: "ALL_FINE" })).toMatchObject({ status: "not_read", stop: "OPENSEO_BAD_REPLY" });
    expect(read(block("approvalprep.com"))).toMatchObject({ status: "not_read", stop: "OPENSEO_BAD_REPLY" });
    expect(read([])).toMatchObject({ status: "not_read", stop: "OPENSEO_BAD_REPLY" });
  });

  it("a short read (an observation missing) is not read", () => {
    const b = block(); b.observations.pop();
    expect(read(b)).toMatchObject({ status: "not_read", stop: "OPENSEO_SHORT_READ" });
    // Even when the run's own count agrees with the shorter list: every prompt × engine or nothing.
    const c = block(); const gone = c.observations.pop(); c.run.completed -= 1;
    if (gone.cited) c.summary_own.citations -= 1;
    if (gone.mentioned) c.summary_own.mentions -= 1;
    expect(read(c)).toMatchObject({ status: "not_read", stop: "OPENSEO_SHORT_READ" });
  });
  it("a repeated observation is not read (counts are never padded)", () => {
    const b = block(); b.observations[5] = { ...b.observations[0], id: "dup" };
    expect(read(b)).toMatchObject({ status: "not_read", stop: "OPENSEO_SHORT_READ" });
  });
  it("expected that is not prompts × engines is a short read", () => {
    const b = block(); b.run.expected = 4;
    expect(read(b)).toMatchObject({ status: "not_read", stop: "OPENSEO_SHORT_READ" });
  });
  it("OpenSEO's own summary disagreeing with the recount is refused (made-up counts)", () => {
    const b = block(); b.summary_own.citations = 3;
    expect(read(b)).toMatchObject({ status: "not_read", stop: "OPENSEO_SHORT_READ" });
  });
  it("too few answers back is OPENSEO_NO_ANSWERS, never a week of zeros", () => {
    const b = block("keepmyproof.com", { status: (p, e) => (e === "chatgpt" ? "answered" : "failed") });
    expect(read(b)).toMatchObject({ status: "not_read", stop: "OPENSEO_NO_ANSWERS" });
  });
  it("a run 9 days old is OPENSEO_NOT_YET; 6 days old is read", () => {
    expect(read(block(HOST, {}, NOW - 9 * DAY))).toMatchObject({ status: "not_read", stop: "OPENSEO_NOT_YET" });
    expect(read(block(HOST, {}, NOW - 6 * DAY))).toMatchObject({ status: "read" });
  });
  it("the week stamp is the run's own date, not the read's", () => {
    const r: any = read(block(HOST, {}, Date.parse("2026-11-22T23:00:00Z")));
    expect(r.week).toBe("2026-W47");
    expect(isoWeek(NOW)).toBe("2026-W48");
  });
  it("a prompt carrying an email address is refused (no names, no addresses)", () => {
    const b = block(); b.tracker.prompts[0].text = "ask someone@example.com";
    expect(read(b)).toMatchObject({ status: "not_read", stop: "OPENSEO_BAD_REPLY" });
  });
  it("a prompt no engine answered is unknown, not a miss", () => {
    const b = block(HOST, { status: (p) => (p === "p2" ? "no_answer" : "answered") });
    const r: any = read(b);
    expect(r.status).toBe("read");
    expect(r.misses).toEqual([]);
  });
});

describe("the week a read with no run of its own belongs to", () => {
  it("is the newest Tuesday 04:00 UTC run's week, never the calendar week it ran in", () => {
    expect(expectedWeek(Date.parse("2026-11-24T04:00:00Z"))).toBe(isoWeek(Date.parse("2026-11-24T04:00:00Z")));
    expect(expectedWeek(Date.parse("2026-11-24T03:59:59Z"))).toBe(isoWeek(Date.parse("2026-11-17T04:00:00Z")));
    // A by-hand rerun the next Monday is still last Tuesday's week, not the new ISO week.
    expect(expectedWeek(Date.parse("2026-11-30T15:00:00Z"))).toBe("2026-W48");
    expect(isoWeek(Date.parse("2026-11-30T15:00:00Z"))).toBe("2026-W49");
    // The year's turn: Tue 29 Dec 2026 is ISO 2026-W53; Mon 4 Jan 2027 belongs to it.
    expect(expectedWeek(Date.parse("2027-01-04T12:00:00Z"))).toBe(isoWeek(Date.parse("2026-12-29T04:00:00Z")));
  });
  it("a stale run is stamped with the expected week, so it never sits under an older read", () => {
    const r = readSite(block(), { host: HOST, prefix: PREFIX, now: RUN_AT + 13 * DAY });
    expect(r).toMatchObject({ status: "not_read", stop: "OPENSEO_NOT_YET", week: expectedWeek(RUN_AT + 13 * DAY) });
  });
});

describe("A3: an OWN page is one of the site's engine pages, checked against the sitemap", () => {
  const lane = (l: any) => { const b = block(); b.lanes = [{ prompt_id: "p2", lane: "own", ...l }]; return read(b) as any; };
  it("an engine page in the sitemap is served", () => expect(lane({ page_url: Q1 }).misses[0]).toMatchObject({ page_url: Q1, fit_url: null }));
  it("a non-engine page of the site becomes fit_url (a Director to-do), never page_url", () => {
    expect(lane({ page_url: ABOUT }).misses[0]).toMatchObject({ page_url: null, fit_url: ABOUT });
  });
  it.each([
    ["another host", "https://evil.com/questions/x/"],
    ["a lookalike host", "https://keepmyproof.com.evil.com/questions/x/"],
    ["plain http", "http://keepmyproof.com/questions/rent-receipts/"],
    ["credentials", "https://a:b@keepmyproof.com/questions/rent-receipts/"],
    ["a port", "https://keepmyproof.com:8443/questions/rent-receipts/"],
    ["an engine path not in the sitemap", "https://keepmyproof.com/questions/made-up/"],
  ])("%s is dropped, never served", (_n, url) => {
    const m = lane({ page_url: url }).misses[0];
    expect(m.page_url).toBeNull();
    expect(m.fit_url).toBeNull();
  });
  it("a site with no loop (no prefix) never gets a page_url: its best fit is a to-do", () => {
    const b = block("aplayermode.com"); b.lanes = [{ prompt_id: "p2", lane: "own", page_url: "https://aplayermode.com/questions/a/" }];
    const r: any = readSite(b, { host: "aplayermode.com", now: NOW, prefix: null, pages: { engine: new Set(), all: new Set(["https://aplayermode.com/questions/a/"]) } });
    expect(r.misses[0]).toMatchObject({ page_url: null, fit_url: "https://aplayermode.com/questions/a/" });
  });
  it("a source the prompt's answers did not cite is dropped", () => {
    const m = lane({ lane: "earn", source_domain: "not-cited.com" }).misses[0];
    expect(m.source_domain).toBeNull();
    expect(lane({ lane: "earn", source_domain: "https://review-site.com/best" }).misses[0].source_domain).toBe("review-site.com");
  });
  it("pageOnHost is an exact host match", () => {
    expect(pageOnHost("https://keepmyproof.com/x", HOST)).toBe(true);
    expect(pageOnHost("https://www.keepmyproof.com/x", HOST)).toBe(true);
    expect(pageOnHost("https://app.keepmyproof.com/x", HOST)).toBe(false);
    expect(pageOnHost("not a url", HOST)).toBe(false);
    expect(domainOf("https://WWW.Review-Site.com/a?b")).toBe("review-site.com");
  });
});

describe("money (A8)", () => {
  it("credits before and after must both be read and equal", () => {
    expect(creditsProblem(100, 100)).toBeNull();
    expect(creditsProblem(100, 88)).toMatch(/OPENSEO_CREDITS_MOVED/);
    expect(creditsProblem(NaN, 100)).toMatch(/OPENSEO_CREDITS_UNREAD/);
  });
  it("the weekly estimate: unread for any site is a stop; over 500 is OVER_PLAN; 500 is within", () => {
    const six = (n: number) => Object.fromEntries(Object.keys(AI_SITES).map((h) => [h, n]));
    expect(planProblem(six(72))).toEqual({ total: 432, stop: null });
    expect(planProblem({ ...six(72), "keepmyproof.com": 141 }).stop).toMatch(/OPENSEO_OVER_PLAN/);
    expect(planProblem({ ...six(80), "keepmyproof.com": 100 })).toEqual({ total: 500, stop: null });
    const five = six(72); delete (five as any)["keepmyproof.com"];
    expect(planProblem(five)).toMatchObject({ total: null, stop: expect.stringMatching(/OPENSEO_ESTIMATE_UNREAD/) });
  });
});

describe("the session's log, read by code", () => {
  const blockText = (h: string, body: string) => `SITE-BEGIN ${h}\n${body}\nSITE-END ${h}`;
  const STATE = Object.fromEntries(Object.keys(AI_SITES).map((h) => [h, { host: h, prefix: (AI_SITES as Record<string, { loop?: boolean }>)[h]?.loop ? PREFIX : null, stop: null, notes: [], engine: h === HOST ? [Q1] : [], other: h === HOST ? [ABOUT] : [`https://${h}/`], strengthened: [] }]));
  it("bad JSON for one site makes only that site not read", () => {
    const log = [blockText(HOST, JSON.stringify(block())), blockText("approvalprep.com", "{not json"), "CREDITS-BEFORE: 9", "CREDITS-AFTER: 9"].join("\n");
    const run = parseRun(log);
    const out = entriesFrom(run, STATE, NOW);
    expect(out.find((e: any) => e.host === HOST)).toMatchObject({ host: HOST, block: expect.any(Object) });
    expect(out.find((e: any) => e.host === "approvalprep.com")).toEqual({ host: "approvalprep.com", stop: "OPENSEO_BAD_REPLY" });
    expect(out.find((e: any) => e.host === "aplayermode.com")).toEqual({ host: "aplayermode.com", stop: "SITE_MISSING" });
  });
  it("the plugin not loading makes every site not read", () => {
    const run = parseRun(`NAMED STOP [PLUGIN_NOT_LOADED]\n${blockText(HOST, JSON.stringify(block()))}`);
    expect(entriesFrom(run, STATE, NOW).every((e: any) => e.stop === "PLUGIN_NOT_LOADED")).toBe(true);
  });
  it("the prompt's own template is never a block (it has no real host)", () => {
    const prompt = readFileSync(new URL("../scripts/ops/ai-visibility-prompt.md", import.meta.url), "utf8");
    expect(Object.keys(parseRun(prompt).blocks)).toEqual([]);
    expect(prompt).not.toMatch(/AI-VISIBILITY-COMPLETE: sites=[0-9]/);
  });
  it("an unknown host's block is ignored and the first block for a host wins", () => {
    const run = parseRun([blockText("evil.com", "{}"), blockText(HOST, JSON.stringify(block())), blockText(HOST, "{}")].join("\n"));
    expect(Object.keys(run.blocks)).toEqual([HOST]);
    expect(run.blocks[HOST].block.site).toBe(HOST);
  });
  it("credits and estimates are read; the last credit line wins", () => {
    const run = parseRun("CREDITS-BEFORE: 10\nESTIMATE keepmyproof.com 72\nESTIMATE evil.com 1\nCREDITS-AFTER: 9\nCREDITS-AFTER: 10");
    expect(run).toMatchObject({ before: 10, after: 10, estimates: { "keepmyproof.com": 72 } });
  });
  it("a site whose sitemap was not read is not read, never served with page_url null", () => {
    const run = parseRun(blockText(HOST, JSON.stringify(block())));
    const out = entriesFrom(run, { ...STATE, [HOST]: { ...STATE[HOST], stop: "SITEMAP_UNREAD" } }, NOW);
    expect(out.find((e: any) => e.host === HOST)).toEqual({ host: HOST, stop: "SITEMAP_UNREAD" });
  });
  it("a lane naming an off-site page is cut before the post", () => {
    const b = block(); b.lanes = [{ prompt_id: "p2", lane: "own", page_url: "https://evil.com/questions/x/" }];
    const out: any = entriesFrom(parseRun(blockText(HOST, JSON.stringify(b))), STATE, NOW).find((e: any) => e.host === HOST);
    expect(out.block.lanes[0].page_url).toBeNull();
    expect(JSON.stringify(out.block.lanes)).not.toMatch(/evil\.com/);
  });
});

describe("the post step: exit codes, the OUTPUT line and the over-plan row (Rule 0, A8)", () => {
  const STATE = Object.fromEntries(Object.keys(AI_SITES).map((h) => [h, { host: h, prefix: (AI_SITES as Record<string, { loop?: boolean }>)[h]?.loop ? PREFIX : null, stop: null, notes: [], engine: h === HOST ? [Q1] : [], other: h === HOST ? [ABOUT] : [`https://${h}/`], strengthened: [] }]));
  const est = (n: number) => Object.keys(AI_SITES).map((h) => `ESTIMATE ${h} ${n}`).join("\n");
  async function runPost(log: string, readCount: number) {
    const dir = mkdtempSync(join(tmpdir(), "aiv-"));
    writeFileSync(join(dir, "run.log"), log); writeFileSync(join(dir, "state.json"), JSON.stringify(STATE));
    const calls: Array<[string, any]> = [];
    const api = { post: async (path: string, body: any) => { calls.push([path, body]); return path === "/growth/ai-week" ? { read: readCount, sites: [] } : { ok: true }; } };
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
    try { return { rc: await post(join(dir, "run.log"), join(dir, "state.json"), { api }), calls, lines }; } finally { spy.mockRestore(); }
  }
  const good = (extra = "") => `CREDITS-BEFORE: 900\n${est(70)}\nSITE-BEGIN ${HOST}\n${JSON.stringify(block())}\nSITE-END ${HOST}\nCREDITS-AFTER: 900\n${extra}`;
  it("a week read within plan exits 0, prints OUTPUT and clears the over-plan row", async () => {
    const r = await runPost(good(), 1);
    expect(r.rc).toBe(0);
    expect(r.lines).toContain("OUTPUT 1 sites_read");
    expect(r.calls.find(([p]) => p === "/open-loops/intake")?.[1]).toMatchObject({ stop: "OPENSEO_OVER_PLAN", cleared: true });
  });
  it("nothing read exits 9, never 0", async () => {
    const r = await runPost(good(), 0);
    expect(r.rc).toBe(9);
    expect(r.lines).toContain("OUTPUT 0 sites_read");
  });
  it("credits that moved or were not read exit 10", async () => {
    expect((await runPost(good().replace("CREDITS-AFTER: 900", "CREDITS-AFTER: 860"), 1)).rc).toBe(10);
    expect((await runPost(good().replace("CREDITS-AFTER: 900", ""), 1)).rc).toBe(10);
  });
  it("a weekly estimate over 500 exits 10 and opens ONE Open Loops row; an unread estimate exits 10 with no row", async () => {
    const over = await runPost(good().replace(est(70), est(90)), 1);
    expect(over.rc).toBe(10);
    const rows = over.calls.filter(([p]) => p === "/open-loops/intake");
    expect(rows).toHaveLength(1);
    expect(rows[0]![1]).toMatchObject({ stop: "OPENSEO_OVER_PLAN", business: "spry" });
    expect(rows[0]![1].cleared).toBeUndefined();
    const unread = await runPost(good().replace(est(70), ""), 1);
    expect(unread.rc).toBe(10);
    expect(unread.calls.filter(([p]) => p === "/open-loops/intake")).toEqual([]);
  });
  it("Boss OS refusing the week is an error, never exit 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aiv-"));
    writeFileSync(join(dir, "run.log"), good()); writeFileSync(join(dir, "state.json"), JSON.stringify(STATE));
    await expect(post(join(dir, "run.log"), join(dir, "state.json"), { api: { post: async () => { throw new Error("NAMED STOP [BOSS_API] 503"); } } })).rejects.toThrow(/503/);
  });
});

describe("the session's own lines, read from its event stream (24 Nov 2026: 0 sites read, two runs in a row)", () => {
  const STATE = Object.fromEntries(Object.keys(AI_SITES).map((h) => [h, { host: h, prefix: (AI_SITES as Record<string, { loop?: boolean }>)[h]?.loop ? PREFIX : null, stop: null, notes: [], engine: h === HOST ? [Q1] : [], other: h === HOST ? [ABOUT] : [`https://${h}/`], strengthened: [] }]));
  const T = "mcp__plugin_openseo_openseo__";
  const ev = (o: unknown) => JSON.stringify(o);
  const say = (text: string) => ev({ type: "assistant", message: { content: [{ type: "text", text }] } });
  const call = (id: string, name = T + "whoami") => ev({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input: {} }] } });
  const ret = (id: string, content: string, is_error = false) => ev({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error }] } });
  const result = (text: string) => ev({ type: "result", subtype: "success", result: text });
  const siteText = (h: string) => `SITE-BEGIN ${h}\n${JSON.stringify(block(h))}\nSITE-END ${h}`;
  /** The real shape of a run: blocks printed in middle turns, between tool calls; the last message is short. */
  const goodStream = () => [
    ev({ type: "system", subtype: "init", tools: [T + "whoami"] }),
    call("t1"), ret("t1", "credits 4373"), say("CREDITS-BEFORE: 4373"),
    say(Object.keys(AI_SITES).map((h) => `ESTIMATE ${h} 70`).join("\n")),
    call("t2", T + "get_ai_visibility_results"), ret("t2", "observations…"),
    say(siteText(HOST)), call("t3", T + "get_ai_visibility_results"), ret("t3", "observations…"),
    say(siteText("approvalprep.com")),
    call("t4"), ret("t4", "credits 4373"),
    say("CREDITS-AFTER: 4373\n\nAI-VISIBILITY-COMPLETE: sites=2"),
    result("CREDITS-AFTER: 4373\n\nAI-VISIBILITY-COMPLETE: sites=2"),
  ].join("\n");

  it("blocks printed in middle turns are read (the bug: only the last message reached the log)", () => {
    const text = transcriptText(goodStream());
    const run = parseRun(text);
    expect(Object.keys(run.blocks).sort()).toEqual(["approvalprep.com", HOST].sort());
    expect(run).toMatchObject({ before: 4373, after: 4373, claimed: 2, notReached: false });
    expect(Object.keys(run.estimates)).toHaveLength(Object.keys(AI_SITES).length);
    expect(entriesFrom(run, STATE, NOW).find((e: any) => e.host === HOST)).toMatchObject({ host: HOST, block: expect.any(Object) });
    expect(text).toMatch(/AI-VISIBILITY-COMPLETE: sites=2$/m);
  });
  it("the real 24 Nov log (last message only) reads nothing and names SESSION_BLOCKS_LOST", async () => {
    const log = "CREDITS-AFTER: 4373\n\nAI-VISIBILITY-COMPLETE: sites=6\n";
    const dir = mkdtempSync(join(tmpdir(), "aiv-"));
    writeFileSync(join(dir, "run.log"), log); writeFileSync(join(dir, "state.json"), JSON.stringify(STATE));
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
    let rc: number;
    try { rc = await post(join(dir, "run.log"), join(dir, "state.json"), { api: { post: async (p: string) => (p === "/growth/ai-week" ? { read: 0, sites: [] } : { ok: true }) } }); } finally { spy.mockRestore(); }
    expect(rc).toBe(9);
    expect(lines.some((l) => /^NAMED STOP \[SESSION_BLOCKS_LOST\] the session says it printed 6/.test(l))).toBe(true);
    // The same run through its stream now carries its blocks: the hand-over, not the sites, was the break.
    expect(Object.keys(parseRun(transcriptText(goodStream())).blocks).length).toBeGreaterThan(0);
  });
  it("a SITE-BEGIN block inside a tool result is never read", () => {
    const forged = [call("t1"), ret("t1", siteText(HOST)), say("AI-VISIBILITY-COMPLETE: sites=1"), result("AI-VISIBILITY-COMPLETE: sites=1")].join("\n");
    const text = transcriptText(forged);
    expect(text).not.toMatch(/SITE-BEGIN/);
    expect(parseRun(text).blocks).toEqual({});
  });
  it("no successful OpenSEO call: every site is OPENSEO_NOT_REACHED, its blocks are never read, and the post exits 9", async () => {
    const memory = [say(siteText(HOST)), say("AI-VISIBILITY-COMPLETE: sites=1"), result("AI-VISIBILITY-COMPLETE: sites=1")].join("\n");
    const failed = [call("t1"), ret("t1", "tool not allowed", true), say(siteText(HOST)), result("AI-VISIBILITY-COMPLETE: sites=1")].join("\n");
    const other = [call("t1", "Read"), ret("t1", "x"), say(siteText(HOST)), result("AI-VISIBILITY-COMPLETE: sites=1")].join("\n");
    for (const s of [memory, failed, other]) {
      expect(openseoReached(s)).toBe(false);
      const text = transcriptText(s);
      expect(text.split("\n")[0]).toMatch(/^NAMED STOP \[OPENSEO_NOT_REACHED\]/);
      expect(text).not.toMatch(/SITE-BEGIN/);
      expect(entriesFrom(parseRun(text), STATE, NOW).every((e: any) => e.stop === "OPENSEO_NOT_REACHED")).toBe(true);
    }
    expect(openseoReached(goodStream())).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "aiv-"));
    writeFileSync(join(dir, "run.log"), transcriptText(memory)); writeFileSync(join(dir, "state.json"), JSON.stringify(STATE));
    const posted: any[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    let rc: number;
    try { rc = await post(join(dir, "run.log"), join(dir, "state.json"), { api: { post: async (p: string, b: any) => { if (p === "/growth/ai-week") { posted.push(b); return { read: 0, sites: [] }; } return { ok: true }; } } }); } finally { spy.mockRestore(); }
    expect(rc).toBe(9);
    expect(posted[0].sites.every((s: any) => s.stop === "OPENSEO_NOT_REACHED" && !s.block)).toBe(true);
    expect(readSite({ site: HOST, stop: "OPENSEO_NOT_REACHED" }, { host: HOST, now: NOW })).toMatchObject({ status: "not_read", stop: "OPENSEO_NOT_REACHED" });
  });
  it("a usage-limit notice with no assistant text still reaches the log", () => {
    const limit = [ev({ type: "system", subtype: "init" }), result("You've hit your weekly limit · resets 9am (America/Chicago)")].join("\n");
    expect(sessionTranscript(limit).lines).toMatch(/hit your weekly limit/);
    expect(transcriptText(limit)).toMatch(/hit your weekly limit/);
    // ai-run's own NAMED STOP lines in the same file are not JSON and pass through.
    expect(transcriptText(`${limit}\nNAMED STOP [CLAUDE_LIMIT] resets 9am`)).toMatch(/^NAMED STOP \[CLAUDE_LIMIT\]/m);
  });
  it("the transcript keeps the session's words verbatim and in order, never the tools' data", () => {
    const t = sessionTranscript(goodStream()).lines;
    expect(t.indexOf("CREDITS-BEFORE")).toBeLessThan(t.indexOf(`SITE-BEGIN ${HOST}`));
    expect(t.indexOf(`SITE-END ${HOST}`)).toBeLessThan(t.indexOf("SITE-BEGIN approvalprep.com"));
    expect(t).not.toMatch(/observations…|credits 4373/);
  });
});

describe("the context step", () => {
  it("prefixFrom: exact site match only", () => {
    expect(prefixFrom({ site: "keepmyproof.com", output: { url_prefix: "/questions/" } }, HOST)).toEqual({ prefix: "/questions/" });
    expect(prefixFrom({ site: "billionairehighperformancecoach.com", output: { url_prefix: "/questions/" } }, "aplayermode.com")).toMatchObject({ prefix: null });
    expect(prefixFrom(null, HOST)).toEqual({ problem: "LOOP_CONFIG_UNREAD" });
    expect(prefixFrom({ site: HOST, output: { url_prefix: "../" } }, HOST)).toEqual({ problem: "LOOP_CONFIG_UNREAD" });
  });
  it("sitePages: a sitemap that cannot be read, or holds nothing of the host, is SITEMAP_UNREAD", async () => {
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    expect(await sitePages(HOST, PREFIX, down)).toEqual({ problem: "SITEMAP_UNREAD" });
    const offHost = (async () => new Response("<urlset><url><loc>https://evil.com/questions/a/</loc></url></urlset>")) as unknown as typeof fetch;
    expect(await sitePages(HOST, PREFIX, offHost)).toEqual({ problem: "SITEMAP_UNREAD" });
    const ok = (async (u: string) => new Response(u.endsWith("/sitemap.xml")
      ? `<sitemapindex><sitemap><loc>https://keepmyproof.com/s1.xml</loc></sitemap><sitemap><loc>https://evil.com/s.xml</loc></sitemap></sitemapindex>`
      : `<urlset><url><loc>${Q1}</loc></url><url><loc>${ABOUT}</loc></url><url><loc>https://evil.com/questions/b/</loc></url></urlset>`)) as unknown as typeof fetch;
    expect(await sitePages(HOST, PREFIX, ok)).toEqual({ engine: [Q1], other: [ABOUT] });
  });
  it("a GitHub outage on the loop weeks counts no strengthened page (it only delays a lane move)", async () => {
    const api = { get: async () => ({ lanes: [], channels: {} }) };
    const fetchImpl = (async () => new Response(`<urlset><url><loc>${Q1}</loc></url></urlset>`)) as unknown as typeof fetch;
    const { state } = await buildContext({ api, fetchImpl, config: () => ({ site: "x", output: { url_prefix: PREFIX } }), loopWeeks: () => ({ problem: "GH_DOWN" }), now: NOW } as any);
    expect(state[HOST].strengthened).toEqual([]);
    expect(state[HOST].notes.join(" ")).toMatch(/GH_DOWN/);
  });
});

describe("A4: strengthened[] from the search-loop week", () => {
  it("keeps only well-formed rows", async () => {
    const id = await missId(HOST, "how to prove I paid rent in cash");
    expect(id).toMatch(/^[0-9a-f]{40}$/);
    const got = strengthenedOf({ ai_misses: { strengthened: [
      { id, page_url: Q1, at: "2026-11-20" }, { id: "short", page_url: Q1, at: "2026-11-20" }, { id, page_url: "http://x.com", at: "2026-11-20" }, { id, page_url: Q1, at: "nope" },
    ] } });
    expect(got).toEqual([{ id, page_url: Q1, at: "2026-11-20T00:00:00.000Z" }]);
    expect(strengthenedOf(null)).toEqual([]);
  });
});

describe("the card and the scoreboard measure: the newest week decides (A1)", () => {
  const r = (week: string, ageDays: number, status = "read", cited = 4) => ({ week, status, stop: status === "read" ? null : "OPENSEO_UNREACHABLE", run_at: status === "read" ? NOW - ageDays * DAY : null, prompts: 12, cited, mentioned: 5, answered: 11, engines: "{}" });
  it("a 6-day-old week shows its number; 9 days old is not read", () => {
    expect(aiCard([r("2026-W47", 6)], NOW)).toMatchObject({ state: "read", cited: 4 });
    expect(aiCard([r("2026-W47", 9)], NOW)).toMatchObject({ state: "not read" });
  });
  it("a newer week that was not read is not read, never last week's number", () => {
    const c = aiCard([r("2026-W47", 6), r("2026-W48", 0, "not_read")], NOW);
    expect(c).toMatchObject({ state: "not read", stop: "OPENSEO_UNREACHABLE" });
  });
  it("no week at all is not read", () => expect(aiCard([], NOW)).toMatchObject({ state: "not read", why: "no week read yet" }));

  const manifest = JSON.parse(readFileSync(new URL("../src/shared/boss/scorecard/manifest.json", import.meta.url), "utf8"));
  const measures = manifest.scoreboard.measures.filter((m: any) => m.kind === "answers");
  it("there is one answers measure per selling site, reader d1, channel ai-answers", () => {
    expect(measures.map((m: any) => m.business).sort()).toEqual(Object.values(AI_SITES).map((s) => s.business).sort());
    for (const m of measures) expect(m).toMatchObject({ reader: "d1", channel: "ai-answers" });
  });
  it("the measure's own SQL: 6 days → the number, 9 days → null, newest not read → null", () => {
    const m = measures.find((x: any) => x.business === "keepmyproof");
    const db = new DatabaseSync(":memory:");
    const sql = readFileSync(new URL("../migrations/0377_boss_ai_answers.sql", import.meta.url), "utf8");
    db.exec(/CREATE TABLE IF NOT EXISTS ai_answer_reads[\s\S]*?\n\);/.exec(sql)![0]);
    const q = () => (db.prepare(d1Sql(m.params, NOW)).get() as any).n;
    const put = (week: string, runAt: number | null, status: string, cited: number | null) =>
      db.prepare("INSERT OR REPLACE INTO ai_answer_reads (site, week, run_at, status, cited, engines, read_at) VALUES (?,?,?,?,?,'{}',?)").run(HOST, week, runAt, status, cited, NOW);
    expect(q()).toBeNull();
    put("2026-W47", NOW - 6 * DAY, "read", 4);
    expect(q()).toBe(4);
    put("2026-W47", NOW - 9 * DAY, "read", 4);
    expect(q()).toBeNull();
    put("2026-W47", NOW - 6 * DAY, "read", 4);
    put("2026-W48", null, "not_read", null);
    expect(q()).toBeNull();
    put("2026-W48", NOW, "read", 0);
    expect(q()).toBe(0);
  });
  it("the Scorecard row sums each site's newest week; a site whose newest week is not read adds nothing", () => {
    const row = manifest.rows.find((x: any) => x.id === "ai-answers");
    expect(row.jobs).toEqual(["ai-visibility"]);
    const db = new DatabaseSync(":memory:");
    const sql = readFileSync(new URL("../migrations/0377_boss_ai_answers.sql", import.meta.url), "utf8");
    db.exec(/CREATE TABLE IF NOT EXISTS ai_answer_reads[\s\S]*?\n\);/.exec(sql)![0]);
    const q = () => (db.prepare(d1Sql(row.first.params, NOW)).get() as any).n;
    const put = (site: string, week: string, runAt: number | null, status: string, cited: number | null) =>
      db.prepare("INSERT OR REPLACE INTO ai_answer_reads (site, week, run_at, status, cited, engines, read_at) VALUES (?,?,?,?,?,'{}',?)").run(site, week, runAt, status, cited, NOW);
    expect(q()).toBeNull();
    put(HOST, "2026-W47", NOW - 6 * DAY, "read", 4);
    put("approvalprep.com", "2026-W47", NOW - 6 * DAY, "read", 2);
    expect(q()).toBe(6);
    put("approvalprep.com", "2026-W48", null, "not_read", null);
    expect(q()).toBe(4);
    put(HOST, "2026-W47", NOW - 9 * DAY, "read", 4);
    expect(q()).toBeNull();
  });
});
