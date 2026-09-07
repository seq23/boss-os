import { describe, expect, it } from "vitest";
import { ARCS, VEHICLES, ENGINE, secondBlockVehicle, isWestPeekDay } from "../../src/worker/boss/spirit/arcs";
import { instructionsFor, RUN_OF_SHOW } from "../../src/worker/boss/today/runOfShow";
import { composeGratitude, GRATITUDE_THEMES, themeFor } from "../../src/worker/boss/spirit/practice";

/**
 * THE SYSTEM KNEW HER RULES AND NOT HER GOALS.
 *
 * Pillars, floors, laws, verdicts — all encoded. Her two active arcs, her five wealth vehicles, the
 * protected engine and the weekend build order were in a document and in no code, so the Run of Show
 * rendered seven correct titles describing the SHAPE of the work and naming none of it. "The first
 * concrete brokerage or active wealth action" asks her to decide what that is, which is the decision
 * the whole system exists to have already made.
 */

const MON = 1, WED = 3, SAT = 6, SUN = 0;

describe("§4 — only two arcs are in active push", () => {
  it("keeps the count at two, because §4 opens by saying not to foreground more", () => {
    expect(ARCS.filter((a) => a.push)).toHaveLength(2);
    expect(ARCS.filter((a) => a.push).map((a) => a.key).sort()).toEqual(["brokerage", "keto"]);
  });

  it("files weight loss under Body, not as a track", () => {
    // §4.3 is explicit: it is a transformation arc inside the Body pillar. Making it a track would
    // put it among the always-on interpretive filters, where it would never be worked directly.
    expect(ARCS.find((a) => a.key === "keto")!.pillar).toBe("body");
  });
});

describe("§5 — the vehicles, and which one owns today", () => {
  it("protects exactly one engine, and it is the brokerage", () => {
    expect(VEHICLES.filter((v) => v.engine)).toHaveLength(1);
    expect(ENGINE.key).toBe("brokerage");
  });

  it("GIVES THE FIRST MONEY MOVE TO THE BROKERAGE EVERY DAY", () => {
    // §5.3's right of first refusal. Not weighed against the others — it is the answer unless
    // brokerage is blocked, on a weekday, a weekend, and a recovery day alike.
    for (const weekday of [SUN, MON, WED, SAT]) {
      const i = instructionsFor({ weekday, dayMode: null, anchor: null });
      expect(i.first_wealth_block).toContain("brokerage");
    }
    expect(instructionsFor({ weekday: MON, dayMode: "recovery", anchor: null }).first_wealth_block).toContain("brokerage");
  });

  it("names Wednesday as the West Peek cadence without her remembering", () => {
    expect(isWestPeekDay(WED)).toBe(true);
    expect(instructionsFor({ weekday: WED, dayMode: null, anchor: null }).afternoon_wealth_admin).toContain("Scooter");
  });

  it("runs §5.5's build order at the weekend and West Peek on a weekday", () => {
    // "Weekday side projects stay background unless strategically justified" — so a Tuesday
    // afternoon is not Industry Guides, and a Saturday is, in the order she wrote.
    expect(secondBlockVehicle(SAT).key).toBe("industry_guides");
    expect(secondBlockVehicle(SUN).key).toBe("industry_guides");
    expect(secondBlockVehicle(MON).key).toBe("west_peek");
  });

  it("gives every one of the seven blocks something to do", () => {
    // The regression this pins: blocks rendering their generic `intent` because no instruction was
    // ever derived. A block with nothing in it is the cognitive load, not the relief.
    const i = instructionsFor({ weekday: MON, dayMode: null, anchor: "Close the raise" });
    for (const b of RUN_OF_SHOW) {
      expect(i[b.key], `${b.key} has no instruction`).toBeTruthy();
      expect(i[b.key]).not.toBe(b.intent);
    }
  });

  it("treats the food check as the weight-loss arc, not housekeeping", () => {
    expect(instructionsFor({ weekday: MON, dayMode: null, anchor: null }).food_guardrail_check).toContain("arc");
  });
});

describe("§8.5 — the sentence, composed here and sent nowhere", () => {
  const FACTS = {
    anchor: "Close the raise", dayMode: null, openLoops: 2, lastVerdict: "full",
    holding: "The fund closes at target", westPeekDay: false,
    secondVehicle: "West Peek Ventures", continuousDays: 5,
  };

  it("produces a sentence for every one of her six themes", () => {
    // A theme with no usable form would silently fall through to another, and the rotation §8.5
    // asks for would quietly become four themes instead of six.
    const covered = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const dayId = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const out = composeGratitude(dayId, FACTS);
      expect(out, `no sentence on ${dayId}`).not.toBeNull();
      covered.add(out!.theme);
    }
    expect(covered.size).toBe(GRATITUDE_THEMES.length);
  });

  it("VARIES WITHIN A THEME, so the same theme is not the same sentence", () => {
    // The theme rotates every six days. Without the form also rotating, she would hear the same six
    // sentences for the rest of her life — which is the repetition §8.5's 90-day rule is about.
    const seen = new Set<string>();
    for (let i = 0; i < 90; i += 6) {
      const dayId = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      seen.add(composeGratitude(dayId, FACTS)!.sentence);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it("is the same sentence all day, because it is a mantra", () => {
    const a = composeGratitude("2026-09-07", FACTS);
    const b = composeGratitude("2026-09-07", FACTS);
    expect(a!.sentence).toBe(b!.sentence);
  });

  it("USES A REAL FACT WHEN IT HAS ONE, AND NEVER INVENTS IT WHEN IT DOES NOT", () => {
    /*
     * Every form requires something true of her today and returns null without it. That is the
     * mechanism against §8.5's four prohibitions — a form with no fact stands aside rather than
     * falling back to something that would be true of anybody.
     *
     * The first two versions of this test asserted the anchor would appear on a particular date.
     * Both were wrong for the same reason: which form runs depends on the theme AND the rotation
     * offset, so pinning a date pins the wrong thing. The property is what matters — across a
     * stretch of days the anchor gets used, and it NEVER appears on a day that has none.
     */
    const days = Array.from({ length: 40 }, (_, i) =>
      new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));

    const withAnchor = days.map((d) => composeGratitude(d, { ...FACTS, anchor: "Close the raise" })!.sentence);
    const without = days.map((d) => composeGratitude(d, { ...FACTS, anchor: null })!.sentence);

    // It is genuinely used when it exists...
    expect(withAnchor.some((x) => x.toLowerCase().includes("close the raise"))).toBe(true);
    // ...and never conjured when it does not, on any day of the rotation.
    expect(without.some((x) => x.toLowerCase().includes("close the raise"))).toBe(false);
    // And a day with no anchor still produces a sentence, from some other real fact.
    expect(without.every((x) => x.length > 0)).toBe(true);
  });

  it("never claims a streak on a broken run", () => {
    // §44's tone: continuity is not a score to protect. The continuity sentence is simply
    // unavailable when there is no run, rather than being softened into something vague.
    const out = composeGratitude("2026-01-08", { ...FACTS, continuousDays: 0, anchor: null, lastVerdict: null });
    expect(out!.sentence).not.toMatch(/days running/);
  });
});
