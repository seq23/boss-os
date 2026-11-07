/*
 * WHAT SEARCH READINESS COVERS (owner, 7 Nov 2026, personal brain "Names and groups"): friends' sites
 * + selling sites + all of the Divine 9, each grid row naming its group and business; an Industry
 * Guides vertical is never a business of its own; a sunsetting site is audited, never worked.
 */
import { describe, it, expect } from "vitest";
import { loadChecklist, fixBriefs, workQueue } from "../src/shared/boss/searchReadiness/audit.mjs";
import { renderStandings } from "../src/shared/boss/searchReadiness/page.mjs";
import sites from "../src/shared/boss/searchReadiness/sites.json";

const groups = (sites as any)._groups;
const rows = (sites as any).grid_repos as any[];
const GROUPS = ["divine_9", "selling", "friends", "support"];

describe("Search Readiness groups (7 Nov 2026)", () => {
  it("every grid row names a group and a business that group lists; every named business has a site or a named gap", () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(groups.divine_9).toHaveLength(9);
    for (const r of rows) {
      expect(GROUPS, r.domain).toContain(r.group);
      expect(groups[r.group], r.domain).toContain(r.business);
    }
    for (const g of GROUPS) for (const biz of groups[g]) {
      expect(rows.some((r) => r.business === biz) || Boolean(groups.gaps?.[biz]), `${g}: ${biz}`).toBe(true);
    }
    // The six verticals are Industry Guides, never their own business.
    for (const d of ["uscisexam.com", "dentistryguides.com", "hormonesivhair.com", "neuroevalguides.com", "theaccidentguides.com", "memphisseniorcarehomes.com"]) {
      expect(rows.find((r) => r.domain === d)?.business, d).toBe("Industry Guides");
    }
    expect(rows.find((r) => r.domain === "heygetonmylevel.com")?.group).toBe("divine_9");
  });

  it("a sunsetting site is audited and its briefs are never worked; the same site without the flag is", () => {
    const checklist = loadChecklist();
    const spry = rows.find((r) => r.domain === "spryexecutiveos.com");
    expect(spry.sunsetting).toBeTruthy();
    const result = [{ id: "b3", status: "fail", detail: "https://spryexecutiveos.com/about: no description" }];
    const sun = fixBriefs(checklist, [{ site: spry, host: spry.domain, results: result }]);
    expect(sun.map((b: any) => b.disposition)).toEqual(["sunsetting"]);
    expect(workQueue(sun)).toMatchObject({ workable: 0, chunks: [] });
    const live = fixBriefs(checklist, [{ site: { ...spry, sunsetting: undefined }, host: spry.domain, results: result }]);
    expect(live.map((b: any) => b.disposition)).toEqual(["fix"]);
  });

  it("the standings name the business first and mark a sunsetting site", () => {
    const site = (d: string) => ({ site: rows.find((r) => r.domain === d), results: [{ id: "b3", status: "fail", detail: "x" }], failing: [{}] });
    const html = renderStandings({ day: "2026-11-09", sites: [site("dentistryguides.com"), site("spryexecutiveos.com")] }, loadChecklist());
    expect(html).toMatch(/<b>Industry Guides<\/b> · dentistryguides\.com/);
    expect(html).toMatch(/spryexecutiveos\.com <span class="muted" data-sunsetting>sunsetting<\/span>/);
    expect(html).not.toMatch(/<td>dentistryguides\.com/);
  });
});
