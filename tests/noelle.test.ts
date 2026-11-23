/**
 * NOELLE'S PLAN GATE (23 Nov 2026, the gap review G1-G21). Every action of the plan Claude writes
 * goes through checkPlan before anything happens; the Worker runs the same function again. Each
 * test below is one gap line and fails when its rule is removed.
 */
import { describe, expect, it } from "vitest";
import { parseRoster, growthSection } from "../src/shared/boss/growth/roster.mjs";
import { replaceSection, skeleton } from "../src/shared/boss/brains/brain.mjs";
import {
  checkPlan, season, slotFor, didNotRunLine, escalations, callBudget, sourceProblems, READ_SOURCES, readGrid, cadenceOf,
  copyProblems, priceProblems, parsePlan, PLAN_BEGIN, PLAN_END, missingDecisions, noticeLine, CLOSE_ONLY, KEEP_OPEN, RUN_CALLS, WEEK_CALLS, corporateOpen,
} from "../src/shared/boss/growth/noelle.mjs";

const SPRY = `### Peace Be Still
- key: peace-be-still
- buyer: Black Christian families
- offer: the app, $4.99 a month
- money number: paying subscribers
- channels: threads [text-post] · instagram [carousel] · search-pages [question-page] · backlinks [guide]
- languages: en
- limits: R-END-03
- paused: no

### KeepMyProof
- key: keepmyproof
- buyer: people keeping proof
- offer: the app, $2.99 a month
- money number: paying subscribers
- channels: blogger [guide-syndication] · search-pages [question-page]
- languages: en, es
- limits: R-PRV-01
- paused: no

### Dream Wedding
- key: dream-wedding
- buyer: couples planning a wedding
- offer: the checklist PDF, $9.99
- money number: dollars received
- channels: pinterest [pin] · instagram [carousel]
- languages: en
- limits: R-END-03
- paused: no
`;
const PNP = `### Porch & Party
- key: porch-and-party
- buyer: Memphis families
- offer: porch decor installs from $350
- money number: bookings
- channels: instagram [reel, photo-set] · tiktok [reel] · facebook-page [photo-set] · google-business-profile (by hand)
- languages: en
- limits: R-END-03
- paused: no
`;
const FRIENDS = `### Hicks
- key: hicks
- channels: search-pages [question-page]
- buyer: <!-- confidential -->Owner Zebulon Quarterfield<!-- /confidential -->
`;
const brainOf = (s: string) => replaceSection(skeleton("Test"), "Growth", s);
const roster = [
  ...parseRoster(growthSection("spry", brainOf(SPRY))!, "spry"),
  ...parseRoster(growthSection("porch-and-party", brainOf(PNP))!, "porch-and-party"),
  ...parseRoster(growthSection("friends", brainOf(FRIENDS))!, "friends"),
];
const ctx = { roster, today: "2026-11-23", queues: { "peace-be-still:threads": 4 }, caps: { "peace-be-still": 120 }, articles: { "peace-be-still": 8 }, orderedRecent: {}, accounts: ["dream-wedding:tiktok"], bufferFull: [], linkedOpen: ["olp_m80j27rk2cthq6jf"] };
const plan = (...actions: object[]) => checkPlan({ actions }, ctx);

describe("G1: owned channels are changed through their job, never posted", () => {
  it("PBS Threads with 4 queued → 0 posts scheduled, and the job's bank may change", () => {
    const r = plan({ kind: "post", business: "peace-be-still", channel: "threads", format: "text-post", draft: "Rest tonight." });
    expect(r.accepted).toHaveLength(0);
    expect(r.refused[0]).toMatchObject({ stop: "OWNED_BY_JOB" });
    expect(r.refused[0].why).toMatch(/4 of 4 queued/);
    const t = plan({ kind: "job-target", business: "peace-be-still", channel: "threads", field: "bank", value: "add five Psalm Nights lines" });
    expect(t.accepted[0]).toMatchObject({ job: "pbs-threads" });
    expect(plan({ kind: "job-target", business: "peace-be-still", channel: "threads", field: "schedule", value: "x" }).refused[0].stop).toBe("FIELD");
  });
});

describe("G3 + G7 + G10: formats and channels", () => {
  it("P&P has no Pinterest: an unrostered P&P channel is a line to her, never a fix", () => {
    const r = plan({ kind: "studio-plan", business: "porch-and-party", pieces: [{ id: "p1", at: "2026-12-02 11:15", post: "pin", format: "single-photo", platforms: ["pinterest"], theme: "christmas-porch", hook: "Porch ready" }] });
    expect(r.accepted).toHaveLength(0);
    expect(r.lines.some((l: any) => /add pinterest/i.test(l.what))).toBe(true);
  });
  it("an unlisted format is published WITH its roster line, scorecard row and notice; without the row it is not published", () => {
    const sc = { number: "saves per post", floor30: 5, floor60: 10, versionB: "a three-photo set instead" };
    const ok = plan({ kind: "studio-plan", business: "porch-and-party", pieces: [{ id: "p1", at: "2026-12-02 11:15", post: "photo-set", format: "carousel", platforms: ["tiktok"], theme: "christmas-porch", hook: "Porch ready", scorecard: sc }] });
    expect(ok.accepted[0].pieces).toHaveLength(1);
    expect(ok.roster).toEqual([{ business: "porch-and-party", channel: "tiktok", format: "photo-set" }]);
    expect(ok.notices[0].key).toBe("noelle:porch-and-party:format:tiktok:photo-set");
    const no = plan({ kind: "studio-plan", business: "porch-and-party", pieces: [{ id: "p1", at: "2026-12-02 11:15", post: "photo-set", format: "carousel", platforms: ["tiktok"], theme: "christmas-porch", hook: "Porch ready" }] });
    expect(no.accepted).toHaveLength(0);
    expect(no.refused[0].why).toMatch(/no scorecard row/);
  });
  it("a new account is refused; a channel on a live account passes the gate", () => {
    const r = plan({ kind: "post", business: "dream-wedding", channel: "threads", format: "text-post", draft: "x" });
    expect(r.refused[0].stop).toBe("NO_NEW_ACCOUNTS");
    expect(r.lines[0].what).toMatch(/open a threads account/);
    const live = checkPlan({ actions: [{ kind: "post", business: "dream-wedding", channel: "threads", format: "text-post", draft: "x" }] }, { ...ctx, accounts: ["dream-wedding:threads"] });
    expect(live.refused[0].stop).toBe("NO_LEVER");
  });
  it("a spend, an account or an email is not a kind she has", () => {
    for (const kind of ["ad", "create-account", "email", "upgrade-buffer"]) expect(plan({ kind, business: "dream-wedding" }).refused[0].stop).toBe("UNKNOWN_KIND");
  });
});

describe("G4: search-loop caps", () => {
  it("a lower cap is applied; a raise is one line to Sequoia; an unread cap is not judged", () => {
    expect(plan({ kind: "search-loop", business: "peace-be-still", change: "cap", value: 80 }).accepted).toHaveLength(1);
    const up = plan({ kind: "search-loop", business: "peace-be-still", change: "cap", value: 200 });
    expect(up.refused[0].stop).toBe("CAP_RAISE_IS_HERS");
    expect(up.lines[0].what).toMatch(/raise the search-loop cap from 120 to 200/);
    expect(plan({ kind: "search-loop", business: "keepmyproof", change: "cap", value: 50 }).refused[0].stop).toBe("CAP_NOT_READ");
    expect(plan({ kind: "search-loop", business: "peace-be-still", change: "menu-link", value: "x" }).refused[0].stop).toBe("SEARCH_LOOP_CHANGE");
  });
});

describe("G6: backlinks stay at most 1 in 4 articles", () => {
  it("8 articles allow 2 requests, the third is refused", () => {
    const b = { kind: "backlink", business: "peace-be-still", topic: "Psalm 23 for kids", draft: "d", why: "w" };
    const r = plan(b, b, b);
    expect(r.accepted).toHaveLength(2);
    expect(r.refused[0].stop).toBe("ONE_IN_FOUR");
  });
});

describe("G8 + G9: search-watch and client sites", () => {
  it("a friends entry is search-watch, loads with tier-light fields, and its private span never reaches the roster text", () => {
    const h = roster.find((e) => e.key === "hicks")!;
    expect(h.tier).toBe("search-watch");
    expect(h.problems).toEqual([]);
    expect(JSON.stringify(roster)).not.toMatch(/Zebulon|Quarterfield/);
  });
  it("a Hicks title rewrite is refused and becomes a proposal card; posts are refused WATCH_TIER", () => {
    const r = plan({ kind: "page-edit", business: "hicks", url: "/resources/x", field: "title", value: "New title", why: "CTR fell" });
    expect(r.refused[0].stop).toBe("CLIENT_APPROVAL");
    expect(r.accepted[0]).toMatchObject({ kind: "proposal", business: "hicks", from: "page-edit" });
    expect(plan({ kind: "post", business: "hicks", channel: "search-pages", format: "question-page" }).refused[0].stop).toBe("WATCH_TIER");
  });
});

describe("G11 seeds caught by code before the reviewer", () => {
  const e = (k: string) => roster.find((x) => x.key === k)!;
  it("KMP tagged link, PBS 'Black Bible Stories', DW wrong price", () => {
    expect(copyProblems("Get it https://keepmyproof.com/?utm_source=pin", e("keepmyproof")).join()).toMatch(/no tags/);
    expect(copyProblems("Black Bible Stories tonight", e("peace-be-still")).length).toBeGreaterThan(0);
    expect(copyProblems("Only $19.99 for the checklist", e("dream-wedding")).join()).toMatch(/\$19.99/);
    expect(copyProblems("Only $9.99 for the checklist", e("dream-wedding"))).toEqual([]);
    // BHPC's Gumroad book at a price its offer line never states.
    const bhpc = { label: "Billionaire High Performance Coach", offer: "the playbook on Gumroad, $27" };
    expect(priceProblems("The playbook is $47 on Gumroad", bhpc).join()).toMatch(/\$47/);
    expect(priceProblems("The playbook is $27 on Gumroad", bhpc)).toEqual([]);
    // One bad caption drops that piece only; its neighbour in the same plan is still accepted.
    const good = { id: "p2", at: "2026-12-03 11:15", post: "reel", format: "real-montage", platforms: ["instagram"], theme: "christmas-porch", hook: "Porch ready for the holidays" };
    const r = plan({ kind: "studio-plan", business: "porch-and-party", pieces: [{ id: "p1", at: "2026-12-02 11:15", post: "reel", format: "real-montage", platforms: ["instagram"], theme: "christmas-porch", hook: "Installs from $99" }, good] });
    expect(r.refused[0].stop).toBe("PIECES");
    expect(r.refused[0].why).toMatch(/^p1: \[COPY\]/);
    expect(r.refused[0].action.pieces.map((x: any) => x.id)).toEqual(["p1"]);
    expect(r.accepted[0].pieces.map((x: any) => x.id)).toEqual(["p2"]);
  });
  it("a piece that names no roster format is dropped: the gate cannot judge what it would post as", () => {
    const r = plan({ kind: "studio-plan", business: "porch-and-party", pieces: [{ id: "p1", at: "2026-12-02 18:15", format: "real-montage", platforms: ["instagram"], theme: "christmas-porch", hook: "Porch ready" }] });
    expect(r.accepted).toEqual([]);
    expect(r.refused[0].why).toMatch(/^p1: no post/);
  });
});

describe("G13 + G12: cadence and the read grid", () => {
  it("cadence classes; only queue channels are judged on scheduled days; no measure reads 'not read'", () => {
    expect(cadenceOf({ channel: "threads" })).toBe("queue");
    expect(cadenceOf({ channel: "search-pages" })).toBe("weekly");
    expect(cadenceOf({ channel: "instagram", note: "by hand" })).toBe("by-hand");
    expect(cadenceOf({ channel: "carrier-pigeon" })).toBe("none");
    const g = readGrid(roster, [{ business: "keepmyproof", channel: "blogger", language: "en", value: 3 }]);
    expect(g.find((c: any) => c.business === "keepmyproof" && c.channel === "blogger" && c.language === "en")).toMatchObject({ value: 3, read: "read" });
    expect(g.find((c: any) => c.business === "keepmyproof" && c.channel === "blogger" && c.language === "es")).toMatchObject({ value: null, read: "not read" });
    expect(g.some((c: any) => c.business === "hicks")).toBe(false);
  });
});

describe("G17 + G21: conversion sources are named, never wired", () => {
  it("a KMP wiring proposal is refused; KMP names only RevenueCat, GSC or the in-app answer", () => {
    expect(plan({ kind: "proposal", business: "keepmyproof", wiring: "a GA4 tag on the download button" }).refused[0].stop).toBe("KMP_PRIVACY");
    expect(plan({ kind: "name-source", business: "keepmyproof", source: "cf_web_analytics" }).refused[0].stop).toBe("KMP_PRIVACY");
    expect(plan({ kind: "name-source", business: "keepmyproof", source: "revenuecat" }).accepted).toHaveLength(1);
    const w = plan({ kind: "proposal", business: "dream-wedding", wiring: "count checklist downloads" });
    expect(w.accepted).toHaveLength(0);
    expect(w.lines[0].what).toMatch(/builder PR/);
  });
});

describe("Beyond the list", () => {
  it("one test per business per cycle", () => {
    const t = { kind: "test", business: "dream-wedding", what: "a second pin title", number: "pin saves", stop: "after 14 days" };
    const r = plan(t, t);
    expect(r.accepted).toHaveLength(1);
    expect(r.refused[0].stop).toBe("ONE_TEST");
    // A test with no number or no stop is not a test (playbook rule 4).
    expect(plan({ kind: "test", business: "dream-wedding", what: "a second pin title" }).refused[0].stop).toBe("SHAPE");
    expect(plan({ kind: "test", business: "dream-wedding", what: "x", number: "saves", stop: " " }).refused[0].stop).toBe("SHAPE");
  });
  it("an unknown kind is refused, never accepted by default; a Sequoia line is shape-checked", () => {
    expect(plan({ kind: "ai-fix", business: "dream-wedding", what: "x" }).refused[0].stop).toBe("UNKNOWN_KIND");
    expect(plan({ kind: "upgrade-buffer", business: "porch-and-party" }).refused[0].stop).toMatch(/UNKNOWN_KIND|NEEDS_MONEY|SPEND/);
    expect(plan({ kind: "sequoia-line", business: "dream-wedding", what: "Raise the pin cap?" }).accepted).toHaveLength(1);
    expect(plan({ kind: "sequoia-line", business: "dream-wedding", what: "x".repeat(301) }).refused[0].stop).toBe("SHAPE");
    expect(plan({ kind: "sequoia-line", business: "dream-wedding" }).refused[0].stop).toBe("SHAPE");
  });
  it("corporate Christmas outreach is open 1 Sep to 5 Dec of the same year, closed in January", () => {
    expect(corporateOpen("2026-12-05")).toBe(true);
    expect(corporateOpen("2026-12-06")).toBe(false);
    expect(corporateOpen("2027-01-10")).toBe(false);
    expect(corporateOpen("2026-09-01")).toBe(true);
    expect(corporateOpen("2026-08-31")).toBe(false);
  });
  it("P&P's first decision is bookings this season; pieces follow the season; corporate stops 5 Dec", () => {
    expect(plan({ kind: "decision", business: "porch-and-party", source: "grid", decision: "d" }).refused[0].stop).toBe("SEASON_FIRST");
    expect(plan({ kind: "decision", business: "porch-and-party", source: "pnp-season-bookings", decision: "d" }, { kind: "decision", business: "porch-and-party", source: "grid", decision: "d" }).accepted).toHaveLength(2);
    expect(season("2026-12-14")).toBe("christmas");
    expect(season("2026-12-15")).toBe("takedown");
    expect(season("2027-03-01")).toBe("spring");
    const late = plan({ kind: "studio-plan", business: "porch-and-party", pieces: [{ id: "p1", at: "2026-12-20 11:15", post: "reel", format: "real-montage", platforms: ["instagram"], theme: "christmas-porch", hook: "x" }] });
    expect(late.refused[0].why).toMatch(/out of season/);
    expect(checkPlan({ actions: [{ kind: "outreach-target", business: "porch-and-party", sender: "camille", list: "corporate-christmas", count: 10 }] }, { ...ctx, today: "2026-12-06" }).refused[0].stop).toBe("SEASON");
    expect(checkPlan({ actions: [{ kind: "outreach-target", business: "porch-and-party", sender: "camille", list: "corporate-christmas", count: 10 }] }, { ...ctx, today: "2027-01-10" }).refused[0].stop).toBe("SEASON");
    expect(plan({ kind: "outreach-target", business: "porch-and-party", sender: "noelle", list: "x", count: 1 }).refused[0].stop).toBe("SENDER");
  });
  it("Detox Denver and Cynthia Brown DDS are not hers", () => {
    expect(plan({ kind: "decision", business: "detox-denver", source: "grid" }).refused[0].stop).toBe("NOT_ON_ROSTER");
  });
  it("linked to-dos are kept or changed, never closed", () => {
    expect(plan({ kind: "linked", business: "dream-wedding", id: "olp_m80j27rk2cthq6jf", verdict: "drop" }).refused[0].stop).toBe("VERDICT");
    expect(plan({ kind: "linked", business: "dream-wedding", id: "olp_m80j27rk2cthq6jf", verdict: "keep" }).accepted).toHaveLength(1);
  });
});

describe("B2 + G14: every source read, fresh and decided", () => {
  const now = Date.parse("2026-11-23T18:00:00Z");
  const fresh = Object.fromEntries(READ_SOURCES.map((s: any) => [s.id, { at: "2026-11-22T10:00:00Z", sha: "abc", rows: 3 }]));
  it("a missing, failed, stale or empty source is a named stop", () => {
    expect(sourceProblems(fresh, now)).toEqual([]);
    const bad = { ...fresh, kdp: undefined, grid: { error: "403" }, calendar: { at: "2026-11-10T00:00:00Z", rows: 2 }, "pbs-waitlist": { at: "2026-11-22T00:00:00Z", rows: 0 } };
    expect(sourceProblems(bad, now).map((p: any) => `${p.source}:${p.stop}`).sort()).toEqual(["calendar:SOURCE_STALE", "grid:SOURCE_NOT_READ", "kdp:SOURCE_NOT_READ", "pbs-waitlist:SOURCE_EMPTY"]);
  });
  it("every business owes a decision on each of its sources", () => {
    const owed = missingDecisions(roster, []);
    expect(owed.some((o: any) => o.business === "peace-be-still" && o.source === "pbs-waitlist")).toBe(true);
    expect(owed.some((o: any) => o.business === "dream-wedding" && o.source === "pbs-waitlist")).toBe(false);
  });
});

describe("G15 + G16: closing, did-not-run, escalation, budget, slot", () => {
  it("closes only the eight growth# rows and keeps the three by id", () => {
    expect(CLOSE_ONLY).toHaveLength(8);
    expect(KEEP_OPEN).toEqual(["olp_m80j27rk2cthq6jf", "olp_m80j27mr2tp3y0vd", "olp_m84qabp137xc5w7x"]);
  });
  it("no run row by 22:00 → 'Noelle did not run'; a recorded run → nothing", () => {
    expect(didNotRunLine([], "2026-11-23")).toMatch(/Noelle did not run on 2026-11-23/);
    expect(didNotRunLine([{ day: "2026-11-23" }], "2026-11-23")).toBeNull();
  });
  it("the same stop three days running is ONE line; two days is none", () => {
    const r = (day: string, stops: string[]) => ({ day, stops });
    expect(escalations([r("2026-11-21", ["SOURCE_STALE"]), r("2026-11-22", ["SOURCE_STALE"]), r("2026-11-23", ["SOURCE_STALE", "X"])])).toHaveLength(1);
    expect(escalations([r("2026-11-21", ["A"]), r("2026-11-22", ["SOURCE_STALE"]), r("2026-11-23", ["SOURCE_STALE"])])).toHaveLength(0);
    expect(escalations([r("2026-11-19", ["SOURCE_STALE"]), r("2026-11-22", ["SOURCE_STALE"]), r("2026-11-23", ["SOURCE_STALE"])])).toHaveLength(0); // a gap is not "running"
  });
  it("run and week Claude-call budgets end in named stops", () => {
    expect(callBudget({ runUsed: RUN_CALLS }).stop).toMatch(/RUN_CALL_CAP/);
    expect(callBudget({ weekUsed: WEEK_CALLS }).stop).toMatch(/WEEK_CALL_BUDGET/);
    expect(callBudget({}).left).toBe(RUN_CALLS);
  });
  it("the slot varies 10:00-21:59, never on the hour; Thursday's is after 14:00", () => {
    const slots = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"].map(slotFor);
    for (const s of slots) { expect(s.hour).toBeGreaterThanOrEqual(10); expect(s.hour).toBeLessThanOrEqual(21); expect(s.minute).not.toBe(0); }
    expect(slots[3]).toMatchObject({ kind: "weekly" });
    expect(slots[3].hour).toBeGreaterThanOrEqual(14);
    expect(new Set(slots.map((s) => `${s.hour}:${s.minute}`)).size).toBeGreaterThan(3);
  });
});

describe("the plan and the notice", () => {
  it("reads the last plan between sentinels; junk is null", () => {
    expect(parsePlan(`x ${PLAN_BEGIN}{"actions":[]}${PLAN_END}`)).toEqual({ actions: [] });
    expect(parsePlan(`${PLAN_BEGIN}{nope${PLAN_END}`)).toBeNull();
    expect(parsePlan("no plan")).toBeNull();
  });
  it("one Notices line in her words", () => {
    expect(noticeLine({ label: "Porch & Party", what: "December reel", where: "Instagram", link: "https://x" })).toBe("Noelle published: Porch & Party December reel Instagram https://x");
  });
});
