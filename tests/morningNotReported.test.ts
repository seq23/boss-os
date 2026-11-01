import { describe, expect, it } from "vitest";
import { buildDay, notReportedRepairs } from "../scripts/ops/your-day.mjs";
import { sectionsNotReported, MORNING_SECTION_SPECS } from "../src/shared/boss/mail/morningSections.mjs";

/**
 * A SECTION THAT DID NOT REPORT IN IS SAID AND REPAIRED (rule 0, 1 Nov 2026). A Mac job whose post
 * failed used to leave its section silently out of Simone's morning email. Now every section the
 * registry expects that day with no copy from the last 24 hours is one thin line near the top and
 * one repair; a section that reported in (even an empty "all clear") is neither.
 */
const NOW = Date.parse("2026-11-03T12:40:00Z"); // Tuesday 06:40 Central
const fresh = (section: string, hoursAgo = 2) => ({ section, at: new Date(NOW - hoursAgo * 3_600_000).toISOString(), decide: [], rows: [], lines: [] });
const everyExpected = () => Object.fromEntries(MORNING_SECTION_SPECS.filter((s) => s.expect?.includes("Tuesday")).map((s) => [s.name, fresh(s.name)]));

describe("morning sections that did not report in", () => {
  it("every expected section present (an empty all clear counts) → no line, no repair", () => {
    const r = sectionsNotReported(everyExpected(), { weekday: "Tuesday", now: NOW });
    expect(Object.keys(everyExpected()).length).toBeGreaterThan(3);
    expect(r.missing).toEqual([]);
    const email = buildDay({ morning: r.sections, notReported: r.missing }, NOW);
    expect(email.text).not.toContain("Not in today's email");
    expect(notReportedRepairs(r.missing, [])).toEqual([]);
  });

  it("a missing section and yesterday's copy are flagged, dropped, said once near the top, and repaired once", () => {
    const sections: Record<string, any> = everyExpected();
    delete sections.lp;
    sections.risk = fresh("risk", 25); // yesterday's copy must not pass for today's
    sections.risk.lines = ["yesterday's line"];
    const r = sectionsNotReported(sections, { weekday: "Tuesday", now: NOW });
    expect(r.missing.map((m) => m.name).sort()).toEqual(["lp", "risk"]);
    expect(r.sections.risk).toBeUndefined();
    const email = buildDay({ morning: r.sections, notReported: r.missing }, NOW);
    const first = email.text.split("\n").find((l: string) => l.trim()) ?? "";
    expect(first).toContain("Not in today's email: LP updates and Toni's money and mail check");
    expect(email.text).not.toContain("yesterday's line");
    expect(email.problems).toEqual([]);
    const repairs = notReportedRepairs(r.missing, []);
    expect(repairs.map((x) => x.title)).toEqual(r.missing.map((m) => `The morning section "${m.name}" did not report in`));
    // A repair still open for a section is not opened again the next morning.
    expect(notReportedRepairs(r.missing, [{ title: repairs[0]!.title, status: "queued" }])).toHaveLength(1);
  });

  it("a weekly section is expected only on its day", () => {
    expect(sectionsNotReported({}, { weekday: "Monday", now: NOW }).missing.map((m) => m.name)).toContain("scorecard");
    expect(sectionsNotReported({}, { weekday: "Tuesday", now: NOW }).missing.map((m) => m.name)).not.toContain("scorecard");
  });
});
