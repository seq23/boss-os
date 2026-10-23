/**
 * LPs, PROSPECTS, 8RAISE AND CATCH-UPS — THE PURE HALF (Boss fix L, 23 Oct 2026).
 *
 * Owner rulings 10, 11, 12 and 14 of the email + deals fix. Everything here is a pure function so
 * the Worker routes, the Mac scripts and the tests all use the same rule, and breaking one fails a
 * test (tests/boss/lpProspects.test.ts) and `npm run validate:lp-rules`.
 *
 * NO NAMES LIVE HERE. Templates carry placeholders; the names come from D1 at runtime.
 */

export const LP_MAILBOX = "sequoia@westpeek.ventures";
/**
 * How far back her inbox is read for buyers and sellers (owner, 23 Oct 2026: "a rough 6-month
 * cut-off"). Inbox-sourced prospects and catch-up reasons only; LP replies keep the full backfill.
 */
export const INBOX_LOOKBACK_DAYS = 183;
export const ORIGIN = "https://boss.sequoiataylor.com";
const DAY = 86_400_000;

/* ─── Rule 10: LP replies ────────────────────────────────────────────────────── */

/** The tracker words she sees, keyed by the stored status. */
export const LP_STATUS_LABEL = Object.freeze({
  drafted: "Drafted",
  sent: "Sent",
  scheduled: "Scheduled",
  skipped: "Skipped",
  not_answered: "Not answered yet",
  replied_again: "They replied again",
});

/** First name for the greeting, or "there". */
export function firstName(name) {
  const w = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'’-]{0,30}$/.test(w) ? w : "there";
}

/**
 * Her outreach voice for an LP who answered warmly: "we", "more than $100M in secondary
 * transactions", never a fund size, a short call ask. A FIXED TEMPLATE — no model writes any part of
 * it, so an LP's name never reaches a route that might train on it.
 */
export function lpReplyBody({ name, bucket }) {
  const opener = bucket === "call"
    ? "Thank you for getting back to me. I'd love to find a time to talk."
    : "Thank you for the reply, and for being open to staying in touch.";
  return [
    `Hi ${firstName(name)},`,
    "",
    `${opener} We've done more than $100M in secondary transactions and are exploring what comes next with a small group of LPs.`,
    "",
    "Would you have 20 minutes in the next couple of weeks for a short call? Send me a couple of times that suit and we'll make it work.",
    "",
    "Best,",
    "Sequoia",
  ].join("\n");
}

/** A held reply that has sat this long goes to the top of Decide. */
export const LP_UNSENT_URGENT_DAYS = 2;

export function tapUrl(token, action, origin = ORIGIN) {
  // A page path, never /api (the plain-email gate holds a link to an API path); bossMount.ts serves it.
  return `${origin}/tap/${encodeURIComponent(token)}?do=${action}`;
}

/** A real Gmail link into the West Peek mailbox — the draft itself, or the thread. Never a bare id. */
export function gmailDraftUrl(draftMessageId, mailbox = LP_MAILBOX) {
  return draftMessageId
    ? `https://mail.google.com/mail/u/${mailbox}/#drafts?compose=${encodeURIComponent(draftMessageId)}`
    : `https://mail.google.com/mail/u/${mailbox}/#drafts`;
}
export function gmailThreadUrl(threadId, mailbox = LP_MAILBOX) {
  return `https://mail.google.com/mail/u/${mailbox}/#all/${encodeURIComponent(threadId ?? "")}`;
}

const daysSince = (ms, now) => (ms ? Math.floor((now - ms) / DAY) : null);

/**
 * Decide items for held LP replies, oldest-unsent first. Each carries the three buttons she ruled:
 * Send as is / Edit, then send / Skip.
 */
export function lpDecideItems(rows, now = Date.now(), origin = ORIGIN) {
  const held = (rows ?? []).filter((r) => r.status === "drafted" && r.tap_token);
  const aged = held.map((r) => ({ r, days: daysSince(r.drafted_at, now) ?? 0 }))
    .sort((a, b) => b.days - a.days);
  return aged.map(({ r, days }) => ({
    title: `${days >= LP_UNSENT_URGENT_DAYS ? "Waiting " + days + " days: " : ""}Reply to ${r.name || "an LP"}${r.firm ? ` at ${r.firm}` : ""}`,
    body: `${r.bucket === "call" ? "Wants a call" : "Wants to stay in touch"}${r.quote ? `: "${String(r.quote).slice(0, 140)}"` : ""}. Your reply is ready in their thread.`,
    urgent: days >= LP_UNSENT_URGENT_DAYS,
    // E's renderer ranks Decide by priority; ≥10 puts a reply unsent for two days at the top.
    priority: days >= LP_UNSENT_URGENT_DAYS ? 10 + days : 5,
    buttons: [
      { label: "Send as is", url: tapUrl(r.tap_token, "send", origin) },
      { label: "Edit, then send", url: gmailDraftUrl(r.draft_message_id) },
      { label: "Skip", url: tapUrl(r.tap_token, "skip", origin) },
    ],
  }));
}

/** The status a row should carry given what the mailbox shows. Pure, so the order is pinned. */
export function lpStatusFrom({ current, sentAfterReply, scheduled, theirLatest, sentAt, hasDraft, decision }) {
  if (sentAfterReply) {
    return theirLatest && sentAt && theirLatest > sentAt ? "replied_again" : "sent";
  }
  if (scheduled) return "scheduled";
  if (decision === "skip" || current === "skipped") return "skipped";
  if (hasDraft) return "drafted";
  return "not_answered";
}

/* ─── Rule 11: prospects ─────────────────────────────────────────────────────── */

export const MAX_TOUCHES = 3;              // the first email and at most two more, then stop forever
export const TOUCH_DAYS = Object.freeze([0, 5, 12]); // days after the first send
export const MAX_NEW_PER_DAY = 20;
export const MIN_TOUCH_GAP_DAYS = 5;
export const FEATURED_MIN = 3;
export const FEATURED_MAX = 5;
export const FEATURE_FRESH_DAYS = 30;
export const FEATURE_STALE_DAYS = 45;
export const PROSPECT_KINDS = Object.freeze([
  "family_office", "sovereign_wealth", "fund_of_funds", "pension_endowment_foundation",
  "secondary_fund", "crossover_growth", "spv_manager", "inbox_buyer", "other",
]);

/**
 * Her tone rules (23 Oct 2026): "i dont want to say 'do u want to buy secondary' i like to be more
 * soft in my approach and request to chat because I have some names im working on".
 */
export const PROSPECT_BANNED = Object.freeze([
  /\bdo (you|u) want to buy\b/i,
  /\bare you (a )?buyers?\b/i,
  /\binterested in buying\b/i,
  /\bwant to buy\b/i,
  /\bblocks? on offer\b/i,
  /\$\s?\d[\d,.]*\s?(m|mm|b|bn|million|billion)?\s*(per share|\/share)/i,
  /\bper share\b/i,
  /\bfund (size|of \$)/i,
  /\$\d[\d,.]*\s?(m|mm|b|bn|million|billion)\s+fund\b/i,
  /\bLP interest of\b/i,
  /\bup to \$1b\b/i,
  // Side-neutral (23 Oct 2026: "some times can be sellers"): never call them a buyer or assume a side.
  /\bbuyers?\b/i,
  /\bbuy[- ]side\b/i,
  /\blooking to (buy|acquire)\b/i,
  /\byour (purchase|buying)\b/i,
]);
/** The ask must invite either direction. */
export const EITHER_SIDE = /\badd or trim\b|\beither side\b|\bbuying or selling\b/i;
export const CHAT_ASK = /\b(15|20) minutes\b.*\b(compare notes|chat|catch up)\b|\b(compare notes|quick chat)\b/i;
export const PROSPECT_WORD_CAP = 90;
export const OPT_OUT_LINE = "If this isn't relevant, just reply \"no thanks\" and I won't write again.";
export const SIGNATURE = "Sequoia Taylor\nWest Peek Ventures";

/** The names line. Her phrasing is primary; the other rotates in lightly (every third prospect). */
export function namesLine(names, variant = 0) {
  const list = (names ?? []).map((n) => (typeof n === "string" ? n : n.name)).filter(Boolean);
  const join = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  if (list.length === 0) return "";
  return variant % 3 === 2
    ? `We've been working on a few names, including ${join(list.slice(0, 2))}.`
    : `Names coming across my desk at the moment are: ${list.join(", ")}.`;
}

/** The default template: warm, personal, a chat ask, the names as a soft aside. */
export const DEFAULT_PROSPECT_TEMPLATE = Object.freeze({
  subject: "Re: Up to $1B secondary inquiry: {subject_names}",
  body: [
    "Hi {first},",
    "",
    "I hope you don't mind the direct note. We've done more than $100M in secondary transactions, and I've been wanting to meet more people who think about late-stage private companies the way you do.",
    "",
    "{names_line} Would love to find 15 minutes to compare notes, and I'm happy to talk about what you're looking to add or trim.",
    "",
    SIGNATURE,
    "",
    OPT_OUT_LINE,
  ].join("\n"),
  follow_up: [
    "Hi {first},",
    "",
    "Just floating this back up. {names_line} We've done more than $100M in secondary transactions, and I'd love to find 15 minutes to compare notes on what you're looking to add or trim.",
    "",
    SIGNATURE,
    "",
    OPT_OUT_LINE,
  ].join("\n"),
});

/** Subject line names: the first three approved names. */
export function subjectNames(names) {
  const list = (names ?? []).map((n) => (typeof n === "string" ? n : n.name)).filter(Boolean).slice(0, 3);
  return list.join(", ");
}

export function renderProspect(template, { first, names, touch = 1, variant = 0 }) {
  const fill = (s) => s
    .replaceAll("{first}", firstName(first))
    .replaceAll("{names_line}", namesLine(names, variant))
    .replaceAll("{subject_names}", subjectNames(names));
  const subject = fill(template.subject).replace(/:\s*$/, "");
  const body = fill(touch === 1 ? template.body : template.follow_up).replace(/\n{3,}/g, "\n\n");
  return { subject, body };
}

/** Words she reads before the signature (the opt-out line and signature do not count). */
export function wordCount(body) {
  const main = String(body).split(SIGNATURE)[0];
  return main.split(/\s+/).filter((w) => /[A-Za-z0-9$]/.test(w)).length;
}

/**
 * Everything wrong with a rendered prospect email. Empty = it may be shown to her for approval.
 * Pinned by tests: banned sales phrases, the chat ask, the $100M line, "we", the word cap, the opt-out.
 */
export function prospectProblems({ subject, body }) {
  const out = [];
  const text = `${subject}\n${body}`;
  for (const re of PROSPECT_BANNED) if (re.test(body)) out.push(`uses a sales phrase (${re.source})`);
  if (!CHAT_ASK.test(body)) out.push("has no soft chat ask");
  if (!EITHER_SIDE.test(body)) out.push("does not invite either side (add or trim)");
  if (!/more than \$100M in secondary transactions/.test(body)) out.push('is missing "more than $100M in secondary transactions"');
  if (!/\b[Ww]e('ve|'re| have| are)?\b/.test(body)) out.push('does not speak as "we"');
  if (wordCount(body) > PROSPECT_WORD_CAP) out.push(`is ${wordCount(body)} words (cap ${PROSPECT_WORD_CAP})`);
  if (!body.includes(OPT_OUT_LINE)) out.push("has no opt-out line");
  if (/\{[a-z_]+\}/.test(text)) out.push("has an unfilled placeholder");
  return out;
}

/** A stable short hash of the template and its names; a change is a new template that re-asks. */
export function templateHash(template, names) {
  const s = JSON.stringify([template.subject, template.body, template.follow_up, (names ?? []).map((n) => (typeof n === "string" ? n : n.name))]);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Which touch is due for a prospect today, if any. 1 = the first email (subject to the daily cap),
 * 2 ≈ day 5, 3 ≈ day 12, then never again. Replies, opt-outs and bounces end it.
 */
export function dueTouch(p, now = Date.now()) {
  if (!p || !["new", "active"].includes(p.status)) return null;
  const touches = Number(p.touches ?? 0);
  if (touches >= MAX_TOUCHES) return null;
  if (touches === 0) return 1;
  if (!p.first_sent_at) return null;
  const days = (now - Number(p.first_sent_at)) / DAY;
  const next = touches + 1;
  // A late start (the 11 Oct send is imported on day 12) must not fire two follow-ups on
  // consecutive days: each touch is also at least five days after the one before it.
  const sinceLast = p.last_touch_at ? (now - Number(p.last_touch_at)) / DAY : days;
  return days >= TOUCH_DAYS[next - 1] && sinceLast >= MIN_TOUCH_GAP_DAYS ? next : null;
}

/**
 * The featured names Monique proposes: her supply ("Yours" rows) ranked by buyer demand seen in her
 * inbox, then freshness (≤30 days), then size, then how well known. Never-feature names are out.
 */
export function proposeFeatured(supply, { never = [], add = [], drop = [] } = {}, now = Date.now()) {
  const banned = new Set([...never, ...drop].map((n) => String(n).toLowerCase()));
  const byName = new Map();
  for (const r of supply ?? []) {
    const name = String(r.company ?? r.name ?? "").trim();
    if (!name || banned.has(name.toLowerCase())) continue;
    const age = r.seen_at ? (now - Number(r.seen_at)) / DAY : 999;
    const prev = byName.get(name.toLowerCase());
    const row = {
      name,
      demand: Number(r.demand ?? 0) + (prev?.demand ?? 0),
      fresh: Math.min(age, prev?.fresh ?? 999),
      size: Math.max(Number(r.size_usd ?? 0), prev?.size ?? 0),
      known: Number(r.known ?? 0),
    };
    byName.set(name.toLowerCase(), row);
  }
  for (const a of add) if (!banned.has(String(a).toLowerCase()) && !byName.has(String(a).toLowerCase())) byName.set(String(a).toLowerCase(), { name: String(a), demand: 0, fresh: 0, size: 0, known: 1, asked: true });
  const rows = [...byName.values()].filter((r) => r.asked || r.fresh <= FEATURE_FRESH_DAYS);
  rows.sort((a, b) => Number(!!b.asked) - Number(!!a.asked) || b.demand - a.demand || a.fresh - b.fresh || b.size - a.size || b.known - a.known);
  return rows.slice(0, FEATURED_MAX).map((r) => ({
    name: r.name,
    why: r.asked ? "you asked for it" : [
      r.demand ? `${r.demand} buyer ask${r.demand === 1 ? "" : "s"} in your inbox` : null,
      r.fresh < 999 ? `on your list ${Math.round(r.fresh)} day${Math.round(r.fresh) === 1 ? "" : "s"} ago` : null,
      r.size ? `${fmtUsd(r.size)} available` : null,
    ].filter(Boolean).join(", ") || "on your current list",
  }));
}

/** Featured names whose supply row is gone or older than ~45 days: each becomes a swap proposal. */
export function staleFeatured(featured, supply, now = Date.now()) {
  const fresh = new Map();
  for (const r of supply ?? []) {
    const k = String(r.company ?? r.name ?? "").toLowerCase();
    const age = r.seen_at ? (now - Number(r.seen_at)) / DAY : 999;
    fresh.set(k, Math.min(age, fresh.get(k) ?? 999));
  }
  return (featured ?? []).filter((f) => {
    const age = fresh.get(String(f.name).toLowerCase());
    return age === undefined || age > FEATURE_STALE_DAYS;
  }).map((f) => f.name);
}

/** Which side a prospect's reply puts them on: Buyer / Seller / Both / Unknown. */
export function sideFromReply(text) {
  const t = String(text ?? "");
  const sell = /\b(sell(ing)?|trim(ming)?|liquidity|offload|exit (some|part)|have (some )?(shares|stock|a position))\b/i.test(t);
  const buy = /\b(buy(ing)?|add(ing)? to|looking for (exposure|allocation)|acquire|interested in (adding|getting into))\b/i.test(t);
  return sell && buy ? "both" : sell ? "seller" : buy ? "buyer" : "unknown";
}

/** Her plain-words edits to the names list: "add X", "drop Y", "never feature Z". */
export function nameRulesIn(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/\b(never feature|add|drop)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/g)) {
    out.push({ rule: m[1] === "never feature" ? "never" : m[1], name: m[2].trim() });
  }
  return out;
}

export function fmtUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v % 1e9 === 0 ? 0 : 1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1)}M`;
  return `$${Math.round(v / 1e3)}K`;
}

/** Blur a person for anything that might leave her screen (tests, previews): "A. P." + domain. */
export function blur(name, email) {
  const initials = String(name ?? "").split(/\s+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(" ");
  const dom = String(email ?? "").split("@")[1] ?? "";
  return `${initials || "—"}${dom ? ` (${dom.replace(/^[^.]+/, (s) => s[0] + "•••")})` : ""}`;
}

/* ─── Rule 12: the 8Raise budget ─────────────────────────────────────────────── */

export const EIGHTRAISE_BUDGET = Object.freeze({
  plan: 165,
  prospecting: 60,
  buyers_for_supply: 15,
  floor: 30,
  per_search_contacts: 5,
});
export const MONIQUE_MONTHLY = EIGHTRAISE_BUDGET.prospecting + EIGHTRAISE_BUDGET.buyers_for_supply;

/** Calendar month in America/Chicago, YYYY-MM. */
export function monthOf(ms = Date.now()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" }).formatToParts(new Date(ms));
  return `${p.find((x) => x.type === "year").value}-${p.find((x) => x.type === "month").value}`;
}

/**
 * May this 8Raise call go ahead? Every refusal names its reason. Never buys; never upgrades — there
 * is no purpose that could.
 */
export function canSpend({ purpose, credits, contacts = 0, company = null, ledger = [], balance = null, month = monthOf() }) {
  if (!["prospecting", "buyers_for_supply"].includes(purpose)) return { ok: false, why: `unknown purpose ${purpose}` };
  if (!(credits > 0)) return { ok: false, why: "a spend must state its credits up front" };
  if (contacts > EIGHTRAISE_BUDGET.per_search_contacts) return { ok: false, why: `asks for ${contacts} contacts; the cap is ${EIGHTRAISE_BUDGET.per_search_contacts} per search` };
  const thisMonth = ledger.filter((l) => l.month === month && l.purpose !== "balance_read");
  const spent = thisMonth.filter((l) => l.purpose === purpose).reduce((a, l) => a + Number(l.credits), 0);
  if (spent + credits > EIGHTRAISE_BUDGET[purpose]) return { ok: false, why: `${purpose} has ${EIGHTRAISE_BUDGET[purpose] - spent} of ${EIGHTRAISE_BUDGET[purpose]} left this month` };
  if (company && thisMonth.some((l) => l.company && l.company.toLowerCase() === String(company).toLowerCase())) {
    return { ok: false, why: `${company} was already searched this month` };
  }
  if (balance === null || balance === undefined) return { ok: false, why: "the account balance could not be read, so the floor cannot be checked" };
  if (balance - credits < EIGHTRAISE_BUDGET.floor) return { ok: false, why: `the balance would fall below ${EIGHTRAISE_BUDGET.floor}` };
  return { ok: true, why: null };
}

export function monthSpent(ledger, month = monthOf()) {
  return ledger.filter((l) => l.month === month && l.purpose !== "balance_read").reduce((a, l) => a + Number(l.credits), 0);
}

/** The morning email footer line (rule 1). */
export function eightRaiseFooter(used) {
  const n = Math.round(Number(used) * 100) / 100;
  return `8Raise: Monique used ${n} of her ${MONIQUE_MONTHLY} credits this month (${EIGHTRAISE_BUDGET.floor} always kept for you)`;
}

/* ─── Rule 14: catch-ups (opportunistic, never a tracker) ────────────────────── */

export const CATCHUP_MAX_PER_DAY = 3;
export const CATCHUP_MAX_EVER = 2;
export const CATCHUP_REASON_TYPES = Object.freeze(["holds_or_wants", "past_partner_moving", "unfilled_ask_matched"]);

/** Is this person on her do-not-suggest list or at her own firm? Matches address, domain or name. */
export function excluded(person, { doNotSuggest = [], rainmaker = [] } = {}) {
  const email = String(person.email ?? "").toLowerCase();
  const domain = email.split("@")[1] ?? "";
  const name = String(person.name ?? "").toLowerCase();
  const hit = (list) => list.some((e) => {
    const v = String(e.value ?? e).toLowerCase().trim();
    if (!v) return false;
    if (v.includes("@")) return v === email;
    if (v.includes(".")) return v === domain;
    return name && name.includes(v);
  });
  if (hit(doNotSuggest)) return "do_not_suggest";
  if (hit(rainmaker)) return "rainmaker";
  return null;
}

/**
 * 0–3 people, each with a live reason. Nobody twice in a week; nobody more than twice ever unless
 * they wrote to her again after the last suggestion (that resets the count); reason types rotate.
 */
export function pickCatchups(candidates, history, lists, now = Date.now()) {
  const byPerson = new Map();
  for (const h of history ?? []) {
    const k = String(h.person_key).toLowerCase();
    if (!byPerson.has(k)) byPerson.set(k, []);
    byPerson.get(k).push(h);
  }
  const lastTypes = [...(history ?? [])].sort((a, b) => b.suggested_at - a.suggested_at).slice(0, 3).map((h) => h.reason_type);
  const ok = [];
  for (const c of candidates ?? []) {
    if (!c.reason || !CATCHUP_REASON_TYPES.includes(c.reason_type)) continue;
    if (c.reason_at && now - Number(c.reason_at) > INBOX_LOOKBACK_DAYS * DAY) continue;
    if (excluded(c, lists)) continue;
    const k = String(c.email).toLowerCase();
    const past = (byPerson.get(k) ?? []).filter((h) => !c.last_wrote_at || h.suggested_at > c.last_wrote_at);
    if (past.length >= CATCHUP_MAX_EVER) continue;
    if (past.some((h) => now - h.suggested_at < 7 * DAY)) continue;
    ok.push(c);
  }
  ok.sort((a, b) => Number(lastTypes.includes(a.reason_type)) - Number(lastTypes.includes(b.reason_type)) || (b.score ?? 0) - (a.score ?? 0));
  const out = [];
  const typesUsed = new Set();
  for (const c of ok) {
    if (out.length >= CATCHUP_MAX_PER_DAY) break;
    if (typesUsed.has(c.reason_type) && ok.some((o) => !typesUsed.has(o.reason_type) && !out.includes(o))) continue;
    out.push(c);
    typesUsed.add(c.reason_type);
  }
  return out;
}

export function catchupNote({ name, reason }) {
  return [`Hi ${firstName(name)},`, "", `It's been a while. ${reason} Would love to catch up for 15 minutes if you have time in the next couple of weeks.`, "", "Best,", "Sequoia"].join("\n");
}
