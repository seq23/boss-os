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
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bossApi } from "./lib/duty-kit.mjs";
import { writeMorning } from "./lp-daily.mjs";
import {
  DEFAULT_PROSPECT_TEMPLATE, FEATURED_MIN, blur, gmailThreadUrl, proposeFeatured, renderProspect,
  staleFeatured, tapUrl, MAX_TOUCHES,
} from "../../src/shared/boss/lp/plan.mjs";

const MAILBOX = "sequoia@westpeek.ventures";
const SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const SOURCE_DIR = process.env.PROSPECT_SOURCE_DIR ?? path.join(os.homedir(), "8raise-tools", "outreach-2026-10-11");
const MORNING_DIR = process.env.BOSS_OS_MORNING_DIR ?? path.join(os.homedir(), ".boss-os", "morning");
const PREVIEW = path.join(os.homedir(), ".boss-os", "lp", "prospect-preview.txt");
const LIVE = process.argv.includes("--live");

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
export function mime({ to, subject, body, inReplyTo }) {
  return [
    `From: Sequoia Taylor <${MAILBOX}>`,
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

/** A held reply to an interested prospect: fixed, soft, either side. */
export function interestedReply(first) {
  const hi = /^[A-Za-z][A-Za-z'’-]{0,30}$/.test(String(first ?? "")) ? first : "there";
  return [`Hi ${hi},`, "", "Thank you for coming back to me. Would love to find 15 minutes to compare notes. Send me a couple of times that suit and we'll make it work.", "", "Best,", "Sequoia"].join("\n");
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

export function templateDecide(tpl, { stale = [] } = {}) {
  const names = JSON.parse(tpl.names_json ?? "[]");
  const tplObj = { subject: tpl.subject, body: tpl.body, follow_up: tpl.follow_up };
  const sample = renderProspect(tplObj, { first: "Alex", names });
  const follow = renderProspect(tplObj, { first: "Alex", names, touch: 2 });
  return {
    key: `prospect-template:${tpl.id ?? tpl.hash ?? ""}`,
    title: stale.length ? `Swap ${stale.join(", ")} in the prospect email` : "Approve the prospect email before it goes out",
    body: stale.length
      ? `${stale.join(", ")} ${stale.length === 1 ? "is" : "are"} no longer fresh on your list, so here is the email with a swap. Nothing new goes out until you approve.`
      : "No prospect email goes out until you approve this one. Then it goes to up to 20 new people a day, with two gentle follow-ups, then stops.",
    details: [
      `Names it mentions: ${names.map((n) => `${n.name} (${n.why ?? "on your list"})`).join("; ")}.`,
      "Approve: Monique starts sending it on the next weekday, 9 to 5 Central.",
      "Change: opens it so you can say what to change; nothing is sent meanwhile.",
    ],
    draft: { heading: "The email, word for word (Alex stands in for each person's first name)", text: `Subject: ${sample.subject}\n\n${sample.body}\n\nThe follow-up (emails 2 and 3):\n\n${follow.body}` },
    buttons: [
      { label: "Approve", url: tapUrl(tpl.tap_token, "approve") },
      { label: "Change", url: tapUrl(tpl.tap_token, "edit") },
    ],
  };
}

export function prospectsMorning({ rows, pending, stale, plan, sent, now = Date.now() }) {
  const decide = [];
  if (pending) decide.push(templateDecide(pending, { stale }));
  for (const p of rows.filter((r) => r.status === "interested" && r.draft_tap_token)) {
    decide.push({
      title: `${p.name || "A prospect"}${p.firm ? ` at ${p.firm}` : ""} wants to talk`,
      body: `A prospect Monique wrote to${p.firm ? ` (${p.firm})` : ""} answered. Side: ${p.side === "unknown" ? "not clear yet" : p.side}. Your reply is ready in their thread.`,
      details: [
        ...(p.email ? [`Their email: ${p.email}`] : []),
        ...(p.reply_note ? [`What they wrote: "${String(p.reply_note).slice(0, 300).replace(/[\s.!?]+$/, "")}."`] : []),
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
  lines.push(`Prospects: ${active} in the sequence, ${rows.filter((r) => r.status === "interested").length} interested, ${rows.filter((r) => r.status === "replied").length} replied, ${rows.filter((r) => ["opted_out", "bounced"].includes(r.status)).length} stopped.`);
  return { section: "prospects", updated_at: new Date(now).toISOString(), decide, rows: sells, lines };
}

/* ─── The run ───────────────────────────────────────────────────────────── */

async function main() {
  const api = await bossApi();
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
  if (!pending && (!state.approved || stale.length)) {
    const keep = approvedNames.filter((n) => !stale.includes(n.name));
    const proposed = [...keep, ...proposeFeatured(supply, { never: byRule("never"), add: byRule("add"), drop: byRule("drop") }).filter((p) => !keep.some((k) => k.name.toLowerCase() === p.name.toLowerCase()))].slice(0, 5);
    if (proposed.length >= FEATURED_MIN) {
      const r = await api.post("/lp/prospects/template", { template: DEFAULT_PROSPECT_TEMPLATE, names: proposed });
      pending = r.template?.status === "pending" ? r.template : null;
    } else {
      console.log(`template: only ${proposed.length} fresh names on her list (need ${FEATURED_MIN}); nothing proposed today.`);
    }
  }

  // 4. Send what is due.
  const plan = await api.get("/lp/prospects/plan");
  let sent = 0;
  if (plan.sends?.length) {
    if (!LIVE || plan.dryRun) {
      fs.mkdirSync(path.dirname(PREVIEW), { recursive: true });
      fs.writeFileSync(PREVIEW, plan.sends.map((s) => `To: ${blur(s.name, s.email)}\nTouch ${s.touch}\nSubject: ${s.subject}\n\n${s.body}\n`).join("\n────────\n"), { mode: 0o600 });
      console.log(`DRY RUN: ${plan.sends.length} due (${plan.dryRun ? "outreach sending is not live" : "no --live"}); preview at ${PREVIEW}. Nothing sent.`);
    } else {
      const events = [];
      for (const s of plan.sends) {
        const raw = b64url(mime({ to: s.email, subject: s.subject, body: s.body, inReplyTo: s.in_reply_to }));
        const m = await call(tok, `${GMAIL}/messages/send`, { method: "POST", body: JSON.stringify({ raw, ...(s.thread_id ? { threadId: s.thread_id } : {}) }) }).catch((e) => ({ error: e.message }));
        if (!m?.id) { console.error(`  touch ${s.touch} refused: ${m?.error ?? "no id"}`); continue; }
        const meta = await threadOfSent(tok, m.id);
        events.push({ prospect_id: s.prospect_id, kind: "sent", touch: s.touch, gmail_id: m.id, thread_id: m.threadId, message_id: meta?.message_id ?? null, subject: s.subject, body: s.body, template_id: s.template_id ?? null });
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
