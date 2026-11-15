/**
 * Where the money comes from (owner, 15 Nov 2026: an LP call's prep "shouldn't have left out" where
 * the institution's money comes from). Made-up names only.
 */
import { describe, expect, it } from "vitest";
import { buildPrep, readResearch, researchPrompt, groundedSearchPrompt, keepGroundedFacts, MONEY_TITLE } from "../src/shared/boss/meetingPrep/prep.mjs";

const ME = ["me@example.com"];
const AT = Date.parse("2026-11-16T18:00:00Z");
const call = {
  calendar_uid: "m1", ical_uid: "m1@google.com", title: "Robin Sample <> Sequoia", scheduled_at: AT, duration_min: 30, location: null,
  attendees: [{ email: "me@example.com", self: true }, { email: "robin@samplefoundation.example", name: "Robin Sample" }],
};
const data = { lpReplies: [{ address: "robin@samplefoundation.example", name: "Robin Sample", firm: "Sample Family Foundation", bucket: "call", first_seen: "2026-08-20" }] };
const money = { ok: true, json: { found: true,
  title: { text: "Chief Investment Officer", url: "https://samplefoundation.example/team" },
  money: {
    founder: { text: "Founded by the Sample family", url: "https://samplefoundation.example/history" },
    wealth: { text: "Proceeds from the sale of Sample Freight, a regional trucking company", url: "https://news.example/sample-freight" },
    founded: { text: "1987", url: "https://samplefoundation.example/history" },
    mandate: { text: "Charter limits grants to the Upper Midwest", url: "https://samplefoundation.example/mandate" },
    name_trap: { text: "Not related to the Sample Institute, which shares the surname", url: "https://news.example/two-samples" },
    unsourced: { text: "a rumour" },
  },
} };
const section = (p: any) => p.sections.find((s: any) => s.title === MONEY_TITLE);

describe("an LP call with an institution always says where the money comes from", () => {
  it("asks for it in every research prompt, keeps only sourced facts, and shows them in their own section", () => {
    for (const f of [researchPrompt, groundedSearchPrompt]) {
      const p = f({ name: "Robin Sample", today: "2026-11-15", institution: true });
      expect(p).toMatch(/founder or family/);
      expect(p).toMatch(/name-collision trap/);
      expect(p).toMatch(/"money":\{"founder"/);
      expect(f({ name: "Robin Sample", today: "2026-11-15" })).not.toMatch(/"money"/);
    }
    // A grounded answer keeps a money fact only when it cites a page actually used.
    const kept = keepGroundedFacts({ found: true, money: { founder: { text: "x", url: "https://a.example/" }, wealth: { text: "y", url: "https://made.up/" } } }, [{ title: "a", url: "https://a.example/" }]);
    expect(kept.money.founder).toBeTruthy();
    expect(kept.money.wealth).toBeNull();

    const research = readResearch(money);
    const items = section(buildPrep(call, data, { herAddresses: ME, research })).items.map((i: any) => i.text);
    expect(items).toEqual([
      "Founder or family: Founded by the Sample family",
      "Source of the wealth: Proceeds from the sale of Sample Freight, a regional trucking company",
      "Founded: 1987",
      "Mandate: Charter limits grants to the Upper Midwest",
      "Name trap: Not related to the Sample Institute, which shares the surname",
    ]);
  });

  it("says so when research found nothing or did not run, never leaving the section out", () => {
    const none = readResearch({ ok: true, json: { found: true, title: { text: "CIO", url: "https://samplefoundation.example/team" } } });
    expect(section(buildPrep(call, data, { herAddresses: ME, research: none })).items[0]).toMatch(/^Research found nothing public on where .+ money comes from/);
    expect(section(buildPrep(call, data, { herAddresses: ME, research: { ok: false, why: "down" } })).items[0]).toMatch(/^Couldn't research where/);
    expect(section(buildPrep(call, data, { herAddresses: ME }))).toBeTruthy();
  });

  it("is not added to a meeting with a company that is not an institution", () => {
    const plain = { ...call, attendees: [{ email: "me@example.com", self: true }, { email: "sam@widgets.example", name: "Sam Widget" }], title: "Sam Widget <> Sequoia" };
    expect(section(buildPrep(plain, {}, { herAddresses: ME }))).toBeUndefined();
  });
});
