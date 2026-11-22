/**
 * THE GROWTH ROSTER (Growth Director, 21 Nov 2026). Behaviour, each proven negatively:
 *   - the roster is read from a brain's Growth section only, and only from the growth brains;
 *   - a Growth section with a confidential mark is refused whole (no private span reaches a model);
 *   - a channel or format the roster does not list is NOT approved (the Director cannot post it);
 *   - spending, creating an account, retiring or deleting are impossible (named stops);
 *   - a paused business gets nothing; adding a business is one entry.
 */
import { describe, expect, it } from "vitest";
import { growthSection, parseRoster, rosterProblems, mayAct, SPEND_ACTIONS } from "../src/shared/boss/growth/roster.mjs";
import { canonicalSection, replaceSection, skeleton } from "../src/shared/boss/brains/brain.mjs";

const SECTION = `### Shop A
- key: shop-a
- buyer: people who want a thing
- offer: the thing, $10
- money number: dollars received
- channels: instagram [reel, photo-set] · tiktok [reel] · google-business-profile (by hand)
- languages: en, es
- limits: R-END-03, R-PRV-01
- linked to-dos: olp_abc123
- paused: no

### Channel B
- key: channel-b
- buyer: night listeners
- offer: free videos
- money number: none yet
- channels: youtube [long-video]
- languages: en
- limits: R-AI-02
- paused: YouTube is paused until the audio fill is done
`;
const brain = replaceSection(skeleton("Test"), "Growth", SECTION);
const roster = parseRoster(growthSection("spry", brain)!, "spry");

describe("reading the roster", () => {
  it("is an optional ninth brain section, read by code", () => {
    expect(canonicalSection("Growth")).toBe("Growth");
    expect(roster.map((e) => e.key)).toEqual(["shop-a", "channel-b"]);
    const a = roster[0]!;
    expect(a.channels).toEqual([
      { channel: "instagram", formats: ["reel", "photo-set"], note: null },
      { channel: "tiktok", formats: ["reel"], note: null },
      { channel: "google-business-profile", formats: [], note: "by hand" },
    ]);
    expect(a.languages).toEqual(["en", "es"]);
    expect(a.limits).toEqual(["R-END-03", "R-PRV-01"]);
    expect(a.linked).toEqual(["olp_abc123"]);
    expect(a.paused).toBeNull();
    expect(roster[1]!.paused).toMatch(/audio fill/);
    expect(rosterProblems(roster)).toEqual([]);
  });
  it("adding a business is one entry; a half-written one is named", () => {
    const more = parseRoster(`${SECTION}\n### Shop C\n- key: shop-c\n- buyer: x\n`, "spry");
    expect(more.map((e) => e.key)).toContain("shop-c");
    expect(rosterProblems(more).join(" ")).toMatch(/Shop C: no offer/);
    expect(rosterProblems([]).join(" ")).toMatch(/ROSTER_EMPTY/);
  });
  it("reads only the growth brains, and refuses a Growth section with a private span", () => {
    expect(() => growthSection("brokerage", brain)).toThrow(/NOT_A_GROWTH_BRAIN/);
    expect(() => growthSection("west-peek-ventures", brain)).toThrow(/NOT_A_GROWTH_BRAIN/);
    const leaky = replaceSection(skeleton("Test"), "Growth", `${SECTION}\n<!-- confidential -->an LP name<!-- /confidential -->`);
    expect(() => growthSection("spry", leaky)).toThrow(/PRIVATE_IN_GROWTH/);
    // Other sections never come through: a private span elsewhere in the brain is simply not read.
    const elsewhere = replaceSection(brain, "People", "<!-- confidential -->an LP name<!-- /confidential -->");
    expect(growthSection("spry", elsewhere)).not.toMatch(/LP name/);
    expect(growthSection("spry", skeleton("Test"))).toBeNull();
  });
});

describe("what the Director may do", () => {
  it("posts only on an approved channel AND format", () => {
    expect(mayAct(roster, { business: "shop-a", channel: "instagram", format: "reel" })).toEqual({ ok: true });
    expect(mayAct(roster, { business: "shop-a", channel: "instagram", format: "carousel" })).toMatchObject({ ok: false, stop: "NOT_APPROVED" });
    expect(mayAct(roster, { business: "shop-a", channel: "threads", format: "text-post" })).toMatchObject({ ok: false, stop: "NOT_APPROVED" });
    expect(mayAct(roster, { business: "shop-a", channel: "google-business-profile", format: "post" })).toMatchObject({ ok: false, stop: "NOT_APPROVED" });
    expect(mayAct(roster, { business: "shop-z", channel: "instagram", format: "reel" })).toMatchObject({ ok: false, stop: "NOT_ON_ROSTER" });
  });
  it("never spends, never creates an account, never retires or deletes", () => {
    for (const action of SPEND_ACTIONS) expect(mayAct(roster, { business: "shop-a", channel: "instagram", format: "reel", action })).toMatchObject({ ok: false, stop: "NEVER_SPEND" });
    expect(mayAct(roster, { business: "shop-a", action: "create-account" })).toMatchObject({ ok: false, stop: "NO_NEW_ACCOUNTS" });
    for (const action of ["retire-account", "delete-post", "retire-pipeline"]) expect(mayAct(roster, { business: "shop-a", action })).toMatchObject({ ok: false, stop: "PROPOSE_ONLY" });
    expect(mayAct(roster, { business: "shop-a", action: "propose" })).toEqual({ ok: true });
  });
  it("does nothing at all for a paused business, not even a proposal", () => {
    expect(mayAct(roster, { business: "channel-b", channel: "youtube", format: "long-video" })).toMatchObject({ ok: false, stop: "PAUSED" });
    expect(mayAct(roster, { business: "channel-b", action: "propose" })).toMatchObject({ ok: false, stop: "PAUSED" });
  });
});
