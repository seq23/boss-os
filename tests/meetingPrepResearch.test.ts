/**
 * MEETING PREP, 4 Nov 2026: the right firm, real research before sending, her current zone, subjects
 * decoded once, and no grid deals for a fund prospect. Fixtures only, fake names (the repo is public).
 */
import { describe, expect, it } from "vitest";
import { buildPrep, guestFirm, recordsFor, roleOf, readResearch, researchPrompt, zonedTime } from "../src/shared/boss/meetingPrep/prep.mjs";
import { researchGuest, prepEmail } from "../scripts/ops/meeting-prep.mjs";
import { repairMojibake, replySubject, encodeSubject } from "../src/shared/boss/mail/subject.mjs";
import { decodeMimeHeader } from "../src/shared/boss/intake/mail.mjs";
import { threadReplyMime } from "../src/worker/boss/wealth/gmailDraft";
import { plainProblems } from "../src/shared/boss/mail/plain.mjs";

const ME = ["me@example.com"];
const FRI_NOON_CT = Date.parse("2026-10-30T17:00:00Z");
const pat = {
  calendar_uid: "p1", ical_uid: "p1@google.com", title: "Pat Example <> Sequoia", scheduled_at: FRI_NOON_CT, duration_min: 30, location: null,
  attendees: [{ email: "me@example.com", self: true }, { email: "pat@familyoffice.example", name: "Pat Example" }],
};
// The production shape: an LP-reply row whose `firm` holds OUR fund, the one they replied to.
const lpReplyData = { lpReplies: [{ address: "pat@familyoffice.example", name: "Pat Example", firm: "West Peek Ventures", bucket: "call", first_seen: "2026-10-20" }] };
const deals = [{ company: "Acme AI", side: "Sell", size: "$10M", price: "$40", from_email: "broker@other.example" }];
const GARBLED = "Pat Ã¢Â€Â” your intro";

const RESEARCH_OK = { ok: true, json: {
  found: true,
  title: { text: "Managing Director", url: "https://familyoffice.example/team" },
  firm: { text: "Example Family Office", url: "https://familyoffice.example/" },
  background: { text: "Twenty years in growth equity before joining the family office.", url: "https://news.example/pat-profile" },
  focus: { text: "Secondaries in late-stage software.", url: "https://news.example/pat-interview" },
  upcoming: [{ text: "Speaking at Example Secondaries Summit, 12 Nov", url: "https://summit.example/speakers" }, { text: "An unsourced rumour" }],
} };

describe("a) the guest's firm is never one of hers", () => {
  it("an LP-reply row holding West Peek Ventures falls back to the guest's company domain", () => {
    const rec = recordsFor({ email: "pat@familyoffice.example", name: "Pat Example" }, lpReplyData);
    expect(guestFirm(rec, pat, "pat@familyoffice.example")).toBe("familyoffice.example");
    expect(roleOf(rec)).toBe("LP prospect");
    const p = buildPrep(pat, lpReplyData, { herAddresses: ME });
    expect(p.subject).toBe("Prep: Pat Example (familyoffice.example), Fri 30 Oct, 12pm CT");
    const who = JSON.stringify(p.sections.find((s: any) => s.title === "Who they are"));
    expect(who).not.toContain("West Peek");
    for (const own of ["West Peek", "Spry Ventures", "Spry Labs", "west peek ventures"]) {
      expect(guestFirm({ prospect: { firm: own }, deals: [] }, pat, "pat@familyoffice.example")).toBe("familyoffice.example");
    }
  });
});

describe("b) the guest is researched before the prep is sent", () => {
  const fakeApi = (answer: any) => { const posts: any[] = []; return { posts, api: { post: async (p: string, body: any) => { posts.push({ p, body }); return answer; } } }; };

  it("every sourced fact is in Who they are, with its link; an unsourced one is dropped", async () => {
    const { api, posts } = fakeApi(RESEARCH_OK);
    const asked: any[] = [];
    const research = await researchGuest(pat, lpReplyData, { api, ask: (...a: any[]) => { asked.push(a); return null; }, now: Date.parse("2026-10-29T23:00:00Z"), log: () => {} });
    expect(posts).toEqual([{ p: "/research/person", body: { name: "Pat Example", email: "pat@familyoffice.example", firm: "familyoffice.example", domain: "familyoffice.example", today: "2026-10-29" } }]);
    expect(asked).toEqual([]); // a prospect never goes to her seat: Boss OS's free route did it
    expect(research.ok).toBe(true);
    const m = prepEmail(pat, lpReplyData, { context: { research } });
    const who = m.sections.find((s: any) => s.title === "Who they are").items;
    const texts = who.map((i: any) => (typeof i === "string" ? i : i.text));
    expect(texts).toEqual(expect.arrayContaining([
      "Title: Managing Director", "Firm: Example Family Office",
      "Background: Twenty years in growth equity before joining the family office.",
      "Current focus: Secondaries in late-stage software.", "Coming up: Speaking at Example Secondaries Summit, 12 Nov",
    ]));
    expect(texts.join(" ")).not.toContain("rumour");
    expect(who.find((i: any) => i.text === "Title: Managing Director").links[0].url).toBe("https://familyoffice.example/team");
    expect(m.laid.text).not.toMatch(/Research .* from their website/);
    expect(plainProblems({ subject: m.laid.subject, text: m.laid.text, html: m.laid.html, layout: m.laid.layout })).toEqual([]);
  });

  it("no source anywhere: one plain line and a named stop, never a confident wrong one", async () => {
    const logs: string[] = [];
    const { api } = fakeApi({ ok: false, stop: "RESEARCH_NO_SOURCES", why: "Google search returned no pages; their website (familyoffice.example) could not be read" });
    const research = await researchGuest(pat, lpReplyData, { api, log: (l) => logs.push(l) });
    const who = buildPrep(pat, lpReplyData, { herAddresses: ME, research }).sections.find((s: any) => s.title === "Who they are").items;
    expect(who).toContain("Couldn't research Pat Example: Google search returned no pages; their website (familyoffice.example) could not be read.");
    expect(logs[0]).toMatch(/^NAMED STOP \[RESEARCH_NO_SOURCES\] Pat Example not researched/);
    expect(readResearch({ ok: true, json: { found: true, title: { text: "CEO" } } })).toEqual({ ok: false, why: "no fact came back with a source" });
  });

  it("never lists an event that is already over under Coming up (Sam's prep, 6 Nov 2026)", () => {
    const now = Date.parse("2026-11-06T12:00:00Z");
    const u = (text: string) => ({ text, url: "https://example.com/talk" });
    const r = readResearch({ ok: true, json: { found: true, upcoming: [
      u("A talk on AI in the investment office on Tuesday, 6 May 2025 at 4:00 PM"),
      u("Panel at a 2024 conference"),
      u("Keynote on December 3, 2026"),
      u("Speaks at the spring summit"),
    ] } }, { now }) as any;
    expect(r.ok).toBe(true);
    expect(r.facts.map((f: any) => f.text)).toEqual(["Keynote on December 3, 2026", "Speaks at the spring summit"]);
  });

  it("a committed LP is researched on her own seat with web search, never on a free model", async () => {
    const { api } = fakeApi({ ok: false, private: true, stop: "RESEARCH_PRIVATE", why: "committed LP" });
    const calls: any[] = [];
    const research = await researchGuest(pat, lpReplyData, { api, ask: (prompt: string, opts: any) => { calls.push({ prompt, opts }); return RESEARCH_OK; }, log: () => {} });
    expect(calls).toHaveLength(1);
    expect(String(calls[0].opts.requireTool)).toMatch(/WebSearch/);
    expect(research.ok).toBe(true);
    expect(researchPrompt({ name: "Pat Example", today: "2026-10-29" })).toMatch(/Every fact needs the https link/);
  });
});

describe("c) times in her current zone, the other zone in brackets only when different", () => {
  it("she is in New York, the meeting is Central: 1pm ET (12pm CT); both Central: no brackets", () => {
    expect(zonedTime(FRI_NOON_CT, { tz: "America/New_York", other: "America/Chicago" })).toBe("1pm ET (12pm CT)");
    expect(zonedTime(FRI_NOON_CT, { tz: "America/Chicago", other: "America/Chicago" })).toBe("12pm CT");
    const p = buildPrep({ ...pat, time_zone: "America/Chicago" }, {}, { herAddresses: ME, tz: "America/New_York" });
    expect(p.subject).toBe("Prep: Pat Example (familyoffice.example), Fri 30 Oct, 1pm ET (12pm CT)");
    expect(p.sections.at(-1).items[0]).toBe("Fri 30 Oct, 1:00pm to 1:30pm ET (12:00pm to 12:30pm CT).");
    expect(buildPrep(pat, {}, { herAddresses: ME }).sections.at(-1).items[0]).toBe("Fri 30 Oct, 12:00pm to 12:30pm CT.");
  });
  it("the bracket is always Central, never the meeting's own zone (her rule, 6 Nov 2026)", () => {
    // She is home in Chicago, the meeting is set in Los Angeles: no bracket.
    expect(buildPrep({ ...pat, time_zone: "America/Los_Angeles" }, {}, { herAddresses: ME, tz: "America/Chicago" }).subject).toBe("Prep: Pat Example (familyoffice.example), Fri 30 Oct, 12pm CT");
    // She is in Los Angeles: Pacific first, Central in brackets.
    expect(buildPrep(pat, {}, { herAddresses: ME, tz: "America/Los_Angeles" }).subject).toBe("Prep: Pat Example (familyoffice.example), Fri 30 Oct, 10am PT (12pm CT)");
  });
});

describe("d) subjects decoded once", () => {
  it("an em-dash subject round-trips into Re: unchanged, on both send paths", () => {
    const subject = "Pat — your intro";
    expect(decodeMimeHeader(encodeSubject(replySubject(subject)))).toBe("Re: Pat — your intro");
    const mime = threadReplyMime({ to: "pat@familyoffice.example", subject, body: "Hi Pat" });
    const header = /^Subject: (.*)$/m.exec(mime)![1];
    expect(decodeMimeHeader(header!)).toBe("Re: Pat — your intro");
    // Already garbled on the way in: the reply still goes out right.
    expect(decodeMimeHeader(/^Subject: (.*)$/m.exec(threadReplyMime({ to: "pat@familyoffice.example", subject: GARBLED, body: "x" }))![1]!)).toBe("Re: Pat — your intro");
    // A Latin-1 encoded word is read in its own charset.
    expect(decodeMimeHeader("=?iso-8859-1?Q?Caf=E9?=")).toBe("Café");
  });

  it("a stored mojibake subject displays correctly; a clean one is untouched", () => {
    expect(repairMojibake(GARBLED)).toBe("Pat — your intro");
    expect(repairMojibake("Café — déjà vu")).toBe("Café — déjà vu");
    const ctx = { mail: { count: 1, first: { date: "2026-10-20", subject: GARBLED }, recent: [{ date: "2026-10-20", subject: GARBLED, from_them: true }] } };
    const m = prepEmail(pat, {}, { context: ctx });
    expect(m.laid.text).toContain('"Pat — your intro"');
    expect(m.laid.text).not.toContain("Ã");
  });
});

describe("e) grid deals only for brokerage contacts", () => {
  it("a West Peek Ventures LP prospect sees no grid line; a brokerage buyer does", () => {
    const prospect = { prospects: [{ email: "pat@familyoffice.example", name: "Pat Example", firm: "Example Family Office", kind: "family_office", status: "interested" }], deals };
    const t = prepEmail(pat, prospect).laid.text;
    expect(t).not.toContain("On the grid");
    expect(t).not.toContain("Acme AI");
    const buyer = { people: [{ email: "pat@familyoffice.example", full_name: "Pat Example", relationship_kind: "investor" }], deals };
    expect(prepEmail(pat, buyer).laid.text).toContain("On the grid now that fits a buyer: Acme AI $10M.");
  });
});

// 6 Nov 2026: the invite "Sam (Example Holdings) <> Sequoia Taylor" went to his assistant; the
// research looked up the assistant and the prep said "Couldn't research Alex Assist".
describe("research looks up the person the invite names", () => {
  it("asks about Sam at the firm, not the assistant's address", async () => {
    const asked: any[] = [];
    const api = { post: async (_p: string, b: any) => { asked.push(b); return { ok: false, why: "nothing public" }; } };
    const sam = { calendar_uid: "n1", title: "Sam (Example Holdings) <> Sequoia Taylor, West Peek", scheduled_at: Date.parse("2026-11-17T17:00:00Z"), attendees: [{ email: "alex@holdings.example", name: "Alex Assist" }] };
    await researchGuest(sam, {}, { api, log: () => {} });
    expect(asked[0].name).toBe("Sam");
    expect(asked[0].email).toBeNull();
    expect(asked[0].firm).toBe("Example Holdings");
  });
});
