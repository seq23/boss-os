/**
 * SIMONE'S MEETING PREP (owner-approved 26 Oct 2026). Fixtures only, fake names (the repo is public).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { counterpartFromTitle, buildPrep, dedupeEvents, dueMeetings, extractWarmReferences, lengthLabel, nameFromTitle, prepKey, deadLinks, PREP_PREFIX } from "../src/shared/boss/meetingPrep/prep.mjs";
import { prepEmail, dealRowsOf } from "../scripts/ops/meeting-prep.mjs";
import { plainProblems } from "../src/shared/boss/mail/plain.mjs";
import { parseIcs } from "../scripts/ops/ics.mjs";
import { mergeDiaryRows } from "../src/worker/boss/today/diary";

// Thursday 29 Oct 2026, 18:05 Central (23:05 UTC): the evening run before her Friday meetings.
const EVENING = Date.parse("2026-10-29T23:05:00Z");
const FRI_NOON = Date.parse("2026-10-30T17:00:00Z"); // 12pm Central
const FRI_2PM = Date.parse("2026-10-30T19:00:00Z");
const ME = ["me@example.com"];

const kate = { calendar_uid: "k1", ical_uid: "k1@google.com", title: "Kate Example <> Sequoia", scheduled_at: FRI_NOON, duration_min: 30, location: null, join_url: "https://meet.google.com/abc-defg-hij", calendar: "westpeek",
  attendees: [{ email: "me@example.com", self: true }, { email: "kate@gemfirm.example", name: "Kate Example" }] };
const kateCopy = { ...kate, calendar_uid: "k1_other", calendar: "personal", join_url: null, attendees: [{ email: "kate@gemfirm.example", name: "Kate Example" }, { email: "assistant@gemfirm.example", name: "Ari Assist" }] };
const terri = { calendar_uid: "t1", ical_uid: "t1@google.com", title: "Call- Terri Sample", scheduled_at: FRI_2PM, duration_min: 30, location: null, attendees: [] };

const data = {
  prospects: [{ email: "kate@gemfirm.example", name: "Kate Example", firm: "GEM", kind: "family_office", status: "interested", reply_note: "Happy to talk Friday about what you are seeing.", has_draft: 1, first_sent_at: Date.parse("2026-09-08T15:00:00Z") }],
  touches: [{ email: "kate@gemfirm.example", sent_at: Date.parse("2026-09-08T15:00:00Z"), body: "Hi Kate,\n\nI loved your episode on secondaries pricing: https://podcast.example/ep-41\n\nWe have done more than $100M in secondary transactions." }],
  references: [{ email: "kate@gemfirm.example", line: "I loved your episode on secondaries pricing: https://podcast.example/ep-41", url: "https://podcast.example/ep-41", verified: 1 }],
  summaries: { "https://podcast.example/ep-41": { title: "Pricing the secondary", length_label: "41-min listen", source: "show_notes", bullets: ["One", "Two", "Three", "Four", "Five"] } },
  deals: [{ company: "Acme AI", side: "Sell", size: "$10M", price: "$40", from_email: "broker@other.example" }],
};

describe("meeting prep: one email per meeting, once", () => {
  it("one event on two calendars is one prep; two different meetings are two (the #156 rule, shared with the diary)", () => {
    const due = dueMeetings([kate, kateCopy, terri], { now: EVENING });
    expect(due.map((e) => e.title)).toEqual(["Kate Example <> Sequoia", "Call- Terri Sample"]);
    expect(due[0].join_url).toBe("https://meet.google.com/abc-defg-hij");
    expect(due[0].attendees.map((a: any) => a.email)).toContain("assistant@gemfirm.example");
    // The diary uses the same rule for two calendar rows, so the morning email and the prep agree.
    const rows = mergeDiaryRows([kate, kateCopy, terri].map((e) => ({ id: e.calendar_uid, title: e.title, with: null, scheduled_at: e.scheduled_at, duration_min: 30, location: null, source: "calendar", standing: false })) as any);
    expect(rows).toHaveLength(2);
  });

  it("is idempotent on the event and its date; a moved meeting is a new prep", () => {
    const sent = new Set([prepKey(kate)]);
    expect(dueMeetings([kate, terri], { now: EVENING, sent }).map((e) => e.title)).toEqual(["Call- Terri Sample"]);
    expect(prepKey(kate)).toBe("k1@google.com|2026-10-30");
    expect(dueMeetings([{ ...kate, scheduled_at: FRI_NOON + 86_400_000 }], { now: EVENING + 86_400_000, sent }).length).toBe(1);
  });

  it("tomorrow only from 18:00 Central; a meeting added for later today goes on the next hourly run", () => {
    const fourPm = Date.parse("2026-10-29T21:05:00Z");
    expect(dueMeetings([kate], { now: fourPm })).toEqual([]);
    const today5pm = { ...terri, calendar_uid: "new", ical_uid: "new@google.com", scheduled_at: Date.parse("2026-10-29T22:00:00Z") };
    expect(dueMeetings([today5pm], { now: fourPm }).map((e) => e.calendar_uid)).toEqual(["new"]);
    // Already past: never a prep for a meeting that has happened. All-day and holds are not meetings.
    expect(dueMeetings([today5pm], { now: EVENING })).toEqual([]);
    expect(dueMeetings([{ ...kate, all_day: true }, { ...terri, title: "Focus time" }], { now: EVENING })).toEqual([]);
  });

  it("the ICS feed carries who is invited and the join link", () => {
    const ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:z9@google.com\nSUMMARY:Call- Jo Fake\nDTSTART:20261030T170000Z\nDTEND:20261030T173000Z\nATTENDEE;CN=Jo Fake:mailto:jo@fake.example\nLOCATION:https://zoom.us/j/123\nEND:VEVENT\nEND:VCALENDAR";
    const [e] = parseIcs(ics, Date.parse("2026-10-29T12:00:00Z"), 5).events;
    expect(e).toMatchObject({ ical_uid: "z9@google.com", all_day: false, join_url: "https://zoom.us/j/123", attendees: [{ email: "jo@fake.example", name: "Jo Fake" }] });
  });
});

describe("meeting prep: the email", () => {
  it('subject starts "Prep: " with who, firm, day and time', () => {
    expect(buildPrep(kate, data, { herAddresses: ME }).subject).toBe("Prep: Kate Example (GEM), Fri 30 Oct, 12pm");
    expect(buildPrep(terri, {}, { herAddresses: ME }).subject).toBe(`${PREP_PREFIX}Terri Sample, Fri 30 Oct, 2pm`);
    expect(nameFromTitle("Kate Example <> Sequoia")).toBe("Kate Example");
    // No name on the invite: the title without her name, never a bare address.
    const solo = { ...terri, title: "Sequoia + Jo (Fake Co)", attendees: [{ email: "jo@fakeco.example" }] };
    expect(buildPrep(solo, {}, { herAddresses: ME }).subject).toBe("Prep: Jo (Fake Co), Fri 30 Oct, 2pm");
    // The invite's name field holding the address is not a name.
    expect(buildPrep({ ...solo, attendees: [{ email: "jo@fakeco.example", name: "jo@fakeco.example" }] }, {}, { herAddresses: ME }).subject).toBe("Prep: Jo (Fake Co), Fri 30 Oct, 2pm");
  });

  it("carries every section with something real, in order, and passes the plain-email gate", () => {
    const p = prepEmail(kate, data);
    expect(p.sections.map((s: any) => s.title)).toEqual(["Who they are", "Your history", "What you referenced", "What's relevant now", "Bring up", "Logistics"]);
    const t = p.laid.text;
    expect(t).toContain('You wrote: "I loved your episode on secondaries pricing:');
    expect(t).toContain("41-min listen");
    expect(t).toContain("(from show notes only)");
    expect(t).toContain("Happy to talk Friday");
    expect(t).toContain("Ask: would they like to see the names on this week's list?");
    expect(t).toContain("https://meet.google.com/abc-defg-hij");
    expect(plainProblems({ subject: p.laid.subject, text: p.laid.text, html: p.laid.html })).toEqual([]);
  });

  it("omits every section with nothing real and never invents", () => {
    const p = buildPrep(terri, {}, { herAddresses: ME });
    expect(p.sections.map((s: any) => s.title)).toEqual(["Logistics"]);
    // An unchecked or dead link is never quoted.
    const unchecked = buildPrep(kate, { ...data, references: [{ ...data.references[0], verified: null }] }, { herAddresses: ME });
    expect(unchecked.sections.map((s: any) => s.title)).not.toContain("What you referenced");
    const dead = buildPrep(kate, { ...data, references: [{ ...data.references[0], verified: 0 }] }, { herAddresses: ME });
    expect(dead.sections.map((s: any) => s.title)).not.toContain("What you referenced");
  });

  it("her own deals are never shown as theirs; a grid row knows who sent it", () => {
    expect(dealRowsOf({ rows: [{ company: "A", side: "Yours: seller", from_text: "Her <me@example.com>" }, { company: "B", side: "Buy", from_text: "Bo <bo@x.example>" }] }))
      .toMatchObject([{ hers: true }, { hers: false, from_email: "bo@x.example" }]);
  });
});

describe("warm references", () => {
  it("finds the warm line and its link; booking links and her own site are not warm", () => {
    expect(extractWarmReferences("Hi,\nI loved your episode on pricing: https://pod.example/ep-41.\nBook here https://calendly.com/me\nSee our post https://westpeek.ventures/x"))
      .toEqual([{ line: "I loved your episode on pricing: https://pod.example/ep-41.", url: "https://pod.example/ep-41" }]);
    expect(extractWarmReferences("Here is a link https://x.example/a")).toEqual([]);
    expect(lengthLabel("00:41:10")).toBe("41-min listen");
    expect(lengthLabel(2460)).toBe("41-min listen");
  });

  it("a link that does not resolve is reported dead, so nothing references it", async () => {
    const fake = (async (u: string) => ({ status: u.includes("gone") ? 404 : 200 })) as any;
    expect(await deadLinks("I enjoyed your talk https://ok.example/a and your post https://gone.example/b", fake)).toEqual(["https://gone.example/b"]);
  });

  it("the meeting-prep job is a Simone duty the Team page lists by its plain name, run hourly by launchd", () => {
    const mig = readFileSync("migrations/0312_boss_meeting_prep_and_warm_references.sql", "utf8");
    expect(mig).toContain("'Meeting prep, the evening before each call'");
    expect(mig).toContain("'local_job', 'meeting-prep.mjs'");
    expect(readFileSync("scripts/ops/install-agent-launchd.sh", "utf8")).toMatch(/install_l_job com\.seq\.boss-meeting-prep "duty-run\.sh meeting-prep\.mjs/);
  });
});
