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
import type { Env } from "../env";
import { serviceAccountFrom, mintComposeToken, type ServiceAccount } from "../wealth/gmailDraft";
import { WORKSPACE_MAILBOXES } from "../../../shared/boss/commands/parse.mjs";

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

/** What is already on the calendar inside [start, end). Declined, free and cancelled events do not clash. */
export async function clashes(env: Env, mailbox: string, start: number, end: number): Promise<{ ok: true; busy: Busy[] } | { ok: false; why: string }> {
  const cal = await calendarFor(env, mailbox);
  if (!cal.ok) return cal;
  const q = new URLSearchParams({ timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "20" });
  const res = await fetchImpl(`${CALENDAR}/primary/events?${q}`, { headers: { authorization: `Bearer ${cal.token}` } });
  if (!res.ok) return { ok: false, why: `the calendar could not be read (${res.status})` };
  const j = (await res.json().catch(() => ({}))) as { items?: Array<any> };
  const busy: Busy[] = [];
  for (const e of j.items ?? []) {
    if (e.status === "cancelled" || e.transparency === "transparent" || !e.start?.dateTime) continue;
    const me = (e.attendees ?? []).find((a: any) => a.self);
    if (me?.responseStatus === "declined") continue;
    const s = Date.parse(e.start.dateTime); const f = Date.parse(e.end?.dateTime ?? e.start.dateTime);
    if (s < end && f > start) busy.push({ title: String(e.summary ?? "(busy)").slice(0, 120), start: s, end: f });
  }
  return { ok: true, busy };
}

/** Create the event with a Meet link and invite the guests. `sendUpdates=all` is what emails them. */
export async function createInvite(env: Env, input: { mailbox: string; title: string; start: number; minutes: number; guests: string[]; requestId: string; description?: string }):
  Promise<{ ok: true; eventId: string; meet: string | null; htmlLink: string | null } | { ok: false; why: string }> {
  const cal = await calendarFor(env, input.mailbox);
  if (!cal.ok) return cal;
  const body = {
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
  const meet = e.hangoutLink ?? (e.conferenceData?.entryPoints ?? []).find((p: any) => p.entryPointType === "video")?.uri ?? null;
  return { ok: true, eventId: String(e.id), meet, htmlLink: e.htmlLink ?? null };
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

function mime(input: { from: string; to: string; subject: string; text: string }): string {
  const enc = (s: string) => btoa(unescape(encodeURIComponent(s)));
  return [
    `From: Sequoia Taylor <${input.from}>`, `To: ${input.to}`, `Subject: =?UTF-8?B?${enc(input.subject)}?=`,
    `MIME-Version: 1.0`, `Content-Type: text/plain; charset="UTF-8"`, `Content-Transfer-Encoding: base64`, ``, enc(input.text),
  ].join("\r\n");
}

/**
 * Send one email she approved. Called ONLY from `sendApprovedEmail` (./run.ts) after her Send.
 */
export async function sendOne(env: Env, input: { from: string; to: string; subject: string; text: string }): Promise<{ ok: true; messageId: string } | { ok: false; why: string }> {
  if (!mailboxAllowed(input.from)) return { ok: false, why: `${input.from} is not a mailbox Simone may send from` };
  const creds = serviceAccountFrom(env);
  if (!creds) return { ok: false, why: "the Google key is not on the Worker" };
  const tok = await mintComposeToken(creds, input.from, fetchImpl);
  if (!tok.ok) return { ok: false, why: `Google refused the sign-in (${tok.status})` };
  const res = await fetchImpl(GMAIL_SEND, {
    method: "POST", headers: { authorization: `Bearer ${tok.token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: b64url(mime(input)) }),
  });
  if (!res.ok) return { ok: false, why: `Gmail refused it (${res.status})` };
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, messageId: String(j.id ?? "") };
}
