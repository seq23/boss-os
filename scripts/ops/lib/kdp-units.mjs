/**
 * KDP UNITS SOLD — pure parsing, no browser.
 *
 * The reports dashboard at https://kdp.amazon.com/en_US/reports-new loads its numbers through its
 * own XHR/fetch calls; `kdp-units.mjs` captures those JSON responses while the page loads and hands
 * them here. When nothing was captured (a dashboard redesign, a request that failed to fire) the
 * caller falls back to the page's own rendered text.
 *
 * RULE 0, as a pure function: `parseUnits` throws rather than returning `{}` when NOTHING recognisable
 * came back from either source — that is a page that was not read. It does NOT throw when a known
 * widget response was recognised but its own array was empty: confirmed live against
 * kdpreports.amazon.com, 2 Nov 2026, `histogramOverview/ORDERS` answers `{ histogram: { data: [],
 * title: "OrdersForLast30Days" } }` on a day two brand-new titles genuinely sold nothing — a real
 * zero, from a page that was actually read. Collapsing "recognised, empty" into the same bucket as
 * "nothing recognised at all" would have reported the first repair's own fix as still broken, on this
 * very account, on the day it shipped.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function isoFromMonthDayYear(month, day, year) {
  const mm = MONTHS[month.toLowerCase().slice(0, 3)];
  if (!mm) return null;
  return `${year}-${mm}-${String(day).padStart(2, "0")}`;
}

function dayFromRow(row) {
  const raw = row?.date ?? row?.day ?? row?.orderDate ?? row?.reportDate ?? row?.royaltyDate ?? row?.label ?? row?.x;
  if (!raw) return null;
  if (DAY_RE.test(raw)) return raw;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function unitsFromRow(row) {
  const raw = row?.units ?? row?.unitsSold ?? row?.orderedUnits ?? row?.netUnits ?? row?.unitsOrdered ?? row?.quantity ?? row?.value ?? row?.count ?? row?.y;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

const ARRAY_KEYS = ["dataPoints", "data", "rows", "reportData", "results"];

/**
 * The array of per-day rows inside one captured JSON body, wherever it is nested, plus whether a
 * known shape was found at all (an empty array still counts as found — it is what a real read says
 * on a day with nothing to report).
 *
 * CONFIRMED LIVE, 2 Nov 2026: `kdpreports.amazon.com`'s own dashboard histogram call
 * (`/reports/dashboard/histogramOverview/ORDERS`) returns `{ histogram: { data: [...], title,
 * props } }` — the series is one level under a named widget key, not at the top. The first PR's
 * parser only ever checked the top level, so a real response it had never seen never parsed and
 * the page read "no day of units could be parsed" even though the JSON was captured fine.
 */
function widgetRows(json) {
  if (Array.isArray(json)) return { found: true, rows: json };
  for (const key of ARRAY_KEYS) if (Array.isArray(json?.[key])) return { found: true, rows: json[key] };
  for (const outer of Object.values(json ?? {})) {
    if (!outer || typeof outer !== "object" || Array.isArray(outer)) continue;
    for (const key of ARRAY_KEYS) if (Array.isArray(outer[key])) return { found: true, rows: outer[key] };
  }
  return { found: false, rows: [] };
}

/** Units sold per day, out of one of the dashboard's own captured JSON response bodies. */
export function daysFromCapturedJson(json) {
  const out = [];
  for (const row of widgetRows(json).rows) {
    const day = dayFromRow(row);
    const units = unitsFromRow(row);
    if (day && Number.isFinite(units)) out.push({ day, units });
  }
  return out;
}

/** Did any captured body match a known widget shape, even with nothing in it? */
function anyWidgetRecognised(captured) {
  return captured.some((j) => widgetRows(j).found);
}

/** Fallback: a day and a trailing count on the same line of the dashboard's own rendered text. */
export function daysFromPageText(text) {
  const out = [];
  const lineRe = /\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b.{0,60}?(\d+)\s*$/;
  for (const line of String(text ?? "").split("\n")) {
    const m = lineRe.exec(line.trim());
    if (!m) continue;
    const day = isoFromMonthDayYear(m[1], m[2], m[3]);
    const units = Number(m[4]);
    if (day && Number.isFinite(units)) out.push({ day, units });
  }
  return out;
}

/** Same-day rows summed to one count per day — numbers only, never a title or a dollar. */
export function mergeDays(rows) {
  const days = {};
  for (const { day, units } of rows) {
    if (!DAY_RE.test(day)) continue;
    days[day] = (days[day] ?? 0) + Number(units || 0);
  }
  return days;
}

/**
 * The one entry point. `captured` is an array of JSON bodies read off the network while the reports
 * page loaded; `text` is the page's rendered body, used only when no capture yielded a day.
 *
 * Throws only when NOTHING recognisable came back from either source — that is an unread page.
 * A recognised widget whose own array was empty is a real zero and is returned as `{}`, never
 * mistaken for a page that was not read.
 */
export function parseUnits({ captured = [], text = "" } = {}) {
  const fromCapture = captured.flatMap((j) => daysFromCapturedJson(j));
  if (fromCapture.length) return { days: mergeDays(fromCapture), source: "capture" };
  const fromText = daysFromPageText(text);
  if (fromText.length) return { days: mergeDays(fromText), source: "text" };
  if (anyWidgetRecognised(captured)) return { days: {}, source: "capture" };
  throw new Error("no day of units could be parsed from the captured JSON or the page text");
}

// ─── THE REPORTS PAGES, PER TITLE: UNITS AND KINDLE UNLIMITED PAGES (8 Nov 2026) ─────────────────
//
// ROOT CAUSE of "no day of units could be parsed" (every run since 2 Nov 2026): the dashboard lives
// on kdpreports.amazon.com, and kdp-units.mjs kept only responses whose URL matched /kdp\.amazon\.com/,
// which that host does not contain. Nothing was ever captured, and the text fallback looks for
// "Nov 1, 2026  3" lines the dashboard never prints ("01 Nov" axis labels). CONFIRMED live 8 Nov 2026.
//
// The dashboard also says nothing per title and nothing about Kindle Unlimited pages, which the KDP
// strategy (spry brain, 8 Nov 2026) judges each line by. So the read is now the Orders and KENP
// reports' own table calls, captured per title:
//   /reports/orders/table/titles        { histogram: { data: [{ bin: <ASIN>, values: {...} }] } }
//   /reports/kenp/table/titles          { histogram: { data: [{ bin: <ASIN>, values: { TotalKENP } }] } }   CONFIRMED live (41 + 17 pages)
//   /reports/{orders,kenp}/marketplaceHistogramV2  { nestedHistogram: { histogramList: [{ title: <day>, data: [{ bin: <marketplace>, values }] }] } }
//   /metadata/reports/reportsMetadata   { reportsMetadata: { books: { <key>: { titleName, asins: { digital, print } } } } }
// The orders row's value names were not seen with a sale in them (none since July); `unitsOf` takes
// Amazon's Total* order/unit field and never adds a royalty or a currency amount. SUSPECTED until the
// first sale is read; the KENP shape is CONFIRMED.

const ORDERS_TABLE = /\/reports\/orders\/table\/titles$/;
const KENP_TABLE = /\/reports\/kenp\/table\/titles$/;
const ORDERS_DAYS = /\/reports\/orders\/marketplaceHistogramV2$/;
const KENP_DAYS = /\/reports\/kenp\/marketplaceHistogramV2$/;
const METADATA = /\/metadata\/reports\/reportsMetadata$/;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Units in one orders row's `values`: Amazon's total order/unit count, never money. Pure. */
export function unitsOf(values = {}) {
  for (const k of ["TotalOrders", "TotalUnits", "TotalUnitsOrdered", "NetUnitsSold", "UnitsSold"]) if (k in values) return num(values[k]);
  const k = Object.keys(values).find((x) => /^total/i.test(x) && /order|unit/i.test(x) && !/royalt|amount|price|kenp/i.test(x));
  return k ? num(values[k]) : 0;
}
/** Free (promotion) units in one orders row, when Amazon splits them out. Pure. */
export const freeUnitsOf = (values = {}) => Object.entries(values).filter(([k]) => /free/i.test(k) && /order|unit/i.test(k)).reduce((a, [, v]) => a + num(v), 0);
export const kenpOf = (values = {}) => num(values.TotalKENP ?? values.TotalMarketplaceKENP ?? values.KENP ?? 0);

const rowsOf = (body) => (Array.isArray(body?.histogram?.data) ? body.histogram.data : null);
function seriesOf(body, valueOf) {
  const list = body?.nestedHistogram?.histogramList;
  if (!Array.isArray(list)) return null;
  const out = {};
  for (const h of list) {
    const day = String(h?.title ?? "").slice(0, 10);
    if (!DAY_RE.test(day)) continue;
    out[day] = (out[day] ?? 0) + (h.data ?? []).reduce((a, r) => a + valueOf(r?.values ?? {}), 0);
  }
  return out;
}

/** ASIN → title, from the reports' own metadata call. Pure. */
export function titlesByAsin(meta) {
  const out = {};
  for (const b of Object.values(meta?.reportsMetadata?.books ?? {})) {
    for (const a of Object.values(b?.asins ?? {})) if (typeof a === "string" && /^[A-Z0-9]{10}$/.test(a)) out[a] = b.titleName ?? null;
    if (b?.marketplaceAsin) out[b.marketplaceAsin] ??= b.titleName ?? null;
  }
  return out;
}

/**
 * The one entry point for the reports read. `captured` is `[{ path, body }]` (path = URL pathname)
 * for every kdpreports.amazon.com JSON response while /orders and /kenpc loaded. The last body for
 * each path wins (the page re-asks with the same window).
 *
 * Throws (an unread page, never a zero) when either per-title table is missing. Two tables that were
 * read and are empty are a real zero.
 */
export function parseReports({ captured = [], window = null } = {}) {
  const last = (re) => [...captured].reverse().find((c) => re.test(String(c?.path ?? "")))?.body;
  const orders = rowsOf(last(ORDERS_TABLE));
  const kenp = rowsOf(last(KENP_TABLE));
  if (!orders && !kenp) throw new Error("neither the Orders nor the KENP per-title table came back from kdpreports.amazon.com");
  if (!orders) throw new Error("the KENP table came back but the Orders per-title table did not");
  if (!kenp) throw new Error("the Orders table came back but the KENP per-title table did not");
  const names = titlesByAsin(last(METADATA));
  const titles = {};
  const row = (asin) => (titles[asin] ??= { title: names[asin] ?? null, units: 0, free_units: 0, kenp: 0 });
  for (const r of orders) { if (!r?.bin) continue; const t = row(r.bin); t.units += unitsOf(r.values); t.free_units += freeUnitsOf(r.values); }
  for (const r of kenp) { if (!r?.bin) continue; row(r.bin).kenp += kenpOf(r.values); }
  for (const [asin, title] of Object.entries(names)) if (title && !titles[asin]) titles[asin] = { title, units: 0, free_units: 0, kenp: 0 };
  const sum = (k) => Object.values(titles).reduce((a, t) => a + t[k], 0);
  return {
    window,
    days: seriesOf(last(ORDERS_DAYS), unitsOf) ?? {},
    kenp_days: seriesOf(last(KENP_DAYS), kenpOf) ?? {},
    titles,
    units_total: sum("units"),
    free_units_total: sum("free_units"),
    kenp_total: sum("kenp"),
    source: "reports",
  };
}

/** The window the reader asks Amazon for: `days` back from `now`, as the reports' own body fields. Pure. */
export function reportWindow(now, days) {
  const end = new Date(now);
  const start = new Date(end.getTime() - days * 86_400_000);
  return { startDate: `${start.toISOString().slice(0, 10)}T00:00:00Z`, endDate: `${end.toISOString().slice(0, 10)}T23:59:59Z` };
}

/** Rewrites a reports POST body to ask for `win`; anything not a JSON body with dates passes through. Pure. */
export function withWindow(postData, win) {
  try { const j = JSON.parse(postData); if (j && typeof j === "object" && "startDate" in j) return JSON.stringify({ ...j, ...win }); } catch {}
  return postData;
}

/** Is this response from the reports host? The root cause of the 2 Nov–8 Nov blank was this test. Pure. */
export function fromReports(url) {
  try { return /(^|\.)kdpreports\.amazon\.com$/.test(new URL(url).hostname); } catch { return false; }
}

/** One short line for the Monday OUTPUT line: "3 sold · 58 KU pages". Pure. */
export function salesLine(r) {
  if (!r || r.unread) return "sales not read";
  return `${r.units_total} sold · ${r.kenp_total} KU pages`;
}
