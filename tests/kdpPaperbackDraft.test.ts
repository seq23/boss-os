import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs ops script, no types
import { paperbackDraftId } from "../scripts/ops/kdp-paperback.mjs";

/**
 * A PAPERBACK DRAFT IS PICKED UP, NEVER DUPLICATED (25 Nov 2026).
 * Hostile Work Environment's paperback draft sat on the bookshelf and the run stopped "resumed by hand".
 * The run now reads the draft's id and goes to its content step, but only when the page names exactly one.
 */
describe("paperbackDraftId", () => {
  it("reads the one draft id from the bookshelf links", () => {
    const html = '<a href="/en_US/title-setup/paperback/26QJZDF5MW3/details">x</a><a href="/en_US/title-setup/paperback/26QJZDF5MW3/pricing">';
    expect(paperbackDraftId(html)).toBe("26QJZDF5MW3");
  });
  it("refuses when two different drafts are on the page", () => {
    expect(paperbackDraftId("title-setup/paperback/AAAAAAAA11/content title-setup/paperback/BBBBBBBB22/details")).toBeNull();
  });
  it("is null when there is no draft link or no page", () => {
    expect(paperbackDraftId("<html>createPaperbackLink</html>")).toBeNull();
    expect(paperbackDraftId(undefined)).toBeNull();
  });
});
