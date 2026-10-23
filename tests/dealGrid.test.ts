/**
 * Boss fix D (23 Oct 2026) — the deal grid, as her Mac builds it. Synthetic data only: the repo is
 * public, so every name, address and firm below is invented.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildGrid, gridRow, priceWords, sizeWords, structureWords, fromWords, firmOf, gmailUrl, isHerAddress,
  isHers, mentionsHer, moniqueFound, morningDeals, otherSides, prospectSellRows, LOOKBACK_DAYS,
} from "../scripts/ops/interest-grid.mjs";
import { structuredOrder, markHers } from "../scripts/ops/interest-extract.mjs";
import { standingMatches, assignedSearch, revivals } from "../scripts/ops/interest-match.mjs";
import { positionFromXml, genInfoFromXml, allHolders, partialFill, recordFound } from "../scripts/ops/filing-hunt.mjs";
import { parseListEdits, withinLookback, pairAllowed } from "../src/shared/boss/capital/partyLists.mjs";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);
const ID = { names: ["Sequoia Taylor"], addresses: ["owner@example-own.com"] };
const NO_LISTS = { same_firm: [], do_not_suggest: [] };

const row = (o: Record<string, unknown>) => ({
  principal: "Example Fund", principal_email: "pm@examplefund.com", side: "buy", asset: "Acme Robotics",
  size_usd: 50e6, size_shares: null, size_text: "$50M", price_text: null, durability: "wants_now",
  confidence: "high", intermediated_by: null, quote: "We want $50M of Acme Robotics", source_message: "m1",
  date: day(1), from: "pm@examplefund.com", from_name: "Pat Example", ...o,
});

describe("her own name and addresses are never a counterparty (rule 5)", () => {
  it("catches her display name, her addresses, and her firm address by local part", () => {
    expect(isHerAddress("owner@example-own.com", ID)).toBe(true);
    expect(isHerAddress("owner@rainmakersecurities.com", ID)).toBe(true);
    expect(isHerAddress("owner@stranger.com", ID)).toBe(false);
    expect(mentionsHer("Unnamed buyer of Sequoia Taylor", ID)).toBe(true);
    expect(isHers(row({ principal: "unnamed client of Sequoia Taylor", from: "x@y.com" }), ID)).toBe(true);
  });

  it("the grid shows her rows as Yours from You, never as a broker", () => {
    const g = gridRow(row({ principal: "Unnamed buyer of Sequoia Taylor" }), { identity: ID, lists: NO_LISTS });
    expect(g.side).toBe("yours");
    expect(g.from_text).toBe("You");
    expect(g.parties).toBe("");
  });

  it("her rrlist@ order posting becomes a Yours row with 'your client' as principal", () => {
    const r = structuredOrder({
      source_message: "s1", date: day(0), subject: "Sell Order: Acme Robotics | $ 25.00 M @ $ 12.00",
      from: "owner@rainmakersecurities.com", from_name: "Sequoia Taylor", to: ["rrlist@rainmakersecurities.com"], cc: [], outbound: false,
    });
    expect(r?.hers).toBe(true);
    expect(r?.principal).toBe("your client");
    expect(r?.to_rrlist).toBe(true);
  });

  it("a colleague's posting is not hers", () => {
    const r = markHers({ principal: "unnamed client of Colleague" }, { from: "colleague@rainmakersecurities.com", from_name: "Colleague", to: ["rrlist@rainmakersecurities.com"] });
    expect(r.hers).toBeUndefined();
  });
});

describe("prices and sizes are sane or '—' (rule 5)", () => {
  it("never prints an absurd number", () => {
    expect(priceWords("$ 1,484,000 M")).toBe("—");
    expect(priceWords("$ 600,000,000,000 M")).toBe("—");
    expect(priceWords("$ 590,000 M")).toBe("$590B valuation");
    expect(priceWords("$ 138.00")).toBe("$138 a share");
    expect(priceWords("$22B valuation")).toBe("$22B valuation");
    expect(priceWords("$9T")).toBe("—");
    expect(priceWords(null)).toBe("—");
    expect(priceWords("35/0/0 (incl 1% to the desk)")).toBe("—");
    expect(sizeWords({ size_usd: 9e12 })).toBe("—");
    expect(sizeWords({ size_usd: 300e6 })).toBe("$300M");
    expect(sizeWords({ size_shares: 40000 })).toBe("40,000 shares");
  });

  it("reads structure and fees the email states", () => {
    expect(structureWords({ quote: "Terms 8/0/5, SPV, preferred" })).toBe("8/0/5 · SPV · preferred");
    expect(structureWords({ quote: "nothing here" })).toBe("—");
  });

  it("names person and firm, and links the real Gmail message", () => {
    expect(firmOf("a@exampleventures.com")).toBe("Example Ventures");
    expect(firmOf("a@rainmakersecurities.com")).toBe("Rainmaker");
    expect(firmOf("a@apexcapitalpartners.com")).toBe("Apex Capital Partners");
    expect(firmOf("a@psi.com")).toBe("PSI");
    expect(fromWords(row({}), false)).toBe("Pat Example, Example Fund");
    expect(gmailUrl("abc123", "box@example.com")).toBe("https://mail.google.com/mail/u/box%40example.com/#all/abc123");
  });
});

describe("the ~6-month window (owner, 23 Oct 2026)", () => {
  it("is one constant of about six months", () => {
    expect(LOOKBACK_DAYS).toBe(183);
    expect(withinLookback(day(182), NOW)).toBe(true);
    expect(withinLookback(day(184), NOW)).toBe(false);
  });

  it("drops older rows from the grid, hers included, and from matching and searches", () => {
    const old = row({ source_message: "old", date: day(200) });
    const oldHers = row({ source_message: "oldh", date: day(200), principal: "client of Sequoia Taylor" });
    const fresh = row({ source_message: "new", date: day(2) });
    const grid = buildGrid([old, oldHers, fresh], { identity: ID, lists: NO_LISTS, now: NOW });
    expect(grid.map((g: any) => g.source_message)).toEqual(["new"]);

    const sellOld = row({ source_message: "s-old", side: "sell", date: day(200), principal: "Seller Co", principal_email: "s@sellerco.com", from: "s@sellerco.com" });
    expect(standingMatches([fresh, sellOld], new Set(), NOW).picked).toHaveLength(0);
    expect(assignedSearch([sellOld], "Acme Robotics", "sell", 0, new Set(), NOW)).toHaveLength(0);
    expect(revivals([old], [], new Set(), NOW).picked).toHaveLength(0);
  });
});

describe("Rainmaker x Rainmaker is never suggested; do-not-suggest never appears (rules 6, 15)", () => {
  const lists: any = {
    same_firm: [{ kind: "email", value: "pm@partnerfirm.com" }],
    do_not_suggest: [{ kind: "name", value: "ruled out person" }],
  };
  const buyer = row({ source_message: "b", from: "colleague@rainmakersecurities.com", from_name: "Colleague", intermediated_by: "colleague@rainmakersecurities.com", principal: "unnamed client of Colleague", principal_email: null });
  const sellerSameFirm = row({ source_message: "s", side: "sell", principal: "Partner Firm", principal_email: "pm@partnerfirm.com", from: "pm@partnerfirm.com", from_name: "Partner PM" });
  const sellerOutside = row({ source_message: "o", side: "sell", principal: "Outside Co", principal_email: "x@outsideco.com", from: "x@outsideco.com", from_name: "Outside Person" });

  it("a named same-firm person on another domain counts as Rainmaker", () => {
    expect(pairAllowed(buyer, sellerSameFirm, lists)).toBe(false);
    expect(pairAllowed(buyer, sellerOutside, lists)).toBe(true);
    expect(standingMatches([buyer, sellerSameFirm], new Set(), NOW, lists).picked).toHaveLength(0);
    expect(standingMatches([buyer, sellerOutside], new Set(), NOW, lists).picked).toHaveLength(1);
  });

  it("the grid still shows Rainmaker rows, tagged, and hides ruled-out people entirely", () => {
    const ruled = row({ source_message: "r", principal: "Ruled Out Person", from_name: "Ruled Out Person", from: "ro@elsewhere.com" });
    const grid = buildGrid([buyer, sellerSameFirm, ruled], { identity: ID, lists, now: NOW });
    expect(grid.map((g: any) => g.source_message).sort()).toEqual(["b", "s"]);
    expect(grid.every((g: any) => g.rainmaker === 1)).toBe(true);
    expect(otherSides(grid, lists)).toHaveLength(0);
  });

  it("her own supply is never paired with a Rainmaker colleague, only with outside", () => {
    const yours = row({ source_message: "y", side: "sell", principal: "your client", hers: true });
    const grid = buildGrid([yours, buyer, sellerOutside, row({ source_message: "ob", principal: "Outside Buyer", principal_email: "ob@buyerco.com", from: "ob@buyerco.com", from_name: "Outside Buyer" })], { identity: ID, lists: NO_LISTS, now: NOW });
    const pairs = otherSides(grid, NO_LISTS).filter((p: any) => p.deal.side === "yours");
    expect(pairs).toHaveLength(1);
    expect(pairs[0].hits.map((h: any) => h.source_message)).toEqual(["ob"]);
  });
});

describe("morning sections (interface for Builder E)", () => {
  it("deals.json carries new rows and a link to the full grid; monique_found has no 'Nobody' lines", () => {
    const a = row({ source_message: "a1" });
    const b = row({ source_message: "b1", side: "sell", principal: "Seller Co", principal_email: "s@sellerco.com", from: "s@sellerco.com", from_name: "Sam Seller", price_text: "$ 590,000 M" });
    const grid = buildGrid([a, b], { identity: ID, lists: NO_LISTS, now: NOW });
    const deals = morningDeals(grid, grid.length, NOW);
    expect(deals.rows[0]).toMatchObject({ company: "Acme Robotics", side: "Buy", when: "yesterday", url: expect.stringMatching(/^https:\/\/mail\.google\.com\//) });
    expect(deals.rows[0]).not.toHaveProperty("tag");
    expect(deals.rows[0]).toMatchObject({ from_email: "pm@examplefund.com", from_name: "Pat Example", from_firm: "Example Fund", size_usd: 50e6, rainmaker: false });
    expect(deals.more.url).toMatch(/tab=capital&view=grid$/);
    const found = moniqueFound({ newRows: grid, grid, lists: NO_LISTS, found: {} });
    expect(found.decide[0].title).toBe("Make an Acme Robotics intro?");
    expect(found.decide[0].buttons.map((x: any) => x.label)).toContain("Edit, then send");
    const all = JSON.stringify(found);
    expect(all).not.toMatch(/Nobody|npm run|\/api\/|\b[0-9a-f]{16}\b/);
  });
});

describe("sellers who answered her prospect emails join the grid (Builder L)", () => {
  it("turns prospects.json Sell rows into grid Sell rows, minus anyone she ruled out", () => {
    const rows = prospectSellRows({ rows: [
      { company: "—", side: "Sell", from: "Pat Seller, Seller Co", when: "2026-10-20", link: "https://mail.google.com/mail/u/0/#all/t1" },
      { company: "—", side: "Buy", from: "Not A Seller", when: "2026-10-20", link: "https://mail.google.com/mail/u/0/#all/t2" },
      { company: "—", side: "Sell", from: "Ruled Out", when: "2026-10-20", link: "https://mail.google.com/mail/u/0/#all/t3" },
    ] }, { same_firm: [], do_not_suggest: [{ kind: "name", value: "ruled out" }] } as any);
    expect(rows.map((r: any) => [r.side, r.from_text, r.email_url])).toEqual([["sell", "Pat Seller, Seller Co", "https://mail.google.com/mail/u/0/#all/t1"]]);
  });
});

describe("N-PORT: every holder named, partial fills summed (rule 7)", () => {
  const xml = (fund: string, val: number) => `<edgarSubmission><genInfo><regName>${fund} Trust</regName><seriesName>${fund}</seriesName><seriesId>S-${fund}</seriesId><repPdDate>2026-06-30</repPdDate><regPhone>555-0100</regPhone><regCity>Springfield</regCity></genInfo>
    <fundInfo><totAssets>1000000000</totAssets></fundInfo><invstOrSecs><invstOrSec><name>Acme Robotics Inc</name><title>Series F Preferred</title><valUSD>${val}</valUSD><pctVal>1.2</pctVal></invstOrSec></invstOrSecs></edgarSubmission>`;

  it("parses the position and the registrant (the missing assetKey import made every filing unreadable)", () => {
    expect(positionFromXml(xml("Fund A", 120e6), "Acme Robotics")?.valUSD).toBe(120e6);
    expect(genInfoFromXml(xml("Fund A &amp; Co", 1))).toMatchObject({ fund: "Fund A & Co", as_of: "2026-06-30", phone: "555-0100" });
  });

  it("keeps holders far smaller than the block, ranked by size", async () => {
    const vals: Record<string, number> = { a: 120e6, b: 64e6, c: 2e6 };
    const res = await allHolders("Acme Robotics", {
      fresh: true,
      read: async () => ({ filings: Object.keys(vals).map((k) => ({ cik: k, filer: k, accession: k, url: `https://www.sec.gov/${k}`, filed: "2026-07-01" })), total: 3 }),
      fetchXml: async (u: string) => xml(`Fund ${u.slice(-1).toUpperCase()}`, vals[u.slice(-1)] ?? 0),
    });
    expect(res.holders.map((h: any) => h.fund)).toEqual(["Fund A", "Fund B", "Fund C"]);
    expect(res.scanned).toBe(3);
    expect(partialFill(res.holders, 1e9).line).toBe("top 3 hold $186.0M vs your $1.00B");
  });

  it("records what was found for the morning, and the morning line sums it", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "found-")), "found.json");
    const c = recordFound("Acme Robotics", { holders: [{ fund: "Fund A", valUSD: 120e6, url: "https://www.sec.gov/a" }, { fund: "Fund B", valUSD: 64e6, url: "https://www.sec.gov/b" }] }, file);
    const grid = buildGrid([row({})], { identity: ID, lists: NO_LISTS, now: NOW });
    const out = moniqueFound({ newRows: grid, grid, lists: NO_LISTS, found: { "acme robotics": c } });
    expect(out.lines[0]).toBe("For the $50M Acme Robotics buyer: 2 funds hold $184M of Acme Robotics between them vs the $50M buyer. Biggest: Fund A $120M, Fund B $64M.");
  });
});

describe("her plain-words edits (rules 6, 15)", () => {
  it("reads add and remove for both lists, and ignores quoted and forwarded text", () => {
    const e = parseListEdits("Hi\nAlex Example at Example Ventures (alex@exampleventures.com) is Rainmaker.\nstop suggesting Robin Sample\ntake Jo Doe off the Rainmaker list\n---------- Forwarded message ---------\nKim is Rainmaker");
    expect(e.map((x) => `${x.list}:${x.action}:${x.kind}:${x.value}`)).toEqual([
      "same_firm:add:email:alex@exampleventures.com",
      "do_not_suggest:add:name:robin sample",
      "same_firm:remove:name:jo doe",
    ]);
    expect(parseListEdits("We are Rainmaker\n> stop suggesting Someone")).toEqual([]);
  });
});
