#!/usr/bin/env node
/**
 * DANIELLE'S HALF OF THE HUNT: WHICH FUNDS HOLD THIS, WHO THERE COULD WRITE THE CHEQUE, AND HOW TO
 * FIND THEM.
 *
 * ─── Why this is a separate file and a separate person ─────────────────────
 *
 *   "Danielle finds, Monique relates."
 *
 * The seam is not workload — it is that FINDING A PERSON IS RESEARCH AND KNOWING A PERSON IS A
 * RELATIONSHIP. Reading eight N-PORT XML filings per name, doing the capacity arithmetic, pulling
 * Schedule A off Form ADV and working out whether a domain has an address convention is Technical
 * Program Management. Knowing which broker in her own ledger is already working a name, and whether
 * a firm she is mid-conversation with as an LP can be approached as a buyer, is Relationships.
 *
 * Monique carried eight of fourteen duties and Danielle carried one. This moves the half that was
 * never hers.
 *
 * ─── A SINGLE REQUEST STILL PRODUCES BOTH HALVES ───────────────────────────
 *
 * This is two people's work REPORTED TOGETHER, not two separate asks. `buyer-hunt.mjs` imports this
 * module and renders both halves into one email, each under its own byline. Splitting the delivery
 * would mean she asks one question and gets two answers on two mornings, which is worse than the
 * undivided version this replaced.
 *
 * ─── The chain, all free and all public ────────────────────────────────────
 *
 *   1. N-PORT via EDGAR — which funds report a position in this issuer, at what dollar mark, against
 *      what total net assets. Free, citable, and the only filing that sees private paper at all:
 *      13F covers exchange-traded securities and returns literally zero for every name in her book.
 *   2. FORM ADV via the SEC — the registered adviser behind the filer, its regulatory AUM, its client
 *      types, and ITS PRINCIPALS BY NAME on Schedule A. That is the population of people who could
 *      actually sign, and it is the answer to "who might be investors".
 *   3. HER OWN CONTACTS.json — 553 correspondents with an address each. Where she has written to a
 *      domain, the address PATTERN is evidence rather than a guess.
 *   4. A LINKEDIN SEARCH URL SHE CLICKS HERSELF. Composing a link is not scraping: nothing here logs
 *      in, fetches it or automates a browser, and no credential is requested or accepted.
 *
 * ─── EVERY LINE STATES ITS CONFIDENCE AND ITS SOURCE ───────────────────────
 *
 *   "Pattern from 9 known addresses at this domain" is evidence.
 *   "Most common format for US managers" is a guess.
 *
 * Conflating those is how she emails a stranger by the wrong name. `lib/reach.mjs` carries the
 * levels — known, pattern, record, link — and `validate:contact-source` fails the build if a line is
 * rendered without a file and a row behind it, or if a predicted address is printed without the
 * count of known addresses it rests on.
 *
 * ─── EMPTY-HANDED IS STILL A GOOD ANSWER, AND THIS IS WHERE THAT IS AT RISK ─
 *
 *   "if she comes up empty handed its fine. better than giving me trash."
 *
 * Attaching names to every hunt puts pressure on exactly that rule. A fund with a real filing and no
 * findable person MUST be able to report "holder confirmed, no person identified" and count as a
 * success — and it does: that is what a `record` line with no address is, and what the `none`
 * sentence says when there is not even one of those. If this ever learns to pad, she stops reading
 * it, and then the filings are worth nothing either.
 *
 *   npm run capital:filings -- --asset Anthropic --size 2000000000
 *   npm run capital:filings                      # every priced lot on her book
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { advFirms, advPeople } from "./lib/adv.mjs";
import { loadContacts, reachFor } from "./lib/reach.mjs";
/*
 * IMPORTED, BECAUSE IT WAS NEVER DEFINED HERE (found 23 Oct 2026). `positionFromXml` called
 * `assetKey` with no import, threw a ReferenceError inside the `try` that wraps every filing read,
 * and the catch swallowed it — so every N-PORT filing was "unreadable" and every hunt reported no
 * holder. Pinned by tests/boss/dealGrid.test.ts.
 */
import { assetKey } from "./interest-match.mjs";

/** SEC Fair Access requires a descriptive agent with a contact address. It is a condition, not a nicety. */
const USER_AGENT = process.env.SEC_USER_AGENT ?? "Boss OS capital research (seq.taylor@gmail.com)";
const FTS = "https://efts.sec.gov/LATEST/search-index";

/*
 * ─── EVERY FILING, EVERY HOLDER (owner, 23 Oct 2026) ───────────────────────
 *
 * This used to read 8 filings per name and print 6 holders, dropping any holder whose position could
 * not fill the whole block. Her review: "reads 2–8 of hundreds of filings and drops any holder that
 * can't fill the whole size, never naming the holders". So now: every N-PORT filing that names the
 * issuer is read (paged through EDGAR full-text search), every holder with a readable position is
 * named — fund, manager, value held, as-of date, filing link, the registrant's public phone — ranked
 * by size, and partial fills are SUMMED ("top 5 hold $180M vs your $1B buyer"). Nothing is dropped
 * for being smaller than the block.
 *
 * SEC FAIR ACCESS: a declared User-Agent (above) and at most ~9 requests a second (`sec` spaces every
 * call by `SEC_GAP_MS`), across the whole process. A per-name cache (7 days) keeps a daily hunt from
 * re-reading the same few hundred filings every morning.
 */
/** Upper bound on filings read per name; reported when hit, never silent. */
const MAX_FILINGS = Number(process.env.NPORT_MAX_FILINGS ?? 2000);
/** Named holders printed per name in a text render. The full list is on the Deals page. */
export const CAP = Number(process.env.BUYER_HUNT_CAP ?? 25);
/** Holders whose adviser is looked up on Form ADV (one or two calls each). */
const ADV_TOP = Number(process.env.BUYER_HUNT_ADV_TOP ?? 10);
/** How far back a filing may be and still describe a position that plausibly still exists. */
const FILING_LOOKBACK_DAYS = Number(process.env.BUYER_HUNT_LOOKBACK_DAYS ?? 400);
/** ≤10 requests/second is SEC's rule; 110 ms between calls keeps every run under it. */
export const SEC_GAP_MS = 110;
const CACHE_DIR = path.join(process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital"), "holders-cache");
const CACHE_TTL_MS = 7 * 86_400_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const money = (n) => (n == null ? "unknown"
  : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString("en-US")}`);

// ─── N-PORT: which funds report this position ─────────────────────────────────

let lastSecCall = 0;
export async function sec(url) {
  const wait = lastSecCall + SEC_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastSecCall = Date.now();
  const r = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json, text/xml, */*" } });
  if (!r.ok) throw new Error(`SEC ${r.status} for ${url}`);
  return r;
}

/** One page of EDGAR full-text search hits for a form, flattened to filings. */
export function filingsFromHits(hits) {
  const out = [];
  for (const h of hits ?? []) {
    const s = h._source ?? {};
    const cik = String(s.ciks?.[0] ?? "").replace(/^0+/, "");
    const [accRaw, file] = String(h._id ?? "").split(":");
    if (!cik || !accRaw) continue;
    out.push({
      cik,
      filer: String(s.display_names?.[0] ?? "").replace(/\s+\(CIK.*$/, "").trim(),
      accession: accRaw,
      file: file ?? "primary_doc.xml",
      filed: s.file_date ?? null,
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accRaw.replace(/-/g, "")}/${file ?? "primary_doc.xml"}`,
    });
  }
  return out;
}

/** EVERY filing of this form whose text names the issuer, paged, newest first, one per accession. */
export async function ftsFilings(asset, form, { lookbackDays = FILING_LOOKBACK_DAYS, max = MAX_FILINGS } = {}) {
  const startdt = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const enddt = new Date().toISOString().slice(0, 10);
  const byAcc = new Map();
  let total = 0;
  for (let from = 0; from < max; from += 100) {
    const url = `${FTS}?${new URLSearchParams({ q: `"${asset}"`, forms: form, startdt, enddt, from: String(from) })}`;
    const j = await (await sec(url)).json();
    total = j?.hits?.total?.value ?? total;
    const page = filingsFromHits(j?.hits?.hits);
    for (const f of page) if (!byAcc.has(f.accession)) byAcc.set(f.accession, f);
    if (page.length < 100 || from + 100 >= total) break;
  }
  const filings = [...byAcc.values()].sort((a, b) => String(b.filed).localeCompare(String(a.filed)));
  return { filings: filings.slice(0, max), total, capped: total > max };
}

/** Recent N-PORT filings whose text names this issuer — all of them. */
export async function nportFilings(asset) {
  return ftsFilings(asset, "NPORT-P");
}

/**
 * SPV VEHICLES FOR THIS COMPANY, FROM FREE SEC FORM D DATA. A Form D whose text names the issuer is
 * very often a single-purpose vehicle raised to hold it — each one has a manager who either holds the
 * paper or is raising to buy it. Named with the filing link; nothing is inferred beyond the filing.
 */
export async function formDVehicles(asset, { lookbackDays = 730 } = {}) {
  const { filings, total } = await ftsFilings(asset, "D", { lookbackDays, max: 300 });
  const byFiler = new Map();
  for (const f of filings) if (f.filer && !byFiler.has(f.filer)) byFiler.set(f.filer, f);
  return { vehicles: [...byFiler.values()].map((f) => ({ fund: f.filer, filed: f.filed, filing_url: f.url.replace(/[^/]+$/, "") })), total };
}

export const unescapeXml = (v) => (v == null ? v : String(v).replace(/&amp;/g, "&").replace(/&apos;|&#39;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"));

/**
 * WHAT DANIELLE AND MONIQUE FOUND, KEPT ON HER MAC FOR THE MORNING (23 Oct 2026). The hunts used to
 * email it; now they write `~/.boss-os/capital/found.json`, per company, and `npm run capital:grid`
 * turns it into the "Monique found" lines and the Holders tab. Named holders only, ranked by size.
 */
export function recordFound(asset, { holders = [], spvs = [], press = [] } = {}, file = null) {
  const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
  const target = file ?? path.join(DIR, "found.json");
  let all = { companies: {} };
  try { all = JSON.parse(fs.readFileSync(target, "utf8")); } catch { /* first */ }
  all.companies ??= {};
  all.companies[assetKey(asset)] = {
    company: String(asset),
    updated_at: new Date().toISOString(),
    holders: holders.filter((h) => Number(h.valUSD) > 0).map((h) => ({
      fund: unescapeXml(h.fund ?? h.filer), manager: unescapeXml(h.manager ?? null), value_usd: h.valUSD,
      as_of: h.as_of ?? h.filed ?? null, filing_url: h.url, contact: h.contact ?? null,
    })),
    spvs,
    press: press.filter((l) => l?.name && l?.source_url),
  };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ updated_at: new Date().toISOString(), companies: all.companies }, null, 2));
  return all.companies[assetKey(asset)];
}

/** The registrant's own lines out of an N-PORT: who filed, which fund, as of when, a public phone. */
export function genInfoFromXml(xml) {
  const tag = (t) => unescapeXml(new RegExp(`<${t}>\\s*([\\s\\S]*?)\\s*</${t}>`, "i").exec(xml)?.[1]?.trim()) || null;
  return {
    manager: tag("regName"),
    fund: tag("seriesName"),
    series_id: tag("seriesId"),
    as_of: tag("repPdDate"),
    phone: tag("regPhone"),
    city: [tag("regCity"), tag("regStateConditional") ?? tag("regState")].filter(Boolean).join(", ") || null,
  };
}

/**
 * The position itself, out of the filing.
 *
 * WITHOUT THIS THE WHOLE THING WOULD BE A LIST OF FUND NAMES, which is the trash she asked not to
 * be given. "Fidelity holds Anthropic" is a fact she already assumes; "this Fidelity fund marks
 * $412M of Anthropic against $28B of net assets" is what tells her whether a $2B block is even a
 * conversation. So the XML is read for the matched holding's `valUSD` and the fund's `totAssets`,
 * and where either cannot be read it is reported as unknown rather than estimated.
 */
export function positionFromXml(xml, asset) {
  const key = assetKey(asset);
  const totAssets = Number(/<totAssets>\s*([0-9.]+)\s*<\/totAssets>/i.exec(xml)?.[1] ?? NaN);
  let best = null;
  for (const m of xml.matchAll(/<invstOrSec>([\s\S]*?)<\/invstOrSec>/gi)) {
    const block = m[1];
    const name = /<name>([\s\S]*?)<\/name>/i.exec(block)?.[1]?.trim() ?? "";
    const title = /<title>([\s\S]*?)<\/title>/i.exec(block)?.[1]?.trim() ?? "";
    if (!assetKey(name).includes(key) && !assetKey(title).includes(key)) continue;
    const val = Number(/<valUSD>\s*(-?[0-9.]+)\s*<\/valUSD>/i.exec(block)?.[1] ?? NaN);
    const pct = Number(/<pctVal>\s*(-?[0-9.]+)\s*<\/pctVal>/i.exec(block)?.[1] ?? NaN);
    if (!best || (Number.isFinite(val) && val > (best.valUSD ?? -1))) {
      best = { holding: name || title, valUSD: Number.isFinite(val) ? val : null, pctVal: Number.isFinite(pct) ? pct : null };
    }
  }
  return best ? { ...best, totAssets: Number.isFinite(totAssets) ? totAssets : null } : null;
}

/**
 * Can they write this check?
 *
 * A JUDGEMENT WITH ITS ARITHMETIC ON THE FACE OF IT, never a score. The test is whether the block
 * would be a sane position for this fund: against total net assets, and against what they already
 * hold in the name. Anything that cannot be computed says so — an unverified capacity is printed as
 * unverified and ranked below a verified one, because inventing it is exactly the failure mode this
 * whole file is written against.
 */
export function capacity(position, size, side = "buy") {
  if (side === "sell") return supply(position, size);
  if (!position || !size) return { verdict: "UNVERIFIED", why: "no size to test against" };
  const { totAssets, valUSD } = position;
  if (!totAssets) return { verdict: "UNVERIFIED", why: "the filing did not state total net assets" };
  const pct = (size / totAssets) * 100;
  if (pct <= 2) {
    return { verdict: "COMFORTABLY", why: `${money(size)} is ${pct.toFixed(2)}% of ${money(totAssets)} in net assets` };
  }
  if (pct <= 10) {
    return { verdict: "PLAUSIBLY", why: `${money(size)} is ${pct.toFixed(1)}% of ${money(totAssets)} in net assets — a real decision for them, not a routine add` };
  }
  return {
    verdict: "NO",
    why: `${money(size)} is ${pct.toFixed(0)}% of ${money(totAssets)} in net assets${valUSD ? `, against ${money(valUSD)} they already hold` : ""} — not a check this fund writes`,
  };
}

/**
 * THE SAME FILING, READ THE OTHER WAY ROUND.
 *
 * Hunting a BUYER asks whether the block would be a sane position for them — size against total net
 * assets. Hunting a SELLER asks a different and simpler question: do they actually HAVE it? The
 * answer is the position they themselves marked in the filing, `valUSD`, and nothing else. Total net
 * assets are irrelevant here: a $28B fund that marks $40M of OpenAI cannot sell her $1B of it.
 *
 * A PARTIAL FILL IS A REAL ANSWER AND IS SAID AS ONE. Somebody holding a quarter of what she wants
 * is a conversation — three of them is the trade — so it is PLAUSIBLY with the arithmetic printed,
 * never a silent pass and never dressed up as a full fill.
 */
export function supply(position, size) {
  if (!position || !size) return { verdict: "UNVERIFIED", why: "no size to test against" };
  const { valUSD } = position;
  if (!valUSD) {
    return { verdict: "UNVERIFIED", why: "the filing named the issuer and did not state a readable dollar mark for the position" };
  }
  if (valUSD >= size) {
    return {
      verdict: "COMFORTABLY",
      why: `they mark ${money(valUSD)} of it, which is ${(valUSD / size).toFixed(1)}x the ${money(size)} you want`,
    };
  }
  if (valUSD >= size * 0.25) {
    return {
      verdict: "PLAUSIBLY",
      why: `they mark ${money(valUSD)}, which is ${((valUSD / size) * 100).toFixed(0)}% of the ${money(size)} you want — a partial fill, not the whole block`,
    };
  }
  return {
    verdict: "NO",
    why: `they mark ${money(valUSD)} against the ${money(size)} you want — under a quarter of it, so not a seller for this size`,
  };
}

const RANK = { COMFORTABLY: 3, PLAUSIBLY: 2, UNVERIFIED: 1, NO: 0 };
const cacheKey = (asset) => assetKey(asset).replace(/[^a-z0-9]+/g, "-").slice(0, 60) || "x";

/**
 * Every holder of this issuer, from every N-PORT that names it: the position, the fund, the manager,
 * the as-of date, the filing and the registrant's phone. Latest filing per fund. Size-independent, so
 * it is cached per name; `fromFilings` applies the block size afterwards.
 */
export async function allHolders(asset, { fresh = false, read = nportFilings, fetchXml = async (u) => (await sec(u)).text() } = {}) {
  const file = path.join(CACHE_DIR, `${cacheKey(asset)}.json`);
  if (!fresh) {
    try {
      const c = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Date.now() - c.at < CACHE_TTL_MS) return c.result;
    } catch { /* no cache */ }
  }
  const found = await read(asset);
  const byFund = new Map();
  let readable = 0;
  for (const f of found.filings) {
    let xml;
    try { xml = await fetchXml(f.url); } catch { continue; } // one unreadable filing must not end the hunt
    readable += 1;
    const position = positionFromXml(xml, asset);
    if (!position) continue;
    const g = genInfoFromXml(xml);
    const key = g.series_id ?? `${f.cik}|${g.fund ?? f.filer}`;
    const prior = byFund.get(key);
    if (prior && String(prior.as_of ?? prior.filed) >= String(g.as_of ?? f.filed)) continue;
    byFund.set(key, {
      ...f, ...position,
      holding: unescapeXml(position.holding), fund: g.fund ?? f.filer, manager: g.manager ?? f.filer, as_of: g.as_of ?? f.filed,
      contact: [g.phone, g.city].filter(Boolean).join(" · ") || null,
    });
  }
  const holders = [...byFund.values()].sort((a, b) => (b.valUSD ?? 0) - (a.valUSD ?? 0));
  const result = { holders, scanned: readable, listed: found.filings.length, total: found.total, capped: Boolean(found.capped) };
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ at: Date.now(), result })); } catch { /* cache is a convenience */ }
  return result;
}

/** Partial fills summed: what the top holders hold between them, against the block. */
export function partialFill(holders, size, top = 5) {
  const valued = holders.filter((h) => Number(h.valUSD) > 0).slice(0, top);
  const sum = valued.reduce((n, h) => n + h.valUSD, 0);
  return { count: valued.length, sum, line: valued.length ? `top ${valued.length} hold ${money(sum)}${size ? ` vs your ${money(size)}` : ""}` : null };
}

export async function fromFilings(asset, size, SIDE = "buy", opts = {}) {
  let all;
  try { all = await allHolders(asset, opts); }
  catch (err) { return { holders: [], note: `EDGAR could not be read: ${err.message}` }; }
  // EVERY HOLDER, ranked by what they hold. The verdict is shown beside each, never used to drop one.
  const holders = all.holders.map((h) => ({ ...h, capacity: capacity(h, size, SIDE) }));
  return { ...all, holders, fill: partialFill(holders, size) };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

/**
 * ─── HOW TO REACH THEM ─────────────────────────────────────────────────────
 *
 * Printed only from a row in a file. `reachFor` returns a `source` on every line — the file and the
 * row inside it — and a line with no source is never rendered. Where nothing resolves, the honest
 * sentence goes in instead, because "coming up empty handed is fine; returning noise is not".
 */
export function renderReach(lines, reach, indent) {
  lines.push(`${indent}HOW TO REACH THEM`);
  const printable = reach.lines.filter((l) => l.source?.file && l.source?.row);
  if (printable.length === 0) {
    lines.push(`${indent}  ${reach.none}`);
    return;
  }
  /*
   * THE CONFIDENCE IS ON THE FACE OF THE LINE, IN FRONT OF IT, NOT IN A LEGEND.
   *
   * `[known]` and `[pattern]` are different claims about the world and the difference matters at the
   * moment she is deciding whether to press send. A key at the bottom of the email is read once and
   * then never again; a prefix is read every time. `[record]` is the one that most needs saying —
   * that line is a PERSON and not a way to reach them, and without the label it reads like a contact
   * whose address was omitted.
   */
  for (const l of printable) lines.push(`${indent}  [${l.confidence}] ${l.text}`);
}

// ─── The people behind a filer ───────────────────────────────────────────────

/**
 * Form ADV for one filer: the adviser, and its principals by name.
 *
 * ONE FIRM, THE BEST MATCH, OR NONE. ADV search returns near-matches on a common word, and taking
 * the top hit regardless would attach "Blue Chip Capital LLC" to "Blue Chip Growth Fund" — the Forge
 * mistake in a new costume. So the hit has to line up with the filer on a distinctive run of words,
 * and where nothing does, this returns the empty answer with the reason on it.
 */
export async function peopleFor(filer, { offline = false } = {}) {
  if (!filer) return { people: [], firm: null, note: "no filer name" };

  const { firms, note } = await advFirms(filer, { offline });
  if (!firms.length) return { people: [], firm: null, note: note ?? "no adviser matched" };

  const norm = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const target = norm(filer);
  const firm = firms.find((f) => {
    const n = norm(f.firm_name);
    return n && (target.startsWith(n) || n.startsWith(target)) && n.length >= 8;
  }) ?? null;

  if (!firm) {
    return {
      people: [], firm: null,
      note: `Form ADV returned ${firms.length} adviser(s) and none lines up with "${filer}" closely enough to attribute a person to it.`,
    };
  }
  if (!firm.crd) return { people: [], firm, note: `${firm.firm_name} has no CRD in the ADV record, so its Schedule A cannot be read.` };

  const { people, note: pnote } = await advPeople(firm.crd, { offline });
  return { people, firm, note: people.length ? null : (pnote ?? "Form ADV lists no individuals for this firm.") };
}

// ─── Rendering the filings half ──────────────────────────────────────────────

/**
 * DANIELLE'S SECTION FOR ONE LOT. Rendered here rather than in `buyer-hunt.mjs` so that the half she
 * owns is the half she writes, and a change to the research output cannot be made by editing the
 * relationship file.
 */
export function renderFilings(lines, lot, filings, contacts, SIDE) {
  const size = lot.size_usd ?? 0;
  lines.push(SIDE === "sell"
    ? "  FROM FILINGS (N-PORT — funds that report holding this, and could therefore sell it) — Danielle"
    : "  FROM FILINGS (N-PORT — funds that report this position) — Danielle");

  if (filings.note) {
    lines.push(`    ${filings.note}`);
    return;
  }
  if (filings.holders.length === 0) {
    lines.push(SIDE === "sell"
      ? `    No fund reports a readable position: ${filings.total ?? 0} N-PORT filing(s) name this issuer;`
      : `    No fund reports a readable position: ${filings.total ?? 0} N-PORT filing(s) name this issuer;`);
    lines.push(`    ${filings.scanned ?? 0} were read.`);
    return;
  }

  if (filings.fill?.line) lines.push(`    ${filings.holders.length} holder(s) in ${filings.scanned} filing(s) read; ${filings.fill.line}.`);
  if (filings.capped) lines.push(`    EDGAR lists ${filings.total} filings; the first ${filings.listed} were read.`);
  for (const h of filings.holders.slice(0, CAP)) {
    lines.push(`    ${h.fund ?? h.filer}${h.manager && h.manager !== (h.fund ?? h.filer) ? ` (${h.manager})` : ""}${h.as_of ? ` · as of ${h.as_of}` : ""}${h.contact ? ` · ${h.contact}` : ""}`);
    lines.push(`      Holds ${money(h.valUSD)}${h.pctVal != null ? ` (${h.pctVal.toFixed(2)}% of the fund)` : ""} of "${h.holding}"`);
    lines.push(`      ${SIDE === "sell" ? "Could supply it" : "Can write it"}: ${h.capacity.verdict} — ${h.capacity.why}`);
    lines.push(`      ${h.filed ?? ""} N-PORT ${h.accession}  ${h.url}`);

    /*
     * THE ADVISER, WHERE FORM ADV HAS ONE. Its regulatory AUM is a DIFFERENT NUMBER from the mark
     * above and is labelled as such — the mark is what this fund holds of this issuer, the AUM is
     * what the adviser manages in total, and a reader who conflated them would badly misjudge who
     * can take a block.
     */
    if (h.adv?.firm) {
      const f = h.adv.firm;
      lines.push(`      ADV: ${f.firm_name}${f.crd ? ` (CRD ${f.crd})` : ""}${f.city ? ` · ${f.city}${f.state ? `, ${f.state}` : ""}` : ""}`
        + `${f.aum ? ` · ${money(Number(f.aum))} regulatory AUM across the adviser, not in this name` : ""}`);
    } else if (h.adv?.note) {
      // AN EMPTY ANSWER WITH A REASON IS A RESULT. "Holder confirmed, no person identified" is a
      // success, and it only reads as one if the run says which step came up empty.
      lines.push(`      ADV: ${h.adv.note}`);
    }

    /*
     * THE FILER'S OWN ADDRESSES AND ITS OWN PEOPLE ONLY. The first draft of the reach half passed
     * this asset's LEDGER rows in here too, and duly printed a broker from an unrelated OpenAI email
     * under "T. Rowe Price Blue Chip Growth Fund" — a real address, attributed to the wrong party.
     * The ledger's people are Monique's half and are rendered on their own rows above.
     */
    renderReach(lines, reachFor({ filer: h.filer, contacts, adv: h.adv ?? null }), "      ");
  }
}

/**
 * The whole of Danielle's half for one lot: the filings, and the people behind each holder.
 *
 * THE ADV LOOKUP IS PER HOLDER AND CAPPED BY `CAP` ABOVE, because it is one or two HTTP calls each
 * and the holders are already the short list. A lookup per filing rather than per holder would be
 * eight times the traffic for names that did not clear the capacity bar anyway.
 */
export async function researchLot(asset, size, SIDE = "buy", { offline = false } = {}) {
  const filings = await fromFilings(asset, size, SIDE);
  for (const h of (filings.holders ?? []).slice(0, ADV_TOP)) {
    h.adv = await peopleFor(h.filer, { offline });
  }
  try { filings.spvs = (await formDVehicles(asset)).vehicles; } catch { filings.spvs = []; }
  return filings;
}

// ─── Press and podcast mentions ───────────────────────────────────────────────

/**
 * THE ONE SOURCE FILINGS AND FORM ADV CANNOT SEE: SOMEBODY SAYING IT OUT LOUD.
 *
 * A fund's N-PORT mark is a dollar figure with no story behind it. A press release naming who led a
 * round, or a podcast guest describing a position they hold, is the same fact in the world's own
 * words — and it is the one piece of `interest-ledger-hunt`'s brief filings and ADV cannot reach: no
 * SEC form requires a fund to say why it holds something or when it said so out loud.
 *
 * NO NEW SPEND LANE. This calls `claudeCodeExecutor` directly, in-process — the same adapter every
 * `agent_executed` duty already uses, authenticating as the owner's own Claude Code session (macOS
 * keychain, never an API key). There is no Worker round trip and nothing crosses to D1: the prompt,
 * the search, and the result all stay on this machine, exactly like the filings half.
 *
 * A FINDING WITH NO URL IS NOT A FINDING. Same discipline as `assignedSearch`'s "no quote, no hit"
 * and `reachFor`'s "no source, no line" — dropped before it is ever rendered.
 *
 * ─── THE LINKEDIN LINE, AND WHY IT IS SAFE HERE AND NOT ON THE ADV HALF ────
 *
 * Her words, 25 Sep 2026: "why the fuck can u not just search linkedin and give me the linkedin
 * account of the person". For a press/podcast lead the answer is: it can, and does. Once a name is
 * already identified by a dated, quoted article, ONE further public web search for that specific
 * name plus organisation is enough to surface their actual profile URL from a search engine's own
 * index — nothing here logs into LinkedIn, fetches the page, or automates a browser against it. The
 * same boundary as the composed search link: no credential, no session, no scrape. This is not
 * offered for `filing-hunt.mjs`'s OWN Form ADV people (`peopleFor`/`reachFor`) on purpose — a name
 * off a regulatory filing has no independent corroboration, and a search engine confidently
 * returning the WRONG "John Smith at Blue Chip Capital" is exactly the Forge Global Holdings mistake
 * in a new costume. A press/podcast finding already carries a citation identifying the specific
 * person; that is what makes one further targeted search safe to trust.
 *
 * `spawnImpl` IS INJECTED, the same convention `claudeCodeExecutor` itself uses, defaulting to the
 * real process. A test passes a fake, so this whole function is exercised without spending anything
 * or invoking the CLI.
 */
export async function pressPodcastLeads(asset, size, side, { model, maxSeconds = 180, spawnImpl } = {}) {
  const { claudeCodeExecutor } = await import("../sync-agent/backends/claudeCode.mjs");
  const { mkdtempSync } = await import("node:fs");
  const cwd = mkdtempSync(path.join(os.tmpdir(), "ledger-hunt-"));
  const verb = side === "sell" ? "holding, dealing in, or having secondary-market exposure to" : "wanting to buy or add to a position in";
  const prompt = [
    `Search press releases, news coverage, and podcast transcripts or show notes — NOT SEC filings —`,
    `for named funds, family offices, or individuals who have PUBLICLY, ON THE RECORD, discussed`,
    `${verb} "${asset}" shares${size ? ` at a scale near ${money(size)}` : ""}.`,
    ``,
    `For EVERY finding, give: a name, an organisation, a one-sentence quote or close paraphrase of`,
    `what they said, a working source URL for that quote, whether it is press or podcast, and a`,
    `published date if you can find one. A finding with no working URL must be dropped, not printed —`,
    `an invented citation is worse than no finding at all.`,
    ``,
    `THEN, for each named person only (not organisations), do ONE further web search — their name plus`,
    `their organisation — to see if a LinkedIn profile URL for that specific person appears in the`,
    `search results. Do not log in to LinkedIn, fetch a LinkedIn page, or automate a browser against`,
    `it — a plain web search only. Include the URL ONLY if a search result plainly names this exact`,
    `person at this exact organisation — never a same-name person elsewhere, and never a URL you`,
    `constructed by guessing a pattern. If you are not sure it is the same person, leave it out; a`,
    `wrong profile handed to her as a fact is worse than no profile at all.`,
    ``,
    `Write your findings as JSON to ./delivers.json, nothing else in that file:`,
    `{"status":"complete","leads":[{"name":"...","org":"...","role":"...","evidence_quote":"...","source_url":"...","kind":"press"|"podcast","published_date":"...","linkedin_url":"..."}]}`,
    `Omit linkedin_url entirely (not an empty string) where you found no confident match.`,
    ``,
    `If you find nothing that clears this bar, write {"status":"complete","leads":[]} — that is a`,
    `valid, complete answer. Coming back empty is fine. A guess dressed up as a finding is not.`,
  ].join("\n");
  const result = await claudeCodeExecutor(
    { envelope: { web_tools: ["WebSearch", "WebFetch"], model, max_seconds: maxSeconds }, prompt, cwd },
    { spawnImpl },
  );
  const leads = (result.delivers?.leads ?? []).filter((l) => l && l.source_url)
    // A linkedin_url must actually look like one — a hallucinated non-URL string is dropped rather
    // than printed as though it were a link she could click.
    .map((l) => (l.linkedin_url && /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(l.linkedin_url)
      ? l : { ...l, linkedin_url: undefined }));
  return {
    leads,
    note: result.error
      ? `the search could not complete: ${result.error}`
      : leads.length ? null : "searched; nothing cleared the bar (a name with no working source URL is dropped, not printed)",
  };
}

/**
 * DANIELLE'S SECTION, PRESS AND PODCAST HALF. Rendered beside `renderFilings`, under its own byline,
 * for the same reason the filings half is: the half she owns is the half she writes.
 */
export function renderPressPodcast(lines, press) {
  lines.push("  FROM PRESS AND PODCAST MENTIONS — Danielle");
  if (!press.leads.length) {
    lines.push(`    ${press.note ?? "nobody named"}`);
    return;
  }
  for (const l of press.leads) {
    lines.push(`    [${l.kind}] ${l.name}${l.org ? ` — ${l.org}` : ""}${l.role ? ` (${l.role})` : ""}`);
    lines.push(`      "${l.evidence_quote}"`);
    lines.push(`      ${l.published_date ? `${l.published_date}  ` : ""}${l.source_url}`);
    lines.push(l.linkedin_url
      ? `      LinkedIn: ${l.linkedin_url}`
      : `      LinkedIn: no confident match found by search — nothing was fetched or logged into`);
  }
}

// ─── Standalone ──────────────────────────────────────────────────────────────

/**
 * RUNNABLE ON ITS OWN, AND IT IS ALSO A LIBRARY. The duty runs it standalone so the research half has
 * a row of its own that can go red; `buyer-hunt.mjs` imports `researchLot` so a single request still
 * produces both halves in one email. One implementation either way — a second copy of the filings
 * logic behind the combined path is the defect this repository names most often.
 */
async function main() {
  const ARGS = process.argv.slice(2);
  const argOf = (n) => { const i = ARGS.indexOf(`--${n}`); return i === -1 ? null : ARGS[i + 1] ?? null; };
  const SIDE = (argOf("side") ?? "buy").toLowerCase() === "sell" ? "sell" : "buy";
  const HER_SIDE = SIDE === "sell" ? "buy" : "sell";
  const asset = argOf("asset");
  const size = Number(argOf("size") ?? 0);

  const { parseLiveBook } = await import("../../src/shared/boss/intake/liveBook.mjs");
  const DIR = process.env.BOSS_OS_CAPITAL_DIR ?? path.join(os.homedir(), ".boss-os", "capital");
  const BOOK_TEXT = argOf("book") ?? path.join(DIR, "book.txt");

  let lots;
  if (asset) {
    lots = [{ asset, side: HER_SIDE, size_usd: size || null, size_text: size ? money(size) : "" }];
  } else {
    // The pulled mirror is the book when there is one — see lib/book-mirror.mjs for the week this cost.
    const { mirrorOrStop } = await import("./lib/book-mirror.mjs");
    const mirror = argOf("book") ? null : mirrorOrStop();
    if (mirror) {
      lots = mirror.positions.filter((l) => l.side === HER_SIDE);
    } else {
      if (!fs.existsSync(BOOK_TEXT)) {
        console.error(`NAMED STOP [NO_BOOK] ${BOOK_TEXT} does not exist and no --asset was given.`);
        console.error("  Email your book to boss@sequoiataylor.com with #monique, or pass --asset and --size.");
        process.exit(5);
      }
      lots = parseLiveBook(fs.readFileSync(BOOK_TEXT, "utf8")).positions.filter((l) => l.side === HER_SIDE);
    }
  }
  if (lots.length === 0) {
    console.error(`NAMED STOP [EMPTY_BOOK] the book was read and holds no ${HER_SIDE}-side line.`);
    process.exit(6);
  }

  const contacts = loadContacts();
  const lines = [
    `Filings research — ${lots.length} lot(s), ${new Set(lots.map((l) => String(l.asset).toLowerCase())).size} name(s).`,
    "13F is not consulted and that is deliberate: it covers exchange-traded securities only and",
    "returns zero for every name you hold. N-PORT is where a fund reports a private position.",
    "",
    "Nobody here has been contacted.",
    "",
  ];
  let candidates = 0;
  for (const lot of lots) {
    lines.push(`${String(lot.asset).toUpperCase()}`);
    const filings = await researchLot(lot.asset, lot.size_usd ?? 0, SIDE);
    candidates += filings.holders?.length ?? 0;
    renderFilings(lines, lot, filings, contacts, SIDE);
    lines.push("");
  }
  console.log(lines.join("\n"));

  /*
   * RULE 0: ZERO HOLDERS IS A RESULT AND IT SAYS SO. What is NOT permitted is exiting quietly having
   * read nothing — so the render above always states the names searched and the filing counts, and
   * "found nobody" and "never ran" cannot produce the same page.
   */
  if (candidates === 0) console.log("No holder cleared the bar. That is an answer: the names, the filing counts and the reason are above.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`FILING HUNT FAILED: ${err?.stack ?? err}`); process.exit(1); });
}

