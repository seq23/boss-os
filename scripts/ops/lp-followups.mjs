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
 * from her calendars (free/busy only, BOTH Workspace calendars merged, in the zone she is in that day,
 * inside her working hours: lp-calendar.mjs + src/shared/boss/lp/schedule.mjs).
 *
 * ─── SCHEDULING, ONE TAP (owner, 31 Oct 2026) ──────────────────────────────
 * Someone who wrote back after her reply gets a reply held for their new message. When their words
 * are warm about meeting ("happy to chat, when works?", `wantsToMeet`), that reply offers 2–3 open
 * times; when they pick one of the times she offered (`pickedSlot`), still free, it is a short
 * confirmation, and the SAME tap that sends it sends the calendar invite (Worker, lp/schedule.ts). The draft is refreshed with new times only when the old ones
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
import { lpReplyBody, lpAgainBody } from "../../src/shared/boss/lp/plan.mjs";
import {
  instantIn, openSlots, slotText, slotsFrom, zoneResolver, wantsToMeet, pickedSlot, proposedFit, lpTimesBody, lpConfirmBody, SLOT_MINUTES,
} from "../../src/shared/boss/lp/schedule.mjs";
import { herBusyAndZone } from "./lp-calendar.mjs";

const MAILBOX = process.env.LP_MAILBOX ?? "sequoia@westpeek.ventures";
const OUT_DIR = process.env.BOSS_OS_LP_DIR ?? path.join(os.homedir(), ".boss-os", "lp");
const STATE = path.join(OUT_DIR, "followups.json");
const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const DRAFT_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
// The zone a test or a caller with no "where she is" falls back to; her real zone comes from her
// calendar setting and the "where I am until" setting (zoneResolver), never from this line.
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

/** The instant of a Chicago wall-clock time on a Chicago date (DST-safe by search). */
export function chicagoInstant(ymd, hour, minute) {
  return instantIn(TZ, ymd, hour, minute) ?? Date.parse(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
}

/**
 * Up to three open slots in one zone (ms), each on a different weekday, from two working days out,
 * inside her working hours. The run itself uses `openSlots` with her zone per day; this is that
 * rule with the zone fixed, kept for callers that pass a bare busy list.
 */
export function pickSlots(busy, now = Date.now(), want = 3, zone = TZ) {
  return openSlots(busy, { now, zoneOn: () => zone, want }).map((x) => x.start);
}

/** A slot as the reply says it: "Thursday, October 29 at 2:00 PM Central". Bare ms are Central. */
export function slotLine(t) {
  return slotText(typeof t === "number" ? { start: t, zone: TZ } : t);
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
/** A held draft's words as they stand in Gmail, and their newest message's words (lp-positive.mjs reads content). */
async function draftWords(messageId) {
  if (!messageId) return null;
  try { const { messageWords } = await import("./lp-positive.mjs"); return (await messageWords(messageId, { quoted: true }))?.text ?? null; } catch { return null; }
}
async function latestWords(messageId) {
  try { const { messageWords } = await import("./lp-positive.mjs"); return (await messageWords(messageId))?.text?.slice(0, 600) ?? null; } catch { return null; }
}

async function threadOf(tok, address) {
  const [m] = await search(tok, `from:${address} to:${MAILBOX}`, 1);
  if (!m) return null;
  const u = new URL(`${GMAIL}/messages/${m.id}`);
  u.searchParams.set("format", "metadata");
  for (const h of ["Message-ID", "Subject"]) u.searchParams.append("metadataHeaders", h);
  const msg = await call(tok, u.toString());
  const h = Object.fromEntries((msg?.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]));
  return { id: m.id, threadId: m.threadId, messageId: h["message-id"] ?? null, subject: h.subject ?? "", at: Number(msg?.internalDate ?? 0) || null };
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

/**
 * One pass over the running list. For each positive reply: sent (by her, after their reply) → Sent,
 * or "They replied again" when they wrote after her answer; labelled pass, or skipped in Boss OS →
 * Skipped; otherwise ONE held draft in their thread → Drafted. Returns the tracker rows Boss OS
 * keeps (names stay in D1 and on her Mac; the console prints counts only).
 */
/**
 * The reply held for someone who wrote back after hers. Kept while it answers their newest message
 * (shown as it stands in Gmail now, so an edit there is what her email shows); replaced with a fresh
 * one the moment they write again. Returns null when no draft could be held.
 */
/**
 * What the reply to their new message says. Pure. A pick of one of her offered times that is still
 * free and still ahead → a confirmation (the tap also sends the invite); warm words about meeting →
 * 2–3 open times; anything else → the plain "when suits you" reply.
 */
export function againReply({ name, said, offered = [], slots = [], busy = null, now = Date.now(), zoneOn = null }) {
  const pick = busy ? pickedSlot(said, offered) : null;
  const stillFree = pick && pick.start > now + 3 * 3600_000
    && !busy.some(([bs, be]) => bs < pick.start + SLOT_MINUTES * 60_000 && be > pick.start);
  if (stillFree) return { kind: "confirm", body: lpConfirmBody({ name, slot: pick }), picked: pick, offered };
  // THEY proposed times ("my availability (PT): 11/3 – 10 am …"): the earliest that is free on both
  // her calendars and inside her working hours in her zone that day is confirmed; the tap sends the invite.
  const theirs = proposedFit(said, { busy, zoneOn, now });
  if (theirs) return { kind: "confirm", body: lpConfirmBody({ name, slot: theirs }), picked: { start: theirs.start, zone: theirs.zone }, offered };
  if (wantsToMeet(said) && slots.length) return { kind: "times", body: lpTimesBody({ name, slots }), picked: null, offered: slots };
  return { kind: "plain", body: lpAgainBody({ name }), picked: null, offered };
}

async function againDraft(draftTok, state, p, th, now, plan) {
  state.again = state.again ?? {};
  const had = state.again[p.address];
  const existing = had ? await call(draftTok, `${GMAIL}/drafts/${had.id}?format=metadata`).catch(() => null) : null;
  const unedited = existing && existing.message?.id === had?.message_id;
  // Times offered that have all passed, in a draft she has not touched, are offered afresh.
  const stale = had?.kind === "times" && unedited && slotsFrom(had.offered).every((x) => x.start < now + 86_400_000);
  if (existing && had.for_at === (th?.at ?? null) && !stale) {
    const mid = existing.message?.id ?? had.message_id;
    return { id: had.id, message_id: mid, hash: had.hash, body: await draftWords(mid), kind: had.kind ?? "plain", picked: had.picked ?? null, offered: slotsFrom(had.offered) };
  }
  const body = plan.body;
  const message = { raw: rawDraft({ to: p.address, subject: th?.subject ?? "", inReplyTo: th?.messageId, body }), ...(th?.threadId ? { threadId: th.threadId } : {}) };
  const res = existing
    ? await call(draftTok, `${GMAIL}/drafts/${had.id}`, { method: "PUT", body: JSON.stringify({ id: had.id, message }) }).catch(() => null)
    : await call(draftTok, `${GMAIL}/drafts`, { method: "POST", body: JSON.stringify({ message }) }).catch(() => null);
  if (!res?.id) return null;
  state.again[p.address] = { id: res.id, message_id: res.message?.id ?? null, for_at: th?.at ?? null, hash: hashOf(body), at: new Date(now).toISOString(), kind: plan.kind, picked: plan.picked, offered: plan.offered };
  if (plan.kind === "times") state.offered = { ...(state.offered ?? {}), [p.address]: plan.offered };
  return { id: res.id, message_id: res.message?.id ?? null, hash: hashOf(body), body, kind: plan.kind, picked: plan.picked, offered: plan.offered };
}

/**
 * `where` is Boss OS's "where I am until" (`away_city`, `away_until`); `offered` maps an address to
 * the times her last reply offered (D1's `offered_slots`), for a Mac whose state file is fresh.
 */
export async function followUps(people, { now = Date.now(), skipped = new Set(), where = null, offered = {} } = {}) {
  const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null");
  if (!creds) throw new Error("NAMED STOP [NO_SERVICE_ACCOUNT] GSC_SERVICE_ACCOUNT_JSON is not in the vault run");
  const read = await token(creds, READ_SCOPE);
  const stops = [];
  let draftTok = null;
  try { draftTok = await token(creds, DRAFT_SCOPE); } catch (e) { stops.push(`Replies cannot be held as drafts (${e.message}); the tracker still lists every unanswered reply.`); }
  // Both calendars or none (fail closed), in the zone she is in on each day, inside her working hours.
  const cal = await herBusyAndZone(creds, { now }).catch((e) => ({ busy: null, homeZone: null, why: String(e?.message ?? e) }));
  const busy = cal.busy;
  if (!busy) stops.push(`Your calendars could not both be read for open times (${cal.why}); replies ask for their times instead.`);
  const zoneOn = zoneResolver({ awayCity: where?.away_city ?? null, awayUntil: where?.away_until ?? null, homeZone: cal.homeZone ?? null });
  const slots = busy ? openSlots(busy, { now, zoneOn }) : [];
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { drafts: {} };
  state.drafts = state.drafts ?? {};
  state.offered = state.offered ?? {};
  const rows = [];
  const counts = { sent: 0, replied_again: 0, scheduled: 0, skipped: 0, drafted: 0, not_answered: 0, made: 0, refreshed: 0, kept: 0 };
  for (const p of people) {
    const after = gdate(p.first_seen);
    const th = await threadOf(read, p.address);
    const base = {
      address: p.address, name: p.name ?? "", bucket: p.bucket, quote: p.quote ?? null, said: p.said ?? null, first_seen: p.first_seen,
      reply_from: MAILBOX, thread_id: th?.threadId ?? null, in_reply_to: th?.messageId ?? null, subject: th?.subject ?? null,
      last_reply_at: th?.at ?? null,
    };
    const [mine] = await search(read, `in:sent from:${MAILBOX} to:${p.address} after:${after}`);
    if (mine) {
      const meta = await call(read, `${GMAIL}/messages/${mine.id}?format=metadata&metadataHeaders=Date`);
      const sentAt = Number(meta?.internalDate ?? 0) || null;
      let status = th?.at && sentAt && th.at > sentAt ? "replied_again" : "sent";
      // A reply she has already SCHEDULED in Gmail is handled: it leaves "Still waiting on you" (Today v4).
      if (status === "replied_again" && (await search(read, `in:scheduled to:${p.address}`).catch(() => [])).length) status = "scheduled";
      counts[status] = (counts[status] ?? 0) + 1;
      delete state.drafts[p.address];
      // What they said after her reply, in their own words: the morning email's one line for it.
      const lastReplyText = status === "replied_again" && th?.id ? await latestWords(th.id) : null;
      // EVERY WAITING REPLY HAS A READY DRAFT (Today v4): one held in their thread for their new message,
      // redrafted when they write again. A fixed template; nothing is sent here.
      const plan = status === "replied_again"
        ? againReply({ name: p.name, said: lastReplyText, offered: slotsFrom(state.offered[p.address] ?? offered[p.address]), slots, busy, now, zoneOn })
        : null;
      const again = plan && draftTok ? await againDraft(draftTok, state, p, th, now, plan) : null;
      if (status !== "replied_again") delete state.again?.[p.address];
      rows.push({ ...base, status, sent_at: sentAt, last_reply_text: lastReplyText,
        ...(again ? { draft_id: again.id, draft_message_id: again.message_id, body_hash: again.hash, draft_body: again.body } : {}),
        offered_slots: (again?.offered ?? []).length ? JSON.stringify(again.offered) : (state.offered[p.address] ? JSON.stringify(state.offered[p.address]) : null),
        picked_start: again?.picked?.start ?? null, picked_zone: again?.picked?.zone ?? null });
      if (again) counts[`again_${again.kind}`] = (counts[`again_${again.kind}`] ?? 0) + 1;
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
      const stale = had && (had.slots ?? []).length && had.slots.every((t) => (t?.start ?? t) < now + DAY);
      const unedited = existing && existing.message?.id === had?.message_id;
      // A kept draft is shown as it stands in Gmail NOW, word for word, pinned to its message id: the
      // tap sends it only if that id has not changed since the email showed it (owner, 24 Oct 2026).
      if (existing && !(stale && unedited)) { counts.kept += 1; held = { id: had.id, message_id: existing.message?.id ?? had.message_id, hash: had.hash, body: await draftWords(existing.message?.id ?? had.message_id) }; }
      else {
        const body = draftBody({ name: p.name, bucket: p.bucket, slots });
        const message = { raw: rawDraft({ to: p.address, subject: th?.subject ?? "", inReplyTo: th?.messageId, body }), ...(th?.threadId ? { threadId: th.threadId } : {}) };
        const res = existing
          ? await call(draftTok, `${GMAIL}/drafts/${had.id}`, { method: "PUT", body: JSON.stringify({ id: had.id, message }) })
          : await call(draftTok, `${GMAIL}/drafts`, { method: "POST", body: JSON.stringify({ message }) });
        if (res?.id) {
          state.drafts[p.address] = { id: res.id, message_id: res.message?.id ?? null, slots, hash: hashOf(body), body, at: new Date(now).toISOString() };
          if (slots.length) state.offered[p.address] = slots;
          if (existing) counts.refreshed += 1; else counts.made += 1;
          held = { id: res.id, message_id: res.message?.id ?? null, hash: hashOf(body), body };
        }
      }
    }
    const status = held ? "drafted" : "not_answered";
    counts[status] += 1;
    const offeredHere = state.offered[p.address];
    rows.push({ ...base, status, draft_id: held?.id ?? null, draft_message_id: held?.message_id ?? null, body_hash: held?.hash ?? null, draft_body: held?.body ?? null,
      offered_slots: offeredHere ? JSON.stringify(offeredHere) : null, picked_start: null, picked_zone: null });
  }
  state.updated_at = new Date(now).toISOString();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2), "utf8");
  console.log(`LP replies: ${counts.drafted} held, ${counts.sent} sent, ${counts.replied_again} replied again, ${counts.skipped} skipped, ${counts.not_answered} without a draft; drafts ${counts.made} new, ${counts.refreshed} refreshed, ${counts.kept} kept; wrote-again replies ${counts.again_times ?? 0} offering times, ${counts.again_confirm ?? 0} confirming a time; ${slots.length} open time(s); ${stops.length} stop(s).`);
  return { rows, stops, counts, unanswered: unansweredOrder(rows.filter((r) => ["drafted", "not_answered"].includes(r.status)).map((r) => ({ ...r, draft: r.status === "drafted" ? "waiting" : "none" })), now) };
}
