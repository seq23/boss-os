#!/usr/bin/env node
/**
 * THE ONE-LIST LP DRIP (owner, 15 Nov 2026): four emails to each person on one private list, from
 * sequoia@westpeek.ventures, in one Gmail thread: email 1 on day 0, then day 3, 7 and 14, then never
 * again (risk brain R-EML-04). Weekdays only, Central. launchd com.seq.boss-lp8-drip, 09:30 Central.
 *
 * THE LIST IS PRIVATE AND NEVER IN THIS REPO: ~/.boss-os/lp/8fund/plan.json
 *   { approved, perDay, sender, rows: [{ lp, type, country, status, first, name, title, email, hook, why }] }
 * Only rows whose status starts with "send" are written to. Per-person state (thread, the day of each
 * email, why a person was stopped) is ~/.boss-os/lp/8fund/state.json, also never in the repo.
 *
 * THE GATE IS HER APPROVAL: `approved !== true` is NAMED STOP [NOT_APPROVED] (a note: exit 0, nothing
 * sent). The four emails below are the copy she approved; scripts/validate/lp-rules.mjs renders them
 * and fails the build on a fund size, "Fund I", a vintage, terms or an unfilled placeholder.
 *
 * BEFORE EVERY SEND, a person is stopped, and so is every other person at the same email domain
 * (the address alone at a public mail domain), when:
 *   - any message from that domain is in the mailbox (Gmail search, ids only);
 *   - the address or domain is on the LP Outreach Log's "Reply Queue" or "Reply Log" tab, or on
 *     "Blocked – Do Not Contact" for a reason that is about the firm (replied, blocked by her, or any
 *     reason not known to be about one address), or in ~/.boss-os/lp/suppress.txt;
 *   - a Blocked row about ONE address (Twin's full sequence with no reply, already contacted, bounced,
 *     a role inbox, an alias) stops that address only: the list's "new person" rows are colleagues of
 *     exactly those people, chosen on purpose (measured 15 Nov 2026: 12 of 27 would have been stopped);
 *   - a hard bounce came back for it (lp-bounces.mjs readHardBounces).
 * Before email 1 the address is checked with her NeverBounce: valid / catchall / unknown send;
 * invalid / disposable stop the person; no verdict (key missing, NeverBounce down) waits a day.
 *
 * AFTER EACH SEND a row goes on the sheet's "Sent Log" tab (signal tier "8fundraising", status
 * "sent") so Monique's 06:15 read and Twin see it, and state.json is written at once.
 *
 * RULE 0: every run prints `OUTPUT <n> emails sent` and a census line. Approved, people due, and 0
 * sent is NAMED STOP [NOTHING_SENT] (exit 1), which duty-run.sh records as a failed duty run.
 *
 *   npm run lp8:drip            send what is due today
 *   npm run lp8:drip -- --dry   print today's counts and one rendered email (name redacted); sends,
 *                               writes and NeverBounce credits: none
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TOUCH_DAYS, MAX_TOUCHES } from "../../src/shared/boss/lp/plan.mjs";

const MAILBOX = "sequoia@westpeek.ventures"; // the token lp-prospects.mjs mints impersonates this mailbox only
const DIR = process.env.LP8_DIR ?? path.join(os.homedir(), ".boss-os", "lp", "8fund");
const PLAN = path.join(DIR, "plan.json");
const STATE = path.join(DIR, "state.json");
const SUPPRESS = path.join(os.homedir(), ".boss-os", "lp", "suppress.txt");
const SHEET = process.env.LP_SOURCE_SHEET ?? "1Riww0SiaLb_vxHjUpruSdkNemBEndcQrDQgu7Ly9rRA";
const STOP_TABS = ["Reply Queue", "Reply Log", "Blocked – Do Not Contact"];
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const SIGNAL_TIER = "8fundraising";
/** Never two emails to one person under three days apart, even when a weekday was missed. */
const MIN_GAP_DAYS = 3;

/* ─── The four emails she approved (15 Nov 2026). Placeholders: {first}, {hook}. ─────────────── */
export const SUBJECT = "{first}, a new manager question";
export const TEMPLATES = [
  "Hi {first},\n\nI saw that {hook}, which is why I'm writing to you in particular.\n\nMy brother Scooter and I run West Peek, a founder community, and we're exploring an earliest-stage venture fund built on the companies that come through it. We'd be first-time managers, so the LPs who have publicly backed new funds are the people I most want to learn from.\n\nWould you be open to a 20-minute call in the next few weeks? Even hearing what you look for in a first-time manager would help us a lot.\n\nBest,\nSequoia Taylor\n415-355-4860\nhttps://ventures.joinwestpeek.com\n---\nFull disclosures: https://ventures.joinwestpeek.com/disclosures/",
  "Hi {first},\n\nBringing this back up in case it got buried. If a call is too much, a one-line reply on what you'd want to see from a first-time manager would be just as useful.\n\nBest,\nSequoia",
  "Hi {first},\n\nNo ask in this one. The reason we're building the fund around the community is that we meet founders months before they raise, in rooms we run ourselves. That early look is the part we think a new fund can do better than an established one.\n\nIf that's ever useful to compare notes on, I'd be glad to.\n\nBest,\nSequoia",
  "Hi {first},\n\nI'll leave it here so I'm not crowding your inbox. If emerging managers come up on your side later, I'd love to stay on your radar.\n\nBest,\nSequoia",
];

/** Email `touch` (1–4) for one person. Throws on an unknown touch or any placeholder left unfilled. Pure. */
export function render(touch, { first, hook }, templates = TEMPLATES) {
  const body0 = templates[touch - 1];
  if (!body0) throw new Error(`no email ${touch}: four at most`);
  const fill = (s) => s.replaceAll("{first}", String(first ?? "").trim()).replaceAll("{hook}", String(hook ?? "").trim().replace(/[.\s]+$/, ""));
  const first1 = fill(SUBJECT);
  const subject = touch === 1 ? first1 : `Re: ${first1}`;
  const body = fill(body0);
  const left = `${subject}\n${body}`.match(/\{[a-z_]+\}/gi);
  if (left) throw new Error(`email ${touch} has an unfilled placeholder: ${left.join(", ")}`);
  if (!String(first ?? "").trim()) throw new Error(`email ${touch} has no first name`);
  if (touch === 1 && !String(hook ?? "").trim()) throw new Error("email 1 has no hook");
  return { subject, body };
}

/* ─── Days, Central ──────────────────────────────────────────────────────── */
export function centralDay(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}
export function isWeekday(day) {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
}

/* ─── Who is due today. Pure. ─────────────────────────────────────────────── */
export const sendable = (row) => /^send/i.test(String(row?.status ?? "")) && /@/.test(String(row?.email ?? ""));
export const key = (email) => String(email ?? "").trim().toLowerCase();

/**
 * `{ firsts, followups }` for `today` (YYYY-MM-DD Central). Firsts are every sendable row never
 * written to and not stopped, in plan order (the caller caps them at perDay after the checks);
 * follow-ups are people whose next email's day (0/3/7/14 from the first) has come, at least
 * MIN_GAP_DAYS after their last, never a fifth and never twice in one day.
 */
export function dueToday(rows, state, today) {
  const firsts = [], followups = [];
  const seen = new Set();
  for (const row of rows ?? []) {
    if (!sendable(row)) continue;
    const e = key(row.email);
    if (seen.has(e)) continue;
    seen.add(e);
    const p = state?.people?.[e];
    if (p?.stopped) continue;
    const sent = p?.sent ?? [];
    if (!sent.length) { firsts.push({ row, touch: 1 }); continue; }
    const touch = sent.length + 1;
    if (touch > MAX_TOUCHES) continue;
    const last = sent.at(-1).day;
    if (last >= today) continue;
    if (daysBetween(sent[0].day, today) < TOUCH_DAYS[touch - 1]) continue;
    if (daysBetween(last, today) < MIN_GAP_DAYS) continue;
    followups.push({ row, touch });
  }
  return { firsts, followups };
}

/** Blocked-tab reasons (column D) that are about one address, not the firm. Anything else stops the firm. */
export const ADDRESS_ONLY_BLOCKED = /^(completed full sequence|already contacted before|bounced|previously bounced|role\/generic inbox|duplicate person)/i;

/* ─── Stop at the domain. Pure. ──────────────────────────────────────────── */
export const FREEMAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "msn.com"]);
export const domainOf = (email) => key(email).split("@")[1] ?? "";
/** What a stop is keyed on: the domain, or the address itself at a public mail domain. */
export const stopKey = (email) => (FREEMAIL.has(domainOf(email)) ? key(email) : domainOf(email));

/** Addresses and bare domains in free sheet text (any cell), lower-cased. Pure. */
export function marksIn(cells) {
  const out = new Set();
  for (const c of cells ?? []) {
    const s = String(c ?? "").toLowerCase();
    for (const a of s.match(/[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) { out.add(a); if (!FREEMAIL.has(domainOf(a))) out.add(domainOf(a)); }
    const bare = s.trim().replace(/^@/, "");
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) && !FREEMAIL.has(bare)) out.add(bare);
  }
  return out;
}

/**
 * Map(address → reason) for every sendable row that must stop now. `hits` is a list of
 * { mark, reason, only? } where mark is an address or a domain. A hit on an address at a company
 * domain stops the whole domain, unless `only` says it is about that address alone; a hit at a
 * public mail domain stops only that address. Pure.
 */
export function stopsFor(rows, hits) {
  const byKey = new Map();
  for (const { mark, reason, only } of hits ?? []) {
    const m = key(mark).replace(/^@/, "");
    if (!m) continue;
    const k = m.includes("@") && !only ? stopKey(m) : m;
    if (FREEMAIL.has(k)) continue; // a public mail domain is never stopped whole
    if (!byKey.has(k)) byKey.set(k, reason);
  }
  const out = new Map();
  for (const row of rows ?? []) {
    if (!sendable(row)) continue;
    const r = byKey.get(stopKey(row.email)) ?? byKey.get(key(row.email));
    if (r) out.set(key(row.email), r);
  }
  return out;
}

/** The census line and Rule 0's verdict for one run. Pure. */
export function verdict({ due, firstsSent, followupsSent, stopped, reasons = [], held = [] }) {
  const sent = firstsSent + followupsSent;
  const line = `lp8-drip: sent ${firstsSent} first, ${followupsSent} follow-ups, stopped ${stopped}${held.length ? `, held ${held.length}` : ""}${reasons.length ? `; ${reasons.join("; ")}` : ""}`;
  const stop = due > 0 && sent === 0 ? `NAMED STOP [NOTHING_SENT] ${due} email(s) due today, 0 sent; first reason: ${held[0] ?? "none was accepted"}. Fix it and the next weekday run sends them.` : null;
  return { sent, line, stop };
}

/** One Sent Log row, in the tab's own column order. Pure. */
export function sentLogRow({ day, row, touch, subject }) {
  const first = String(row.first ?? "").trim();
  const last = String(row.name ?? "").trim().replace(new RegExp(`^${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "");
  return [day, first, last, row.lp ?? "", row.type ?? "", key(row.email), SIGNAL_TIER, touch, subject, "sent"];
}

/* ─── The run (I/O) ──────────────────────────────────────────────────────── */
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const named = (msg, code) => Object.assign(new Error(msg), { code });

async function gmail(tok, url, init = {}) {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${tok}`, ...(init.body ? { "content-type": "application/json" } : {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`gmail ${r.status}${j?.error?.errors?.[0]?.reason ? ` ${j.error.errors[0].reason}` : ""}`), { status: r.status });
  return j;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const plan = readJson(PLAN);
  if (!plan || !Array.isArray(plan.rows)) throw named(`NAMED STOP [NO_PLAN] ${PLAN} is missing or unreadable; nothing sent.`, 2);
  if (plan.approved !== true) {
    console.error("NAMED STOP [NOT_APPROVED] the plan's approved flag is not true; nothing sent. She approves the four emails, then approved flips to true.");
    console.log("OUTPUT 0 emails sent");
    return 0;
  }
  if (plan.sender && key(plan.sender) !== MAILBOX) throw named(`NAMED STOP [WRONG_SENDER] the plan says it sends from another mailbox; this job sends only from ${MAILBOX}. Nothing sent.`, 2);
  const today = centralDay();
  if (!isWeekday(today) && !dry) {
    console.log(`NOTE [WEEKEND] ${today} is a Saturday or Sunday in Central; nothing sent, follow-ups wait for Monday.`);
    console.log("OUTPUT 0 emails sent");
    return 0;
  }
  const perDay = Math.max(0, Number(plan.perDay ?? 6));
  const state = readJson(STATE) ?? { people: {} };
  state.people ??= {};
  const rows = plan.rows.filter(sendable);
  const { firsts, followups } = dueToday(rows, state, today);
  if (!firsts.length && !followups.length) {
    console.log(`lp8-drip: nobody due today (${rows.length} on the list).`);
    console.log("OUTPUT 0 emails sent");
    return 0;
  }

  const { token, mime, threadHeaders, neverBounceCheck } = await import("./lp-prospects.mjs");
  const { accessToken, readHardBounces } = await import("./lp-bounces.mjs");
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) throw named("NAMED STOP [NO_SERVICE_ACCOUNT] run through the vault: npm run lp8:drip", 3);
  const readTok = await token("https://www.googleapis.com/auth/gmail.readonly");
  const sheetTok = await accessToken(JSON.parse(raw), dry ? "https://www.googleapis.com/auth/spreadsheets.readonly" : "https://www.googleapis.com/auth/spreadsheets", null);

  // 1. The stop checks, for everyone due today and their domains.
  const hits = [];
  for (const tab of STOP_TABS) {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`'${tab}'!A1:Z5000`)}`, { headers: { authorization: `Bearer ${sheetTok}` } });
    if (!r.ok) throw named(`NAMED STOP [STOP_LIST_UNREAD] the "${tab}" tab could not be read (${r.status}); nothing sent, because a person who replied or asked to be left alone could be emailed. The next weekday run retries.`, 75);
    for (const cells of (await r.json()).values ?? []) {
      const only = tab.startsWith("Blocked") && ADDRESS_ONLY_BLOCKED.test(String(cells[3] ?? "").trim());
      for (const m of marksIn(cells)) if (!only || m.includes("@")) hits.push({ mark: m, reason: `on "${tab}"`, only });
    }
  }
  if (fs.existsSync(SUPPRESS)) for (const a of fs.readFileSync(SUPPRESS, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)) hits.push({ mark: a, reason: "on the suppression list" });

  const anySent = Object.values(state.people).filter((p) => p.sent?.length);
  if (anySent.length) {
    const earliest = anySent.map((p) => p.sent[0].day).sort()[0];
    const days = Math.min(60, Math.max(1, daysBetween(earliest, today) + 1));
    const { hard } = await readHardBounces(readTok, days);
    for (const a of hard.keys()) hits.push({ mark: a, reason: "hard bounce" });
  }
  const domains = new Map(); // stop key → the earliest first-send day at it (null: none yet)
  for (const { row } of [...firsts, ...followups]) {
    const k = stopKey(row.email);
    const at = Object.entries(state.people).filter(([e, p]) => stopKey(e) === k && p.sent?.length).map(([, p]) => p.sent[0].day).sort()[0] ?? null;
    domains.set(k, at);
  }
  for (const [k, since] of domains) {
    // Since the first send there; before any send, the last 180 days (a firm already writing to her is Monique's).
    const q = `in:anywhere from:${k.includes("@") ? k : `@${k}`} ${since ? `after:${since.replaceAll("-", "/")}` : "newer_than:180d"}`;
    const j = await gmail(readTok, `${GMAIL}/messages?maxResults=1&q=${encodeURIComponent(q)}`).catch((e) => { throw named(`NAMED STOP [MAILBOX_UNREAD] the mailbox search failed (${e.message}); nothing sent, because a reply could be missed. The next weekday run retries.`, 75); });
    if (j.messages?.length) hits.push({ mark: k, reason: "a message from them is in the mailbox" });
  }
  const stops = stopsFor(rows, hits);
  const reasonCount = {};
  for (const [e, reason] of stops) {
    if (state.people[e]?.stopped) continue;
    state.people[e] = { ...(state.people[e] ?? { sent: [] }), stopped: { reason, day: today } };
    reasonCount[reason] = (reasonCount[reason] ?? 0) + 1;
  }
  const isStopped = ({ row }) => stops.has(key(row.email));
  const dueFollow = followups.filter((x) => !isStopped(x));
  let candidates = firsts.filter((x) => !isStopped(x));

  // 2. NeverBounce before email 1, only for as many as could go today.
  const held = [];
  let goFirsts = [];
  if (dry) {
    goFirsts = candidates.slice(0, perDay);
  } else {
    while (goFirsts.length < perDay && candidates.length) {
      const batch = candidates.slice(0, perDay - goFirsts.length);
      candidates = candidates.slice(batch.length);
      const { verdicts } = await neverBounceCheck(batch.map(({ row }) => key(row.email)));
      const v = new Map(verdicts.map((x) => [x.email, x.result]));
      for (const x of batch) {
        const e = key(x.row.email);
        const mark = v.get(e);
        if (["valid", "catchall", "unknown"].includes(mark)) { goFirsts.push(x); state.people[e] = { ...(state.people[e] ?? { sent: [] }), nb: mark }; }
        else if (mark === "invalid" || mark === "disposable") { state.people[e] = { ...(state.people[e] ?? { sent: [] }), nb: mark, stopped: { reason: `NeverBounce ${mark}`, day: today } }; reasonCount[`NeverBounce ${mark}`] = (reasonCount[`NeverBounce ${mark}`] ?? 0) + 1; }
        else held.push(`no NeverBounce verdict for a first email (waits a day)`);
      }
      if (held.length && !verdicts.length) break; // NeverBounce answered nothing: do not burn the list
    }
  }
  const stoppedN = Object.values(reasonCount).reduce((a, b) => a + b, 0);
  const reasons = Object.entries(reasonCount).map(([r, n]) => `${n} ${r}`);
  const due = goFirsts.length + dueFollow.length + held.length;

  if (dry) {
    console.log(`DRY RUN ${today}: would send ${goFirsts.length} first email(s) (cap ${perDay}; ${candidates.length - goFirsts.length} more waiting) and ${dueFollow.length} follow-up(s); stopped ${stoppedN}${reasons.length ? ` (${reasons.join("; ")})` : ""}. NeverBounce not called in a dry run.`);
    const one = goFirsts[0] ?? dueFollow[0];
    if (one) {
      const r = render(one.touch, { first: "[name]", hook: `[hook, ${String(one.row.hook ?? "").length} chars]` });
      console.log(`--- email ${one.touch} as it would go (name and hook redacted) ---\nSubject: ${r.subject}\n\n${r.body}\n---`);
    }
    console.log("OUTPUT 0 emails sent");
    return 0;
  }

  // 3. Send, record, log.
  const sendTok = await token();
  const save = () => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 }); };
  save();
  let firstsSent = 0, followupsSent = 0;
  const logRows = [];
  for (const x of [...dueFollow, ...goFirsts]) {
    const e = key(x.row.email);
    const p = state.people[e] ?? { sent: [] };
    const { subject, body } = render(x.touch, { first: x.row.first, hook: x.row.hook });
    let inReplyTo = null;
    if (x.touch > 1) {
      if (!p.threadId) { held.push("a follow-up with no thread on record"); continue; }
      const th = await threadHeaders(readTok, p.threadId);
      if (th.stop) throw named(th.stop, 9);
      if (th.held) { held.push(th.held); continue; }
      inReplyTo = th.messageId;
    }
    const msg = mime({ to: e, subject, body, inReplyTo, from: MAILBOX });
    let res;
    try {
      res = await gmail(sendTok, `${GMAIL}/messages/send`, { method: "POST", body: JSON.stringify({ raw: Buffer.from(msg).toString("base64url"), ...(x.touch > 1 ? { threadId: p.threadId } : {}) }) });
    } catch (err) {
      if (err.status === 401 || err.status === 403) { save(); throw named(`NAMED STOP [SEND_REFUSED] Gmail refused the send (${err.message}); the West Peek delegation's compose grant needs checking. Sent so far: ${firstsSent + followupsSent}.`, 3); }
      held.push(`Gmail ${err.message}`);
      continue;
    }
    p.sent = [...(p.sent ?? []), { touch: x.touch, day: today, at: Date.now(), id: res.id }];
    if (x.touch === 1) { p.threadId = res.threadId; p.subject = subject; }
    state.people[e] = p;
    save();
    if (x.touch === 1) firstsSent++; else followupsSent++;
    logRows.push(sentLogRow({ day: today, row: x.row, touch: x.touch, subject }));
  }
  if (logRows.length) {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent("Sent Log!A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST", headers: { authorization: `Bearer ${sheetTok}`, "content-type": "application/json" }, body: JSON.stringify({ values: logRows }),
    });
    if (!r.ok) {
      console.log(`OUTPUT ${logRows.length} emails sent`);
      throw named(`NAMED STOP [SENT_LOG_WRITE] ${logRows.length} email(s) went but the Sent Log refused the rows (${r.status}); Monique's morning read will not see them. state.json has them.`, 1);
    }
  }
  const v = verdict({ due, firstsSent, followupsSent, stopped: stoppedN, reasons, held });
  console.log(v.line);
  console.log(`OUTPUT ${v.sent} emails sent`);
  if (v.stop) throw named(v.stop, 1);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((c) => process.exit(c ?? 0)).catch((e) => { console.error(e.message.startsWith("NAMED STOP") ? e.message : `NAMED STOP [LP8_DRIP_FAILED] ${e.message}`); process.exit(e.code ?? 1); });
}
