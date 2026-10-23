/**
 * THE POSITIVE REPLIES SHE HAS NOT ANSWERED — a reply held in each LP's own thread, every morning
 * (owner, 22 Oct 2026; made daily and one-tap by Boss fix L, 23 Oct 2026, ruling 10).
 *
 * Monique's morning run (`lp-daily.mjs`, duty_lp_daily) calls this after the running list is
 * reconciled. The weekly Tuesday reminder email is gone: each held reply is a Decide item in the
 * morning email with Send as is / Edit, then send / Skip. For every positive reply on the list it asks three questions of the
 * mailbox, headers and searches only:
 *
 *   answered?  a message FROM the mailbox TO that address after the reply arrived (her sent mail)
 *   passed?    she put the Gmail label "pass" (or "lp-pass") on any message from that address
 *   thread?    the newest message from that address: its thread, Message-ID and Subject, so the
 *              draft sits in the same conversation
 *
 * Gmail's API does not expose scheduled mail (no SCHEDULED label, `in:scheduled` returns nothing;
 * probed 23 Oct 2026), so a reply she scheduled by hand reads as unanswered until it goes out; the
 * tracker's "Scheduled" status is set only by something that can see it.
 *
 * Each unanswered, unpassed reply gets ONE draft in the mailbox's Drafts, offering 2–3 open times
 * from her calendar (free/busy only). The draft is refreshed with new times only when the old ones
 * have passed AND she has not edited it; a draft she deleted is made again next Tuesday, because the
 * reply is still unanswered — the way to stop it is to answer or label it "pass".
 *
 * ─── IT NEVER SENDS ────────────────────────────────────────────────────────
 * The scope is gmail.compose because drafts need it; no send endpoint is called anywhere in this
 * file, and `validate:gmail` (DRAFT_WRITERS) fails the build if one appears. Sending happens only
 * when she taps "Send as is" (src/worker/boss/routes/lpTap.ts), which sends this very draft.
 *
 * ─── NO MODEL SEES A NAME ──────────────────────────────────────────────────
 * LP names and deal terms are confidential. The draft is a FIXED TEMPLATE filled in code — first
 * name, times — and no model route is called, free or paid (CONFIRMED 22 Oct 2026: lp-positive.mjs
 * and this file contain no model host and spawn no CLI). Fail closed: if a template field cannot be
 * filled, the draft is written without it rather than handed to anything that writes prose.
 *
 * Names and addresses stay on her Mac (`~/.boss-os/lp/followups.json`) and in mail to her own inbox.
 * The console prints counts only.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { lpReplyBody } from "../../src/shared/boss/lp/plan.mjs";

const MAILBOX = process.env.LP_MAILBOX ?? "sequoia@westpeek.ventures";
const OUT_DIR = process.env.BOSS_OS_LP_DIR ?? path.join(os.homedir(), ".boss-os", "lp");
const STATE = path.join(OUT_DIR, "followups.json");
const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const DRAFT_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const TZ = "America/Chicago";
const DAY = 86_400_000;
export const PASS_LABELS = Object.freeze(["pass", "lp-pass"]);

// ─── Pure pieces (tested) ───────────────────────────────────────────────────

/** Whole days between a YYYY-MM-DD and now. */
export function daysWaiting(firstSeen, now = Date.now()) {
  const t = Date.parse(`${firstSeen}T12:00:00Z`);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null;
}

/** First name for the greeting, or "there". Never more than one word of a name. */
export function firstName(name) {
  const w = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'’-]{0,30}$/.test(w) ? w : "there";
}

/** Chicago wall-clock parts for an instant. */
function chicago(t) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, ymd: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

/** The instant of a Chicago wall-clock time on a Chicago date (DST-safe by search). */
export function chicagoInstant(ymd, hour, minute) {
  const guess = Date.parse(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  for (const off of [5, 6]) {
    const t = guess + off * 3600_000;
    const c = chicago(t);
    if (c.ymd === ymd && c.hour === hour && c.minute === minute) return t;
  }
  return guess + 6 * 3600_000;
}

/**
 * Up to three open 30-minute slots, each on a different weekday, starting two working days out,
 * at 10:00, 11:30 or 14:00 Chicago. `busy` is [[start, end]] in ms. Pure.
 */
export function pickSlots(busy, now = Date.now(), want = 3) {
  const out = [];
  const usedDays = new Set();
  let workdays = 0;
  for (let d = 1; d <= 21 && out.length < want; d += 1) {
    const day = chicago(now + d * DAY);
    if (day.weekday === "Sat" || day.weekday === "Sun") continue;
    workdays += 1;
    if (workdays < 2) continue;
    for (const [h, m] of [[10, 0], [11, 30], [14, 0]]) {
      if (usedDays.has(day.ymd)) break;
      const s = chicagoInstant(day.ymd, h, m);
      const e = s + 30 * 60_000;
      if ((busy ?? []).some(([bs, be]) => bs < e && be > s)) continue;
      out.push(s);
      usedDays.add(day.ymd);
    }
  }
  return out;
}

export function slotLine(t) {
  return new Date(t).toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) + " Central";
}

/**
 * The draft body. A FIXED TEMPLATE — no model writes any part of it. Her outreach voice (ruling 10:
 * "we", "more than $100M in secondary transactions", never a fund size, a short call ask), with up
 * to three open times from her calendar when it can be read.
 */
export function draftBody({ name, bucket, slots }) {
  const base = lpReplyBody({ name, bucket }).split("\n");
  const sign = base.slice(-2);
  const times = slots.length
    ? ["", "Any of these would work on our side:", ...slots.map((t) => `- ${slotLine(t)}`)]
    : [];
  return [...base.slice(0, -3), ...times, "", ...sign].join("\n");
}

export const hashOf = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 16);

/** Oldest first, with days waiting. Pure. */
export function unansweredOrder(rows, now = Date.now()) {
  return [...rows].map((r) => ({ ...r, days: daysWaiting(r.first_seen, now) })).sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
}

// ─── Google ────────────────────────────────────────────────────────────────

const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function token(creds, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: creds.client_email, sub: MAILBOX, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(signer.sign(creds.private_key))}` }),
  });
  if (!res.ok) throw new Error(`token (${scope.split("/").pop()}) refused ${res.status}`);
  return (await res.json()).access_token;
}

const call = async (tok, url, init = {}) => {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${tok}`, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
  if (r.status === 404) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j?.error?.message ?? j).slice(0, 120)}`);
  return j;
};

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

async function search(tok, q, max = 1) {
  const j = await call(tok, `${GMAIL}/messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
  return j?.messages ?? [];
}

const gdate = (ymd) => String(ymd).replace(/-/g, "/");

/** The newest message from the address: thread, Message-ID, Subject (headers only). */
async function threadOf(tok, address) {
  const [m] = await search(tok, `from:${address} to:${MAILBOX}`, 1);
  if (!m) return null;
  const u = new URL(`${GMAIL}/messages/${m.id}`);
  u.searchParams.set("format", "metadata");
  for (const h of ["Message-ID", "Subject"]) u.searchParams.append("metadataHeaders", h);
  const msg = await call(tok, u.toString());
  const h = Object.fromEntries((msg?.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]));
  return { threadId: m.threadId, messageId: h["message-id"] ?? null, subject: h.subject ?? "", at: Number(msg?.internalDate ?? 0) || null };
}

function rawDraft({ to, subject, inReplyTo, body }) {
  const subj = /^re:/i.test(subject) ? subject : `Re: ${subject || "our conversation"}`;
  const lines = [
    `To: ${to}`,
    `Subject: ${subj}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ];
  return b64url(lines.join("\r\n"));
}

async function freeBusy(tok, now) {
  const j = await call(tok, "https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: new Date(now).toISOString(), timeMax: new Date(now + 21 * DAY).toISOString(), timeZone: TZ, items: [{ id: MAILBOX }] }),
  });
  const cal = j?.calendars?.[MAILBOX];
  if (!cal || cal.errors?.length) throw new Error("calendar free/busy not readable");
  return (cal.busy ?? []).map((b) => [Date.parse(b.start), Date.parse(b.end)]);
}

/**
 * One pass over the running list. For each positive reply: sent (by her, after their reply) → Sent,
 * or "They replied again" when they wrote after her answer; labelled pass, or skipped in Boss OS →
 * Skipped; otherwise ONE held draft in their thread → Drafted. Returns the tracker rows Boss OS
 * keeps (names stay in D1 and on her Mac; the console prints counts only).
 */
export async function followUps(people, { now = Date.now(), skipped = new Set() } = {}) {
  const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null");
  if (!creds) throw new Error("NAMED STOP [NO_SERVICE_ACCOUNT] GSC_SERVICE_ACCOUNT_JSON is not in the vault run");
  const read = await token(creds, READ_SCOPE);
  const stops = [];
  let draftTok = null;
  try { draftTok = await token(creds, DRAFT_SCOPE); } catch (e) { stops.push(`Replies cannot be held as drafts (${e.message}); the tracker still lists every unanswered reply.`); }
  let busy = null;
  try { busy = await freeBusy(await token(creds, CAL_SCOPE), now); } catch (e) { stops.push(`Your calendar could not be read for open times (${e.message}); replies ask for their times instead.`); }
  const slots = busy ? pickSlots(busy, now) : [];
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { drafts: {} };
  state.drafts = state.drafts ?? {};
  const rows = [];
  const counts = { sent: 0, replied_again: 0, skipped: 0, drafted: 0, not_answered: 0, made: 0, refreshed: 0, kept: 0 };
  for (const p of people) {
    const after = gdate(p.first_seen);
    const th = await threadOf(read, p.address);
    const base = {
      address: p.address, name: p.name ?? "", bucket: p.bucket, quote: p.quote ?? null, first_seen: p.first_seen,
      reply_from: MAILBOX, thread_id: th?.threadId ?? null, in_reply_to: th?.messageId ?? null, subject: th?.subject ?? null,
      last_reply_at: th?.at ?? null,
    };
    const [mine] = await search(read, `in:sent from:${MAILBOX} to:${p.address} after:${after}`);
    if (mine) {
      const meta = await call(read, `${GMAIL}/messages/${mine.id}?format=metadata&metadataHeaders=Date`);
      const sentAt = Number(meta?.internalDate ?? 0) || null;
      const status = th?.at && sentAt && th.at > sentAt ? "replied_again" : "sent";
      counts[status] += 1;
      delete state.drafts[p.address];
      rows.push({ ...base, status, sent_at: sentAt });
      continue;
    }
    const passed = (await search(read, `from:${p.address} (${PASS_LABELS.map((l) => `label:${l}`).join(" OR ")})`)).length > 0;
    if (passed || skipped.has(p.address)) {
      counts.skipped += 1;
      delete state.drafts[p.address];
      rows.push({ ...base, status: "skipped" });
      continue;
    }
    let held = null;
    if (draftTok) {
      const had = state.drafts[p.address];
      const existing = had ? await call(draftTok, `${GMAIL}/drafts/${had.id}?format=metadata`).catch(() => null) : null;
      const stale = had && (had.slots ?? []).length && had.slots.every((t) => t < now + DAY);
      const unedited = existing && existing.message?.id === had?.message_id;
      if (existing && !(stale && unedited)) { counts.kept += 1; held = { id: had.id, message_id: existing.message?.id ?? had.message_id, hash: had.hash }; }
      else {
        const body = draftBody({ name: p.name, bucket: p.bucket, slots });
        const message = { raw: rawDraft({ to: p.address, subject: th?.subject ?? "", inReplyTo: th?.messageId, body }), ...(th?.threadId ? { threadId: th.threadId } : {}) };
        const res = existing
          ? await call(draftTok, `${GMAIL}/drafts/${had.id}`, { method: "PUT", body: JSON.stringify({ id: had.id, message }) })
          : await call(draftTok, `${GMAIL}/drafts`, { method: "POST", body: JSON.stringify({ message }) });
        if (res?.id) {
          state.drafts[p.address] = { id: res.id, message_id: res.message?.id ?? null, slots, hash: hashOf(body), at: new Date(now).toISOString() };
          if (existing) counts.refreshed += 1; else counts.made += 1;
          held = { id: res.id, message_id: res.message?.id ?? null, hash: hashOf(body) };
        }
      }
    }
    const status = held ? "drafted" : "not_answered";
    counts[status] += 1;
    rows.push({ ...base, status, draft_id: held?.id ?? null, draft_message_id: held?.message_id ?? null, body_hash: held?.hash ?? null });
  }
  state.updated_at = new Date(now).toISOString();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2), "utf8");
  console.log(`LP replies: ${counts.drafted} held, ${counts.sent} sent, ${counts.replied_again} replied again, ${counts.skipped} skipped, ${counts.not_answered} without a draft; drafts ${counts.made} new, ${counts.refreshed} refreshed, ${counts.kept} kept; ${stops.length} stop(s).`);
  return { rows, stops, counts, unanswered: unansweredOrder(rows.filter((r) => ["drafted", "not_answered"].includes(r.status)).map((r) => ({ ...r, draft: r.status === "drafted" ? "waiting" : "none" })), now) };
}
