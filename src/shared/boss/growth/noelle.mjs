/**
 * NOELLE, THE GROWTH DIRECTOR AS A CLAUDE AGENT (23 Nov 2026). Pure rules; no I/O.
 *
 * Her loop is Read → Decide → Act → Tell → Measure. The Mac run (scripts/ops/noelle.sh → noelle.mjs)
 * assembles every ledger into one context, Claude (ai-run --role brain, her two read-and-check tools) answers with ONE plan,
 * and THIS file judges every action of that plan before anything happens. The Worker judges the same
 * plan again with the same function when the run is recorded (POST /api/boss/growth/noelle/run): the
 * caller is never trusted. Anything this file refuses can only become a card or a line to Sequoia.
 *
 * What she may never do here (code, never a prompt rule): spend, open an account, raise a search-loop
 * cap (G4), post on a channel another job fills (G1), ask for photos (G2), touch P&P Pinterest (G3),
 * edit a client's live page (G9), wire a tag, pixel or form at run time (G17, G21), send email (G14),
 * close any Open Loops row but the eight growth# rows (G15), or run two tests for one business (rule 4).
 */
import { mayAct } from "./roster.mjs";
import { namingProblems, BACKLINKS } from "./director.mjs";
import { NO_TRACKING_DOMAINS } from "./taggedLink.mjs";
import SITES from "../searchReadiness/sites.json" with { type: "json" };

/** Every action kind a plan may carry. Anything else is refused UNKNOWN_KIND. */
export const KINDS = Object.freeze([
  "decision", "studio-plan", "job-target", "search-loop", "backlink", "proposal", "sequoia-line",
  "linked", "test", "outreach-target", "name-source", "post", "page-edit", "pin-refill", "page-new",
]);
/** Kinds a search-watch business may carry: search levers, the weekly read and her calls only (G8). */
export const WATCH_KINDS = Object.freeze(["decision", "search-loop", "page-new", "proposal", "sequoia-line", "name-source", "linked", "page-edit"]);

/**
 * G1: channels a scheduled job already fills. Noelle changes only that job's bank, plan.json or target
 * (`job-target`, or `studio-plan` for P&P Studio); she never posts there herself. "Full" is the job's
 * own queue length (`max`), never seven days.
 */
export const CHANNEL_OWNERS = Object.freeze({
  "peace-be-still:threads": { job: "pbs-threads", repo: "peace-be-still", max: 4 },
  "peace-be-still:instagram": { job: "pbs-instagram", repo: "peace-be-still", max: 3 },
  "peace-be-still:facebook-page": { job: "pbs-instagram", repo: "peace-be-still", max: 3 },
  "approvalprep:threads": { job: "ap-threads", repo: "approvalprep", max: 6 },
  "approvalprep:instagram": { job: "ap-brand-social", repo: "approvalprep", max: 3 },
  "approvalprep:pinterest": { job: "ap-pinterest", repo: "approvalprep", max: 10 },
  "dream-wedding:pinterest": { job: "dw-pinterest", repo: "dream-wedding-builder", max: 10 },
  "dream-wedding:instagram": { job: "dw-brand-social", repo: "dream-wedding-builder", max: 3 },
  "dream-wedding:tiktok": { job: "dw-brand-social", repo: "dream-wedding-builder", max: 3 },
  "a-player-mode:pinterest": { job: "apm-pinterest", repo: "sprylabs-hpc-site", max: 10 },
  "keepmyproof:blogger": { job: "kmp-syndication", repo: "keepmyproof", max: 4 },
  "keepmyproof:wordpress": { job: "kmp-syndication", repo: "keepmyproof", max: 4 },
  "porch-and-party:instagram": { job: "pnp-studio", repo: "creator-studios", max: 14 },
  "porch-and-party:tiktok": { job: "pnp-studio", repo: "creator-studios", max: 14 },
  "porch-and-party:facebook-page": { job: "pnp-studio", repo: "creator-studios", max: 14 },
  "porch-and-party:facebook-marketplace": { job: "pnp-marketplace", repo: "p-n-p", max: 20 },
});
/**
 * Where each owned job keeps the knobs she may turn (job-target), in its own repo's file. `target` is how
 * many posts wait in the queue; it never goes above the job's `max` (the free Buffer's slots: a paid slot is
 * money, her call). `bank` appends reviewed posts to the job's bank (text posts only: a picture bank needs
 * its renderer, a builder PR). A job with no entry here keeps its knobs in code: a builder PR, never hers.
 */
export const JOB_KNOBS = Object.freeze({
  "pbs-threads": { file: "data/threads/posts.json", target: "days_ahead", bank: "posts", idPrefix: "pbs" },
  "ap-threads": { file: "data/threads/posts.json", target: "days_ahead", bank: "posts", idPrefix: "t" },
  "pbs-instagram": { file: "data/instagram/posts.json", target: "posts_ahead" },
  "ap-brand-social": { file: "data/brand-social/plan.json", target: "per_channel_queue_max", posts_per_week: "posts_per_week" },
  "dw-brand-social": { file: "data/brand-social/plan.json", target: "per_channel_queue_max", posts_per_week: "posts_per_week" },
});
/** The fields of each owned job she may change (its bank, plan or target), and nothing else. */
export const JOB_FIELDS = Object.freeze(["bank", "posts_per_week", "topics", "target"]);

/** G13: how a roster channel is judged. Only `queue` channels are judged on scheduled days. */
export const CADENCE = Object.freeze(["queue", "weekly", "event", "by-hand", "none"]);
const CHANNEL_CADENCE = Object.freeze({
  instagram: "queue", tiktok: "queue", "facebook-page": "queue", threads: "queue", pinterest: "queue",
  blogger: "queue", wordpress: "queue", "facebook-marketplace": "queue",
  "search-pages": "weekly", backlinks: "weekly", "google-business-profile": "by-hand", "facebook-groups": "by-hand",
  kdp: "event", "app-store": "event",
});
export function cadenceOf(channel) {
  if (/by hand/i.test(String(channel?.note ?? ""))) return "by-hand";
  return CHANNEL_CADENCE[String(channel?.channel ?? channel ?? "")] ?? "none";
}

/**
 * G12 + G13: the read grid, business × channel × language, one row per shipped language. A cell with
 * no measure says "not read", never a zero. `measures` are scoreboard rows: { business, channel, language, value, unread }.
 */
export function readGrid(roster, measures) {
  const out = [];
  for (const e of roster) {
    if (e.tier === "search-watch") continue;
    for (const c of e.channels) for (const lang of (e.languages.length ? e.languages : ["en"])) {
      const m = measures.find((x) => x.business === e.key && x.channel === c.channel && (x.language ?? "en") === lang);
      out.push({ business: e.key, channel: c.channel, language: lang, cadence: cadenceOf(c), value: m && m.value != null ? m.value : null, read: m && m.value != null ? "read" : `not read${m?.unread ? `: ${m.unread}` : ""}` });
    }
  }
  return out;
}

/** P&P's season by Central day (Beyond the list): bookings first, then winter (rentals and events: there is
 * NO January takedown service, her ruling 23 Nov 2026), then spring. */
export function season(day) {
  const [, m, d] = String(day).split("-").map(Number);
  if (m === 12 && d >= 15) return "winter";
  if (m === 1 || m === 2) return "winter";
  if (m >= 3 && m <= 8) return "spring";
  return "christmas";
}
export const PIECE_THEMES = Object.freeze({
  christmas: ["christmas-porch", "party", "grazing", "rentals", "events", "office-party"],
  winter: ["rentals", "events", "party", "grazing"],
  spring: ["spring-porch", "party", "grazing", "rentals", "events"],
});
/** Corporate Christmas outreach runs 1 Sep to 5 Dec of the same year (full dates, so January never passes). */
export const CORPORATE_WINDOW = Object.freeze({ from: "09-01", to: "12-05" });
export const corporateOpen = (day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day)) && day >= `${day.slice(0, 4)}-${CORPORATE_WINDOW.from}` && day <= `${day.slice(0, 4)}-${CORPORATE_WINDOW.to}`;

/**
 * B2 + G14: every source of the weekly read. Each must be fresh (≤ STALE_DAYS) and get a decision per
 * business it serves; missing, stale or empty is a NAMED STOP. `businesses: "*"` = every roster business.
 */
export const STALE_DAYS = 8;
export const READ_SOURCES = Object.freeze([
  { id: "search-loop-week", businesses: "*", what: "search-loop week, cap and pages" },
  { id: "grid", businesses: "*", what: "the grid's lead, outcome and gold lines" },
  { id: "fixes-live", businesses: "*", what: "sr-fix and Ahrefs fixes live" },
  { id: "ai-misses", businesses: ["keepmyproof", "approvalprep", "dream-wedding", "a-player-mode", "peace-be-still", "porch-and-party"], what: "AI answer misses and the AI score" },
  { id: "scorecard", businesses: "*", what: "scorecard rows with no number or too early past day 30" },
  { id: "calendar", businesses: ["porch-and-party", "keepmyproof", "approvalprep", "dream-wedding", "a-player-mode", "peace-be-still"], what: "calendar fill" },
  { id: "kdp", businesses: ["approvalprep", "dream-wedding"], what: "KDP sales and new titles" },
  { id: "app-store", businesses: ["keepmyproof", "approvalprep", "dream-wedding", "a-player-mode", "peace-be-still"], what: "app-store ratings and the Play listing" },
  { id: "ap-email-nurture", businesses: ["approvalprep"], what: "ApprovalPrep email nurture" },
  { id: "dw-email-health", businesses: ["dream-wedding"], what: "Dream Wedding email health" },
  { id: "pbs-waitlist", businesses: ["peace-be-still"], what: "the Peace Be Still waitlist" },
  { id: "keepmyproof-monthly-watch", businesses: ["keepmyproof"], what: "KeepMyProof's monthly watch" },
  { id: "spry-weekly-summary", businesses: ["keepmyproof", "approvalprep", "dream-wedding", "a-player-mode", "peace-be-still"], what: "the *-spry-weekly-summary reports" },
  { id: "aplayer-mode-weekly-outcome-report", businesses: ["a-player-mode"], what: "A Player Mode's weekly outcome report" },
  { id: "link-prospects", businesses: "*", what: "link prospects" },
  { id: "entity-backlink-watch", businesses: "*", what: "the entity backlink watch" },
  { id: "wpp-llm-query-intelligence", businesses: ["wpp-llm"], what: "WPP-llm query intelligence" },
  { id: "guide-pinterest-rss", businesses: ["industry-guides"], what: "the guide sites' Pinterest RSS" },
  { id: "guide-leads", businesses: ["industry-guides"], what: "each guide site's lead_source count (G20)" },
  { id: "pnp-gbp-post", businesses: ["porch-and-party"], what: "the P&P Google Business Profile post" },
  { id: "pnp-valerie-texts", businesses: ["porch-and-party"], what: "Valerie's texts to past requesters" },
  { id: "pnp-photo-ask", businesses: ["porch-and-party"], what: "pnp-photo-ask's result (she never asks herself, G2)" },
  { id: "pnp-season-bookings", businesses: ["porch-and-party"], what: "bookings this season" },
  { id: "linked-todos", businesses: "*", what: "the roster's linked to-dos" },
]);
export function sourcesFor(key) {
  return READ_SOURCES.filter((s) => s.businesses === "*" || s.businesses.includes(key));
}

/**
 * The read's named stops. `reads` = { [sourceId]: { at, sha, rows, error } } as the Mac collected them.
 * A missing or failed read is NOT_READ, older than STALE_DAYS is STALE, zero rows is EMPTY.
 */
export function sourceProblems(reads, now) {
  const out = [];
  for (const s of READ_SOURCES) {
    const r = reads?.[s.id];
    if (!r || r.error) { out.push({ source: s.id, stop: "SOURCE_NOT_READ", why: `${s.what}: not read${r?.error ? ` (${String(r.error).slice(0, 120)})` : ""}` }); continue; }
    const at = Date.parse(r.at);
    if (!Number.isFinite(at) || now - at > STALE_DAYS * 86_400_000) { out.push({ source: s.id, stop: "SOURCE_STALE", why: `${s.what}: last written ${r.at ?? "never"}, over ${STALE_DAYS} days ago` }); continue; }
    if (!Number(r.rows)) out.push({ source: s.id, stop: "SOURCE_EMPTY", why: `${s.what}: read, but empty` });
  }
  return out;
}

/** G15: the ONLY Open Loops rows she closes, by source key. Everything else she keeps or changes. */
export const CLOSE_ONLY = Object.freeze([
  "growth#a-player-mode#pinterest#pin", "growth#approvalprep#search-pages#guide", "growth#dream-wedding#instagram#carousel",
  "growth#keepmyproof#blogger#guide-syndication", "growth#keepmyproof#wordpress#guide-syndication", "growth#peace-be-still#facebook-page#post",
  "growth#peace-be-still#instagram#post", "growth#porch-and-party#facebook-page#photo-set",
]);
/** G15: rows that stay open and become her weekly read items. */
export const KEEP_OPEN = Object.freeze(["olp_m80j27rk2cthq6jf", "olp_m80j27mr2tp3y0vd", "olp_m84qabp137xc5w7x"]);

/** G16f + A7: Claude calls. One run never passes RUN_CALLS; one week never passes WEEK_CALLS. */
export const RUN_CALLS = 40;
export const WEEK_CALLS = 220;
export function callBudget({ weekUsed = 0, runUsed = 0 }) {
  const left = Math.min(RUN_CALLS - runUsed, WEEK_CALLS - weekUsed);
  if (WEEK_CALLS - weekUsed <= 0) return { left: 0, stop: "NAMED STOP [WEEK_CALL_BUDGET] this week's Claude calls are spent; the next week's first run carries on" };
  if (RUN_CALLS - runUsed <= 0) return { left: 0, stop: "NAMED STOP [RUN_CALL_CAP] this run's Claude calls are spent; the next run carries on" };
  return { left, stop: null };
}

/**
 * A5 + G16d: the daily slot (10:00–21:59 Central, never on the hour, varies by day) and the weekly
 * deeper run (Thursday, after 14:00). Pure: the hour and minute come from a hash of the day.
 */
export function slotFor(day) {
  let h = 2166136261;
  for (const ch of String(day)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const weekly = weekday === 4;
  const hour = weekly ? 14 + (h % 7) : 10 + (h % 11); // 10..20 (a 20:xx run ends before 21:59); Thursday 14..20
  const minute = 1 + ((h >>> 8) % 58); // 1..58: never on the hour
  return { hour, minute, kind: weekly ? "weekly" : "daily" };
}

/** G16a: the morning line when no run row exists for a day by 22:00 Central. */
/** A #noelle call's run is keyed `call:<task id>`: one email, one run (the slot's unique index). */
export const CALL_SLOT = /^call:[A-Za-z0-9_-]{4,64}$/;
export const isCallSlot = (slot) => typeof slot === "string" && CALL_SLOT.test(slot);
/** A slot as the run row stores it: HH:MM for her schedule, call:<task id> for a call; anything else null. */
export function slotOf(slot) {
  if (typeof slot !== "string") return null;
  if (/^\d{2}:\d{2}$/.test(slot)) return slot;
  return isCallSlot(slot) ? slot : null;
}
/** Only her SCHEDULED run counts: a call that day never hides a missed daily run. */
export function didNotRunLine(runs, day) {
  return runs.some((r) => r.day === day && !isCallSlot(r.slot)) ? null : `Noelle did not run on ${day}: no run was recorded by 22:00 CT`;
}
/** G16b: the same named stop three days running becomes ONE line to Sequoia. */
export function escalations(allRuns) {
  const runs = allRuns.filter((r) => !isCallSlot(r.slot));
  const days = [...new Set(runs.map((r) => r.day))].sort().slice(-3);
  if (days.length < 3) return [];
  // "Running" means three calendar days in a row; a day with no run is NOELLE_DID_NOT_RUN's, not this.
  if (Date.parse(`${days[2]}T12:00:00Z`) - Date.parse(`${days[0]}T12:00:00Z`) !== 2 * 86_400_000) return [];
  const byDay = days.map((d) => new Set(runs.filter((r) => r.day === d).flatMap((r) => r.stops ?? [])));
  return [...byDay[0]].filter((s) => byDay.every((set) => set.has(s))).map((s) => ({ stop: s, line: `Noelle has stopped on ${s} three days running (${days[0]} to ${days[2]}); it needs a fix` }));
}

const money = (t) => [...String(t ?? "").matchAll(/\$\s?(\d[\d,]*(?:\.\d{2})?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
/** A price in a draft must be one the roster's offer line states (DW and BHPC wrong-price seeds, G11). */
export function priceProblems(text, entry) {
  const offered = new Set(money(entry?.offer));
  return money(text).filter((p) => !offered.has(p)).map((p) => `states $${p}, which is not a price on ${entry?.label ?? "the"} offer line`);
}
/** KMP's privacy promise (G17): no tagged link to keepmyproof.com in anything she writes. */
export function taggedLinkProblems(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/https?:\/\/[^\s)"']+/g)) {
    let u; try { u = new URL(m[0]); } catch { continue; }
    const host = u.hostname.replace(/^www\./, "");
    if (NO_TRACKING_DOMAINS[host] && [...u.searchParams.keys()].some((k) => /^utm_|^ref$|^fbclid$|^gclid$/i.test(k))) out.push(`tags a ${host} link (${host}'s privacy promise: no tags)`);
  }
  return out;
}
/** All the words a studio piece puts in front of people. */
export const pieceText = (p) => [p?.hook, ...(Array.isArray(p?.lines) ? p.lines : []), ...Object.values(p?.captions ?? {})].filter((x) => typeof x === "string").join("\n");
/** Every code check a piece of copy goes through BEFORE the reviewer (G6: namingProblems on every piece). */
export function copyProblems(text, entry) {
  return [...namingProblems(text), ...priceProblems(text, entry), ...taggedLinkProblems(text), ...hardStops(text).map((h) => `[${h.stop}] ${h.why}`)];
}

/**
 * Hard safety stops on every word she writes or asks for (code, never a prompt rule; her rulings in the
 * brains). Each is a fixed list, never a guess at meaning: a name, a domain or a trademark.
 *  - FUND: the fund and its LPs are never her work (risk brain; LP names never leave the private routes).
 *  - NOT_HERS: Time-2-Read is Monique's, never in a growth post (and no children's names anywhere).
 *  - TRADEMARK: "Connect Four" is Hasbro's; P&P says "giant four-in-a-row" (24 Nov 2026).
 *  - LIBRARY: the 3 backlink libraries are kept separate: never named as ours, never linked from our sites.
 */
export const LIBRARY_DOMAINS = Object.freeze((SITES.grid_repos ?? []).flatMap((r) => Array.isArray(r?.sites) ? r.sites : [r]).filter((s) => s?.group === "support").map((s) => String(s.domain).toLowerCase()));
const HARD_STOPS = Object.freeze([
  { stop: "FUND", re: /\b([Ww]est\s*[Pp]eek\s*[Vv]entures|[Ll]imited\s+[Pp]artners?|LPs?|[Cc]apital\s+[Cc]all|[Ff]und\s+I{1,3})\b/, why: "the fund and its LPs are never growth work" },
  { stop: "NOT_HERS", re: /\btime[\s-]?(2|to)[\s-]?read\b|heygetonmylevel/i, why: "Time-2-Read is Monique's, never in her work" },
  { stop: "TRADEMARK", re: /\bconnect[\s-]*(four|4)\b/i, why: "\"Connect Four\" is a Hasbro trademark: say giant four-in-a-row" },
  { stop: "LIBRARY", re: /authority\s+backlink\s+network/i, why: "the backlink libraries are kept separate: never named as ours" },
]);
export function hardStops(text) {
  const t = String(text ?? "");
  const out = HARD_STOPS.filter((h) => h.re.test(t)).map(({ stop, why }) => ({ stop, why }));
  const low = t.toLowerCase();
  const lib = LIBRARY_DOMAINS.find((d) => low.includes(d));
  if (lib) out.push({ stop: "LIBRARY", why: `${lib} is a backlink library: never linked or named from our sites or posts` });
  return out;
}

/**
 * Her settled "no"s (brains, Settled decisions): an idea she has turned down is never proposed again.
 * Checked on what she ASKS for (proposal, sequoia-line, test), never on post copy ("January takedown
 * included" is a true line in every Christmas post).
 */
export const SETTLED_NOS = Object.freeze([
  { business: "porch-and-party", stop: "SETTLED_NO", re: /takedown/i, unless: /included/i, why: "no January takedown service (her ruling 23 Nov 2026): never proposed again" },
  { business: "*", stop: "SETTLED_NO", re: /\b(new edition|retitle|re-title)\b/i, why: "KDP titles never change and no new editions (24 Nov 2026)" },
  { business: "*", stop: "SETTLED_NO", re: /\byoutube\b/i, why: "YouTube is out until the 26 Nov talk" },
]);
export function settledNo(action) {
  const text = [action?.what, action?.why, action?.decision].filter((x) => typeof x === "string").join("\n");
  return SETTLED_NOS.find((s) => (s.business === "*" || s.business === action?.business) && s.re.test(text) && !(s.unless && s.unless.test(text))) ?? null;
}

/** G17 + G21: the only conversion sources she may name, per business. KMP: no tags, analytics or email capture. */
export const SOURCES_ALLOWED = Object.freeze({
  keepmyproof: ["revenuecat", "gsc", "in-app-answer"],
  default: ["revenuecat", "gsc", "in-app-answer", "d1", "gumroad", "cf_web_analytics", "stripe", "kdp", "app-store"],
});
export const SEARCH_LOOP_CHANGES = Object.freeze(["cap", "topics-add", "topics-remove", "exclude-add", "mode"]);
/**
 * Item 4: each business's Search Loop (seq23/<repo>/search-loop.config.json). Her search-loop changes and
 * page-new topics become ONE config PR per business per run, landed on green CI; the engine's own run
 * builds the pages under its own cap, distinct gate and page gate. A-Player-Mode's search pages live on its
 * sister site billionairehighperformancecoach.com (aplayermode.com has no Search Loop of its own).
 */
export const SEARCH_LOOPS = Object.freeze({
  keepmyproof: { repo: "keepmyproof", site: "keepmyproof.com" },
  approvalprep: { repo: "approvalprep", site: "approvalprep.com" },
  "dream-wedding": { repo: "dream-wedding-builder", site: "weddingchecklistpdf.com" },
  "a-player-mode": { repo: "sprylabs-hpc-site", site: "billionairehighperformancecoach.com" },
  "peace-be-still": { repo: "peace-be-still", site: "peacebestillapp.com" },
  "porch-and-party": { repo: "p-n-p", site: "porchandparty901.com" },
});
/**
 * Item 3: the existing Pinterest refills she may start (`gh workflow run`, on main, with NO inputs: a pin
 * sample's release or approval is Sequoia's, never hers). The repo's own pin gate judges every pin.
 */
export const PIN_REFILLS = Object.freeze({
  approvalprep: { repo: "approvalprep", workflow: "pinterest-refill.yml" },
  "dream-wedding": { repo: "dream-wedding-builder", workflow: "pinterest-drip.yml" },
  "a-player-mode": { repo: "sprylabs-hpc-site", workflow: "aplayermode-pin-drip.yml" },
});
/** A search topic: 3 to 80 characters, words only (no link, no markup). */
const topicOk = (t) => typeof t === "string" && t.trim().length >= 3 && t.trim().length <= 80 && !/[<>{}]|https?:|www\./i.test(t);
const PAGES_PER_RUN = 5;
export const OUTREACH_SENDERS = Object.freeze(["camille", "monique"]);

/**
 * THE ONE GATE FOR A PLAN. ctx:
 *   roster, today (Central YYYY-MM-DD), queues { "<biz>:<channel>": n } (owned jobs' queue lengths),
 *   caps { <biz>: max_live_pages }, articles { <biz>: search pages published in the last 28 days },
 *   orderedRecent { <biz>: backlinks ordered in the last 28 days }, accounts ["<biz>:<channel>"] (live
 *   accounts outside the roster, e.g. a connected Buffer channel), bufferFull ["<biz>"] (its Buffer has
 *   no channel slot), linkedOpen ["olp_…"].
 * Returns { accepted: [action], refused: [{ action, stop, why }], lines: [{ business, what, why }],
 *   roster: [{ business, channel, format }], notices: [{ business, key, what }] }.
 * A refusal that is her call becomes a line (`lines`), never a quiet drop.
 */
export function checkPlan(plan, ctx) {
  const accepted = [], refused = [], lines = [], rosterLines = [], notices = [];
  const roster = ctx.roster ?? [];
  const refuse = (action, stop, why, line = null) => { refused.push({ action, stop, why }); if (line) lines.push({ business: action.business, what: line, why }); };
  const tests = new Map();
  const firstDecision = new Map();
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  let ordered = { ...(ctx.orderedRecent ?? {}) };
  for (const raw of actions) {
    const a = raw && typeof raw === "object" ? raw : {};
    const e = roster.find((x) => x.key === a.business);
    if (!KINDS.includes(a.kind)) { refuse(a, "UNKNOWN_KIND", `no action kind called ${a.kind}: spend, accounts and email are not kinds she has`); continue; }
    if (!e) { refuse(a, "NOT_ON_ROSTER", `${a.business} has no Growth roster entry (Detox Denver, Cynthia Brown DDS, T2R and the fund are not hers)`); continue; }
    if (e.paused) { refuse(a, "PAUSED", `${e.label} is paused`); continue; }
    if (e.tier === "search-watch" && !WATCH_KINDS.includes(a.kind)) { refuse(a, "WATCH_TIER", `${e.label} is search-watch: search levers and her calls only, no ${a.kind}`); continue; }
    // A studio plan's pieces are checked one by one below, so one bad caption drops that piece only.
    const text = [a.draft, a.decision, a.what, a.why, a.value].filter((x) => typeof x === "string").join("\n");
    const copy = copyProblems(text, e);
    if (copy.length && a.kind !== "decision") { refuse(a, "COPY", copy.join("; ")); continue; }
    const no = ["proposal", "sequoia-line", "test"].includes(a.kind) ? settledNo(a) : null;
    if (no) { refuse(a, no.stop, no.why); continue; }

    switch (a.kind) {
      case "decision": {
        if (!firstDecision.has(e.key)) firstDecision.set(e.key, a.source);
        if (e.key === "porch-and-party" && firstDecision.get(e.key) !== "pnp-season-bookings") { refuse(a, "SEASON_FIRST", "the first P&P decision each run is bookings this season"); continue; }
        if (!sourcesFor(e.key).some((s) => s.id === a.source)) { refuse(a, "UNKNOWN_SOURCE", `${a.source} is not on ${e.label}'s weekly read list`); continue; }
        accepted.push(a); break;
      }
      case "post": {
        const owner = CHANNEL_OWNERS[`${e.key}:${a.channel}`];
        if (owner) { refuse(a, "OWNED_BY_JOB", `${owner.job} already fills ${e.label}'s ${a.channel} (${ctx.queues?.[`${e.key}:${a.channel}`] ?? "?"} of ${owner.max} queued): change its bank, plan or target, never post there`); continue; }
        const g = channelGate(e, a, ctx, roster);
        if (!g.ok) { refuse(a, g.stop, g.why, g.line); continue; }
        refuse(a, "NO_LEVER", `no existing pipeline posts ${e.label}'s ${a.channel}; a poster is a builder PR, never a run-time post`, `${e.label}: a pipeline for ${a.channel} would need building`); break;
      }
      case "studio-plan": {
        if (e.key !== "porch-and-party") { refuse(a, "NOT_STUDIO", "only Porch & Party runs through P&P Studio"); continue; }
        const pieces = Array.isArray(a.pieces) ? a.pieces : [];
        if (!pieces.length) { refuse(a, "EMPTY_PLAN", "a studio plan with no pieces"); continue; }
        const bad = [];
        const kept = [];
        for (const p of pieces) {
          const day = String(p.at ?? "").slice(0, 10);
          const phase = season(day);
          if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(p.at ?? ""))) { bad.push(`${p.id}: no time`); continue; }
          if (day < ctx.today) { bad.push(`${p.id}: ${day} is in the past`); continue; }
          const pieceCopy = copyProblems(pieceText(p), e);
          if (pieceCopy.length) { bad.push(`${p.id}: [COPY] ${pieceCopy.join("; ")}`); continue; }
          if (!PIECE_THEMES[phase].includes(p.theme)) { bad.push(`${p.id}: ${p.theme} is out of season on ${day} (${phase})`); continue; }
          // `post` is the roster format (reel, photo-set) the gate judges; `format` is the engine's layout,
          // and the Mac drops a piece whose layout does not really post as `post` (enginePlan).
          const post = typeof p.post === "string" ? p.post.trim().toLowerCase() : "";
          if (!post) { bad.push(`${p.id}: no post (the roster format, e.g. reel or photo-set)`); continue; }
          const plats = Array.isArray(p.platforms) ? p.platforms : [];
          let ok = plats.length > 0;
          for (const pl of plats) {
            const g = channelGate(e, { channel: pl === "facebook" ? "facebook-page" : pl, format: post }, ctx, roster);
            if (!g.ok) { bad.push(`${p.id}: ${g.why}`); if (g.line) lines.push({ business: e.key, what: g.line, why: g.why }); ok = false; break; }
            if (g.newFormat) {
              if (!validScorecard(p.scorecard)) { bad.push(`${p.id}: ${post} is a new format on ${pl}, and it carries no scorecard row (one number, day-30 and day-60 floors, version B), so it is not published (G10)`); ok = false; break; }
              rosterLines.push({ business: e.key, channel: g.channel, format: post });
              notices.push({ business: e.key, key: `noelle:${e.key}:format:${g.channel}:${post}`, what: `${e.label} new format ${post} on ${g.channel}`, scorecard: p.scorecard });
            }
          }
          if (ok) kept.push(p);
        }
        if (bad.length) refused.push({ action: { ...a, pieces: pieces.filter((p) => !kept.includes(p)) }, stop: "PIECES", why: bad.join("; ") });
        if (kept.length) accepted.push({ ...a, pieces: kept });
        break;
      }
      case "job-target": {
        const owner = CHANNEL_OWNERS[`${e.key}:${a.channel}`];
        if (!owner) { refuse(a, "NO_OWNER", `no scheduled job fills ${e.label}'s ${a.channel}`); continue; }
        if (!JOB_FIELDS.includes(a.field)) { refuse(a, "FIELD", `${a.field} is not a field she may change (${JOB_FIELDS.join(", ")})`); continue; }
        const knob = JOB_KNOBS[owner.job]?.[a.field];
        if (!knob) { refuse(a, "NO_KNOB", `${owner.job} keeps no ${a.field} she can change in a file; that is a builder PR`, `${e.label}: ${owner.job} needs a ${a.field} knob (a builder PR)`); continue; }
        if (a.field === "target" || a.field === "posts_per_week") {
          const v = Number(a.value);
          if (!Number.isInteger(v) || v < 1) { refuse(a, "VALUE", `${a.field} is a whole number of at least 1`); continue; }
          if (a.field === "target" && v > owner.max) { refuse(a, "NEEDS_MONEY", `${owner.job} holds at most ${owner.max} waiting posts on the free Buffer; more is a paid plan`, `${e.label} ${a.channel}: ${v} posts waiting needs a paid Buffer plan (free holds ${owner.max})`); continue; }
        }
        if (a.field === "bank") {
          const posts = Array.isArray(a.value) ? a.value : [];
          const bad = posts.length < 1 || posts.length > 14 || posts.some((p) => typeof p?.text !== "string" || !p.text.trim() || p.text.length > 500);
          if (bad) { refuse(a, "BANK_SHAPE", "a bank add is 1 to 14 posts, each { type, text } with text up to 500 characters"); continue; }
          const copy = posts.flatMap((p) => copyProblems(p.text, e));
          if (copy.length) { refuse(a, "COPY", copy.join("; ")); continue; }
        }
        if (a.field === "topics") { refuse(a, "NO_KNOB", "topics are a search-loop lever (search-loop topics-add), not a job knob"); continue; }
        accepted.push({ ...a, job: owner.job, repo: owner.repo, file: JOB_KNOBS[owner.job].file, key: knob }); break;
      }
      case "pin-refill": {
        const pin = PIN_REFILLS[e.key];
        if (!pin) { refuse(a, "NO_PIN_REFILL", `${e.label} has no Pinterest refill to start`); continue; }
        if (!e.channels.some((c) => c.channel === "pinterest")) { refuse(a, "NOT_APPROVED", `Pinterest is not on ${e.label}'s roster`); continue; }
        if (accepted.some((x) => x.kind === "pin-refill" && x.business === e.key)) { refuse(a, "ONCE", `one ${e.label} refill a run`); continue; }
        accepted.push({ kind: "pin-refill", business: e.key, why: a.why ?? "", repo: pin.repo, workflow: pin.workflow }); break;
      }
      case "page-new": {
        if (!SEARCH_LOOPS[e.key]) { refuse(a, "NO_SEARCH_LOOP", `${e.label} has no Search Loop`); continue; }
        if (!topicOk(a.topic)) { refuse(a, "TOPIC", "a new page is one search topic of 3 to 80 characters, words only"); continue; }
        const tc = copyProblems(a.topic, e);
        if (tc.length) { refuse(a, "COPY", tc.join("; ")); continue; }
        if (accepted.filter((x) => x.kind === "page-new" && x.business === e.key).length >= PAGES_PER_RUN) { refuse(a, "PAGES_PER_RUN", `at most ${PAGES_PER_RUN} new page topics for ${e.label} a run; the engine's cap decides how many publish`); continue; }
        accepted.push({ kind: "page-new", business: e.key, topic: a.topic.trim(), why: a.why ?? "", repo: SEARCH_LOOPS[e.key].repo }); break;
      }
      case "search-loop": {
        if (!SEARCH_LOOPS[e.key]) { refuse(a, "NO_SEARCH_LOOP", `${e.label} has no Search Loop`); continue; }
        if (["topics-add", "topics-remove", "exclude-add"].includes(a.change)) {
          const vs = Array.isArray(a.value) ? a.value : [a.value];
          if (!vs.length || vs.length > 10 || !vs.every(topicOk)) { refuse(a, "VALUE", `${a.change} is 1 to 10 search words, each 3 to 80 characters, words only`); continue; }
          const tc = vs.flatMap((v) => copyProblems(v, e));
          if (tc.length) { refuse(a, "COPY", tc.join("; ")); continue; }
        }
        if (!SEARCH_LOOP_CHANGES.includes(a.change)) { refuse(a, "SEARCH_LOOP_CHANGE", `${a.change} is not a search-loop lever she has (${SEARCH_LOOP_CHANGES.join(", ")}); menus, links and the engine are never hers`); continue; }
        if (a.change === "cap") {
          const cur = Number(ctx.caps?.[e.key]);
          const v = Number(a.value);
          if (!Number.isFinite(v) || v < 10) { refuse(a, "CAP_VALUE", "a cap is a whole number of at least 10"); continue; }
          if (!Number.isFinite(cur)) { refuse(a, "CAP_NOT_READ", `${e.label}'s current cap was not read, so a change cannot be judged`); continue; }
          if (v >= cur) { refuse(a, "CAP_RAISE_IS_HERS", `raising ${e.label}'s search-loop cap from ${cur} to ${v} is Sequoia's call`, `${e.label}: raise the search-loop cap from ${cur} to ${v}?`); continue; }
        }
        if (a.change === "mode" && !["normal", "slow", "paused"].includes(a.value)) { refuse(a, "MODE", `${a.value} is not a mode`); continue; }
        accepted.push({ ...a, repo: SEARCH_LOOPS[e.key].repo }); break;
      }
      case "backlink": {
        if (!e.channels.some((c) => c.channel === BACKLINKS)) { refuse(a, "NOT_APPROVED", `${e.label} has no backlinks channel`); continue; }
        const allowed = Math.floor(Number(ctx.articles?.[e.key] ?? 0) / 4);
        if ((ordered[e.key] ?? 0) >= allowed) { refuse(a, "ONE_IN_FOUR", `at most 1 link request in 4 articles: ${ctx.articles?.[e.key] ?? 0} articles, ${ordered[e.key] ?? 0} ordered`); continue; }
        if (!a.topic || String(a.topic).length > 120) { refuse(a, "TOPIC", "a link request needs a topic of up to 120 characters"); continue; }
        ordered[e.key] = (ordered[e.key] ?? 0) + 1;
        accepted.push(a); break;
      }
      case "page-edit": {
        const m = mayAct(roster, { business: e.key, action: "page-edit" });
        refuse(a, m.stop, m.why);
        if (m.stop === "CLIENT_APPROVAL") accepted.push({ kind: "proposal", business: e.key, what: `${e.label}: ${a.field ?? "edit"} on ${a.url ?? "a live page"}`, why: a.why ?? "", evidence: a.evidence ?? "", from: "page-edit" });
        break;
      }
      case "test": {
        if (typeof a.what !== "string" || !a.what.trim() || typeof a.number !== "string" || !a.number.trim() || typeof a.stop !== "string" || !a.stop.trim()) { refuse(a, "SHAPE", "a test names what it tries, the one number it moves and when it stops (playbook rule 4)"); continue; }
        if (tests.has(e.key)) { refuse(a, "ONE_TEST", `${e.label} already has a test this cycle (playbook rule 4)`); continue; }
        tests.set(e.key, a); accepted.push(a); break;
      }
      case "outreach-target": {
        if (!OUTREACH_SENDERS.includes(a.sender)) { refuse(a, "SENDER", "outreach goes only through Camille's or Monique's senders; she never sends"); continue; }
        if (!Number.isInteger(a.count) || a.count < 0) { refuse(a, "COUNT", "an outreach target is a count, never a list of people"); continue; }
        if (a.list === "corporate-christmas" && !corporateOpen(ctx.today)) { refuse(a, "SEASON", "corporate Christmas outreach runs 1 Sep to 5 Dec only"); continue; }
        accepted.push({ kind: a.kind, business: e.key, sender: a.sender, list: String(a.list ?? ""), count: a.count, why: a.why ?? "" }); break;
      }
      case "name-source": {
        const allowed = SOURCES_ALLOWED[e.key] ?? SOURCES_ALLOWED.default;
        if (!allowed.includes(a.source)) { refuse(a, e.key === "keepmyproof" ? "KMP_PRIVACY" : "SOURCE", `${a.source} is not a conversion source for ${e.label} (${allowed.join(", ")})`); continue; }
        accepted.push(a); break;
      }
      case "proposal": {
        if (a.wiring) { const w = mayAct(roster, { business: e.key, action: "wire" }); if (w.stop === "KMP_PRIVACY") { refuse(a, w.stop, w.why); continue; } }
        if (a.wiring) { lines.push({ business: e.key, what: `${e.label}: wire ${a.wiring} (a builder PR, never at run time)`, why: a.why ?? "" }); continue; }
        const m = mayAct(roster, { business: e.key, action: a.action ?? "propose" });
        if (!m.ok) { refuse(a, m.stop, m.why); continue; }
        accepted.push(a); break;
      }
      case "linked": {
        if (!["keep", "change"].includes(a.verdict)) { refuse(a, "VERDICT", "a linked to-do is kept or changed; she closes only the eight growth# rows"); continue; }
        if (!(ctx.linkedOpen ?? []).includes(a.id)) { refuse(a, "NOT_LINKED", `${a.id} is not an open to-do on ${e.label}'s roster`); continue; }
        accepted.push(a); break;
      }
      case "sequoia-line": {
        if (typeof a.what !== "string" || !a.what.trim() || a.what.length > 300) { refuse(a, "SHAPE", "a line for Sequoia is one plain sentence (up to 300 characters) in `what`"); continue; }
        accepted.push({ kind: a.kind, business: e.key, what: a.what.trim(), why: typeof a.why === "string" ? a.why.slice(0, 600) : "", evidence: typeof a.evidence === "string" ? a.evidence.slice(0, 600) : "" }); break;
      }
      default: refuse(a, "UNKNOWN_KIND", `no gate for ${a.kind}`);
    }
  }
  return { accepted, refused, lines, roster: rosterLines, notices };
}

function validScorecard(s) {
  return !!s && typeof s.number === "string" && s.number.trim() && Number.isFinite(Number(s.floor30)) && Number.isFinite(Number(s.floor60)) && typeof s.versionB === "string" && s.versionB.trim();
}

/** The roster gate (roster.mjs mayAct, G3/G7) with the her-call line a refusal becomes. */
export function channelGate(e, { channel, format }, ctx, roster) {
  const ch = String(channel ?? "").toLowerCase();
  const m = mayAct(roster, { business: e.key, channel: ch, format, action: "post" }, ctx);
  if (m.ok) return { ok: true, channel: ch, newFormat: !!m.newFormat, newChannel: !!m.newChannel };
  const line = m.stop === "NOT_APPROVED" && e.key === "porch-and-party" && !e.channels.some((c) => c.channel === ch) ? `Porch & Party: add ${ch}? (not on the roster; her call)`
    : m.stop === "NO_NEW_ACCOUNTS" ? `${e.label}: open a ${ch} account? (her call)`
    : m.stop === "NEEDS_MONEY" ? `${e.label}: ${ch} needs a Buffer slot (money: its Buffer's channels are full)` : null;
  return { ok: false, stop: m.stop, why: m.why, line };
}

/** The plan between the sentinels of a run log, or null. */
export const PLAN_BEGIN = "NOELLE-PLAN-BEGIN";
export const PLAN_END = "NOELLE-PLAN-END";
export function parsePlan(text) {
  const s = String(text ?? "");
  const i = s.lastIndexOf(PLAN_BEGIN), j = s.lastIndexOf(PLAN_END);
  if (i < 0 || j < i) return null;
  try { const p = JSON.parse(s.slice(i + PLAN_BEGIN.length, j).trim()); return p && Array.isArray(p.actions) ? p : null; } catch { return null; }
}

/** Notices line (her wording): "Noelle published: <business> <what> <where> <link>". */
export function noticeLine({ label, what, where, link }) {
  return `Noelle published: ${label} ${what} ${where}${link ? ` ${link}` : ""}`;
}

/** Weekly decisions owed: every source of every business. Missing = a named stop on that business. */
export function missingDecisions(roster, accepted) {
  const out = [];
  for (const e of roster) {
    if (e.paused) continue;
    for (const s of sourcesFor(e.key)) if (!accepted.some((a) => a.kind === "decision" && a.business === e.key && a.source === s.id)) out.push({ business: e.key, source: s.id });
  }
  return out;
}
