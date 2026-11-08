/**
 * SIMONE'S INVITATIONS DUTY (owner-approved plan, 8 Nov 2026). `duty_invitations` (migration 0359)
 * runs here, on the Worker's existing hourly tick, when its clock says it is 06:00 in America/Chicago
 * (materialise.ts → `worker_job: "invitations"`). One pass:
 *
 *   1. READ, read-only. New mail since the last run in every inbox Boss OS already reads through the
 *      service account (West Peek, Time-2-Read, and Spry Ventures — read-only, never written), narrowed
 *      by a Gmail search, plus the invites still "awaiting reply" on her Workspace calendars. Headers,
 *      the .ics part and the first 800 characters only; nothing of the body is stored.
 *   2. SORT, with the pure rules (src/shared/boss/invitations/invitations.mjs). A personal email is read
 *      by a FREE model (subject + 800 characters); Spry Ventures mail and anything naming a committed LP
 *      reach only a route that does not train (private_model_only; the router's own LP scan raises the
 *      rest). No model answering → the prose rules decide; nothing is guessed.
 *   3. ONE ROW PER INVITATION (owner_invitations), deduped by calendar UID or sender + day + title.
 *   4. THE CARDS: the "invitations" morning section, so each card is in Simone's email and on Today.
 *
 * IT NEVER SENDS AND NEVER CLICKS. Nothing here calls Gmail send or writes a calendar; her tap does that
 * (tap.ts). An outside RSVP link is stored for her button and never fetched. Pinned by
 * tests/boss/invitations.test.ts.
 *
 * RULE 0: `OUTPUT n invitations` every run; an inbox it cannot read is NAMED STOP
 * [INVITES_MAILBOX_UNREAD] — a plain line in her email, the duty marked failed, one fix job a day.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { getSetting, setSetting } from "../lib/settings";
import { logEvent } from "../lib/log";
import { admitTask } from "../tasks/admit";
import { serviceAccountFrom, type ServiceAccount } from "../wealth/gmailDraft";
import { awaitingReply, selfAnswer, mailboxAllowed } from "../commands/google";
import { MORNING_SECTIONS, morningSectionProblems } from "../../../shared/boss/mail/morningSections.mjs";
import {
  INVITE_INBOXES, SECTION, FIRST_LOOKBACK_DAYS, EXCERPT_CHARS, MAX_PER_MAILBOX, mailQuery, parseIcs, readInvitation,
  dedupeKey, askPlan, cardFor, centralDay, outputLine, yesWords, noWords, platformOf, notInvitation,
} from "../../../shared/boss/invitations/invitations.mjs";

export const ORIGIN = "https://boss.sequoiataylor.com";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
/** Bounded reads: a message part past this is not decoded (a deck must never be read whole). */
const PART_BOUND = 200_000;
const MAX_MODEL_READS = 15;

// ─── The model seam (tests swap in a fake; production asks the router for a free route) ─────────

export type ModelReading = { invitation: boolean; title?: string | null; date?: string | null; time?: string | null; where?: string | null; asks_answer?: boolean } | null;
type Reader = (env: Env, input: { subject: string; excerpt: string; today: string; privateOnly: boolean }) => Promise<ModelReading>;

const routerReader: Reader = async (env, input) => {
  const { routeCompletion } = await import("../router");
  try {
    const r = await routeCompletion(env, {
      routeId: "rt_ops_default", lane: "ops", intakeKind: "drafting", risk: "low", employeeId: "emp_chief",
      sensitivity: input.privateOnly ? "restricted" : "private", freeOnly: true,
      modelAccess: input.privateOnly ? "private_model_only" : null,
      messages: [
        { role: "system", content: 'You decide whether an email personally invites the reader to an event (a dinner, party, gathering, coffee, celebration). Answer with JSON only: {"invitation": true|false, "title": "short event name", "date": "YYYY-MM-DD" or null, "time": "HH:MM" 24-hour Central or null, "where": "place" or null, "asks_answer": true|false}. A newsletter, a webinar sent to a list, a ticket receipt, a sales pitch or a meeting someone already set is false.' },
        { role: "user", content: `Today is ${input.today}.\nSubject: ${input.subject}\n\n${input.excerpt}` },
      ],
    } as any);
    const j = JSON.parse(/\{[\s\S]*\}/.exec(r.text)?.[0] ?? "null");
    return j && typeof j.invitation === "boolean" ? j : null;
  } catch { return null; }
};
let readerImpl: Reader = routerReader;
export function setInviteModel(f: Reader | null): void { readerImpl = f ?? routerReader; }

// ─── Gmail, read-only ────────────────────────────────────────────────────────────────────────

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
/** A gmail.readonly token for ONE named inbox from the list. No write scope exists in this file. */
async function readToken(creds: ServiceAccount, inbox: string, fetchImpl: typeof fetch): Promise<string> {
  if (!INVITE_INBOXES.some((b) => b.address === inbox)) throw new Error(`${inbox} is not an inbox Boss OS reads`);
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: creds.client_email, sub: inbox, scope: READ_SCOPE, aud: TOKEN_ENDPOINT, iat, exp: iat + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(creds.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(sig)}` }).toString(),
  });
  if (!res.ok) throw new Error(`Google refused the read sign-in (${res.status})`);
  const t = ((await res.json().catch(() => ({}))) as { access_token?: string }).access_token;
  if (!t) throw new Error("Google's sign-in answer carried no token");
  return t;
}

const fromB64url = (data: string): string => {
  try {
    const bin = atob(String(data).replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch { return ""; }
};
const stripHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const hrefs = (h: string) => [...h.matchAll(/href="(https:\/\/[^"]+)"/gi)].map((m) => m[1]!.replace(/&amp;/g, "&")).slice(0, 60);

interface Part { mimeType?: string; filename?: string; body?: { data?: string; size?: number; attachmentId?: string }; parts?: Part[] }
function walk(p: Part | undefined, out: Part[] = []): Part[] { if (!p) return out; out.push(p); for (const c of p.parts ?? []) walk(c, out); return out; }

/** One message read to the bone: headers, the .ics, the first 800 characters, the links. Nothing stored. */
async function readMessage(get: (path: string) => Promise<any>, inbox: string, id: string) {
  const m = await get(`/messages/${encodeURIComponent(id)}?format=full`);
  const h: Record<string, string> = {};
  for (const x of m.payload?.headers ?? []) h[String(x.name).toLowerCase()] = String(x.value ?? "");
  const fromRaw = h["from"] ?? "";
  const fromAddress = (/<([^>]+)>/.exec(fromRaw)?.[1] ?? fromRaw).trim().toLowerCase();
  const fromName = (/^\s*"?([^"<]+?)"?\s*</.exec(fromRaw)?.[1] ?? "").trim() || null;
  const parts = walk(m.payload);
  const body = async (p: Part): Promise<string> => {
    if ((p.body?.size ?? 0) > PART_BOUND) return "";
    if (p.body?.data) return fromB64url(p.body.data).slice(0, PART_BOUND);
    if (p.body?.attachmentId) { const a = await get(`/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(p.body.attachmentId)}`); return fromB64url(a.data ?? "").slice(0, PART_BOUND); }
    return "";
  };
  const calPart = parts.find((p) => /^text\/calendar|^application\/ics/i.test(p.mimeType ?? "") || /\.ics$/i.test(p.filename ?? ""));
  const ics = calPart ? parseIcs(await body(calPart)) : null;
  const plain = parts.find((p) => p.mimeType === "text/plain" && !p.filename);
  const html = parts.find((p) => p.mimeType === "text/html" && !p.filename);
  const htmlText = html ? await body(html) : "";
  const text = plain ? await body(plain) : stripHtml(htmlText);
  return {
    inbox, gmailId: id, threadId: m.threadId ?? null, rfcMessageId: h["message-id"] ?? null,
    fromName, fromAddress, subject: h["subject"] ?? "",
    excerpt: text.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS),
    links: hrefs(htmlText), ics,
    listUnsubscribe: h["list-unsubscribe"] ?? null, precedence: h["precedence"] ?? null, autoSubmitted: h["auto-submitted"] ?? null,
  };
}

// ─── The duty ───────────────────────────────────────────────────────────────────────────────

const tapToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return `iv${[...bytes].map((b) => abc[b % abc.length]).join("")}`.slice(0, 32);
};

async function upsert(env: Env, inv: any, now: number): Promise<boolean> {
  const key = dedupeKey({ uid: inv.uid, fromAddress: inv.fromAddress, start: inv.start, title: inv.title });
  const writable = mailboxAllowed(inv.inbox);
  const reply = inv.kind === "personal" && writable ? yesWords(inv) : null;
  const decline = inv.kind === "personal" && writable && inv.asksAnswer ? noWords(inv) : null;
  const r = await env.DB.prepare(
    `INSERT INTO owner_invitations (id, dedupe_key, kind, source, inbox, how, title, starts_at, ends_at, all_day, from_name, from_address, location, platform,
       rsvp_url, asks_answer, ics_uid, calendar_event_id, gmail_thread_id, rfc_message_id, subject, reply_text, decline_text, tap_token, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`,
  ).bind(
    newId("inv"), key, inv.kind, inv.source, inv.inbox, inv.how, inv.title, inv.start, inv.end ?? null, inv.allDay ? 1 : 0,
    inv.fromName ?? null, inv.fromAddress ?? null, inv.where ?? null, inv.platform ?? null, inv.rsvpUrl ?? null, inv.asksAnswer ? 1 : 0,
    inv.uid ?? null, inv.eventId ?? null, inv.threadId ?? null, inv.rfcMessageId ?? null, inv.subject ?? null, reply, decline, tapToken(), now, now,
  ).run();
  return (r.meta?.changes ?? 0) > 0;
}

export interface InvitationsRun { written: number; found: number; shown: number; read: Record<string, number>; unread: string[]; skipped: Record<string, number>; output: string }

export async function runInvitations(env: Env, now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<InvitationsRun> {
  if (!MORNING_SECTIONS.includes(SECTION)) throw new Error("NAMED STOP [INVITES_SECTION_UNREGISTERED] the invitations section is not in MORNING_SECTION_SPECS");
  const today = centralDay(now);
  const creds = serviceAccountFrom(env);
  const unread: string[] = [];
  const read: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  let found = 0;
  let modelReads = 0;

  // 1a. Her calendars: invites still waiting for her answer.
  for (const box of INVITE_INBOXES.filter((b) => b.writable)) {
    if (!creds) break;
    const r = await awaitingReply(env, box.address, now, now + 60 * 86_400_000);
    if (!r.ok) { unread.push(`${box.label.replace(/^your /, "")} calendar (${r.why})`); continue; }
    for (const e of r.events) {
      const inv = {
        kind: "calendar", source: "calendar", inbox: box.address, how: `on your calendar, waiting for your answer`,
        uid: e.uid, eventId: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, where: e.where,
        fromName: e.organizer?.name ?? null, fromAddress: e.organizer?.email ?? null, asksAnswer: true,
      };
      if (await upsert(env, inv, now)) found++;
    }
  }

  // 1b. Every inbox, new mail since the last run.
  for (const box of INVITE_INBOXES) {
    const key = `invitations_read_through:${box.address}`;
    const since = Number(await getSetting(env.DB, key)) || now - FIRST_LOOKBACK_DAYS * 86_400_000;
    try {
      if (!creds) throw new Error("the Google key is not on the Worker");
      const token = await readToken(creds, box.address, fetchImpl);
      const get = async (path: string) => {
        const res = await fetchImpl(`${GMAIL}${path}`, { headers: { authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Gmail answered ${res.status}`);
        return res.json() as Promise<any>;
      };
      const list = await get(`/messages?${new URLSearchParams({ q: mailQuery(since / 1000 - 3600), maxResults: String(MAX_PER_MAILBOX) })}`);
      const ids: string[] = (list.messages ?? []).map((m: any) => String(m.id));
      read[box.address] = ids.length;
      for (const id of ids) {
        const msg = await readMessage(get, box.address, id);
        let model = null;
        const personal = !msg.ics && !platformOf(msg.fromAddress) && !notInvitation(msg);
        if (personal && modelReads < MAX_MODEL_READS) {
          modelReads++;
          model = await readerImpl(env, { subject: msg.subject, excerpt: msg.excerpt, today, privateOnly: !box.writable });
        }
        const r = readInvitation(msg, { now, model });
        if (!r.invitation) { skip(r.why ?? "not an invitation"); continue; }
        // Already answered on her calendar (a mailed invite she accepted in Google Calendar) is not a card.
        if (r.invitation.kind === "calendar" && r.invitation.uid && box.writable) {
          const a = await selfAnswer(env, box.address, r.invitation.uid);
          if (a.ok && a.status && a.status !== "needsAction") { skip("already answered"); continue; }
          if (a.ok && a.eventId) r.invitation.eventId = a.eventId;
        }
        if (await upsert(env, r.invitation, now)) found++;
      }
      await setSetting(env.DB, key, String(now));
    } catch (err) {
      unread.push(`${box.label.replace(/^your /, "")} (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // 2. Today's cards: first asks, the one ask-again, the one Not-sure return; drops on the event day.
  const { results } = await env.DB.prepare(`SELECT * FROM owner_invitations WHERE status IN ('open','unsure') ORDER BY starts_at`).all<any>();
  const decide: any[] = [];
  for (const inv of results ?? []) {
    const plan = askPlan(inv, today);
    if (plan.drop) {
      await env.DB.prepare(`UPDATE owner_invitations SET status = 'dropped', reply_text = NULL, decline_text = NULL, rsvp_url = NULL, subject = NULL, updated_at = ? WHERE id = ? AND status IN ('open','unsure')`).bind(now, inv.id).run();
      continue;
    }
    if (!plan.show) continue;
    decide.push(cardFor(inv, { origin: ORIGIN, ask: plan.ask!, today }));
    if (inv.last_asked_day !== today) {
      await env.DB.prepare(
        plan.ask === "unsure"
          ? `UPDATE owner_invitations SET unsure_asks = unsure_asks + 1, last_asked_day = ?, updated_at = ? WHERE id = ?`
          : `UPDATE owner_invitations SET asks = asks + 1, last_asked_day = ?, updated_at = ? WHERE id = ?`,
      ).bind(today, now, inv.id).run();
    }
  }

  // 3. The section, always written (an empty one says the duty ran), with any unread inbox in plain words.
  const lines = unread.length
    ? [`⚠ Simone could not read ${unread.length === 1 ? "one place" : `${unread.length} places`} for invitations this morning (${unread.map((u) => u.replace(/\s*\(.*\)$/, "")).join(", ")}), so an invitation there may be missing. The team is fixing it.`]
    : [];
  const obj = { section: SECTION, at: new Date(now).toISOString(), title: "Invitations", decide, rows: [], lines };
  const problems = morningSectionProblems(obj);
  if (problems.length) throw new Error(`NAMED STOP [INVITES_SECTION_REFUSED] ${problems.join("; ")}`);
  await env.DB.prepare(
    `INSERT INTO morning_sections (section, job, day, body, status, told_at, created_at, updated_at) VALUES (?,?,?,?,'fresh',NULL,?,?)
     ON CONFLICT(section) DO UPDATE SET job = excluded.job, day = excluded.day, body = excluded.body, status = 'fresh', told_at = NULL, updated_at = excluded.updated_at`,
  ).bind(SECTION, "duty_invitations", today, JSON.stringify(obj), now, now).run();

  const output = outputLine(decide.length);
  console.log(`invitations: ${output} (new ${found}; read ${JSON.stringify(read)}; skipped ${JSON.stringify(skipped)})`);
  if (unread.length) {
    // One fix job a day, never one per inbox; the duty is then marked failed with the stop's name.
    const flag = `invitations_fix_job:${today}`;
    if (!(await getSetting(env.DB, flag))) {
      await setSetting(env.DB, flag, "1");
      await admitTask(env, {
        title: `Invitations: an inbox could not be read (${today})`, lane: "ops", employee_id: "emp_repo",
        input: { origin: "repair", repair_kind: "invitations_mailbox_unread", prompt: `Simone's invitations duty (duty_invitations, src/worker/boss/invitations/run.ts) could not read: ${unread.join("; ")}. Find why at source (the service account's gmail.readonly or calendar.events delegation for that mailbox, or the key on the Worker) and fix it, then run the duty again from Team → Duties.` },
      } as any).catch((e) => console.error("invitations: the fix job was not admitted", e));
    }
    await logEvent(env.DB, { level: "error", scope: "duties", event: "invitations_mailbox_unread", detail: { unread } }).catch(() => {});
    throw new Error(`NAMED STOP [INVITES_MAILBOX_UNREAD] ${unread.join("; ")} — ${output}`);
  }
  return { written: decide.length, found, shown: decide.length, read, unread, skipped, output };
}
