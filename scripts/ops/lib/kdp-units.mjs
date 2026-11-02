/**
 * KDP UNITS SOLD — pure parsing, no browser.
 *
 * The reports dashboard at https://kdp.amazon.com/en_US/reports-new loads its numbers through its
 * own XHR/fetch calls; `kdp-units.mjs` captures those JSON responses while the page loads and hands
 * them here. When nothing was captured (a dashboard redesign, a request that failed to fire) the
 * caller falls back to the page's own rendered text.
 *
 * RULE 0, as a pure function: `parseUnits` throws rather than returning `{}` when neither source
 * yields a single day of units. An empty object would read as a true zero sold; only a page that
 * was actually read may report that.
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
  const raw = row?.date ?? row?.day ?? row?.orderDate ?? row?.reportDate ?? row?.royaltyDate ?? row?.label;
  if (!raw) return null;
  if (DAY_RE.test(raw)) return raw;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function unitsFromRow(row) {
  const raw = row?.units ?? row?.unitsSold ?? row?.orderedUnits ?? row?.netUnits ?? row?.unitsOrdered ?? row?.quantity ?? row?.value ?? row?.count;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/** Units sold per day, out of one of the dashboard's own captured JSON response bodies. */
export function daysFromCapturedJson(json) {
  const rows = Array.isArray(json) ? json
    : Array.isArray(json?.dataPoints) ? json.dataPoints
    : Array.isArray(json?.data) ? json.data
    : Array.isArray(json?.rows) ? json.rows
    : Array.isArray(json?.reportData) ? json.reportData
    : Array.isArray(json?.results) ? json.results
    : [];
  const out = [];
  for (const row of rows) {
    const day = dayFromRow(row);
    const units = unitsFromRow(row);
    if (day && Number.isFinite(units)) out.push({ day, units });
  }
  return out;
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
 * Throws when neither source parsed a single day — never returns `{}` as if that were a real zero.
 */
export function parseUnits({ captured = [], text = "" } = {}) {
  const fromCapture = captured.flatMap((j) => daysFromCapturedJson(j));
  const rows = fromCapture.length ? fromCapture : daysFromPageText(text);
  if (!rows.length) throw new Error("no day of units could be parsed from the captured JSON or the page text");
  return { days: mergeDays(rows), source: fromCapture.length ? "capture" : "text" };
}
