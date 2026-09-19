#!/usr/bin/env node
/**
 * Put this morning's live market data in the report's workspace, so the run never types a price.
 *
 * ─── Why this exists (CONFIRMED, 19 September 2026) ────────────────────────
 *
 * The Executive Intelligence Report's dashboard that morning read S&P 500 7,637.76 (+1.1%), Nasdaq
 * 26,418.3 (+1.7%), Dow 51,778.04 (+0.6%) — each with a citation beside it. Yahoo's chart endpoint
 * for the same Friday close: 7,650.5 (+0.17%), 26,522.5 (+0.40%), 51,682.6 (−0.18%). Three of three
 * wrong, in the one section that orients every other one, on the screen a registered representative
 * reads before she trades. The $72 Brent figure a week earlier was the same defect.
 *
 * A citation proves where a number CLAIMS to come from. It cannot prove the number. The only
 * dashboard that can be checked is one the system builds from a feed it opened itself — so this
 * opens the feeds, writes what they said with the URL and the instant, and the Worker builds the
 * table from the file. The model reads MARKETS.json and cites it; it does not author it.
 *
 * ─── The feeds, and why these two ──────────────────────────────────────────
 *
 *   · Yahoo Finance's chart endpoint (query1.finance.yahoo.com/v8/finance/chart/{symbol}). Free, no
 *     key, answers indices, futures front-months, crypto and the SPCX listing in one shape, and
 *     returns the session's own timestamp so a Saturday morning is labelled "Friday close" from the
 *     data rather than from a guess.
 *   · The U.S. Treasury's daily par-yield CSV. Tier 1 — the issuer's own number for the 2- and
 *     10-year, which is the figure the file's report hinges its whole macro read on.
 *
 * Both were probed from this machine before being named here. Stooq's CSV quote endpoint was tried
 * first and returned "the page you requested does not exist"; FRED needs a key. Nothing here is
 * paid and nothing here needs a credential.
 *
 * ─── It fails soft, per figure, and says so ────────────────────────────────
 *
 * A feed that refuses one symbol writes that symbol with `value: null` and the reason, and the
 * Worker renders the row "not available at HH:MM CT". A run that finds no MARKETS.json at all is
 * told so by its prompt and falls back to citing what it opens. Nothing here can stop the report;
 * it can only make one honest.
 *
 * Rule 0: exit 0 only having written the file. Zero quotes answered is exit 1 with the ledger
 * printed, because a snapshot that wrote nothing and said nothing is the failure this exists to end.
 *
 *   node scripts/ops/market-snapshot.mjs                 # writes ~/.boss-os/reports/MARKETS.json
 *   node scripts/ops/market-snapshot.mjs --print          # also prints the table
 *   BOSS_OS_REPORT_WORKSPACE=/tmp/x node scripts/ops/market-snapshot.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { registerTsResolve } from "../validate/lib/ts-resolve.mjs";

const WORKSPACE = process.env.BOSS_OS_REPORT_WORKSPACE ?? `${process.env.HOME}/.boss-os/reports`;
const UA = "Mozilla/5.0 (Macintosh) boss-os market-snapshot";
const TIMEOUT_MS = 15_000;

/** The watchlist and the feed URLs come from the spec module — one list, not a copy of it. */
async function loadSpec() {
  registerTsResolve();
  const here = new URL("../../src/worker/boss/duties/briefingSpec.ts", import.meta.url);
  return import(here.href);
}

async function getText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, signal: ctrl.signal, redirect: "follow" });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: "", error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err) };
  } finally {
    clearTimeout(t);
  }
}

/** One Yahoo chart response → a MarketQuote. Never throws; a bad shape is a null value with a reason. */
export function quoteFromYahoo(entry, url, body, fetchedAt) {
  const base = { symbol: entry.symbol, label: entry.label, kind: entry.kind, session_note: entry.session_note, source_url: url, fetched_at: fetchedAt };
  let parsed;
  try { parsed = JSON.parse(body); } catch { return { ...base, value: null, change_pct: null, previous_close: null, as_of: null, error: "not JSON" }; }
  const result = parsed?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") {
    const why = parsed?.chart?.error?.description ?? "no regularMarketPrice in the response";
    return { ...base, value: null, change_pct: null, previous_close: null, as_of: null, error: String(why) };
  }
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close)
    ? result.indicators.quote[0].close.filter((c) => typeof c === "number")
    : [];
  // The prior session's close is the second-last close when the last one is today's; Yahoo also
  // names it on the meta on most symbols. Prefer the meta, fall back to the series.
  const prev = typeof meta.previousClose === "number"
    ? meta.previousClose
    : closes.length >= 2 ? closes[closes.length - 2] : null;
  const change = typeof meta.regularMarketChangePercent === "number"
    ? meta.regularMarketChangePercent
    : prev ? ((meta.regularMarketPrice - prev) / prev) * 100 : null;
  return {
    ...base,
    value: meta.regularMarketPrice,
    change_pct: change === null ? null : Number(change.toFixed(3)),
    previous_close: prev,
    as_of: typeof meta.regularMarketTime === "number" ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    closes,
  };
}

/** The Treasury CSV → quotes for the tenors on the watchlist. First data row is the newest day. */
export function quotesFromTreasury(entries, url, body, fetchedAt) {
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = (lines[0] ?? "").split(",").map((h) => h.replace(/"/g, "").trim());
  const today = (lines[1] ?? "").split(",").map((v) => v.replace(/"/g, "").trim());
  const prior = (lines[2] ?? "").split(",").map((v) => v.replace(/"/g, "").trim());
  const col = { US2Y: "2 Yr", US10Y: "10 Yr", US30Y: "30 Yr" };
  const out = [];
  for (const entry of entries) {
    const base = { symbol: entry.symbol, label: entry.label, kind: entry.kind, session_note: entry.session_note, source_url: url, fetched_at: fetchedAt };
    const i = header.indexOf(col[entry.symbol] ?? "");
    const v = i >= 0 ? Number(today[i]) : NaN;
    if (!Number.isFinite(v)) { out.push({ ...base, value: null, change_pct: null, previous_close: null, as_of: null, error: "tenor not in the CSV" }); continue; }
    const p = i >= 0 ? Number(prior[i]) : NaN;
    const dateParts = (today[0] ?? "").split("/");
    // The CSV's date is the trading day; the par curve is struck at the 3:30pm close, New York.
    const asOf = dateParts.length === 3 ? new Date(Date.UTC(Number(dateParts[2]), Number(dateParts[0]) - 1, Number(dateParts[1]), 19, 30)).toISOString() : null;
    out.push({
      ...base,
      value: v,
      // Yields move in points, so "change" here is the day's move in percentage points, not a percentage of the yield.
      change_pct: Number.isFinite(p) ? Number((v - p).toFixed(3)) : null,
      previous_close: Number.isFinite(p) ? p : null,
      as_of: asOf,
    });
  }
  return out;
}

export async function snapshot({ workspace = WORKSPACE, fetchText = getText, now = () => new Date() } = {}) {
  const spec = await loadSpec();
  const fetchedAt = now().toISOString();
  const consulted = [];
  const quotes = [];

  const yahooEntries = spec.MARKET_WATCHLIST.filter((w) => w.kind !== "yield");
  const yieldEntries = spec.MARKET_WATCHLIST.filter((w) => w.kind === "yield");

  await Promise.all(yahooEntries.map(async (entry) => {
    const url = spec.MARKET_FEEDS.yahoo_chart.replace("{symbol}", encodeURIComponent(entry.symbol));
    const res = await fetchText(url);
    consulted.push({ url, status: res.ok ? `HTTP ${res.status}` : res.error ?? `HTTP ${res.status}`, fetched_at: fetchedAt });
    quotes.push(res.ok
      ? quoteFromYahoo(entry, url, res.body, fetchedAt)
      : { symbol: entry.symbol, label: entry.label, kind: entry.kind, session_note: entry.session_note, source_url: url, fetched_at: fetchedAt, value: null, change_pct: null, previous_close: null, as_of: null, error: res.error ?? `HTTP ${res.status}` });
  }));

  if (yieldEntries.length) {
    const year = String(now().getUTCFullYear());
    const url = spec.MARKET_FEEDS.treasury_par_yield_csv.replaceAll("{year}", year);
    const res = await fetchText(url);
    consulted.push({ url, status: res.ok ? `HTTP ${res.status}` : res.error ?? `HTTP ${res.status}`, fetched_at: fetchedAt });
    if (res.ok) quotes.push(...quotesFromTreasury(yieldEntries, url, res.body, fetchedAt));
    else for (const e of yieldEntries) quotes.push({ symbol: e.symbol, label: e.label, kind: e.kind, session_note: e.session_note, source_url: url, fetched_at: fetchedAt, value: null, change_pct: null, previous_close: null, as_of: null, error: res.error ?? `HTTP ${res.status}` });
  }

  // Watchlist order, so the file reads the way the table will.
  quotes.sort((a, b) => spec.MARKET_WATCHLIST.findIndex((w) => w.symbol === a.symbol) - spec.MARKET_WATCHLIST.findIndex((w) => w.symbol === b.symbol));

  const data = { fetched_at: fetchedAt, quotes, consulted };
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "MARKETS.json"), JSON.stringify(data, null, 2));
  return data;
}

async function main() {
  const data = await snapshot();
  const answered = data.quotes.filter((q) => q.value !== null).length;
  for (const q of data.quotes) {
    console.log(`${q.value === null ? "✗" : "✓"} ${q.label.padEnd(24)} ${q.value === null ? `not available — ${q.error}` : `${q.value} (${q.change_pct === null ? "—" : (q.change_pct >= 0 ? "+" : "") + q.change_pct}) as of ${q.as_of}`}`);
  }
  console.log(`MARKETS.json written to ${WORKSPACE} — ${answered} of ${data.quotes.length} quotes answered from ${data.consulted.length} fetch(es).`);
  if (answered === 0) {
    console.error("NAMED STOP [MARKET_FEEDS_SILENT] No feed answered a single quote. The file records every refusal; the report will say so.");
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
