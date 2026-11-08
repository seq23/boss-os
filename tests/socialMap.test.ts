/**
 * THE SOCIAL MAP COVERS EVERY ACCOUNT AND POSTING JOB (owner, 8 Nov 2026: "a canonical map of what
 * repos and sites have social media pages").
 *
 * src/shared/boss/socialMap/manifest.json is what ☰ More → Social Map renders. This holds it to what
 * CI can see: this repo's own posting files, the Schedule's posting jobs, the sites.json groups, the
 * page's import and CLAUDE.md's section. `npm run social-map:check` does the rest on her Mac (every
 * site's entity.json sameAs, every repo's posting code, every URL, every live_auto job's last run).
 * Every rule is proven negatively: break the input, watch it fail.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  accountEmailProblems, personalMoveRows, checkJobs, checkUrls, classifyProbe, newestPubDate, privacyProblems, profileUrls, readManifest, readSites, shapeProblems,
  socialMapFlagWords, staleExemptions, uncoveredCode, uncoveredJobs, uncoveredSameAs, type SocialManifest,
} from "../scripts/ops/lib/social-map.mjs";
import { cohesionCheckLine } from "../src/shared/boss/brains/brain.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const m = readManifest(ROOT);
const sites = readSites(ROOT);
const schedule = JSON.parse(readFileSync(path.join(ROOT, "src/shared/boss/schedule/manifest.json"), "utf8"));
const clone = (): SocialManifest => JSON.parse(JSON.stringify(m));
const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const realFiles = tracked.filter((f) => /\.(ts|tsx|mjs|js|cjs|sh|py)$/.test(f)).map((file) => {
  let source = ""; try { source = readFileSync(path.join(ROOT, file), "utf8"); } catch { /* deleted in the tree */ }
  return { file, source };
});

describe("the Social Map covers every account and posting job", () => {
  it("the real manifest is complete, grouped as sites.json groups it, and private", () => {
    expect(m.rows.length).toBeGreaterThan(40);
    expect(shapeProblems(m, sites)).toEqual([]);
    expect(privacyProblems(m)).toEqual([]);
  });

  it("a row the page cannot show, or a group sites.json does not hold, fails by name", () => {
    const bad = clone();
    bad.rows[0]!.status = "live";
    bad.rows[1]!.decision = "";
    const auto = bad.rows.find((r) => r.status === "live_auto")!;
    delete auto.posts.check;
    bad.businesses.find((b) => b.key === "approvalprep")!.group = "friends";
    const p = shapeProblems(bad, sites);
    expect(p.some((x) => /status live is not one of/.test(x))).toBe(true);
    expect(p.some((x) => /decision is empty/.test(x))).toBe(true);
    expect(p.some((x) => /live_auto needs a check/.test(x))).toBe(true);
    expect(p.some((x) => /sites\.json puts ApprovalPrep in divine_9, the map says friends/.test(x))).toBe(true);
    expect(shapeProblems(m, {}).some((x) => /_groups was not read/.test(x))).toBe(true);
  });

  it("an email address or a person's own profile never goes in (public repo)", () => {
    const bad = clone();
    bad.rows[0]!.decision = "set up on someone@example.com";
    bad.rows[1]!.url = "https://www.linkedin.com/in/a-person/";
    expect(privacyProblems(bad)).toHaveLength(2);
  });

  it("every posting file in this repo is cited; a new poster nobody cites fails; a test naming one does not", () => {
    expect(uncoveredCode(realFiles, m, "boss-os")).toEqual([]);
    const withNew = [...realFiles, { file: "scripts/ops/new-poster.mjs", source: "await fetch('https://api.buffer.com/1/updates/create.json')" },
      { file: "src/worker/pinfeed/route.ts", source: "export const x = 1;" }];
    expect(uncoveredCode(withNew, m, "boss-os")).toEqual([
      "boss-os: scripts/ops/new-poster.mjs posts to a social account and no Social Map row cites it",
      "boss-os: src/worker/pinfeed/route.ts posts to a social account and no Social Map row cites it",
    ]);
    expect(uncoveredCode([{ file: "tests/x.test.ts", source: "api.buffer.com" }, { file: "src/a.ts", source: "" }], m, "boss-os")).toEqual([]);
    expect(uncoveredCode([], m, "boss-os")[0]).toMatch(/no code file was scanned/);
  });

  it("an exemption whose file is gone or no longer posts is stale", () => {
    const ex = { ...clone(), code_exempt: [{ repo: "r", path: "a.ts", why: "x" }, { repo: "r", path: "b.ts", why: "x" }] };
    expect(staleExemptions([{ file: "b.ts", source: "nothing" }], ex, "r")).toEqual(["r: exempt a.ts no longer exists", "r: exempt b.ts no longer posts (drop the exemption)"]);
  });

  it("every posting job on the Schedule is on the map; a new one is caught; a listed job that left the Schedule is caught", () => {
    expect(uncoveredJobs(schedule, m)).toEqual([]);
    const more = { rows: [...schedule.rows, { id: "new-tiktok-drip", name: "TikTok drip", what: "Posts a clip a day." }] };
    expect(uncoveredJobs(more, m)).toEqual(['Schedule job new-tiktok-drip ("TikTok drip") posts and no Social Map row lists it in posts.jobs']);
    const fewer = { rows: schedule.rows.filter((r: { id: string }) => r.id !== "dream-wedding-builder-pinterest-drip") };
    expect(uncoveredJobs(fewer, m)).toContain("a Social Map row lists Schedule job dream-wedding-builder-pinterest-drip, which is not on the Schedule");
    expect(uncoveredJobs({ rows: [] }, m)[0]).toMatch(/cannot see anything/);
  });

  it("an entity.json sameAs missing from the map fails; a Person node and a person's profile are skipped; zero is a problem", () => {
    const entity = {
      sameAs: ["https://www.pinterest.com/approvalprep/", "https://www.threads.net/@newbrand"],
      profiles_pending: [{ platform: "LinkedIn", url: "https://www.linkedin.com/company/approvalprep/" }, { platform: "X", url: null }],
      founder: { "@type": "Person", sameAs: ["https://example.org/person"] },
      sites: { "a.com": { sameAs: ["https://www.linkedin.com/in/someone/"] } },
    };
    expect(profileUrls(entity)).toEqual(["https://www.pinterest.com/approvalprep/", "https://www.threads.net/@newbrand", "https://www.linkedin.com/company/approvalprep/"]);
    expect(uncoveredSameAs([{ repo: "approvalprep", path: "src/data/entity.json", json: entity }], m))
      .toEqual(["approvalprep: src/data/entity.json lists https://www.threads.net/@newbrand and no Social Map row has that URL"]);
    expect(uncoveredSameAs([], m)[0]).toMatch(/cannot see anything/);
    expect(uncoveredSameAs([{ repo: "x", path: "entity.json", json: {} }], m)).toContain("the entity files hold no sameAs at all (the scan went stale)");
  });

  it("a login wall is unverifiable, never dead; a 404 or a 'User not found' page is dead", async () => {
    expect(classifyProbe(403)).toBe("unverifiable");
    expect(classifyProbe(400)).toBe("unverifiable");
    expect(classifyProbe(0)).toBe("unverifiable");
    expect(classifyProbe(404)).toBe("dead");
    expect(classifyProbe(200, "<title>User not found</title>")).toBe("dead");
    expect(classifyProbe(200, "<html>a profile</html>")).toBe("ok");
    const one = { ...clone(), rows: [m.rows.find((r) => r.id === "ap-pinterest")!] };
    const r404 = await checkUrls(one, { fetchImpl: (async () => new Response("", { status: 404 })) as typeof fetch });
    expect(r404.problems[0]).toMatch(/ap-pinterest: .* answers 404 as gone, but the map says live_auto/);
    const r403 = await checkUrls(one, { fetchImpl: (async () => new Response("", { status: 403 })) as typeof fetch });
    expect(r403).toMatchObject({ problems: [], unverifiable: ["ap-pinterest (HTTP 403)"] });
  });

  it("a live_auto row whose feed went stale or whose workflow failed is caught", async () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    expect(newestPubDate("<pubDate>Wed, 04 Nov 2026 11:00:00 GMT</pubDate><pubDate>Sun, 08 Nov 2026 11:00:00 GMT</pubDate>")).toBe(Date.parse("2026-11-08T11:00:00Z"));
    const one = { ...clone(), rows: [m.rows.find((r) => r.id === "dw-pinterest")!] };
    const stale = (async () => new Response("<rss><pubDate>Sun, 01 Nov 2026 11:00:00 GMT</pubDate></rss>", { status: 200 })) as typeof fetch;
    const fresh = (async () => new Response("<rss><pubDate>Sun, 08 Nov 2026 11:00:00 GMT</pubDate></rss>", { status: 200 })) as typeof fetch;
    const ok = () => ({ conclusion: "success", status: "completed", createdAt: "2026-11-08T07:20:00Z" });
    expect((await checkJobs(one, { now, fetchImpl: stale, gh: ok })).problems).toEqual(["dw-pinterest: the newest pin is 7 days old"]);
    expect((await checkJobs(one, { now, fetchImpl: fresh, gh: () => ({ ...ok(), conclusion: "failure" }) })).problems).toEqual(["dw-pinterest: pinterest-drip.yml's last run ended failure"]);
    expect((await checkJobs(one, { now, fetchImpl: fresh, gh: ok })).problems).toEqual([]);
    expect((await checkJobs(one, { now, fetchImpl: fresh, gh: () => null })).problems).toEqual(["dw-pinterest: dream-wedding-builder pinterest-drip.yml has no run"]);
  });

  it("a gap is one clause in Simone's Monday cohesion line; a check that found nothing says so", () => {
    const clean = { strays_moved: [], repos_missing_pointer: [], skills_flagged: [], copy_restarted: false, copy_fresh_after: true, unchecked: [] };
    const brains = [{ slug: "spry", title: "Spry", body_md: "# x", updated_at: Date.now() }];
    const flag = socialMapFlagWords({ status: 1, census: "", problems: ["p-n-p: config/entity.json lists https://x and no Social Map row has that URL"] });
    expect(cohesionCheckLine(brains, { ...clean, social_map_flag: flag })).toBe(`Cohesion: ${flag}`);
    expect(cohesionCheckLine(brains, { ...clean, social_map_flag: null })).toBe("Cohesion: all clear");
    expect(socialMapFlagWords({ status: 2, census: "", problems: [] })).toMatch(/found no repo/);
    expect(socialMapFlagWords(null)).toMatch(/did not run/);
  });

  it("every account sits under its brand's address; a personal or owner address is refused; 'personal — move' rows are one Monday clause", () => {
    expect(accountEmailProblems(m, sites)).toEqual([]);
    const bad = clone();
    bad.rows[0]!.account_email = "someone@gmail.com";
    bad.rows[1]!.account_email = "sequoia@porchandparty901.com";
    bad.rows[2]!.account_email = "";
    bad.rows[3]!.account_email = "nowhere.example mailbox";
    const p = accountEmailProblems(bad, sites);
    expect(p).toHaveLength(4);
    expect(p[0]).toMatch(/not on one of the grid's own domains/);
    expect(p[1]).toMatch(/named mailbox; write "porchandparty901.com mailbox"/);
    expect(p[2]).toMatch(/account_email is empty/);
    expect(accountEmailProblems(m, {})[0]).toMatch(/cannot see anything/);
    bad.rows[4]!.account_email = "personal — move";
    expect(personalMoveRows(bad)).toContain(bad.rows[4]!.id);
    const words = socialMapFlagWords({ status: 0, census: "", problems: [], personal: ["kmp-blogger"] });
    expect(words).toBe("1 social account is still under a personal address, move to the brand's (kmp-blogger)");
    expect(socialMapFlagWords({ status: 0, census: "", problems: [], personal: [] })).toBeNull();
  });

  it("the page renders the one manifest, sits in ☰ More, and CLAUDE.md's section names every piece", () => {
    const page = readFileSync(path.join(ROOT, "src/client/boss/pages/SocialMap.tsx"), "utf8");
    expect(page).toMatch(/import manifest from "@shared\/boss\/socialMap\/manifest\.json"/);
    const shell = readFileSync(path.join(ROOT, "src/client/boss/components/Shell.tsx"), "utf8");
    expect(shell).toMatch(/MORE_TABS[^\n]*"schedule", "social"/);
    const doc = readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");
    const sec = /^## The Social Map[^\n]*\n([\s\S]*?)(?=^## )/m.exec(doc)?.[1] ?? "";
    expect(sec.length).toBeGreaterThan(200);
    for (const piece of ["src/shared/boss/socialMap/manifest.json", "src/client/boss/pages/SocialMap.tsx", "/?tab=social", "tests/socialMap.test.ts",
      "scripts/ops/lib/social-map.mjs", "npm run social-map:check", "SOCIAL_MAP_NOTHING_CHECKED", "scripts/brains/cohesion-check.mjs", "same PR"]) expect(sec).toContain(piece);
    expect(JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts["social-map:check"]).toBe("node scripts/ops/social-map-check.mjs");
    expect(m._note).toMatch(/same PR/);
  });
});
