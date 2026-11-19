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
    expect(scheduleRepos({ trigger: { launchd: ["com.seq.pbs-library-fill"] } }, repos)).toEqual(["peace-be-still"]);
  });
  it("a seq-bin label the Schedule does not cite, and a Mac label nobody defines", () => {
    const ctx = real(); ctx.repos.rows.find((r: any) => r.repo === "seq-bin").launchd.push("com.seq.ghost");
    expect(launchdProblems(ctx, new Set()).join("\n")).toContain("com.seq.ghost");
  });
  it("a Mac label its own repo row lists is placed; taken off that list, it is not", () => {
    const ctx = real();
    const own = ctx.repos.rows.find((r: any) => r.repo === "peace-be-still");
    expect(launchdProblems(ctx, new Set()).join("\n")).not.toContain("com.seq.pbs-library-fill");
    own.launchd = [];
    expect(launchdProblems(ctx, new Set()).join("\n")).toContain("com.seq.pbs-library-fill");
  });
});

/**
 * THE BUFFER TABLE (owner, 18 Nov 2026: "we need to make sure we have a table of all accounts and which
 * buffers they are in"). The page shows one row per channel; the Sunday check compares each Buffer's live
 * channels with the map (scripts/ops/lib/buffer-channels.mjs) and cannot pass while seeing nothing.
 */
import { bufferTable } from "../src/shared/boss/maps/chain.mjs";
import { driftProblems, expectedByKey, runBufferCheck } from "../scripts/ops/lib/buffer-channels.mjs";

const liveFromMap = (accounts: any) => new Map([...expectedByKey(accounts)].map(([k, v]) => [k, { channels: v.channels.map((c: any) => ({ platform: c.platform, handle: c.handle })) }]));

describe("the Buffer table", () => {
  it("lists every Buffer channel with its Buffer, vault key and posting words, from the real maps", () => {
    const ctx = real();
    const rows = bufferTable(ctx.accounts, ctx.social);
    const pbs = rows.filter((r) => r.buffer === "buffer-peacebestill");
    expect(pbs.map((r) => r.platform).sort()).toEqual(["facebook", "instagram", "threads"]);
    expect(pbs.every((r) => r.keys.includes("BUFFER_PEACEBESTILL_ACCESS_TOKEN") && r.posting !== "not on the Social Map")).toBe(true);
    expect(rows.filter((r) => r.platform).length).toBeGreaterThanOrEqual(10);
    expect(rows.find((r) => r.buffer === "buffer-creators")?.posting).toBe("No channels connected");
  });
  it("renders on the Accounts page", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { BufferTable } = await import("../src/client/boss/pages/Maps");
    const html = renderToStaticMarkup(BufferTable());
    expect(html).toContain("BUFFER_PEACEBESTILL_ACCESS_TOKEN");
    expect((html.match(/data-testid="buffer-row-/g) ?? []).length).toBe(bufferTable(real().accounts, real().social).length);
  });
  it("catches a Buffer row with no channel list, and a channel naming no Social Map row", () => {
    const a = real(); delete a.accounts.rows.find((r: any) => r.id === "buffer-pnp").channels;
    expect(shapeProblems(a).join("\n")).toContain("buffer-pnp: a Buffer row lists its channels");
    const b = real(); b.accounts.rows.find((r: any) => r.id === "buffer-pnp").channels[0].social = "gone-row";
    expect(chainProblems(b).join("\n")).toContain("gone-row, which does not exist");
    const c = real(); c.accounts.rows = c.accounts.rows.filter((r: any) => !/^buffer-/.test(r.id));
    expect(shapeProblems(c).join("\n")).toContain("no Buffer rows");
  });
});

describe("the Buffer drift guard", () => {
  it("is clean when every Buffer holds what the map lists", () => {
    const { accounts } = real();
    const r = driftProblems(accounts, liveFromMap(accounts));
    expect(r.problems).toEqual([]);
    expect(r.stop).toBeNull();
  });
  it("names a channel moved between Buffers (both ends)", () => {
    const { accounts } = real();
    const live = liveFromMap(accounts);
    live.get("BUFFER_APPROVALPREP_ACCESS_TOKEN")!.channels = live.get("BUFFER_APPROVALPREP_ACCESS_TOKEN")!.channels.filter((c: any) => c.platform !== "instagram");
    live.get("BUFFER_BRANDS_ACCESS_TOKEN")!.channels.push({ platform: "instagram", handle: "approvalprep" });
    const p = driftProblems(accounts, live).problems.join("\n");
    expect(p).toContain("buffer-approvalprep: the map lists instagram approvalprep, but that Buffer does not hold it");
    expect(p).toContain("buffer-brands: that Buffer holds instagram approvalprep, which the map does not list");
  });
  it("names a key it could not read, and stops by name when zero channels were read", async () => {
    const { accounts } = real();
    const none = await runBufferCheck({ accounts, env: {}, fetchImpl: (() => { throw new Error("no call expected"); }) as any });
    expect(none.problems.some((p) => p.includes("BUFFER_PEACEBESTILL_ACCESS_TOKEN could not be read"))).toBe(true);
    expect(none.stop).toContain("NAMED STOP [BUFFER_NOTHING_READ]");
    const empty = new Map([...expectedByKey(accounts).keys()].map((k) => [k, { channels: [] }]));
    expect(driftProblems(accounts, empty).stop).toContain("BUFFER_NOTHING_READ");
    expect(driftProblems({ rows: [] }, new Map()).stop).toContain("BUFFER_NOTHING_CHECKED");
  });
});
