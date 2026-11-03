/**
 * Owner, 3 Nov 2026 (Hicks): "if it has repairs for already published resources they should just fix
 * them not queue". A repair of a published Resources post is worked and landed; a core-page repair
 * still waits for her yes. Read by fixBriefs (the Search Readiness queue) and landAll (the Ahrefs
 * site-audit duty's land step), through src/shared/boss/searchReadiness/ownerApproval.mjs.
 */
import { describe, it, expect } from "vitest";
import { loadChecklist, loadSites, fixBriefs } from "../src/shared/boss/searchReadiness/audit.mjs";
import { landAll } from "../scripts/ops/site-audit-lib.mjs";

describe("Hicks: published Resources repairs are fixed directly, core pages wait for her yes", () => {
  it("a Resources-post repair is worked and landed; a core-page repair is held", () => {
    const hicks = (loadSites() as any).grid_repos.find((s: any) => s.domain === "hicksconsulting.org");
    expect(hicks.owner_approval).toBeTruthy();
    const post = { id: "b3", status: "fail", detail: "meta description missing", evidence: ["https://hicksconsulting.org/resources/what-to-expect-first-session/"] };
    const core = { id: "b4", status: "fail", detail: "meta description missing", evidence: ["https://hicksconsulting.org/about/", "https://hicksconsulting.org/resources/what-to-expect-first-session/"] };
    const briefs = fixBriefs(loadChecklist(), [{ site: hicks, host: "hicksconsulting.org", results: [post, core] }]);
    const disp = Object.fromEntries(briefs.map((b: any) => [b.item_id, b.disposition]));
    expect(disp).toEqual({ b3: "fix", b4: "owner_approval" });

    const calls: string[][] = [];
    const payload: any = { findings: [
      { disposition: "fixed_pr", domain: "hicksconsulting.org", repo: "hicks-consulting-canonical", pr_url: "https://github.com/seq23/hicks-consulting-canonical/pull/1", pages: ["https://hicksconsulting.org/insights/a-post/", "/questions/how-long-is-therapy/"], headline: "broken links on two posts" },
      { disposition: "fixed_pr", domain: "hicksconsulting.org", repo: "hicks-consulting-canonical", pr_url: "https://github.com/seq23/hicks-consulting-canonical/pull/2", pages: ["https://hicksconsulting.org/"], headline: "home page title" },
      { disposition: "fixed_pr", domain: "hicksconsulting.org", repo: "hicks-consulting-canonical", pr_url: "https://github.com/seq23/hicks-consulting-canonical/pull/3", headline: "canonical on the resources hub", because: "https://hicksconsulting.org/resources/ had no canonical" },
    ] };
    landAll(payload, { landBin: "/bin/land-stub", approvedSites: [], run: (c: string, a: string[]) => { calls.push([c, ...a]); return { status: 0, out: "landed\n" }; } });
    expect(payload.findings.map((f: any) => f.land)).toEqual(["landed", "held_owner_approval", "held_owner_approval"]);
    expect(calls.filter((c) => c.includes("/bin/land-stub")).map((c) => c[c.length - 1])).toEqual(["1"]);

    // her approved plan releases the core page too
    const approved: any = { findings: [{ ...payload.findings[1], land: undefined }] };
    landAll(approved, { landBin: "/bin/land-stub", approvedSites: ["hicksconsulting.org"], run: () => ({ status: 0, out: "landed\n" }) });
    expect(approved.findings[0].land).toBe("landed");
  });
});
