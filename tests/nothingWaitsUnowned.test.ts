/**
 * Nothing that waits goes unowned (owner-approved 26 Oct 2026): Zora's register, Danielle's dated
 * measurements, her own list, Kendra's clean-up, Monique's pre-seed watch. Fake names only.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { zoraPass, yoursThisWeek, todoEditsIn, matchTodo } from "../src/shared/boss/waiting/register.mjs";
import { measuringLine } from "../scripts/ops/waiting-on.mjs";
import { pickWorktrees, pickRenders, pickPlaywright, lowDiskLine, forbidden } from "../scripts/ops/mac-cleanup.mjs";
import { crossedRow, fundedRow, compareLists, preseedLine, companyOf } from "../src/shared/boss/capital/preseed.mjs";
import { recipientsOf } from "../scripts/ops/warm-references.mjs";
import { buildDay } from "../scripts/ops/your-day.mjs";
import os from "node:os";
import path from "node:path";

const DAY = 86_400_000;
const MON = Date.parse("2026-11-02T13:00:00Z"); // Monday 2 Nov 2026, 07:00 Central
const TUE = MON + DAY;
const MIG = readFileSync("migrations/0313_boss_nothing_that_waits_goes_unowned.sql", "utf8");

describe("Zora's register", () => {
  const item = (over: any) => ({ id: "w", kind: "measurement", what: "x", owner: "emp_repo", due_on: "2026-11-02", action: "measure", state: "open", ...over });
  it("acts on today's dates, and anything unowned or overdue with nothing to do is a repair", () => {
    const { act, repair } = zoraPass([item({ id: "a" }), item({ id: "b", due_on: "2026-11-09" }), item({ id: "c", owner: null }), item({ id: "d", due_on: "2026-10-30", action: null }), item({ id: "e", state: "actioned" }), item({ id: "f", kind: "her_todo", owner: "sequoia", due_on: null, action: null })], MON);
    expect(act.map((i: any) => i.id)).toEqual(["a"]);
    expect(repair.map((r: any) => [r.item.id, r.why])).toEqual([["c", "it has no owner"], ["d", "its date (2026-10-30) has passed and nothing is set to happen"]]);
    expect(measuringLine(item({ what: "Hubs indexed" }))).toBe("Measuring today: Hubs indexed. If it is missed, the fix starts the same day.");
  });
  it("is seeded with every item of 26 Oct, each owned and dated where a date was given", () => {
    for (const [id, owner, due] of [["wo_wpp_thin", "emp_repo", "2026-11-02"], ["wo_memphis_vendors", "emp_repo", "2026-11-08"], ["wo_pnp_hubs", "emp_repo", "2026-11-15"], ["wo_local_guides", "emp_repo", "2026-11-15"], ["wo_approvalprep", "emp_repo", "2026-11-15"], ["wo_neuro_leads", "emp_repo", "2026-11-15"], ["wo_wedding_cpg", "emp_repo", "2026-11-16"], ["wo_wpp_dupes", "emp_repo", "2026-11-22"]]) {
      expect(MIG, id).toMatch(new RegExp(`\\('${id}', 'measurement', '[^']*(?:''[^']*)*', '${owner}', '${due}'`));
    }
    for (const id of ["wo_lp_replies", "wo_unsubscribe", "wo_pnp_social"]) expect(MIG).toContain(`('${id}'`);
    for (const d of ["'duty_waiting_on', 'Nothing that waits goes unowned', 'emp_knowledge'", "'duty_mac_cleanup', 'Keep the Mac''s disk from filling up', 'emp_continuity'", "'duty_preseed_watch', 'Pre-seed watch', 'emp_relationship'"]) expect(MIG).toContain(d);
  });
});

describe("Yours this week", () => {
  const todo = (over: any) => ({ id: "t", kind: "her_todo", what: "Porch & Party: set up Instagram, TikTok and Buffer", owner: "sequoia", state: "open", due_on: null, told_at: null, ...over });
  it("is told once, then Mondays or two days before its date, never daily", () => {
    expect(yoursThisWeek([todo({})], TUE)).toHaveLength(1);
    expect(yoursThisWeek([todo({ told_at: MON })], TUE)).toHaveLength(0);
    expect(yoursThisWeek([todo({ told_at: MON })], MON + 7 * DAY)).toHaveLength(1);
    expect(yoursThisWeek([todo({ told_at: MON, due_on: "2026-11-05" })], TUE)).toHaveLength(1);
  });
  it("her reply adds and ticks off; an ordinary sentence changes nothing", () => {
    expect(todoEditsIn("add to my list: call the printer\ndone: Instagram")).toEqual({ add: ["call the printer"], done: ["Instagram"] });
    expect(todoEditsIn("Add: the deck to Thursday's agenda").add).toEqual([]);
    expect(matchTodo([todo({})], "Instagram")?.id).toBe("t");
    expect(matchTodo([todo({})], "sent it")).toBeNull();
  });
  it("shows in the morning email when due", () => {
    const e = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, morning: {}, waiting: [todo({})], told: { decide: {}, done: [] } } as any, TUE);
    expect(e.text).toContain("Yours this week");
    expect(e.text).toContain("Porch & Party: set up Instagram, TikTok and Buffer");
    expect(e.yoursTold).toEqual(["t"]);
  });
});

describe("Kendra keeps the Mac's disk from filling up", () => {
  const NOW = Date.parse("2026-11-01T15:00:00Z");
  const t = (over: any) => ({ path: "/Users/x/GitHub/a-wt", main: false, touched_at: NOW - 3 * DAY, dirty: false, on_remote: true, unpushed: 0, ...over });
  it("removes only old, clean, pushed worktrees; lists unpushed; never touches a fresh one or the main checkout", () => {
    const { remove, list } = pickWorktrees([t({ path: "old" }), t({ path: "fresh", touched_at: NOW - 3_600_000 }), t({ path: "dirty", dirty: true }), t({ path: "local", on_remote: false }), t({ path: "ahead", unpushed: 2 }), t({ path: "main", main: true })], NOW);
    expect(remove.map((x: any) => x.path)).toEqual(["old"]);
    expect(list.map((x: any) => x.path)).toEqual(["ahead"]);
    expect(forbidden(path.join(os.homedir(), "Documents", "x"))).toBe(true);
    expect(pickWorktrees([t({ path: path.join(os.homedir(), "Desktop", "wt") })], NOW).remove).toEqual([]);
  });
  it("deletes a render only when it is old AND published; keeps sidecars; keeps the newest browser", () => {
    const files = [{ name: "01-deep-sea-final.mp4", mtime: NOW - 20 * DAY }, { name: "01-deep-sea-final.mp4.render.json", mtime: NOW - 20 * DAY }, { name: "whales-final.mp4", mtime: NOW - 20 * DAY }, { name: "deep-sea-final.mp4", mtime: NOW - 3 * DAY }];
    expect(pickRenders(files, ["deep-sea"], NOW).map((f: any) => f.name)).toEqual(["01-deep-sea-final.mp4"]);
    expect(pickPlaywright(["chromium-1200", "chromium-1243", "chromium_headless_shell-1243", "ffmpeg-1011"])).toEqual(["chromium-1200"]);
    expect(lowDiskLine(25, 3, [])).toBeNull();
    expect(lowDiskLine(14.2, 6.5, ["Caches 40 GB"])).toBe("Mac disk: 14 GB free; cleaned 6.5 GB; biggest: Caches 40 GB.");
  });
});

describe("Monique's pre-seed watch", () => {
  it("reads a pitch in her sectors, not a newsletter; reads a round from a headline as reported; compares", () => {
    const pitch = crossedRow({ subject: "Acme Robotics | raising our $2M pre-seed", snippet: "robotics for warehouses", from: "founder@acmerobotics.example", from_name: "Jo Fake", date: "2026-10-20", url: "u" });
    expect(pitch).toMatchObject({ company: "Acme Robotics", sector: "Deeptech", round: "$2M pre-seed", from: "Jo Fake" });
    expect(crossedRow({ subject: "This week's pre-seed rounds", snippet: "fintech", from: "news@digest.example", newsletter: true })).toBeNull();
    expect(companyOf({ subject: "Pre-seed deck", from: "x@gmail.com" })).toBeNull();
    const funded = fundedRow({ title: "Fakeco raises $1.5M pre-seed led by Sample Ventures to build AI agents for clinics - Publisher" });
    expect(funded).toMatchObject({ company: "Fakeco", round: "$1.5M pre-seed (reported)", lead: "Sample Ventures", what: "build AI agents for clinics", sector: "AI" });
    expect(fundedRow({ title: "Fakeco raises $1.5M seed round" })).toBeNull();
    const cmp = compareLists([pitch], [funded, { ...funded, company: "Other", sector: "Deeptech" }]);
    expect(cmp.alike.map((a: any) => a.sector)).toEqual(["Deeptech"]);
    expect(cmp.gaps.map((g: any) => g.sector)).toEqual(["AI"]);
    expect(preseedLine([pitch], [funded], cmp)).toBe("Pre-seed watch: 1 company crossed your desk; 1 pre-seed round was announced in the market. Not reaching you: AI.");
  });
});

describe("warm references from her sent mail", () => {
  it("are stored against the people she wrote to, never herself", () => {
    expect(recipientsOf([{ name: "To", value: "Jo Fake <jo@fund.example>, me <sequoia@westpeek.ventures>" }, { name: "Cc", value: "ann@fund.example" }, { name: "Subject", value: "x@y.example" }]))
      .toEqual(["jo@fund.example", "ann@fund.example"]);
  });
});
