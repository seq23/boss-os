#!/usr/bin/env node
/**
 * THE DEAL GRID — every buy and sell in her inbox as one row, and what Monique found for them.
 *
 * Owner, 23 Oct 2026 (contract rules 5–9). Her inbox review found the deal emails unranked, "11
 * people" that were mostly "Nobody", her own address listed as a broker, "Unnamed buyer of Sequoia
 * Taylor" (her own name parsed as a counterparty) and a price printed as "$1,484,000 M". This file is
 * the one place a ledger row becomes something she reads:
 *
 *   - ONE ROW PER DEAL: company, side (Buy / Sell / Yours), size, price or valuation, structure and
 *     fees, from (person and firm), when, and a real Gmail link. Only what the email says; anything
 *     unclear is "—", and a price that cannot be right is "—" rather than printed.
 *   - "YOURS" is her own supply and demand: what she posts to rrlist@, and any row where she is the
 *     one representing the client. Her addresses and her name are NEVER a counterparty or a broker.
 *   - ~6 MONTHS (owner, 23 Oct: "rough 6 month cut off"): `LOOKBACK_DAYS` in partyLists.mjs. Older
 *     rows drop out of the grid and out of matching, hers included.
 *   - Rainmaker x Rainmaker is never suggested; anybody on her do-not-suggest list never appears.
 *
 * WHERE IT GOES. No email. The morning sections `~/.boss-os/morning/deals.json` and
 * `monique_found.json` (Simone's 06:40 email renders them), and the full grid to the Deals page
 * through `POST /api/boss/capital/deals`. The grid is the Deals page she asked for (rule 5), so the
 * rows cross to D1 by her decision of 23 Oct 2026; the interest ledger itself stays on this Mac.
 *
 *   npm run capital:grid                 # build, write the morning sections, push the grid
 *   npm run capital:grid -- --dry-run    # print what it would write; touch nothing
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { writeMorningSection } from "../../src/shared/boss/mail/morning.mjs";
import { rankMatches, ageWords, moneyShort, parsePrice, DEFAULT_TOLERANCE, STALE_DAYS } from "../../src/shared/boss/deals/match.mjs";
import {
  FIRM_DOMAIN, LOOKBACK_DAYS, withinLookback, withinArchive, isSameFirm, isDoNotSuggest, pairAllowed,
} from "../../src/shared/boss/capital/partyLists.mjs";

export { LOOKBACK_DAYS, withinLookback };

const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
const MORNING_DIR = process.env.BOSS_OS_MORNING_DIR ?? path.join(os.homedir(), ".boss-os", "morning");
export const MAILBOX = process.env.BROKERAGE_MAILBOX ?? "staylor@spry.vc";
export const RRLIST = (process.env.RRLIST_ADDRESS ?? `rrlist@${FIRM_DOMAIN}`).toLowerCase();
const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
export const DEALS_PAGE = `${ORIGIN}/?tab=capital&view=grid`;
export const HOLDERS_PAGE = `${ORIGIN}/?tab=capital&view=holders`;
export const MATCHES_PAGE = `${ORIGIN}/?tab=capital&view=matches`;

// ─── Who she is ──────────────────────────────────────────────────────────────

/**
 * HER IDENTITY, SO SHE IS NEVER HER OWN COUNTERPARTY. The three addresses below were already in
 * interest-extract.mjs; her firm address and any others live in `~/.boss-os/capital/self.json`
 * ({ "names": [], "addresses": [] }) on her Mac, never in this public repo. An address on her firm's
 * domain with the same local part as one of hers is hers too, so her Rainmaker address is caught
 * without being written down here.
 */
const BUILTIN_SELF = {
  names: ["Sequoia Taylor"],
  addresses: ["staylor@spry.vc", "sequoia@westpeek.ventures", "seq.taylor@gmail.com"],
};

export function loadIdentity(file = path.join(DIR, "self.json")) {
  let extra = {};
  try { extra = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* optional */ }
  const names = [...BUILTIN_SELF.names, ...(extra.names ?? [])].map((n) => String(n).trim()).filter(Boolean);
  const addresses = [...BUILTIN_SELF.addresses, ...(extra.addresses ?? [])].map((a) => String(a).toLowerCase().trim()).filter(Boolean);
  return { names, addresses };
}

const localPart = (a) => String(a ?? "").toLowerCase().split("@")[0];
const domainOf = (a) => String(a ?? "").toLowerCase().split("@")[1] ?? "";

/** Is this address hers? Exact, or her local part on her firm's domain or one of her own domains. */
export function isHerAddress(addr, id) {
  const a = String(addr ?? "").toLowerCase().trim();
  if (!a.includes("@")) return false;
  if (id.addresses.includes(a)) return true;
  const mine = new Set(id.addresses.map(localPart));
  const myDomains = new Set([FIRM_DOMAIN, ...id.addresses.map(domainOf)]);
  return mine.has(localPart(a)) && myDomains.has(domainOf(a));
}

/** Does this text name her — by display name or by one of her addresses? */
export function mentionsHer(text, id) {
  const t = String(text ?? "");
  if (!t) return false;
  if (id.names.some((n) => new RegExp(`\\b${n.replace(/\s+/g, "\\s+")}\\b`, "i").test(t))) return true;
  return (t.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []).some((a) => isHerAddress(a, id));
}

/**
 * Is this ledger row hers? She wrote it (sender), she is named as the principal or as the one
 * representing the client ("unnamed client of Sequoia Taylor"), or it went to rrlist@ from her.
 */
export function isHers(row, id) {
  if (row.hers === true) return true;
  if (isHerAddress(row.from, id) || mentionsHer(row.from_name, id)) return true;
  if (isHerAddress(row.principal_email, id) || mentionsHer(row.principal, id)) return true;
  if (isHerAddress(row.intermediated_by, id) || mentionsHer(row.intermediated_by, id)) return true;
  return false;
}

// ─── What a row says, in plain words ─────────────────────────────────────────

const UNIT = { k: 1e3, m: 1e6, mm: 1e6, b: 1e9, bn: 1e9, t: 1e12, tn: 1e12 };
/** No private company is worth more than this; a figure above it is a parse, not a price. */
const MAX_VALUATION = 3e12;
const MAX_SHARE_PRICE = 1e5;
const MAX_BLOCK = 50e9;

export function moneyWords(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const fmt = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1).replace(/\.0$/, "") : x.toFixed(2).replace(/\.?0+$/, ""));
  if (n >= 1e12) return `$${fmt(n / 1e12)}T`;
  if (n >= 1e9) return `$${fmt(n / 1e9)}B`;
  if (n >= 1e6) return `$${fmt(n / 1e6)}M`;
  if (n >= 1e3) return `$${fmt(n / 1e3)}K`;
  return `$${n.toFixed(2)}`;
}

/**
 * THE PRICE, OR "—". Never an absurd number. The order system writes valuations in millions with
 * thousands separators ("$ 590,000 M" is $590B); the same system once wrote "$ 1,484,000 M", which
 * she could not trust, so a trillion-plus figure written in millions is left blank rather than
 * guessed. Anything above $3T, a per-share price above $100,000, or text with no number is "—".
 */
export function priceWords(text) {
  const s = String(text ?? "").trim();
  if (!s) return "—";
  // Fees written where a price belongs ("35/0/0 incl 1%") are structure, not a price.
  if (/\b\d{1,2}\/\d{1,2}\/\d{1,2}\b/.test(s) && !/\$/.test(s)) return "—";
  const nums = [...s.matchAll(/\$?\s*([\d][\d,]*(?:\.\d+)?)\s*(tn|bn|mm|[kmbt])?\b/gi)];
  if (nums.length === 0) return "—";
  for (const m of nums) {
    const n = Number(m[1].replace(/,/g, ""));
    const unit = (m[2] ?? "").toLowerCase();
    const v = n * (UNIT[unit] ?? 1);
    if (!Number.isFinite(v)) return "—";
    if (v > MAX_VALUATION) return "—";
    if (unit === "m" || unit === "mm") { if (v >= 1e12) return "—"; }
  }
  const only = /^\$?\s*([\d][\d,]*(?:\.\d+)?)\s*(tn|bn|mm|[kmbt])?\s*$/i.exec(s);
  if (only) {
    const n = Number(only[1].replace(/,/g, ""));
    const unit = (only[2] ?? "").toLowerCase();
    if (!unit) return n > MAX_SHARE_PRICE ? (n >= 1e9 ? `${moneyWords(n)} valuation` : "—") : `$${n % 1 ? n.toFixed(2) : n} a share`;
    const v = n * UNIT[unit];
    return v >= 1e9 ? `${moneyWords(v)} valuation` : moneyWords(v);
  }
  return s.length <= 48 ? s.replace(/\s+/g, " ") : "—";
}

export function sizeWords(row) {
  const usd = Number(row.size_usd) || 0;
  if (usd > MAX_BLOCK) return "—";
  if (usd > 0) return moneyWords(usd);
  const sh = Number(row.size_shares) || 0;
  if (sh > 0) return `${Math.round(sh).toLocaleString("en-US")} shares`;
  return "—";
}

/** Fees and structure the email states: "8/0/5", SPV, direct, forward, share class, layer. */
export function structureWords(row) {
  if (row.structure_text) return String(row.structure_text).slice(0, 60);
  const q = `${row.quote ?? ""} ${row.price_text ?? ""}`;
  const bits = [];
  const fee = /\b\d{1,2}\/\d{1,2}\/\d{1,2}\b/.exec(q)?.[0];
  if (fee) bits.push(fee);
  for (const [re, w] of [[/\bSPV\b/i, "SPV"], [/\bdirect\b/i, "direct"], [/\bforward\b/i, "forward"],
    [/\bpreferred\b/i, "preferred"], [/\bcommon\b/i, "common"], [/\bL[12]\b/, (m) => m], [/\bLP swap\b/i, "LP swap"]]) {
    const m = re.exec(q);
    if (m) bits.push(typeof w === "function" ? w(m[0]) : w);
  }
  return bits.length ? [...new Set(bits)].join(" · ") : "—";
}

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"]);

/** A firm's name from its domain: "Rainmaker" for her own, else the domain's name, title-cased. */
export function firmOf(addr) {
  const d = domainOf(addr);
  if (!d || FREE_MAIL.has(d)) return "";
  if (d === FIRM_DOMAIN) return "Rainmaker";
  const sld = d.split(".").slice(-2, -1)[0] ?? d;
  // "sternventures" → "Stern Ventures": split a known trailing word off the domain name.
  const SUFFIX = /^(.+?)(ventures|venture|capital|partners|securities|group|advisors|advisers|holdings|funds|fund|investments|management|labs|global|equity|assets|asset|wealth|family|office|markets)$/i;
  const words = [];
  let rest = sld;
  for (let m = SUFFIX.exec(rest); m && m[1].length >= 2; m = SUFFIX.exec(rest)) { words.unshift(m[2]); rest = m[1]; }
  words.unshift(rest);
  return words.map((w, i) => (i === 0 && w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

const nameFromAddress = (a) => localPart(a).split(/[._-]/).filter((p) => p.length > 1)
  .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

const unnamed = (p) => !p || /\b(unnamed|undisclosed|anonymous|a client|client of|buyer|seller)\b/i.test(String(p));

/** Who it came from, as person and firm. Her own rows say "You". */
export function fromWords(row, hers) {
  if (hers) return "You";
  const addr = row.from && !row.outbound ? row.from : (row.intermediated_by || row.principal_email || "");
  const person = row.from_name || (unnamed(row.principal) ? "" : String(row.principal)) || (addr ? nameFromAddress(addr) : "");
  const firm = firmOf(addr || row.principal_email);
  const out = [person, firm].filter(Boolean);
  if (out.length === 2 && out[0].toLowerCase().includes(out[1].toLowerCase())) return out[0];
  return out.join(", ") || "—";
}

/** A Gmail link that opens the message itself in her brokerage mailbox. Never a bare id. */
export const gmailUrl = (id, mailbox = MAILBOX) =>
  `https://mail.google.com/mail/u/${encodeURIComponent(mailbox)}/#all/${encodeURIComponent(String(id))}`;

const SIDE_LABEL = { buy: "Buy", sell: "Sell", yours: "Yours" };
/** Her own deals, one wording everywhere (owner, 24 Oct 2026): email, grid and Matches screen. */
export const yoursLabel = (direction) => (direction === "buy" ? "Yours: buyer" : direction === "sell" ? "Yours: seller" : "Yours: side unclear — open the email");

/** One ledger interest → one grid row. */
export function gridRow(r, { identity, lists, mailbox = MAILBOX }) {
  const hers = isHers(r, identity);
  const side = hers ? "yours" : r.side;
  const company = String(r.asset ?? "").trim();
  const id = createHash("sha256").update(`${r.source_message}|${r.side}|${company.toLowerCase()}|${r.size_usd ?? r.size_shares ?? ""}`).digest("hex").slice(0, 24);
  const parties = [r.principal, r.principal_email, r.intermediated_by, r.from, r.from_name]
    .filter(Boolean).map((s) => String(s).toLowerCase()).join(" | ").slice(0, 600);
  return {
    id,
    company,
    side,
    direction: r.side,
    size_usd: Number(r.size_usd) > 0 && Number(r.size_usd) <= MAX_BLOCK ? Number(r.size_usd) : null,
    size_text: sizeWords(r),
    price_text: priceWords(r.price_text),
    structure_text: structureWords(r),
    from_text: fromWords(r, hers),
    rainmaker: hers || isSameFirm(r, lists) ? 1 : 0,
    received_on: String(r.date ?? "").slice(0, 10),
    email_url: r.source_message ? gmailUrl(r.source_message, mailbox) : null,
    parties: hers ? "" : parties,
    source_message: r.source_message,
    _row: r,
  };
}

/**
 * The grid: inside the lookback, not struck as wrong, nobody on her do-not-suggest list, one row per
 * deal (the same company, side, size and sender on one day is one deal however many mails said it).
 */
export function buildGrid(interests, { identity, lists, senders = {}, wrong = new Set(), now = Date.now(), mailbox = MAILBOX, archive = false }) {
  const out = new Map();
  for (const raw of interests) {
    if (!raw?.asset || !raw?.side || !raw?.source_message) continue;
    if (wrong.has(raw.source_message)) continue;
    // The main grid is the lookback; `archive: true` builds lookback → twelve months (the Archive view).
    if (archive ? (withinLookback(raw.date, now) || !withinArchive(raw.date, now)) : !withinLookback(raw.date, now)) continue;
    const r = { ...(senders[raw.source_message] ?? {}), ...raw };
    if (isDoNotSuggest(r, lists)) continue;
    const g = gridRow(r, { identity, lists, mailbox });
    const key = `${g.company.toLowerCase()}|${g.side}|${g.direction}|${g.size_text}|${g.from_text}|${g.received_on}`;
    if (!out.has(key)) out.set(key, g);
  }
  return [...out.values()].sort((a, b) => b.received_on.localeCompare(a.received_on) || (b.size_usd ?? 0) - (a.size_usd ?? 0));
}

/**
 * SELLERS WHO ANSWERED HER PROSPECT EMAILS (Builder L, `~/.boss-os/morning/prospects.json`, rows with
 * side "Sell"): each becomes a Sell row on the grid, linked to the reply thread. Nobody on her
 * do-not-suggest list, and only a real Gmail link.
 */
export function prospectSellRows(prospects, lists) {
  const out = [];
  for (const p of prospects?.rows ?? []) {
    if (!/^sell/i.test(String(p.side ?? ""))) continue;
    const link = String(p.link ?? p.url ?? "");
    const from = String(p.from ?? "").trim() || "—";
    const when = String(p.when ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(when)) continue;
    if (isDoNotSuggest({ from_text: from, principal: from, from: p.from_email }, lists)) continue;
    const company = String(p.company ?? "").trim() || "—";
    out.push({
      id: createHash("sha256").update(`prospect|${link}|${from}|${company}`).digest("hex").slice(0, 24),
      company, side: "sell", direction: "sell",
      size_usd: Number(p.size_usd) > 0 ? Number(p.size_usd) : null,
      size_text: Number(p.size_usd) > 0 ? moneyWords(Number(p.size_usd)) : "—",
      price_text: "—", structure_text: "—", from_text: from, rainmaker: 0, received_on: when,
      email_url: /^https:\/\/mail\.google\.com\//.test(link) ? link : null,
      parties: from.toLowerCase(), source_message: null,
      _row: { side: "sell", principal: from, from: p.from_email ?? null, from_name: from, date: when },
    });
  }
  return out;
}

/** The grid row as D1 stores it and the page shows it. */
export const publicRow = (g) => {
  const { _row, source_message, ...rest } = g;
  return rest;
};

// ─── What Monique found ──────────────────────────────────────────────────────

const sideWord = (g) => (g.direction === "buy" ? "buyer" : "seller");
const mailto = (to, subject, body) =>
  `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** The address a note to this row's sender goes to, or null when the mail gave none. */
export function replyAddress(g) {
  const r = g._row ?? {};
  const a = (!r.outbound && r.from) || r.intermediated_by || r.principal_email;
  return a && String(a).includes("@") ? String(a).toLowerCase() : null;
}

/**
 * The other side of each deal, from her own mail: brokers who offered the company (a "Still have it?"
 * note) for her buyers, and people who asked for it for her sellers. Only pairs she may be shown.
 */
export function otherSides(grid, lists, { cap = 3, tolerance = DEFAULT_TOLERANCE, now = Date.now() } = {}) {
  const found = [];
  for (const g of grid) {
    const wantSide = g.direction === "buy" ? "sell" : "buy";
    const hits = grid.filter((o) => o !== g && o.company.toLowerCase() === g.company.toLowerCase()
      && o.direction === wantSide && o.from_text !== g.from_text && o.from_text !== "—"
      && !(o.side === "yours" && g.side === "yours")
      && pairAllowed(g._row, o._row, lists, { aIsHers: g.side === "yours", bIsHers: o.side === "yours" }));
    if (hits.length === 0) continue;
    // Size, price and age (owner, 24 Oct 2026): closest price first, a missing price never hides a
    // match (it ranks below, "worth asking"), fresher before older; too far apart on price drops out.
    const { matches, stack } = rankMatches(g, hits, { tolerance, now });
    if (matches.length === 0) continue;
    found.push({ deal: g, hits: matches.slice(0, cap).map((m) => m.other), ranked: matches, stack, total: matches.length });
  }
  return found;
}

const dealPhrase = (g) => `${g.side === "yours" ? "your " : "the "}${g.size_text !== "—" ? `${g.size_text} ` : ""}${g.company} ${sideWord(g)}`;

/** "Person, Firm" for a row; "you (your own deal)" for hers. */
const whoOf = (g) => (g.side === "yours" ? "you (your own deal)" : g.from_text);
const offerWords = (g) => `${g.direction === "buy" ? "wants to buy" : "has to sell"}${g.size_text !== "—" ? ` ${g.size_text}` : ""}${g.price_text !== "—" ? ` at ${g.price_text}` : ""}${g.structure_text && g.structure_text !== "—" ? ` (${g.structure_text})` : ""}`;

// A greeting uses a person's first name only (from the email's display name), never a firm's word.
const firstOf = (g) => { const w = String(g?._row?.from_name ?? "").split(/[\s,]+/)[0] ?? ""; return /^[A-Z][a-z'’-]{1,30}$/.test(w) ? w : ""; };
const sizeOf = (g) => (g.size_text !== "—" ? g.size_text : "");
const priceOf = (g) => (g.price_text !== "—" ? ` at ${g.price_text}` : "");

/** What the seller fills of the buyer, in words: "the $25M seller can fill all of the $5M buyer". */
export function pairFillWords(buyer, seller) {
  const b = Number(buyer.size_usd) || 0;
  const s = Number(seller.size_usd) || 0;
  if (!b || !s) return `size unknown on ${!b && !s ? "both sides" : !b ? "the buyer's side" : "the seller's side"} — worth asking`;
  if (s >= b) return `the ${moneyShort(s)} seller can fill all of the ${moneyShort(b)} buyer`;
  return `the ${moneyShort(s)} seller fills ${moneyShort(s)} of the ${moneyShort(b)} buyer`;
}

/** The notes she sends, word for word. Fixed templates: no model writes any part of them. */
export function pairDrafts(buyer, seller) {
  const company = buyer.company;
  const out = [];
  if (seller.side !== "yours") {
    const to = replyAddress(seller);
    if (to) out.push({ to, side: "seller", subject: `Is your ${company} still available?`,
      body: `Hi${firstOf(seller) ? ` ${firstOf(seller)}` : ""},\n\nIs your ${company}${sizeOf(seller) ? ` (${sizeOf(seller)})` : ""} still available? I have a buyer${sizeOf(buyer) ? ` for ${sizeOf(buyer)}` : ""}.${parsePrice(seller.price_text) ? "" : " What price are they looking for?"} Happy to talk today.\n\nSequoia` });
  }
  if (buyer.side !== "yours") {
    const to = replyAddress(buyer);
    if (to) out.push({ to, side: "buyer", subject: `Still looking for ${company}?`,
      body: `Hi${firstOf(buyer) ? ` ${firstOf(buyer)}` : ""},\n\nAre you still looking for ${company}? I have ${sizeOf(seller) ? `${sizeOf(seller)} ` : "a block "}available.${parsePrice(buyer.price_text) ? "" : " What price would work for you?"} Happy to talk today.\n\nSequoia` });
  }
  return out;
}

/** One match, as the email, Today and the Matches screen show it. Pure. */
export function matchView(buyer, seller, rank, { isNew = false, now = Date.now() } = {}) {
  const side = (g) => ({
    who: whoOf(g), email: g.side === "yours" ? null : replyAddress(g), size: g.size_text, price: g.price_text,
    received_on: g.received_on, age: ageWords(g.received_on, now), email_url: g.email_url ?? null, rainmaker: g.rainmaker === 1,
  });
  const drafts = pairDrafts(buyer, seller);
  return {
    key: `${buyer.id}|${seller.id}`, company: buyer.company, new: isNew,
    buyer: side(buyer), seller: side(seller),
    fill: pairFillWords(buyer, seller), gap: rank.gap, priced: rank.priced, price: rank.gap_words,
    age: rank.age_words, stale: rank.stale, old: rank.old, drafts,
  };
}

/** A match as a Decide item: both sides in full, what fills, the price gap, the age, the notes. */
export function matchDecide(m) {
  const line = (s, role) => `${role}: ${s.who}${s.email ? ` (${s.email})` : ""} ${role === "Buyer" ? "wants" : "has"} ${s.size !== "—" ? s.size : "an amount not given"}${s.price !== "—" ? ` at ${s.price}` : ", no price given"}; their email came ${s.age}.`;
  return {
    key: `match:${m.key}`,
    title: `${m.company}: a buyer and a seller who could trade`,
    body: `${m.fill[0].toUpperCase()}${m.fill.slice(1)}. ${m.price[0].toUpperCase()}${m.price.slice(1)}.${m.stale ? " One side may be stale — check it's still live." : ""}`,
    details: [line(m.seller, "Seller"), line(m.buyer, "Buyer"), `Age: ${m.age}.`],
    draft: m.drafts.length ? { heading: m.drafts.length > 1 ? "The two notes, word for word" : "The note, word for word", text: m.drafts.map((d) => `To ${d.to} (the ${d.side})\nSubject: ${d.subject}\n\n${d.body}`).join("\n\n— — —\n\n") } : null,
    buttons: [
      ...m.drafts.map((d) => ({ label: `Write to the ${d.side} (draft ready)`, url: mailto(d.to, d.subject, d.body) })),
      ...(m.seller.email_url ? [{ label: "Open the seller's email", url: m.seller.email_url }] : []),
      ...(m.buyer.email_url ? [{ label: "Open the buyer's email", url: m.buyer.email_url }] : []),
    ],
  };
}

/** Every allowed buy↔sell pair in the grid, once each, ranked as `rankMatches` ranks. */
export function allMatches(grid, lists, { newIds = new Set(), now = Date.now(), tolerance = 0.3 } = {}) {
  const out = [];
  const seen = new Set();
  for (const pair of otherSides(grid, lists, { cap: 999, tolerance, now })) {
    if (pair.deal.direction !== "buy") continue;
    for (const r of pair.ranked) {
      const buyer = pair.deal;
      const seller = r.other;
      const key = `${buyer.id}|${seller.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(matchView(buyer, seller, r, { isNew: newIds.has(buyer.id) || newIds.has(seller.id), now }));
    }
  }
  out.sort((a, b) => (a.priced !== b.priced ? (a.priced ? -1 : 1) : a.old !== b.old ? (a.old ? 1 : -1) : a.stale !== b.stale ? (a.stale ? 1 : -1) : (a.gap ?? 0) - (b.gap ?? 0)));
  return out;
}

/** A holders line: "5 funds hold $310M between them. Biggest: A $120M, B $64M." Partial fills summed. */
export function holdersLine(deal, holders) {
  const named = holders.filter((h) => Number(h.value_usd) > 0).sort((a, b) => b.value_usd - a.value_usd);
  if (named.length === 0) return null;
  const sum = named.reduce((n, h) => n + h.value_usd, 0);
  const top = named.slice(0, 3).map((h) => `${h.fund} ${moneyWords(h.value_usd)}`).join(", ");
  // Owner, 24 Oct 2026: label them for what they are, no "vs", one next step.
  const label = deal.direction === "buy" ? "Public filings, not confirmed sellers" : "Public filings, not confirmed buyers";
  if (named.length === 1) return `${label}: ${named[0].fund} holds ${moneyWords(sum)} of ${deal.company}.`;
  return `${label}: ${named.length} funds hold ${moneyWords(sum)} of ${deal.company} between them. Biggest: ${top}.`;
}

/**
 * monique_found.json — owner, 24 Oct 2026: for each new deal, FIRST the people in her own email
 * who can fill it, and only then the outward list (public filings and press, labelled "not
 * confirmed"), each with one next step. MATCHES: every buy and sell on the same company that could
 * trade (size, price within 15%, a missing price never hides one, fresher first). A match she has not
 * been told about yet is in the email — a new one in Decide (her move) — and every current match is
 * on the Matches screen (`matches`). Older than her ~6-month lookback: on the screen only, as "old".
 */
export const MAX_MATCH_DECIDE = 6;
export function moniqueFound({ newRows, grid, lists, found = {}, now = Date.now() }) {
  const newIds = new Set(newRows.map((g) => g.id));
  const all = allMatches(grid, lists, { newIds, now });
  const within = all.filter((m) => !m.old && (m.gap === null || m.gap <= DEFAULT_TOLERANCE));
  // Her move: a match on an order that arrived since yesterday is a decision, best first.
  const decide = within.filter((m) => m.new).slice(0, MAX_MATCH_DECIDE).map(matchDecide);
  const lines = [];
  /*
   * EVERY COMPANY WITH A LIVE MATCH, ONE LINE EACH (owner, 24 Oct 2026: a $25M seller and a $5M
   * buyer of the same company, neither priced, sat in the grid unseen). The best pair is spelled out
   * — both sides, sizes, prices, what fills, the gap, the age — with its note ready, and the rest are
   * counted on the Matches screen. Live means no side older than STALE_DAYS; companies with only
   * older matches are counted in one line.
   */
  const fresh = within.filter((m) => !m.stale);
  const byCompany = new Map();
  for (const m of fresh) byCompany.set(m.company, [...(byCompany.get(m.company) ?? []), m]);
  const side = (x, role) => `${role} ${x.who}${x.email ? ` (${x.email})` : ""} ${role === "buyer" ? "wants" : "has"} ${x.size !== "—" ? x.size : "an amount not given"}${x.price !== "—" ? ` at ${x.price}` : ", no price"}`;
  const inDecide = new Set(within.filter((m) => m.new).slice(0, MAX_MATCH_DECIDE).map((m) => m.key));
  for (const [company, list] of byCompany) {
    const rest = list.filter((m) => !inDecide.has(m.key));
    if (!rest.length) continue; // every live match on it is in Decide above
    const m = rest[0];
    lines.push({
      text: `Match, ${company}: ${side(m.seller, "seller")}; ${side(m.buyer, "buyer")}. ${m.fill[0].toUpperCase()}${m.fill.slice(1)}; ${m.price}. ${m.age[0].toUpperCase()}${m.age.slice(1)}.${rest.length > 1 ? ` ${rest.length - 1} more possible ${rest.length === 2 ? "trade" : "trades"} on ${company}.` : ""}`,
      links: m.drafts.slice(0, 1).map((d) => ({ label: `Write to the ${d.side} (draft ready)`, url: mailto(d.to, d.subject, d.body) })),
      deal: company, match: { ...m },
    });
  }
  const staleOnly = [...new Set(within.filter((m) => m.stale && !byCompany.has(m.company)).map((m) => m.company))];
  if (staleOnly.length) lines.push({ text: `Older matches (an order over ${STALE_DAYS} days old, may be stale — check it's still live): ${staleOnly.join(", ")}.`, links: [{ label: "See every match", url: MATCHES_PAGE }] });
  const rows = [];
  for (const g of newRows) {
    const head = `For ${dealPhrase(g)}`;
    const mine = within.filter((m) => m.key.split("|").includes(g.id));
    if (!mine.length) lines.push({ text: `${head}: no one in your email yet for this.`, deal: g.company });
    const holders = (found[g.company.toLowerCase()]?.holders ?? []).filter((h) => !isDoNotSuggest({ principal: h.fund, from_text: h.manager }, lists));
    const line = holdersLine(g, holders);
    if (line) {
      lines.push({ text: `${head}, outside your email. ${line} Next step: see the funds and their filings.`, links: [{ label: "See the funds", url: `${HOLDERS_PAGE}&company=${encodeURIComponent(g.company)}` }], deal: g.company });
      for (const h of holders.slice(0, 5)) rows.push({ company: g.company, fund: h.fund, manager: h.manager ?? "—", value: moneyWords(h.value_usd), as_of: h.as_of ?? "—", url: h.filing_url });
    }
    for (const l of (found[g.company.toLowerCase()]?.press ?? []).slice(0, 3)) {
      if (isDoNotSuggest({ principal: l.name, from_text: l.org }, lists)) continue;
      const src = String(l.url ?? l.link ?? "");
      lines.push({
        text: `${head}, outside your email. Press, not confirmed: ${l.name}${l.org ? ` at ${l.org}` : ""} said publicly they ${g.direction === "buy" ? "hold" : "want"} ${g.company} (${l.kind}${l.published_date ? `, ${l.published_date}` : ""}). Next step: read what they said.`,
        links: /^https?:\/\//.test(src) ? [{ label: "Read the article", url: src }] : [],
        deal: g.company,
      });
    }
  }
  return {
    decide, rows, lines,
    // Every current match goes to the Matches screen (capital_matches), not into this file.
    matches: all.slice(0, 2000),
    link: { label: "See every match", url: MATCHES_PAGE },
  };
}

function monthOf(daysBack) {
  return new Date(Date.now() - daysBack * 86_400_000).toLocaleString("en-US", { month: "long", timeZone: "America/Chicago" });
}

const whenWords = (d, now = Date.now()) => {
  const days = Math.floor((now - Date.parse(d)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days} days ago` : `${Math.round(days / 7)} weeks ago`;
};

/** deals.json — the new rows since yesterday, newest first, at most 12, and the way to the full grid. */
export function morningDeals(newRows, gridSize, now = Date.now()) {
  // The row shape Simone's renderer reads (Builder E, src/shared/boss/mail/morning.mjs).
  const rows = newRows.slice(0, 12).map((g) => ({
    // Owner, 24 Oct 2026: "Yours · You" said nothing. Her own post reads as its side and where it came from.
    company: g.company, side: g.side === "yours" ? yoursLabel(g.direction) : SIDE_LABEL[g.side], size: g.size_text, price: g.price_text,
    from: g.side === "yours" ? "You, on the deal list" : g.from_text, when: whenWords(g.received_on, now), url: g.email_url ?? DEALS_PAGE,
    received_on: g.received_on, structure: g.structure_text ?? "—", id: g.id ?? null,
    ...(g.rainmaker === 1 && g.side !== "yours" ? { tag: "Rainmaker" } : {}),
    // Builder L reads these (catch-ups, prospects): who it came from, as fields, and the size as a number.
    from_email: g.side === "yours" ? null : replyAddress(g),
    from_name: g.side === "yours" ? "You" : (g._row?.from_name ?? g.from_text.split(", ")[0] ?? null),
    from_firm: g.side === "yours" ? null : (firmOf(replyAddress(g) ?? "") || null),
    size_usd: g.size_usd, rainmaker: g.rainmaker === 1,
  }));
  const lines = newRows.length > 12 ? [`And ${newRows.length - 12} more on the Deals page.`] : [];
  return { decide: [], rows, lines, link: { label: `See the full grid (${gridSize} open deals)`, url: DEALS_PAGE } };
}

// ─── The run ─────────────────────────────────────────────────────────────────

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };

/** A Boss OS session from the vault passcode, or null with the reason printed. */
export async function bossSession() {
  if (!process.env.BOSS_PASSCODE) { console.error("  Boss OS not reached [NO_PASSCODE] — run under the vault: npm run capital:grid"); return null; }
  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  }).catch(() => null);
  if (!unlock?.ok) { console.error(`  Boss OS not reached [UNLOCK_FAILED ${unlock?.status ?? "no response"}]`); return null; }
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];
  return {
    get: (p) => fetch(`${ORIGIN}/api/boss${p}`, { headers: { cookie } }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    post: (p, body) => fetch(`${ORIGIN}/api/boss${p}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }).catch(() => null),
  };
}

/** Her two lists from D1, cached on this Mac so a run with Boss OS unreachable still honours them. */
export async function loadLists(session) {
  const cache = path.join(DIR, "party-lists.json");
  const live = session ? await session.get("/capital/lists") : null;
  const data = live?.data ?? live;
  if (data?.same_firm && data?.do_not_suggest) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(cache, JSON.stringify({ fetched_at: new Date().toISOString(), same_firm: data.same_firm, do_not_suggest: data.do_not_suggest }, null, 2));
    return data;
  }
  const cached = readJson(cache, null);
  if (cached) { console.error(`  lists read from the cache of ${cached.fetched_at}; Boss OS was not reached.`); return cached; }
  return { same_firm: [], do_not_suggest: [] };
}

/**
 * The morning sections go through Builder E's ONE writer (`writeMorningSection`,
 * src/shared/boss/mail/morning.mjs): same shape, same checks, same file Simone reads. A decision
 * whose buttons are not all real links is left out here rather than refusing the whole section.
 */
const realButtons = (d) => (d.buttons ?? []).length > 0 && d.buttons.every((b) => /^(?:https?:\/\/|mailto:)\S+$/.test(String(b?.url ?? "")));
export function writeMorning(name, section) {
  return writeMorningSection(name, { ...section, decide: (section.decide ?? []).filter(realButtons) }, { dir: MORNING_DIR });
}

async function main() {
  const DRY = process.argv.includes("--dry-run");
  const ledger = readJson(path.join(DIR, "ledger.json"), null);
  if (!ledger?.interests?.length) {
    console.error(`NAMED STOP [NO_LEDGER] ${path.join(DIR, "ledger.json")} is missing or empty. Run npm run capital:scan && npm run capital:extract.`);
    process.exit(5);
  }
  const session = DRY ? null : await bossSession();
  const lists = await loadLists(session);
  const identity = loadIdentity();
  const senders = readJson(path.join(DIR, "senders.json"), { senders: {} }).senders ?? {};
  const wrong = new Set(readJson(path.join(DIR, "wrong.json"), { rows: [] }).rows ?? []);
  const grid = buildGrid(ledger.interests, { identity, lists, senders, wrong });
  // Sellers who answered her prospect emails (Builder L) join the grid as Sell rows.
  const prospects = readJson(path.join(MORNING_DIR, "prospects.json"), null);
  const fromProspects = prospectSellRows(prospects, lists).filter((p) => withinLookback(p.received_on));
  grid.push(...fromProspects.filter((p) => !grid.some((g) => g.id === p.id)));
  grid.sort((a, b) => b.received_on.localeCompare(a.received_on) || (b.size_usd ?? 0) - (a.size_usd ?? 0));

  const seenFile = path.join(DIR, "grid-seen.json");
  const seenState = readJson(seenFile, null);
  const seen = new Set(seenState?.ids ?? []);
  // The first run has no memory of yesterday: "new" is then what arrived since yesterday, not six months.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const newRows = seenState ? grid.filter((g) => !seen.has(g.id)) : grid.filter((g) => g.received_on >= yesterday);
  const found = readJson(path.join(DIR, "found.json"), { companies: {} }).companies ?? {};

  const deals = morningDeals(newRows, grid.length);
  const monique = moniqueFound({ newRows, grid, lists, found });
  console.log(`Grid: ${grid.length} deal(s) in the last ${LOOKBACK_DAYS} days, ${newRows.length} new since the last run `
    + `(${grid.filter((g) => g.side === "yours").length} yours, ${grid.filter((g) => g.rainmaker).length} Rainmaker).`);
  console.log(`Monique found: ${monique.decide.length} match(es) to decide, ${monique.lines.length} line(s), ${monique.rows.length} holder row(s), ${monique.matches.length} current match(es) on the screen.`);
  if (DRY) { console.log(JSON.stringify({ deals, monique_found: monique }, null, 2).slice(0, 4000)); return; }

  writeMorning("deals", deals);
  const { matches, ...moniqueSection } = monique;
  writeMorning("monique_found", moniqueSection);

  let pushed = false;
  if (session) {
    // The Archive rides along (owner, 24 Oct 2026): a view by date on the Deals page, never matched.
    const archived = buildGrid(ledger.interests, { identity, lists, senders, wrong, archive: true });
    const rows = [...grid, ...archived.filter((a) => !grid.some((g) => g.id === a.id))].map(publicRow);
    pushed = true;
    for (let i = 0; i < rows.length || i === 0; i += 500) {
      const res = await session.post("/capital/deals", { rows: rows.slice(i, i + 500), replace: i === 0, lookback_days: LOOKBACK_DAYS });
      if (!res?.ok) { pushed = false; console.error(`  grid NOT pushed [${res?.status ?? "no response"}] — the Deals page shows the last good push.`); break; }
      if (rows.length === 0) break;
    }
  }
  // THE MATCHES SCREEN: every current match, best first, replaced whole.
  if (session && pushed) {
    for (let i = 0; i < matches.length || i === 0; i += 500) {
      const res = await session.post("/capital/matches", { matches: matches.slice(i, i + 500), replace: i === 0, offset: i });
      if (!res?.ok) { console.error(`  matches NOT pushed [${res?.status ?? "no response"}]`); break; }
      if (matches.length === 0) break;
    }
  }
  /*
   * THE HOLDERS TAB: every named holder Danielle's filings read found, per company in the grid's
   * window, minus anyone on her do-not-suggest list. Replaced per company on each push.
   */
  if (session && pushed) {
    const live = new Set(grid.map((g) => g.company.toLowerCase()));
    for (const [k, c] of Object.entries(found)) {
      if (!live.has(k)) continue;
      const holders = (c.holders ?? []).filter((h) => !isDoNotSuggest({ principal: h.fund, from_text: h.manager }, lists))
        .map((h) => ({ kind: "nport", ...h }));
      const spvs = (c.spvs ?? []).filter((v) => !isDoNotSuggest({ principal: v.fund }, lists))
        .map((v) => ({ kind: "form_d", fund: v.fund, manager: null, value_usd: null, as_of: v.filed, filing_url: v.filing_url, contact: null }));
      const res = await session.post("/capital/holders", { company: c.company, holders: [...holders, ...spvs].slice(0, 1000) });
      if (!res?.ok) console.error(`  holders for ${c.company} NOT pushed [${res?.status ?? "no response"}]`);
    }
  }
  fs.writeFileSync(seenFile, JSON.stringify({ updated_at: new Date().toISOString(), ids: grid.map((g) => g.id) }, null, 2));
  console.log(`CAPITAL-GRID-COMPLETE: ${grid.length} row(s), ${newRows.length} new, morning sections written${pushed ? ", Deals page updated" : ""}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`CAPITAL GRID FAILED: ${err?.stack ?? err}`); process.exit(1); });
}
