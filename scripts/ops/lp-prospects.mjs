#!/usr/bin/env node
/**
 * MONIQUE'S PROSPECT SEQUENCE (owner, 23 Oct 2026, ruling 11; Boss fix L). duty_prospects, 09:30.
 *
 * Her words: "she should show me the email to prospects for my approval but if she kept it like that
 * previous 13 emails it should be fine. those need to be going out regularly." — and on tone: "i like
 * to be more soft in my approach and request to chat because I have some names im working on"; "some
 * names i dont want to incl in the emails we need to come up with a select few good ones"; "these
 * prospects are buyers but some times can be sellers".
 *
 *   1. IMPORT. The 11 Oct send lives OUTSIDE the repo (~/8raise-tools/outreach-2026-10-11: sent-log.md
 *      with Gmail ids, recipients*.csv). It is read here at runtime and posted to D1; no name is
 *      ever committed. Each imported row is touch 1, threaded on the message she sent.
 *   2. REPLIES. Bounces and opt-outs are suppressed the same moment; an out-of-office changes nothing;
 *      an interested reply gets a held reply in its thread and a Decide item (Send as is / Edit, then
 *      send / Skip); a reply that mentions selling becomes a Sell row for the deal grid.
 *   3. THE EMAIL SHE APPROVES. No approved template → Monique proposes one (the soft template + 3–5
 *      featured names from her "Yours" supply, strongest first, each with a reason) as ONE Decide
 *      item: Approve / Edit. A stale featured name (supply gone or older than ~45 days) is proposed
 *      as a swap the same way — never swapped silently. Emails only ever use the approved list.
 *   4. SEND. Boss OS decides what is due (plan: approved template, kill switch, bounce brake, window,
 *      ≤20 new a day, touch 2 ≈ day 5, touch 3 ≈ day 12, then never again; replies and opt-outs never
 *      again). Without `--live` nothing is sent: the run writes a preview file and counts.
 *
 * Sends ONLY from the West Peek mailbox (the 11 Oct sender), ONLY what the plan returns, through
 * gmail.compose (`validate:gmail` PROSPECT_SENDERS and `validate:no-spry-sender` hold it narrow).
 * No model sees a name: the email is the approved template filled with a first name.
 *
 *   npm run lp:prospects            dry run (default): import, read replies, propose, preview sends
 *   npm run lp:prospects -- --live  the launchd job: also sends what is due
 *   npm run lp:prospects -- --verify-only   only her NeverBounce on the due addresses (posts verdicts)
 *
 * NEVERBOUNCE (owner, 24 Oct 2026: "u need to use my neverbounce when u can"): before the plan is
 * read, every address due a touch by tomorrow with no fresh verdict — first emails AND follow-ups —
 * is checked (≤ NEVERBOUNCE_MAX_PER_RUN credits a run, 90-day cache) and the verdict is kept in D1.
 * The plan sends only addresses with a verdict; while the bounce brake is on, only "valid" ones.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bossApi } from "./lib/duty-kit.mjs";
import { writeMorning } from "./lp-daily.mjs";
import { quotedSentence } from "../../src/shared/boss/mail/plain.mjs";
import {
  DEFAULT_PROSPECT_TEMPLATE, FEATURED_MIN, blur, gmailThreadUrl, proposeFeatured, renderProspect,
  staleFeatured, tapUrl, MAX_TOUCHES, approveOutcome,
} from "../../src/shared/boss/lp/plan.mjs";

const MAILBOX = "sequoia@westpeek.ventures";
const SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const SOURCE_DIR = process.env.PROSPECT_SOURCE_DIR ?? path.join(os.homedir(), "8raise-tools", "outreach-2026-10-11");
const MORNING_DIR = process.env.BOSS_OS_MORNING_DIR ?? path.join(os.homedir(), ".boss-os", "morning");
const PREVIEW = path.join(os.homedir(), ".boss-os", "lp", "prospect-preview.txt");
const LIVE = process.argv.includes("--live");

/**
 * WEEKDAYS ONLY, CENTRAL (owner, 1 Nov 2026). No prospect email — first or follow-up — goes on a
 * Saturday or Sunday in Chicago. A follow-up due at the weekend is still due on Monday: `dueTouch`
 * counts days since the first email, so skipping a day loses nothing. The launchd job only fires
 * Monday to Friday and the Worker's plan refuses outside weekdays 9–5; this is the third lock, on the
 * Mac, so even a by-hand `--live` on a Sunday sends nothing and spends no NeverBounce credit.
 */
export function isSendDay(now = Date.now()) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(new Date(now));
  return day !== "Sat" && day !== "Sun";
}
const VERIFY_ONLY = process.argv.includes("--verify-only");

/* ─── The 11 Oct files (pure parsers, tested with synthetic text) ─────────── */

export function parseCsv(text) {
  const rows = []; let field = "", row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [h, ...rest] = rows;
  return rest.filter((r) => r.some((x) => x)).map((r) => Object.fromEntries(h.map((k, i) => [k.trim(), (r[i] ?? "").trim()])));
}

/** sent-log.md → [{batch_at, file, firm, to, gmail_id}]. */
export function parseSentLog(md) {
  const out = [];
  let batch = null;
  for (const line of md.split("\n")) {
    const b = /^## Batch (\S+) from (\S+)/.exec(line);
    if (b) { batch = { at: Date.parse(b[1]), file: b[2] }; continue; }
    const r = /^\|\s*([^|]+?)\s*\|\s*([^|\s]+@[^|\s]+)\s*\|\s*([0-9a-f]{12,20})\s*\|/.exec(line);
    if (r && batch) out.push({ batch_at: batch.at, file: batch.file, firm: r[1], to: r[2].toLowerCase(), gmail_id: r[3] });
  }
  return out;
}

const SWF = /\b(investment authority|sovereign|investment corporation|state fund)\b/i;
export function kindOf(firm, why = "") {
  if (SWF.test(firm)) return "sovereign_wealth";
  if (/\bfund of funds\b/i.test(`${firm} ${why}`)) return "fund_of_funds";
  if (/\b(pension|endowment|foundation|retirement)\b/i.test(firm)) return "pension_endowment_foundation";
  if (/\bfamily office|family\b/i.test(`${firm} ${why}`)) return "family_office";
  return "family_office"; // the 11 Oct brief was family offices and sovereign funds only
}

/** The import rows, joined from both files. Pure. */
export function importRows(sentLog, recipients) {
  const byTo = new Map(recipients.map((r) => [String(r.to).toLowerCase(), r]));
  return sentLog.map((s) => {
    const r = byTo.get(s.to) ?? {};
    return {
      email: s.to, name: r.name ?? null, firm: r.firm ?? s.firm, kind: kindOf(r.firm ?? s.firm, r.why ?? ""),
      source: "8raise_2026_10_11", source_ref: s.file, touches: 1, first_sent_at: s.batch_at, last_touch_at: s.batch_at,
      gmail_id: s.gmail_id, status: "active",
    };
  });
}

/* ─── Gmail, the West Peek mailbox only ──────────────────────────────────── */

const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function token() {
  const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null");
  if (!creds) throw new Error("NAMED STOP [NO_SERVICE_ACCOUNT] run through the vault: npm run lp:prospects");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: creds.client_email, sub: MAILBOX, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(signer.sign(creds.private_key))}` }),
  });
  if (!res.ok) throw new Error(`NAMED STOP [NO_GRANT] the West Peek delegation refused compose (${res.status})`);
  return (await res.json()).access_token;
}
const call = async (tok, url, init = {}) => {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${tok}`, ...(init.body ? { "content-type": "application/json" } : {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`gmail ${r.status}`);
  return j;
};

/** Thread and Message-ID of a message she sent — headers only. */
async function threadOfSent(tok, id) {
  const u = new URL(`${GMAIL}/messages/${id}`);
  u.searchParams.set("format", "metadata");
  for (const h of ["Message-ID", "Subject"]) u.searchParams.append("metadataHeaders", h);
  const m = await call(tok, u.toString()).catch(() => null);
  if (!m) return null;
  const h = Object.fromEntries((m.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]));
  return { thread_id: m.threadId, message_id: h["message-id"] ?? null, subject: h.subject ?? null };
}

/** One RFC 5322 message from the West Peek mailbox, threaded when it is a follow-up. Pure. */
export function mime({ to, subject, body, inReplyTo, from = MAILBOX }) {
  return [
    `From: Sequoia Taylor <${from}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

/**
 * HOW ONE PLANNED SEND GOES (owner, 25 Oct 2026). A follow-up is a REPLY in the person's existing
 * thread, from the mailbox that sent their first email — never a new thread, never another mailbox.
 * Returns the mailbox, the message and the thread, or `{ refused }` with the reason. Pure.
 */
export function sendShape(s, { inReplyTo = s.in_reply_to ?? null } = {}) {
  if (s.touch > 1) {
    if (!s.thread_id) return { refused: `no thread on record for ${s.email}; a follow-up is only ever a reply in it` };
    if (!s.from) return { refused: `no record of which mailbox sent ${s.email}'s first email` };
    // This run holds the West Peek mailbox only (validate:gmail pins it): a thread that lives in any
    // other mailbox is not replied to from here, and is never answered from a different one.
    if (String(s.from).toLowerCase() !== MAILBOX) return { refused: `${s.email}'s first email went from ${s.from}; their follow-up can only be a reply from that mailbox, which this run does not hold` };
    const subject = /^re:/i.test(String(s.subject ?? "")) ? s.subject : `Re: ${s.subject ?? ""}`.trim();
    return { mailbox: s.from, threadId: s.thread_id, message: { to: s.email, subject, body: s.body, inReplyTo, from: s.from } };
  }
  return { mailbox: MAILBOX, threadId: null, message: { to: s.email, subject: s.subject, body: s.body, inReplyTo: null, from: MAILBOX } };
}

/** A held reply to an interested prospect: fixed, soft, either side. */
export function interestedReply(first) {
  const hi = /^[A-Za-z][A-Za-z'’-]{0,30}$/.test(String(first ?? "")) ? first : "there";
  return [`Hi ${hi},`, "", "Thank you for coming back to me. Would love to find 15 minutes to compare notes. Send me a couple of times that suit and we'll make it work.", "", "Best,", "Sequoia"].join("\n");
}

/* ─── NeverBounce (her account; key NEVERBOUNCE_API_KEY injected by the vault) ─ */

const NB_CACHE = path.join(os.homedir(), ".boss-os", "lp", "neverbounce-cache.json");
/**
 * Check `emails` with her NeverBounce (cache first, ≤ cap new credits). Returns the verdicts worth
 * keeping ({ email, result } — never an "unverified"), for POST /lp/prospects/verdicts.
 */
export async function neverBounceCheck(emails, { key = process.env.NEVERBOUNCE_API_KEY, fetchImpl = fetch, cacheFile = NB_CACHE } = {}) {
  const { verifyFirstSends, NEVERBOUNCE_MAX_PER_RUN } = await import("../../src/shared/boss/lp/bounces.mjs");
  if (!key) console.log("NAMED STOP [NO_NEVERBOUNCE_KEY] no prospect email goes to an unchecked address, and none can be checked until her NeverBounce key is in the vault as NEVERBOUNCE_API_KEY.");
  const check = key ? async (email) => {
    const u = new URL("https://api.neverbounce.com/v4.2/single/check");
    u.searchParams.set("key", key);
    u.searchParams.set("email", email);
    const j = await (await fetchImpl(u)).json();
    return j?.status === "success" ? j.result : null;
  } : null;
  const cache = readJson(cacheFile) ?? {};
  const cap = Number(process.env.NEVERBOUNCE_MAX_PER_RUN ?? NEVERBOUNCE_MAX_PER_RUN);
  const r = await verifyFirstSends(emails, { check, cache, cap });
  if (r.checked) { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(r.cache), { mode: 0o600 }); }
  const verdicts = [...r.verdicts].filter(([, v]) => v.mark !== "unverified").map(([email, v]) => ({ email, result: v.mark }));
  const marks = {};
  for (const v of r.verdicts.values()) marks[v.mark] = (marks[v.mark] ?? 0) + 1;
  console.log(`neverbounce: ${emails.length} due, ${r.checked} new check(s) (${Object.entries(marks).map(([k, n]) => `${n} ${k}`).join(", ") || "none due"}).`);
  return { verdicts, checked: r.checked, marks };
}

/** The due addresses Boss OS has no fresh verdict for → NeverBounce → kept in D1. */
export async function verifyDue(api, opts = {}) {
  const { NEVERBOUNCE_MAX_PER_RUN } = await import("../../src/shared/boss/lp/bounces.mjs");
  const cap = Number(process.env.NEVERBOUNCE_MAX_PER_RUN ?? NEVERBOUNCE_MAX_PER_RUN);
  const { emails = [] } = await api.get(`/lp/prospects/to-verify?cap=${cap}`);
  if (!emails.length) { console.log("neverbounce: every due address already has a verdict."); return { verdicts: [], marks: {} }; }
  const r = await neverBounceCheck(emails, opts);
  if (r.verdicts.length) console.log(`neverbounce: ${(await api.post("/lp/prospects/verdicts", { verdicts: r.verdicts })).recorded} verdict(s) kept.`);
  return r;
}

/* ─── The morning section ───────────────────────────────────────────────── */

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/** Her supply ("Yours" rows) and buyer demand, from D's morning deals file. */
export function supplyFrom(deals) {
  const rows = deals?.rows ?? [];
  const demand = new Map();
  for (const r of rows) if (/^buy/i.test(String(r.side))) demand.set(String(r.company).toLowerCase(), (demand.get(String(r.company).toLowerCase()) ?? 0) + 1);
  return rows.filter((r) => /^yours/i.test(String(r.side))).map((r) => ({
    company: r.company, size_usd: Number(r.size_usd ?? 0), seen_at: Date.parse(r.when ?? r.date ?? "") || null,
    demand: demand.get(String(r.company).toLowerCase()) ?? 0, known: Number(r.known ?? 0),
  }));
}

/** "11 Oct" from a ms timestamp. */
const dayMonth = (ms) => new Date(Number(ms)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "America/Chicago" });

export function templateDecide(tpl, { stale = [], forecast = null, released = null } = {}) {
  const names = JSON.parse(tpl.names_json ?? "[]");
  const tplObj = { subject: tpl.subject, body: tpl.body, follow_up: tpl.follow_up };
  const sample = renderProspect(tplObj, { first: "Alex", names });
  const follow = renderProspect(tplObj, { first: "Alex", names, touch: 2 });
  const outcome = approveOutcome(forecast);
  return {
    key: `prospect-template:${tpl.id ?? tpl.hash ?? ""}`,
    title: stale.length ? `Swap ${stale.join(", ")} in the prospect email` : "Approve the prospect email before it goes out",
    body: stale.length
      ? `${stale.join(", ")} ${stale.length === 1 ? "is" : "are"} no longer fresh on your list, so here is the email with a swap. Nothing new goes out until you approve. ${outcome.headline}`
      : `No prospect email goes out until you approve this one. ${outcome.headline}`,
    // What Approve does, from the plan (24 Oct 2026, Rule 0): never an Approve that silently sends nothing.
    outcome: outcome.headline,
    details: [
      // Her approval releases the one follow-up to everyone who got a first email (owner, 25 Oct 2026).
      ...(released?.count ? [`Approving this also sends one follow-up to the ${released.count} people who got your first email${released.firstSentAt ? ` on ${dayMonth(released.firstSentAt)}` : ""}.`] : []),
      ...outcome.lines,
      "After that: up to 20 new people a day, ONE gentle follow-up each, then the sequence is complete; every address is checked with NeverBounce first.",
      `Names it mentions: ${names.map((n) => `${n.name} (${n.why ?? "on your list"})`).join("; ")}.`,
      "Change: say what to change by replying with this card's number and your words; nothing is sent meanwhile. Try again: a different draft, with a new opening.",
    ],
    draft: { heading: "The email, word for word (Alex stands in for each person's first name)", text: `Subject: ${sample.subject}\n\n${sample.body}\n\nThe one follow-up (email 2, the last):\n\n${follow.body}` },
    buttons: [
      { label: "Approve", url: tapUrl(tpl.tap_token, "approve") },
      { label: "Change", url: tapUrl(tpl.tap_token, "edit") },
      { label: "Try again", url: tapUrl(tpl.tap_token, "retry") },
    ],
  };
}

export function prospectsMorning({ rows, pending, stale, plan, sent, now = Date.now() }) {
  const decide = [];
  const waiting = rows.filter((r) => ["new", "active"].includes(r.status) && Number(r.touches) === 1);
  const released = waiting.length ? { count: waiting.length, firstSentAt: Math.min(...waiting.map((r) => Number(r.first_sent_at ?? Date.now()))) } : null;
  if (pending) decide.push(templateDecide(pending, { stale, forecast: plan?.forecast ?? null, released }));
  for (const p of rows.filter((r) => r.status === "interested" && r.draft_tap_token)) {
    decide.push({
      title: `${p.name || "A prospect"}${p.firm ? ` at ${p.firm}` : ""} wants to talk`,
      body: `A prospect Monique wrote to${p.firm ? ` (${p.firm})` : ""} answered. Side: ${p.side === "unknown" ? "not clear yet" : p.side}. Your reply is ready in their thread.`,
      details: [
        ...(p.email ? [`Their email: ${p.email}`] : []),
        ...(p.reply_note ? [`What they wrote: ${quotedSentence(String(p.reply_note).slice(0, 300))}`] : []),
        `History: ${p.touches ?? 1} email${(p.touches ?? 1) === 1 ? "" : "s"} from Monique, then their reply.`,
      ],
      // No "Send as is": this email cannot show the held reply word for word, so it is sent from Gmail.
      buttons: [
        { label: "Read the reply in Gmail, then send", url: gmailThreadUrl(p.thread_id) },
        { label: "Skip", url: tapUrl(p.draft_tap_token, "skip") },
      ],
    });
  }
  const sells = rows.filter((r) => ["seller", "both"].includes(r.side) && r.status !== "opted_out").map((r) => ({
    company: "—", side: "Sell", from: [r.name, r.firm].filter(Boolean).join(", "), when: new Date(Number(r.updated_at ?? now)).toISOString().slice(0, 10),
    link: gmailThreadUrl(r.thread_id), source: "prospect_reply",
  }));
  const active = rows.filter((r) => ["new", "active"].includes(r.status)).length;
  const lines = [];
  if (sent) lines.push(`Monique sent ${sent} prospect email${sent === 1 ? "" : "s"} today.`);
  if (plan?.stops?.length && !pending) lines.push(`Prospect emails are paused: ${plan.stops[0]}`);
  if (plan?.note) lines.push(plan.note);
  lines.push(`Prospects: ${active} in the sequence, ${rows.filter((r) => r.status === "interested").length} interested, ${rows.filter((r) => r.status === "replied").length} replied, ${rows.filter((r) => ["opted_out", "bounced"].includes(r.status)).length} stopped.`);
  return { section: "prospects", updated_at: new Date(now).toISOString(), decide, rows: sells, lines };
}

/* ─── The run ───────────────────────────────────────────────────────────── */

async function main() {
  const api = await bossApi();
  if (VERIFY_ONLY) { const r = await verifyDue(api); console.log(`LP-PROSPECTS-VERIFIED: ${JSON.stringify(r.marks)}`); return; }
  const tok = await token();

  // 1. Import the 11 Oct send (idempotent: a known address keeps its history).
  const logFile = path.join(SOURCE_DIR, "sent-log.md");
  if (fs.existsSync(logFile)) {
    const sent = parseSentLog(fs.readFileSync(logFile, "utf8"));
    const recips = fs.readdirSync(SOURCE_DIR).filter((f) => /^recipients.*\.csv$/.test(f)).flatMap((f) => parseCsv(fs.readFileSync(path.join(SOURCE_DIR, f), "utf8")));
    const rows = importRows(sent, recips);
    const known = new Set(((await api.get("/lp/prospects")).rows ?? []).map((r) => r.email));
    const fresh = rows.filter((r) => !known.has(r.email));
    for (const r of fresh) { const t = await threadOfSent(tok, r.gmail_id); if (t) { r.thread_id = t.thread_id; r.last_message_id = t.message_id; r.subject = t.subject; } }
    const res = await api.post("/lp/prospects/import", { rows: fresh });
    console.log(`import: ${res.added} added, ${res.skipped} already known.`);
  } else {
    console.log("import: the 11 Oct files are not on this Mac; nothing imported.");
  }

  // 1b. WHAT ACTUALLY WENT, from her Sent mail (owner, 24 Oct 2026): every prospect email, whether
  // Monique sent it or she sent a draft from Gmail herself, is kept with its words, date and thread,
  // so follow-ups build on it, nobody gets a second first touch, and replies find their prospect.
  try {
    const { sentWordsTo } = await import("./lp-positive.mjs");
    const touches = await sentWordsTo(((await api.get("/lp/prospects")).rows ?? []).map((r) => r.email), { max: MAX_TOUCHES });
    if (touches.length) console.log(`sent mail: ${(await api.post("/lp/prospects/touches", { touches })).recorded} prospect email(s) on record with their words.`);
  } catch (e) { console.log(`note: her Sent mail was not read for prospect emails (${e.message}); the tracker keeps what it had.`); }

  // 2. Replies.
  const list = (await api.get("/lp/prospects?tokens=1")).rows ?? [];
  const watching = list.filter((r) => ["new", "active", "interested", "replied"].includes(r.status) && r.touches > 0);
  if (watching.length) {
    const since = new Date(Math.min(...watching.map((r) => Number(r.first_sent_at ?? Date.now())))).toISOString().slice(0, 10);
    const { readProspectReplies } = await import("./lp-positive.mjs");
    const replies = await readProspectReplies(watching.map((r) => r.email), since);
    const events = [];
    for (const [email, r] of replies) {
      const p = watching.find((w) => w.email === email);
      if (!p || r.kind === "ooo") continue;
      if (p.status === "interested" && r.kind === "interested") continue;
      let draft_id = null;
      if (r.kind === "interested" && p.thread_id) {
        const first = String(p.name ?? "").split(/\s+/)[0];
        const raw = b64url(mime({ to: email, subject: `Re: ${p.subject ?? ""}`.replace(/^Re: Re:/, "Re:"), body: interestedReply(first), inReplyTo: p.last_message_id }));
        const d = await call(tok, `${GMAIL}/drafts`, { method: "POST", body: JSON.stringify({ message: { raw, threadId: p.thread_id } }) }).catch(() => null);
        draft_id = d?.id ?? null;
      }
      events.push({ email, kind: r.kind, side: r.side, note: r.note, draft_id });
    }
    if (events.length) await api.post("/lp/prospects/events", { events });
    console.log(`replies: ${events.length} recorded (${[...replies.values()].filter((r) => r.kind === "ooo").length} out-of-office left alone).`);
  }

  // 3. The email she approves, and stale-name swaps.
  const deals = readJson(path.join(MORNING_DIR, "deals.json"));
  const supply = supplyFrom(deals);
  const rules = (await api.get("/lp/prospects/names")).rules ?? [];
  const byRule = (k) => rules.filter((r) => r.rule === k).map((r) => r.name);
  const state = await api.get("/lp/prospects");
  let pending = state.pending;
  let stale = [];
  const approvedNames = state.approved ? JSON.parse(state.approved.names_json ?? "[]") : [];
  if (state.approved && deals) stale = staleFeatured(approvedNames, supply).filter((n) => !byRule("add").includes(n.toLowerCase()));
  if (!state.approved || stale.length) {
    const keep = approvedNames.filter((n) => !stale.includes(n.name));
    const proposed = [...keep, ...proposeFeatured(supply, { never: byRule("never"), add: byRule("add"), drop: byRule("drop") }).filter((p) => !keep.some((k) => k.name.toLowerCase() === p.name.toLowerCase()))].slice(0, 5);
    // A waiting draft whose names no longer match her list (a name she added since, or written in the
    // wrong case) is replaced; proposeTemplate retires the old one. The same names leave it alone.
    const waitingNames = pending ? JSON.parse(pending.names_json ?? "[]").map((n) => n.name).join("|") : null;
    if (pending && waitingNames === proposed.map((n) => n.name).join("|")) {
      console.log(`template: the draft with ${proposed.length} names is waiting for her Approve.`);
    } else if (proposed.length >= FEATURED_MIN) {
      const r = await api.post("/lp/prospects/template", { template: DEFAULT_PROSPECT_TEMPLATE, names: proposed });
      pending = r.template?.status === "pending" ? r.template : null;
      console.log(`template: ${pending ? `proposed with ${proposed.length} names, waiting for her Approve` : "NOT proposed"}.`);
    } else {
      console.log(`template: only ${proposed.length} fresh names on her list (need ${FEATURED_MIN}); nothing proposed today.`);
    }
  }

  // 3b. Bounces from the whole mailbox (Twin's sends too) go on suppression before the plan is read.
  try {
    const { syncBounces } = await import("./lp-bounces.mjs");
    await syncBounces({ days: 3, commit: LIVE, api });
  } catch (e) { console.log(`note: ${e.message}`); }

  // 4. Her NeverBounce on every address due a touch (first emails and follow-ups), then the plan —
  // which sends only checked addresses, and only "valid" ones while the bounce brake is on.
  const sendDay = isSendDay();
  if (LIVE && !sendDay) console.log("WEEKEND: no prospect email goes on Saturday or Sunday (Central); anything due goes on Monday.");
  if (LIVE && sendDay) {
    try { await verifyDue(api); } catch (e) { console.log(`note: NeverBounce did not run (${e.message}); unchecked addresses wait.`); }
  }
  const plan = await api.get("/lp/prospects/plan");
  if (plan.note) console.log(`plan: ${plan.note}`);
  let sent = 0;
  if (plan.sends?.length) {
    if (LIVE && !sendDay) {
      console.log(`WEEKEND: ${plan.sends.length} due; held for Monday. Nothing sent.`);
    } else if (!LIVE || plan.dryRun) {
      fs.mkdirSync(path.dirname(PREVIEW), { recursive: true });
      fs.writeFileSync(PREVIEW, plan.sends.map((s) => `To: ${blur(s.name, s.email)}\nTouch ${s.touch}\nSubject: ${s.subject}\n\n${s.body}\n`).join("\n────────\n"), { mode: 0o600 });
      console.log(`DRY RUN: ${plan.sends.length} due (${plan.dryRun ? "outreach sending is not live" : "no --live"}); preview at ${PREVIEW}. Nothing sent.`);
    } else {
      const events = [];
      for (const s of plan.sends) {
        let shape = sendShape(s);
        if (shape.refused) { console.error(`  touch ${s.touch} held: ${shape.refused}`); continue; }
        const mtok = tok;
        // Thread it properly: the follow-up answers the last message in their thread.
        if (shape.threadId && !shape.message.inReplyTo) {
          const th = await call(mtok, `${GMAIL}/threads/${shape.threadId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject`).catch(() => null);
          const last = th?.messages?.at(-1)?.payload?.headers ?? [];
          const mid = last.find((h) => h.name.toLowerCase() === "message-id")?.value ?? null;
          const subj = (th?.messages?.[0]?.payload?.headers ?? []).find((h) => h.name.toLowerCase() === "subject")?.value ?? null;
          if (!th) { console.error(`  touch ${s.touch} held: the thread is not in ${shape.mailbox}`); continue; }
          shape = sendShape({ ...s, subject: s.subject ?? subj }, { inReplyTo: mid });
        }
        const raw = b64url(mime(shape.message));
        const m = await call(mtok, `${GMAIL}/messages/send`, { method: "POST", body: JSON.stringify({ raw, ...(shape.threadId ? { threadId: shape.threadId } : {}) }) }).catch((e) => ({ error: e.message }));
        if (!m?.id) { console.error(`  touch ${s.touch} refused: ${m?.error ?? "no id"}`); continue; }
        const meta = await threadOfSent(mtok, m.id);
        events.push({ prospect_id: s.prospect_id, kind: "sent", touch: s.touch, gmail_id: m.id, thread_id: m.threadId, message_id: meta?.message_id ?? null, subject: shape.message.subject, body: s.body, template_id: s.template_id ?? null, sent_from: shape.mailbox });
        sent++;
      }
      if (events.length) await api.post("/lp/prospects/events", { events });
    }
  } else if (plan.stops?.length) {
    console.log(`plan: nothing sent — ${plan.stops.join(" ")}`);
  }

  const rows = (await api.get("/lp/prospects?tokens=1")).rows ?? [];
  const file = writeMorning("prospects", prospectsMorning({ rows, pending, stale, plan, sent }));
  console.log(`LP-PROSPECTS-COMPLETE: ${rows.length} prospects, ${sent} sent; morning section at ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`LP-PROSPECTS FAILED: ${err?.message ?? err}`); process.exit(1); });
}
