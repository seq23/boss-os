/**
 * THE BROKERAGE WEEK (owner, 1 Nov 2026). Code names only: no LP, buyer, seller or deal names.
 *
 *   - Tuesday 07:00 "Buyers for what you're selling" and Thursday 07:00 "Sellers for what your LPs
 *     want to buy": one code path (scripts/ops/lib/side-hunt.mjs), the side inverted; two calm
 *     sections; a failed source says so (Rule 0); never a Decide item.
 *   - Size matches on OVERLAP, not equality; price within the grid tolerance; older orders lower;
 *     ~6-month lookback.
 *   - Prospect emails go Monday to Friday, Central, only; one follow-up.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- untyped node script
import { orderLots, peopleFor, fundsFor, fillWords, buildHuntEmail, huntTitle } from "../scripts/ops/lib/side-hunt.mjs";
import { isSendDay } from "../scripts/ops/lp-prospects.mjs";
import { MAX_TOUCHES } from "../src/shared/boss/lp/plan.mjs";
import { plainProblems, layoutEmail } from "../src/shared/boss/mail/plain.mjs";

const ROOT = join(__dirname, "..");
const NOW = Date.parse("2026-11-05T13:00:00Z"); // a Thursday, 07:00 Central
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);

const row = (o: Record<string, unknown>) => ({
  asset: "Acme", side: "sell", principal: "Broker One", principal_email: "one@broker-a.example",
  size_usd: 100e6, price_text: null, quote: "we hold Acme and can move a block", confidence: "high",
  date: day(10), source_message: "m-1", ...o,
});

describe("Thursday: sellers for what your LPs want to buy", () => {
  it("matches on overlap: a $100M seller fills a $15M buy, a $5M seller is a partial fill", () => {
    const lot = { asset: "Acme", size_usd: 15e6, price_text: null };
    const hits = peopleFor([row({}), row({ principal: "Broker Two", principal_email: "two@broker-b.example", size_usd: 5e6, source_message: "m-2" })], lot, "sell", { now: NOW });
    expect(hits.map((h: any) => h.row.principal)).toEqual(["Broker One", "Broker Two"]);
    expect(hits[0].fill).toBe("$100M, enough for all of your $15M");
    expect(hits[1].fill).toBe("$5M, about 33% of your $15M");
  });

  it("drops a seller whose price is far from the buy, keeps one whose price is unknown", () => {
    const lot = { asset: "Acme", size_usd: 15e6, price_text: "$100/sh" };
    const hits = peopleFor([
      row({ price_text: "$150/sh" }),
      row({ principal: "Broker Two", principal_email: "two@broker-b.example", source_message: "m-2" }),
    ], lot, "sell", { now: NOW });
    expect(hits.map((h: any) => h.row.principal)).toEqual(["Broker Two"]);
    expect(hits[0].price).toMatch(/worth asking/);
  });

  it("only the hunted side, inside the ~6-month window, and never her own rows", () => {
    const lot = { asset: "Acme", size_usd: 15e6 };
    const hits = peopleFor([
      row({ side: "buy" }),
      row({ principal: "Old", principal_email: "old@x.example", date: day(200), source_message: "m-3" }),
      row({ principal: "Hers", principal_email: "me@x.example", hers: true, source_message: "m-4" }),
    ], lot, "sell", { now: NOW });
    expect(hits).toEqual([]);
  });

  it("older orders rank lower and an order past the lookback is not hunted", () => {
    const lots = orderLots([
      { asset: "Old", received_on: day(90) },
      { asset: "New", received_on: day(2) },
      { asset: "Gone", received_on: day(200) },
      { asset: "Book" },
    ], NOW);
    expect(lots.map((l: any) => l.asset)).toEqual(["New", "Old", "Book"]);
  });

  it("funds: those that can cover it first, never one that cannot", () => {
    const f = fundsFor({ holders: [
      { fund: "Fund C", valUSD: 1e6, capacity: { verdict: "NO" } },
      { fund: "Fund B", valUSD: 5e6, capacity: { verdict: "PLAUSIBLY" } },
      { fund: "Fund A", valUSD: 40e6, capacity: { verdict: "COMFORTABLY" } },
    ] });
    expect(f.map((h: any) => h.fund)).toEqual(["Fund A", "Fund B"]);
  });

  it("size words never claim equality", () => {
    expect(fillWords(null, 15e6)).toMatch(/worth asking/);
    expect(fillWords(15e6, 15e6)).toMatch(/enough for all/);
  });
});

describe("one email per side, two calm sections", () => {
  const hunts = (people: any, funds: any) => [{ lot: { asset: "Acme", size_usd: 15e6, ageDays: 2 }, people, funds }];

  for (const side of ["buy", "sell"]) {
    it(`${huntTitle(side)}: two sections, no Decide, passes the plain-email gate`, () => {
      const mail = buildHuntEmail({ side, now: NOW, hunts: hunts(
        { hits: [{ row: row({ email_url: "https://mail.google.com/mail/u/0/#search/rfc822msgid" }), ageDays: 10, fill: "$100M, enough for all of your $15M", price: "prices close" }] },
        { holders: [{ fund: "Fund A", valUSD: 40e6, capacity: { verdict: "COMFORTABLY" }, url: "https://www.sec.gov/Archives/example" }] },
      ) });
      expect(mail.subject).toBe(huntTitle(side));
      expect(mail.layout.decide).toEqual([]);
      expect(mail.layout.sections.map((s: any) => s.title)).toEqual([
        side === "sell" ? "People you know who have it" : "People you know who want it", "Funds that hold it"]);
      expect(mail.failed).toEqual([]);
      const laid = layoutEmail({ who: "Monique", subject: mail.subject, ...mail.layout });
      expect(plainProblems(laid)).toEqual([]);
    });
  }

  it("Rule 0: a source that failed says so in its own section and is reported", () => {
    const mail = buildHuntEmail({ side: "sell", now: NOW, hunts: hunts(
      { hits: [], error: "your email records could not be opened" },
      { holders: [], error: "the public SEC filings could not be read this week" },
    ) });
    const text = JSON.stringify(mail.layout.sections);
    expect(text).toMatch(/This part did not run this week: your email records could not be opened/);
    expect(text).toMatch(/This part did not run this week: the public SEC filings could not be read/);
    expect(mail.failed).toHaveLength(2);
  });

  it("an empty week is said plainly, never a silent nothing", () => {
    const mail = buildHuntEmail({ side: "sell", now: NOW, hunts: [] });
    expect(mail.layout.happened).toMatch(/no buy orders from the last six months/);
    expect(mail.failed).toEqual([]);
  });

  /*
   * THE NEGATIVE PROOF: a hunt whose sources both failed is NOT allowed to read like a quiet week.
   * The email built from failed sources differs from the one built from empty sources, and only the
   * failed one is reported.
   */
  it("negative proof: 'found nobody' and 'never ran' never render the same", () => {
    const empty = buildHuntEmail({ side: "sell", now: NOW, hunts: hunts({ hits: [] }, { holders: [], total: 4, scanned: 4 }) });
    const broken = buildHuntEmail({ side: "sell", now: NOW, hunts: hunts({ hits: [], error: "x" }, { holders: [], error: "y" }) });
    expect(JSON.stringify(empty.layout.sections)).not.toEqual(JSON.stringify(broken.layout.sections));
    expect(empty.failed).toEqual([]);
    expect(broken.failed.length).toBeGreaterThan(0);
  });
});

describe("the week is wired", () => {
  const installer = readFileSync(join(ROOT, "scripts/ops/install-agent-launchd.sh"), "utf8");
  it("Tuesday sends one email; Thursday runs seller-hunt.mjs at 07:00 on weekday 4", () => {
    expect(installer).toMatch(/duty-run\.sh buyer-hunt\.mjs -- npm run --silent capital:buyers -- --send --email/);
    const thu = /SELLERS_LABEL="com\.seq\.boss-capital-sellers"[\s\S]*?\nSELLERSEOF\n/.exec(installer)?.[0] ?? "";
    expect(thu).toMatch(/duty-run\.sh seller-hunt\.mjs -- npm run --silent capital:sellers -- --send --email/);
    expect(thu).toMatch(/<key>Weekday<\/key><integer>4<\/integer><key>Hour<\/key><integer>7<\/integer><key>Minute<\/key><integer>0<\/integer>/);
  });
  it("the Thursday duty is Monique's, weekly on Thursday at 07:00", () => {
    const sql = readFileSync(join(ROOT, "migrations/0328_boss_the_brokerage_week.sql"), "utf8");
    expect(sql).toMatch(/'duty_seller_hunt',[\s\S]*?'emp_relationship', 'ops',\s*7, 0, 'America\/Chicago', 'weekly', 4,/);
    expect(sql).toMatch(/'local_job', 'seller-hunt\.mjs'/);
  });
  it("prospect emails: weekdays only on the Mac job, one follow-up", () => {
    const line = installer.split("\n").find((l) => l.startsWith("install_l_job com.seq.boss-prospects ")) ?? "";
    expect(line).toMatch(/for d in 1 2 3 4 5/);
    expect(MAX_TOUCHES).toBe(2);
    expect(isSendDay(Date.parse("2026-11-07T15:30:00Z"))).toBe(false); // Saturday 09:30 Central
    expect(isSendDay(Date.parse("2026-11-08T15:30:00Z"))).toBe(false); // Sunday
    expect(isSendDay(Date.parse("2026-11-09T15:30:00Z"))).toBe(true); // Monday
    // Late Friday night UTC is still Friday in Chicago; early Saturday UTC is Friday evening there.
    expect(isSendDay(Date.parse("2026-11-07T03:00:00Z"))).toBe(true);
  });
  it("no description anywhere still says two follow-ups", () => {
    const manifest = readFileSync(join(ROOT, "src/shared/boss/emailMap/manifest.json"), "utf8");
    const doc = readFileSync(join(ROOT, "docs/OUTBOUND_EMAIL_MAP.md"), "utf8");
    for (const t of [manifest, doc]) expect(t).not.toMatch(/two follow-ups/);
  });
});
