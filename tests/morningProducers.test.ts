/**
 * END TO END: D's and L's morning sections, written by their own builders through E's ONE writer
 * (`writeMorningSection`), read back by Simone's run, rendered into the one morning email and
 * passed by E's send-time plain-email gate (owner, 23 Oct 2026, rules 1 and 13).
 *
 * Before the combined merge each builder kept its own copy of the writer: D stamped `written_at`
 * and called its link `more`, L stamped `updated_at` and wrote LP rows with no company. E's reader
 * requires `at` and `link`, so every D and L section was skipped as "no valid at" and the morning
 * email silently showed no deals, no LP replies and no prospects. This pins the whole path.
 *
 * Synthetic data only (public repo).
 */
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const NOW = Date.parse("2026-10-23T12:15:00Z"); // Friday, 07:15 Central
const DIR = mkdtempSync(join(tmpdir(), "boss-morning-e2e-"));
const G = "https://mail.google.com/mail/u/0/#all/";
const prevDir = process.env.BOSS_OS_MORNING_DIR;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mods: Record<string, any> = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let email: any;
let sectionNames: string[] = [];
let skipped: string[] = [];

const row = (o: Record<string, unknown>) => ({
  side: "buy", direction: "buy", size_usd: null, size_text: "—", price_text: "—", structure_text: "—",
  rainmaker: 0, received_on: "2026-10-22", email_url: null, _row: {}, ...o,
});

beforeAll(async () => {
  // Every producer and the reader honour the same override; set it before the producers load.
  process.env.BOSS_OS_MORNING_DIR = DIR;
  const grid = await import("../scripts/ops/interest-grid.mjs");
  const lpDaily = await import("../scripts/ops/lp-daily.mjs");
  const catchups = await import("../scripts/ops/lp-catchups.mjs");
  const prospects = await import("../scripts/ops/lp-prospects.mjs");
  const morning = await import("../src/shared/boss/mail/morning.mjs");
  const day = await import("../scripts/ops/your-day.mjs");
  const plain = await import("../src/shared/boss/mail/plain.mjs");
  mods = { grid, lpDaily, catchups, prospects, morning, day, plain };

  // ── D: two new rows (a buyer and a seller of the same company), so an intro and the grid both show.
  const g = [
    row({ id: "g1", company: "Company A", side: "buy", direction: "buy", size_usd: 1e9, size_text: "$1B", from_text: "Broker One (Firm X)",
      email_url: `${G}a1`, _row: { from: "one@firm-x.example", from_name: "Broker One" } }),
    row({ id: "g2", company: "Company A", side: "sell", direction: "sell", size_usd: 3e8, size_text: "$300M", price_text: "$138/share", from_text: "Broker Two (Firm Y)",
      email_url: `${G}b2`, _row: { from: "two@firm-y.example", from_name: "Broker Two" } }),
  ];
  const lists = { same_firm: [], do_not_suggest: [] };
  const found = { "company a": { holders: [{ fund: "Example Growth Fund", manager: "Example Advisers", value_usd: 1.2e8, as_of: "2026-06-30", filing_url: "https://www.sec.gov/Archives/example" }] } };
  grid.writeMorning("deals", grid.morningDeals(g, g.length, NOW));
  grid.writeMorning("monique_found", grid.moniqueFound({ newRows: g, grid: g, lists, found }));

  // ── L: one LP reply held two days, one interested prospect, one catch-up, the 8Raise footer.
  const lpRows = [{ status: "drafted", tap_token: "tok_lp_1", drafted_at: NOW - 3 * 86_400_000, name: "An Allocator", firm: "Example Endowment", bucket: "call", draft_message_id: "r-123" },
    { status: "sent", name: "Another Allocator", firm: "Example Foundation" }];
  lpDaily.writeMorning("lp", lpDaily.lpMorning(lpRows, NOW));
  lpDaily.writeMorning("prospects", prospects.prospectsMorning({
    rows: [{ status: "interested", draft_tap_token: "tok_p_1", name: "A Buyer", firm: "Example Capital", side: "buyer", thread_id: "t1", reply_note: "Happy to talk next week." },
      { status: "active", name: "B Buyer", firm: "Example Family Office", side: "unknown" }],
    pending: null, stale: [], plan: { stops: [] }, sent: 2, now: NOW,
  }));
  lpDaily.writeMorning("catchups", catchups.catchupsMorning([{ name: "A Past Partner", firm: "Example Partners", email: "partner@example.com", reason: "They bought Company A last year and it is moving again.", company: "Company A" }], NOW));
  lpDaily.writeMorning("eightraise", { decide: [], rows: [], lines: [], credits: { used: 7, budget: 75, kept: 30 } });

  sectionNames = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  const read = morning.readMorningSections({ dir: DIR, now: NOW });
  skipped = read.skipped;
  email = day.buildDay({
    diary: [], tasks: [], approvals: [], repoChanges: [], bounceFixes: null, feed: { items: [] },
    briefing: { for_day: "2026-10-23", summary: "Markets flat.", sections: [{ key: "one_minute_summary", bullets: ["Rates held."] }] },
    morning: read.sections,
  }, NOW);
});

afterAll(() => {
  if (prevDir === undefined) delete process.env.BOSS_OS_MORNING_DIR;
  else process.env.BOSS_OS_MORNING_DIR = prevDir;
});

describe("the one-tap page path reaches the tap route", () => {
  it("/tap/<token> maps to Boss OS's tap route, anything else does not", async () => {
    const { tapPageToBossPath } = await import("../src/worker/bossMount");
    expect(tapPageToBossPath(`/tap/${"a".repeat(24)}`)).toBe(`/api/boss/auth/tap/${"a".repeat(24)}`);
    for (const p of ["/tap/short", `/tap/${"a".repeat(24)}/x`, "/taps/" + "a".repeat(24), "/api/boss/auth/tap/" + "a".repeat(24)]) expect(tapPageToBossPath(p), p).toBeNull();
  });
  it("wrangler runs the Worker first for /tap/* and /api/* in every environment (a tapped link is a navigation)", () => {
    const toml = readFileSync(join(__dirname, "..", "wrangler.toml"), "utf8");
    const blocks = toml.split(/\n\[/).filter((b) => /^(?:env\.production\.)?assets\]/.test(b));
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b).toMatch(/run_worker_first = \["\/tap\/\*", "\/api\/\*"\]/);
  });
});

describe("D and L sections reach Simone's morning email through E's writer", () => {
  it("every producer wrote its file with E's stamp, and the reader skipped none", () => {
    expect(sectionNames).toEqual(["catchups", "deals", "eightraise", "lp", "monique_found", "prospects"]);
    for (const n of sectionNames) {
      const obj = JSON.parse(readFileSync(join(DIR, `${n}.json`), "utf8"));
      expect(obj.section).toBe(n);
      // E's writer stamps "at" (the reader's freshness clock); D's "written_at" and L's own stamp are gone.
      expect(Math.abs(Date.now() - Date.parse(obj.at)), `${n} has E's "at"`).toBeLessThan(60_000);
      expect(obj.written_at, n).toBeUndefined();
      expect(mods.morning.morningSectionProblems(obj), n).toEqual([]);
    }
    expect(skipped).toEqual([]);
  });

  it("renders every section's content in her order", () => {
    const t: string = email.text;
    for (const s of ["New deals since yesterday (2)", "Company A", "Broker Two (Firm Y)", "See the full grid (2 open deals)",
      "Monique found", "Example Growth Fund", "See every match",
      "Reply to An Allocator at Example Endowment", "A Buyer at Example Capital wants to talk",
      "Catch up with", "A Past Partner"]) {
      expect(t, s).toContain(s);
    }
    // 7 of 75 credits used is fine, so no 8Raise line (owner, 24 Oct 2026).
    expect(t).not.toMatch(/8Raise/);
    // The LP reply waiting three days outranks everything else in Decide.
    expect(t.indexOf("Waiting 3 days: Reply to An Allocator")).toBeGreaterThan(-1);
    expect(t.indexOf("Waiting 3 days")).toBeLessThan(t.indexOf("wants to talk"));
    expect(t.indexOf("Decide")).toBeLessThan(t.indexOf("New deals since yesterday"));
    // One match for the one buyer-seller pair (D), in Decide; a row with no price shows none (E).
    expect(t.split("Company A: a buyer and a seller who could trade").length - 1).toBe(1);
    expect(t).toContain("Company A · Buy · $1B · Broker One (Firm X)");
    expect(t).not.toMatch(/@\s*(?:·|—|$)/m);
    // An LP draft whose words are not on the row has no "Send as is": nothing goes that was not shown.
    expect(t).not.toContain("Send as is: https://boss.sequoiataylor.com/tap/tok_lp_1?do=send");
    expect(t).toContain("Skip: https://boss.sequoiataylor.com/tap/tok_lp_1?do=skip");
    // L's one-tap buttons are pages (/tap/<token>), never an /api path the gate would hold.
    expect(t).not.toMatch(/\/api\//);
  });

  it("passes E's send-time plain-email gate with nothing dropped", () => {
    expect(email.dropped).toEqual([]);
    expect(email.problems).toEqual([]);
    expect(mods.plain.plainProblems(email)).toEqual([]);
  });

  it("a producer that bypasses the writer's shape is refused, never shown half-read", () => {
    expect(() => mods.lpDaily.writeMorning("lp", { decide: [{ title: "x", buttons: [{ label: "Go", url: "/api/x" }] }] })).toThrow(/without a real link/);
  });
});
