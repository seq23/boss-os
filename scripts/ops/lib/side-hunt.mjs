/**
 * THE WEEKLY OTHER-SIDE EMAIL, BOTH WAYS ROUND (owner, 1 Nov 2026, "the brokerage week").
 *
 *   Tuesday 07:00 Central  "Buyers for what you're selling"          (her sell orders, side = "buy")
 *   Thursday 07:00 Central "Sellers for what your LPs want to buy"   (her buy orders,  side = "sell")
 *
 * `side` is always the side being HUNTED, the convention `buyer-hunt.mjs` and `filing-hunt.mjs`
 * already use. One code path, inverted, so the two emails can never drift into two ideas of a match.
 *
 * Two sources, two calm sections, in this order:
 *   1. People in your own mail: rows in the inbox records (`ledger.json`) where someone said they
 *      want / hold the company. Ranked by `assignedSearch` (inside the ~6-month window, fresher first,
 *      capacity against her size), then held to the price rule below.
 *   2. Funds that report holding it: the free public SEC fund filings, read by `filing-hunt.mjs`.
 *
 * THE MATCH IS ON OVERLAP, NOT EQUALITY. A $100M seller can fill a $15M buy, and a $5M seller fills
 * a third of it: both are listed, with what they fill said in words. A price more than
 * `DEFAULT_TOLERANCE` apart drops out, the deal grid's own rule; an unknown price stays ("worth
 * asking"). Older orders of hers rank lower and an order past the lookback is not hunted at all.
 *
 * NOTHING HERE IS A DECIDE ITEM (the ⭐ rule, 25 Oct 2026: "matches never go to Decide"). These are
 * lists for her to read. Nobody is contacted, nothing calls a model, nothing spends.
 *
 * RULE 0: a source that failed says so in its own section, plainly, and the run reports it.
 */
import { assignedSearch, assetKey } from "../interest-match.mjs";
import { priceGap, DEFAULT_TOLERANCE, STALE_DAYS } from "../../../src/shared/boss/deals/match.mjs";
import { withinLookback } from "../../../src/shared/boss/capital/partyLists.mjs";

const DAY = 86_400_000;
/** Per company, so the email stays short enough to read on a phone. */
export const MAX_PEOPLE = 5;
export const MAX_FUNDS = 5;

export const huntTitle = (side) => (side === "sell" ? "Sellers for what your LPs want to buy" : "Buyers for what you're selling");

export const money = (n) => (n == null || !(Number(n) > 0) ? null
  : n >= 1e9 ? `$${(n / 1e9).toFixed(n % 1e9 ? 1 : 0)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : `$${Math.round(n).toLocaleString("en-US")}`);

const ageDaysOf = (date, now) => {
  const t = Date.parse(String(date ?? ""));
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null;
};
const agoWords = (d) => (d == null ? "date unknown" : d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);

/**
 * Her orders on one side, newest first. An order with a date older than the ~6-month lookback is
 * dropped (it lives in the Archive view); one with no date (her emailed book) stays, last.
 */
export function orderLots(lots, now = Date.now()) {
  return (lots ?? [])
    .filter((l) => !l.received_on || withinLookback(l.received_on, now))
    .map((l) => ({ ...l, ageDays: ageDaysOf(l.received_on, now) }))
    .sort((a, b) => (a.ageDays ?? Infinity) - (b.ageDays ?? Infinity));
}

/** "can fill all of your $15M" / "fills about a third of your $15M" / "size not said". Overlap, never equality. */
export function fillWords(theirs, yours) {
  const t = Number(theirs) || 0, y = Number(yours) || 0;
  if (!t) return "size not said, worth asking";
  if (!y) return `${money(t)}`;
  if (t >= y) return `${money(t)}, enough for all of your ${money(y)}`;
  const pct = Math.round((t / y) * 100);
  return `${money(t)}, about ${pct}% of your ${money(y)}`;
}

/**
 * People in her own mail on the hunted side of this company. `rows` are inbox records already
 * cleaned of wrong rows and her own firm's colleagues. Price far apart drops out; the rest keep
 * `assignedSearch`'s order with a closer price first among equals.
 */
export function peopleFor(rows, lot, side, { suppressed = new Set(), now = Date.now(), max = MAX_PEOPLE } = {}) {
  const hits = assignedSearch(rows, lot.asset, side, Number(lot.size_usd) || 0, suppressed, now)
    .filter((h) => h.row?.quote || h.row?.evidence);
  const out = [];
  for (const h of hits) {
    const theirs = { price_text: h.row.price_text };
    const mine = { price_text: lot.price_text };
    const g = side === "buy" ? priceGap(theirs, mine) : priceGap(mine, theirs);
    if (g && g.gap > DEFAULT_TOLERANCE) continue;
    const price = g ? (g.gap <= 0.1 ? "prices close" : "prices near") : "price not known on one side, worth asking";
    out.push({ ...h, gap: g ? g.gap : null, price, fill: fillWords(h.row.size_usd, lot.size_usd) });
  }
  // Stable: assignedSearch's ranking stands; a known close price only breaks a tie.
  return out.slice(0, max);
}

/** Funds from the filings, best first: those that can cover it, then partial, then unverified. */
export function fundsFor(filings, { max = MAX_FUNDS } = {}) {
  const rank = { COMFORTABLY: 3, PLAUSIBLY: 2, UNVERIFIED: 1, NO: 0 };
  return [...(filings?.holders ?? [])]
    .sort((a, b) => (rank[b.capacity?.verdict] ?? 0) - (rank[a.capacity?.verdict] ?? 0) || (Number(b.valUSD) || 0) - (Number(a.valUSD) || 0))
    .filter((h) => h.capacity?.verdict !== "NO")
    .slice(0, max);
}

const VERDICT = {
  buy: { COMFORTABLY: "could easily take all of it", PLAUSIBLY: "could take it, as a real decision for them", UNVERIFIED: "size of the fund not stated" },
  sell: { COMFORTABLY: "holds enough for all of it", PLAUSIBLY: "holds part of it", UNVERIFIED: "amount held not readable" },
};

const lotLine = (lot, side) => {
  const size = money(lot.size_usd) ?? (lot.size_text || "size not set");
  const verb = side === "sell" ? "your LP wants" : "you're selling";
  const age = lot.ageDays == null ? "" : lot.ageDays > STALE_DAYS ? `, an older order (${agoWords(lot.ageDays)})` : `, ${agoWords(lot.ageDays)}`;
  return `${lot.asset}: ${verb} ${size}${age}`;
};

/**
 * The email, as `layoutEmail` input: a one-line summary, then the two sections. Pure.
 *
 * `hunts` is `[{ lot, people: { hits, error? }, funds: { holders, error?, total?, scanned? } }]`.
 * `failed` lists each source that could not be read, for the run's own exit status.
 */
export function buildHuntEmail({ side, hunts, now = Date.now() }) {
  const title = huntTitle(side);
  const dateWords = new Date(now).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Chicago" });
  const failed = [];
  const peopleItems = [];
  const fundItems = [];
  let nPeople = 0, nFunds = 0;
  for (const { lot, people, funds } of hunts) {
    const head = lotLine(lot, side);
    if (people.error) {
      failed.push(`people: ${people.error}`);
      peopleItems.push(`${head}. This part did not run this week: ${people.error}. It tries again next week.`);
    } else if (!people.hits.length) {
      peopleItems.push(`${head}. Nobody in your mail from the last six months ${side === "sell" ? "has offered" : "has asked for"} it at a price near yours.`);
    } else {
      for (const h of people.hits) {
        nPeople += 1;
        const r = h.row;
        const who = [r.principal, r.intermediated_by ? `via ${r.intermediated_by}` : null].filter(Boolean).join(", ");
        const said = String(r.quote ?? r.evidence ?? "").replace(/\s+/g, " ").slice(0, 160);
        peopleItems.push({
          text: `${head}. ${who} ${side === "sell" ? "has" : "wants"} ${h.fill}; ${h.price}; said ${agoWords(h.ageDays)}: "${said}"`,
          links: r.email_url ? [{ label: "Open their email", url: r.email_url }] : [],
        });
      }
    }
    if (funds.error) {
      failed.push(`funds: ${funds.error}`);
      fundItems.push(`${head}. This part did not run this week: ${funds.error}. It tries again next week.`);
    } else if (!funds.holders.length) {
      fundItems.push(`${head}. No fund reports a usable position: ${funds.total ?? 0} public fund filings name it, ${funds.scanned ?? 0} were read.`);
    } else {
      for (const h of funds.holders) {
        nFunds += 1;
        const name = h.fund ?? h.filer;
        const mgr = h.manager && h.manager !== name ? ` (${h.manager})` : "";
        fundItems.push({
          text: `${head}. ${name}${mgr} holds ${money(h.valUSD) ?? "an amount not stated"}${h.as_of ? ` as of ${h.as_of}` : ""}: ${VERDICT[side][h.capacity?.verdict] ?? "worth a look"}${h.contact ? `. Phone: ${h.contact}` : ""}`,
          links: h.url ? [{ label: "The filing", url: h.url }] : [],
        });
      }
    }
  }
  const names = hunts.length;
  const happened = hunts.length
    ? `${title}, ${dateWords}: ${names} ${names === 1 ? "company" : "companies"}, ${nPeople} ${nPeople === 1 ? "person" : "people"} you know and ${nFunds} ${nFunds === 1 ? "fund" : "funds"} worth a look. Nobody has been contacted.`
    : `${title}, ${dateWords}: you have no ${side === "sell" ? "buy" : "sell"} orders from the last six months, so there was nothing to look for. All clear this week.`;
  const sections = hunts.length ? [
    { title: side === "sell" ? "People you know who have it" : "People you know who want it", note: "From your own email, the last six months. Their size and price against yours.", items: peopleItems, empty: null },
    { title: "Funds that hold it", note: "From public SEC fund filings. Free to read; a filing shows the fund holds it, not that it will trade.", items: fundItems, empty: null },
  ] : [];
  return { subject: title, layout: { happened, decide: [], sections }, failed };
}

export { assetKey };
