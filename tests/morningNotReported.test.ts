import { describe, expect, it } from "vitest";
import { buildDay, notReportedRepairs } from "../scripts/ops/your-day.mjs";
import { sectionsNotReported, morningEmailSlot, MORNING_SECTION_SPECS } from "../src/shared/boss/mail/morningSections.mjs";

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
    // The team's note goes to the Updates page, never her email (7 Nov 2026); the run posts it.
    expect(email.text).not.toContain("Not in today's email");
    expect(email.teamNotes.join(" ")).toContain("Not in today's email: LP updates and Toni's money and mail check");
    expect(email.text).not.toContain("yesterday's line");
    expect(email.problems).toEqual([]);
    const repairs = notReportedRepairs(r.missing, []);
    expect(repairs.map((x) => x.title)).toEqual(r.missing.map((m) => `The morning section "${m.name}" did not report in`));
    // A repair still open for a section is not opened again the next morning.
    expect(notReportedRepairs(r.missing, [{ title: repairs[0]!.title, status: "queued" }])).toHaveLength(1);
  });

  // 3 Nov 2026: this prompt sent a repair to "~/.boss-os/logs", which does not exist — the real
  // producer logs are ~/Library/Logs/boss-duty (a local_job's own dated run) and ~/Library/Logs/
  // boss-agent (the launchd chain it ran inside). A prompt that names an empty directory wastes the
  // whole repair run, so this is pinned negatively.
  it("the repair prompt points at the real log directories, never the one that does not exist", () => {
    const sections: Record<string, any> = everyExpected();
    delete sections.lp;
    const r = sectionsNotReported(sections, { weekday: "Tuesday", now: NOW });
    const [repair] = notReportedRepairs(r.missing, []);
    expect(repair!.prompt).toContain("~/Library/Logs/boss-duty/");
    expect(repair!.prompt).toContain("~/Library/Logs/boss-agent/");
    expect(repair!.prompt).not.toContain("~/.boss-os/logs");
  });

  it("a Saturday safety tick gives the same prospect result as the scheduled email", () => {
    const slot = Date.parse("2026-11-21T12:40:00Z");
    const late = Date.parse("2026-11-21T19:47:08Z");
    for (const now of [slot, late]) {
      const prospects = { ...fresh("prospects"), at: "2026-11-20T15:31:12.590Z" };
      const result = sectionsNotReported({ prospects }, { weekday: "Saturday", now });
      expect(result.sections.prospects).toEqual(prospects);
      expect(notReportedRepairs(result.missing, []).map((repair) => repair.title))
        .not.toContain('The morning section "prospects" did not report in');

      const old = { ...prospects, at: "2026-11-19T15:31:12.590Z" };
      const missing = sectionsNotReported({ prospects: old }, { weekday: "Saturday", now });
      expect(missing.sections.prospects).toBeUndefined();
      expect(missing.missing.map((section) => section.name)).toContain("prospects");
    }
  });

  it.each([
    ["2026-07-18T02:00:00Z", "2026-07-17T11:40:00Z"],
    ["2026-11-01T06:00:00Z", "2026-11-01T12:40:00Z"],
    ["2026-12-18T02:00:00Z", "2026-12-17T12:40:00Z"],
  ])("finds the Central email slot for %s", (now, expected) => {
    expect(morningEmailSlot(Date.parse(now))).toBe(Date.parse(expected));
  });

  it("a weekly section is expected only on its day", () => {
    expect(sectionsNotReported({}, { weekday: "Monday", now: NOW }).missing.map((m) => m.name)).toContain("scorecard");
    expect(sectionsNotReported({}, { weekday: "Tuesday", now: NOW }).missing.map((m) => m.name)).not.toContain("scorecard");
  });
});
