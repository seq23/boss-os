/**
 * The Succession Book generator (scripts/ops/succession-book.mjs) on fakes only: the repo is
 * public, so no real brain, handoff or book text is ever here.
 */
import { describe, expect, it } from "vitest";
import { ENVELOPE, bookProblems, buildBook, fillBlocks, herWords, mdToHtml, repoCategory, safetyProblems } from "../scripts/ops/succession-book.mjs";

const TEMPLATE = [
  "# Book", "", "Hand-written words stay.", "",
  "<!-- GEN:apps -->", "<!-- /GEN:apps -->",
  "<!-- GEN:repos -->", "old", "<!-- /GEN:repos -->",
  "<!-- GEN:domains -->", "<!-- /GEN:domains -->",
  "<!-- GEN:social -->", "<!-- /GEN:social -->",
  "<!-- GEN:emails -->", "<!-- /GEN:emails -->",
  "<!-- GEN:posting -->", "<!-- /GEN:posting -->",
  "## 1. Every business at a glance", "", "| Business | Status |", "|---|---|", "| **Example Co** | Videos made automatically on the Mac. |", "",
  "## 3. Layers", "", "The sealed envelope holds:", "", "<!-- GEN:envelope -->", "<!-- /GEN:envelope -->", "",
  "### First day", "", "3. Sign in to seq.taylor@gmail.com, then run Claude.", "",
  "5. Paste: \"Stop these Email Map senders: <!-- GEN:day1-stop --><!-- /GEN:day1-stop -->.\"", "",
  "Pending: [Sequoia fills: the attorney's name]. Also [Sequoia confirms] here.",
  "<!-- GEN:gaps -->", "<!-- /GEN:gaps -->",
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
  mapRows: [{ repo: "alpha-repo", category: "friends", what: "Your alpha site." }, { repo: "loose-repo", category: "mine", business: "brokerage", what: "Deal room." }],
  cats: CATS,
  domains: { rows: [
    { domain: "late.example", registrar: "Namecheap", tier: "keep", expires: "2027-05-01", mail_words: "No mail." },
    { domain: "soon.example", registrar: "Cloudflare", tier: "keep", expires: "2026-12-11", mail_words: "Your inbox." },
    { domain: "gone.example", registrar: "Cloudflare", tier: "retire", expires: "2027-01-01" },
  ] },
  social: { businesses: [{ key: "example", label: "Example Co" }], rows: [
    { business: "example", platform: "Pinterest", handle: "ex", status: "live_auto", posts: { by: "job", what: "The Mac posts your pins." } },{ business: "example", platform: "YouTube", handle: "@exvideo", status: "planned", posts: { by: "job", what: "The Mac uploads.", jobs: ["night-batch"] } },{ business: "example", platform: "LinkedIn", handle: "@later", status: "planned", posts: { by: "job", what: "Someday." } },{ business: "example", platform: "Instagram", handle: "@ex", status: "live_auto" }, { business: "example", platform: "X", handle: "@gone", status: "dead" }, { business: "example", platform: "GitHub (code repo)", handle: "seq23/x", status: "live_auto" }] },
  emailMap: { businesses: [{ key: "spry", label: "Spry Labs" }], rows: [
    { id: "morning", business: "spry", what: "Your morning email", to: "You", pause: "Turn off com.seq.example-morning" },
    { id: "ancestral", business: "personal", what: "Your hour, with Done", to: "You", pause: "Tap Done ✓" },
    { id: "spry-cold", business: "spry", what: "Cold notes to shops", to: "Prospect businesses (about 10 a day per site)", pause: "Remove RESEND_API_KEY on the Pages project" },
    { id: "spry-receipt", business: "spry", what: "Receipts", to: "The buyer", pause: "Remove RESEND_API_KEY on the Pages project" },
    { id: "her-gmail", business: "personal", what: "Emails a session sends for you", from: "Your personal Gmail", to: "Whoever", pause: "Disconnect it", as_her: true },
    { id: "twin", business: "west-peek-ventures", what: "LP drip", to: "Prospective LPs", pause: "In Twin: pause", as_her: true, plain_stop: "Sign in at twin.so and pause the LP campaign." },
    { id: "hicks", business: "personal", what: "Quarterly update for her OK", to: "You", pause: "Tap Skip this quarter", as_her: true },
    { id: "deals", business: "brokerage", what: "Deal finds", to: "You", pause: "Turn off com.seq.example-deals" },
    { id: "spry-buyer", business: "spry", what: "Receipt", to: "The buyer", pause: "Leave on" },
    { id: "old-intro", business: "west-peek-ventures", what: "Retired introductions", from: "The Gmail account behind its token", to: "The introduced contacts", pause: "Already off: no send", as_her: true },
    { id: "weekly", business: "spry", what: "Weekly report", to: "No one directly (the weekly carries it)", pause: "–" },
  ] },
  spryBody: "## Company\n- Sells apps.\n\n**App Store apps (ids checked 1 Dec)**\n| App | Bundle id | App Store Connect app id | State |\n|---|---|---|---|\n| Example App | com.example.app | 1234567890 | live |\n\nAfter the table.\n",
  now: new Date("2026-12-01T12:00:00Z"),
  ...over,
});

describe("the Succession Book generator", () => {
  it("fills every live block and keeps the hand-written words", () => {
    const md = buildBook(input());
    expect(md).toContain("Hand-written words stay.");
    expect(md).toContain("3 repos, live from GitHub.");
    expect(() => buildBook(input({ emailMap: { rows: [] } }))).toThrow(/NAMED STOP \[NO_EMAIL_MAP\]/);
    expect(md).not.toContain("old-repo"); // archived
    expect(md).not.toMatch(/\nold\n/);
    expect(md).toContain("Her alpha site.");
    expect(md).toContain("No description yet");
    expect(md).not.toContain("@gone");
    expect(md).toContain("<!-- GEN:built -->2026-12-01<!-- /GEN:built -->");
    expect(md).toContain("| Example App | com.example.app | https://appstoreconnect.apple.com/apps/1234567890 | live |");
    expect(md).not.toContain("After the table.");
    expect(md).toContain("| Example Co | Instagram | @ex | Live, posts automatically |");
    expect(md).not.toContain("seq23/x");
    expect(md).toContain("| github.com/seq23/loose-repo | Brokerage: do not touch |");
    expect(md).toContain("10 automatic emails, from Boss OS › Email Map (1 more there write to no one, so they are not listed).");
    // Round 11: one rule for buttons (tap nothing), senders as her stop on Day 1, a shared switch keeps the receipts.
    expect(md).not.toMatch(/\| Tap |Do not tap/);
    expect(md).toContain('| Sends as Sequoia: stop on Day 1; tap nothing in these emails | personal | Emails a session sends for Sequoia | Whoever | Ask Claude: "Stop the Email Map sender her-gmail." |');
    expect(md).toContain('Ask Claude: "Stop the Email Map sender hicks."');
    expect(md).toContain("| Sign in at twin.so and pause the LP campaign. |");
    expect(md).toContain('Ask Claude: "Stop the Email Map sender spry-cold only, and keep spry-receipt running."');
    expect(md).not.toContain("receipts)");
    expect(md).not.toContain("RESEND_API_KEY");
    expect(md).toContain("| Nothing to do: it is already off. |");
    expect(md).toContain("Stop these Email Map senders: <!-- GEN:day1-stop -->spry-cold, her-gmail, hicks, deals<!-- /GEN:day1-stop -->.");
    expect(md).toContain("2 blanks.");
    expect(md).toContain("| Fill in | Pending: …: the attorney's name |");
    const order = ["Brokerage: stop on Day 1", "Sends as Sequoia: stop on Day 1", "Writes to people for her businesses: stop on Day 1", "Customers (receipts", "To Sequoia only"].map((w) => md.indexOf(w));
    expect(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1]!))).toBe(true);
    expect(md).toContain(ENVELOPE.map((t, i) => `${i + 1}. ${t}`).join("\n"));
    expect(md).toContain("Her morning email");
    expect(md).not.toContain("Weekly report");
    // A job already posting to a not-yet-launched account still gets its pause row (Whisper Almanac, round 11).
    expect(md).toContain("2 accounts post automatically");
    expect(md).toContain('| Example Co | YouTube | The Mac uploads. | Ask Claude: "Pause the job that posts to YouTube for Example Co." |');
    expect(md).toContain("| Example Co | YouTube | @exvideo | Posts automatically; its launch review has not passed yet |");
    expect(md).not.toContain("@later");
    expect(md).toContain("The Mac posts her pins.");
  });

  it("sorts repos by her categories first: parked wins over friends, hers over the map", () => {
    expect(repoCategory("parked-repo", CATS)).toBe("parked");
    expect(repoCategory("alpha-repo", CATS, { category: "friends" })).toBe("hers");
    expect(repoCategory("stray-repo", CATS)).toBe("not sorted yet");
  });

  it("lists the kept domains soonest-expiring first, never a retired one", () => {
    const md = buildBook(input());
    expect(md.indexOf("soon.example")).toBeLessThan(md.indexOf("late.example"));
    expect(md).toContain("| soon.example | RENEW NOW, before 2026-12-11 |");
    expect(md).toContain("| late.example | Keep: renew |");
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

  it("refuses a book that contradicts itself (round-11 review, 20 Nov 2026)", () => {
    const md = buildBook(input());
    const ctx = { emailMap: input().emailMap, social: input().social };
    expect(bookProblems(md, ctx)).toEqual([]);
    const bad = (from: string, to: string) => bookProblems(md.replace(from, to), ctx).join(" ");
    expect(bad("1. Her Mac login", "1. Her Mac login\n\nThe envelope also holds the Google backup codes.")).toMatch(/envelope holds more/);
    expect(bad("10 automatic emails", "11 automatic emails")).toMatch(/says 11, shows 10/);
    expect(bad("Ask Claude: \"Stop the Email Map sender hicks.\"", "Tap Skip this quarter")).toMatch(/cannot follow: "Tap Skip/);
    expect(bad("Ask Claude: \"Stop the Email Map sender deals.\"", "launchctl bootout com.seq.example-deals")).toMatch(/cannot follow/);
    expect(bad("-->spry-cold, ", "-->")).toMatch(/Day 1 message/);
    expect(bad("| **Example Co** |", "| **Other Co** |")).toMatch(/Other Co is made automatically but has no row/);
    expect(bad("Videos made automatically", "In Apple review; videos made automatically")).toMatch(/Apple status/);
    expect(bad("3. Sign in to seq.taylor@gmail.com, then run Claude.", "3. Run Claude, then sign in to seq.taylor@gmail.com.")).toMatch(/starts Claude before/);
    expect(() => buildBook(input({ template: `${TEMPLATE}\nThe envelope holds a USB stick.\n` }))).toThrow(/NAMED STOP \[BOOK_CONTRADICTS_ITSELF\]/);
  });

  it("the Drive Doc carries real tables, nested lists and escaped text", () => {
    const html = mdToHtml("# T\n\n| a | b |\n|---|---|\n| **x** | <y> |\n\n- one\n  - two\n1. first\n", "T");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td><b>x</b></td><td>&lt;y&gt;</td>");
    expect(html).toMatch(/<ul>\n<li>one<\/li>\n<ul>\n<li>two<\/li>\n<\/ul>\n<\/ul>\n<ol>/);
  });

  it("speaks about her, not to her", () => {
    expect(herWords("Your account; you still want it; you are in")).toBe("Her account; Sequoia still wants it; Sequoia is in");
    expect(herWords("Do you still want to go? Buyers for what you're selling")).toBe("Does Sequoia still want to go? Buyers for what Sequoia is selling");
    expect(herWords('Subject "Before you pay" stays')).toBe('Subject "Before you pay" stays');
    expect(herWords("the business you named; what you approved")).toBe("the business Sequoia named; what Sequoia approved");
  });
});
