/**
 * THE MEASUREMENT LEDGER (brief noelle-v2 item 11, 24 Nov 2026). Every thing Noelle does that reaches the
 * world (a Studio post per platform, a bank or cadence PR, a Search Loop change, a pin refill) is one row:
 * kind, business, channel, item, when it goes out, the scoreboard measure it is judged on, and its day-30
 * and day-60 floors. Her weekly run and Monday's email read the rows back against the measure's readings,
 * so "she reads what earned and shifts the mix" can be checked against an outcome.
 *
 * Floors: a new format's own scorecard (G10: one number, floor30, floor60) when it has one; otherwise the
 * measure's 28-day reading on the day she acted ("hold or grow": an action that left the channel lower
 * than before missed). A measure that was not read gives no floor, and its result is "not read", never met.
 *
 * RULE 0: a result is "met" or "missed" only from a real reading; no reading → "not read"; too early →
 * "not yet". A summary with nothing old enough says so with the ledger's first day, never an empty line.
 * Pure: no I/O. The Worker (src/worker/boss/growth/noelle.ts) stores and reads the rows.
 */
export const LEDGER_KINDS = Object.freeze(["studio-plan", "job-target", "search-loop", "page-new", "pin-refill"]);
export const MAX_ACTED = 60;
/** A day-30 reading is looked for in the week after day 30 (readings are daily; a missed week is "not read"). */
export const READ_WINDOW_DAYS = 7;
const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Her channel names as the scoreboard spells them. */
export const MEASURE_CHANNEL = Object.freeze({ "facebook-page": "facebook", "search-pages": "google-search" });
/** With no measure on the channel itself, the business's own result, in this order (money last: it lags). */
const FALLBACK_KINDS = ["sales", "requests", "installs", "money"];
/**
 * The scoreboard measure an action on (business, channel) is judged on: the channel's own (English first),
 * else the business's "all", else its first sales, requests, installs or money measure. Never an AI-answers count.
 */
export function measureFor(manifest, business, channel) {
  const ms = (manifest?.scoreboard?.measures ?? []).filter((m) => m.business === business && m.kind !== "answers");
  const ch = MEASURE_CHANNEL[channel] ?? channel;
  const own = ms.filter((m) => m.channel === ch);
  return own.find((m) => m.language === "en") ?? own[0] ?? ms.find((m) => m.channel === "all" && m.kind !== "money")
    ?? FALLBACK_KINDS.map((k) => ms.find((m) => m.kind === k)).find(Boolean) ?? null;
}

/** One acted row from the Mac, checked; null when it is not one. Text is never kept beyond the item id. */
export function cleanActed(a, rosterKeys) {
  if (!a || typeof a !== "object") return null;
  if (!LEDGER_KINDS.includes(a.kind) || !rosterKeys.has(a.business) || !SLUG.test(String(a.channel ?? ""))) return null;
  const item = String(a.item ?? "").replace(/[^\w.#:/-]+/g, "").slice(0, 120);
  if (!item) return null;
  const at = typeof a.at === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(a.at) ? a.at : null;
  const sc = a.scorecard && Number.isFinite(Number(a.scorecard.floor30)) && Number.isFinite(Number(a.scorecard.floor60))
    ? { floor30: Number(a.scorecard.floor30), floor60: Number(a.scorecard.floor60) } : null;
  return { kind: a.kind, business: a.business, channel: a.channel, item, at, scorecard: sc };
}

/** The floors for one action: its scorecard's, else the measure's reading that day, else none (not read). */
export function floorsFor(scorecard, baseline) {
  if (scorecard) return { floor30: scorecard.floor30, floor60: scorecard.floor60, source: "scorecard" };
  if (Number.isFinite(baseline)) return { floor30: baseline, floor60: baseline, source: "baseline" };
  return { floor30: null, floor60: null, source: "not read" };
}

/**
 * One result at day `n` (30 or 60): the first reading on or after day n, within READ_WINDOW_DAYS.
 * readings: [{ day, value, unread }] for the row's measure.
 */
export function resultAt(row, readings, today, n) {
  const from = addDays(String(row.day), n);
  if (today < from) return "not yet";
  const floor = n === 30 ? row.floor30 : row.floor60;
  if (!row.measure || floor === null || floor === undefined) return "not read";
  const to = addDays(from, READ_WINDOW_DAYS);
  const r = (readings ?? []).filter((x) => x.day >= from && x.day <= to).sort((a, b) => (a.day < b.day ? -1 : 1))[0];
  if (!r || r.unread || !Number.isFinite(Number(r.value)) || r.value === null) return today > to || r ? "not read" : "not yet";
  return Number(r.value) >= Number(floor) ? "met" : "missed";
}

/**
 * Results against floors, one line per business · channel · kind with an action past day 30.
 * rows: ledger rows { day, kind, business, channel, measure, floor30, floor60 }.
 * readingsByMeasure: { [measure]: [{ day, value, unread }] }.
 */
export function resultLines(rows, readingsByMeasure, { today, labels = {}, names = {} } = {}) {
  const all = Array.isArray(rows) ? rows : [];
  if (!all.length) return ["Results against floors: the ledger has no action yet."];
  const first = all.map((r) => r.day).filter((d) => DAY.test(d)).sort()[0];
  const groups = new Map();
  for (const r of all) {
    const r30 = resultAt(r, readingsByMeasure?.[r.measure], today, 30);
    if (r30 === "not yet") continue;
    const r60 = resultAt(r, readingsByMeasure?.[r.measure], today, 60);
    const k = `${r.business}\u0000${r.channel}\u0000${r.kind}`;
    const g = groups.get(k) ?? { r, n: 0, met30: 0, missed30: 0, unread30: 0, met60: 0, missed60: 0 };
    g.n++; g[r30 === "met" ? "met30" : r30 === "missed" ? "missed30" : "unread30"]++;
    if (r60 === "met") g.met60++; else if (r60 === "missed") g.missed60++;
    groups.set(k, g);
  }
  if (!groups.size) return [`Results against floors: no action is 30 days old yet (the ledger started ${first}; the first results come ${addDays(first, 30)}).`];
  const out = ["Results against floors (each action's measure 30 and 60 days after it went out):"];
  for (const g of [...groups.values()].sort((a, b) => (a.r.business + a.r.channel < b.r.business + b.r.channel ? -1 : 1))) {
    const who = `${labels[g.r.business] ?? g.r.business} · ${names[g.r.channel] ?? g.r.channel} · ${g.r.kind}`;
    const parts = [`${g.met30} met`, `${g.missed30} missed`];
    if (g.unread30) parts.push(`${g.unread30} not read`);
    const sixty = g.met60 + g.missed60 ? `; day 60: ${g.met60} met, ${g.missed60} missed` : "";
    out.push(`${who}: ${g.n} past day 30: ${parts.join(", ")}${sixty}`);
  }
  return out;
}
