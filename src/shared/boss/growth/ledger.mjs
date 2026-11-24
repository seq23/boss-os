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
export const LEDGER_KINDS = Object.freeze(["studio-plan", "job-target", "search-loop", "page-new", "pin-refill", "post"]);
/** A post's receipt: the id the platform (or Buffer) gave it when it accepted the post. */
const RECEIPT = /^[\w.:-]{1,80}$/;
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
  // H5: a post is ledgered only on the platform's confirmation, so it carries the receipt id in its item.
  if (a.kind === "post" && !(RECEIPT.test(String(a.receipt?.id ?? "")) && item.endsWith(`:${a.receipt.id}`))) return null;
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

// ─── H5: posting jobs write their own rows (24 Nov 2026) ───────────────────────────────────────────────

/** A posted file's run channel as the roster spells it (Peace Be Still's posted.json says "facebook"). */
export const RUN_CHANNEL = Object.freeze({ facebook: "facebook-page" });
const DAY_MS = 86_400_000;

/**
 * Every post a posting job recorded (`{ posts: { <id>: { runs: [{ channel?, buffer_id | id, queued_at }] } } }`,
 * written only after the platform accepted it) in the last `days` days, as ledger rows. One definition for
 * the posting jobs' writer (.github/actions/ledger-rows) and Monday's reconciliation (postsWithoutRows).
 */
export function ledgerRowsFrom(doc, { business, channel = null, now = Date.now(), days = 8, since = null }) {
  const from = Math.max(now - days * DAY_MS, since ? Date.parse(`${since}T00:00:00Z`) : 0);
  const rows = [];
  for (const [id, p] of Object.entries(doc?.posts ?? {})) {
    for (const r of Array.isArray(p?.runs) ? p.runs : []) {
      const receipt = String(r?.buffer_id ?? r?.id ?? "");
      const at = String(r?.queued_at ?? "");
      const ch = RUN_CHANNEL[r?.channel] ?? r?.channel ?? channel;
      if (!receipt || !ch || !(Date.parse(at) >= from)) continue;
      const item = `${String(id).replace(/[^\w.-]+/g, "").slice(0, 40)}:${receipt}`;
      rows.push({ kind: "post", business, channel: ch, item, receipt: { id: receipt }, at: new Date(Date.parse(at)).toISOString() });
    }
  }
  return rows;
}

/** Monday's H5 check: the posts on (business, channel) this week whose ledger row is missing. */
export function postsWithoutRows(doc, items, { business = "", channel, since = null, now = Date.now(), days = 7 }) {
  const have = new Set(items);
  const posted = ledgerRowsFrom(doc, { business, channel, now, days, since }).filter((r) => r.channel === channel);
  return { posted: posted.length, missing: posted.filter((r) => !have.has(r.item)).map((r) => r.item) };
}

/**
 * HER 14-DAY GROWTH REPORT (kept, coordinator decision 24 Nov 2026: "nothing people use gets taken away").
 * Same schedule (every 14 days from the setting growth_report_last_day, due from day 13) and the same slot
 * (the morning email's 📈 Growth section). Noelle's own run writes it when it finishes (POST /noelle/done),
 * built from the record, never from a model's paragraph: the ledger (noelle_actions), her backlink requests
 * (growth_decisions), her runs (noelle_runs) and the scoreboard readings. A number not read says "not read",
 * never 0.
 */
export const REPORT_EVERY_DAYS = 14;
export const REPORT_KEY = "growth_report_last_day";
export function reportDue(lastDay, today) {
  if (!DAY.test(String(lastDay ?? ""))) return true;
  return (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastDay}T12:00:00Z`)) / 86_400_000 >= REPORT_EVERY_DAYS - 1;
}
const WORDS = { money: (n) => `$${Math.round(n).toLocaleString("en-US")} in`, sales: (n) => `${n} ${n === 1 ? "sale" : "sales"}`, installs: (n) => `${n} ${n === 1 ? "install" : "installs"}`, requests: (n) => `${n} ${n === 1 ? "request" : "requests"}`, visits: (n) => `${n} ${n === 1 ? "visit" : "visits"}` };
/** "2 requests, $730 in" from a scoreboard summary's totals; null when nothing was read (never 0). */
export function numbersLine(summary) {
  const parts = Object.entries(summary?.totals ?? {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => WORDS[k]?.(v)).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
/** "Porch & Party requests: 2 of 4 by 23 Dec" from the Scorecard row; "not read yet", never 0. */
function floorLine(f, start, value, missing = []) {
  if (!f || !DAY.test(String(start ?? ""))) return null;
  const by = new Date(Date.parse(`${start}T12:00:00Z`) + f.by * 86_400_000).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
  const money = (n) => `${f.unit === "$" ? "$" : ""}${Math.round(n).toLocaleString("en-US")}`;
  if (value === null || value === undefined) return `${f.label}: not read yet (the floor is ${money(f.floor.value)} by ${by})`;
  const gap = missing.length ? ` (${missing.join(" and ")} not read yet)` : "";
  return `${f.label}: ${money(value)} of ${money(f.floor.value)} by ${by}${gap}`;
}
/** The two floor numbers: Porch & Party's requests, and money in across every business that tracks money; an unread business is NAMED, never summed as $0. */
export function floorValues(summaries, labelOf = (k) => k) {
  const first = summaries.find((x) => x.key === "porch-and-party")?.totals?.requests ?? null;
  const tracked = summaries.filter((x) => x.totals && "money" in x.totals);
  const read = tracked.filter((x) => typeof x.totals.money === "number");
  const missing = tracked.filter((x) => typeof x.totals.money !== "number").map((x) => labelOf(x.key));
  return { first, real: read.length ? read.reduce((a, x) => a + x.totals.money, 0) : null, realMissing: read.length ? missing : [] };
}
const KIND_WORDS = { post: ["post", "posts"], "pin-refill": ["pin refill", "pin refills"], "page-new": ["new page", "new pages"], "search-loop": ["Search Loop change", "Search Loop changes"], "studio-plan": ["Studio plan", "Studio plans"], "job-target": ["job target", "job targets"] };
const counted = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;
/**
 * The section object (morning_sections 'growth'). Line 1 says whether she must do anything (Noelle's lines
 * waiting on her Notices), then what went out in the 14 days, the floors, one line per business, her runs'
 * stops, and the ledger's results against floors.
 */
export function fortnightReport({ today, actions = [], orders = {}, runs = [], waiting = 0, summaries = [], scorecard = null, labels = {}, results = [], origin, at }) {
  const from = addDays(today, -(REPORT_EVERY_DAYS - 1));
  const acts = actions.filter((a) => DAY.test(String(a.day)) && a.day >= from && a.day <= today);
  const ordered = Object.values(orders).reduce((n, v) => n + (Number(v) || 0), 0);
  const label = (k) => labels[k] ?? summaries.find((x) => x.key === k)?.label ?? k;
  const byKind = (rows) => Object.entries(rows.reduce((m, a) => ({ ...m, [a.kind]: (m[a.kind] ?? 0) + 1 }), {})).map(([k, n]) => counted(n, KIND_WORDS[k] ?? [k, k]));
  const out = [...byKind(acts), ordered ? counted(ordered, ["backlink article requested", "backlink articles requested"]) : null].filter(Boolean);
  const lines = [
    `${waiting ? `${counted(waiting, ["line from Noelle waits", "lines from Noelle wait"])} for you on Notices.` : "Nothing to do."} ${out.length ? `In the 14 days to ${today} Noelle sent out ${out.join(", ")}.` : `Nothing new went out in the 14 days to ${today}; why, below.`}`,
  ];
  const fv = floorValues(summaries, label);
  const floors = [floorLine(scorecard?.first, scorecard?.start, fv.first), floorLine(scorecard?.real, scorecard?.start, fv.real, fv.realMissing)].filter(Boolean);
  if (floors.length) lines.push(`Against the floors: ${floors.join("; ")}.`);
  const keys = [...new Set([...summaries.map((s) => s.key), ...acts.map((a) => a.business), ...Object.keys(orders)])].filter((k) => labels[k] || summaries.some((s) => s.key === k));
  for (const k of keys.sort((a, b) => (label(a) < label(b) ? -1 : 1))) {
    const did = [...byKind(acts.filter((a) => a.business === k)), orders[k] ? counted(orders[k], ["backlink article requested", "backlink articles requested"]) : null].filter(Boolean).join(", ") || "nothing new sent out";
    lines.push(`${label(k)}: ${numbersLine(summaries.find((s) => s.key === k)) ?? "numbers not read"} in 28 days; ${did}.`);
  }
  const mine = runs.filter((r) => DAY.test(String(r.day)) && r.day >= from && r.day <= today);
  const days = new Set(mine.filter((r) => r.state === "done").map((r) => r.day)).size;
  const stops = {};
  for (const r of mine.filter((r) => r.state !== "done")) for (const s of (Array.isArray(r.stops) ? r.stops : [])) stops[s] = (stops[s] ?? 0) + 1;
  const stopText = Object.entries(stops).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}×`).join(", ");
  lines.push(`Her runs: ${days} of ${REPORT_EVERY_DAYS} days finished${stopText ? `; stopped: ${stopText}` : ""}.`);
  lines.push(...results);
  return { section: "growth", at: new Date(at).toISOString(), title: "📈 Growth, from Noelle", decide: [], rows: [], lines, link: { label: "See every business on the Growth page", url: `${origin}/?tab=growth` } };
}
