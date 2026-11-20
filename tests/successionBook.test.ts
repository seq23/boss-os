/**
 * The Succession Book generator (scripts/ops/succession-book.mjs) on fakes only: the repo is
 * public, so no real brain, handoff or book text is ever here.
 */
import { describe, expect, it } from "vitest";
import { buildBook, fillBlocks, herWords, mdToHtml, repoCategory, safetyProblems } from "../scripts/ops/succession-book.mjs";

const TEMPLATE = [
  "# Book", "", "Hand-written words stay.", "",
  "<!-- GEN:apps -->", "<!-- /GEN:apps -->",
  "<!-- GEN:repos -->", "old", "<!-- /GEN:repos -->",
  "<!-- GEN:domains -->", "<!-- /GEN:domains -->",
  "<!-- GEN:social -->", "<!-- /GEN:social -->",
  "Built <!-- GEN:built --><!-- /GEN:built -->.", "",
].join("\n");
const CATS = { mine: ["alpha-repo"], friends: ["pal-repo", "parked-repo"], system: ["boss-os"], parked: ["parked-repo"] };
const input = (over: Record<string, unknown> = {}) => ({
  template: TEMPLATE,
  live: [
    { name: "alpha-repo", visibility: "PUBLIC", isArchived: false },
    { name: "parked-repo", visibility: "PUBLIC", isArchived: false },
    { name: "loose-repo", visibility: "PRIVATE", isArchived: false },
    { name: "old-repo", visibility: "PRIVATE", isArchived: true },
  ],
  mapRows: [{ repo: "alpha-repo", category: "friends", what: "Your alpha site." }],
  cats: CATS,
  domains: { rows: [
    { domain: "late.example", registrar: "Namecheap", tier: "keep", expires: "2027-05-01", mail_words: "No mail." },
    { domain: "soon.example", registrar: "Cloudflare", tier: "keep", expires: "2026-12-11", mail_words: "Your inbox." },
    { domain: "gone.example", registrar: "Cloudflare", tier: "retire", expires: "2027-01-01" },
  ] },
  social: { statuses: { live_auto: "Live, and a job posts to it", dead: "Gone" }, rows: [{ business: "example", platform: "Instagram", handle: "@ex", status: "live_auto" }, { business: "example", platform: "X", handle: "@gone", status: "dead" }] },
  spryBody: "## Company\n- Sells apps.\n\n**App Store apps (ids checked 1 Dec)**\n| App | Bundle id | App Store Connect app id | State |\n|---|---|---|---|\n| Example App | com.example.app | 1234567890 | live |\n\nAfter the table.\n",
  now: new Date("2026-12-01T12:00:00Z"),
  ...over,
});

describe("the Succession Book generator", () => {
  it("fills every live block and keeps the hand-written words", () => {
    const md = buildBook(input());
    expect(md).toContain("Hand-written words stay.");
    expect(md).toContain("3 repos, live from GitHub.");
    expect(md).not.toContain("old-repo"); // archived
    expect(md).not.toMatch(/\nold\n/);
    expect(md).toContain("Sequoia's alpha site.");
    expect(md).toContain("No description yet");
    expect(md).not.toContain("@gone");
    expect(md).toContain("<!-- GEN:built -->2026-12-01<!-- /GEN:built -->");
    expect(md).toContain("| Example App | com.example.app | https://appstoreconnect.apple.com/apps/1234567890 | live |");
    expect(md).not.toContain("After the table.");
  });

  it("sorts repos by her categories first: parked wins over friends, hers over the map", () => {
    expect(repoCategory("parked-repo", CATS)).toBe("parked");
    expect(repoCategory("alpha-repo", CATS, { category: "friends" })).toBe("hers");
    expect(repoCategory("loose-repo", CATS)).toBe("not sorted yet");
  });

  it("lists the kept domains soonest-expiring first, never a retired one", () => {
    const md = buildBook(input());
    expect(md.indexOf("soon.example")).toBeLessThan(md.indexOf("late.example"));
    expect(md).not.toContain("gone.example");
  });

  it("stops by name on zero sources, a missing block, or unsafe text", () => {
    expect(() => buildBook(input({ live: [] }))).toThrow(/NAMED STOP \[NO_REPOS\]/);
    expect(() => buildBook(input({ cats: { problem: "no section" } }))).toThrow(/NAMED STOP \[NO_REPO_CATEGORIES\]/);
    expect(() => buildBook(input({ domains: { rows: [] } }))).toThrow(/NAMED STOP \[NO_DOMAINS\]/);
    expect(() => buildBook(input({ spryBody: "## Company\n- no table\n" }))).toThrow(/NAMED STOP \[NO_APPS_TABLE\]/);
    expect(() => fillBlocks("# B\n", { repos: "x" })).toThrow(/NAMED STOP \[TEMPLATE_BLOCK_MISSING\]/);
    expect(() => fillBlocks("# B\n<!-- GEN:extra --><!-- /GEN:extra -->", {})).toThrow(/NAMED STOP \[BLOCK_NOT_BUILT\]/);
    expect(() => buildBook(input({ template: `${TEMPLATE}\nEIN 12-3456789\n` }))).toThrow(/NAMED STOP \[UNSAFE_CONTENT\]/);
    expect(() => buildBook(input({ template: `${TEMPLATE}\n<!-- confidential -->x\n` }))).toThrow(/NAMED STOP \[UNSAFE_CONTENT\]/);
    expect(safetyProblems("password: hunter2")).toHaveLength(1);
    expect(safetyProblems("passcode = 4821")).toHaveLength(1);
    expect(safetyProblems("| master password: sealed envelope |")).toEqual([]);
    expect(safetyProblems("# Fine book\nNo passwords are written here.")).toEqual([]);
  });

  it("the Drive Doc carries real tables, nested lists and escaped text", () => {
    const html = mdToHtml("# T\n\n| a | b |\n|---|---|\n| **x** | <y> |\n\n- one\n  - two\n1. first\n", "T");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td><b>x</b></td><td>&lt;y&gt;</td>");
    expect(html).toMatch(/<ul>\n<li>one<\/li>\n<ul>\n<li>two<\/li>\n<\/ul>\n<\/ul>\n<ol>/);
  });

  it("speaks about her, not to her", () => {
    expect(herWords("Your account; you sign in")).toBe("Sequoia's account; Sequoia sign in");
  });
});
