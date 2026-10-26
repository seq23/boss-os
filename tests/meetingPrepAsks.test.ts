/**
 * SIMONE'S PREP IS NEVER EMPTY (owner, 26 Oct 2026: "simone sent me an email about prep for my meeting
 * ... but nothing is inside - this feels lazy she should ask what the meeting is about and offer to
 * help me"). Fixtures only, fake names and example domains (the repo is public).
 *
 *   1. Nothing found about the purpose → the email OPENS WITH THE QUESTION and offers 2–3 concrete
 *      ways to help, built from what was found. Never the bare logistics email.
 *   2. A rich context → the real prep: who they are, how she knows them, what it is about, goals,
 *      what to have ready, what is open between them (a bounce), logistics.
 *   3. Her reply → the finished prep, in the same thread, from Simone (the Worker half is
 *      tests/boss/meetingPrepReply.test.ts).
 *   4. The length is the calendar's own end minus its start, shown in her zone (Eastern).
 */
import { describe, expect, it } from "vitest";
import { buildPrep, PREP_QUESTION, inviteNotes, companyDomain, purposeOf } from "../src/shared/boss/meetingPrep/prep.mjs";
import { prepEmail, readContext, readPlan, lineFits, gatherContext, finishPrep, mergeWorkspaceMail, contextPrompt } from "../scripts/ops/meeting-prep.mjs";
import { employeeMail } from "../scripts/ops/notify.mjs";
import { plainProblems, NOTHING_TO_DECIDE } from "../src/shared/boss/mail/plain.mjs";
import { parseIcs } from "../scripts/ops/ics.mjs";

// Tuesday 27 Oct 2026, 10:00am Eastern (14:00 UTC), 2.5 hours, as she set it.
const TUE_10_ET = Date.parse("2026-10-27T14:00:00Z");
const meeting = {
  calendar_uid: "jo1", ical_uid: "jo1@google.com", title: "Sequoia + Jo (Fake Co)", scheduled_at: TUE_10_ET, duration_min: 150,
  join_url: "https://meet.google.com/aaa-bbbb-ccc", location: null, description: null,
  attendees: [{ email: "seq.taylor@gmail.com", self: true }, { email: "jo@fakeco.example.org" }],
};
const EMPTY = { mail: { count: 0, recent: [] }, bounces: [], meetings: [], cards: [], unanswered: null, purpose_hint: null, site: null };
const RICH = {
  mail: { count: 14, more: false, first: { date: "2010-05-26", subject: "hey" }, recent: [{ date: "2017-05-06", subject: "An intro to a friend", from_them: false, snippet: "You introduced them to a friend." }] },
  bounces: [{ address: "jo.old@mailbox.example.net", date: "2026-10-25" }],
  meetings: [{ date: "2025-03-02", title: "Coffee with Jo" }],
  cards: [], unanswered: null, purpose_hint: null,
  site: { domain: "fakeco.example.org", title: "Fake Co", about: "Legal services for creative businesses." },
};

describe("no purpose found: the prep asks, and offers to help", () => {
  it("opens with the question, offers 2–3 concrete ways, and is never the bare logistics email", () => {
    for (const context of [EMPTY, RICH]) {
      const m = prepEmail(meeting, {}, { context });
      const t = m.laid.text;
      expect(m.needsPurpose).toBe(true);
      expect(t.split("\n")[0]).toBe(PREP_QUESTION);
      expect(t).toContain("Decide (1)");
      expect(t).not.toContain(NOTHING_TO_DECIDE);
      const offers = m.decide[0].details as string[];
      expect(offers.length).toBeGreaterThanOrEqual(2);
      expect(offers.length).toBeLessThanOrEqual(3);
      if (context === EMPTY) expect(offers).toEqual(["Draft a short follow-up email for after the call.", "Write talking points once you tell me the goal."]);
      expect(plainProblems({ subject: m.laid.subject, text: t, html: m.laid.html })).toEqual([]);
    }
  });

  it("the offers come from what was found: their site, the history, the bounce", () => {
    const offers = prepEmail(meeting, {}, { context: RICH }).decide[0].details as string[];
    expect(offers[0]).toBe("Research Fake Co from their website (fakeco.example.org) and give you three questions to ask.");
    expect(offers[1]).toBe("Sum up your history with them (14 emails since May 2010) in five lines.");
    expect(offers[2]).toContain("your email to jo.old@mailbox.example.net bounced, and the invite went to jo@fakeco.example.org");
  });

  it("what was found still shows under the question: who, how she knows them, the bounce", () => {
    const m = prepEmail(meeting, {}, { context: RICH });
    expect(m.sections.map((s: any) => s.title)).toEqual(["Who they are", "How you know them", "Open between you", "Logistics"]);
    expect(m.laid.text).toContain("You have emailed each other since May 2010: 14 emails found.");
    expect(m.laid.text).toContain("Your email to jo.old@mailbox.example.net bounced on 25 Oct 2026: that address no longer works. The invite went to jo@fakeco.example.org.");
  });

  it("the gathering never invents: a seat run that fails leaves every source empty, so the prep asks", async () => {
    const ask = () => ({ ok: false, why: "no Gmail call in the run" });
    const fetchImpl = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const prev = process.env.GSC_SERVICE_ACCOUNT_JSON; delete process.env.GSC_SERVICE_ACCOUNT_JSON;
    const ctx = await gatherContext(meeting, {}, { ask, fetchImpl, log: () => {} });
    if (prev !== undefined) process.env.GSC_SERVICE_ACCOUNT_JSON = prev;
    expect(ctx).toMatchObject({ mail: { count: 0 }, bounces: [], site: null, purpose_hint: null });
    expect(buildPrep(meeting, {}, { context: ctx }).needsPurpose).toBe(true);
  });

  it("the seat is told to search by address, domain and name, read the threads, look for bounces and earlier meetings", () => {
    const p = contextPrompt({ name: "Jo", email: "jo@fakeco.example.org", domain: "fakeco.example.org", firm: "Fake Co", title: meeting.title, when: "Tue 27 Oct at 10am ET", today: "2026-10-26" });
    for (const w of ["from:jo@fakeco.example.org OR to:jo@fakeco.example.org", '"fakeco.example.org"', '"Fake Co"', "get_thread", "mailer-daemon", "search_events", "Never guess"]) expect(p).toContain(w);
    expect(companyDomain("someone@gmail.com")).toBeNull();
    expect(companyDomain("jo@fakeco.example.org")).toBe("fakeco.example.org");
  });
});

describe("a purpose found: the real prep", () => {
  const plan = readPlan({
    goals: ["Get them set up and working on one real task by the end.", "Find out which two or three jobs they most want help with.", "Agree what they do on their own next week."],
    ready: ["Their laptop, plugged in.", "Open the instructions file in your setup notes."],
    order: ["Install it.", "Run the setup.", "Try one real task.", "Agree next steps."],
  });

  it("carries what it's about, who they are, how she knows them, goals, running order, have ready, open between them, logistics", () => {
    const m = prepEmail(meeting, {}, { context: RICH, purpose: "A hands-on setup session for their new tool.", plan });
    expect(m.needsPurpose).toBe(false);
    expect(m.sections.map((s: any) => s.title)).toEqual(["What it's about (from you)", "Who they are", "How you know them", "Goals and questions", "Running order", "Have ready", "Open between you", "Logistics"]);
    const goals = m.sections.find((s: any) => s.title === "Goals and questions").items;
    expect(goals.length).toBeGreaterThanOrEqual(3);
    expect(goals.length).toBeLessThanOrEqual(5);
    expect(m.laid.text).toContain("Their website, fakeco.example.org: Fake Co. Legal services for creative businesses.");
    expect(m.laid.text).toContain("Met before: 2 Mar 2025");
    expect(m.laid.text.split("\n")[0]).toBe("Your prep for Jo (Fake Co), Tue 27 Oct, 10am ET.");
    expect(plainProblems({ subject: m.laid.subject, text: m.laid.text, html: m.laid.html })).toEqual([]);
  });

  it("the invite's own notes are a purpose; join boilerplate is not", () => {
    expect(inviteNotes("Join with Google Meet: https://meet.google.com/x\nMeeting ID: 123")).toBeNull();
    const withNotes = { ...meeting, description: "Walk through the setup kit and pick the first tasks.\nJoin with Google Meet: https://meet.google.com/x" };
    expect(purposeOf(withNotes)).toEqual({ text: "Walk through the setup kit and pick the first tasks.", from: "the invite", guess: false });
    expect(buildPrep(withNotes, {}, { context: EMPTY }).needsPurpose).toBe(false);
    // A line from an email is a purpose too, labelled as a guess.
    const p = buildPrep(meeting, {}, { context: { ...EMPTY, purpose_hint: { text: "to talk about the new studio", from: "their email of 24 Oct" } } });
    expect(p.sections[0].title).toBe("What it's probably about (a guess, from their email of 24 Oct)");
  });

  it("a plan line that would fail her plain-email gate is dropped, never sent", () => {
    expect(lineFits("Fill in the placeholders together.")).toBe(true);
    expect(lineFits("Run npm install --save in the terminal.")).toBe(false);
    const kept = readPlan({ goals: ["Agree the next step.", "Run npm install --save first."], ready: [], order: [] });
    expect(kept?.goals).toEqual(["Agree the next step."]);
    expect(readPlan({ goals: "not a list" })).toBeNull();
  });

  it("the seat's context answer is kept only in the shape the prep reads", () => {
    const c = readContext({ mail: { count: "3", recent: [{ date: "2026-10-01", subject: "Hello", from_them: true }, { date: "bad" }] }, bounces: [{ address: "not an address" }, { address: "A@B.example", date: "2026-10-25" }], purpose_hint: { text: "" } });
    expect(c.mail).toMatchObject({ count: 3, first: { date: "2026-10-01" } });
    expect(c.mail.recent).toHaveLength(1);
    expect(c.bounces).toEqual([{ address: "a@b.example", date: "2026-10-25" }]);
    expect(c.purpose_hint).toBeNull();
    const merged = mergeWorkspaceMail(c, [{ date: "2019-02-02", subject: "Old note", from: "Jo <jo@fakeco.example.org>" }, { date: "2026-10-25", subject: "Undeliverable", from: "mailer-daemon@x.example" }], { email: "jo@fakeco.example.org" });
    expect(merged.mail.count).toBe(4);
    expect(merged.mail.first).toEqual({ date: "2019-02-02", subject: "Old note" });
  });
});

describe("her reply: the finished prep in the same thread", () => {
  it("finishPrep writes the prep from her words and sends it as Simone, Re: the same subject, In-Reply-To the thread", async () => {
    const posts: Array<[string, any]> = [];
    const api = { get: async () => ({ rows: [] }), post: async (p: string, b: any) => { posts.push([p, b]); return {}; } };
    const sent: any[] = [];
    const send = async (who: string, msg: any) => { sent.push({ who, msg }); return { ok: true, id: "em_fake9", from: "Simone <simone@example.org>" }; };
    const ask = () => ({ ok: true, json: { goals: ["Get it working on one real task.", "Pick their first three jobs.", "Agree next week's step."], ready: ["Their laptop."], order: ["Install.", "Run the setup.", "Try one task."] } });
    const p = { id: "cmd_fake1", purpose: "A hands-on setup session.", thread: ["<prep1@mail.example.org>", "<her1@mail.example.org>"], spec: { who: "Jo (Fake Co)", subject: "Prep: Jo (Fake Co), Tue 27 Oct, 10am ET", event: meeting, context: RICH } };
    const r = await finishPrep(api, p, { ask, send, log: () => {} });
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].who).toBe("Simone");
    expect(sent[0].msg.subject).toBe("Re: Prep: Jo (Fake Co), Tue 27 Oct, 10am ET");
    expect(sent[0].msg.thread).toEqual(p.thread);
    expect(sent[0].msg.prelaid.refs).toEqual(["cmd_fake1"]);
    expect(sent[0].msg.prelaid.text).toContain("What it's about (from you)");
    expect(sent[0].msg.prelaid.text).toContain("Pick their first three jobs.");
    expect(sent[0].msg.prelaid.text).not.toContain(PREP_QUESTION);
    expect(posts).toContainEqual(["/commands/cmd_fake1/prep-done", { message_id: "em_fake9" }]);
    // The payload threads: In-Reply-To the newest, References all of them, and the code rides in the header.
    const payload = employeeMail({ from: "Simone <simone@example.org>", reply_to: "simone@example.org", name: "Simone" } as any, { to: "me@example.org", subject: sent[0].msg.subject, prelaid: sent[0].msg.prelaid, thread: p.thread });
    expect(payload.headers).toMatchObject({ "In-Reply-To": "<her1@mail.example.org>", References: "<prep1@mail.example.org> <her1@mail.example.org>", "X-Boss-Ref": "cmd_fake1" });
  });
});

describe("the length is read right and shown in her zone", () => {
  it("an ICS event 10:00 to 12:30 New York time is 150 minutes, shown 10:00am to 12:30pm ET", () => {
    const ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:len1@google.com\nSUMMARY:Sequoia + Jo (Fake Co)\nDTSTART;TZID=America/New_York:20261027T100000\nDTEND;TZID=America/New_York:20261027T123000\nEND:VEVENT\nEND:VCALENDAR";
    const e = parseIcs(ics, Date.parse("2026-10-26T12:00:00Z"), 5).events[0]!;
    expect(e.scheduled_at).toBe(TUE_10_ET);
    expect(e.duration_min).toBe(150);
    const logi = buildPrep(e, {}, {}).sections.find((s: any) => s.title === "Logistics").items[0];
    expect(logi).toBe("Tue 27 Oct, 10:00am to 12:30pm ET.");
    // A half-hour meeting is a half hour; a UTC end is read the same way.
    const half = parseIcs(ics.replace("DTEND;TZID=America/New_York:20261027T123000", "DTEND:20261027T143000Z"), Date.parse("2026-10-26T12:00:00Z"), 5).events[0]!;
    expect(half.duration_min).toBe(30);
    expect(buildPrep(half, {}, {}).sections.at(-1).items[0]).toBe("Tue 27 Oct, 10:00am to 10:30am ET.");
  });
});
