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

export const PREP_PREFIX = "Prep: ";
export const PREP_TZ = "America/Chicago";
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

/** "12pm", "12:30pm". */
export function clock(at) {
  const { hour, minute } = parts(at);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${minute ? `:${String(minute).padStart(2, "0")}` : ""}${hour >= 12 ? "pm" : "am"}`;
}
/** "Fri 30 Oct". */
export function shortDate(at) {
  const p = parts(at);
  const [, m, d] = p.date.split("-").map(Number);
  return `${p.weekday} ${d} ${SHORT_MONTHS[m - 1]}`;
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

/** The idempotency key: the event's own id and the day it is on. */
export const prepKey = (e) => `${e.ical_uid || e.calendar_uid}|${dayOfCt(e.scheduled_at)}`;

/**
 * What is due now. From 18:00 Central: every meeting tomorrow. Any hour: a meeting later today that
 * has had no prep (added today, or the Mac was asleep last evening). Never one already sent.
 */
export function dueMeetings(events, { now = Date.now(), sent = new Set(), day = null } = {}) {
  const today = dayOfCt(now);
  const tomorrow = addDays(today, 1);
  const evening = hourOfCt(now) >= EVENING_HOUR;
  return dedupeEvents(events).filter((e) => {
    if (e.all_day || NOT_A_MEETING.test(String(e.title ?? "").trim())) return false;
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

const KIND_WORDS = {
  family_office: "family office", sovereign_wealth: "sovereign wealth fund", fund_of_funds: "fund of funds",
  pension_endowment_foundation: "pension, endowment or foundation", secondary_fund: "secondaries fund",
  crossover_growth: "crossover or growth fund", spv_manager: "SPV manager", inbox_buyer: "buyer from your inbox",
};

/** "LP prospect", "LP", "broker", or the relationship's own kind. Null when nothing says. */
export function roleOf(rec) {
  if (rec.lp) return "LP";
  if (rec.prospect) return "LP prospect";
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

// ─── The email ───────────────────────────────────────────────────────────────

/**
 * One meeting's prep. `data`: { prospects, lpReplies, people, touches, references, deals, news,
 * summaries } (any may be missing), `herAddresses`. Returns { key, subject, sections, text } where
 * `sections` are layoutEmail sections (title + items) and only the ones with something real.
 */
export function buildPrep(event, data = {}, { herAddresses = [] } = {}) {
  const guests = others(event, herAddresses);
  const lead = guests[0] ?? null;
  const titleName = nameFromTitle(event.title);
  const leadName = lead?.name || titleName || null;
  const rec = recordsFor({ email: lead?.email ?? null, name: leadName }, data);
  const name = leadName ?? rec.prospect?.name ?? rec.lp?.name ?? rec.person?.full_name ?? null;
  const firm = rec.prospect?.firm ?? rec.lp?.firm ?? rec.person?.organization_name ?? rec.deals[0]?.from_firm ?? null;
  const role = roleOf(rec);

  const who = name ? `${name}${firm && !name.includes(firm) ? ` (${firm})` : ""}` : (counterpartFromTitle(event.title) ?? lead?.email ?? (String(event.title ?? "").trim() || "Meeting"));
  const subject = `${PREP_PREFIX}${who}, ${shortDate(event.scheduled_at)}, ${clock(event.scheduled_at)}`;
  const sections = [];

  // Who they are.
  const whoItems = [];
  const roleBits = [rec.person?.title ?? rec.person?.role ?? null, firm ? `at ${firm}` : null].filter(Boolean).join(" ");
  if (name && (roleBits || role)) {
    const kind = rec.prospect?.kind && KIND_WORDS[rec.prospect.kind] ? `, ${KIND_WORDS[rec.prospect.kind]}` : "";
    whoItems.push(`${name}${roleBits ? `, ${roleBits}` : ""}${role ? `. ${role[0].toUpperCase()}${role.slice(1)}${kind}` : ""}.`);
  }
  if (rec.prospect?.status === "interested") whoItems.push("They said they are interested.");
  if (rec.lp?.bucket === "call") whoItems.push("They asked for a call.");
  if (whoItems.length) sections.push({ title: "Who they are", items: whoItems });

  // Your history.
  const hist = [];
  const firstAt = [rec.touches[0]?.sent_at, atOf(rec.prospect?.first_sent_at), atOf(rec.lp?.first_seen)].filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b)[0];
  if (firstAt) hist.push(`First contact: ${dayMonth(firstAt)}.`);
  const last = rec.touches.at(-1);
  if (last && bodyLead(last.body)) hist.push(`Last thing you said (${dayMonth(last.sent_at)}): "${bodyLead(last.body)}"`);
  const theirs = rec.prospect?.reply_note || rec.lp?.quote || null;
  if (theirs) hist.push(`Last thing they said${rec.lp?.first_seen ? ` (${dayMonth(atOf(rec.lp.first_seen))})` : ""}: "${firstSentence(theirs)}"`);
  if (rec.prospect?.has_draft || rec.lp?.status === "drafted") hist.push("Open: a reply to them is drafted and waiting for your yes.");
  if (hist.length) sections.push({ title: "Your history", items: hist });

  // What you referenced: only references whose link was checked and resolves.
  // Only a link her Mac checked and found answering: never a reference to something that is not there.
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
  if (role === "LP" || role === "LP prospect") {
    const sells = (data.deals ?? []).filter((d) => /sell/i.test(String(d.side ?? "")) && !d.hers).slice(0, 3);
    if (sells.length) rel.push(`On the grid now that fits an LP: ${sells.map((d) => `${d.company}${d.size ? ` ${d.size}` : ""}`).join("; ")}.`);
  }
  for (const n of (data.news ?? {})[firm ?? ""] ?? []) rel.push({ text: `News: ${n.title}${n.date ? ` (${n.date})` : ""}`, links: n.url ? [{ label: "Read it", url: n.url }] : [] });
  if (rel.length) sections.push({ title: "What's relevant now", items: rel });

  // Bring up: from what is above, never invented; one ask by who they are.
  const bring = [];
  if (theirs) bring.push(`What they last said: "${firstSentence(theirs)}"`);
  if (refs[0]) bring.push(`The piece you mentioned${(data.summaries ?? {})[refs[0].url]?.title ? `: "${data.summaries[refs[0].url].title}"` : ""}.`);
  if (theirOrders[0]) bring.push(theirOrders[0].replace(/^Their order on the grid: /, "Their order: "));
  else if (rel[0] && typeof rel[0] === "string") bring.push(rel[0]);
  const ask = role === "LP" || role === "LP prospect" ? "Ask: would they like to see the names on this week's list?"
    : role === "broker" ? "Ask: are their orders still live, and at what price?" : null;
  if (bring.length || ask) sections.push({ title: "Bring up", items: [...bring.slice(0, 3), ...(ask ? [ask] : [])] });

  // Logistics.
  const logi = [];
  const end = event.duration_min ? event.scheduled_at + event.duration_min * 60_000 : null;
  logi.push(`${shortDate(event.scheduled_at)}, ${clock(event.scheduled_at)}${end ? ` to ${clock(end)}` : ""} Central.`);
  const join = event.join_url ?? (/^https:\/\/\S+$/.test(String(event.location ?? "")) ? event.location : null);
  if (join) logi.push({ text: "Join the call", links: [{ label: "Join", url: join }] });
  if (event.location && event.location !== join) logi.push(`Where: ${event.location}.`);
  if (guests.length) logi.push(`Who is on it: ${guests.map((g) => g.name || g.email).join(", ")}.`);
  sections.push({ title: "Logistics", items: logi });

  return { key: prepKey(event), subject, who, sections, happened: `Your prep for ${String(event.title ?? "your meeting").trim()}.` };
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
