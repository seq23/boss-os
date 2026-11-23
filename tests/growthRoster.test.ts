/**
 * THE GROWTH ROSTER (Growth Director, 21 Nov 2026). Behaviour, each proven negatively:
 *   - the roster is read from a brain's Growth section only, and only from the growth brains;
 *   - a Growth section with a confidential mark is refused whole (no private span reaches a model);
 *   - a channel or format the roster does not list is NOT approved (the Director cannot post it);
 *   - spending, creating an account, retiring or deleting are impossible (named stops);
 *   - a paused business gets nothing; adding a business is one entry.
 */
import { describe, expect, it } from "vitest";
import { growthSection, parseRoster, rosterProblems, mayAct, SPEND_ACTIONS, rulingsFor, headingGroups, SHARED_RULINGS, CHANNEL_RULINGS } from "../src/shared/boss/growth/roster.mjs";
import { canonicalSection, replaceSection, skeleton, hasConfidential } from "../src/shared/boss/brains/brain.mjs";

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

describe("a broken entry acts on nothing", () => {
  it("a doubled key is named and refused, even when the second copy says paused", () => {
    const two = parseRoster(`${SECTION}\n### Shop A again\n- key: shop-a\n- buyer: x\n- offer: y\n- money number: z\n- channels: instagram [reel]\n- languages: en\n- limits: R-AI-02\n- paused: yes\n`, "spry");
    expect(rosterProblems(two).join(" ")).toMatch(/key shop-a is listed twice/);
    expect(mayAct(two, { business: "shop-a", channel: "instagram", format: "reel" })).toMatchObject({ ok: false, stop: "ROSTER_BROKEN" });
  });
  it("a half-written entry (no limits) is refused, so its drafts are never unchecked", () => {
    const half = parseRoster("### Shop D\n- key: shop-d\n- buyer: x\n- offer: y\n- money number: z\n- channels: instagram [reel]\n- languages: en\n", "spry");
    expect(rosterProblems(half).join(" ")).toMatch(/Shop D: no limits/);
    expect(mayAct(half, { business: "shop-d", channel: "instagram", format: "reel" })).toMatchObject({ ok: false, stop: "ROSTER_BROKEN" });
  });
  it("a misspelled field (\"pause: yes\") is named and refused, never read as active", () => {
    const typo = parseRoster(SECTION.replace("- paused: no", "- pause: yes"), "spry");
    expect(rosterProblems(typo).join(" ")).toMatch(/"pause" is not a roster field/);
    expect(mayAct(typo, { business: "shop-a", channel: "instagram", format: "reel" })).toMatchObject({ ok: false, stop: "ROSTER_BROKEN" });
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

/**
 * HER RULINGS (her yes, 22 Nov 2026: "yea let it read the settled decisions"): each business reads its own
 * Settled groups by heading, plus the shared ones; nothing is ever a quiet empty pass.
 */
describe("rulingsFor: her Settled decisions, by heading, per business", () => {
  const SPRY_MD = `## Growth
### KeepMyProof
- key: keepmyproof
- channels: app-store [listing] · backlinks [guide]

## Settled decisions
### Umbrella, scope and money
- 2026-11-01 — UMBRELLA-RULING
### Growth (Shoestring Growth Plan, 21 Nov 2026)
- 2026-11-22 — The backlink network is an outside publisher with its own Cloudflare account.
### Search, sites and freshness
- 2026-11-02 — SEARCH-RULING
### Brand and social
- 2026-11-03 — BRAND-RULING
### All apps
- 2026-11-04 — APPS-RULING
### KeepMyProof
- 2026-11-05 — KMP-RULING <!-- confidential -->A-PRIVATE-NAME<!-- /confidential -->
### KeepMyProof store listing
- 2026-11-06 — KMP-LISTING-RULING
### Dream Wedding
- 2026-11-07 — DW-RULING

## Open questions
- OPEN-QUESTION
`;
  const kmp = { label: "KeepMyProof", brain: "spry", channels: [{ channel: "app-store", formats: ["listing"] }] } as any;
  const dw = { label: "Dream Wedding", brain: "spry", channels: [{ channel: "app-store", formats: ["listing"] }] } as any;
  const yt = { label: "How We Know", brain: "spry", channels: [{ channel: "youtube", formats: ["long-video"] }] } as any;
  const pnp = { label: "Porch & Party", brain: "porch-and-party", channels: [] } as any;
  const all = (r: ReturnType<typeof rulingsFor>) => [...r.own, ...r.shared].map((g) => `${g.heading}\n${g.body}`).join("\n");

  it("a business gets the groups whose heading starts with its label, never another business's", () => {
    const r = rulingsFor(kmp, SPRY_MD);
    expect(r.notRead).toBeNull();
    expect(r.own.map((g) => g.heading)).toEqual(["KeepMyProof", "KeepMyProof store listing"]);
    expect(all(r)).not.toContain("DW-RULING");
    expect(all(rulingsFor(dw, SPRY_MD))).toContain("DW-RULING");
    expect(all(rulingsFor(dw, SPRY_MD))).not.toContain("KMP-RULING");
    expect(r.problems).toEqual([]);
  });

  it("the shared groups, in order, with the backlink ruling; All apps only for a business with an app-store channel", () => {
    expect(rulingsFor(kmp, SPRY_MD).shared.map((g) => g.heading)).toEqual(["Growth (Shoestring Growth Plan, 21 Nov 2026)", "Umbrella, scope and money", "Brand and social", "Search, sites and freshness", "All apps"]);
    expect(all(rulingsFor(kmp, SPRY_MD))).toMatch(/backlink network is an outside publisher/);
    expect(rulingsFor(yt, SPRY_MD).shared.map((g) => g.heading)).not.toContain("All apps");
    expect(SHARED_RULINGS.slice(-3)).toEqual(Object.keys(CHANNEL_RULINGS));
    // Other sections of the brain never come along.
    expect(all(rulingsFor(kmp, SPRY_MD))).not.toContain("OPEN-QUESTION");
  });

  it("a private span is cut at the source, before any prompt is built", () => {
    const text = all(rulingsFor(kmp, SPRY_MD));
    expect(text).toContain("KMP-RULING");
    expect(text).not.toContain("A-PRIVATE-NAME");
    expect(hasConfidential(text)).toBe(false);
  });

  it("Porch & Party reads its whole Settled decisions section as its own", () => {
    const r = rulingsFor(pnp, "## Settled decisions\n### Services\n- PNP-PRICE-RULING\n### Growth\n- PNP-GROWTH-RULING\n\n## Growth\n### Porch & Party\n");
    expect(r.notRead).toBeNull();
    expect(r.own).toHaveLength(1);
    expect(r.own[0]!.body).toMatch(/PNP-PRICE-RULING[\s\S]*PNP-GROWTH-RULING/);
    expect(r.shared).toEqual([]);
  });

  it("a renamed or missing heading is a named problem, and the business still reads the shared rulings", () => {
    const renamed = SPRY_MD.replace("### KeepMyProof\n- 2026-11-05", "### Keep My Proof\n- 2026-11-05").replace("### KeepMyProof store listing", "### Store listing");
    const r = rulingsFor(kmp, renamed);
    expect(r.notRead).toBeNull();
    expect(r.own).toEqual([]);
    expect(r.problems).toEqual([`KeepMyProof has no "### KeepMyProof" group in the Spry Labs brain's Settled decisions; it reads the shared rulings only`]);
    expect(r.shared.length).toBe(5);
    const noBrand = rulingsFor(kmp, SPRY_MD.replace("### Brand and social", "### Branding"));
    expect(noBrand.problems).toEqual([`the Spry Labs brain's Settled decisions has no "### Brand and social" group`]);
  });

  it("no Settled decisions section, an empty one, or a brain that was not read is \"rulings not read\", never none", () => {
    for (const md of ["## Growth\n### KeepMyProof\n", "## Settled decisions\n\n## Growth\n", "## Settled decisions\n[MISSING]\n"]) {
      const r = rulingsFor(kmp, md);
      expect(r.notRead).toBe("the Spry Labs brain has no Settled decisions section");
      expect(r.problems).toEqual(["KeepMyProof: rulings not read (the Spry Labs brain has no Settled decisions section)"]);
    }
    const lost = rulingsFor(pnp, null);
    expect(lost.notRead).toBe("the Porch & Party brain could not be read");
    expect(lost.own).toEqual([]);
  });

  it("a private span that wraps a ### heading takes the group under it too: nothing of it reaches any group", () => {
    // The review's repro (22 Nov 2026): split first, the open mark fell in the group above and the
    // private group kept its text with only a stray close mark, which the cut then removed.
    const wrapped = SPRY_MD.replace("### Dream Wedding", "<!-- confidential -->\n### KeepMyProof partner terms\n- PRIVATE-TERMS\n<!-- /confidential -->\n### Dream Wedding");
    const r = rulingsFor(kmp, wrapped);
    expect(r.notRead).toBeNull();
    expect(all(r)).not.toContain("PRIVATE-TERMS");
    expect(r.own.map((g) => g.heading)).toEqual(["KeepMyProof", "KeepMyProof store listing"]);
    expect(hasConfidential(all(r))).toBe(false);
    // One that opens in one group and closes in the next cuts across both.
    const across = SPRY_MD.replace("- 2026-11-06 — KMP-LISTING-RULING", "- 2026-11-06 — KMP-LISTING-RULING <!-- confidential -->SPAN-START").replace("- 2026-11-07 — DW-RULING", "SPAN-END<!-- /confidential --> DW-RULING");
    expect(all(rulingsFor(dw, across))).not.toMatch(/SPAN-START|SPAN-END/);
    expect(all(rulingsFor(kmp, across))).not.toMatch(/SPAN-START|SPAN-END/);
  });

  it("a span that crosses a ## boundary over Settled decisions or Growth is private there too, never read as public", () => {
    const people = `## People\n- <!-- confidential -->A-PRIVATE-PERSON\n`;
    const overSettled = people + SPRY_MD.replace("### Umbrella, scope and money", "### Umbrella, scope and money<!-- /confidential -->");
    const r = rulingsFor(kmp, overSettled);
    expect(r.notRead).toBe("the Spry Labs brain's Settled decisions sit inside a confidential mark");
    expect(r.own).toEqual([]); expect(r.shared).toEqual([]);
    // The same span runs over the whole Growth section above Settled, which itself carries no mark.
    expect(growthSection("spry", SPRY_MD)).toContain("### KeepMyProof");
    expect(() => growthSection("spry", overSettled)).toThrow(/PRIVATE_IN_GROWTH/);
  });

  it("Pinterest and KDP are read only by a business whose roster has that channel, last in the order", () => {
    const md = SPRY_MD.replace("### KeepMyProof\n- 2026-11-05", "### Pinterest\n- 2026-11-08 — PIN-RULING\n### KDP\n- 2026-11-09 — KDP-RULING\n### KeepMyProof\n- 2026-11-05");
    const heads = (e: any) => rulingsFor(e, md).shared.map((g) => g.heading);
    const both = { ...kmp, channels: [...kmp.channels, { channel: "pinterest", formats: ["pin"] }, { channel: "kdp", formats: ["book"] }] };
    expect(heads(both).slice(-3)).toEqual(["All apps", "Pinterest", "KDP"]);
    expect(all(rulingsFor(both, md))).toMatch(/PIN-RULING[\s\S]*KDP-RULING/);
    expect(heads(kmp)).not.toContain("Pinterest"); expect(heads(kmp)).not.toContain("KDP");
    expect(all(rulingsFor(kmp, md))).not.toMatch(/PIN-RULING|KDP-RULING/);
    const pinOnly = { ...yt, channels: [{ channel: "pinterest", formats: ["pin"] }] };
    expect(heads(pinOnly)).toContain("Pinterest"); expect(heads(pinOnly)).not.toContain("KDP");
    expect(rulingsFor(both, md).problems).toEqual([]);
    // A channel group she has not written yet is a named problem for that business only.
    expect(rulingsFor(both, SPRY_MD).problems).toEqual([`the Spry Labs brain's Settled decisions has no "### Pinterest" group`, `the Spry Labs brain's Settled decisions has no "### KDP" group`]);
    expect(rulingsFor(kmp, SPRY_MD).problems).toEqual([]);
  });

  it("headingGroups splits on ### only", () => {
    expect(headingGroups("intro\n### A\n- a\n#### not a group\n### B\n- b")).toEqual([{ heading: "A", body: "- a\n#### not a group" }, { heading: "B", body: "- b" }]);
  });
});
