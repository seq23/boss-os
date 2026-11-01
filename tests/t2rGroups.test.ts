/**
 * TIME-2-READ GROUPS & INSTITUTIONS (owner, 31 Oct 2026): the pure rules, the Mac job and the
 * Monday line, read against the "Time-2-Read groups" section of CLAUDE.md. Synthetic data only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as R from "../src/shared/boss/t2rGroups/rules.mjs";
import { ACCESS_CODE_SHAPE, normaliseCode } from "../src/shared/boss/commands/parse.mjs";
import { INSTALLED_LOCAL_JOBS } from "../src/shared/boss/duties/lane.mjs";
import { researchPrompt, runGroups, RESEARCH_BELOW } from "../scripts/ops/t2r-groups.mjs";
import { t2rGroupsSectionFor } from "../scripts/ops/your-day.mjs";
import { BUSINESSES, businessByKey } from "../src/worker/boss/outreach/catalog";

const root = join(__dirname, "..");
const claude = readFileSync(join(root, "CLAUDE.md"), "utf8");
const section = claude.slice(claude.indexOf("## Time-2-Read groups & institutions"));
const MONDAY = Date.parse("2026-11-02T13:00:00Z");
const TUESDAY = Date.parse("2026-11-03T14:00:00Z");
const SATURDAY = Date.parse("2026-11-07T14:00:00Z");

describe("the rules in CLAUDE.md are the rules in code", () => {
  it("names every rule's home, and the numbers match", () => {
    expect(section).toContain("## Time-2-Read groups & institutions");
    for (const name of ["rules.mjs", "groups.ts", "t2r-groups.mjs", "duty_t2r_groups", "t2r_group_tiers", "groupSendGate",
      "groupCodeFor", "runCode", "outboundProblems", "suggestedPrice", "weeklyLine", "feedScoreboard", "NEW_GROUPS_PER_WEEKDAY"]) {
      expect(section, name).toContain(name);
    }
    expect(section).toMatch(/\(10\) new groups a weekday/);
    expect(R.NEW_GROUPS_PER_WEEKDAY).toBe(10);
    expect(section).toMatch(/one follow-up/);
    expect(R.MAX_FOLLOW_UPS).toBe(1);
    expect(section).toMatch(/15-day code/);
    expect(R.GROUP_TRIAL_DAYS).toBe(15);
    expect(section).toMatch(/off until Phase 8/);
    expect(section).toMatch(/Monique never quotes/);
  });
});

describe("the catalog business: two emails, the code, no price", () => {
  const b = businessByKey(R.GROUPS_KEY)!;
  it("is one sequence of a first email and ONE follow-up", () => {
    expect(b.steps.length - 1).toBe(R.MAX_FOLLOW_UPS);
    expect(b.steps[1]!.afterDays).toBe(R.FOLLOW_UP_AFTER_DAYS);
    expect(BUSINESSES.filter((x) => x.key === R.GROUPS_KEY)).toHaveLength(1);
  });
  it("every step carries {code}, and none names a price, asks for a call or makes a claim we never make", () => {
    for (const s of b.steps) {
      expect(s.body).toContain("{code}");
      expect(R.outboundProblems(`${s.subject}\n${s.body}`), s.body).toEqual([]);
    }
  });
});

describe("outbound words: the guard fails what it must", () => {
  it("refuses a price, a call ask, 'no screens', anti-AI, medical claims and other languages", () => {
    for (const bad of [
      "Groups pay $8.99 a family.", "Only 79 dollars a year.", "Our group pricing is simple.", "It costs less than a book.",
      "Can we hop on a quick call?", "Book a time on my calendar.", "A screen-free way to read.", "No screens, just stories.",
      "An anti-AI reading app.", "It treats dyslexia.", "Clinically proven.", "Stories in Spanish too.", "Bilingual stories.",
    ]) expect(R.outboundProblems(bad), bad).not.toEqual([]);
    expect(R.outboundProblems("A free 15-day trial with the code MAPLEG15K7Q. Any questions, just reply here.")).toEqual([]);
  });
});

describe("replies: a price question goes to her, with a suggestion", () => {
  it("knows a price question, reads the group's size, and suggests — never sends", () => {
    for (const q of ["How much is it after the trial?", "What's the pricing for 40 families?", "Can we pay as a group?", "Do you offer a license for our library?"]) expect(R.wantsPrice(q), q).toBe(true);
    for (const q of ["Thanks, we'll share the code!", "Is it for ages 5-8?"]) expect(R.wantsPrice(q), q).toBe(false);
    expect(R.groupSizeIn("We have about 40 families")).toBe(40);
    expect(R.groupSizeIn("Thanks!")).toBeNull();
    expect(R.suggestedPrice(40)).toMatch(/^Suggested: \$6\.99 per family a month/);
    expect(R.suggestedPrice(10)).toMatch(/^Suggested: \$8\.99 per family a month/);
    expect(R.suggestedPrice(null)).toMatch(/five or more families/);
  });
});

describe("prospects and codes", () => {
  it("only a published role or group mailbox with its https source page; never a guessed person", () => {
    const ok = { org_name: "Maple Grove Homeschool Co-op", kind: "homeschool co-op", email: "info@maplegrove.example", source_url: "https://maplegrove.example/contact" };
    expect(R.groupProspectProblems(ok)).toEqual([]);
    expect(R.groupProspectProblems({ ...ok, email: "maplegrovecoop@gmail.com" })).toEqual([]);
    expect(R.groupProspectProblems({ ...ok, email: "youthservices@library.example", kind: "public library youth services" })).toEqual([]);
    expect(R.groupProspectProblems({ ...ok, email: "jane.doe@maplegrove.example" })).toEqual([expect.stringMatching(/not a published role or group address/)]);
    expect(R.groupProspectProblems({ ...ok, email: "janedoe1984@gmail.com" })).toEqual([expect.stringMatching(/not a published role or group address/)]);
    expect(R.groupProspectProblems({ ...ok, source_url: "http://maplegrove.example" })).toEqual([expect.stringMatching(/https page/)]);
    expect(R.groupProspectProblems({ ...ok, kind: "church" })).toEqual([expect.stringMatching(/not a kind/)]);
    expect(R.tierOfKind("school district")).toBe(3);
    expect(R.tierOfKind("microschool")).toBe(1);
    expect(R.tierOfKind("tutoring center")).toBe(2);
  });
  it("a group's code fits time-2-read's code table exactly", () => {
    let i = 0;
    const rand = () => [0.1, 0.5, 0.9][i++ % 3]!;
    const code = R.groupCodeFor("The Maple Grove Homeschool Co-op", rand);
    expect(code).toMatch(/^MAPLEG15[A-Z2-9]{3}$/);
    expect(normaliseCode(code)).toBe(code);
    expect(code.length).toBeGreaterThanOrEqual(4);
    expect(code.length).toBeLessThanOrEqual(30);
    expect(R.GROUP_TRIAL_DAYS).toBeLessThanOrEqual(ACCESS_CODE_SHAPE.max_days);
    expect(R.groupCodeFor("A", rand)).toMatch(/^GROUP15/);
  });
});

describe("the Mac job", () => {
  const plan = (over: Record<string, unknown> = {}) => ({
    tiers: [
      { tier: 1, kinds: R.TIER_KINDS[1], enabled: true },
      { tier: 2, kinds: R.TIER_KINDS[2], enabled: true },
      { tier: 3, kinds: R.TIER_KINDS[3], enabled: false },
    ], known_domains: ["oldgroup.example"], waiting: 0, queued: 0, ...over,
  });
  function fakeApi(p = plan(), { toVerify = ["info@maplegrove.example"], codesDue = [{ id: "g1", code: "MAPLEG15AAA", label: "Time2Read group: Maple" }] } = {}) {
    const posts: any[] = [];
    return {
      posts,
      get: async (path: string) => path.startsWith("/t2r-groups/plan") ? p : path.startsWith("/t2r-groups/to-verify") ? { emails: toVerify } : path.startsWith("/t2r-groups/codes-due") ? { codes: codesDue } : {},
      post: async (_: string, body: any) => { posts.push(body); return body.op === "import" ? { recorded: body.rows.length } : body.op === "code" ? { live: body.ok } : body.op === "queue" ? { queued: 1 } : { recorded: 1, matched: 1 }; },
    };
  }
  const found = [{ org_name: "Maple Grove Homeschool Co-op", kind: "homeschool co-op", email: "info@maplegrove.example", source_url: "https://maplegrove.example/contact" }];

  it("the research brief asks only for tiers that are ON — never schools or districts while tier 3 is off", () => {
    const p = researchPrompt(plan());
    expect(p).toContain("homeschool co-op");
    expect(p).toContain("public library youth services");
    expect(p).not.toMatch(/Look ONLY for these kinds:[^\n]*school district/);
    expect(p).toContain("never a\nguessed pattern");
    expect(p).toContain("oldgroup.example");
  });

  it("NeverBounce gate: with no verdict, nothing is coded or queued as ready, and the run says so", async () => {
    const api = fakeApi(plan(), { codesDue: [] });
    const r = await runGroups({ live: true, now: TUESDAY, api, discover: async () => found, published: async () => true,
      verify: async () => ({ verdicts: [] }), codeTable: async () => ({ ok: true, codes: [] }) });
    expect(r.stops).toEqual([expect.stringMatching(/NO_NEVERBOUNCE_VERDICT/)]);
    expect(api.posts.some((p) => p.op === "verdicts")).toBe(false);
    expect(api.posts.some((p) => p.op === "code")).toBe(false);
  });

  it("an address its page does not show is never imported; a full run checks, codes and queues", async () => {
    const api = fakeApi();
    const made: any[] = [];
    const r = await runGroups({ live: true, now: TUESDAY, api,
      discover: async () => [...found, { ...found[0], org_name: "Unseen Co-op", email: "info@unseen.example", source_url: "https://unseen.example" }],
      published: async (row: any) => row.email !== "info@unseen.example",
      verify: async (emails: string[]) => ({ verdicts: emails.map((email) => ({ email, result: "valid" })) }),
      codeTable: async (spec: any) => { made.push(spec); return spec.op === "count" ? { ok: true, codes: [{ code: "MAPLEG15AAA", checkouts_started: 2 }] } : { ok: true, already: false }; } });
    expect(api.posts.find((p) => p.op === "import").rows.map((x: any) => x.email)).toEqual(["info@maplegrove.example"]);
    expect(made[0]).toEqual({ op: "create", code: "MAPLEG15AAA", trial_days: 15, label: "Time2Read group: Maple" });
    expect(r).toMatchObject({ imported: 1, verdicts: 1, codes: 1, usage: 1, queued: 1, stops: [] });
  });

  it("a code that cannot be made is a NAMED STOP, and no group goes without its code", async () => {
    const api = fakeApi(plan({ waiting: RESEARCH_BELOW }));
    const r = await runGroups({ live: true, now: TUESDAY, api, discover: async () => { throw new Error("no research when full"); },
      verify: async () => ({ verdicts: [] }), codeTable: async () => ({ ok: false, why: "the key is not in the vault" }) });
    expect(r.stops).toContain("NAMED STOP [GROUP_CODE_NOT_MADE] the key is not in the vault; no group is written to without its own working code.");
    expect(api.posts.find((p) => p.op === "code")).toEqual({ op: "code", id: "g1", ok: false, detail: "the key is not in the vault" });
  });

  it("weekdays only, and is an installed local job", async () => {
    const api = fakeApi();
    expect(await runGroups({ live: true, now: SATURDAY, api, discover: async () => found })).toMatchObject({ researched: 0, stops: [] });
    expect(api.posts).toEqual([]);
    expect(INSTALLED_LOCAL_JOBS).toContain("t2r-groups.mjs");
    expect(readFileSync(join(root, "scripts/ops/install-agent-launchd.sh"), "utf8")).toContain('install_l_job com.seq.boss-t2r-groups "duty-run.sh t2r-groups.mjs -- npm run --silent t2r:groups -- --live"');
  });
});

describe("Monday's one line in Simone's email", () => {
  it("reads exactly as she asked, Mondays only, and says so when the counts did not load", () => {
    expect(R.weeklyLine({ emailed: 12, replied: 3, codesInUse: 2 })).toBe("Time-2-Read groups: 12 emailed, 3 replied, 2 codes in use");
    expect(R.weeklyLine({ emailed: 1, replied: 0, codesInUse: 1 })).toBe("Time-2-Read groups: 1 emailed, 0 replied, 1 code in use");
    expect(R.weeklyLine({ emailed: 0, replied: 0, codesInUse: null })).toBe("Time-2-Read groups: 0 emailed, 0 replied, codes in use not tracked yet");
    const s = t2rGroupsSectionFor({ t2rGroups: { line: "Time-2-Read groups: 4 emailed, 1 replied, 1 code in use" } }, MONDAY)!;
    expect(s.items[0].text).toBe("Time-2-Read groups: 4 emailed, 1 replied, 1 code in use");
    expect(t2rGroupsSectionFor({ t2rGroups: { line: "x" } }, TUESDAY)).toBeNull();
    expect(t2rGroupsSectionFor({}, MONDAY)!.items[0].text).toMatch(/did not load/);
  });
});
