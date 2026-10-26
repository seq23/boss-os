/**
 * SIMONE DOES IT BY EMAIL — THE GRAMMAR.
 *
 * Owner, 25 Oct 2026, angry: she had to ask a Claude session for two things she should have been
 * able to email Simone about. "Send a calendar invite to <person> at <firm> for Tuesday this week
 * 10am ET, <address>", and "find my cousin's email (it's on the family reunion Drive files), have a
 * trial code made for time-2-read, and email her the code with a short explainer".
 *
 * So an email to boss@ (or simone@) from her is read here for the things Simone can DO, not just
 * file: a calendar invite, a contact lookup, an email to a person on her behalf, repo work for
 * Danielle, and — for anything she cannot do yet — a one-line "can't yet" that opens a Danielle job
 * to add it. Pure and deterministic: no model is asked to read her email, so the same words always
 * do the same thing. The Worker half is src/worker/boss/commands/; the Mac half (her own Drive and
 * Gmail, the drafting, bounce checks) is scripts/ops/simone-commands.mjs.
 *
 * NOTHING HERE SENDS ANYTHING. It returns what was asked; the Worker decides what runs.
 */

import { splitAsks } from "../intake/triage.mjs";

export const OWNER_TZ = "America/Chicago";
export const DEFAULT_MINUTES = 30;

/** Zone words she writes → IANA zone and the word Simone says back. */
export const ZONES = Object.freeze({
  et: ["America/New_York", "Eastern"], est: ["America/New_York", "Eastern"], edt: ["America/New_York", "Eastern"], eastern: ["America/New_York", "Eastern"],
  ct: ["America/Chicago", "Central"], cst: ["America/Chicago", "Central"], cdt: ["America/Chicago", "Central"], central: ["America/Chicago", "Central"],
  mt: ["America/Denver", "Mountain"], mst: ["America/Denver", "Mountain"], mdt: ["America/Denver", "Mountain"], mountain: ["America/Denver", "Mountain"],
  pt: ["America/Los_Angeles", "Pacific"], pst: ["America/Los_Angeles", "Pacific"], pdt: ["America/Los_Angeles", "Pacific"], pacific: ["America/Los_Angeles", "Pacific"],
  utc: ["UTC", "UTC"], gmt: ["UTC", "UTC"],
});
const ZONE_RE = /\b(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|UTC|GMT|eastern|central|mountain|pacific)\b(?:\s+time)?/i;
export function zoneLabel(tz) {
  for (const [, [z, label]] of Object.entries(ZONES)) if (z === tz) return label;
  return tz;
}

/**
 * WHICH GOOGLE MAILBOX ACTS. Only Workspace mailboxes can be driven through the delegation (probed
 * 25 Oct 2026: calendar.events and gmail.compose are granted on both of these; sequoiataylor.com has
 * no Workspace mailbox, and her personal Gmail can never be delegated). A brand named in the email
 * picks its own mailbox; otherwise West Peek's, which is the calendar she runs her meetings on.
 * spry.vc is never here: it is read-only by rule (validate:spry-vc-never-sends).
 */
export const DEFAULT_MAILBOX = "sequoia@westpeek.ventures";
export const BRAND_MAILBOXES = Object.freeze([
  Object.freeze({ re: /\btime[- ]?2[- ]?read\b|\btime to read\b|\bdailystory\b/i, mailbox: "st@time-2-read.com", brand: "time-2-read" }),
]);
export const WORKSPACE_MAILBOXES = Object.freeze([DEFAULT_MAILBOX, ...BRAND_MAILBOXES.map((b) => b.mailbox)]);
export function mailboxFor(text) {
  // The brand is in her WORDS, never in an address she wrote (live proof, 25 Oct 2026: a guest at
  // st@time-2-read.com put a plain invite on the time-2-read calendar).
  const words = String(text ?? "").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ");
  for (const b of BRAND_MAILBOXES) if (b.re.test(words)) return b.mailbox;
  return DEFAULT_MAILBOX;
}
/** "on my personal calendar" / "my gmail calendar": the one calendar no delegation can write. */
export const PERSONAL_CALENDAR_RE = /\b(?:personal|gmail|own)\s+calendar\b|\bcalendar\b[^.\n]{0,20}\bgmail\b/i;

/** Her products whose code lives in a repo not named after them. Danielle's lane reads the GitHub address. */
export const PRODUCT_REPOS = Object.freeze([
  Object.freeze({ re: /\btime[- ]?2[- ]?read\b|\btime to read\b/i, product: "time-2-read", github_repo: "seq23/dailystory" }),
]);

const OWN_ADDRESS_RE = /@(?:sequoiataylor\.com|westpeek\.ventures|joinwestpeek\.com|spry\.vc|time-2-read\.com)$|^seq\.taylor@gmail\.com$/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export function addressesIn(text) {
  return [...new Set((String(text ?? "").match(EMAIL_RE) ?? []).map((a) => a.replace(/[.,;:]+$/, "").toLowerCase()))].filter((a) => !OWN_ADDRESS_RE.test(a));
}

// ─── Time ──────────────────────────────────────────────────────────────────

function offsetMs(ts, tz) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}
/** The UTC instant of a wall-clock time in a zone (two passes, so the clock-change days land right). */
export function zonedUtc(y, m, d, h, min, tz) {
  const wall = Date.UTC(y, m - 1, d, h, min);
  const first = wall - offsetMs(wall, tz);
  return wall - offsetMs(first, tz);
}
export function wallIn(ts, tz) {
  const l = new Date(ts + offsetMs(ts, tz));
  return { y: l.getUTCFullYear(), m: l.getUTCMonth() + 1, d: l.getUTCDate(), h: l.getUTCHours(), min: l.getUTCMinutes(), dow: l.getUTCDay() };
}
const addDays = ({ y, m, d }, n) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() }; };

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_RE = /\b(?:(this|next|coming)\s+)?(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?\b(?:\s+(this|next)\s+week)?/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_DAY_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\b/i;
const NUM_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i;
const TIME24_RE = /\bat\s+(\d{1,2}):(\d{2})\b/i;
const NOON_RE = /\b(noon|midday)\b/i;

/** Minutes of the meeting: "for 45 minutes", "an hour", "90-minute call", "1.5 hours". Default 30. */
export function minutesIn(text) {
  const t = String(text ?? "");
  const m = /\bfor\s+(\d+(?:\.\d+)?|an?|one|half an?)\s*(hours?|hrs?|h|minutes?|mins?)\b/i.exec(t)
    ?? /\b(\d+(?:\.\d+)?)[- ]?(hours?|hrs?|minutes?|mins?)\b(?![- ]?(?:trial|day))/i.exec(t)
    ?? /\b(an?|half an?)\s+(hour)\b(?:\s+(?:call|meeting|slot))?/i.exec(t);
  if (!m) return DEFAULT_MINUTES;
  const n = /^half/i.test(m[1]) ? 0.5 : /^(an?|one)$/i.test(m[1]) ? 1 : Number(m[1]);
  const mins = /^h/i.test(m[2]) ? Math.round(n * 60) : Math.round(n);
  return mins >= 5 && mins <= 8 * 60 ? mins : DEFAULT_MINUTES;
}

/**
 * When she means, read in HER zone for the day and in the zone she named for the clock.
 * "Tuesday this week" counts weeks from Sunday (a Sunday email about "Tuesday this week" means the
 * coming Tuesday); a weekday on its own is the next one; "next Tuesday" is the one in next week.
 * Returns `{ start, tz, tzLabel, minutes, said }` or `{ error }` — never a guessed time.
 */
export function whenIn(text, now = Date.now()) {
  const t = String(text ?? "");
  const zm = ZONE_RE.exec(t);
  const [tz] = zm ? ZONES[zm[1].toLowerCase()] : [OWNER_TZ];
  let h = null, min = 0;
  const tm = TIME_RE.exec(t);
  if (tm) {
    h = Number(tm[1]) % 12 + (/^p/i.test(tm[3]) ? 12 : 0);
    min = Number(tm[2] ?? 0);
  } else if (TIME24_RE.test(t)) {
    const x = TIME24_RE.exec(t); h = Number(x[1]); min = Number(x[2]);
  } else if (NOON_RE.test(t)) h = 12;
  if (h === null || h > 23 || min > 59) return { error: "no time of day" };

  const today = wallIn(now, OWNER_TZ);
  let day = null;
  let said = null;
  if (/\bday after tomorrow\b/i.test(t)) { day = addDays(today, 2); said = "the day after tomorrow"; }
  else if (/\btomorrow\b/i.test(t)) { day = addDays(today, 1); said = "tomorrow"; }
  else if (/\b(today|tonight|this (?:morning|afternoon|evening))\b/i.test(t)) { day = addDays(today, 0); said = "today"; }
  else if (MONTH_DAY_RE.test(t)) {
    const x = MONTH_DAY_RE.exec(t);
    const mon = MONTHS.indexOf((x[1] ?? x[4]).slice(0, 3).toLowerCase()) + 1;
    const d = Number(x[2] ?? x[3]);
    let y = today.y;
    if (Date.UTC(y, mon - 1, d) < Date.UTC(today.y, today.m - 1, today.d)) y += 1;
    day = { y, m: mon, d };
  } else if (NUM_DATE_RE.test(t)) {
    const x = NUM_DATE_RE.exec(t);
    const mon = Number(x[1]); const d = Number(x[2]);
    let y = x[3] ? (Number(x[3]) < 100 ? 2000 + Number(x[3]) : Number(x[3])) : today.y;
    if (!x[3] && Date.UTC(y, mon - 1, d) < Date.UTC(today.y, today.m - 1, today.d)) y += 1;
    if (mon >= 1 && mon <= 12 && d >= 1 && d <= 31) day = { y, m: mon, d };
  } else if (DAY_RE.test(t)) {
    const x = DAY_RE.exec(t);
    const want = DAYS.findIndex((n) => n.startsWith(x[2].toLowerCase().slice(0, 3)));
    const pre = (x[1] ?? "").toLowerCase();
    const week = (x[3] ?? "").toLowerCase();
    if (week === "this" || pre === "this") {
      day = addDays(today, want - today.dow);
      said = `${DAYS[want]} this week`;
      if (Date.UTC(day.y, day.m - 1, day.d) < Date.UTC(today.y, today.m - 1, today.d)) day = addDays(day, 7);
    } else if (week === "next" || pre === "next") {
      day = addDays(today, want - today.dow + 7);
      said = `${DAYS[want]} next week`;
    } else {
      let n = (want - today.dow + 7) % 7;
      day = addDays(today, n);
      if (n === 0 && zonedUtc(day.y, day.m, day.d, h, min, tz) <= now) day = addDays(today, 7);
    }
  }
  if (!day) return { error: "no day" };
  const start = zonedUtc(day.y, day.m, day.d, h, min, tz);
  if (start <= now) return { error: "that time has already passed" };
  return { start, tz, tzLabel: zoneLabel(tz), minutes: minutesIn(t), said };
}

/** "Tue 27 Oct" in a zone, built from parts so every runtime's ICU says it the same way. */
export function dayText(ts, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}`;
}
const clockText = (ts, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { t: `${p.hour}:${p.minute}`, half: String(p.dayPeriod ?? "").toLowerCase() };
};
/** "Tue 27 Oct, 9:00–9:30 am" in a zone; `withDay: false` gives just the clock. */
export function slotText(start, minutes, tz, { withDay = true } = {}) {
  const a = clockText(start, tz); const b = clockText(start + minutes * 60_000, tz);
  const range = a.half === b.half ? `${a.t}–${b.t} ${b.half}` : `${a.t} ${a.half}–${b.t} ${b.half}`;
  return withDay ? `${dayText(start, tz)}, ${range}` : range;
}

/** The one plain confirmation: who, when (her zone, and theirs when it differs), the Meet link. */
export function confirmLine({ guestName, guestEmail, start, minutes, tz, meet, calendar }) {
  const who = guestName ? `${guestName} (${guestEmail})` : guestEmail;
  const mine = `${slotText(start, minutes, OWNER_TZ)} Central`;
  const theirs = tz && tz !== OWNER_TZ ? ` (${slotText(start, minutes, tz, { withDay: dayText(start, tz) !== dayText(start, OWNER_TZ) })} ${zoneLabel(tz)} for them)` : "";
  return `Invite sent to ${who} for ${mine}${theirs}${meet ? `. Meet: ${meet}` : ""}${calendar ? `. It's on your ${calendar} calendar.` : "."}`;
}

const gcalStamp = (ts) => new Date(ts).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** The one-tap "Add to my calendar" link for the calendar no delegation can write (her personal Gmail). */
export function renderUrl({ title, start, minutes, guests = [], details = "" }) {
  const q = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${gcalStamp(start)}/${gcalStamp(start + minutes * 60_000)}`, ctz: OWNER_TZ });
  if (details) q.set("details", details);
  if (guests.length) q.set("add", guests.join(","));
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

// ─── The asks ──────────────────────────────────────────────────────────────

const NAME = "([A-Z][a-z'’-]+(?:\\s+[A-Z][a-z'’-]+)?)";
const INVITE_RE = /\b(?:calendar\s+)?invite\b|\b(?:schedule|book|set\s+up|put)\b[^.\n]{0,40}\b(?:call|meeting|meet|zoom|chat)\b/i;

/** "Send a calendar invite to <Name> at <Org> for <when>, <address>" → the invite, or null. */
export function inviteIn(text, now = Date.now()) {
  const t = String(text ?? "");
  if (!INVITE_RE.test(t)) return null;
  // Someone else's address first; one of her own only when it is the only one written (a hold on her
  // own calendar, or the live proof's invite to her own brand mailbox).
  const own = (String(t).match(EMAIL_RE) ?? []).map((x) => x.replace(/[.,;:]+$/, "").toLowerCase()).filter((x) => !/@sequoiataylor\.com$/i.test(x));
  const guest = addressesIn(t)[0] ?? own[0] ?? null;
  const nm = new RegExp(`\\b(?:invite|meeting|call|chat|meet)\\s+(?:to|with|for)\\s+${NAME}`).exec(t)
    ?? new RegExp(`\\binvite\\s+${NAME}`).exec(t);
  const guestName = nm && !DAYS.some((d) => nm[1].toLowerCase().startsWith(d.slice(0, 3)) && nm[1].length <= 9) ? nm[1] : null;
  const org = /\bat\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,3})/.exec(t)?.[1] ?? null;
  const when = whenIn(t, now);
  const personal = PERSONAL_CALENDAR_RE.test(t);
  const title = `${guestName ?? (guest ? guest.split("@")[0] : "Call")}${org ? ` (${org})` : ""} / Sequoia`;
  return {
    guest_email: guest, guest_name: guestName, org, title,
    ...(when.error ? { when_error: when.error } : { start: when.start, minutes: when.minutes, tz: when.tz, said: when.said }),
    calendar: personal ? "personal" : mailboxFor(t),
  };
}

const RELATION = "(?:cousin|aunt|uncle|friend|sister|brother|niece|nephew|colleague|client|neighbou?r|godmother|godfather|mother|father|mom|dad)";
/** "Find my cousin <Name>'s email" / "look up <Name>'s address" → `{ name, relation, hints }`, or null. */
export function lookupIn(text) {
  const t = String(text ?? "");
  const m = new RegExp(`\\b(?:find|look\\s+up|get|dig\\s+up|track\\s+down)\\s+(?:me\\s+)?(?:my\\s+|the\\s+)?(?:(${RELATION})\\s+)?${NAME}(?:['’]s)?\\s+(?:e-?mail|email address|address|contact)`, "i").exec(t)
    ?? new RegExp(`\\bwhat(?:'s| is)\\s+(?:my\\s+)?(?:(${RELATION})\\s+)?${NAME}['’]s\\s+e-?mail`, "i").exec(t);
  if (!m) return null;
  const name = m[2].replace(/['’]s$/, "");
  const hints = [];
  const h = /\b(?:on|in|from)\s+(?:the\s+|my\s+|our\s+)?([A-Za-z0-9][^.\n,;]{2,60}?)\s+(?:google\s+)?(?:drive\s+)?(?:files?|docs?|documents?|sheets?|spreadsheets?|folders?)\b/i.exec(t);
  if (h) hints.push(h[1].replace(/\s+drive$/i, "").trim());
  return { name, relation: m[1]?.toLowerCase() ?? null, hints, drive: /\bdrive\b/i.test(t) || hints.length > 0, gmail: true };
}

const BUILD_RE = /\b(create|add|make|set\s+up|generate|build|change|fix|update|launch)\b/i;
const CODE_RE = /\b([A-Z][A-Z0-9]{4,})\b/;
/** Repo work for one of her products → `{ github_repo, product, instruction, code }`, or null. */
export function repoAskIn(clause) {
  const t = String(clause ?? "");
  const p = PRODUCT_REPOS.find((r) => r.re.test(t));
  if (!p || !BUILD_RE.test(t)) return null;
  if (/^\s*(?:and\s+)?(?:then\s+)?(?:e-?mail|write to|send)\b/i.test(t)) return null;
  return { github_repo: p.github_repo, product: p.product, instruction: t.trim(), code: CODE_RE.exec(t)?.[1] ?? null };
}

const EMAIL_ASK_RE = /\b(?:[Ee]-?mail|[Ww]rite\s+to|[Ss]end\s+(?:an?\s+)?(?:email|note|message)\s+to)\s+(her|him|them|[A-Z][a-z'’-]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/;
/** "email her the code with a short explainer…" → `{ to, pronoun, name, purpose }`, or null. */
export function emailAskIn(clause) {
  const t = String(clause ?? "");
  if (INVITE_RE.test(t) && /\binvite\b/i.test(t)) return null;
  const m = EMAIL_ASK_RE.exec(t);
  if (!m) return null;
  const who = m[1];
  if (/^(?:me|myself|simone|boss)$/i.test(who)) return null;
  const to = who.includes("@") ? who.toLowerCase() : addressesIn(t)[0] ?? null;
  return {
    to, pronoun: /^(her|him|them)$/i.test(who) ? who.toLowerCase() : null,
    name: !who.includes("@") && !/^(her|him|them)$/i.test(who) ? who : null,
    purpose: t.slice(m.index).trim(),
  };
}

/** Things a Claude session could do with her tools that Simone has no executor for yet. */
export const CANT_YET = Object.freeze([
  Object.freeze({ re: /\b(?:[Tt]ext|SMS|sms|[Ii]?[Mm]essage|[Ww]hats[Aa]pp)\s+(?:him|her|them|[A-Z][a-z]+)\b/, what: "send a text message" }),
  Object.freeze({ re: /\b(?:[Cc]all|[Pp]hone|[Rr]ing)\s+(?:him|her|them|[A-Z][a-z]+)\s+(?:for me|and|to|about)\b/, what: "make a phone call" }),
  Object.freeze({ re: /\b(?:mail|post|ship)\s+(?:a|the)\s+(?:letter|package|parcel|card)\b/i, what: "post a letter or a package" }),
  Object.freeze({ re: /\b(?:post|publish)\s+(?:this|it|a\s+post)\s+(?:on|to)\s+(?:instagram|tiktok|linkedin|facebook|x|twitter)\b/i, what: "post on social media" }),
]);

/** One email → its clauses. Sentences, then ", and <verb>" / "; " joins split apart. */
export function clausesIn(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+|\n+|;\s+/)
    .flatMap((s) => s.split(/,?\s+(?:and\s+)?then\s+(?=(?:e-?mail|send|create|find|invite|schedule|book|write)\b)|,\s*and\s+(?=(?:e-?mail|send|create|find|invite|schedule|book|write|make|add)\b)/i))
    .map((s) => s.trim()).filter(Boolean);
}

/**
 * Everything Simone can do in one email, in order, with what waits on what. `ref` is the command's
 * place in the list; `waits_on` names refs. Empty when the email asks for none of these, and then
 * the ordinary triage takes it.
 */
export function commandsIn({ subject = "", text = "", now = Date.now(), sender = "" } = {}) {
  const body = String(text ?? "").trim() || String(subject ?? "").trim();
  // An errand (a booking or request to a business she named, from her own Gmail) is the whole email.
  const errand = sender ? errandIn({ sender, subject, text: body }) : null;
  if (errand) return [{ ref: 0, waits_on: [], kind: "errand", spec: errand }];
  const out = [];
  const add = (c) => { const ref = out.length; out.push({ ref, waits_on: [], ...c }); return ref; };
  const whole = `${subject}\n${body}`;

  // A list of separate asks in which any one is not a command stays with the triage, whole, exactly as
  // before (22 Oct 2026: one email, several desks). Only an email that is ALL commands is Simone's here.
  const listed = splitAsks(body).parts;
  if (listed.length > 1 && listed.some((p) => commandsIn({ text: p, now }).length === 0)) return [];
  let invite = inviteIn(body, now) ?? (INVITE_RE.test(subject) ? inviteIn(whole, now) : null);
  // "a call with the designer next Tuesday": no address and no time is a note for her day, not an invite.
  if (invite && !invite.guest_email && invite.when_error) invite = null;
  const clauses = clausesIn(body);
  let lookupRef = null;
  const look = lookupIn(body);
  if (look) lookupRef = add({ kind: "lookup", spec: look });

  if (invite) {
    const waits = [];
    if (!invite.guest_email && invite.guest_name && lookupRef === null) {
      lookupRef = add({ kind: "lookup", spec: { name: invite.guest_name, relation: null, hints: invite.org ? [invite.org] : [], drive: false, gmail: true } });
    }
    if (!invite.guest_email && lookupRef !== null) waits.push(lookupRef);
    add({ kind: "invite", spec: invite, waits_on: waits });
  }

  let repoRef = null;
  for (const c of clauses) {
    // A code for time-2-read is a row, not a rebuild: Simone adds it herself. Anything bigger is Danielle's.
    const code = accessCodeIn(c);
    if (code && repoRef === null) { repoRef = add({ kind: "access_code", spec: { ...code, product: "time-2-read" } }); continue; }
    const r = repoAskIn(c);
    if (r && repoRef === null) repoRef = add({ kind: "repo", spec: r });
  }
  for (const c of clauses) {
    const e = invite ? null : emailAskIn(c);
    if (!e) continue;
    const waits = [];
    if (!e.to && lookupRef === null && e.name) lookupRef = add({ kind: "lookup", spec: { name: e.name, relation: null, hints: [], drive: false, gmail: true } });
    if (!e.to && lookupRef !== null) waits.push(lookupRef);
    if (repoRef !== null) waits.push(repoRef);
    const brand = PRODUCT_REPOS.find((p) => p.re.test(whole))?.product ?? null;
    add({
      kind: "email", waits_on: waits,
      spec: { ...e, from_mailbox: mailboxFor(whole), brand, code: out[repoRef ?? -1]?.spec?.code ?? CODE_RE.exec(c)?.[1] ?? null, ask: body.slice(0, 4000), recipient_name: look?.name ?? e.name ?? null },
    });
    break;
  }
  if (out.length === 0) {
    for (const k of CANT_YET) if (k.re.test(body)) { add({ kind: "cant_yet", spec: { what: k.what, ask: body.slice(0, 2000) } }); break; }
  }
  return out;
}

// ─── time-2-read access codes, with no rebuild ─────────────────────────────

/**
 * THE TABLE SIMONE WRITES, NAMED FROM ITS OWN MIGRATION (seq23/dailystory
 * supabase/migrations/20261025120000_access_codes.sql, landed in #72). A code is a row; the
 * signup counts are a view. `tests/simoneCommands.test.ts` reads the migration (a verbatim copy in
 * tests/fixtures/dailystory/) and fails if any name here stops matching it.
 */
export const ACCESS_CODE_SHAPE = Object.freeze({
  table: "access_codes",
  columns: Object.freeze(["code", "trial_days", "label", "active"]),
  view: "access_code_signups",
  view_columns: Object.freeze(["code", "label", "trial_days", "active", "checkouts_started", "signups"]),
  max_days: 730,
});
/** Stored the way the table's CHECK demands: upper case, no whitespace. */
export const normaliseCode = (c) => String(c ?? "").replace(/\s+/g, "").toUpperCase();

const T2R_RE = /\btime[- ]?2[- ]?read\b|\btime to read\b/i;
const CODE_WORD = "([A-Za-z][A-Za-z0-9]{3,29})";
/**
 * "make a time-2-read code TEACHERS30 for 30 days for the teachers group" → create;
 * "how many used HOMESCHOOL15?" → count; "turn off code X" → off. Null otherwise.
 * A code word must be written in capitals (or follow the word "code"), so ordinary words never are.
 */
export function accessCodeIn(text) {
  const t = String(text ?? "");
  const mentions = T2R_RE.test(t) || /\bcodes?\b/i.test(t) || /\b[A-Z]{2,}[0-9]+\b/.test(t);
  if (!mentions) return null;
  const off = new RegExp(`\\b(?:turn\\s+off|switch\\s+off|disable|deactivate|stop|kill|retire)\\s+(?:the\\s+)?(?:time[- ]?2[- ]?read\\s+)?(?:code\\s+)?${CODE_WORD}\\b`, "i").exec(t);
  if (off && /[A-Z0-9]{4,}/.test(off[1])) return { op: "off", code: normaliseCode(off[1]) };
  const count = new RegExp(`\\bhow\\s+many\\b[^.?\\n]{0,60}?\\b(?:used|redeemed|signed\\s+up|uses?)\\b(?:[^.?\\n]{0,30}?\\b${CODE_WORD})?`, "i").exec(t);
  if (count) {
    const code = count[1] && /[A-Z0-9]{4,}/.test(count[1]) ? normaliseCode(count[1]) : null;
    if (code || /\bcodes?\b/i.test(t)) return { op: "count", code };
  }
  const make = new RegExp(`\\b(?:make|create|add|set\\s+up|generate|new)\\b[^.\\n]{0,40}?\\bcode\\s+${CODE_WORD}\\b([^.\\n]*)`, "i").exec(t);
  if (make && T2R_RE.test(t) && /[A-Z0-9]{4,}/.test(make[1])) {
    const rest = make[2] ?? "";
    const days = /\b(\d{1,3})[- ]?days?\b/i.exec(rest) ?? /\b(\d{1,3})[- ]?days?\b/i.exec(t);
    if (!days) return { op: "create", code: normaliseCode(make[1]), error: "how many days the trial is" };
    const n = Number(days[1]);
    const label = /\bfor\s+(?:the\s+|my\s+|our\s+)?([a-z][^,.;\n]{2,60}?)\s*(?:$|[,.;])/i.exec(rest.replace(/\bfor\s+(?:a\s+)?\d{1,3}[- ]?days?(?:\s+trial)?/i, ""))?.[1]?.trim() ?? null;
    return { op: "create", code: normaliseCode(make[1]), trial_days: n, label, ...(n < 1 || n > ACCESS_CODE_SHAPE.max_days ? { error: `a trial between 1 and ${ACCESS_CODE_SHAPE.max_days} days` } : {}) };
  }
  return null;
}

/** One line per code for her: the code, the trial, who it's for, and how many have used it. */
export function codeLines(rows) {
  return (rows ?? []).map((r) => `${r.code}: ${r.trial_days}-day trial${r.label ? `, ${r.label}` : ""}${r.active === false ? " (off)" : ""}. Used ${Number(r.checkouts_started ?? 0)} time${Number(r.checkouts_started ?? 0) === 1 ? "" : "s"}, ${Number(r.signups ?? 0)} signed up.`);
}

// ─── Her replies on a command's thread ─────────────────────────────────────

/** Her own words in a reply: the quoted email below them is never read as an instruction. */
export function ownWords(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const out = [];
  for (const l of lines) {
    if (/^\s*>/.test(l) || /^\s*On .{4,120} wrote:\s*$/.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^\s*From:\s/.test(l)) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

/** What a reply on a command's thread says. `null` when it says none of these. */
export function commandReplyIn(text, now = Date.now()) {
  const t = ownWords(text);
  if (!t) return null;
  const first = t.split("\n").find((l) => l.trim()) ?? "";
  if (/^\s*(?:cancel|never\s?mind|stop|don'?t send|do not send|skip)\b/i.test(first)) return { verb: "cancel" };
  if (/^\s*(?:send(?: it| as is)?|yes,?\s+send|go ahead(?: and send)?|looks good,? send)\b[\s.!]*$/i.test(first)) return { verb: "send" };
  if (/^\s*(?:try again|redo|start again|another version|rewrite it)\b/i.test(first)) return { verb: "retry" };
  if (/^\s*(?:book(?: it)? anyway|anyway|keep it|book it)\b/i.test(first)) return { verb: "anyway" };
  const pick = /^\s*(?:#|no\.?\s*|number\s*|option\s*)?([1-9])\s*[.)!]?\s*$/i.exec(first)
    ?? /^\s*(?:the\s+)?(first|second|third|fourth|fifth)(?:\s+one)?\b/i.exec(first);
  if (pick) return { verb: "pick", n: /^\d$/.test(pick[1]) ? Number(pick[1]) : ["first", "second", "third", "fourth", "fifth"].indexOf(pick[1].toLowerCase()) + 1 };
  const addr = addressesIn(t)[0];
  if (addr) return { verb: "address", email: addr };
  const ch = /^\s*(?:change|edit|make it|instead)\b[:,\s-]*([\s\S]*)$/i.exec(t);
  if (ch) return { verb: "change", note: ch[1].trim() || t };
  const when = whenIn(t, now);
  if (!when.error) return { verb: "time", when };
  return { verb: "note", note: t.slice(0, 2000) };
}

// ─── Errands: a booking or request to a business she named ─────────────────

/**
 * SIMONE RUNS HER ERRANDS (owner, 26 Oct 2026): "have one of my boss os agents pretend to be my
 * assistant to get me reservations +1 to this place on thursday night after 8pm: <address> … and make
 * sure going forward i can email simone to do this kind of thing".
 *
 * A booking or request to a business (a table, an appointment, a hold, a reservation) whose address
 * she wrote in THIS email. Her email is the approval: Simone sends the request as her assistant with
 * no second Send, from simone@ with Reply-To simone@ and NO copy to her by default ("she doesnt have
 * to cc me next time"), watches for the answer and tells her what they said.
 *
 * NARROW ON PURPOSE. Each of these keeps the ordinary path (a draft for her Send, or the triage):
 *   - a sender other than ERRAND_SENDERS (her own Gmail only);
 *   - no address in her words, or more than one (an address is never guessed or looked up for this);
 *   - one of her own addresses (OWN_ADDRESS_RE) or a West Peek / spry.vc domain;
 *   - money in her words (pay, deposit, card, buy, $…): agents never spend money;
 *   - trading, LPs, West Peek, the fund: never an errand.
 */
export const ERRAND_SENDERS = Object.freeze(["seq.taylor@gmail.com"]);
const ERRAND_ASK_RE = /\b(?:book(?:ing)?|reserv(?:e|ation|ations)|table\s+for|appointment|hold\s+(?:a|me|us)|get\s+(?:me|us)\s+(?:a\s+)?(?:table|spot|seat|reservation|appointment)|request\s+(?:a|an)\s+(?:table|spot|seat|reservation|appointment|room|booking))\b/i;
export const ERRAND_MONEY_RE = /\b(?:pay|paying|payment|deposit|card|credit|debit|purchase|buy|invoice|wire|spend|prepay|charge|venmo|zelle)\b|\$\s?\d/i;
const ERRAND_NEVER_RE = /\b(?:LPs?|west\s*peek|the\s+fund|trad(?:e|ing)|shares?|secondar(?:y|ies)|allocation|invest(?:or|ment|ing)?s?|rainmaker)\b/i;
const ERRAND_NEVER_DOMAIN_RE = /@(?:[a-z0-9-]+\.)*(?:westpeek\.ventures|joinwestpeek\.com|spry\.vc)$/i;

/** Why an email is NOT an errand, or null when it is. Pure; the one definition intake and classify share. */
export function errandRefusal({ sender = "", subject = "", text = "" } = {}) {
  const s = String(sender ?? "").trim().toLowerCase().replace(/.*<|>.*/g, "");
  if (!ERRAND_SENDERS.includes(s)) return "not from her own address";
  const words = `${subject ?? ""}\n${text ?? ""}`;
  if (!ERRAND_ASK_RE.test(words)) return "not a booking or request";
  const all = [...new Set((words.match(EMAIL_RE) ?? []).map((a) => a.replace(/[.,;:]+$/, "").toLowerCase()))];
  const outside = addressesIn(words);
  if (all.some((a) => ERRAND_NEVER_DOMAIN_RE.test(a))) return "a West Peek or spry.vc address";
  if (outside.length === 0) return "no business address in her words (never guessed)";
  if (outside.length > 1) return "more than one address";
  if (ERRAND_MONEY_RE.test(words)) return "money is involved";
  if (ERRAND_NEVER_RE.test(words)) return "fund, trading or LP work";
  return null;
}

/** `{ to, ask }` for an errand Simone may send on her word, or null. */
export function errandIn({ sender = "", subject = "", text = "" } = {}) {
  if (errandRefusal({ sender, subject, text })) return null;
  const words = `${subject ?? ""}\n${text ?? ""}`.trim();
  return { to: addressesIn(words)[0], ask: words.slice(0, 2000) };
}

/** The request Simone sends, word for word. `request` is one phrase ("a table for two on Thursday, October 29, any time after 8:00 pm"). */
export function errandText(request) {
  return [
    "Hello,",
    "",
    `I'm writing on behalf of Sequoia Taylor to request ${String(request ?? "").trim().replace(/[.\s]+$/, "")}. Please let me know what's available and anything you need to confirm.`,
    "",
    "Thank you,",
    "Simone",
    "Assistant to Sequoia Taylor",
  ].join("\n");
}

/** What is wrong with a request before it goes, by name. `[]` means it may go. Pure. */
export function errandProblems({ subject = "", request = "" } = {}) {
  const p = [];
  const r = String(request ?? "");
  if (!String(subject ?? "").trim()) p.push("no subject");
  if (r.trim().length < 8) p.push("no request");
  if (r.length > 300) p.push("the request is too long for one sentence");
  if (/\b(?:AI|artificial intelligence|bot|automated|language model|Claude)\b/.test(`${subject}\n${r}`)) p.push("it mentions AI");
  if (/\d[\d\s-]{11,}\d/.test(r)) p.push("it carries a long number (a card or phone number)");
  if (ERRAND_MONEY_RE.test(r)) p.push("it mentions money");
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(r) || /https?:\/\//.test(r)) p.push("it carries an address or a link");
  return p;
}

const CARD_ASK_RE = /\b(?:credit\s+card|card\s+(?:number|details|on\s+file|to\s+(?:hold|secure|guarantee))|deposit|prepay(?:ment)?|pre-?authori[sz]|payment|cancellation\s+fee|no-?show\s+fee)\b/i;
const CONFIRMED_RE = /\b(?:confirm(?:ed|ing)?|you(?:'re| are)\s+(?:all\s+)?set|booked|look\s+forward\s+to\s+(?:seeing|welcoming)|see\s+you\s+(?:on|then))\b/i;
const ALTERNATIVE_RE = /\b(?:fully\s+booked|no\s+availability|not\s+available|unavailable|waitlist|wait\s+list|instead|alternative|earliest|latest|only\s+have|we\s+have\s+(?:a\s+)?(?:table|availability)\s+at|would\s+\d{1,2}(?::\d\d)?\s*(?:am|pm)?\s+work)\b/i;

/**
 * Their answer, read for her: `{ kind, what_they_said, what_you_do }`. A card, deposit or payment ask
 * is ALWAYS hers ("card"): no agent fills one. Pure; the words she reads are built from it.
 */
export function readErrandReply(text, address = "them") {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const said = t.length > 400 ? `${t.slice(0, 400).replace(/\s+\S*$/, "")}…` : t;
  const at = address && address !== "them" ? `them at ${address}` : "them";
  if (CARD_ASK_RE.test(t)) return { kind: "card", what_they_said: said, what_you_do: `They want a card or deposit to hold it. Only you can give that; no one on your team will. If you want it, write to ${at}.` };
  if (ALTERNATIVE_RE.test(t)) return { kind: "alternative", what_they_said: said, what_you_do: `They offered something different. If it works, write to ${at} to take it.` };
  if (CONFIRMED_RE.test(t)) return { kind: "confirmed", what_they_said: said, what_you_do: "Nothing. It's booked." };
  return { kind: "other", what_they_said: said, what_you_do: `Read what they said, and answer ${at} if it needs you.` };
}
