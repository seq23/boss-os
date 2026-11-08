/**
 * SIMONE'S "GO?" CARD FOR EVERY INVITATION (owner-approved plan, 8 Nov 2026). The pure half: what an
 * invitation is, how it is read, the card she sees, and when it is asked again. No node imports — the
 * Worker bundles this file (src/worker/boss/invitations/run.ts reads the mail, tap.ts acts on her tap).
 *
 * THE RULES, IN THE PLAN'S WORDS, EACH ONE A FUNCTION BELOW:
 *   · One card per invitation (deduped by calendar UID, or by sender + date + title): title, when in
 *     Central, from, where, how it came in; Yes, go / No / Not sure.                  → dedupeKey, cardFor
 *   · Kinds: a calendar invite (an .ics part, or "awaiting reply" on her calendar); an event email from
 *     a known platform with a date and an RSVP link; a personal "would you join us" email. Not
 *     invitations: newsletters, list webinars, ticket receipts, anything already accepted.  → notInvitation
 *   · Untapped: asked once more 3 days before, dropped on the event day, never a third time. Not sure:
 *     asked again 3 days before (or the day after, when the event is under 3 days away), exactly once. → askPlan
 *   · The system never clicks an outside RSVP link: the card carries it for HER tap.        → cardFor
 */

export const OWNER_TZ = "America/Chicago";
export const SECTION = "invitations";
export const FIRST_LOOKBACK_DAYS = 7;
/** A free model reads the subject and this many characters of the body, never more. */
export const EXCERPT_CHARS = 800;
export const REASK_DAYS_BEFORE = 3;
export const MAX_PER_MAILBOX = 40;

/** The inboxes Boss OS already reads through the service account, with the words her card uses. */
export const INVITE_INBOXES = Object.freeze([
  Object.freeze({ address: "sequoia@westpeek.ventures", label: "your West Peek inbox", writable: true }),
  Object.freeze({ address: "st@time-2-read.com", label: "your Time-2-Read inbox", writable: true }),
  // Read only, ever: nothing is sent from it and its calendar is never written (spry-vc-never-sends.mjs).
  Object.freeze({ address: "staylor@spry.vc", label: "your Spry Ventures inbox", writable: false }),
]);
/** The calendar a Yes lands on when the invitation's own calendar cannot be answered. */
export const HER_CALENDAR = "sequoia@westpeek.ventures";

export const PLATFORMS = Object.freeze([
  Object.freeze({ name: "Luma", re: /(?:^|\.)(?:lu\.ma|luma-mail\.com|luma\.com)$/i, link: /^https:\/\/(?:[\w-]+\.)?(?:lu\.ma|luma\.com)\//i }),
  Object.freeze({ name: "Eventbrite", re: /(?:^|\.)eventbrite\.(?:com|co\.uk|ca)$/i, link: /^https:\/\/(?:[\w-]+\.)?eventbrite\.[\w.]+\//i }),
  Object.freeze({ name: "Partiful", re: /(?:^|\.)partiful\.com$/i, link: /^https:\/\/(?:[\w-]+\.)?partiful\.com\//i }),
  Object.freeze({ name: "Paperless Post", re: /(?:^|\.)paperlesspost\.com$/i, link: /^https:\/\/(?:[\w-]+\.)?paperlesspost\.com\//i }),
]);

/** The Gmail search that narrows each inbox to what could be an invitation. Read-only. */
export function mailQuery(afterSec) {
  return [
    `after:${Math.floor(afterSec)}`, "-in:sent", "-in:chats", "-in:drafts",
    "(filename:ics OR from:lu.ma OR from:luma-mail.com OR from:luma.com OR from:eventbrite.com OR from:partiful.com OR from:paperlesspost.com"
      + ' OR invite OR invitation OR invited OR rsvp OR "join us" OR "join me" OR "save the date" OR "you\'re invited" OR "hope you can make it"'
      + ' OR "would love for you" OR dinner OR party OR celebration OR gathering OR reception)',
  ].join(" ");
}

// ─── Time in her clock ────────────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");
function parts(ms, tz = OWNER_TZ) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, wd: o.weekday };
}
/** "2026-11-08" in Central. */
export function centralDay(ms) { const p = parts(ms); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
/** Add whole days to a "YYYY-MM-DD". */
export function addDays(day, n) {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
/** A wall-clock time in a zone, as epoch ms (two passes settle the offset across a DST edge). */
export function wallToUtc(y, mo, d, h, mi, tz = OWNER_TZ) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = parts(t, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    t += guess - asUtc;
  }
  return t;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function clock(p) {
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${pad(p.min)}`;
}
/** "Mon 26 Oct, 12:00–12:30 pm Central" — her clock, her format (make-it-calm §5). */
export function whenWords(start, end = null, allDay = false) {
  const s = parts(start);
  const day = `${s.wd} ${s.d} ${MONTHS[s.m - 1]}`;
  if (allDay) return `${day}, all day`;
  const sm = s.h < 12 ? "am" : "pm";
  if (end && end > start && centralDay(end) === centralDay(start)) {
    const e = parts(end);
    const em = e.h < 12 ? "am" : "pm";
    return sm === em ? `${day}, ${clock(s)}–${clock(e)} ${em} Central` : `${day}, ${clock(s)} ${sm}–${clock(e)} ${em} Central`;
  }
  return `${day}, ${clock(s)} ${sm} Central`;
}
/** "Mon 23 Nov" for a "YYYY-MM-DD". */
export function dayWords(day) {
  const t = wallToUtc(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10), 12, 0);
  const p = parts(t);
  return `${p.wd} ${p.d} ${MONTHS[p.m - 1]}`;
}

// ─── Reading a calendar part ──────────────────────────────────────────────────────────────────

const unescapeIcs = (s) => String(s ?? "").replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").replace(/\s+/g, " ").trim();
function icsTime(prop) {
  // prop: { params: {TZID?, VALUE?}, value }
  const v = String(prop?.value ?? "").trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m || prop?.params?.VALUE === "DATE") {
    m = m ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return { ms: wallToUtc(+m[1], +m[2], +m[3], 0, 0), allDay: true };
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  if (m[7]) return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), allDay: false };
  let tz = prop?.params?.TZID ?? OWNER_TZ;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = OWNER_TZ; }
  return { ms: wallToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz), allDay: false };
}
const mailtoOf = (v) => String(v ?? "").replace(/^mailto:/i, "").trim().toLowerCase();

/** The first VEVENT of an .ics, with the method, organizer and each attendee's answer. Pure. */
export function parseIcs(text) {
  const lines = String(text ?? "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  let method = null;
  let ev = null;
  let depth = 0;
  for (const raw of lines) {
    const i = raw.indexOf(":");
    if (i < 0) continue;
    const head = raw.slice(0, i);
    const value = raw.slice(i + 1);
    const [nameRaw, ...ps] = head.split(";");
    const name = nameRaw.toUpperCase();
    const params = Object.fromEntries(ps.map((p) => { const j = p.indexOf("="); return [p.slice(0, j).toUpperCase(), p.slice(j + 1).replace(/^"|"$/g, "")]; }));
    if (name === "METHOD" && !ev) method = value.trim().toUpperCase();
    if (name === "BEGIN" && value.trim().toUpperCase() === "VEVENT") { if (ev) { depth++; continue; } ev = { attendees: [] }; continue; }
    if (name === "END" && value.trim().toUpperCase() === "VEVENT") { if (depth) { depth--; continue; } break; }
    if (!ev || depth) continue;
    if (name === "UID") ev.uid = value.trim();
    else if (name === "SUMMARY") ev.summary = unescapeIcs(value);
    else if (name === "LOCATION") ev.location = unescapeIcs(value);
    else if (name === "STATUS") ev.status = value.trim().toUpperCase();
    else if (name === "DTSTART") ev.start = icsTime({ params, value });
    else if (name === "DTEND") ev.end = icsTime({ params, value });
    else if (name === "ORGANIZER") ev.organizer = { name: params.CN ? unescapeIcs(params.CN) : null, email: mailtoOf(value) };
    else if (name === "ATTENDEE") ev.attendees.push({ email: mailtoOf(value), partstat: String(params.PARTSTAT ?? "NEEDS-ACTION").toUpperCase(), rsvp: /^true$/i.test(params.RSVP ?? "") });
  }
  if (!ev?.start) return null;
  return {
    method, uid: ev.uid ?? null, title: ev.summary || null, location: ev.location || null, status: ev.status ?? null,
    start: ev.start.ms, end: ev.end?.ms ?? null, allDay: ev.start.allDay, organizer: ev.organizer ?? null, attendees: ev.attendees,
  };
}

// ─── What is, and is not, an invitation ───────────────────────────────────────────────────────

export const domainOf = (addr) => String(addr ?? "").toLowerCase().split("@")[1] ?? "";
export function platformOf(fromAddress) {
  const d = domainOf(fromAddress);
  return PLATFORMS.find((p) => p.re.test(d)) ?? null;
}
const RECEIPT_RE = /\b(receipt|your order|order (?:confirmation|#)|your tickets?|ticket confirmation|tickets? (?:are|is) (?:attached|ready)|you'?re (?:going|registered|in|all set|confirmed)|registration (?:is )?(?:confirmed|complete)|you'?re on the (?:list|waitlist)|thanks? (?:you )?for (?:registering|rsvping|signing up)|rsvp (?:confirmed|received)|see you (?:there|soon))\b/i;
const REMINDER_RE = /^\s*(?:reminder|starting (?:soon|now|in)|happening (?:today|tomorrow)|recording|replay)\b/i;
const NOREPLY_RE = /^(?:no-?reply|do-?not-?reply|notifications?|news(?:letter)?|marketing|info|hello|team|events?|support|updates?)@/i;
const NOT_A_PERSON_ANSWER = /^(?:accepted|declined|tentative|canceled|cancelled|updated invitation with note)\b|^(?:invitation|updated invitation):.*\b(?:has been|was) (?:accepted|declined)/i;

/**
 * Why a message is NOT an invitation to her, or null when it could be one. Pure. `self` is her own
 * addresses (each inbox), so her own reply or her own event is never a card.
 */
export function notInvitation(msg, self = INVITE_INBOXES.map((b) => b.address)) {
  const from = String(msg.fromAddress ?? "").toLowerCase();
  const subject = String(msg.subject ?? "");
  const mine = new Set(self.map((s) => s.toLowerCase()));
  if (mine.has(from) && !msg.ics) return "her own email";
  if (NOT_A_PERSON_ANSWER.test(subject)) return "an answer to an invite, not an invite";
  if (RECEIPT_RE.test(subject)) return "a ticket receipt or a yes already given";
  if (msg.ics) {
    const ics = msg.ics;
    if (ics.method && !["REQUEST", "PUBLISH"].includes(ics.method)) return `a calendar ${ics.method.toLowerCase()}, not an invite`;
    if (ics.status === "CANCELLED") return "a cancelled event";
    if (ics.organizer?.email && mine.has(ics.organizer.email)) return "her own event";
    const me = ics.attendees.find((a) => mine.has(a.email));
    if (me && me.partstat !== "NEEDS-ACTION") return "already answered";
    if (!me && ics.method === "REQUEST" && ics.attendees.length) return "an invite to someone else";
    return null;
  }
  const platform = platformOf(from);
  if (platform) return null;
  if (msg.listUnsubscribe || /^(?:bulk|list|junk)$/i.test(String(msg.precedence ?? ""))) return "a newsletter or list webinar";
  if (msg.autoSubmitted && !/^no$/i.test(String(msg.autoSubmitted))) return "an automatic email";
  if (NOREPLY_RE.test(from)) return "a newsletter or list webinar";
  if (REMINDER_RE.test(subject) || /\bwebinar\b/i.test(subject)) return "a newsletter or list webinar";
  return null;
}

const INVITE_WORDS_RE = /\b(?:you'?re invited|you are invited|invit(?:e|es|ing|ation)|join (?:us|me)|would love (?:for you|to have you|you to)|hope you can (?:make it|come|join)|save the date|rsvp|come (?:to|celebrate|join)|we'?re (?:hosting|having|throwing)|dinner|party|celebrat(?:e|ion)|gathering|reception)\b/i;
const ASKS_RE = /\b(?:rsvp|let (?:me|us) know|can you (?:make|come|join)|will you (?:join|come|be)|are you (?:in|free|able|around)|would you (?:like|be able|join|come)|hope (?:you can|to see you)|please reply|reply by)\b|\?/i;

/** Does a personal email ask for an answer? Pure. */
export const asksForAnswer = (text) => ASKS_RE.test(String(text ?? ""));

/**
 * A date in plain prose, as epoch ms in Central, when one is clearly there. Pure. Month names only
 * ("Thursday, November 12, 2026 at 6:30 PM", "Nov 12 · 6pm"), so "11/12" or a phone number never
 * becomes an event. A date with no year takes the next one that is not in the past.
 */
export function proseDate(text, now) {
  const re = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?:[^\d\n]{0,12}?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?))?/i;
  const m = re.exec(String(text ?? ""));
  if (!m) return null;
  const mo = MONTHS.findIndex((x) => m[1].slice(0, 3).toLowerCase() === x.toLowerCase()) + 1;
  const d = +m[2];
  if (!mo || d < 1 || d > 31) return null;
  let h = 12, mi = 0, allDay = true;
  if (m[4]) { h = (+m[4] % 12) + (/^p/i.test(m[6]) ? 12 : 0); mi = m[5] ? +m[5] : 0; allDay = false; }
  const today = centralDay(now);
  let y = m[3] ? +m[3] : +today.slice(0, 4);
  let ms = wallToUtc(y, mo, d, allDay ? 0 : h, mi);
  if (!m[3] && centralDay(ms) < today) ms = wallToUtc(++y, mo, d, allDay ? 0 : h, mi);
  return { ms, allDay };
}

/** The first RSVP link on the platform's own site (never an unsubscribe or settings link). Pure. */
export function rsvpLinkOf(platform, text) {
  const urls = String(text ?? "").match(/https:\/\/[^\s<>"')\]]+/g) ?? [];
  return urls.map((u) => u.replace(/[.,;]+$/, "")).find((u) => platform.link.test(u) && !/unsubscribe|settings|preferences|privacy|terms|help|support|\/app\b|download|apps\.apple|play\.google/i.test(u)) ?? null;
}

const cleanTitle = (s) => String(s ?? "").replace(/^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i, "").replace(/^\s*(?:updated )?invitation:\s*/i, "").replace(/\s*@\s*(?:mon|tue|wed|thu|fri|sat|sun|weekly|daily)\b.*$/i, "").replace(/\s+/g, " ").trim().slice(0, 140);

/** Calendar UID first; otherwise sender + day + title, so a resent email is one card. Pure. */
export function dedupeKey({ uid = null, fromAddress = "", start, title = "" }) {
  if (uid) return `uid:${String(uid).trim().toLowerCase()}`;
  const t = cleanTitle(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `msg:${String(fromAddress).toLowerCase()}|${centralDay(start)}|${t}`;
}

/**
 * Turn one read message into an invitation, or say why not. Pure. `model` is the free model's answer
 * for a personal email (or null when no model could read it — then the prose rules decide).
 *   msg: { inbox, fromName, fromAddress, subject, excerpt, links, ics, listUnsubscribe, precedence,
 *          autoSubmitted, gmailId, threadId, rfcMessageId }
 */
export function readInvitation(msg, { now, model = null } = {}) {
  const why = notInvitation(msg);
  if (why) return { invitation: null, why };
  const inbox = INVITE_INBOXES.find((b) => b.address === msg.inbox) ?? { address: msg.inbox, label: "your inbox", writable: false };
  const base = {
    inbox: inbox.address, fromName: msg.fromName || null, fromAddress: String(msg.fromAddress ?? "").toLowerCase(),
    gmailId: msg.gmailId ?? null, threadId: msg.threadId ?? null, rfcMessageId: msg.rfcMessageId ?? null, subject: msg.subject ?? null,
  };
  if (msg.ics) {
    const ics = msg.ics;
    if (ics.start <= now) return { invitation: null, why: "the event has passed" };
    return {
      invitation: {
        ...base, kind: "calendar", source: "mail", uid: ics.uid, title: ics.title || cleanTitle(msg.subject) || "An event",
        start: ics.start, end: ics.end, allDay: ics.allDay, where: ics.location,
        fromName: ics.organizer?.name || base.fromName, fromAddress: ics.organizer?.email || base.fromAddress,
        asksAnswer: true, rsvpUrl: null, how: `a calendar invite to ${inbox.label}`,
      },
      why: null,
    };
  }
  const platform = platformOf(msg.fromAddress);
  const text = `${msg.subject ?? ""}\n${msg.excerpt ?? ""}`;
  if (platform) {
    const when = proseDate(text, now);
    const link = rsvpLinkOf(platform, [msg.excerpt, ...(msg.links ?? [])].join(" "));
    if (!when) return { invitation: null, why: `a ${platform.name} email with no date` };
    if (!link) return { invitation: null, why: `a ${platform.name} email with no RSVP link` };
    if (when.ms <= now) return { invitation: null, why: "the event has passed" };
    return {
      invitation: {
        ...base, kind: "platform", source: "mail", uid: null, title: cleanTitle(msg.subject) || `A ${platform.name} event`,
        start: when.ms, end: null, allDay: when.allDay, where: null, asksAnswer: false, rsvpUrl: link,
        platform: platform.name, how: `a ${platform.name} invitation to ${inbox.label}`,
      },
      why: null,
    };
  }
  // A personal email: the free model's reading wins; without one, the prose rules must both hold.
  let title = null, start = null, allDay = false, where = null, asks = asksForAnswer(msg.excerpt);
  if (model) {
    if (!model.invitation) return { invitation: null, why: "the model read it as not an invitation" };
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(model.date ?? ""));
    const t = /^(\d{1,2}):(\d{2})$/.exec(String(model.time ?? ""));
    if (d) { start = wallToUtc(+d[1], +d[2], +d[3], t ? +t[1] : 0, t ? +t[2] : 0); allDay = !t; }
    title = model.title ? String(model.title).slice(0, 140) : null;
    where = model.where ? String(model.where).slice(0, 160) : null;
    if (typeof model.asks_answer === "boolean") asks = model.asks_answer;
  }
  if (!start) {
    if (!INVITE_WORDS_RE.test(text)) return { invitation: null, why: "no invitation in it" };
    const when = proseDate(text, now);
    if (!when) return { invitation: null, why: "an invitation with no date" };
    start = when.ms; allDay = when.allDay;
  }
  if (start <= now) return { invitation: null, why: "the event has passed" };
  return {
    invitation: {
      ...base, kind: "personal", source: "mail", uid: null, title: title || cleanTitle(msg.subject) || "An invitation",
      start, end: null, allDay, where, asksAnswer: asks, rsvpUrl: null, how: `an email to ${inbox.label}`,
    },
    why: null,
  };
}

// ─── Her words, sent only on her tap ──────────────────────────────────────────────────────────

export const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0]?.replace(/[^A-Za-z'-]/g, "") || "";
/** The Yes she sends to a personal invitation, in her voice (personal brain, Voice: plain, calm). */
export function yesWords(inv) {
  const hi = firstName(inv.fromName) ? `Hi ${firstName(inv.fromName)},\n\n` : "";
  return `${hi}Thank you so much for the invitation. I'd love to come, and I'll see you there.\n\nSequoia`;
}
/** The plain "can't make it", only when the invitation asks for an answer. */
export function noWords(inv) {
  const hi = firstName(inv.fromName) ? `Hi ${firstName(inv.fromName)},\n\n` : "";
  return `${hi}Thank you so much for thinking of me. I can't make it this time, but I hope it's a wonderful time.\n\nSequoia`;
}

// ─── When she is asked ────────────────────────────────────────────────────────────────────────

/** The day a Not sure comes back: 3 days before, or the day after when the event is under 3 days away. */
export function unsureAskDay(start, today) {
  const before = addDays(centralDay(start), -REASK_DAYS_BEFORE);
  return before > today ? before : addDays(today, 1);
}

/**
 * Is this invitation's card in today's email? Pure. Returns { show, drop, ask } — `ask` names which
 * asking this is ("first", "again", "unsure"), so its card key is new and the told-once memory never
 * thins it. The rules:
 *   open:   first morning → shown. Untapped → shown once more on the day 3 before (when that is a later
 *           day than the first ask). Never a third time. Dropped on the event day.
 *   unsure: shown on its ask day (unsureAskDay), exactly once; dropped after that day passes, and on
 *           any day after the event.
 */
export function askPlan(inv, today) {
  const eventDay = centralDay(inv.starts_at);
  // Already asked this morning (the duty run again by hand): the same card, the same asking, no new count.
  if (inv.last_asked_day === today && today < eventDay && (inv.status === "open" || inv.status === "unsure")) {
    const ask = inv.status === "unsure" ? (inv.unsure_asks >= 1 ? "unsure" : null) : inv.asks >= 2 ? "again" : "first";
    if (ask) return { show: true, drop: false, ask };
  }
  if (inv.status === "open") {
    if (today >= eventDay) return { show: false, drop: true, ask: null };
    if (!inv.asks) return { show: true, drop: false, ask: "first" };
    const again = addDays(eventDay, -REASK_DAYS_BEFORE);
    if (inv.asks === 1 && today >= again && inv.last_asked_day && inv.last_asked_day < again) return { show: true, drop: false, ask: "again" };
    return { show: false, drop: false, ask: null };
  }
  if (inv.status === "unsure") {
    if (today > eventDay) return { show: false, drop: true, ask: null };
    if (inv.unsure_asks >= 1) return { show: false, drop: today >= eventDay, ask: null };
    if (inv.next_ask_day && today >= inv.next_ask_day) return { show: true, drop: false, ask: "unsure" };
    return { show: false, drop: false, ask: null };
  }
  return { show: false, drop: false, ask: null };
}

// ─── The card ─────────────────────────────────────────────────────────────────────────────────

/** Gmail's own search for the message, so "Answer in Gmail" opens it (never a bare id). */
export function gmailLink(inv) {
  const q = inv.subject ? `subject:"${String(inv.subject).replace(/"/g, "")}"` : `from:${inv.from_address}`;
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(inv.inbox)}#search/${encodeURIComponent(q)}`;
}

/**
 * The "Go?" card: a decide item for the morning section (src/shared/boss/mail/morningSections.mjs),
 * shown in Simone's email and on Today. Every button is a one-tap page (/tap/<token>), except the
 * outside RSVP page, which only she opens. Pure. `inv` is the D1 row.
 */
export function cardFor(inv, { origin, ask = "first", today }) {
  const writable = INVITE_INBOXES.find((b) => b.address === inv.inbox)?.writable === true;
  const tap = (d) => `${origin}/tap/${inv.tap_token}?do=${d}`;
  const when = whenWords(inv.starts_at, inv.ends_at, inv.all_day === 1);
  const from = inv.from_name ? `${inv.from_name} (${inv.from_address})` : inv.from_address;
  const unsureDay = unsureAskDay(inv.starts_at, today);
  const yes = inv.kind === "calendar"
    ? (writable ? "Yes, go: Simone accepts the invite and it stays on your calendar." : "Yes, go: Simone puts it on your calendar; answer the invite yourself in Gmail (Spry Ventures mail is never sent from here).")
    : inv.kind === "platform"
      ? `Yes, go: Simone puts it on your calendar; tap "Open the RSVP page" to say yes on ${inv.platform ?? "their site"} yourself.`
      : (writable ? "Yes, go: Simone sends your yes below and puts it on your calendar." : "Yes, go: Simone puts it on your calendar; write back yourself in Gmail (Spry Ventures mail is never sent from here).");
  const no = inv.kind === "calendar"
    ? (writable ? "No: Simone declines the invite and the card goes away." : "No: the card goes away; nothing is sent.")
    : inv.kind === "personal" && inv.asks_answer === 1 && writable
      ? "No: Simone sends the short note below and the card goes away."
      : "No: the card goes away; nothing is sent.";
  const details = [
    `When: ${when}`,
    `From: ${from}`,
    `Where: ${inv.location || "not said"}`,
    `How it came in: ${inv.how}`,
    yes,
    no,
    ask === "unsure" ? "Not sure again: the card goes away now; it is not asked a third time." : `Not sure: Simone asks again on ${dayWords(unsureDay)}.`,
  ];
  if (inv.kind === "personal" && inv.asks_answer === 1 && writable) details.push(`If you tap No, Simone sends: "${noWords({ fromName: inv.from_name }).replace(/\n+/g, " ")}"`);
  const buttons = [
    { label: "✓ Yes, go", url: tap("yes") },
    { label: "No", url: tap("no") },
    { label: "Not sure", url: tap("unsure") },
  ];
  if (inv.kind === "platform" && inv.rsvp_url) buttons.push({ label: "Open the RSVP page ›", url: inv.rsvp_url });
  if (!writable && inv.kind !== "platform") buttons.push({ label: "Answer in Gmail ›", url: gmailLink(inv) });
  const lead = ask === "again" ? "Asking once more. " : ask === "unsure" ? "You said not sure; here it is again. " : "";
  return {
    key: `invite:${inv.id}:${ask}`,
    title: `Go? ${inv.title}`,
    body: `${lead}${when} · from ${inv.from_name || inv.from_address}.`,
    details,
    ...(inv.kind === "personal" && writable ? { draft: { heading: "If you tap Yes, Simone sends", text: inv.reply_text ?? yesWords({ fromName: inv.from_name }) } } : {}),
    buttons,
    priority: 2,
  };
}

/** The census line every run prints (rule-zero-shapes). */
export const outputLine = (n) => `OUTPUT ${n} invitations`;
