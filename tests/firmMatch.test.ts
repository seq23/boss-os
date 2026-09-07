import { describe, expect, it } from "vitest";
import { compareFirms, core, crossMatch, normalise } from "../scripts/lib/firm-match.mjs";

/**
 * THE MATCHER IS THE PART THAT CAN HURT HER, so it is the part with the tests.
 *
 * Every false-positive case below is a real name from one of her two lists rather than an invented
 * one. The pair that matters most is the guard case: a naive substring search for the buyer
 * candidate "W Capital Partners" matched the LP firm "Lakeview Capital Management" during
 * development, because "w capital" sits inside "Lakeview Capital". A match like that would have her
 * open a call with a stranger believing she already knows them.
 */

describe("firm name matching", () => {
  it("strips legal wrappers, parentheticals and ampersands without losing identity", () => {
    expect(normalise("StepStone Group (VC Secondaries Fund VI)")).toBe("stepstone group");
    expect(normalise("Gordon & Betty Moore Foundation")).toBe("gordon and betty moore foundation");
    expect(core("Medley Partners Management LLC").join(" ")).toBe("medley");
  });

  it("confirms the same firm written two different ways", () => {
    // Both are real: the LP tracker says "StepStone", the buyer sweep found the fund vehicle.
    const v = compareFirms("StepStone Group (VC Secondaries Fund VI)", "StepStone");
    expect(v?.confidence).toBe("confirmed");
    expect(v?.core).toBe("stepstone");
  });

  it("confirms an exact institution name", () => {
    expect(compareFirms("Hamilton Lane", "Hamilton Lane")?.confidence).toBe("confirmed");
  });

  /*
   * The guard. If this ever returns anything but null, the matcher has started inventing
   * relationships and the feature is worse than not existing.
   */
  it("refuses a substring collision — the failure that started this file", () => {
    expect(compareFirms("W Capital Partners", "Lakeview Capital Management")).toBeNull();
    /*
     * The literal collision, spelled so that a substring implementation cannot pass this file:
     * "w capital" is inside "lake-VIEW CAPITAL management". Any matcher that asks "is one name
     * contained in the other" returns a match here and is wrong.
     */
    expect(compareFirms("W Capital", "Lakeview Capital Management")).toBeNull();
  });

  it("refuses two firms that share only descriptive words", () => {
    expect(compareFirms("Top Tier Capital Partners", "Fairview Capital Partners")).toBeNull();
    expect(compareFirms("Callan Family Office", "Heinz Family Office")).toBeNull();
    expect(compareFirms("Boston College Endowment", "Boston University Investment Office")).toBeNull();
  });

  it("refuses a name with no distinctive core at all", () => {
    expect(compareFirms("Capital Partners", "Partners Capital")).toBeNull();
  });

  it("refuses a one-letter core, however well the rest lines up", () => {
    expect(compareFirms("W Capital Partners", "W Ventures")).toBeNull();
  });

  it("refuses a generic word as a confident match, and does not silently promote it", () => {
    const v = compareFirms("Industry Ventures", "Industry Partners");
    expect(v).toBeNull();
  });

  it("reports a divergent-but-plausible pair as NEAR, never as confirmed", () => {
    // Same distinctive core, different descriptive word: worth her eye, not worth her mouth.
    const v = compareFirms("Pinegrove Venture Partners", "Pinegrove Capital");
    expect(v?.confidence).toBe("near");
    expect(v?.method).toBe("core_exact");
  });

  it("tolerates a single typo in a long core, as NEAR only", () => {
    const v = compareFirms("Pinegrove", "Pinegrave");
    expect(v?.confidence).toBe("near");
    expect(v?.method).toBe("core_typo");
  });

  it("does not tolerate two edits", () => {
    expect(compareFirms("Pinegrove", "Pinegrast")).toBeNull();
  });

  it("keeps confirmed and near in separate lists so a caller cannot merge them by accident", () => {
    const { confirmed, near } = crossMatch(
      [{ id: "a", name: "StepStone Group (VC Secondaries Fund VI)" }, { id: "b", name: "Pinegrove Venture Partners" }],
      [{ firm: "StepStone" }, { firm: "Pinegrove Capital" }, { firm: "Yale University Endowment" }],
    );
    expect(confirmed.map((r: any) => r.lp.firm)).toEqual(["StepStone"]);
    expect(near.map((r: any) => r.lp.firm)).toEqual(["Pinegrove Capital"]);
  });

  /*
   * RULE 0 IN MINIATURE. A matcher that quietly returned nothing for everything would pass every
   * assertion above, all of which are negative. This one fails if it stops finding anything.
   */
  it("finds something when given her real overlapping pair, so a dead matcher cannot pass", () => {
    const { confirmed } = crossMatch(
      [{ id: "a", name: "StepStone Group (VC Secondaries Fund VI)" }, { id: "b", name: "Hamilton Lane" }],
      [{ firm: "StepStone" }, { firm: "Hamilton Lane" }],
    );
    expect(confirmed.length).toBe(2);
  });
});
