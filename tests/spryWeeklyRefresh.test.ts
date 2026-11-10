/**
 * THE MONTHLY REFRESH COUNT (10 Nov 2026): the first Spry Labs weekly of the month says how many pages
 * the refresh lanes really changed last month, across how many sites, and a zero always says why.
 * Rule 0: an unread ledger, a lane that did not run and a lane that changed nothing while pages were
 * due are each said, never folded into a number.
 */
import { describe, expect, it } from "vitest";
import { refreshCount, refreshLine, lastMonth, laneState } from "../src/shared/boss/spryWeekly/refresh.mjs";
import { composeSpryWeekly } from "../src/shared/boss/spryWeekly/compose.mjs";

const lgg = { src: { repo: "local-guides-generator", label: "local guides" }, ledger: {
  next_due: "2026-12-07",
  runs: [{ at: "2026-11-03", due: 3, refreshed: 1 }, { at: "2026-11-20", due: 3, refreshed: 1 }],
  pages: {
    "https://dentistryguides.com/guides/a/": { checked_at: "2026-11-03", refreshed_at: "2026-11-03" },
    "https://dentistryguides.com/guides/b/": { checked_at: "2026-11-04", changes: [] },
    "https://theaccidentguides.com/guides/c/": { checked_at: "2026-11-20", refreshed_at: "2026-11-20" },
    "https://theaccidentguides.com/guides/d/": { checked_at: "2026-10-30", refreshed_at: "2026-10-30" },
  } } };
const dw = { src: { repo: "dream-wedding-builder", site: "weddingchecklistpdf.com", label: "Dream Wedding" }, ledger: {
  runs: [{ at: "2026-11-02", outcome: "REFRESHED", refreshed: 1 }],
  pages: { "/guides/x": { status: "REFRESHED", at: "2026-11-02" }, "/guides/y": { status: "REJECTED", at: "2026-11-02" } } } };
// The real shape of an idle month: the local-guides lane's 10 Nov 2026 run, and Dream Wedding's QUEUE_EMPTY runs.
const lggIdle = { src: { repo: "local-guides-generator", label: "local guides" }, ledger: { next_due: "2026-12-07", pages: {}, runs: [{ at: "2026-11-10", due: 0, next_due: "2026-12-07", checked: 0, refreshed: 0, sites: 0 }] } };
const dwIdle = { src: { repo: "dream-wedding-builder", site: "weddingchecklistpdf.com", label: "Dream Wedding" }, ledger: { pages: {}, runs: [{ at: "2026-11-10", outcome: "QUEUE_EMPTY", refreshed: 0, queued: 0 }] } };
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
  it("a zero says why: nothing was due, and when the next is", () => {
    expect(refreshLine([lggIdle, dwIdle], { now: DEC2 })).toBe("November: 0 pages refreshed across 0 sites (nothing was due; the next pages come due Dec 7).");
  });
  it("pages due and nothing changed is never 'nothing was due' (negative proof)", () => {
    const stuck = { ...lggIdle, ledger: { ...lggIdle.ledger, runs: [{ at: "2026-11-12", due: 3, refreshed: 0 }] } };
    expect(laneState(stuck, lastMonth(DEC2)).state).toBe("stalled");
    const line = refreshLine([stuck, dwIdle], { now: DEC2 });
    expect(line).toBe("November: 0 pages refreshed across 0 sites (the local guides refresh had pages due and changed none this month).");
    expect(line).not.toMatch(/nothing was due/);
  });
  it("a lane that did not run, or could not be read, is said, never counted as zero", () => {
    expect(refreshLine([{ ...lggIdle, ledger: { pages: {}, runs: [] } }, dw], { now: DEC2 })).toBe("November: 1 page refreshed across 1 site (the local guides refresh did not run this month).");
    expect(refreshLine([lgg, { src: { repo: "dream-wedding-builder", label: "Dream Wedding" }, problem: "not read" }], { now: DEC2 })).toBe("November: 2 pages refreshed across 2 sites (the Dream Wedding refresh could not be read this month).");
    const both = refreshLine([{ ...lggIdle, ledger: { pages: {}, runs: [] } }, { ...dwIdle, ledger: { pages: {}, runs: [] } }], { now: DEC2 });
    expect(both).toBe("November: 0 pages refreshed across 0 sites (the local guides and Dream Wedding refreshes did not run this month).");
    expect(both).not.toMatch(/team checks|one lane/);
  });
  it("question pages the engine refreshed count once, across their sites; a quiet engine adds no clause", () => {
    const engine = (repo: string, pages: unknown[]) => ({ src: { repo, kind: "engine" as const, label: "question page" }, ledger: { pages } as never });
    const reads = [lgg, dw,
      engine("approvalprep", [{ url: "https://approvalprep.com/questions/a/", refreshed: { at: "2026-11-12", changes: ["question added"] } }, { url: "https://approvalprep.com/questions/b/", refreshed: { at: "2026-11-12", changes: [] } }]),
      engine("dailystory", [{ url: "https://time-2-read.com/questions/c/", published_at: "2026-11-01" }])];
    expect(refreshLine(reads, { now: DEC2 })).toBe("November: 4 pages refreshed across 4 sites.");
    expect(refreshLine([lggIdle, dwIdle, engine("dailystory", [])], { now: DEC2 })).toBe("November: 0 pages refreshed across 0 sites (nothing was due; the next pages come due Dec 7).");
    expect(refreshLine([lgg, dw, { src: { repo: "keepmyproof", kind: "engine" as const, label: "question page" }, problem: "not read" }], { now: DEC2 })).toBe("November: 3 pages refreshed across 3 sites (the question page refresh could not be read this month).");
  });

  it("lands in the email's Search loop section", () => {
    const mail = composeSpryWeekly({}, { now: DEC2, refresh: [lgg, dw] });
    expect(mail.sections.at(-1)?.items).toContain("Page refresh in November: 3 pages refreshed across 3 sites.");
  });
});
