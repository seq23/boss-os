/**
 * NOELLE V2 (24 Nov 2026): her tools, her hold, Rule 0, the 3-days alarm, the job knobs and the bank add.
 * Each test is one HOW IT BREAKS line of ~/Work/tasks/noelle-v2-brief.md and goes red when its fix is undone
 * (the PR's Mutation proof lists each one).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain ESM with no declaration file
import { ALARM_DAYS, CONTEXT_MAX, START_AT, actExit, bankRows, bankVerdicts, contextTooBig, heldUntil, jobTarget, lowChannels, nicheBlock, rulingsFiles, splitRulings, tickDecision } from "../scripts/ops/noelle.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { checkLines, queueLines } from "../scripts/ops/noelle-tools.mjs";
import { CHANNEL_OWNERS, JOB_KNOBS, hardStops, settledNo } from "../src/shared/boss/growth/noelle.mjs";

const SAT = Date.parse(START_AT);

describe("her hold: nothing runs before Sat 28 Nov 00:00 CT (her words: \"dont let her run until Sat\")", () => {
  it("held a minute before, free at the time; a broken NOELLE_START_AT stays held", () => {
    expect(START_AT).toBe("2026-11-28T00:00:00-06:00");
    expect(heldUntil(SAT - 60_000, {})).toMatch(/HELD_UNTIL/);
    expect(heldUntil(SAT, {})).toBeNull();
    expect(heldUntil(SAT, { NOELLE_START_AT: "soon" })).toMatch(/not a time/);
    expect(tickDecision({ day: "2026-11-27", now: "20:00", nowMs: SAT - 3_600_000, mark: null, env: {} })).toMatchObject({ run: false, held: true });
  });
});

describe("hard stops in code: fund, Time-2-Read, trademark, backlink library, settled noes", () => {
  it("each one names its stop; plain copy passes", () => {
    const stops = (t: string) => hardStops(t).map((h: { stop: string }) => h.stop);
    expect(stops("A note to our Limited Partners")).toContain("FUND");
    expect(stops("West Peek Ventures Fund I")).toContain("FUND");
    expect(stops("Pair it with Time 2 Read")).toContain("NOT_HERS");
    expect(stops("Giant Connect 4 for the party")).toContain("TRADEMARK");
    expect(stops("from the authority backlink network")).toContain("LIBRARY");
    expect(stops("Giant four-in-a-row, porch lights, cocoa bar.")).toEqual([]);
    expect(settledNo({ business: "porch-and-party", what: "Sell a January takedown" })?.stop).toBe("SETTLED_NO");
    expect(settledNo({ business: "porch-and-party", what: "takedown included in the price" })).toBeNull();
    expect(settledNo({ business: "approvalprep", what: "a new edition of the Ultimate guide" })?.stop).toBe("SETTLED_NO");
    expect(settledNo({ business: "dream-wedding", what: "start a YouTube channel" })?.stop).toBe("SETTLED_NO");
  });
});

describe("her context: each shared ruling once, paused businesses one line, ≤60 KB or a named stop", () => {
  const shared = "### Spry Labs Growth\nOne rule for every Spry Labs business.";
  const businesses = [
    { key: "approvalprep", label: "ApprovalPrep", rulings: `${shared}\n### Own AP\nAP only.` },
    { key: "dream-wedding", label: "Dream Wedding", rulings: `${shared}\n### Own DW\nDW only.` },
    { key: "how-we-know", label: "How We Know", paused: "until the 26 Nov talk", rulings: shared },
  ];
  it("the shared group is written once with whom it covers; the paused business gets no file", () => {
    const { shared: s, own } = splitRulings(businesses);
    expect(s).toHaveLength(1);
    expect(s[0].keys).toEqual(["approvalprep", "dream-wedding"]);
    expect(own["approvalprep"].map((g: { heading: string }) => g.heading)).toEqual(["Own AP"]);
    const files = rulingsFiles(businesses);
    expect(files["shared.md"].match(/One rule for every Spry Labs business/g)).toHaveLength(1);
    expect(files["shared.md"]).toMatch(/applies to: ApprovalPrep, Dream Wedding/);
    expect(Object.keys(files).sort()).toEqual(["approvalprep.md", "dream-wedding.md", "shared.md"]);
  });
  it("over 60 KB is CONTEXT_TOO_BIG naming the biggest part, never a silent cut", () => {
    expect(contextTooBig("x".repeat(CONTEXT_MAX))).toBeNull();
    const big = `TODAY\n## Her rulings\n${"r".repeat(CONTEXT_MAX)}\n## Read list\nsmall`;
    expect(contextTooBig(big)).toMatch(/CONTEXT_TOO_BIG.*Her rulings \d+ KB/);
  });
});

describe("Rule 0: a run that acts on nothing is red", () => {
  it("0 queued and 0 job PRs → 14 NOTHING_ACTED; one PR or one piece → 0; a limit → 76", () => {
    expect(actExit({ queued: [], jobs: [{ tag: "x", line: "already 4" }] })).toMatchObject({ code: 14, line: expect.stringMatching(/NOTHING_ACTED/) });
    expect(actExit({ queued: [], jobs: [{ tag: "x", pr: "seq23/peace-be-still#9" }] })).toMatchObject({ code: 0, acted: 1 });
    expect(actExit({ queued: [{ id: "p1" }], jobs: [] })).toMatchObject({ code: 0 });
    expect(actExit({ queued: [], jobs: [], stop: "NAMED STOP [CLAUDE_LIMIT] x" }).code).toBe(76);
    expect(actExit({ queued: [], jobs: [] }, 12).code).toBe(12);
  });
});

describe("the alarm: an owned channel under 3 days ahead after her run", () => {
  const base = { day: "2026-11-24", queued: [], jobs: [], calendar: { queues: { "dream-wedding:tiktok": 1, "approvalprep:threads": 6 }, days: { "dream-wedding:tiktok": ["2026-11-25"], "approvalprep:threads": ["2026-11-25", "2026-11-26", "2026-11-27"] }, unread: { "keepmyproof:blogger": "no ledger" } } };
  it("1 day ahead raises UNDER_3_DAYS; 3 days does not; an unread owned queue is CHANNEL_UNREAD", () => {
    expect(ALARM_DAYS).toBe(3);
    const out = lowChannels(base).join("\n");
    expect(out).toMatch(/UNDER_3_DAYS\] dream-wedding:tiktok: 1 day ahead/);
    expect(out).not.toMatch(/approvalprep:threads/);
    if (CHANNEL_OWNERS["keepmyproof:blogger"]) expect(out).toMatch(/CHANNEL_UNREAD\] keepmyproof:blogger/);
  });
  it("today's own posts do not count, and a job PR opened this run for that channel silences it", () => {
    const today = { ...base, calendar: { ...base.calendar, days: { ...base.calendar.days, "approvalprep:threads": ["2026-11-24", "2026-11-25", "2026-11-26"] } } };
    expect(lowChannels(today).join()).toMatch(/approvalprep:threads: 2 days ahead/);
    const fixed = { ...base, jobs: [{ tag: "dream-wedding tiktok dw-brand-social.target", pr: "seq23/dream-wedding-builder#5" }] };
    expect(lowChannels(fixed).join()).not.toMatch(/dream-wedding:tiktok/);
  });
});

describe("the bank add: only posts a fresh reviewer passed, in the file's own shape", () => {
  const existing = [{ id: "pbs59", day: 59, type: "Question", series: "Say it back", lang: "en", link: false, evergreen: true, text: "a" }, { id: "pbs60", day: 60, type: "Chat", lang: "en", link: false, evergreen: true, text: "b" }];
  it("ids and days continue; fields follow the file", () => {
    const rows = bankRows(existing, [{ type: "Chat", text: " Rest now. " }], JOB_KNOBS["pbs-threads"]);
    expect(rows).toEqual([{ id: "pbs61", day: 61, type: "Chat", lang: "en", link: false, evergreen: true, text: "Rest now." }]);
    const ap = bankRows([{ id: "t60", day: 60, type: "Tip", approved: true, sources: ["x"], checks: [], text: "c" }], [{ type: "Tip", text: "d" }], JOB_KNOBS["ap-threads"]);
    expect(ap[0]).toMatchObject({ id: "t61", approved: null, sources: [], checks: [] });
  });
  it("an unreadable or out-of-range verdict passes nothing", () => {
    expect(bankVerdicts("no sentinels", 2).pass).toEqual([]);
    expect(bankVerdicts('BANK-REVIEW-BEGIN [{"i":0,"verdict":"PASS"},{"i":5,"verdict":"PASS"},{"i":1,"verdict":"FAIL","why":"template"}] BANK-REVIEW-END', 2)).toMatchObject({ pass: [0], fails: ["#1: template"] });
  });
});

describe("the job-target executor: a PR on the owning repo, landed by land-after; never a direct write", () => {
  const file = { days_ahead: 3, posts: [{ id: "pbs60", day: 60, type: "Chat", lang: "en", link: false, evergreen: true, text: "b" }] };
  const fake = (calls: string[][]) => (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (args[1]?.endsWith("/contents/data/threads/posts.json") && args[0] === "api") return { rc: 0, out: JSON.stringify({ sha: "abc", content: Buffer.from(JSON.stringify(file, null, 2)).toString("base64") }) };
    if (args.includes(".object.sha")) return { rc: 0, out: "mainsha\n" };
    if (cmd === "gh" && args[0] === "pr") return { rc: 0, out: "https://github.com/seq23/peace-be-still/pull/77\n" };
    return { rc: 0, out: "" };
  };
  const a = { kind: "job-target", business: "peace-be-still", channel: "threads", job: "pbs-threads", repo: "peace-be-still", file: "data/threads/posts.json", field: "target", key: "days_ahead", value: 4, why: "keep 4 days" };
  it("target: one branch, one PUT with the new value, one PR, then land-after", () => {
    const calls: string[][] = [];
    const r = jobTarget(a, { day: "2026-11-28", calls: 0, failed: [] }, mkdtempSync(join(tmpdir(), "nt-")), { run: fake(calls), call: () => ({ text: "" }) });
    expect(r).toMatchObject({ pr: "seq23/peace-be-still#77", what: "days_ahead 3 → 4" });
    const put = calls.find((c) => c.includes("PUT"))!;
    const body = JSON.parse(Buffer.from(put.find((x) => x.startsWith("content="))!.slice(8), "base64").toString());
    expect(body.days_ahead).toBe(4);
    expect(put).toContain("branch=noelle/2026-11-28-pbs-threads-target");
    expect(calls.at(-1)).toEqual(["land-after", "77", "--repo", "seq23/peace-be-still", "--task", "noelle-2026-11-28-pbs-threads-target"]);
    const pr = calls.find((c) => c[1] === "pr")!; const prBody = pr[pr.indexOf("-b") + 1];
    for (const h of ["Outcome:", "## Not built", "Mutation proof:", "Review class:", "Forms:", "## Self-review"]) expect(prBody).toContain(h);
  });
  it("bank: a reviewer FAIL on every post writes nothing; a PASS adds only that post", () => {
    const posts = [{ type: "Chat", text: "one" }, { type: "Chat", text: "two" }];
    const none: string[][] = [];
    const r0 = jobTarget({ ...a, field: "bank", key: "posts", value: posts }, { day: "2026-11-28", calls: 0, failed: [] }, mkdtempSync(join(tmpdir(), "nt-")), { run: fake(none), call: () => ({ text: 'BANK-REVIEW-BEGIN [{"i":0,"verdict":"FAIL","why":"flat"},{"i":1,"verdict":"FAIL","why":"flat"}] BANK-REVIEW-END' }) });
    expect(r0.pr).toBeUndefined();
    expect(none.some((c) => c.includes("PUT"))).toBe(false);
    const one: string[][] = [];
    const r1 = jobTarget({ ...a, field: "bank", key: "posts", value: posts }, { day: "2026-11-28", calls: 0, failed: [] }, mkdtempSync(join(tmpdir(), "nt-")), { run: fake(one), call: () => ({ text: 'BANK-REVIEW-BEGIN [{"i":1,"verdict":"PASS"}] BANK-REVIEW-END' }) });
    expect(r1.what).toMatch(/add 1 reviewed posts/);
    const put = one.find((c) => c.includes("PUT"))!;
    const body = JSON.parse(Buffer.from(put.find((x) => x.startsWith("content="))!.slice(8), "base64").toString());
    expect(body.posts.map((p: { text: string }) => p.text)).toEqual(["b", "two"]);
  });
  it("a credit limit during the review stops the run with nothing written", () => {
    const calls: string[][] = [];
    const r = jobTarget({ ...a, field: "bank", key: "posts", value: [{ text: "x" }] }, { day: "2026-11-28", calls: 0, failed: [] }, mkdtempSync(join(tmpdir(), "nt-")), { run: fake(calls), call: () => ({ limit: true }) });
    expect(r.limit).toBe(true);
    expect(calls.some((c) => c.includes("PUT"))).toBe(false);
  });
});

describe("her tools: the same gate as the Worker, and NOT READ is never an empty ok", () => {
  it("queue says NOT READ for an unread channel and for no calendar", () => {
    expect(queueLines({})).toEqual(["NOT READ: no calendar in this run's state"]);
    expect(queueLines({ calendar: { queues: {}, days: {}, unread: { "approvalprep:pinterest": "no variants" } } })).toEqual(["approvalprep:pinterest: NOT READ (no variants)"]);
  });
  it("check refuses a non-plan, and refuses what the Worker refuses (money)", () => {
    expect(checkLines(null, {}).ok).toBe(false);
    const state = { day: "2026-11-28", businesses: [{ key: "peace-be-still", label: "Peace Be Still", tier: "full", channels: [{ channel: "threads", formats: ["text-post"] }] }], calendar: { queues: { "peace-be-still:threads": 3 }, unread: {} } };
    const r = checkLines({ actions: [{ kind: "job-target", business: "peace-be-still", channel: "threads", field: "target", value: 9, why: "x" }] }, state);
    expect(r.lines.join("\n")).toMatch(/NEEDS_MONEY/);
  });
  it("her prompt names her tools and no longer says she has none", () => {
    const p = readFileSync("scripts/ops/noelle-prompt.md", "utf8");
    expect(p).not.toMatch(/You have NO tools/);
    for (const v of ["./noelle-tools queue", "./noelle-tools bank", "./noelle-tools check"]) expect(p).toContain(v);
    expect(p).not.toMatch(/sell the\s+January takedown/);
  });
});

describe("P&P's niche research from the Studio Brand page reaches her (her ask, 24 Nov 2026)", () => {
  it("the newest playbook's summary and body are shown; a failed or empty read is NOT READ, never blank", () => {
    const b = nicheBlock({ rows: [{ created_at: "2026-11-20T10:00:00Z", summary: JSON.stringify(["Before/after porch reels lead saves"]), body: JSON.stringify({ hooks: ["Your porch, done by Friday"] }) }] });
    expect(b).toMatch(/researched 2026-11-20/);
    expect(b).toContain("- Before/after porch reels lead saves");
    expect(b).toContain("Your porch, done by Friday");
    expect(nicheBlock({ error: "D1_QUERY_FAILED x" })).toMatch(/^NOT READ \(D1_QUERY_FAILED/);
    expect(nicheBlock({ rows: [] })).toMatch(/^NOT READ/);
    expect(readFileSync("scripts/ops/noelle-prompt.md", "utf8")).toContain("pnp-niche");
  });
});
