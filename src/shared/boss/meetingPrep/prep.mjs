/**
 * SIMONE'S MEETING PREP (owner-approved 26 Oct 2026, "Meeting prep now").
 *
 * The evening before each call (18:00 Central), ONE email per meeting on the next day, from Simone,
 * subject "Prep: <who> (<firm>), <Fri 30 Oct>, <12pm>" — her Gmail files on the "Prep: " prefix.
 * A meeting added for the same day gets its prep on the next hourly run. Never twice for one event
 * on one day (the key is the event's own id plus the date).
 *
 * Sections, each only when something real fills it (never invented):
 *   Who they are · Your history · What you referenced · What's relevant now · Bring up · Logistics
 *
 * Everything here is pure: scripts/ops/meeting-prep.mjs reads the calendars and Boss OS and hands
 * the rows in; tests/meetingPrep.test.ts builds them from fixtures.
 */

import { repairMojibake } from "../mail/subject.mjs";
import { HOME_TZ, OWNER_TZ_KEY, validZone, zoneWord, ownerTime } from "../ownerTime.mjs";

export const PREP_PREFIX = "Prep: ";
export const PREP_TZ = "America/Chicago";
/**
 * THE TIMES SHE READS ARE IN HER CURRENT ZONE (owner, 4 Nov 2026; was hard-coded Eastern since
 * 26 Oct). Her zone is the owner setting `owner_timezone` (default Central, HOME_TZ), set by her Mac
 * through PUT /api/boss/owner/timezone and read by the run before it builds. When the meeting is held in
 * another zone (the calendar's own zone, else her home zone), that zone follows in brackets:
 * "1pm ET (12pm CT)". Same zone, no brackets. The length is the calendar's own end minus start.
 */
// Her zone, the zone words and the Central bracket live in ONE helper (../ownerTime.mjs, 6 Nov 2026).
export { HOME_TZ, OWNER_TZ_KEY, validZone, zoneWord };
export const DISPLAY_TZ = HOME_TZ;
export const DISPLAY_ZONE = "CT";
/**
 * "1pm ET (12pm CT)": the time in her zone, Central in brackets only when it shows another clock
 * (her rule: jobs are defined in Central, times are shown in her zone with CT in brackets). `full` for
 * "1:00pm". `other` is accepted for old callers and ignored: the bracket is always Central.
 */
export function zonedTime(at, { tz = DISPLAY_TZ, full = false } = {}) {
  return ownerTime(at, { tz, clock: (h, m) => `${h % 12 === 0 ? 12 : h % 12}${m || full ? `:${String(m).padStart(2, "0")}` : ""}${h >= 12 ? "pm" : "am"}` });
}

/** The evening run: from 18:00 Central, tomorrow's meetings are due. */
export const EVENING_HOUR = 18;

const DAY_MS = 86_400_000;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ─── Time, in her zone ───────────────────────────────────────────────────────

function parts(at, tz = PREP_TZ) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "numeric", minute: "2-digit", hour12: false }).formatToParts(new Date(at));
  const g = (t) => p.find((x) => x.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, weekday: g("weekday"), hour: Number(g("hour")) % 24, minute: Number(g("minute")) };
}
export const dayOfCt = (at) => parts(at).date;
export const hourOfCt = (at) => parts(at).hour;
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** "12pm", "12:30pm", in her zone. `full`: "10:00am". */
export function clock(at, { tz = DISPLAY_TZ, full = false } = {}) {
  const { hour, minute } = parts(at, tz);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${minute || full ? `:${String(minute).padStart(2, "0")}` : ""}${hour >= 12 ? "pm" : "am"}`;
}
/** "Fri 30 Oct", in her zone. */
export function shortDate(at, tz = DISPLAY_TZ) {
  const p = parts(at, tz);
  const [, m, d] = p.date.split("-").map(Number);
  return `${p.weekday} ${d} ${SHORT_MONTHS[m - 1]}`;
}

/** The zone the meeting is held in: the calendar's own zone when it gives one, else her home zone. */
export function eventZone(event) {
  return validZone(event?.time_zone ?? event?.timezone ?? event?.tz ?? null) ?? HOME_TZ;
}

// ─── One meeting, once ───────────────────────────────────────────────────────

const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * THE SAME EVENT ON TWO OF HER CALENDARS (26 Oct 2026, PR #156). One start, and one iCal id, one
 * title or one counterpart. Two different meetings at different times are never one (Terri Burns was
 * once folded into Ann Eubank's slot). The diary's merge (src/worker/boss/today/diary.ts) uses this
 * same rule for two calendar rows, so the morning email and the prep cannot disagree.
 */
export function sameCalendarEvent(a, b) {
  if (Number(a.scheduled_at) !== Number(b.scheduled_at)) return false;
  if (a.ical_uid && b.ical_uid && a.ical_uid === b.ical_uid) return true;
  const [ta, tb] = [norm(a.title), norm(b.title)];
  if (ta !== "" && ta === tb) return true;
  const [ca, cb] = [String(a.with ?? a.counterpart ?? "").toLowerCase(), String(b.with ?? b.counterpart ?? "").toLowerCase()];
  return ca !== "" && ca === cb;
}

/** Every event once: copies merged, attendees unioned, a join link kept from whichever copy had it. */
export function dedupeEvents(events) {
  const out = [];
  for (const e of [...(events ?? [])].sort((a, b) => a.scheduled_at - b.scheduled_at)) {
    const hit = out.find((m) => sameCalendarEvent(m, e));
    if (!hit) { out.push({ ...e, attendees: [...(e.attendees ?? [])] }); continue; }
    for (const a of e.attendees ?? []) {
      if (!hit.attendees.some((x) => x.email && a.email && x.email.toLowerCase() === a.email.toLowerCase())) hit.attendees.push(a);
    }
    hit.join_url = hit.join_url ?? e.join_url ?? null;
    hit.location = hit.location ?? e.location ?? null;
    hit.description = hit.description || e.description || null;
    hit.duration_min = hit.duration_min ?? e.duration_min ?? null;
    hit.ical_uid = hit.ical_uid ?? e.ical_uid ?? null;
  }
  return out;
}

/** A hold on her own calendar is not a meeting. */
const NOT_A_MEETING = /^(focus( time)?|busy|hold|blocked?|ooo|out of office|travel|flight|gym|workout|lunch|dinner|break|reminder|birthday|home)\b/i;

/*
 * WORK OR HER OWN LIFE (owner, 1 Nov 2026: "she should discern brunches from real work stuff"). A
 * "Reservation at <restaurant>" with nobody else on it was asked about, and prepped anyway. Prep is for
 * work. A social or personal word anywhere in the title (brunch, dinner, drinks, birthday, party, date
 * night, a reservation, the gym, the doctor, an errand) is never prepped unless something says work: a
 * work word in the title, or a guest on a company domain. Deterministic: no model decides this.
 */
const SOCIAL_WORDS = "brunch|lunch|dinner|supper|breakfast|drinks|happy hour|cocktails?|wine|birthday|bday|b-day|party|parties|celebration|shower|wedding|anniversary|date night|reservation|res at|gym|workout|work out|yoga|pilates|spin class|run club|massage|spa|nails|mani|pedi|manicure|pedicure|hair|haircut|salon|barber|facial|doctor|dentist|dental|dermatologist|therapy|therapist|physio|chiropractor|checkup|check-up|vet|church|errands?|groceries|pick ?up|drop ?off|playdate|play date|recital|concert|movie|bbq|cookout|picnic|vacation|holiday|funeral|girls'? night|game night|hang ?out|friends?|family|mom|dad|sister|brother|cousin";
const SOCIAL_RE = new RegExp(`\\b(?:${SOCIAL_WORDS})\\b`, "i");
const WORK_RE = /\b(?:LPs?|investors?|fund|pitch|diligence|term sheet|deal|board|partnership|sponsor(?:ship)?|brand|client|customer|sales|demo|interview|onboarding|kick-?off|secondar(?:y|ies)|allocation|raise|capital|contract|proposal|negotiation|webinar|panel|podcast|portfolio|founder|vc)\b/i;

const SELF_TASK_RE = /\b(?:e-?mail(?:ing)?|send|draft|write|tell claude|to-?do|remind(?:er)?|submit)\b/i;

const normTitle = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const seriesOf = (e) => String(e.ical_uid || e.calendar_uid || "").toLowerCase();

/**
 * "personal", "work" or "unsure". `personal`: what her "ignore" replies remembered ({ series, titles }
 * from /commands/meeting-prep/personal); a remembered series or title is personal, never asked again.
 */
export function meetingKind(event, { herAddresses = [], personal = null } = {}) {
  const title = String(event?.title ?? "").trim();
  if (personal) {
    const s = seriesOf(event);
    if ((s && (personal.series ?? []).some((x) => String(x).toLowerCase() === s)) || (personal.titles ?? []).some((x) => normTitle(x) === normTitle(title) && normTitle(title))) return "personal";
  }
  if (event?.all_day || NOT_A_MEETING.test(title)) return "personal";
  // A task she set for herself ("follow-up email (tell Claude …)") with nobody else on it is a
  // reminder, not a meeting (6 Nov 2026: such a reminder got a call prep with "After the call").
  if (others(event, herAddresses).length === 0 && SELF_TASK_RE.test(title)) return "personal";
  const workGuest = others(event, herAddresses).some((a) => companyDomain(a.email));
  const workWord = WORK_RE.test(title);
  if (SOCIAL_RE.test(title)) return workWord || workGuest ? "work" : "personal";
  return workWord || workGuest ? "work" : "unsure";
}

/*
 * HER "IGNORE" IS AN ANSWER (owner, 1 Nov 2026). She replied "Ignore this is brunch with a friend" to
 * "what's this meeting about?" and the reply was taken as the meeting's purpose, so a full prep went
 * out. A reply that says skip it, or that it is social, cancels the prep and is remembered.
 */
const IGNORE_START = /^\s*(?:(?:pls|please|oh|ah|no|nah)[,!.]?\s+)?(?:ignore|skip|disregard|no need|no prep|not needed|nothing to prep|not work|not a work|not a meeting|personal|social|don'?t (?:worry|bother|prep|need)|n\/a)\b/i;
const IGNORE_ANY = new RegExp(`\\b(?:not (?:a )?work\\b|no (?:need|prep)\\b|(?:it'?s|this is|that'?s|its) (?:personal|social|not work)\\b|(?:just|only) (?:a |an |some |my )?(?:${SOCIAL_WORDS})\\b)`, "i");
export function ignoreReplyIn(text) {
  const t = String(text ?? "").replace(/[’]/g, "'").trim();
  if (!t) return false;
  const first = t.split("\n").find((l) => l.trim()) ?? "";
  if (IGNORE_START.test(first)) return true;
  return IGNORE_ANY.test(first) && !WORK_RE.test(first);
}

/** The idempotency key: the event's own id and the day it is on. */
export const prepKey = (e) => `${e.ical_uid || e.calendar_uid}|${dayOfCt(e.scheduled_at)}`;

/**
 * What is due now. From 18:00 Central: every meeting tomorrow. Any hour: a meeting later today that
 * has had no prep (added today, or the Mac was asleep last evening). Never one already sent.
 */
export function dueMeetings(events, { now = Date.now(), sent = new Set(), day = null, herAddresses = [], personal = null } = {}) {
  const today = dayOfCt(now);
  const tomorrow = addDays(today, 1);
  const evening = hourOfCt(now) >= EVENING_HOUR;
  return dedupeEvents(events).filter((e) => {
    if (meetingKind(e, { herAddresses, personal }) === "personal") return false;
    const d = dayOfCt(e.scheduled_at);
    if (day) { if (d !== day) return false; }
    else if (!((d === tomorrow && evening) || (d === today && e.scheduled_at > now))) return false;
    return !sent.has(prepKey(e));
  });
}

// ─── Who is on the other side ────────────────────────────────────────────────

const FILLER = /\b(call|calls|meeting|meet|sync|zoom|teams|google meet|intro|introduction|catch ?up|coffee|chat|check[- ]?in|w\/|with|and|re|fw|fwd|the|for|on|about|prep|follow[- ]?up|discussion|quick|phone|video)\b/gi;

/** "Call- Terri Burns" → "Terri Burns"; "Kate Simpson <> Sequoia" → "Kate Simpson". Her own names removed. */
export function nameFromTitle(title, herNames = ["sequoia", "taylor", "seq"]) {
  // A bracketed part is the firm, never the person ("Jo (Fake Co)").
  const pieces = String(title ?? "").replace(/\([^)]*\)/g, " ").split(/<>|\/|\||\+|,|:|\s[-–—x&]\s|\s-|-\s|\(|\)/i).map((s) => s.replace(FILLER, " ").replace(/\s+/g, " ").trim());
  const her = new Set(herNames.map((n) => n.toLowerCase()));
  for (const p of pieces) {
    const words = p.split(" ").filter((w) => w && !her.has(w.toLowerCase()));
    if (words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Z][a-zA-Z.'’-]*$/.test(w))) return words.join(" ");
  }
  return null;
}

/** "Sequoia + Natori (Legal Luxe)" → "Natori (Legal Luxe)": the title without her name and the joiners. */
export function counterpartFromTitle(title) {
  const t = String(title ?? "").replace(/\bsequoia(\s+taylor)?\b/gi, " ").replace(/^\s*(call|meeting|sync|intro|zoom|coffee)\s*[-–—:]?\s*/i, "")
    .replace(/^\s*(\+|<>|\/|&|\||x|and|with|-|–|—|:)\s*/i, "").replace(/\s*(\+|<>|\/|&|\||x|and|with|-|–|—|:)\s*$/i, "").replace(/\s+/g, " ").trim();
  return t && t.length <= 80 ? t : null;
}

/** "Ned (Arnel & Affiliates) <> Sequoia Taylor" → "Ned": the single first name leading the invite, else null. */
export function titleFirstName(title, herNames = ["sequoia", "taylor", "seq"]) {
  const pieces = String(title ?? "").split(/<>|\/\/|\||\+|\s[-–—x&]\s/);
  for (const p of pieces) {
    const m = /^\s*([A-Z][a-z'’-]+)\s*(?:\(|$)/.exec(p.replace(/^\s*(?:call|meeting|sync|intro|zoom|coffee)\s*[-–—:]?\s*/i, ""));
    if (m && !herNames.includes(m[1].toLowerCase()) && !FILLER.test(m[1])) { FILLER.lastIndex = 0; return m[1]; }
    FILLER.lastIndex = 0;
  }
  return null;
}

/** The person the invite names when the guest is someone else (an assistant who set it up); else null. */
export function invitePerson(title, guestName, firm) {
  const named = titleFirstName(title);
  if (!named || !guestName) return null;
  if (named.toLowerCase() === String(guestName).split(/\s+/)[0].toLowerCase()) return null;
  if (String(firm ?? "").toLowerCase().startsWith(named.toLowerCase())) return null;
  return named;
}

/*
 * HER OWN SYSTEM'S EMAILS ARE NOT HISTORY WITH THEM (6 Nov 2026: a prep for Ned listed "West Peek LP
 * Outreach — Morning Report" and the morning email "Tuesday: 3 decisions, 6 new deals…" under "How you
 * know them", because the reports mention the guest's address).
 */
const OWN_REPORT_RE = /\b(?:morning report|weekly roundup|daily digest|nightly report)\b|^(?:mon|tues|wednes|thurs|fri|satur|sun)day: .*\b(?:decisions?|nothing to decide|new deals?|list)\b/i;
export function isOwnReport(subject) {
  return OWN_REPORT_RE.test(String(subject ?? "").replace(/^\s*(?:re|fwd?):\s*/i, ""));
}

/** The attendees who are not her (her addresses, her calendar's own row, rooms). */
export function others(event, herAddresses = []) {
  const mine = new Set(herAddresses.map((a) => a.toLowerCase()));
  return (event.attendees ?? []).filter((a) => !a.self && a.email && !mine.has(a.email.toLowerCase()) && !/resource\.calendar\.google\.com$|group\.calendar\.google\.com$/i.test(a.email));
}

const firstWordsOf = (s) => String(s ?? "").toLowerCase().trim();

/** Everything Boss OS knows about one address or name. */
export function recordsFor({ email = null, name = null }, data) {
  const e = email ? email.toLowerCase() : null;
  const n = name ? firstWordsOf(name) : null;
  const byEmail = (x, key = "email") => e && String(x?.[key] ?? "").toLowerCase() === e;
  const byName = (x, key = "name") => n && firstWordsOf(x?.[key]) === n;
  const prospect = (data.prospects ?? []).find((p) => byEmail(p)) ?? (e ? null : (data.prospects ?? []).find((p) => byName(p))) ?? null;
  const lp = (data.lpReplies ?? []).find((r) => byEmail(r, "address")) ?? (e ? null : (data.lpReplies ?? []).find((r) => byName(r))) ?? null;
  const person = (data.people ?? []).find((p) => byEmail(p)) ?? (data.people ?? []).find((p) => byName(p, "full_name")) ?? null;
  const addr = e ?? prospect?.email ?? lp?.address ?? person?.email ?? null;
  const touches = (data.touches ?? []).filter((t) => addr && String(t.email ?? "").toLowerCase() === addr.toLowerCase()).sort((a, b) => a.sent_at - b.sent_at);
  const references = (data.references ?? []).filter((r) => addr && String(r.email ?? "").toLowerCase() === addr.toLowerCase());
  const deals = (data.deals ?? []).filter((d) => addr && String(d.from_email ?? "").toLowerCase() === addr.toLowerCase() && !d.hers);
  return { email: addr, prospect, lp, person, touches, references, deals };
}

/**
 * HER OWN FIRMS ARE NEVER THE GUEST'S (4 Nov 2026: a family-office prep read "Who they are: West Peek
 * Ventures. LP." — an LP-reply row's `firm` holds OUR fund, the one they replied to).
 */
export const OWN_FIRMS = ["West Peek Ventures", "West Peek", "Spry Ventures", "Spry Labs"];
const firmKey = (f) => String(f ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const OWN_KEYS = new Set(OWN_FIRMS.map(firmKey));
export const isOwnFirm = (f) => OWN_KEYS.has(firmKey(f));

/**
 * The guest's firm: her records (prospect, LP reply, person, a grid row), else the bracket in her own
 * title ("Sequoia + Jo (Fake Co)"), never one of her own firms; failing all, their company's domain.
 */
export function guestFirm(rec, event, email = null) {
  const bracket = /\(([^)]{2,60})\)/.exec(String(event?.title ?? ""))?.[1]?.trim() || null;
  const found = [rec?.prospect?.firm, rec?.lp?.firm, rec?.person?.organization_name, rec?.deals?.[0]?.from_firm, bracket]
    .map((f) => (typeof f === "string" ? f.trim() : "")).find((f) => f && !isOwnFirm(f));
  return found ?? companyDomain(email ?? rec?.email ?? null) ?? null;
}

const KIND_WORDS = {
  family_office: "family office", sovereign_wealth: "sovereign wealth fund", fund_of_funds: "fund of funds",
  pension_endowment_foundation: "pension, endowment or foundation", secondary_fund: "secondaries fund",
  crossover_growth: "crossover or growth fund", spv_manager: "SPV manager", inbox_buyer: "buyer from your inbox",
};

/** "LP prospect", "LP", "broker", or the relationship's own kind. Null when nothing says. */
export function roleOf(rec) {
  // An LP-reply row is a prospect answering the fund, not a committed LP (4 Nov 2026).
  if (rec.lp && (rec.lp.committed_at || rec.lp.committed)) return "LP";
  if (rec.lp || rec.prospect) return "LP prospect";
  if (rec.deals.length) return "broker";
  const k = rec.person?.relationship_kind ?? rec.person?.kind ?? null;
  return k ? String(k).replace(/_/g, " ") : null;
}

const firstSentence = (t) => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  const m = /^(.{12,240}?[.!?])(\s|$)/.exec(s);
  return (m ? m[1] : s.slice(0, 200)).trim();
};
/** The first real sentence of an email body: past the greeting. */
export function bodyLead(body) {
  const lines = String(body ?? "").split("\n").map((l) => l.trim()).filter(Boolean)
    .filter((l) => !/^(hi|hello|dear|hey|good (morning|afternoon))\b[^.]{0,40},?$/i.test(l));
  return lines.length ? firstSentence(lines.join(" ")) : "";
}
const dayMonth = (at) => { const d = new Date(Number(at)); return Number.isFinite(d.getTime()) ? `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}` : null; };
const atOf = (v) => (typeof v === "number" ? v : Date.parse(String(v ?? "")));

// ─── What the prep found beyond Boss OS's own records ───────────────────────

const FREE_MAIL = /^(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|proton|protonmail|pm|gmx|mail|comcast|att|sbcglobal|verizon|example)\.[a-z.]+$/i;
/** Their company's domain from an address; null for a free mailbox (gmail.com is nobody's company). */
export function companyDomain(email) {
  const d = String(email ?? "").toLowerCase().split("@")[1] ?? "";
  return d && !FREE_MAIL.test(d) ? d : null;
}

/** The invite's own notes, without the join boilerplate Google and Zoom add. Null when nothing real. */
export function inviteNotes(description) {
  const t = String(description ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
    .split("\n").map((l) => l.trim())
    .filter((l) => l && !/https?:\/\/|join (?:with|by|the|zoom|google)|meeting id|passcode|dial[- ]?in|one tap|^[-─=_]{3,}|invitation from google|learn more about meet|reply for |more phone numbers/i.test(l))
    .join(" ").replace(/\s+/g, " ").trim();
  return t.length >= 15 ? t.slice(0, 400) : null;
}

/** "25 Oct 2026" from "2026-10-25" (or an epoch). Null when unreadable. */
export function niceDate(v) {
  const at = typeof v === "number" ? v : Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? `${v}T12:00:00Z` : String(v ?? ""));
  if (!Number.isFinite(at)) return null;
  const d = new Date(at);
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const monthYear = (v) => { const n = niceDate(v); return n ? n.split(" ").slice(1).join(" ") : null; };
const clip = (s, n = 160) => { const t = repairMojibake(String(s ?? "")).replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : t; };

/**
 * WHAT THE MEETING IS FOR, AND HOW WE KNOW (26 Oct 2026: a prep with nothing inside "feels lazy").
 * Her own words win; then the invite's notes; then a line from an email that said it; then what her
 * records say they are. `{ text, from, guess }` or null — and null is never filled with an invention:
 * it turns the email into a question.
 */
export function purposeOf(event, { purpose = null, context = {}, rec = null, role = null } = {}) {
  if (purpose && String(purpose).trim()) return { text: clip(purpose, 600), from: "you", guess: false };
  const notes = inviteNotes(event?.description);
  if (notes) return { text: notes, from: "the invite", guess: false };
  const hint = context?.purpose_hint;
  if (hint?.text) return { text: clip(hint.text, 300), from: hint.from ? clip(hint.from, 80) : "an email", guess: true };
  if (role === "LP" || role === "LP prospect") {
    return { text: `The fund: they are ${role === "LP" ? "an LP" : "an LP prospect"}${rec?.prospect?.status === "interested" ? " and said they are interested" : ""}.`, from: "your records", guess: true };
  }
  if (role === "broker" && rec?.deals?.length) return { text: `Their orders on the grid (${rec.deals.slice(0, 2).map((d) => d.company).join(", ")}).`, from: "your records", guess: true };
  return null;
}

/** Two or three concrete ways to help, from what was found. Always at least two. */
export function offersFrom({ context = {}, firm = null, lead = null, researched = false }) {
  const out = [];
  const site = context.site?.domain ? context.site : null;
  if (site && !researched) out.push(`Research ${firm ?? site.domain} from their website (${site.domain}) and give you three questions to ask.`);
  const m = context.mail ?? {};
  if (m.count > 0 && m.first?.date) out.push(`Sum up your history with them (${m.count}${m.more ? "+" : ""} emails since ${monthYear(m.first.date)}) in five lines.`);
  const b = (context.bounces ?? [])[0];
  if (b) out.push(`Make sure you have the right address for them: your email to ${b.address} bounced${lead?.email && lead.email !== b.address ? `, and the invite went to ${lead.email}` : ""}.`);
  out.push("Draft a short follow-up email for after the call.");
  if (out.length < 3) out.push("Write talking points once you tell me the goal.");
  return out.slice(0, 3);
}

// ─── Research on the guest, done BEFORE the prep is sent (owner, 4 Nov 2026) ─────

/**
 * WHO THEY ARE, RESEARCHED (4 Nov 2026: a family-office prep said only "West Peek Ventures. LP.").
 * Every work meeting with an outside guest is researched before the email goes: title, firm,
 * background, current focus, and anything public they are doing soon, each with its source link. The
 * run is her Claude seat on her Mac (askClaudeJson: her subscription, web search, $0; never the paid
 * OpenAI API). A fact without a source link is dropped; a failed run is ONE plain line, never a
 * confident wrong one.
 */
export const RESEARCH_FIELDS = [["title", "Title"], ["firm", "Firm"], ["background", "Background"], ["focus", "Current focus"]];

/** The research prompt. Pure, so the test reads exactly what the seat is told. */
export function researchPrompt({ name, email = null, firm = null, domain = null, today }) {
  const who = [name ? `"${name}"` : null, email ? `<${email}>` : null, firm ? `of ${firm}` : null, domain ? `(company website ${domain})` : null].filter(Boolean).join(" ");
  return [
    `Research ${who} before a meeting with Sequoia Taylor. Today is ${today}. Use web search and read the pages you cite. Public sources only (their company site, news, conference pages, podcasts, filings, public profiles).`,
    "Find: their current title; their firm; their background in one sentence; what they are focused on now; anything public they are doing soon (talks, panels, launches, fund closes) with its date.",
    "Every fact needs the https link of the page that says it. A fact you cannot source is left out (null). Never guess; never fill a gap; a person with the same name at another firm is not them.",
    'Answer with JSON only, in a ```json block: {"found":true,"title":{"text":"...","url":"https://..."} or null,"firm":{...} or null,"background":{...} or null,"focus":{...} or null,"upcoming":[{"text":"what, and when","url":"https://..."}]}. If you cannot tell who they are: {"found":false,"why":"one short reason"}.',
  ].join("\n");
}

const SOURCE_URL = /^https:\/\/[^\s<>"']+$/i;
const fact = (v, n = 220) => (v && typeof v.text === "string" && v.text.trim() && SOURCE_URL.test(String(v.url ?? "")) ? { text: clip(v.text, n), url: String(v.url) } : null);

/**
 * The seat's answer → `{ ok: true, facts: [{ label, text, url }] }`, keeping only sourced facts, or
 * `{ ok: false, why }` (nothing sourced is a failure too: never an empty "Who they are"). Pure.
 */
export function readResearch(r) {
  if (!r || r.ok === false) return { ok: false, why: clip(r?.why ?? "the research did not run", 140) };
  const j = r.json ?? r;
  if (!j || j.found === false) return { ok: false, why: clip(j?.why ?? "nothing public says who they are", 140) };
  const facts = [];
  for (const [k, label] of RESEARCH_FIELDS) { const f = fact(j[k]); if (f) facts.push({ label, ...f }); }
  for (const u of (Array.isArray(j.upcoming) ? j.upcoming : []).slice(0, 3)) { const f = fact(u, 180); if (f) facts.push({ label: "Coming up", ...f }); }
  return facts.length ? { ok: true, facts } : { ok: false, why: "no fact came back with a source" };
}

/**
 * GEMINI FIRST, GROUNDED; THEN THEIR OWN PAGES; THEN A NAMED STOP (owner, 4 Nov 2026).
 *   1. gemini-2.5-flash with Google Search grounding (the one free model where search works) answers
 *      in the research JSON; Google reports the pages it grounded on.
 *   2. Else the Worker fetches their company site and public pages (Cloudflare browser binding) and a
 *      free Gemini 3 Flash writes ONLY from that fetched text.
 * Either way a fact is kept only when its link is one of the pages actually used (keepGroundedFacts):
 * ungrounded free models invented three different founders for one firm. Neither works → "Couldn't
 * research <name>: <reason>", never research from a model's memory.
 */
const RESEARCH_JSON = 'Answer with JSON only, in a ```json block: {"found":true,"title":{"text":"...","url":"<page link>"} or null,"firm":{...} or null,"background":{...} or null,"focus":{...} or null,"upcoming":[{"text":"what, and when","url":"<page link>"}]}. If the pages do not say who they are: {"found":false,"why":"one short reason"}.';

export function groundedSearchPrompt({ name, email = null, firm = null, domain = null, today }) {
  const who = [name ? `"${name}"` : null, firm ? `of ${firm}` : null, domain ? `(company website ${domain})` : null, email ? `email domain ${String(email).split("@")[1] ?? ""}` : null].filter(Boolean).join(" ");
  return [
    `Search Google for ${who}. Today is ${today}.`,
    "From the pages you find, state: their current title; their firm; their background in one sentence; what they are focused on now; anything public they are doing soon (talks, panels, launches, fund closes) with its date.",
    "Every fact cites the link of the page that says it. A fact no page says is left out (null). A person with the same name at another firm is not them. Never add from memory.",
    RESEARCH_JSON,
  ].join("\n");
}

/** The fallback's prompt: write from the fetched pages only, citing each fact by its page's link. */
export function writeFromPagesPrompt({ name, pages }) {
  const list = pages.map((p, i) => `[${i + 1}] ${p.url}\n"""${String(p.text ?? "").slice(0, 6000)}"""`).join("\n\n");
  return [
    `Write what these pages say about ${name ?? "this person"} and their firm. Use ONLY the page text below; never add from memory. If a page does not name them, say nothing about them from it.`,
    `Pages:\n${list}`,
    "Every fact cites ONE of those page links, copied exactly. A fact no page supports is left out (null).",
    RESEARCH_JSON,
  ].join("\n\n");
}

/** The facts, keeping only those whose link is one of the pages actually used. */
export function keepGroundedFacts(json, sources) {
  const allowed = new Set((sources ?? []).map((s) => String(s.url)));
  const keep = (f) => (f && allowed.has(String(f.url ?? "")) ? f : null);
  if (!json || json.found === false) return json;
  return {
    ...json,
    ...Object.fromEntries(RESEARCH_FIELDS.map(([k]) => [k, keep(json[k])])),
    upcoming: (Array.isArray(json.upcoming) ? json.upcoming : []).map(keep).filter(Boolean),
  };
}

/** The guest's public pages to fetch when search is not available: their site, its about and team pages. */
export function guestPages(domain) {
  return domain ? [`https://${domain}/`, `https://${domain}/about`, `https://${domain}/team`] : [];
}

/** The "Who they are" lines from research: one per fact with its link, or the one plain failure line. */
export function researchItems(research, name) {
  if (!research) return [];
  // The reason in plain words: never a path or a status code (6 Nov 2026: "(/research/person → 404)").
  if (!research.ok) return [`Couldn't research ${name ?? "them"}: ${String(research.why ?? "").replace(/\s*\([^)]*(?:\/|→|\d{3})[^)]*\)/g, "").trim() || "it did not run"}.`.replace(/\.\.$/, ".")];
  return research.facts.map((f) => ({ text: `${f.label}: ${f.text}`, links: [{ label: "Source", url: f.url }] }));
}

// ─── The email ───────────────────────────────────────────────────────────────

export const PREP_QUESTION = "What's this meeting about? Reply in a line and I'll prep talking points, research them, or draft a follow-up.";

/**
 * One meeting's prep. `data`: { prospects, lpReplies, people, touches, references, deals, news,
 * summaries } (any may be missing). `context`: what the Mac found in her mailboxes, calendars, Boss OS
 * cards and their website (see scripts/ops/meeting-prep.mjs `gatherContext`). `purpose`: her own
 * words, from her reply. `plan`: { goals, ready, order } written from the evidence (optional).
 *
 * Returns { key, subject, who, happened, decide, sections, needsPurpose, purpose }. When nothing says
 * what the meeting is for, the email OPENS WITH THE QUESTION and offers what it can do — never the
 * bare logistics (26 Oct 2026).
 */
export function buildPrep(event, data = {}, { herAddresses = [], context = {}, purpose = null, plan = null, tz = DISPLAY_TZ, research = null } = {}) {
  const herTz = validZone(tz) ?? DISPLAY_TZ;
  research = research ?? context?.research ?? null;
  const otherTz = HOME_TZ; // the bracket is always Central (her rule, 6 Nov 2026), never the meeting's zone
  const guests = others(event, herAddresses);
  const lead = guests[0] ?? null;
  const titleName = nameFromTitle(event.title);
  // A calendar often puts the address in the name field: that is not a name.
  const leadName = (lead?.name && !String(lead.name).includes("@") ? lead.name : null) || titleName || null;
  const rec = recordsFor({ email: lead?.email ?? null, name: leadName }, data);
  const name = leadName ?? rec.prospect?.name ?? rec.lp?.name ?? rec.person?.full_name ?? null;
  const firm = guestFirm(rec, event, lead?.email ?? null);
  const role = roleOf(rec);
  const ctx = context ?? {};

  // The person the invite names, when the guest is someone else who set it up (6 Nov 2026: "Ned (Arnel &
  // Affiliates) <> Sequoia Taylor" went to Cecelia, his assistant; the prep was headed "Cecelia Stewart").
  const named = invitePerson(event.title, name, firm);
  const forOther = Boolean(named);
  const headName = forOther ? named : name;
  const who = headName ? `${headName}${firm && !headName.includes(firm) ? ` (${firm})` : ""}` : (counterpartFromTitle(event.title) ?? lead?.email ?? (String(event.title ?? "").trim() || "Meeting"));
  const when = `${shortDate(event.scheduled_at, herTz)}, ${zonedTime(event.scheduled_at, { tz: herTz })}`;
  const subject = `${PREP_PREFIX}${who}, ${when}`;
  const about = purposeOf(event, { purpose, context: ctx, rec, role });
  const sections = [];

  if (about) sections.push({ title: about.guess ? `What it's probably about (a guess, from ${about.from})` : `What it's about (from ${about.from})`, items: [about.text] });

  // Who they are.
  const whoItems = [];
  const roleBits = [rec.person?.title ?? rec.person?.role ?? null, firm ? `at ${firm}` : null].filter(Boolean).join(" ");
  if (name && (roleBits || role)) {
    const kind = rec.prospect?.kind && KIND_WORDS[rec.prospect.kind] ? `, ${KIND_WORDS[rec.prospect.kind]}` : "";
    whoItems.push(`${name}${roleBits ? `, ${roleBits}` : ""}${role ? `. ${role[0].toUpperCase()}${role.slice(1)}${kind}` : ""}.`);
  }
  if (forOther) whoItems.push(`The invite names ${named}; it went to ${name}${lead?.email ? ` (${lead.email})` : ""}, who set it up.`);
  whoItems.push(...researchItems(research, headName ?? lead?.email ?? null));
  if (rec.prospect?.status === "interested") whoItems.push("They said they are interested.");
  if (rec.lp?.bucket === "call") whoItems.push("They asked for a call.");
  if (ctx.site?.domain && (ctx.site.title || ctx.site.about)) {
    whoItems.push({ text: `Their website, ${ctx.site.domain}: ${clip([ctx.site.title, ctx.site.about].filter(Boolean).join(". "), 220)}`, links: [{ label: "Open their website", url: `https://${ctx.site.domain}` }] });
  }
  if (whoItems.length) sections.push({ title: "Who they are", items: whoItems });

  // How you know them: her mailboxes, her calendars, Boss OS cards. Only what was found.
  const knowItems = [];
  const m = ctx.mail ?? {};
  if (m.count > 0 && m.first?.date) knowItems.push(`You have emailed each other since ${monthYear(m.first.date)}: ${m.count}${m.more ? "+" : ""} email${m.count === 1 ? "" : "s"} found.`);
  for (const r of (m.recent ?? []).filter((x) => !isOwnReport(x?.subject)).slice(0, 3)) {
    if (!r?.date || !r?.subject) continue;
    knowItems.push(`${niceDate(r.date)}, ${r.from_them ? "from them" : "from you"}: "${clip(r.subject, 90)}"${r.snippet ? `. ${clip(r.snippet, 140)}` : ""}`);
  }
  const met = (ctx.meetings ?? []).filter((x) => x?.date).slice(0, 3);
  if (met.length) knowItems.push(`Met before: ${met.map((x) => `${niceDate(x.date)}${x.title ? ` ("${clip(x.title, 60)}")` : ""}`).join("; ")}.`);
  const cards = (ctx.cards ?? []).filter((x) => x?.title && !isOwnReport(x.title)).slice(0, 3);
  if (cards.length) knowItems.push(`In Boss OS: ${cards.map((x) => `"${clip(x.title, 70)}"`).join("; ")}.`);
  if (knowItems.length) sections.push({ title: "How you know them", items: knowItems });

  // Your history (Monique's records).
  const hist = [];
  const firstAt = [rec.touches[0]?.sent_at, atOf(rec.prospect?.first_sent_at), atOf(rec.lp?.first_seen)].filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b)[0];
  if (firstAt) hist.push(`First contact: ${dayMonth(firstAt)}.`);
  const last = rec.touches.at(-1);
  if (last && bodyLead(last.body)) hist.push(`Last thing you said (${dayMonth(last.sent_at)}): "${bodyLead(last.body)}"`);
  const theirs = rec.prospect?.reply_note || rec.lp?.quote || null;
  if (theirs) hist.push(`Last thing they said${rec.lp?.first_seen ? ` (${dayMonth(atOf(rec.lp.first_seen))})` : ""}: "${firstSentence(theirs)}"`);
  if (hist.length) sections.push({ title: "Your history", items: hist });

  // What you referenced: only a link her Mac checked and found answering.
  const refs = rec.references.filter((r) => (r.verified === 1 || r.verified === true) && r.url);
  const refItems = refs.slice(0, 2).flatMap((r) => {
    const s = (data.summaries ?? {})[r.url] ?? null;
    const head = `You wrote: "${firstSentence(r.line)}"${s?.length_label ? ` (${s.length_label})` : ""}`;
    const items = [{ text: head, links: [{ label: s?.title ? `Open "${String(s.title).slice(0, 60)}"` : "Open the link", url: r.url }] }];
    if (s?.bullets?.length) items.push(...s.bullets.slice(0, 5).map((b) => `${b} (${s.source === "transcript" ? "from transcript" : "from show notes only"})`));
    return items;
  });
  if (refItems.length) sections.push({ title: "What you referenced", items: refItems });

  // What's relevant now: grid deals that fit, recent news ($0 sources).
  const rel = [];
  const theirOrders = rec.deals.slice(0, 3).map((d) => `Their order on the grid: ${d.company} ${String(d.side ?? "").toLowerCase()}${d.size ? ` ${d.size}` : ""}${d.price && d.price !== "—" ? ` @ ${d.price}` : ""}.`);
  rel.push(...theirOrders);
  // Grid lines are for brokerage contacts only (4 Nov 2026): a West Peek Ventures LP prospect is
  // there for the fund, never shown the deal grid. A brokerage buyer with no order of their own on the
  // grid (a relationship marked investor) still sees what is for sale.
  if (role !== "LP" && role !== "LP prospect" && !rec.deals.length && /^investor$/i.test(String(rec.person?.relationship_kind ?? rec.person?.kind ?? ""))) {
    const sells = (data.deals ?? []).filter((d) => /sell/i.test(String(d.side ?? "")) && !d.hers).slice(0, 3);
    if (sells.length) rel.push(`On the grid now that fits a buyer: ${sells.map((d) => `${d.company}${d.size ? ` ${d.size}` : ""}`).join("; ")}.`);
  }
  for (const n of (data.news ?? {})[firm ?? ""] ?? []) rel.push({ text: `News: ${n.title}${n.date ? ` (${n.date})` : ""}`, links: n.url ? [{ label: "Read it", url: n.url }] : [] });
  if (rel.length) sections.push({ title: "What's relevant now", items: rel });

  // Goals and questions: the plan written from the evidence, else from what is above. Never invented.
  const fromEvidence = [];
  if (theirs) fromEvidence.push(`Pick up what they last said: "${firstSentence(theirs)}"`);
  if (refs[0]) fromEvidence.push(`The piece you mentioned${(data.summaries ?? {})[refs[0].url]?.title ? `: "${data.summaries[refs[0].url].title}"` : ""}.`);
  if (theirOrders[0]) fromEvidence.push(theirOrders[0].replace(/^Their order on the grid: /, "Their order: "));
  const ask = role === "broker" ? "Ask: are their orders still live, and at what price?" : null;
  const planGoals = (plan?.goals ?? []).filter((g) => typeof g === "string" && g.trim());
  const goals = planGoals.length ? planGoals.slice(0, 5)
    : about ? [...fromEvidence.slice(0, 3), ...(ask ? [ask] : []), ...(fromEvidence.length || ask ? [] : ["Ask what would help them most right now."]), "Agree the next step, and who does it, before you hang up."].slice(0, 5)
      : [];
  if (goals.length) sections.push({ title: "Goals and questions", items: goals });

  const order = (plan?.order ?? []).filter((g) => typeof g === "string" && g.trim()).slice(0, 7);
  if (order.length) sections.push({ title: "Running order", items: order.map((o) => o.replace(/^\d+[.)]\s*/, "")) });

  // Have ready.
  const ready = (plan?.ready ?? []).filter((g) => typeof g === "string" && g.trim()).slice(0, 5);
  const join = event.join_url ?? (/^https:\/\/\S+$/.test(String(event.location ?? "")) ? event.location : null);
  if (about) {
    if (!ready.length && ctx.site?.domain) ready.push(`Their website open in a tab (${ctx.site.domain}).`);
    if (!ready.length && join) ready.push("The join link, below.");
    if (ready.length) sections.push({ title: "Have ready", items: ready });
  }

  // Open between you: a bounce, an email of theirs with no answer, a drafted reply.
  const open = [];
  for (const b of (ctx.bounces ?? []).slice(0, 2)) {
    if (!b?.address) continue;
    open.push(`Your email to ${b.address} bounced${b.date ? ` on ${niceDate(b.date)}` : ""}: that address no longer works.${lead?.email && lead.email !== b.address ? ` The invite went to ${lead.email}.` : ""}`);
  }
  if (ctx.unanswered?.subject) open.push(`They emailed${ctx.unanswered.date ? ` on ${niceDate(ctx.unanswered.date)}` : ""} ("${clip(ctx.unanswered.subject, 90)}") and there is no reply from you yet.`);
  if (rec.prospect?.has_draft || rec.lp?.status === "drafted") open.push("A reply to them is drafted and waiting for your yes.");
  if (open.length) sections.push({ title: "Open between you", items: open });

  // Logistics, in her zone. The length is the calendar's own end minus its start.
  const logi = [];
  const end = event.duration_min ? event.scheduled_at + event.duration_min * 60_000 : null;
  const span = (z) => `${clock(event.scheduled_at, { tz: z, full: true })}${end ? ` to ${clock(end, { tz: z, full: true })}` : ""} ${zoneWord(z, event.scheduled_at)}`;
  const otherSpan = otherTz !== herTz && clock(event.scheduled_at, { tz: otherTz }) !== clock(event.scheduled_at, { tz: herTz }) ? ` (${span(otherTz)})` : "";
  logi.push(`${shortDate(event.scheduled_at, herTz)}, ${span(herTz)}${otherSpan}.`);
  if (join) logi.push({ text: "Join the call", links: [{ label: "Join", url: join }] });
  if (event.location && event.location !== join) logi.push(`Where: ${event.location}.`);
  if (guests.length) logi.push(`Who is on it: ${guests.map((g) => (g.name && !String(g.name).includes("@") ? `${g.name} (${g.email})` : g.email)).join(", ")}.`);
  sections.push({ title: "Logistics", items: logi });

  const needsPurpose = !about;
  const decide = needsPurpose
    ? [{ title: `Your meeting with ${who}, ${when}`, body: "Reply with what it's for, or pick one of these and I'll do it:", details: offersFrom({ context: ctx, firm, lead, researched: Boolean(research?.ok) }) }]
    : [];
  const happened = needsPurpose ? PREP_QUESTION : `Your prep for ${who}, ${when}.`;
  return { key: prepKey(event), subject, who, happened, decide, sections, needsPurpose, purpose: about };
}

// ─── Warm references in what was sent ───────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g;
const WARM_WORDS = /\b(episode|podcast|interview|talk|panel|keynote|article|piece|post|essay|newsletter|video|conversation|your (show|work|book|letter|note)|listened|heard|read|enjoyed|loved|saw)\b/i;
const NOT_WARM_HOST = /(westpeek\.ventures|unsubscribe|calendly\.com|zoom\.us|meet\.google\.com|docsend\.com|linkedin\.com\/in\/sequoia)/i;

/**
 * The warm lines in an email she (or Monique) sent: a sentence that names their content and carries
 * its link. `[{ line, url }]`, each url once. Booking links, her own site and unsubscribe links are
 * never a warm reference.
 */
export function extractWarmReferences(body) {
  const out = [];
  const text = String(body ?? "");
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    const urls = line.match(URL_RE) ?? [];
    for (const url of urls) {
      if (NOT_WARM_HOST.test(url) || out.some((o) => o.url === url)) continue;
      const words = line.replace(URL_RE, "").trim();
      if (!WARM_WORDS.test(words)) continue;
      out.push({ line: line.slice(0, 400), url });
    }
  }
  return out;
}

/** "41-min listen" from seconds or "hh:mm:ss"; null when unknown. */
export function lengthLabel(duration, { kind = "listen" } = {}) {
  let secs = Number(duration);
  if (!Number.isFinite(secs)) {
    const p = String(duration ?? "").split(":").map(Number);
    if (p.length < 2 || p.some((x) => !Number.isFinite(x))) return null;
    secs = p.reduce((a, x) => a * 60 + x, 0);
  }
  if (!(secs > 0)) return null;
  return `${Math.max(1, Math.round(secs / 60))}-min ${kind}`;
}

/** A link resolves when it answers 2xx/3xx (HEAD, then GET for servers that refuse HEAD). */
export async function linkResolves(url, fetchImpl = fetch) {
  try {
    let r = await fetchImpl(url, { method: "HEAD", redirect: "follow" });
    if (r.status === 405 || r.status === 403) r = await fetchImpl(url, { method: "GET", redirect: "follow" });
    return r.status >= 200 && r.status < 400;
  } catch { return false; }
}

/** Every link in a body that does NOT resolve. A send with one is held (never reference what is not there). */
export async function deadLinks(body, fetchImpl = fetch) {
  const dead = [];
  for (const { url } of extractWarmReferences(body)) if (!(await linkResolves(url, fetchImpl))) dead.push(url);
  return dead;
}

// ─── Catch-ups with Scooter ──────────────────────────────────────────────────

/*
 * EVERY MEETING WITH SCOOTER IS A CATCH-UP BETWEEN THE TWO OF THEM (owner, 5 Nov 2026: "everytime
 * there is a meeting w/scooter she should know its a catch up meeting between us (even if its not on
 * wednesday) and she needs a roundup of what ive been up to"). The 5 Nov sync moved to a Thursday and
 * the prep asked "what's this meeting about?" and offered to research his own fund. A Scooter meeting
 * never asks: the purpose is known, and the body is her roundup since the last catch-up.
 */
export const CATCHUP_DEFAULT_DAYS = 7;
const SCOOTER_RE = /\bscooter\b/i;

/** True when the title names Scooter, or a guest is Scooter (by name or the address's own name). */
export function isScooterCatchUp(event, herAddresses = []) {
  if (SCOOTER_RE.test(String(event?.title ?? ""))) return true;
  return others(event, herAddresses).some((a) => SCOOTER_RE.test(String(a.name ?? "")) || SCOOTER_RE.test(String(a.email ?? "").split("@")[0]));
}

const CONFIDENTIAL_RE = /<!--\s*confidential\s*-->[\s\S]*?<!--\s*\/confidential\s*-->/gi;
/** Rows that are the team's housekeeping, not her work: never in her roundup. */
const HOUSEKEEPING_RE = /^(?:Unsaved edits\b|Search Readiness is waiting)/i;
/** Brain lines that were moved or reorganised, not decided that day. */
const MOVED_RE = /moved from the old HANDOFF|brain restructure|folded into/i;
const DECISION_RE = /^-\s*(\d{4}-\d{2}-\d{2})\s*[—-]+\s*(.+)$/;
const BRAIN_NAMES = { brokerage: "Spry Ventures", "west-peek-ventures": "West Peek Ventures", "west-peek": "West Peek", "porch-and-party": "Porch & Party", "time-2-read": "Time-2-Read", spry: "Spry Labs", friends: "Friends", personal: "Boss OS" };

/** One decision line, short: its bold headline when it has one, else the first 160 characters. */
export function decisionHeadline(text) {
  const t = String(text ?? "");
  const bold = /\*\*(.+?)\*\*/.exec(t)?.[1];
  const plain = (bold ?? t.split(/ — /)[0]).replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return clip(plain, 160);
}

/**
 * Her roundup since `since` (ms). `loops`: Open Loops rows (open + recently closed). `brains`:
 * [{ slug, body_md }]. Confidential parts of a brain are never read. Pure.
 * Returns { done, decided, started, coming } as plain lines.
 */
export function roundupFrom({ loops = [], brains = [], since, now = Date.now() }) {
  loops = loops.filter((l) => !HOUSEKEEPING_RE.test(String(l.title ?? "")));
  const sinceDay = dayOfCt(since);
  const done = loops.filter((l) => l.status === "closed" && Number(l.closed_at) >= since && !/duplicate|dupe/i.test(String(l.closed_reason ?? "")))
    .sort((a, b) => b.closed_at - a.closed_at).map((l) => clip(l.title, 140));
  const started = loops.filter((l) => l.status === "open" && Number(l.created_at) >= since)
    .sort((a, b) => b.created_at - a.created_at).map((l) => clip(l.title, 140));
  const weekOut = dayOfCt(now + 7 * DAY_MS);
  const today = dayOfCt(now);
  const coming = loops.filter((l) => l.status === "open" && l.section !== "parked" && l.next_date && l.next_date >= today && l.next_date <= weekOut)
    .sort((a, b) => String(a.next_date).localeCompare(String(b.next_date))).map((l) => `${shortDate(Date.parse(`${l.next_date}T17:00:00Z`))}: ${clip(l.title, 120)}`);
  const decided = [];
  for (const b of brains) {
    const md = String(b.body_md ?? "").replace(CONFIDENTIAL_RE, "");
    const start = md.search(/^## Settled decisions\s*$/m);
    const rest = start === -1 ? "" : md.slice(start).replace(/^## Settled decisions[^\n]*\n?/, "");
    const next = rest.search(/^## /m);
    const sec = next === -1 ? rest : rest.slice(0, next);
    for (const line of sec.split("\n")) {
      const m = DECISION_RE.exec(line.trim());
      if (m && m[1] >= sinceDay && !MOVED_RE.test(m[2])) decided.push({ day: m[1], text: `${BRAIN_NAMES[b.slug] ?? b.slug}: ${decisionHeadline(m[2])}` });
    }
  }
  decided.sort((a, b) => b.day.localeCompare(a.day));
  return { done, decided: decided.map((d) => d.text), started, coming };
}

const capList = (items, n, rest) => (items.length > n ? [...items.slice(0, n), `And ${items.length - n} more ${rest}.`] : items);

/** The catch-up email's parts, in the same shape as buildPrep. `since`: the start of the roundup. */
export function buildCatchUp(event, roundup, { herAddresses = [], since, tz = DISPLAY_TZ } = {}) {
  // In her zone with Central in brackets when away (was "CT" always, 6 Nov 2026).
  const herTz = validZone(tz) ?? DISPLAY_TZ;
  const when = `${shortDate(event.scheduled_at, herTz)}, ${zonedTime(event.scheduled_at, { tz: herTz })}`;
  const subject = `${PREP_PREFIX}Catch-up with Scooter, ${when}`;
  const sinceText = shortDate(since);
  const r = roundup ?? { done: [], decided: [], started: [], coming: [] };
  const sections = [{ title: "What it's about", items: [`Your catch-up with Scooter. Below is what you've been up to since ${sinceText}, to go over with him.`] }];
  if (r.done.length) sections.push({ title: `Done since ${sinceText} (${r.done.length})`, items: capList(r.done, 12, "on your Open Loops page") });
  if (r.decided.length) sections.push({ title: `Decided since ${sinceText} (${r.decided.length})`, items: capList(r.decided, 15, "in the business notes") });
  if (r.started.length) sections.push({ title: `Started since ${sinceText} (${r.started.length})`, items: capList(r.started, 12, "on your Open Loops page") });
  if (r.coming.length) sections.push({ title: `Coming up this week (${r.coming.length})`, items: capList(r.coming, 10, "on your Open Loops page") });
  if (!r.done.length && !r.decided.length && !r.started.length) sections.push({ title: "Roundup", items: [`Nothing was recorded as done, decided or started since ${sinceText}.`] });
  const guests = others(event, herAddresses);
  const join = event.join_url ?? (/^https:\/\/\S+$/.test(String(event.location ?? "")) ? event.location : null);
  const end = event.duration_min ? event.scheduled_at + event.duration_min * 60_000 : null;
  const span = (z) => `${clock(event.scheduled_at, { tz: z, full: true })}${end ? ` to ${clock(end, { tz: z, full: true })}` : ""} ${zoneWord(z, event.scheduled_at)}`;
  const homeSpan = herTz !== HOME_TZ && clock(event.scheduled_at, { tz: HOME_TZ }) !== clock(event.scheduled_at, { tz: herTz }) ? ` (${span(HOME_TZ)})` : "";
  const logi = [`${shortDate(event.scheduled_at, herTz)}, ${span(herTz)}${homeSpan}.`];
  if (join) logi.push({ text: "Join the call", links: [{ label: "Join", url: join }] });
  if (guests.length) logi.push(`Who is on it: ${guests.map((g) => (g.name && !String(g.name).includes("@") ? g.name : g.email)).join(", ")}.`);
  sections.push({ title: "Logistics", items: logi });
  return { key: prepKey(event), subject, who: "Scooter", happened: `Your catch-up with Scooter, ${when}: your roundup since ${sinceText}.`, decide: [], sections, needsPurpose: false, purpose: { text: "Catch-up with Scooter", from: "you", guess: false } };
}
