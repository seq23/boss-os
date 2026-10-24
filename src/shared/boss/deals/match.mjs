/**
 * BUY MEETS SELL — SIZE AND PRICE (owner, 24 Oct 2026, via the main session).
 *
 * "Matching must account for SIZE and PRICE, partial fills included: a $100M seller can fill a $15M
 * buyer, and several small orders can stack against one big one. Price: compare price/valuation;
 * match when the gap is within a tolerance, show the gap in words, and rank closest first. If one
 * side has no price, show it as 'price unknown — worth asking' lower down."
 *
 * Pure, so the Mac (Monique's deal reader), the morning email and the Matches screen use one rule.
 * Who MAY be matched (never Rainmaker↔Rainmaker, her do-not-suggest list) is decided by the caller
 * (`pairAllowed`, src/shared/boss/capital/partyLists.mjs) before a pair reaches here.
 */

/** An order older than this may no longer be live: flagged, and its note asks first. */
export const STALE_DAYS = 60;
/** Older than her ~6-month lookback: off the email, kept on the Matches screen as "old". */
export const OLD_DAYS = 183;
const DAY = 86_400_000;

/** Days since the source email, from "YYYY-MM-DD". */
export function ageDays(receivedOn, now = Date.now()) {
  const t = Date.parse(`${String(receivedOn ?? "").slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / DAY));
}
/** "today", "yesterday", "3 days ago", "5 weeks ago", "2 months ago". */
export function ageWords(receivedOn, now = Date.now()) {
  const d = ageDays(receivedOn, now);
  if (d === null) return "date unknown";
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

/** The default price tolerance: two sides at most this far apart match. */
export const DEFAULT_TOLERANCE = 0.15;
/** What the Matches screen offers. */
export const TOLERANCES = Object.freeze([0.05, 0.1, 0.15, 0.2, 0.3]);

const UNIT = { t: 1e12, tn: 1e12, trillion: 1e12, b: 1e9, bn: 1e9, billion: 1e9, m: 1e6, mm: 1e6, million: 1e6, k: 1e3 };

/**
 * A price as `{ kind: "share" | "valuation", value }`, or `null` when the words carry none.
 * "$197.29/sh" and "$4/share net" are per share; "$1.4T valuation" and "$188bn" are valuations.
 */
export function parsePrice(text) {
  const t = String(text ?? "").replace(/,/g, "");
  if (!t.trim() || t.trim() === "—") return null;
  const share = /\$\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(?:sh|share)\b|per\s+share|pps\b|a share)/i.exec(t);
  if (share) return { kind: "share", value: Number(share[1]) };
  const val = /\$\s*(\d+(?:\.\d+)?)\s*(trillion|billion|million|tn|bn|mm|t|b|m)\b/i.exec(t);
  if (val) return { kind: "valuation", value: Number(val[1]) * UNIT[val[2].toLowerCase()] };
  const bare = /\$\s*(\d+(?:\.\d+)?)(?!\s*[a-z%])/i.exec(t);
  if (bare && Number(bare[1]) < 100000) return { kind: "share", value: Number(bare[1]) };
  return null;
}

/** "$1.4T", "$197.29", "$15M". */
export function moneyShort(n, kind = "valuation") {
  if (kind === "share") return `$${Number(n).toFixed(Number(n) >= 100 ? 0 : 2).replace(/\.00$/, "")}`;
  const v = Number(n);
  if (v >= 1e12) return `$${+(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${+(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${+(v / 1e6).toFixed(1)}M`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

/** The gap between a seller's ask and a buyer's bid, as a fraction of the higher. `null` if not comparable. */
export function priceGap(buyer, seller) {
  const b = parsePrice(buyer?.price_text);
  const s = parsePrice(seller?.price_text);
  if (!b || !s || b.kind !== s.kind || !(b.value > 0) || !(s.value > 0)) return null;
  return { gap: Math.abs(s.value - b.value) / Math.max(s.value, b.value), ask: s, bid: b };
}

/** "seller asks $1.4T, buyer bids $1.25T: 11% apart" — or why it cannot be said. */
export function gapWords(buyer, seller) {
  const g = priceGap(buyer, seller);
  if (g) {
    const pct = Math.round(g.gap * 100);
    const unit = g.ask.kind === "share" ? " a share" : " valuation";
    return `seller asks ${moneyShort(g.ask.value, g.ask.kind)}${unit}, buyer bids ${moneyShort(g.bid.value, g.bid.kind)}${unit}: ${pct === 0 ? "the same price" : `${pct}% apart`}`;
  }
  if (!parsePrice(buyer?.price_text) && !parsePrice(seller?.price_text)) return "price unknown on both sides — worth asking";
  if (!parsePrice(buyer?.price_text)) return "buyer's price unknown — worth asking";
  if (!parsePrice(seller?.price_text)) return "seller's price unknown — worth asking";
  return "prices are in different terms (per share against valuation) — worth asking";
}

/** What one side fills of the other: "fills $15M of their $100M". */
export function fillWords(order, other) {
  const a = Number(order?.size_usd) || 0;
  const b = Number(other?.size_usd) || 0;
  if (!a || !b) return "size unknown on one side";
  const fill = Math.min(a, b);
  if (a === b) return `fills all ${moneyShort(fill)}`;
  return a < b ? `fills all ${moneyShort(a)} of this order (they have ${moneyShort(b)})` : `fills ${moneyShort(fill)} of this ${moneyShort(a)} order`;
}

/**
 * Every opposite order that could fill `deal`, ranked: priced and within tolerance closest first,
 * then "price unknown — worth asking"; priced and further apart than the tolerance are left out.
 * `stack`: how much of the deal the ranked orders fill together, in order, until it is full.
 */
export function rankMatches(deal, candidates, { tolerance = DEFAULT_TOLERANCE, now = Date.now() } = {}) {
  const buyerOf = (o) => (deal.direction === "buy" ? deal : o);
  const sellerOf = (o) => (deal.direction === "buy" ? o : deal);
  const rows = [];
  for (const o of candidates) {
    const g = priceGap(buyerOf(o), sellerOf(o));
    if (g && g.gap > tolerance) continue;
    const ages = [ageDays(deal.received_on, now), ageDays(o.received_on, now)].map((d) => d ?? 0);
    const oldest = Math.max(...ages);
    rows.push({
      other: o, gap: g ? g.gap : null, priced: Boolean(g),
      gap_words: gapWords(buyerOf(o), sellerOf(o)), fill_words: fillWords(deal, o),
      age_words: `seller: ${ageWords(sellerOf(o).received_on, now)} · buyer: ${ageWords(buyerOf(o).received_on, now)}`,
      oldest_days: oldest, stale: oldest > STALE_DAYS, old: oldest > OLD_DAYS,
    });
  }
  // Priced and close first, then "price unknown — worth asking"; inside each, live before stale,
  // then the closest price, then the freshest, then the biggest.
  rows.sort((a, b) => (a.priced !== b.priced ? (a.priced ? -1 : 1)
    : a.old !== b.old ? (a.old ? 1 : -1)
    : a.stale !== b.stale ? (a.stale ? 1 : -1)
    : (a.gap ?? 0) - (b.gap ?? 0) || a.oldest_days - b.oldest_days || (Number(b.other.size_usd) || 0) - (Number(a.other.size_usd) || 0)));
  const size = Number(deal.size_usd) || 0;
  let filled = 0;
  let used = 0;
  for (const r of rows.filter((x) => !x.old)) { if (size && filled >= size) break; filled += Number(r.other.size_usd) || 0; used++; }
  const stack = size && used > 1 ? `${used} orders together fill ${moneyShort(Math.min(filled, size))} of the ${moneyShort(size)}` : null;
  return { matches: rows, stack };
}
