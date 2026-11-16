import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops script, no types
import { readRefusal, stopNeedsHer } from "../scripts/ops/kdp-new-title.mjs";

// 9 Nov 2026: two live updates stopped "Please fix the highlighted error(s)" and the log never said
// which box. The boxes were the other marketplaces' list prices, which the run fills.
describe("Amazon's refusal names the highlighted field, and a field we fill is the run's repair", () => {
  it("names every highlighted field and is not her stop", () => {
    const r = readRefusal("Please fix the highlighted error(s) to continue.", ["Set a list price for Amazon.in", "Set a list price for Amazon.co.uk", "Set a list price for Amazon.in"]);
    expect(r.code).toBe("FIELDS_HIGHLIGHTED");
    expect(r.fields).toEqual(["Set a list price for Amazon.in", "Set a list price for Amazon.co.uk"]);
    expect(r.said).toContain("Amazon.co.uk");
    expect(stopNeedsHer(r.code)).toBe(false);
  });
  it("reads the fields from the banner's own lines when no inline box shows them", () => {
    const r = readRefusal("Please fix the highlighted error(s) to continue.\nSet a list price for Amazon.mx", []);
    expect(r.fields).toEqual(["Set a list price for Amazon.mx"]);
  });
  it("a refusal with no highlighted box stays PUBLISH_REFUSED; no error is no refusal", () => {
    expect(readRefusal("This book cannot be published.", []).code).toBe("PUBLISH_REFUSED");
    expect(readRefusal("", [])).toBeNull();
  });
});
