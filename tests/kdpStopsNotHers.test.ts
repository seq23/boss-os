import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops script, no types
import { stopNeedsHer, plainStop } from "../scripts/ops/kdp-new-title.mjs";

// Owner, 14 Nov 2026: a Kindle run stopped on a leftover Amazon pop-up and emailed her to pick
// categories and tick the adult-content box by hand. Page mechanics are the team's repair, never her mail.
describe("a Kindle stop emails her only when she alone can clear it", () => {
  it("sign-in and Amazon refusing the book are hers; a Blocked book is never a step at the Mac (16 Nov 2026)", () => {
    for (const c of ["SIGNIN", "SIGNIN_NOT_DONE", "PUBLISH_REFUSED", "UPLOAD_REFUSED"]) expect(stopNeedsHer(c)).toBe(true);
    expect(stopNeedsHer("BLOCKED")).toBe(false);
  });
  it("categories, the adult box, a stuck or missing control, a save and an unnamed failure are not", () => {
    for (const c of ["CATEGORIES_NOT_SET", "CONTROL_STUCK", "CONTROL_NOT_FOUND", "FIELD_NOT_FOUND", "FIELD_DID_NOT_TAKE", "AI_DISCLOSURE_NOT_SET", "DETAILS_NOT_SAVED", "FAILED"]) expect(stopNeedsHer(c)).toBe(false);
  });
  it("a stuck control is named in plain words, never 'not as expected'", () => {
    expect(plainStop("CONTROL_STUCK")).toMatch(/pop-up/);
    expect(plainStop("CONTROL_STUCK")).not.toMatch(/not as expected/);
  });
});
