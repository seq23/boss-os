import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson } from "./helpers";

/**
 * THE DESK RECOMMENDS, IT DOES NOT ENUMERATE.
 *
 * ─── Her words, 9 September 2026 ───────────────────────────────────────────
 *
 *   "id rather the capital tab just not list buyers like this. just have a recommendation section
 *    with a list of names to send an email to and a sample of the emails that should be sent"
 *
 * On the day she said it, `SELECT status, COUNT(*) FROM sourcing_candidates GROUP BY status` on
 * production returned exactly one row: `reviewed 28`. Every firm reviewed, three header counters
 * mostly zero, and nothing left for the screen to say.
 *
 * ─── The four things this file holds down ──────────────────────────────────
 *
 * 1. A HANDFUL, RANKED, EACH WITH THE LETTER. Not the catalogue.
 * 2. EVERY ROW SAYS WHY IT IS THERE — a headline built from signals that actually fired, and every
 *    signal quoting the fact it read. A ranking nobody can interrogate is one nobody should act on.
 * 3. SUPPRESSION SURVIVES AND IS VISIBLE. A firm on the LP do-not-contact list is never recommended,
 *    never drafted, and leaves the list with the reason attached.
 * 4. THE SIZE TEST IS REAL OR IT IS ABSENT. With a stated position, a firm whose floor is above it
 *    is dropped with the arithmetic printed. With no stated position, NOBODY gains a size point and
 *    the response says so — the ranking is never decorated with a comparison that did not happen.
 */

const NOW = Date.now();

async function seed(rows: Array<Record<string, unknown>>) {
  await env.DB.prepare(`DELETE FROM buyer_outreach_drafts`).run();
  await env.DB.prepare(`DELETE FROM counterparty_crossmatches`).run();
  await env.DB.prepare(`DELETE FROM sourcing_candidates`).run();
  await env.DB.prepare(`DELETE FROM settings WHERE key = 'brokerage_working_position_usd'`).run();
  for (const r of rows) {
    await env.DB
      .prepare(
        `INSERT INTO sourcing_candidates
           (id, name, kind, ticket_floor_usd, thesis, source_url, source_name, read_at, origin, status,
            history_kind, history_last_at, history_exchanges, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        r.id, r.name, "buyer", r.ticket_floor_usd ?? null, r.thesis ?? null,
        r.source_url ?? "https://example.test/firm", r.source_name ?? "their own site",
        NOW - 86_400_000, "public_research", r.status ?? "reviewed",
        r.history_kind ?? null, r.history_last_at ?? null, r.history_exchanges ?? null,
        NOW, NOW,
      )
      .run();
  }
}

/** The three real shapes on production, reduced to their load-bearing facts. */
const DIRECT_BUYER = {
  id: "src_direct",
  name: "Saints Capital",
  ticket_floor_usd: 0,
  thesis: "Firm founded exclusively for the direct secondary market: buys shares directly from employees.",
};
const BIG_FLOOR = {
  id: "src_pinegrove",
  name: "Pinegrove Venture Partners",
  ticket_floor_usd: 50_000_000,
  thesis: "Venture secondaries platform that buys existing shares in late-stage companies.",
};
const FUND_ONLY = {
  id: "src_fundonly",
  name: "Committed Advisors",
  ticket_floor_usd: 11_000_000,
  thesis: "Provides liquidity to owners of fund interests and portfolios of fund positions.",
};

const get = () => apiJson<any>("/api/wealth/recommendations");

describe("the desk recommends a handful and says why for each", () => {
  it("ranks a firm she has dealt with above a stranger, and carries the letter in full", async () => {
    await seed([
      DIRECT_BUYER,
      { ...FUND_ONLY, id: "src_warm", name: "Kline Hill Partners", history_kind: "dealt", history_exchanges: 12, history_last_at: NOW - 60 * 86_400_000 },
    ]);
    const { body } = await get();
    const recs = body.data.recommendations;

    // Rule 0: every assertion below would pass over an empty list.
    expect(recs.length).toBe(2);
    expect(recs[0].name).toBe("Kline Hill Partners");

    // THE REASON IS THE POINT. It must name the fact, not restate the rule.
    expect(recs[0].headline).toContain("transacted with them before");
    expect(recs[0].signals.some((s: any) => s.code === "dealt_before" && s.weight > 0)).toBe(true);

    // AND THE SAMPLE EMAIL IS ON THE SCREEN, whole, without opening anything.
    expect(recs[0].letter.subject.length).toBeGreaterThan(0);
    expect(recs[0].letter.body).toContain("We have worked together before");
    expect(recs[0].letter.to_hint).toContain("https://example.test/firm");
  });

  it("quotes the firm's own words about what it buys, in both directions", async () => {
    await seed([DIRECT_BUYER, FUND_ONLY]);
    const { body } = await get();
    const byName = Object.fromEntries(body.data.recommendations.map((r: any) => [r.name, r]));

    const direct = byName["Saints Capital"].signals.find((s: any) => s.code === "buys_company_shares");
    expect(direct.weight).toBeGreaterThan(0);
    expect(direct.says).toContain("directly from employees");

    // A FIRM THAT ONLY SAYS "fund interests" IS MARKED DOWN AND TOLD WHY — this is the discriminator
    // that decides whether a buyer can transact with her at all, and it was nowhere on the old screen.
    const fund = byName["Committed Advisors"].signals.find((s: any) => s.code === "buys_fund_interests");
    expect(fund.weight).toBeLessThan(0);
    expect(fund.says).toContain("fund interests");
    expect(byName["Saints Capital"].score).toBeGreaterThan(byName["Committed Advisors"].score);
  });

  it("never recommends a firm on the LP do-not-contact list, and says which firm and why", async () => {
    await seed([DIRECT_BUYER, { ...FUND_ONLY, id: "src_stepstone", name: "StepStone Group" }]);
    await env.DB
      .prepare(
        `INSERT INTO counterparty_crossmatches
           (id, candidate_id, candidate_name, lp_firm, matched_core, confidence, method, lp_list, lp_contacts,
            why, status, created_at, updated_at)
         VALUES (?,?,?,?,?,'confirmed','core_exact_subset','suppressed',0,?, 'reviewed', ?, ?)`,
      )
      .bind("xm_t", "src_stepstone", "StepStone Group", "StepStone", "stepstone",
        "On your LP do-not-contact list.", NOW, NOW)
      .run();

    const { body } = await get();
    expect(body.data.recommendations.map((r: any) => r.candidate_id)).not.toContain("src_stepstone");

    const held = body.data.suppressed;
    expect(held).toHaveLength(1);
    expect(held[0].name).toBe("StepStone Group");
    expect(held[0].because).toContain("do-not-contact");
    expect(held[0].because).toContain("StepStone");
    // AND SHE CAN OVERTURN IT. A name match is a guess; the id travels with the refusal so the
    // screen can offer "not the same firm" beside the reason rather than making it unchallengeable.
    expect(held[0].crossmatch_id).toBe("xm_t");
  });

  it("drops a firm she cannot reach once she states the position, with the arithmetic", async () => {
    await seed([DIRECT_BUYER, BIG_FLOOR]);
    await apiJson<any>("/api/system/settings/brokerage_working_position_usd", {
      method: "PUT", body: { value: "5000000" },
    });

    const { body } = await get();
    expect(body.data.recommendations.map((r: any) => r.name)).not.toContain("Pinegrove Venture Partners");
    expect(body.data.out_of_reach).toHaveLength(1);
    expect(body.data.out_of_reach[0].because).toContain("$50M");
    expect(body.data.out_of_reach[0].because).toContain("$5M");
    expect(body.data.basis.working_position_usd).toBe(5_000_000);
    // ONE OF THE TWO PUBLISHES A FLOOR, AND THE SCREEN SAYS THAT RATHER THAN IMPLYING THE TEST RAN
    // on both. Silence about the untested firm is the honest answer; a clean ranking would be a lie.
    expect(body.data.basis.limitation).toContain("Only 1 of 2");
  });

  it("awards nobody a size point when the position is unknown, and says so on the screen", async () => {
    await seed([DIRECT_BUYER, BIG_FLOOR]);
    const { body } = await get();

    expect(body.data.basis.working_position_usd).toBeNull();
    expect(body.data.basis.limitation).toContain("no record of your positions");
    // THE RANKING IS NOT FAKED. Not one candidate carries a positive reachability signal.
    const all = body.data.recommendations.flatMap((r: any) => r.signals);
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((s: any) => s.code === "within_reach")).toBe(false);
    // And a firm with a floor is still offered, with the untested state named rather than assumed.
    const big = body.data.recommendations.find((r: any) => r.name === "Pinegrove Venture Partners");
    expect(big.signals.find((s: any) => s.code === "floor_untested").says).toContain("not tested");
  });

  it("keeps a firm off the list once a letter is in flight, and says which state it is in", async () => {
    await seed([DIRECT_BUYER, { ...FUND_ONLY, id: "src_sent", name: "Already Written To", status: "contacted" }]);
    const { body } = await get();
    expect(body.data.recommendations.map((r: any) => r.name)).not.toContain("Already Written To");
    expect(body.data.already_moving[0].because).toContain("already approached");
  });

  it("drafts the letter she read, unchanged, into her Inbox", async () => {
    await seed([DIRECT_BUYER]);
    const { body } = await get();
    const shown = body.data.recommendations[0].letter;

    const drafted = await apiJson<any>(`/api/wealth/recommendations/${DIRECT_BUYER.id}/draft`, {
      method: "POST", body: {},
    });
    expect(drafted.body.data.drafted).toBe(true);

    const row = await env.DB.prepare(`SELECT * FROM buyer_outreach_drafts`).first<any>();
    expect(row).toBeTruthy();
    // A PREVIEW THAT CAN DIFFER FROM THE THING IT PREVIEWS IS WORSE THAN NO PREVIEW.
    expect(row.subject).toBe(shown.subject);
    expect(row.body).toBe(shown.body);
  });
});
