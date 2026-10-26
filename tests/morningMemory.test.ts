/**
 * WHAT THE MORNING EMAIL ALREADY TOLD HER (owner, 26 Oct 2026). Three rulings, pinned on the real
 * builder (buildDay) across two mornings: a Decide item she has seen is one thin line; Done for you
 * never repeats, never doubles, at most three short lines; one fix job per failed job family.
 */
import { describe, expect, it } from "vitest";
import { buildDay } from "../scripts/ops/your-day.mjs";
import { jobFamily, firstSentence, fixJobsToOpen, thinDecideLine } from "../src/shared/boss/mail/morningMemory.mjs";

const MON = Date.parse("2026-10-26T12:15:00Z");
const TUE = Date.parse("2026-10-27T12:15:00Z");
const lpDecide = { key: "lp-again:lpr_test1", title: "Waiting 12 days: Answer Ken Example: they wrote back after your reply", body: "They asked for a call next week.", details: ["History: three emails."], priority: 16, buttons: [{ label: "Send as is", url: "https://mail.google.com/mail/u/0/#all/x1" }] };
const failed = (id: string, title: string, finished: number) => ({ id, title, status: "failed", employee_name: "Camille", error: "Codex answered without running a single web search, so what it wrote was not used: a research report is believed only wi", finished_at: finished });
const base = (now: number, told?: any) => ({
  diary: [], approvals: [], repoChanges: [], briefing: null, feed: null, told,
  tasks: [failed("t1", "Executive Intelligence Report", now - 3_600_000), failed("t2", "Executive Intelligence Report", now - 7_200_000), failed("t3", 'Find why "Executive Intelligence Report" failed', now - 1_000)],
  morning: { lp: { section: "lp", at: new Date(now).toISOString(), decide: [lpDecide] }, tail: { section: "tail", at: new Date(now).toISOString(), lines: ["One. Two.", "Line b.", "Line c.", "Line d."] } },
});
const doneLines = (text: string) => text.slice(text.indexOf("Done for you"), text.indexOf("Porch & Party")).split("\n").filter((l) => l.startsWith("- "));

describe("a Decide item she has already seen is one thin line", () => {
  const day1 = buildDay(base(MON), MON);
  const day2 = buildDay(base(TUE, day1.memory), TUE);
  it("day 1: the full card, counted in the subject", () => {
    expect(day1.subject).toMatch(/1 decision/);
    expect(day1.text).toContain("They asked for a call next week.");
  });
  it("day 2+: one line under 120 characters, kept, not a fresh decision", () => {
    expect(day2.subject).not.toMatch(/decision/);
    expect(day2.text).not.toContain("They asked for a call next week.");
    const line = day2.text.split("\n").find((l) => l.startsWith("- Ken Example (LP)"))!;
    expect(line).toMatch(/^- Ken Example \(LP\) · 12 days — Open ›: https:\/\//);
    expect(thinDecideLine(lpDecide, "2026-10-26", TUE).length).toBeLessThan(120);
    expect(day2.html).toContain("Still yours to answer");
    expect(day2.digest.still_yours).toHaveLength(1);
  });
});

describe("Done for you: once, never doubled, compact", () => {
  const day1 = buildDay(base(MON), MON);
  it("three failures of one job are ONE short whole-sentence line; three lines at most, then +N more", () => {
    const lines = doneLines(day1.text);
    expect(lines.filter((l) => /Executive Intelligence Report/.test(l))).toHaveLength(1);
    expect(lines[0]).toMatch(/^- Camille's "Executive Intelligence Report" job stopped; Danielle is fixing it\. — See it/);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(lines.at(-1)).toMatch(/^- \+\d+ more on Today — Open ›/);
    for (const l of lines) expect(l).not.toMatch(/What happened|What we did|Status:|believed only wi\b/);
  });
  it("never repeats on a later morning", () => {
    const day2 = buildDay(base(TUE, day1.memory), TUE);
    expect(day2.text).not.toMatch(/Executive Intelligence Report" job stopped/);
  });
  it("a line is cut at a sentence, never mid-word", () => {
    expect(firstSentence("What happened: Camille's report stopped. It was believed only wi")).toBe("Camille's report stopped.");
  });
});

describe("one fix job per failed job family", () => {
  const tasks = base(MON).tasks;
  it("two failures of one job and a failed repair of it open one job; none while a repair is open", () => {
    expect(jobFamily('Find why "Find why "Executive Intelligence Report" failed" failed')).toBe("Executive Intelligence Report");
    expect(fixJobsToOpen(tasks, { tasks }).map((j) => j.family)).toEqual(["Executive Intelligence Report"]);
    const open = [{ origin: "repair", phase: "plan", task_title: 'Find why "Executive Intelligence Report" failed' }];
    expect(fixJobsToOpen(tasks, { tasks, repoChanges: open })).toEqual([]);
  });
});

describe("a prospect-template card is the live one or nothing (26 Oct 2026)", () => {
  it("a section file's card for a template that is no longer waiting is dropped when the live activity is read", () => {
    const card = { key: "prospect-template:ptp_old", title: "Approve the prospect email before it goes out", body: "17 addresses held.", buttons: [] };
    const d = { ...base(MON), tasks: [], morning: { prospects: { section: "prospects", at: new Date(MON).toISOString(), decide: [card] } } };
    expect(buildDay({ ...d, prospects: { approved: { id: "ptp_new" }, pending: null, totals: {}, next: [], sent: [], replies: [] } }, MON).text).not.toContain("17 addresses held.");
    expect(buildDay(d, MON).text).toContain("17 addresses held."); // no live read: the producer's card stands
  });
});
