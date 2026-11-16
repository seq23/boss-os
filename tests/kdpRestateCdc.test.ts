import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops script, no types
import { restateCdc } from "../scripts/ops/kdp-books/lib.mjs";

// Her call 16 Nov 2026: the Co-Parenting Log opened 24 state lines with "The CDC lists…".
describe("a CDC fee line leads with what it is about, keeping the figure, the office and the source", () => {
  it("restates each form and leaves other lines alone", () => {
    const lines = [
      "The CDC lists $15.00 as the cost of a divorce record copy from the Alabama Center for Health Statistics.",
      "The CDC lists $20 as the cost of a divorce record copy in Arizona.",
      "The CDC lists $34.00 for a Michigan divorce record, with a $12.00 rush fee extra.",
    ].map(restateCdc);
    expect(lines).toEqual([
      "The Alabama Center for Health Statistics charges $15.00 for a copy of a divorce record, according to the CDC.",
      "In Arizona, a copy of a divorce record costs $20, according to the CDC.",
      "For a Michigan divorce record, the CDC lists $34.00, with a $12.00 rush fee extra.",
    ]);
    for (const l of lines) expect(l).not.toMatch(/^The CDC lists/);
    expect(restateCdc("File within 30 days.")).toBe("File within 30 days.");
  });
});
