/**
 * SIMONE'S HANDS IN GOOGLE: HER WORKSPACE CALENDARS, AND ONE SEND SHE TAPPED.
 *
 * Through the domain-wide delegation service account (GSC_SERVICE_ACCOUNT_JSON), impersonating only
 * the Workspace mailboxes in `WORKSPACE_MAILBOXES` (src/shared/boss/commands/parse.mjs) — never
 * spry.vc, never a mailbox a caller names that is not on that list. Probed 25 Oct 2026: calendar.events
 * and gmail.compose are both granted for both mailboxes.
 *
 *   · Calendar: list the slot (the clash check), insert the event with a Google Meet link and
 *     `sendUpdates=all` (that IS the invite), swap a bounced guest, delete (the live proof's clean-up).
 *   · Gmail: send ONE message whose words she saw word for word and tapped Send on. The only caller
 *     is `sendApprovedEmail` in ./run.ts, which refuses unless the row is in state `approved`.
 *
 * Every failure is returned as a sentence, never thrown with a token or key inside it.
 */
import { stageSentMail } from "../mail/history";
import { throughOwnerDoor } from "../mail/ownerDoor";
import type { Env } from "../env";
import { serviceAccountFrom, mintComposeToken, type ServiceAccount } from "../wealth/gmailDraft";
import { WORKSPACE_MAILBOXES } from "../../../shared/boss/commands/parse.mjs";
import { CENTRAL, dayOf, instantAt } from "../../../shared/boss/schedule/clock.mjs";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** Tests swap this for a fake Google; production is the platform fetch. */
const platform: typeof fetch = globalThis.fetch.bind(globalThis);
let fetchImpl: typeof fetch = platform;
export function setCommandFetch(f: typeof fetch | null): void {
  fetchImpl = f ?? platform;
}

const b64url = (bytes: ArrayBuffer | string): string => {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [A-Z ]+-----/, "").replace(/-----END [A-Z ]+-----/, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function mailboxAllowed(mailbox: string): boolean {
  return (WORKSPACE_MAILBOXES as readonly string[]).includes(String(mailbox ?? "").toLowerCase());
}

async function calendarToken(creds: ServiceAccount, mailbox: string): Promise<{ ok: true; token: string } | { ok: false; why: string }> {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: creds.client_email, sub: mailbox, scope: EVENTS_SCOPE, aud: TOKEN_ENDPOINT, iat, exp: iat + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(creds.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(sig)}` }).toString(),
  });
  if (!res.ok) return { ok: false, why: `Google refused the calendar sign-in for ${mailbox} (${res.status})` };
  const token = ((await res.json().catch(() => ({}))) as { access_token?: string }).access_token;
  return token ? { ok: true, token } : { ok: false, why: "Google's sign-in answer carried no token" };
}

type Cal = { ok: true; token: string; mailbox: string } | { ok: false; why: string };
async function calendarFor(env: Env, mailbox: string): Promise<Cal> {
  if (!mailboxAllowed(mailbox)) return { ok: false, why: `${mailbox} is not a Workspace calendar Simone may write` };
  const creds = serviceAccountFrom(env);
  if (!creds) return { ok: false, why: "the Google key is not on the Worker" };
  const t = await calendarToken(creds, mailbox);
  return t.ok ? { ok: true, token: t.token, mailbox } : t;
}

export interface Busy { title: string; start: number; end: number }

interface CalendarEvent {
  id?: string;
  etag?: string;
  eventType?: string;
  status?: string;
  summary?: string;
  transparency?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  organizer?: { self?: boolean };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  attendeesOmitted?: boolean;
  recurrence?: string[];
  recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string> };
}

const EVENTS = `${CALENDAR}/primary/events`;

async function listCalendarEvents(token: string, query: URLSearchParams) {
  const events: CalendarEvent[] = [];
  const seenTokens = new Set<string>();
  query.set("maxResults", "50");
  query.set("fields", "nextPageToken,items(id,etag,eventType,status,summary,transparency,start,end,organizer/self,attendees(self,responseStatus),attendeesOmitted,recurrence,recurringEventId,extendedProperties/private)");
  for (let page = 0; page < 5; page++) {
    const res = await fetchImpl(`${EVENTS}?${query}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return { ok: false, why: `the calendar could not be read (${res.status})` } as const;
    const result = (await res.json().catch(() => null)) as { items?: CalendarEvent[]; nextPageToken?: string } | null;
    if (!result || !Array.isArray(result.items)) return { ok: false, why: "Google Calendar did not return the events for this time" } as const;
    events.push(...result.items);
    const nextPage = result.nextPageToken;
    if (!nextPage) return { ok: true, events } as const;
    if (seenTokens.has(nextPage)) break;
    seenTokens.add(nextPage);
    query.set("pageToken", nextPage);
  }
  return { ok: false, why: "Google Calendar could not confirm all matching events" } as const;
}

function calendarWindow(start: number, end: number) {
  return new URLSearchParams({
    timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(), singleEvents: "true", orderBy: "startTime",
  });
}

/** What is already on the calendar inside [start, end). Declined, free and cancelled events do not clash. */
export async function clashes(env: Env, mailbox: string, start: number, end: number): Promise<{ ok: true; busy: Busy[] } | { ok: false; why: string }> {
  const cal = await calendarFor(env, mailbox);
  if (!cal.ok) return cal;
  const listed = await listCalendarEvents(cal.token, calendarWindow(start, end));
  if (!listed.ok) return listed;
  const busy: Busy[] = [];
  for (const event of listed.events) {
    if (event.status === "cancelled" || event.transparency === "transparent" || !event.start?.dateTime) continue;
    if (event.attendees?.find((attendee) => attendee.self)?.responseStatus === "declined") continue;
    const eventStart = Date.parse(event.start.dateTime);
    const eventEnd = Date.parse(event.end?.dateTime ?? event.start.dateTime);
    if (eventStart < end && eventEnd > start) {
      busy.push({ title: String(event.summary ?? "(busy)").slice(0, 120), start: eventStart, end: eventEnd });
    }
  }
  return { ok: true, busy };
}

function personalTimedEvent(event: CalendarEvent): event is CalendarEvent & { id: string; etag: string } {
  return Boolean(event.id && event.etag && event.status === "confirmed" && event.eventType === "default" &&
    event.organizer?.self === true && !event.attendeesOmitted && !event.attendees?.length &&
    !event.recurrence?.length && !event.recurringEventId);
}

/** Move one exact private block and preserve its duration, details and reminders. */
export async function moveCalendarBlock(env: Env, input: {
  mailbox: string; title: string; from: number; to: number; requestKey: string;
}) {
  const cal = await calendarFor(env, input.mailbox);
  if (!cal.ok) return { ok: false, code: "CALENDAR_UNAVAILABLE" } as const;
  const marker = "bossSimoneMove";
  const endMarker = "bossSimoneMoveEnd";
  const receipt = (event: CalendarEvent, expectedId?: string) => {
    const properties = event.extendedProperties?.private;
    const end = Date.parse(event.end?.dateTime ?? "");
    if (personalTimedEvent(event) && (!expectedId || event.id === expectedId) && event.summary === input.title &&
        Date.parse(event.start?.dateTime ?? "") === input.to && end > input.to &&
        properties?.[marker] === input.requestKey && properties[endMarker] === String(end)) {
      return { ok: true, eventId: event.id, end } as const;
    }
    return { ok: false, code: "CALENDAR_BLOCK_CHANGED" } as const;
  };

  const recovered = await listCalendarEvents(cal.token, new URLSearchParams({
    privateExtendedProperty: `${marker}=${input.requestKey}`,
  }));
  if (!recovered.ok) return { ok: false, code: "CALENDAR_UNAVAILABLE" } as const;
  if (recovered.events.length === 1) return receipt(recovered.events[0]!);
  if (recovered.events.length > 1) return { ok: false, code: "CALENDAR_BLOCK_AMBIGUOUS" } as const;

  const listed = await listCalendarEvents(cal.token, calendarWindow(input.from, input.from + 1000));
  if (!listed.ok) return { ok: false, code: "CALENDAR_UNAVAILABLE" } as const;
  const matches = listed.events.filter((event) => event.status !== "cancelled" && event.summary === input.title &&
    Date.parse(event.start?.dateTime ?? "") === input.from);
  if (matches.length > 1) return { ok: false, code: "CALENDAR_BLOCK_AMBIGUOUS" } as const;
  const event = matches[0];
  if (!event) return { ok: false, code: "CALENDAR_BLOCK_NOT_FOUND" } as const;
  const duration = Date.parse(event.end?.dateTime ?? "") - input.from;
  if (!personalTimedEvent(event) || !(duration > 0)) return { ok: false, code: "CALENDAR_BLOCK_NOT_EDITABLE" } as const;

  const end = input.to + duration;
  const res = await fetchImpl(`${EVENTS}/${encodeURIComponent(event.id)}?sendUpdates=none`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${cal.token}`, "content-type": "application/json", "if-match": event.etag },
    body: JSON.stringify({
      start: { dateTime: new Date(input.to).toISOString() }, end: { dateTime: new Date(end).toISOString() },
      extendedProperties: { private: { [marker]: input.requestKey, [endMarker]: String(end) } },
    }),
  });
  if (res.status === 404 || res.status === 410 || res.status === 412) return { ok: false, code: "CALENDAR_BLOCK_CHANGED" } as const;
  if (!res.ok) return { ok: false, code: "CALENDAR_UNAVAILABLE" } as const;
  const saved = await res.json().catch(() => null) as CalendarEvent | null;
  return saved ? receipt(saved, event.id) : { ok: false, code: "CALENDAR_UNAVAILABLE" } as const;
}

/** Create the event with a Meet link and invite the guests. `sendUpdates=all` is what emails them. */
export async function createInvite(env: Env, input: { mailbox: string; title: string; start: number; minutes: number; guests: string[]; requestId: string; description?: string; eventId?: string }):
  Promise<{ ok: true; eventId: string; meet: string | null; htmlLink: string | null } | { ok: false; why: string }> {
  const cal = await calendarFor(env, input.mailbox);
  if (!cal.ok) return cal;
  const body = {
    ...(input.eventId ? { id: input.eventId } : {}),
    summary: input.title,
    description: input.description ?? "",
    start: { dateTime: new Date(input.start).toISOString() },
    end: { dateTime: new Date(input.start + input.minutes * 60_000).toISOString() },
    attendees: input.guests.map((email) => ({ email })),
    conferenceData: { createRequest: { requestId: input.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
  };
  const res = await fetchImpl(`${CALENDAR}/primary/events?conferenceDataVersion=1&sendUpdates=all`, {
    method: "POST", headers: { authorization: `Bearer ${cal.token}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, why: `Google Calendar refused the event (${res.status})` };
  const e = (await res.json().catch(() => ({}))) as any;
  if (typeof e.id !== "string" || (input.eventId && input.eventId !== e.id)) {
    return { ok: false, why: "Google Calendar did not confirm the event ID" };
  }
  const meet = e.hangoutLink ?? (e.conferenceData?.entryPoints ?? []).find((p: any) => p.entryPointType === "video")?.uri ?? null;
  return { ok: true, eventId: e.id, meet, htmlLink: e.htmlLink ?? null };
}

/** Recover an invite the provider may have created before its receipt reached Boss OS. */
export async function readInvite(env: Env, input: { mailbox: string; eventId: string; start: number; minutes: number; guest: string }) {
  const cal = await calendarFor(env, input.mailbox);
  if (!cal.ok) return cal;
  const res = await fetchImpl(`${CALENDAR}/primary/events/${encodeURIComponent(input.eventId)}`, {
    headers: { authorization: `Bearer ${cal.token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) return { ok: false, why: `the existing invite could not be checked (${res.status})` } as const;
  const e = (await res.json().catch(() => ({}))) as any;
  if (e.id !== input.eventId || e.status === "cancelled" || Date.parse(e.start?.dateTime) !== input.start ||
      Date.parse(e.end?.dateTime) !== input.start + input.minutes * 60_000 ||
      !(e.attendees ?? []).some((attendee: any) => attendee.email?.toLowerCase() === input.guest.toLowerCase())) {
    return { ok: false, why: "the saved calendar event does not match the invitation" } as const;
  }
  return { ok: true, eventId: e.id as string, meet: e.hangoutLink ?? null, htmlLink: e.htmlLink ?? null } as const;
}

/** Swap one guest for another on the SAME event (a bounced address); the new one is invited. */
export async function replaceGuest(env: Env, input: { mailbox: string; eventId: string; from: string; to: string }): Promise<{ ok: true } | { ok: false; why: string }> {
  const cal = await calendarFor(env, input.mailbox);
  if (!cal.ok) return cal;
  const url = `${CALENDAR}/primary/events/${encodeURIComponent(input.eventId)}`;
  const got = await fetchImpl(url, { headers: { authorization: `Bearer ${cal.token}` } });
  if (!got.ok) return { ok: false, why: `the event could not be read (${got.status})` };
  const e = (await got.json().catch(() => ({}))) as any;
  const kept = (e.attendees ?? []).filter((a: any) => String(a.email).toLowerCase() !== input.from.toLowerCase());
  const res = await fetchImpl(`${url}?sendUpdates=all`, {
    method: "PATCH", headers: { authorization: `Bearer ${cal.token}`, "content-type": "application/json" },
    body: JSON.stringify({ attendees: [...kept, { email: input.to }] }),
  });
  return res.ok ? { ok: true } : { ok: false, why: `Google Calendar refused the change (${res.status})` };
}

/** Delete an event Simone made (the live proof cleans up after itself). Guests are not emailed. */
export async function deleteInvite(env: Env, input: { mailbox: string; eventId: string }): Promise<{ ok: true } | { ok: false; why: string }> {
  const cal = await calendarFor(env, input.mailbox);
  if (!cal.ok) return cal;
  const res = await fetchImpl(`${CALENDAR}/primary/events/${encodeURIComponent(input.eventId)}?sendUpdates=none`, { method: "DELETE", headers: { authorization: `Bearer ${cal.token}` } });
  return res.ok || res.status === 410 ? { ok: true } : { ok: false, why: `Google Calendar refused the delete (${res.status})` };
}

function mime(input: { from: string; to: string; subject: string; text: string; inReplyTo?: string | null }): string {
  const enc = (s: string) => btoa(unescape(encodeURIComponent(s)));
  // A reply on the person's own thread (an invitation she answered): In-Reply-To and References.
  const thread = input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`] : [];
  return [
    `From: Sequoia Taylor <${input.from}>`, `To: ${input.to}`, `Subject: =?UTF-8?B?${enc(input.subject)}?=`, ...thread,
    `MIME-Version: 1.0`, `Content-Type: text/plain; charset="UTF-8"`, `Content-Transfer-Encoding: base64`, ``, enc(input.text),
  ].join("\r\n");
}

/**
 * Send one email she approved. Called ONLY from `sendApprovedEmail` (./run.ts) after her Send.
 */
export async function sendOne(env: Env, input: { from: string; to: string; subject: string; text: string; command_id?: string; inReplyTo?: string | null; threadId?: string | null }): Promise<{ ok: true; messageId: string } | { ok: false; why: string }> {
  if (!mailboxAllowed(input.from)) return { ok: false, why: `${input.from} is not a mailbox Simone may send from` };
  const creds = serviceAccountFrom(env);
  if (!creds) return { ok: false, why: "the Google key is not on the Worker" };
  const tok = await mintComposeToken(creds, input.from, fetchImpl);
  if (!tok.ok) return { ok: false, why: `Google refused the sign-in (${tok.status})` };
  // The one door (mail/ownerDoor.ts): an email she asked Simone to send to HERSELF meets the required minimum.
  input = await throughOwnerDoor(env, input, { where: "an email Simone sends on her word", replyTo: input.from });
  const { inReplyTo, threadId, ...mail } = input;
  const receipt = await stageSentMail(env, { ...mail, in_reply_to: inReplyTo ?? null, employee_id: "emp_chief" });
  const res = await fetchImpl(GMAIL_SEND, {
    method: "POST", headers: { authorization: `Bearer ${tok.token}`, "content-type": "application/json" },
    body: JSON.stringify(threadId ? { raw: b64url(mime(input)), threadId } : { raw: b64url(mime(input)) }),
  });
  if (!res.ok) { await receipt.failed(); return { ok: false, why: `Gmail refused it (${res.status})` }; }
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  await receipt.accepted(String(j.id));
  return { ok: true, messageId: String(j.id ?? "") };
}

/*
 * ─── INVITATIONS (Simone's "Go?" card, 8 Nov 2026) ───────────────────────────────────────────
 * Three calendar hands, each used only from invitations/tap.ts after HER tap, and two reads the morning
 * duty uses. Same Workspace list, same delegation; spry.vc is never on the list, so never written.
 */

/** Events on a Workspace calendar still waiting for her answer (self attendee, needsAction). */
export async function awaitingReply(env: Env, mailbox: string, from: number, to: number):
  Promise<{ ok: true; events: Array<{ id: string; uid: string | null; title: string; start: number; end: number | null; allDay: boolean; where: string | null; organizer: { name: string | null; email: string } | null }> } | { ok: false; why: string }> {
  const cal = await calendarFor(env, mailbox);
  if (!cal.ok) return cal;
  const q = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100" });
  const res = await fetchImpl(`${CALENDAR}/primary/events?${q}`, { headers: { authorization: `Bearer ${cal.token}` } });
  if (!res.ok) return { ok: false, why: `the calendar could not be read (${res.status})` };
  const j = (await res.json().catch(() => ({}))) as { items?: Array<any> };
  const events = [];
  for (const e of j.items ?? []) {
    if (e.status === "cancelled") continue;
    const me = (e.attendees ?? []).find((a: any) => a.self);
    if (!me || me.responseStatus !== "needsAction" || me.organizer) continue;
    const allDay = !e.start?.dateTime;
    // An all-day event starts at her midnight (a fixed 06:00Z was 01:00 CDT in summer).
    const [ay, am, ad] = String(e.start?.date ?? "").split("-").map(Number) as [number, number, number];
    const start = allDay ? instantAt(CENTRAL, ay, am, ad) : Date.parse(e.start.dateTime);
    if (!Number.isFinite(start)) continue;
    const end = e.end?.dateTime ? Date.parse(e.end.dateTime) : null;
    events.push({
      id: String(e.id), uid: e.iCalUID ? String(e.iCalUID) : null, title: String(e.summary ?? "An event").slice(0, 140), start, end, allDay,
      where: e.location ? String(e.location).slice(0, 160) : null,
      organizer: e.organizer?.email ? { name: e.organizer.displayName ?? null, email: String(e.organizer.email).toLowerCase() } : null,
    });
  }
  return { ok: true, events };
}

/** Has she already answered the event with this UID on that calendar? status null = not on it. */
export async function selfAnswer(env: Env, mailbox: string, uid: string): Promise<{ ok: true; status: string | null; eventId: string | null } | { ok: false; why: string }> {
  const cal = await calendarFor(env, mailbox);
  if (!cal.ok) return cal;
  const res = await fetchImpl(`${CALENDAR}/primary/events?${new URLSearchParams({ iCalUID: uid, maxResults: "1" })}`, { headers: { authorization: `Bearer ${cal.token}` } });
  if (!res.ok) return { ok: false, why: `the calendar could not be read (${res.status})` };
  const e = (((await res.json().catch(() => ({}))) as { items?: any[] }).items ?? [])[0];
  if (!e) return { ok: true, status: null, eventId: null };
  const me = (e.attendees ?? []).find((a: any) => a.self);
  return { ok: true, status: me?.responseStatus ?? null, eventId: String(e.id) };
}

/** Her answer to a calendar invite: accepted or declined, sent to the organizer (sendUpdates=all). */
export async function answerInvite(env: Env, input: { mailbox: string; uid: string; response: "accepted" | "declined" }): Promise<{ ok: true } | { ok: false; why: string; notOnCalendar?: boolean }> {
  const cal = await calendarFor(env, input.mailbox);
  if (!cal.ok) return cal;
  const found = await fetchImpl(`${CALENDAR}/primary/events?${new URLSearchParams({ iCalUID: input.uid, maxResults: "1" })}`, { headers: { authorization: `Bearer ${cal.token}` } });
  if (!found.ok) return { ok: false, why: `the calendar could not be read (${found.status})` };
  const e = (((await found.json().catch(() => ({}))) as { items?: any[] }).items ?? [])[0];
  if (!e) return { ok: false, why: "the invite is not on that calendar", notOnCalendar: true };
  const attendees = (e.attendees ?? []).map((a: any) => (a.self ? { ...a, responseStatus: input.response } : a));
  const res = await fetchImpl(`${CALENDAR}/primary/events/${encodeURIComponent(e.id)}?sendUpdates=all`, {
    method: "PATCH", headers: { authorization: `Bearer ${cal.token}`, "content-type": "application/json" }, body: JSON.stringify({ attendees }),
  });
  return res.ok ? { ok: true } : { ok: false, why: `Google Calendar refused the answer (${res.status})` };
}

/** Put an event on her own calendar with no guests: nobody is emailed (sendUpdates=none). */
export async function putOnCalendar(env: Env, input: { mailbox: string; title: string; start: number; end: number | null; allDay: boolean; where: string | null; note: string; eventId?: string }):
  Promise<{ ok: true; eventId: string } | { ok: false; why: string }> {
  const cal = await calendarFor(env, input.mailbox);
  if (!cal.ok) return cal;
  const end = input.end && input.end > input.start ? input.end : input.start + 3_600_000;
  const body = input.allDay
    ? { summary: input.title, location: input.where ?? undefined, description: input.note, start: { date: dayOf(input.start) }, end: { date: dayOf(input.start + 86_400_000) } }
    : { summary: input.title, location: input.where ?? undefined, description: input.note, start: { dateTime: new Date(input.start).toISOString() }, end: { dateTime: new Date(end).toISOString() } };
  const url = `${CALENDAR}/primary/events`;
  const headers = { authorization: `Bearer ${cal.token}`, "content-type": "application/json" };
  let res = await fetchImpl(`${url}?sendUpdates=none`, {
    method: "POST", headers, body: JSON.stringify({ ...body, id: input.eventId }),
  });
  const duplicateId = res.status === 409 ? input.eventId : undefined;
  if (duplicateId) res = await fetchImpl(`${url}/${encodeURIComponent(duplicateId)}`, { headers });
  if (!res.ok) return { ok: false, why: `Google Calendar refused the event (${res.status})` };
  const event = (await res.json().catch(() => null)) as {
    id?: string; status?: string; summary?: string; attendees?: unknown[];
    start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
  } | null;
  if (typeof event?.id !== "string" || !event.id || (input.eventId && event.id !== input.eventId)) {
    return { ok: false, why: "Google Calendar did not confirm the event ID" };
  }
  if (duplicateId && (event.status === "cancelled" || event.attendees?.length || event.summary !== input.title ||
      (input.allDay
        ? event.start?.date !== body.start.date || event.end?.date !== body.end.date
        : Date.parse(event.start?.dateTime ?? "") !== input.start || Date.parse(event.end?.dateTime ?? "") !== end))) {
    return { ok: false, why: "The saved calendar event does not match the requested block" };
  }
  return { ok: true, eventId: event.id };
}
