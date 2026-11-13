/**
 * PROPERTIES.json FOR BACKLINK PROSPECTING (repair, 13 Nov 2026). The duty's prompt named a file
 * nothing wrote, so every run was blocked and `link_prospects` held zero rows, ever. Made-up sites.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProperties } from "../scripts/ops/properties-snapshot.mjs";

const SITES = [
  { domain: "alpha.example", label: "Alpha Guides", business: "spry", kind: "guide", category: "side_business", coverage: { why: "Topical, not local." } },
  { domain: "beta.example", label: "Beta App", business: "spry", kind: "app", category: "side_business" },
  { domain: "friend.example", label: "A friend's practice", business: "friends", kind: "site", category: "client" },
  { domain: "gamma.example", label: "Gamma", business: "spry", kind: "guide", category: "own_business" },
];

describe("PROPERTIES.json", () => {
  it("lists her own sites, most clicks first, and says what each is about", () => {
    const out = buildProperties(SITES, { report: [{ site: "sc-domain:beta.example", clicks: 9, clicks_prev: 4 }, { site: "https://www.gamma.example/", clicks: 2 }, { site: "sc-domain:alpha.example", clicks: 0 }] });
    expect(out.properties.map((p) => p.property)).toEqual(["beta.example", "gamma.example", "alpha.example"]);
    expect(out.properties[0]).toMatchObject({ url: "https://beta.example/", about: "Beta App", clicks_last_week: 9, clicks_week_before: 4 });
    expect(out.properties[2]!.about).toBe("Alpha Guides. Topical, not local.");
    expect(out.performance).toMatch(/read for 3 of 3 sites/);
  });

  it("a friend's or client's site is never on her list", () => {
    const out = buildProperties(SITES, { report: [{ site: "sc-domain:friend.example", clicks: 500 }] });
    expect(out.properties.map((p) => p.property)).not.toContain("friend.example");
    expect(out.count).toBe(3);
  });

  it("performance that could not be read says so: never 0, and the list keeps its own order", () => {
    const out = buildProperties(SITES, { error: "the Search Console read failed (no service account)" });
    expect(out.performance).toBe("not read: the Search Console read failed (no service account)");
    expect(out.properties.map((p) => p.clicks_last_week)).toEqual(["not read", "not read", "not read"]);
    expect(out.properties.map((p) => p.property)).toEqual(["alpha.example", "beta.example", "gamma.example"]);
  });

  it("the file is written before the Mac claims work, where the run looks for it", () => {
    const claim = readFileSync(new URL("../scripts/ops/agent-claim.sh", import.meta.url), "utf8");
    expect(claim.indexOf("properties-snapshot.mjs")).toBeGreaterThan(-1);
    expect(claim.indexOf("properties-snapshot.mjs")).toBeLessThan(claim.indexOf("agent.mjs work-once"));
  });
});
