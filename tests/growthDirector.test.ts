/**
 * THE GROWTH RECORD'S PURE RULES (director.mjs), each proven negatively:
 *   - the naming guard blocks the third party's mark in any form;
 *   - her fortnightly report is built from the record: an honest line 1, plain words, "not read" never 0;
 *   - the backlink network reads ordered backlinks items only, four fields, a topic of 1 to TOPIC_MAX
 *     characters never cut short, a broken row skipped.
 * Noelle's decision gate (what she may do) is tests/noelle.test.ts; her record in D1 is tests/boss/noelleRun.test.ts.
 */
import { describe, expect, it } from "vitest";
import { BACKLINKS, TOPIC_MAX, backlinkOrders, topicOf, namingProblems } from "../src/shared/boss/growth/director.mjs";

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

});
