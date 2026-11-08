/**
 * THE REPOS, DOMAINS, SITES AND ACCOUNTS MAPS (owner, 8 Nov 2026: "do all the maps we maybe missing").
 * The real maps are clean, every way the chain could break is caught, the public repo holds no
 * unmasked address. The ONE guard for the maps (owner, 8 Nov 2026: simplest thing that works):
 * unmasked emails and keys that point at nothing. Shape: src/shared/boss/maps/chain.mjs; page
 * src/client/boss/pages/Maps.tsx.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chainProblems, shapeProblems, privacyProblems, unmaskedAddresses, launchdProblems, notLinked, linksByRepo, scheduleRepos, emailRepos, OUTSIDE } from "../src/shared/boss/maps/chain.mjs";

const j = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const real = () => ({
  repos: j("src/shared/boss/maps/repos.json"), domains: j("src/shared/boss/maps/domains.json"),
  sites: j("src/shared/boss/maps/sites.json"), accounts: j("src/shared/boss/maps/accounts.json"),
  emails: j("src/shared/boss/emailMap/manifest.json"), schedule: j("src/shared/boss/schedule/manifest.json"),
  scorecard: j("src/shared/boss/scorecard/manifest.json"), readiness: j("src/shared/boss/searchReadiness/sites.json"), social: j("src/shared/boss/socialMap/manifest.json"),
});
const MAPS = ["repos", "domains", "sites", "accounts"] as const;

describe("the real maps", () => {
  it("are whole and every key resolves", () => {
    const ctx = real();
    expect(shapeProblems(ctx)).toEqual([]);
    expect(chainProblems(ctx)).toEqual([]);
  });
  it("hold no unmasked email address, the Social Map included (the repo is public)", () => {
    const ctx = real();
    for (const m of [...MAPS, "social"] as const) expect(privacyProblems(m, (ctx as any)[m])).toEqual([]);
    expect(JSON.stringify(ctx.accounts)).toContain("st**@time-2-read.com");
  });
  it("place every Mac label the Schedule cites that boss-os does not define on seq-bin's list", () => {
    const out = execFileSync("git", ["grep", "-h", "-o", "-E", "com\\.seq\\.[A-Za-z0-9._-]+", "--", "scripts", "src/worker", "docs"], { encoding: "utf8" });
    expect(launchdProblems(real(), new Set(out.split("\n").filter(Boolean)))).toEqual([]);
  });
  it("link every Email Map and Schedule row to a repo, and count what is not linked", () => {
    const nl = notLinked(real());
    expect(nl.emails).toEqual([]);
    expect(nl.schedule).toEqual([]);
    expect(Array.isArray(nl.scorecard)).toBe(true);
  });
  it("give the front door counts for the busy repos", () => {
    const l = linksByRepo(real());
    expect(l.get("boss-os")?.emails.length).toBeGreaterThan(10);
    expect(l.get("local-guides-generator")?.domains.length).toBeGreaterThan(5);
    expect(l.get("approvalprep")?.readiness).toContain("approvalprep.com");
  });
  it("are what the pages render, imported, never copied", () => {
    const page = readFileSync("src/client/boss/pages/Maps.tsx", "utf8");
    for (const m of MAPS) expect(page).toContain(`from "@shared/boss/maps/${m}.json"`);
    expect(page).toContain('from "@shared/boss/maps/chain.mjs"');
  });
});

describe("the chain guard catches a broken key", () => {
  it("a site whose repo is not on the Repos map", () => {
    const ctx = real(); ctx.sites.rows[0].repo = "no-such-repo";
    expect(chainProblems(ctx).join("\n")).toContain("no-such-repo is not on the Repos map");
  });
  it("a domain naming a site that does not exist", () => {
    const ctx = real(); ctx.domains.rows.find((d: any) => d.site).site = "gone-site";
    expect(chainProblems(ctx).join("\n")).toContain("site gone-site is not on the Sites map");
  });
  it("a site on a domain the Domains map lacks", () => {
    const ctx = real(); ctx.sites.rows[0].aliases = ["nowhere-example.com"];
    expect(chainProblems(ctx).join("\n")).toContain("nowhere-example.com is not on the Domains map");
  });
  it("a business that is not a brain", () => {
    const ctx = real(); ctx.accounts.rows[0].business = "made-up";
    expect(chainProblems(ctx).join("\n")).toContain("business made-up is not a brain");
  });
  it("a Search Readiness site no Sites row serves", () => {
    const ctx = real(); ctx.readiness.grid_repos.push({ domain: "new-grid-site.com", repo: "boss-os" });
    expect(chainProblems(ctx).join("\n")).toContain("new-grid-site.com: no Sites map row serves it");
  });
  it("an Email Map row citing a repo the Repos map lacks", () => {
    const ctx = real(); ctx.emails.rows[0].code = [{ repo: "brand-new-repo", paths: ["x.ts"] }];
    expect(chainProblems(ctx).join("\n")).toContain("brand-new-repo is not on the Repos map");
  });
  it("an empty map, a duplicate and an unknown tier", () => {
    const a = real(); a.sites.rows = [];
    expect(shapeProblems(a).join("\n")).toContain("the Sites map has no rows");
    const b = real(); b.domains.rows.push(clone(b.domains.rows[0]));
    expect(shapeProblems(b).join("\n")).toContain("is listed twice");
    const c = real(); c.domains.rows[0].tier = "maybe";
    expect(shapeProblems(c).join("\n")).toContain("unknown tier maybe");
  });
  it("an unmasked address written into any map; a masked one and a handle pass", () => {
    const ctx = real(); ctx.accounts.rows[0].login = "someone@example.com";
    expect(privacyProblems("accounts", ctx.accounts)).toHaveLength(1);
    const d = real(); d.domains.rows[0].mail_to = ["hello@example.com"];
    expect(privacyProblems("domains", d.domains)).toHaveLength(1);
    const s = real() as any; s.social.rows[0].account_email = "hello@porchandparty901.com";
    expect(privacyProblems("social", s.social)).toHaveLength(1);
    expect(unmaskedAddresses({ a: "abc**@x.com" })).toEqual(["abc**@x.com"]);
    expect(unmaskedAddresses({ a: "st**@time-2-read.com", b: "the @howweknowdeep channel" })).toEqual([]);
  });
  it("derives keys from what the older maps already cite", () => {
    expect(emailRepos({ code: [{ repo: "~/bin" }, { repo: "external" }] })).toEqual(["seq-bin", OUTSIDE]);
    const repos = real().repos;
    expect(scheduleRepos({ trigger: { launchd: ["com.howweknow.batch"] } }, repos)).toEqual(["how-we-know"]);
    expect(scheduleRepos({ trigger: { wpos: "x" } }, repos)).toEqual(["west-peek-os"]);
    expect(scheduleRepos({ trigger: { launchd: ["com.seq.drive-backup"] } }, repos)).toEqual(["seq-bin"]);
    expect(scheduleRepos({ trigger: { duty: "duty_x" } }, repos)).toEqual(["boss-os"]);
  });
  it("a seq-bin label the Schedule does not cite, and a Mac label nobody defines", () => {
    const ctx = real(); ctx.repos.rows.find((r: any) => r.repo === "seq-bin").launchd.push("com.seq.ghost");
    expect(launchdProblems(ctx, new Set()).join("\n")).toContain("com.seq.ghost");
  });
});
