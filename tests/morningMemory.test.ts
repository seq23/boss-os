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
// Only the "Done for you" section itself: from its heading to the blank line that ends it. (Reading on to
// "Porch & Party" counted Monday's other sections, e.g. the Brains line, as done lines.)
const doneLines = (text: string) => {
  const at = text.indexOf("Done for you");
  expect(at).toBeGreaterThanOrEqual(0);
  const rest = text.slice(at);
  const end = rest.indexOf("\n\n");
  return (end < 0 ? rest : rest.slice(0, end)).split("\n").filter((l) => l.startsWith("- "));
};

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
    // 18 Nov 2026: the carried line is a preview: whose turn, which way the days run, and its links.
    const line = day2.text.split("\n").find((l) => l.startsWith("- Answer Ken Example"))!;
    expect(line).toMatch(/Yours to answer: they've waited 12 days\..*Open ›: https:\/\//);
    expect(thinDecideLine(lpDecide, "2026-10-26", TUE)!.length).toBeLessThan(120);
    expect(day2.html).toContain("Still yours to answer");
    expect(day2.digest.still_yours).toHaveLength(1);
    // The thin line keeps the person's key, so the third-reminder rule can count it (6 Nov 2026).
    expect(day2.digest.still_yours[0].key).toBe(day1.digest.decide[0].key);
    expect(day2.digest.still_yours[0].key).toBeTruthy();
  });
});

describe("every 'Still yours to answer' row names the thing waiting (14 Nov 2026)", () => {
  // The live row read "No answer in 9 days · 2 days": the label kept the status before the colon and
  // dropped the person after it. A row with no name at all is left out, never sent empty.
  const nudge = { key: "lpnudge:lpr_test2", title: "No answer in 9 days: nudge Jo Example at Example Capital?", body: "One gentle nudge, only if you say yes.", priority: 4, buttons: [] };
  const nameless = { key: "lp:lpr_test3", title: "", body: "Something.", priority: 4, buttons: [] };
  const with2 = (now: number, told?: any) => ({ ...base(now, told), morning: { lp: { section: "lp", at: new Date(now).toISOString(), decide: [nudge, nameless] } } });
  const day1 = buildDay(with2(MON), MON);
  const day2 = buildDay(with2(TUE, day1.memory), TUE);
  const still = day2.digest.still_yours as Array<{ line: string }>;
  it("the nudge row says who, not only how long", () => {
    const row = still.find((s) => /Jo Example/.test(s.line));
    expect(row?.line).toBe("Still yours to answer: Nudge Jo Example at Example Capital? · 1 day");
  });
  it("no row is only a status or a count", () => {
    expect(still.length).toBeGreaterThan(0);
    for (const s of still) expect(s.line).not.toMatch(/^Still yours to answer:\s*(?:·|No answer in \d+ days? ·)/);
    expect(day2.text).not.toMatch(/^- (?:·|No answer in \d+ days? ·)/m);
  });
});

describe("Done for you: once, never doubled, compact", () => {
  const day1 = buildDay(base(MON), MON);
  it("three failures of one job are ONE short whole-sentence line; three lines at most and nothing after them", () => {
    const lines = doneLines(day1.text);
    expect(lines.filter((l) => /Executive Intelligence Report/.test(l))).toHaveLength(1);
    expect(lines[0]).toMatch(/^- Camille's "Executive Intelligence Report" job stopped; Danielle is fixing it\. — See it/);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) expect(l).not.toMatch(/\+\d+ more/);
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

describe("a job with an empty title is named, never empty quotes (2 Nov 2026)", () => {
  it("drops wordless quoted parts and falls back to the job's kind", () => {
    // Jobs she asked for by email keep their own line (a team repair is one count line since 7 Nov 2026).
    const blank = { id: "t9", title: 'Finish the job from her email "; "', status: "failed", employee_name: "Danielle", finished_at: MON - 1_000, input: JSON.stringify({ from: "owner@example.com", kind: "repair" }) };
    const none = { ...blank, id: "t8", title: '""' };
    const e = buildDay({ ...base(MON), tasks: [blank], morning: {} }, MON);
    expect(e.text).toContain('Danielle\'s "Finish the job from her email" job stopped');
    expect(e.text).not.toMatch(/""|"; "/);
    const e2 = buildDay({ ...base(MON), tasks: [none], morning: {} }, MON);
    expect(e2.text).toContain("Danielle's repair job stopped");
    expect(e2.text).not.toContain('""');
  });

  // 7 Nov 2026: one line for all of them; 18 Nov 2026: that line names each job and says whether money or outreach is touched.
  it("stopped team jobs are ONE line naming each job and whether money or outreach is touched", () => {
    const rep = { id: "t7", title: "Fix a held email: a synthetic one", status: "failed", employee_name: "Danielle", employee_id: "emp_repo", finished_at: MON - 1_000, input: JSON.stringify({ origin: "repair", repair_kind: "held_mail" }) };
    const duty = { id: "t6", title: "Tools worth knowing about", status: "failed", employee_name: "Kendra", finished_at: MON - 2_000, input: JSON.stringify({ delivers: "tool_suggestions" }) };
    const e = buildDay({ ...base(MON), tasks: [rep, duty], morning: {} }, MON);
    const lines = e.text.split("\n").filter((l) => /Danielle is fixing/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Tools worth knowing about");
    expect(lines[0]).toContain("Fix a held email");
    expect(lines[0]).toMatch(/touch(?:es)? outreach or money|touches money or outreach/);
    const send = { ...duty, id: "t5", title: "Time2Read outreach sends" };
    expect(buildDay({ ...base(MON), tasks: [send], morning: {} }, MON).text).toMatch(/Time2Read outreach sends touches outreach or money, so nothing goes out/i);
  });
});

describe("a repair is never a decision (owner, 7 Nov 2026)", () => {
  it("a repair task waiting on approval is not in Decide; her own task waiting on approval is", () => {
    const rep = { id: "t5", title: "Fix Kendra's alarm: a synthetic duty", status: "awaiting_approval", employee_name: "Kendra", input: JSON.stringify({ origin: "repair", repair_kind: "kendra_alarm" }) };
    const hers = { id: "t4", title: "Friday unsubscribe suggestions", status: "awaiting_approval", employee_name: "Danielle", input: JSON.stringify({ from: "owner@example.com" }) };
    const e = buildDay({ ...base(MON), tasks: [rep, hers], approvals: [], morning: {} }, MON);
    expect(e.text).not.toContain("Fix Kendra's alarm");
    expect(e.text).toContain("Friday unsubscribe suggestions");
  });
});

describe("a dated check-in that needs her own account is still hers (7 Nov 2026)", () => {
  it("the Friday unsubscribe taps stay in Decide", () => {
    const wo = { id: "t3", title: "Friday unsubscribe suggestions: senders she never opens", status: "awaiting_approval", employee_name: "Danielle", input: JSON.stringify({ origin: "repair", repair_kind: "waiting_on" }) };
    expect(buildDay({ ...base(MON), tasks: [wo], approvals: [], morning: {} }, MON).text).toContain("Friday unsubscribe suggestions");
  });
});
