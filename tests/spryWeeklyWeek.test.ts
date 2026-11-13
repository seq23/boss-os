/**
 * A REPORT FROM THIS WEEK COUNTS (7 Nov 2026 live read): read on Saturday 7 Nov, the Spry Labs weekly
 * called seven reports made on Wednesday 4 Nov "not this week", because freshness was 36 hours, not
 * her week. Her week is Monday to Sunday on Chicago's clock.
 */
import { describe, expect, it } from "vitest";
import { summaryProblem, chicagoWeekOf, SPRY_WEEKLY } from "../src/shared/boss/spryWeekly/compose.mjs";

const at = (iso: string) => ({ schema: SPRY_WEEKLY.schema, generated_at: iso });
const SAT = Date.parse("2026-11-07T18:00:00Z"); // Saturday noon, Central

describe("the Spry Labs weekly judges a report by her week", () => {
  it("a report from Wednesday of the current week counts on Saturday", () => {
    expect(summaryProblem(at("2026-11-04T13:20:00Z"), { now: SAT })).toBeNull();
  });
  it("last week's report does not (negative proof)", () => {
    expect(summaryProblem(at("2026-10-28T13:20:00Z"), { now: SAT })).toMatch(/not this week/);
  });
  it("the week turns on Monday on her clock, not UTC's", () => {
    // Sunday 8 Nov, 11:30 pm Central is 05:30 UTC Monday: still the week of Monday 2 Nov.
    expect(chicagoWeekOf(Date.parse("2026-11-09T05:30:00Z"))).toBe("2026-11-02");
    expect(chicagoWeekOf(Date.parse("2026-11-09T06:30:00Z"))).toBe("2026-11-09");
  });
  it("an early-week source (How We Know, Sunday, 100 hours) counts all week; the Sunday before that does not", () => {
    expect(summaryProblem(at("2026-11-01T14:00:00Z"), { now: SAT, maxAgeHours: 100 })).toBeNull();
    expect(summaryProblem(at("2026-10-25T14:00:00Z"), { now: SAT, maxAgeHours: 100 })).toMatch(/not this week/);
  });
  it("a source's own age limit still lets a late-Sunday report count on Monday morning", () => {
    expect(summaryProblem(at("2026-11-09T04:00:00Z"), { now: Date.parse("2026-11-09T14:00:00Z"), maxAgeHours: 36 })).toBeNull();
  });
});

describe("the Spry Labs weekly never asks her, and never sends her to GitHub (7 Nov 2026 live read)", async () => {
  const { composeSpryWeekly } = await import("../src/shared/boss/spryWeekly/compose.mjs");
  const src = SPRY_WEEKLY.sources[0];
  const summary = { schema: SPRY_WEEKLY.schema, generated_at: "2026-11-04T13:20:00Z", run_url: "https://github.com/seq23/x/actions/runs/1",
    sites: [{ host: "approvalprep.com", state: "fine", why: [] }, { host: "dreamweddingbuilder.com", state: "fine", why: [] }],
    notes: ["Needs you: read the stop issue on GitHub — +2 more waiting on you", "23 new pages published this week."] };
  const mail = composeSpryWeekly({ [src!.key]: { summary } }, { now: SAT });
  const words = JSON.stringify(mail.sections);
  it("a repo's ask becomes the team's line; its other notes stay", () => {
    expect(words).not.toMatch(/github/i);
    expect(words).not.toMatch(/waiting on you|needs you/i);
    expect(words).toContain("23 new pages published this week.");
    expect(words).toMatch(/The team has one thing to clear here/);
  });
  it("negative proof: with no such note, no team line is invented", () => {
    const quiet = composeSpryWeekly({ [src!.key]: { summary: { ...summary, notes: ["23 new pages published this week."] } } }, { now: SAT });
    expect(JSON.stringify(quiet.sections)).not.toMatch(/The team has/);
  });
});

describe("the Spry Labs weekly sends no empty edition (13 Nov 2026)", async () => {
  // @ts-expect-error — plain ESM with no declaration file
  const { emptyEdition } = await import("../scripts/ops/spry-weekly.mjs");
  const summary = { schema: SPRY_WEEKLY.schema, generated_at: "2026-11-04T13:20:00Z", sites: [], notes: [] };
  it("no report from any business is empty; one report is an edition", () => {
    expect(SPRY_WEEKLY.sources.length).toBeGreaterThan(0);
    expect(emptyEdition({})).toBe(true);
    expect(emptyEdition(Object.fromEntries(SPRY_WEEKLY.sources.map((s: any) => [s.key, { problem: "its report could not be read" }])))).toBe(true);
    expect(emptyEdition({ [SPRY_WEEKLY.sources[0]!.key]: { summary } })).toBe(false);
  });
});
