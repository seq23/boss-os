/**
 * THE GROWTH RECORD'S PURE RULES (director.mjs), each proven negatively:
 *   - the naming guard blocks the third party's mark in any form;
 *   - her fortnightly report is built from the record: an honest line 1, plain words, "not read" never 0;
 *   - the backlink network reads ordered backlinks items only, four fields, a topic of 1 to TOPIC_MAX
 *     characters never cut short, a broken row skipped.
 * Noelle's decision gate (what she may do) is tests/noelle.test.ts; her record in D1 is tests/boss/noelleRun.test.ts.
 */
import { describe, expect, it } from "vitest";
import { BACKLINKS, TOPIC_MAX, backlinkOrders, topicOf, namingProblems, reportSection, reportDue } from "../src/shared/boss/growth/director.mjs";
import { lineProblems } from "../src/shared/boss/mail/plain.mjs";

describe("the naming guard (her ruling, 21 Nov 2026; USPTO sn 98839129)", () => {
  it("blocks Black Bible Stories in any form and a bare Black Bible Chat; passes the approved names and plain posts", () => {
    expect(namingProblems("New: Black Bible Stories for kids")).toHaveLength(1);
    expect(namingProblems("Tonight's story #blackbiblestories")).toHaveLength(1);
    expect(namingProblems("Try Black Bible Chat tonight")).toHaveLength(1);
    expect(namingProblems("Hush Harbor · Black Bible Chat tonight")).toHaveLength(1);
    expect(namingProblems("Black-Bible-Stories for kids")).toHaveLength(1);
    expect(namingProblems("Black–Bible—Stories")).toHaveLength(1);
    expect(namingProblems("Hush Harbor · Black Bible Chat & Stories: a night story")).toEqual([]);
    expect(namingProblems("Bible Stories with Black Faces, every night #blackbiblechat")).toEqual([]);
    // Hashtags and music are judgement, never required: a post with neither is clean.
    expect(namingProblems("Some things you can't tell anyone.")).toEqual([]);
  });
});

describe("her fortnightly report: built from the record, plain words, honest line 1", () => {
  const O = { origin: "https://example.test", at: Date.UTC(2026, 10, 23, 12) };
  const SC = { start: "2026-11-23", first: { label: "Porch & Party requests in the last 28 days", by: 30, floor: { value: 4 } }, real: { label: "money in across the growth businesses, last 28 days", unit: "$", by: 60, floor: { value: 1000 } } };
  const sums = [{ key: "porch-and-party", totals: { money: 730, requests: 2, sales: null } }, { key: "approvalprep", totals: { money: null, sales: null } }];
  const queued = (channel: string, format: string) => ({ kind: "queued", loop: "olp_x1", item: { channel, format, draft: "x" } });
  const pnp = { business: "porch-and-party", label: "Porch & Party", state: "decided", decision: "More **instagram-reels** for olp_x1, R-PRF-01 checked. Second sentence.", actions: [queued("instagram", "reel"), queued("facebook-page", "carousel")] };

  it("line 1: cards waiting; else posts queued; else nothing queued, and why below", () => {
    expect(reportSection([pnp], { ...O, cards: 2 }).lines[0]).toBe("2 growth ideas wait for your yes in Decide. Nothing else to do.");
    expect(reportSection([pnp], { ...O, cards: 0 }).lines[0]).toBe("Nothing to do: 2 posts were queued from formats you already approved.");
    const allHeld = reportSection([{ business: "approvalprep", label: "ApprovalPrep", state: "held: no model", decision: "x", actions: [] }, { business: "dream-wedding", label: "Dream Wedding", state: "paused", decision: "x", actions: [] }], { ...O, cards: 0 });
    expect(allHeld.lines[0]).toBe("Nothing to do: nothing new was queued this fortnight. Why, below.");
    expect(allHeld.lines.join("\n")).toContain("ApprovalPrep (no free writer answered; it tries again next Monday)");
    expect(allHeld.lines.join("\n")).toContain("Paused: Dream Wedding.");
    const why = reportSection([{ business: "dream-wedding", label: "Dream Wedding", state: "paused", decision: "Paused: until the app is approved. Nothing measured, queued or posted.", actions: [] }], { ...O, cards: 0 });
    expect(why.lines).toContain("Paused: Dream Wedding (until the app is approved).");
  });

  it.each([
    ["held: no data", "nothing on its scoreboard could be read yet"],
    ["held: no model", "no free writer answered; it tries again next Monday"],
    ["held: roster", "its plan in the brain needs a fix; the team is on it"],
    ["held: error", "the run failed for it; the team is fixing it"],
  ])("a %s business is said in her words", (state, words) => {
    const r = reportSection([{ business: "approvalprep", label: "ApprovalPrep", state, decision: "x", actions: [] }], { ...O, cards: 0 });
    expect(r.lines).toContain(`Held, not guessed: ApprovalPrep (${words}).`);
    for (const l of r.lines) expect(lineProblems(l), l).toEqual([]);
  });

  it("a model's code words never reach her: every line passes the plain-words check", () => {
    const r = reportSection([pnp, { business: "approvalprep", label: "ApprovalPrep", state: "held: roster", decision: "NAMED STOP [X] roster", actions: [] }], { ...O, cards: 0, summaries: sums, scorecard: SC });
    for (const l of r.lines) expect(lineProblems(l), l).toEqual([]);
    const all = r.lines.join("\n");
    expect(all).not.toMatch(/olp_|R-PRF|\*\*|instagram-reels|NAMED STOP|\(roster\)/);
    expect(all).toContain("Porch & Party: $730 in, 2 requests in 28 days; 2 queued.");
    expect(all).toContain("Queued, for example: Porch & Party, Instagram reel; Porch & Party, Facebook Page carousel.");
    // Floors from the Scorecard row; an unread value is "not read", never 0.
    expect(all).toContain("Porch & Party requests in the last 28 days: 2 of 4 by Dec 23");
    // A business whose money was not read is named, never summed as $0.
    expect(all).toContain("money in across the growth businesses, last 28 days: $730 of $1,000 by Jan 22 (ApprovalPrep not read yet)");
  });

  it("the money floor: none read is \"not read yet\", all read sums with no gap, a business with no money number is not counted", () => {
    const line = (summaries: any[]) => reportSection([pnp], { ...O, cards: 0, summaries, scorecard: SC }).lines.find((l) => l.startsWith("Against the floors"))!;
    expect(line([{ key: "porch-and-party", totals: { money: null } }, { key: "a-player-mode", totals: { money: null } }])).toContain("last 28 days: not read yet (the floor is $1,000 by Jan 22)");
    expect(line([{ key: "porch-and-party", totals: { money: 700 } }, { key: "keepmyproof", totals: { money: 30 } }, { key: "how-we-know", totals: {} }])).toContain("last 28 days: $730 of $1,000 by Jan 22.");
    expect(line([{ key: "porch-and-party", totals: { money: 700 } }, { key: "a-player-mode", label: "A Player Mode", totals: { money: null } }, { key: "approvalprep", label: "ApprovalPrep", totals: { money: undefined } }])).toContain("$700 of $1,000 by Jan 22 (A Player Mode and ApprovalPrep not read yet)");
  });

  it("one of a thing is said singular, and a brand keeps its own spelling", () => {
    const r = reportSection([{ ...pnp, actions: [queued("wordpress", "guide-syndication"), queued("tiktok", "screen-video")] }], { ...O, cards: 0, summaries: [{ key: "porch-and-party", totals: { money: null, requests: 1, visits: 1 } }] });
    const all = r.lines.join("\n");
    expect(all).toContain("Porch & Party: 1 request, 1 visit in 28 days; 2 queued.");
    const many = reportSection([pnp], { ...O, cards: 0, summaries: [{ key: "porch-and-party", totals: { money: null, requests: 0, visits: 0 } }] }).lines.join("\n");
    expect(many).toContain("0 requests, 0 visits in 28 days");
    expect(all).toContain("Queued, for example: Porch & Party, WordPress guide syndication; Porch & Party, TikTok screen video.");
  });

  it("a plain model sentence is kept, only its first sentence", () => {
    const r = reportSection([{ ...pnp, decision: "Christmas porches lead, so reels show finished porches. More below." }], { ...O, cards: 0 });
    expect(r.lines[1]).toMatch(/2 queued\. Christmas porches lead, so reels show finished porches\.$/);
  });

  it("every two weeks: day 12 is not due, day 13 is", () => {
    expect(reportDue(null, "2026-11-23")).toBe(true);
    expect(reportDue("2026-11-23", "2026-12-05")).toBe(false);
    expect(reportDue("2026-11-23", "2026-12-06")).toBe(true);
  });
});

describe("backlink orders (22 Nov 2026: the network defers to the Director)", () => {
  const at = (n: number) => "t".repeat(n);
  it("a topic is 1 to TOPIC_MAX characters on one line: exactly TOPIC_MAX is kept, one more is not, never cut short", () => {
    expect(topicOf(`  How to keep a rent   receipt `)).toBe("How to keep a rent receipt");
    expect(topicOf(at(TOPIC_MAX))).toBe(at(TOPIC_MAX));
    expect(topicOf(at(TOPIC_MAX + 1))).toBeNull();
    expect(topicOf("   ")).toBeNull();
    expect(topicOf(42)).toBeNull();
  });

  it("orders: ordered backlinks items of each business's newest decided row only, four fields, a broken row skipped", () => {
    const ordered = (topic: string, draft = "lead") => ({ kind: "ordered", item: { channel: "backlinks", format: "guide", draft, why: "visits rose", topic } });
    const rows = [
      { id: "gdc_a1", business: "approvalprep", state: "decided", created_at: 1, actions: JSON.stringify([ordered("old run")]) },
      { id: "gdc_a2", business: "approvalprep", state: "decided", created_at: 2, actions: JSON.stringify([
        ordered("Dispute letters by mail"),
        { kind: "queued", item: { channel: "pinterest", format: "pin", draft: "PIN DRAFT", why: "w" } },
        { kind: "blocked", why: "x", item: { channel: "backlinks", format: "guide", draft: "BLOCKED", why: "w", topic: "blocked topic" } },
        { kind: "ordered", item: { channel: "pinterest", format: "pin", draft: "WRONG CHANNEL", why: "w", topic: "t" } },
        { kind: "ordered", item: { channel: "backlinks", format: "guide", draft: "LONG", why: "w", topic: at(TOPIC_MAX + 1) } },
        null,
      ]) },
      { id: "gdc_k1", business: "keepmyproof", state: "held: no model", created_at: 3, actions: JSON.stringify([ordered("held row")]) },
      { id: "gdc_bad", business: "dream-wedding", state: "decided", created_at: 4, actions: "{not json" },
      { id: "gdc_obj", business: "a-player-mode", state: "decided", created_at: 5, actions: JSON.stringify({ kind: "ordered" }) },
    ];
    const { orders, skipped } = backlinkOrders(rows);
    expect(orders).toEqual([{ business: "approvalprep", topic: "Dispute letters by mail", draft: "lead", why: "visits rose" }]);
    expect(skipped.sort()).toEqual(["gdc_bad", "gdc_obj"]);
    expect(backlinkOrders([])).toEqual({ orders: [], skipped: [] });
  });

  it("her report counts the orders, never as a post queued", () => {
    const rows = [{ label: "ApprovalPrep", business: "approvalprep", state: "decided", decision: "More guides.", actions: [{ kind: "ordered", item: { channel: "backlinks", format: "guide", draft: "d", why: "w", topic: "t" } }] }];
    const r = reportSection(rows, { cards: 0, origin: "https://x", at: 0 });
    expect(r.lines[0]).toMatch(/^Nothing to do: one backlink article was requested/);
    expect(r.lines.join("\n")).toMatch(/ApprovalPrep: numbers not read in 28 days; 1 backlink article requested\./);
  });
});
