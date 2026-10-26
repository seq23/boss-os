/**
 * MONIQUE FOUND IS ONE GRID, THE STAR, NO MATCH IN DECIDE, AND THE WAITING LP CARD (owner, 25 Oct 2026).
 * Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { buildDay } from "../scripts/ops/your-day.mjs";
import { moniqueFound, allMatches, STAR } from "../scripts/ops/interest-grid.mjs";
import { lpDecideItems } from "../src/shared/boss/lp/plan.mjs";
import { parsePrice } from "../src/shared/boss/deals/match.mjs";

const NOW = Date.parse("2026-10-25T12:15:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);
const NO_LISTS = { same_firm: [], do_not_suggest: [] };
const grow = (o: Record<string, unknown>) => ({
  side: "buy", direction: "buy", size_usd: null, size_text: "—", price_text: "—", structure_text: "—",
  rainmaker: 0, received_on: day(2), email_url: null, _row: {}, from_text: "—", ...o,
});
const EMPTY = { diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, morning: {} };

/** One buyer and one seller, with the knobs the star reads. */
function pair({ gap = 0.05, sellerUsd = 50e6, buyerUsd = 100e6, sellerDays = 2, buyerDays = 2, priced = true } = {}) {
  const buy = grow({ id: "b", company: "Co", size_usd: buyerUsd, size_text: "$B", price_text: priced ? "$100/share" : "—", received_on: day(buyerDays), from_text: "Bo, Buyer Co", _row: { from: "bo@buyer.example" } });
  const ask = (100 / (1 - gap)).toFixed(4);
  const sell = grow({ id: "s", company: "Co", side: "sell", direction: "sell", size_usd: sellerUsd, size_text: "$S", price_text: priced ? `$${ask}/share` : "—", received_on: day(sellerDays), from_text: "Pat, Seller Co", _row: { from: "pat@seller.example" } });
  return allMatches([buy, sell], NO_LISTS, { now: NOW })[0];
}

describe("the star: all three, at their boundaries", () => {
  it("the thresholds are the ones she ruled", () => {
    expect(STAR).toEqual({ maxGap: 0.10, minFillShare: 0.25, minFillUsd: 10e6, maxDays: 14 });
  });
  it("price: within 10% stars, just past it does not; an unknown price never stars", () => {
    expect(pair({ gap: 0.0999 }).star).toBe(true);
    expect(pair({ gap: 0.1001 }).star).toBe(false);
    expect(pair({ priced: false }).star).toBe(false);
  });
  it("size: at least 25% of the buyer, or at least $10M", () => {
    expect(pair({ buyerUsd: 100e6, sellerUsd: 25e6 }).star).toBe(true);
    expect(pair({ buyerUsd: 100e6, sellerUsd: 9.9e6 }).star).toBe(false);
    expect(pair({ buyerUsd: 200e6, sellerUsd: 10e6 }).star).toBe(true);   // 5%, but $10M
    expect(pair({ buyerUsd: 20e6, sellerUsd: 4.99e6 }).star).toBe(false);  // 24.95%, under $10M
    expect(pair({ buyerUsd: 20e6, sellerUsd: 5e6 }).star).toBe(true);      // exactly 25%
  });
  it("age: both orders under 14 days", () => {
    expect(pair({ sellerDays: 13, buyerDays: 13 }).star).toBe(true);
    expect(pair({ sellerDays: 14 }).star).toBe(false);
    expect(pair({ buyerDays: 14 }).star).toBe(false);
  });
  it("a starred match sorts to the top of the grid, ahead of a fresher ordinary one", () => {
    const starred = [grow({ id: "b1", company: "Alpha", size_usd: 20e6, price_text: "$100/share", received_on: day(5), from_text: "B1", _row: { from: "b1@x.example" } }),
      grow({ id: "s1", company: "Alpha", side: "sell", direction: "sell", size_usd: 20e6, price_text: "$102/share", received_on: day(5), from_text: "S1", _row: { from: "s1@x.example" } })];
    const plain = [grow({ id: "b2", company: "Beta", size_usd: 20e6, received_on: day(0), from_text: "B2", _row: { from: "b2@x.example" } }),
      grow({ id: "s2", company: "Beta", side: "sell", direction: "sell", size_usd: 20e6, received_on: day(0), from_text: "S2", _row: { from: "s2@x.example" } })];
    const out = moniqueFound({ newRows: [], grid: [...plain, ...starred], lists: NO_LISTS, now: NOW });
    expect(out.grid.map((r: any) => r.company)).toEqual(["⭐ Alpha", "Beta"]);
  });
});

describe("no match ever reaches Decide (25 Oct 2026)", () => {
  const g = [grow({ id: "b", company: "Company Z", size_usd: 1e9, size_text: "$1B", price_text: "$100/share", from_text: "Broker One, Firm X", _row: { from: "one@x.example" } }),
    grow({ id: "s", company: "Company Z", side: "sell", direction: "sell", size_usd: 3e8, size_text: "$300M", price_text: "$101/share", from_text: "Broker Two, Firm Y", _row: { from: "two@y.example" } })];
  const found = moniqueFound({ newRows: g, grid: g, lists: NO_LISTS, now: NOW });
  const e = buildDay({ ...EMPTY, morning: { monique_found: { section: "monique_found", at: new Date(NOW).toISOString(), ...found } } }, NOW);
  it("the producer writes none, and the email's Decide holds none", () => {
    expect(found.decide).toEqual([]);
    expect(e.digest.decide).toEqual([]);
    expect(e.text).not.toMatch(/a buyer and a seller who could trade/);
    expect(e.text.split("\n")[2]).toBe("Nothing to decide — this is just so you know.");
  });
  it("the grid shape: company | seller → buyer | fit dots | Open › to the trade's card, in text and HTML", () => {
    expect(e.text).toContain("- ⭐ Company Z · Broker Two, Firm Y $300M at $101/share → Broker One, Firm X $1B at $100/share · fills part, prices close, fresh — Open ›: https://boss.sequoiataylor.com/?tab=capital&view=matches&match=b%7Cs");
    const table = e.html.slice(e.html.indexOf("Monique found"));
    expect(table).toMatch(/<th[^>]*>Company<\/th><th[^>]*>Seller → buyer<\/th><th[^>]*>Fit<\/th>/);
    expect(table).toMatch(/>Open ›<\/a>/);
    expect(e.digest.found_grid[0]).toMatchObject({ match_pair: "company z|one@x.example|two@y.example", match_sig: "b:$100/share|s:$101/share" });
    expect(e.problems).toEqual([]);
  });
});

describe("a valuation written without a dollar sign is a price (the $1B Anthropic sell)", () => {
  it("reads 1.35T valuation", () => {
    expect(parsePrice("1.35T valuation")).toEqual({ kind: "valuation", value: 1.35e12 });
    expect(parsePrice("40k shares")).toBeNull();
  });
});

describe("an LP who wrote back after her reply stays in Decide, louder each day (25 Oct 2026)", () => {
  const row = { address: "k@lp.example", name: "K. Example", status: "replied_again", thread_id: "t1", first_seen: "2026-09-20", sent_at: Date.parse("2026-10-01"), last_reply_at: Date.parse("2026-10-13T15:00:00Z"), said: "Thanks, let's talk." };
  it("says how long it has waited, and has no Skip or Dismiss", () => {
    const [item] = lpDecideItems([row], NOW);
    expect(item!.title).toBe("Waiting 11 days: Answer K. Example: they wrote back after your reply");
    expect(item!.buttons.map((b: any) => b.label)).toEqual(["Open the thread and reply"]);
    expect(JSON.stringify(item!.buttons)).not.toMatch(/skip|dismiss/i);
    expect(lpDecideItems([row], NOW + 86_400_000)[0]!.title).toMatch(/^Waiting 12 days: /);
  });
});
