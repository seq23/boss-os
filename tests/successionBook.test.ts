/**
 * The Succession Book generator (scripts/ops/succession-book.mjs) on fakes only: the repo is
 * public, so no real brain, handoff or book text is ever here.
 */
import { describe, expect, it } from "vitest";
import { buildBook, fillBlocks, handoffBackups, herWords, safetyProblems, stripConfidential } from "../scripts/ops/succession-book.mjs";

const TEMPLATE = [
  "# Book", "", "Hand-written words stay.", "",
  "<!-- GEN:repos -->", "old", "<!-- /GEN:repos -->",
  "<!-- GEN:categories -->", "<!-- /GEN:categories -->",
  "<!-- GEN:brains -->", "<!-- /GEN:brains -->",
  "<!-- GEN:accounts -->", "<!-- /GEN:accounts -->",
  "<!-- GEN:social -->", "<!-- /GEN:social -->",
  "<!-- GEN:handoff -->", "<!-- /GEN:handoff -->",
  "Built <!-- GEN:built --><!-- /GEN:built -->.", "",
].join("\n");
const HANDOFF = "# H\n## PINNED\n### Backups (where)\n- Nightly copy to Drive.\n### Next\n- x\n";
const CATS = { mine: ["alpha-repo"], friends: ["pal-repo"], system: ["boss-os"], parked: [] };
const input = (over: Record<string, unknown> = {}) => ({
  template: TEMPLATE,
  brains: [{ slug: "example", title: "Example Co", body_md: "## Company\n- Sells widgets.\n- <!-- confidential -->Secret Investor LP<!-- /confidential -->\n## Numbers\n" }],
  live: [{ name: "alpha-repo", visibility: "PUBLIC", isArchived: false, pushedAt: "2026-11-01T00:00:00Z" }, { name: "old-repo", visibility: "PRIVATE", isArchived: true }],
  mapRows: [{ repo: "alpha-repo", category: "mine", what: "The alpha site." }],
  cats: CATS,
  accounts: { owners: { o1: "Your personal Google account" }, rows: [{ service: "Google", owner: "o1", login: "ex**@example.test", business: "personal", used_by: "Mail to you lands here." }] },
  social: { statuses: { live_auto: "Live, and a job posts to it", dead: "Gone" }, rows: [{ business: "example", platform: "Instagram", handle: "@ex", status: "live_auto", account_email: "he**@example.test" }, { business: "example", platform: "X", handle: "@gone", status: "dead" }] },
  handoff: HANDOFF,
  now: new Date("2026-12-01T12:00:00Z"),
  ...over,
});

describe("the Succession Book generator", () => {
  it("fills every live block and keeps the hand-written words", () => {
    const md = buildBook(input());
    expect(md).toContain("Hand-written words stay.");
    expect(md).toContain("github.com/seq23/alpha-repo");
    expect(md).not.toContain("old-repo"); // archived
    expect(md).not.toMatch(/\nold\n/);
    expect(md).toContain("Sells widgets.");
    expect(md).toContain("Nightly copy to Drive.");
    expect(md).toContain("Sequoia's personal Google account");
    expect(md).toContain("Mail to Sequoia lands here.");
    expect(md).toContain("@ex");
    expect(md).not.toContain("@gone");
    expect(md).toContain("<!-- GEN:built -->2026-12-01<!-- /GEN:built -->");
  });

  it("never carries a private brain span, even an unclosed one", () => {
    expect(buildBook(input())).not.toContain("Secret Investor");
    expect(stripConfidential("a <!-- confidential -->b")).toBe("a ");
  });

  it("stops by name on zero sources, a missing block, or unsafe text", () => {
    expect(() => buildBook(input({ brains: [] }))).toThrow(/NAMED STOP \[NO_BRAINS\]/);
    expect(() => buildBook(input({ live: [] }))).toThrow(/NAMED STOP \[NO_REPOS\]/);
    expect(() => buildBook(input({ cats: { problem: "no section" } }))).toThrow(/NAMED STOP \[NO_REPO_CATEGORIES\]/);
    expect(() => buildBook(input({ handoff: "# H\n" }))).toThrow(/NAMED STOP \[HANDOFF_BACKUPS_MISSING\]/);
    expect(() => fillBlocks("# B\n", { repos: "x" })).toThrow(/NAMED STOP \[TEMPLATE_BLOCK_MISSING\]/);
    expect(() => fillBlocks("# B\n<!-- GEN:extra --><!-- /GEN:extra -->", {})).toThrow(/NAMED STOP \[BLOCK_NOT_BUILT\]/);
    expect(() => buildBook(input({ template: `${TEMPLATE}\nEIN 12-3456789\n` }))).toThrow(/NAMED STOP \[UNSAFE_CONTENT\]/);
    expect(safetyProblems("password: hunter2")).toHaveLength(1);
    expect(safetyProblems("# Fine book\nNo passwords are written here.")).toEqual([]);
  });

  it("reads the handoff's backup section and speaks about her, not to her", () => {
    expect(handoffBackups(HANDOFF)).toBe("- Nightly copy to Drive.");
    expect(herWords("Your account; you sign in")).toBe("Sequoia's account; Sequoia sign in");
  });
});
