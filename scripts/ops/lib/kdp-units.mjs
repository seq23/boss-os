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
