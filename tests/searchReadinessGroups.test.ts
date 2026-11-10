/*
 * WHAT SEARCH READINESS COVERS (owner, 7 Nov 2026, personal brain "Names and groups"): friends' sites
 * + all of the Divine 9 + support (no selling group since 10 Nov 2026: Porch & Party is friends & clients), each grid row naming its group and business; an Industry
 * Guides vertical is never a business of its own; a sunsetting site is audited, never worked.
 */
import { describe, it, expect } from "vitest";
import { loadChecklist, fixBriefs, workQueue } from "../src/shared/boss/searchReadiness/audit.mjs";
import { renderStandings } from "../src/shared/boss/searchReadiness/page.mjs";
import sites from "../src/shared/boss/searchReadiness/sites.json";

const groups = (sites as any)._groups;
const rows = (sites as any).grid_repos as any[];
const GROUPS = ["divine_9", "friends", "support"];

describe("Search Readiness groups (7 Nov 2026)", () => {
  it("every grid row names a group and a business that group lists; every named business has a site or a named gap", () => {
    expect(rows.length).toBeGreaterThan(0);
    // Owner, 10 Nov 2026: Time-2-Read is one business with two apps; heygetonmylevel is not a business of its own.
    expect(groups.divine_9).toHaveLength(8);
    expect(groups.divine_9).not.toContain("heygetonmylevel");
    expect(rows.filter((r) => r.business === "Time-2-Read").map((r) => r.domain).sort()).toEqual(["heygetonmylevel.com", "time-2-read.com"]);
    // Owner, 10 Nov 2026: the groups are exactly these three; there is no "selling" group, and
    // Porch & Party is a friends & clients site.
    expect(Object.keys(groups).filter((k) => !k.startsWith("_") && k !== "gaps").sort()).toEqual([...GROUPS].sort());
    expect(rows.find((r) => r.domain === "porchandparty901.com")).toMatchObject({ group: "friends", category: "client" });
    expect(groups.friends).toContain("Porch & Party");
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
    // The explicit exclusions (3 Nov no-search sites, topbarz-voting, the parked repos) never reach the grid.
    const excluded = ((sites as any).excluded as any[]).map((x) => x.repo);
    expect(excluded).toEqual(expect.arrayContaining(["901johnsons-site", "topbarz-voting", "charm-nest", "courtscope"]));
    for (const r of rows) expect(excluded, r.domain).not.toContain(r.repo);
    // A dropped domain (owner, 7 Nov 2026: spryexecutiveos.com) is never audited.
    const dropped = ((sites as any).dropped as any[]).map((x) => x.domain);
    expect(dropped).toContain("spryexecutiveos.com");
    for (const r of rows) expect(dropped, r.domain).not.toContain(r.domain);
  });

  it("a sunsetting site is audited and its briefs are never worked; the same site without the flag is", () => {
    const checklist = loadChecklist();
    // No live site is sunsetting since spryexecutiveos.com was dropped (7 Nov 2026); the flag is exercised on a copy.
    const spry = { ...rows.find((r) => r.domain === "billionairehighperformancecoach.com"), sunsetting: "Sunset when its domain expires" };
    const result = [{ id: "b3", status: "fail", detail: "https://billionairehighperformancecoach.com/about: no description" }];
    const sun = fixBriefs(checklist, [{ site: spry, host: spry.domain, results: result }]);
    expect(sun.map((b: any) => b.disposition)).toEqual(["sunsetting"]);
    expect(workQueue(sun)).toMatchObject({ workable: 0, chunks: [] });
    const live = fixBriefs(checklist, [{ site: { ...spry, sunsetting: undefined }, host: spry.domain, results: result }]);
    expect(live.map((b: any) => b.disposition)).toEqual(["fix"]);
  });

  it("the standings name the business first and mark a sunsetting site", () => {
    const site = (d: string) => ({ site: rows.find((r) => r.domain === d), results: [{ id: "b3", status: "fail", detail: "x" }], failing: [{}] });
    const sun = { ...site("billionairehighperformancecoach.com"), site: { ...rows.find((r) => r.domain === "billionairehighperformancecoach.com"), sunsetting: "Sunset when its domain expires" } };
    const html = renderStandings({ day: "2026-11-09", sites: [site("dentistryguides.com"), sun] }, loadChecklist());
    expect(html).toMatch(/<b>Industry Guides<\/b> · dentistryguides\.com/);
    expect(html).toMatch(/billionairehighperformancecoach\.com <span class="muted" data-sunsetting>sunsetting<\/span>/);
    expect(html).not.toMatch(/<td>dentistryguides\.com/);
  });
});
