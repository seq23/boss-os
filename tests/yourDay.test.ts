/**
 * SIMONE'S "YOUR DAY" AND MONDAY "YOUR WEEK" (owner-approved 22 Oct 2026, Review Pack mock-ups).
 * Built from fixtures shaped like the live reads (fake names: the repo is public).
 */
import { describe, expect, it } from "vitest";
import { buildDay, buildWeek, replyContext } from "../scripts/ops/your-day.mjs";
import { plainProblems } from "../src/shared/boss/mail/plain.mjs";
import { sendersFor, employeeMail } from "../scripts/ops/notify.mjs";

// Thursday 22 Oct 2026, 06:40 Central (11:40 UTC).
const NOW = Date.parse("2026-10-22T11:40:00Z");
const at = (iso: string) => Date.parse(iso);
const DATA = {
  diary: [
    { title: "Call with Example Partners", with: "A. Person", scheduled_at: at("2026-10-22T15:00:00Z"), location: null },
    { title: "Board prep", with: null, scheduled_at: at("2026-10-27T14:30:00Z"), location: null },
  ],
  tasks: [
    { id: "tsk_a1b2c3d4", title: "2 comments on the channel need your word", status: "awaiting_approval", employee_id: "emp_relationship", employee_name: "Monique", due: null },
    { id: "tsk_b1b2c3d4", title: "Research referral fees", status: "running", employee_id: "emp_research", employee_name: "Camille", due: "2026-10-23T22:00:00Z" },
    { id: "tsk_c1b2c3d4", title: "Make the cover", status: "failed", employee_id: "emp_chief", employee_name: "Simone", finished_at: NOW - 3_600_000, due: null },
  ],
  approvals: [{ id: "apr_x1", title: "Renew the example.com domain" }],
  repoChanges: [{ id: "rc_x1", repo: "creator-studios", phase: "asking" }],
  roster: [
    { id: "emp_relationship", name: "Monique", duties: 9, health: "green" },
    { id: "emp_research", name: "Camille", duties: 3, health: "green" },
    { id: "emp_repo", name: "Danielle", duties: 4, health: "green" },
    { id: "emp_risk", name: "Toni", duties: 3, health: "green" },
  ],
  alerts: 2, openLoops: 0,
  briefing: { for_day: "2026-10-22", headline: "Markets flat, rates unchanged" },
  feed: { items: [
    { kind: "deadline", title: "9:00 AM · Riley M. · Party setup", detail: "", due: "2026-10-22" },
    { kind: "money", title: "Jordan P. · Waiting for deposit", detail: "$180 due ($130 + $50 refundable deposit)", due: null },
  ] },
};

const order = (text: string, heads: string[]) => heads.map((h) => text.indexOf(h));

describe("Your day", () => {
  const e = buildDay(DATA, NOW);
  it("is plain, and in her order: yours today, Valerie's box, the team, loose ends, the briefing", () => {
    expect(plainProblems(e)).toEqual([]);
    const idx = order(e.text, ["What I need from you:", "Yours today", "Porch & Party: To do for Valerie", "What the team is doing", "Loose ends", "This morning's briefing"]);
    expect(idx.every((n) => n >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(e.subject).toBe("Your day: 4 things for you");
    expect(e.text.split("\n")[0]).toBe("Good morning. Here is your Thursday, October 22.");
  });
  it("lists only what the data holds — the call, the decision, the plan, the held task — and nothing else", () => {
    const yours = e.text.slice(e.text.indexOf("Yours today"), e.text.indexOf("Porch & Party")).split("\n").filter((l) => l.startsWith("- "));
    expect(yours).toEqual([
      "- 10 am: Call with Example Partners with A. Person.",
      "- Decide: Renew the example.com domain — it is in your Inbox.",
      "- Approve Danielle's plan for creator-studios — reply approved to her email to start the build.",
      "- Approve or change: 2 comments on the channel need your word (Monique).",
    ]);
    expect(e.text).toContain("- 9:00 AM · Riley M. · Party setup");
    expect(e.text).toContain("- Money: Jordan P. · Waiting for deposit — $180 due ($130 + $50 refundable deposit)");
    expect(e.text).toContain('- Simone could not finish "Make the cover"');
    expect(e.text).toContain("- 2 high alerts on your Today page.");
    expect(e.text).toContain("Markets flat, rates unchanged. The full briefing is on your Today page");
    expect(e.text).toContain('Reply to this email to change anything — for example "move the KDP item to Monday".');
    expect(e.refs).toEqual(["yd_20261022"]);
  });
  it("an empty day says so, section by section, in one line each; an unreadable site says so", () => {
    const empty = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], roster: [], alerts: 0, openLoops: 0, briefing: null, feed: null, feedError: "the site answered 401" }, NOW);
    expect(plainProblems(empty)).toEqual([]);
    expect(empty.subject).toBe("Your day: nothing needs you");
    expect(empty.text).toContain("What I need from you: Nothing — this is just so you know.");
    expect(empty.text).toContain("I could not read the Porch & Party site this morning (the site answered 401).");
    expect(empty.text).toContain("Nobody has anything open right now.");
    expect(empty.text).toMatch(/Loose ends\nNone\./);
    const clear = buildDay({ ...DATA, feed: { items: [] } }, NOW);
    expect(clear.text).toContain("All clear for Valerie today.");
  });
  it("goes out through employeeMail as laid out, signed by Simone, with its code in the header", () => {
    process.env.BOSS_OS_MAIL_KEY = "test-key-not-real";
    const p = employeeMail(sendersFor("Simone")[0]!, { to: "owner@example.com", subject: e.subject, text: e.text, prelaid: e });
    expect(p.html).toBe(e.html);
    expect(p.headers).toEqual({ "X-Boss-Ref": "yd_20261022" });
    expect(p.html).toContain("faf6ec"); // Valerie's box is the calm boxed panel.
    delete process.env.BOSS_OS_MAIL_KEY;
  });
});

describe("what her reply carries to Simone's task", () => {
  it("keeps the list she is answering and leaves the calendar lines (people's names) out", () => {
    const day = replyContext(buildDay(DATA, NOW).text);
    expect(day).toContain("Approve Danielle's plan for creator-studios");
    expect(day).toContain("Porch & Party: To do for Valerie");
    expect(day).not.toMatch(/Example Partners|A\. Person/);
    const week = replyContext(buildWeek(DATA, NOW).text);
    expect(week).not.toMatch(/Your calendar|Example Partners|Board prep/);
    expect(week).toContain("Research referral fees");
  });
});

describe("Your week (Mondays)", () => {
  const w = buildWeek(DATA, NOW);
  it("deadlines, her calendar, replies waiting, Valerie's week, the team — plain and in that order", () => {
    expect(plainProblems(w)).toEqual([]);
    const idx = order(w.text, ["Deadlines", "Your calendar", "Replies waiting on you", "Porch & Party: Valerie's week", "What the team is doing this week"]);
    expect(idx.every((n) => n >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(w.text).toContain("- Fri: Research referral fees (Camille).");
    expect(w.text).toContain("- Thu — Call with Example Partners at 10 am.");
    expect(w.text).toContain("- Fri, Sat, Sun, Mon — clear.");
    expect(w.text).toContain("- Tue — Board prep at 9:30 am.");
    expect(w.text).toContain("- Danielle — 1 open: creator-studios change (waiting on your approved).");
    expect(w.text).toContain("- Toni — 3 regular jobs on schedule; nothing open right now.");
    expect(w.refs).toEqual(["yd_20261022w"]);
  });
});
