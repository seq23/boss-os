/**
 * THE MONTHLY REFRESH COUNT (10 Nov 2026): the first Spry Labs weekly of the month says how many pages
 * the refresh lanes really changed last month, across how many sites. Rule 0: an unread ledger is said.
 */
import { describe, expect, it } from "vitest";
import { refreshCount, refreshLine, lastMonth } from "../src/shared/boss/spryWeekly/refresh.mjs";
import { composeSpryWeekly } from "../src/shared/boss/spryWeekly/compose.mjs";

const lgg = { src: { repo: "local-guides-generator" }, ledger: { pages: {
  "https://dentistryguides.com/guides/a/": { checked_at: "2026-11-03", refreshed_at: "2026-11-03" },
  "https://dentistryguides.com/guides/b/": { checked_at: "2026-11-04", changes: [] },
  "https://theaccidentguides.com/guides/c/": { checked_at: "2026-11-20", refreshed_at: "2026-11-20" },
  "https://theaccidentguides.com/guides/d/": { checked_at: "2026-10-30", refreshed_at: "2026-10-30" },
} } };
const dw = { src: { repo: "dream-wedding-builder", site: "weddingchecklistpdf.com" }, ledger: { pages: {
  "/guides/x": { status: "REFRESHED", at: "2026-11-02" },
  "/guides/y": { status: "REJECTED", at: "2026-11-02" },
} } };
const DEC2 = Date.parse("2026-12-02T14:15:00Z"); // first Wednesday of December, 08:15 Central

describe("the monthly refresh count", () => {
  it("counts only pages really changed last month, and their sites", () => {
    expect(lastMonth(DEC2)).toMatchObject({ from: "2026-11-01", to: "2026-11-30", label: "November" });
    expect(refreshCount([lgg, dw], lastMonth(DEC2))).toEqual({ pages: 3, sites: 3, unread: [] });
  });
  it("is in the first weekly of the month only", () => {
    expect(refreshLine([lgg, dw], { now: DEC2 })).toBe("November: 3 pages refreshed across 3 sites.");
    expect(refreshLine([lgg, dw], { now: Date.parse("2026-12-09T14:15:00Z") })).toBeNull();
  });
  it("an unread ledger is said, never counted as zero (negative proof)", () => {
    expect(refreshLine([lgg, { src: { repo: "dream-wedding-builder" }, problem: "not read" }], { now: DEC2 })).toMatch(/not measured for one lane/);
  });
  it("lands in the email's Search loop section", () => {
    const mail = composeSpryWeekly({}, { now: DEC2, refresh: [lgg, dw] });
    expect(mail.sections.at(-1)?.items).toContain("Page refresh in November: 3 pages refreshed across 3 sites.");
  });
});
