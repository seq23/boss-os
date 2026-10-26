#!/usr/bin/env node
/**
 * SIMONE'S MEETING PREP — the evening before each call (owner-approved 26 Oct 2026).
 *
 * Hourly from launchd (com.seq.boss-meeting-prep, through duty-run.sh → duty_meeting_prep). The
 * hour is decided HERE, in Central time, never by the Mac's own clock (the Mac runs on Eastern):
 * from 18:00 Central every meeting tomorrow is due; any hour, a meeting later today that has had no
 * prep. ONE email per meeting, from Simone, subject "Prep: …"; never twice for one event on one day
 * (~/.boss-os/meeting-prep/sent.json, keyed on the event's id and date).
 *
 * The shape and the rules are src/shared/boss/meetingPrep/prep.mjs (pure, tested). This file reads:
 * her calendars (calendar-sync.mjs's readers, so the diary and the prep read them the same way),
 * Monique's records in Boss OS (prospects, LP replies, people, the prospect emails with their words,
 * warm references, the deal grid), the referenced pages ($0: plain GETs, the podcast's RSS, local
 * whisper on this Mac when it is installed), and Google News RSS for the firm.
 *
 *   npm run meeting-prep                        # send what is due now
 *   npm run meeting-prep -- --day 2026-10-30 --preview <file>   # render that day's preps to a file, send nothing
 *   npm run meeting-prep -- --dry-run           # print what would be sent now, send nothing
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readAllCalendars } from "./calendar-sync.mjs";
import { sendAsEmployee } from "./notify.mjs";
import { layoutEmail, plainProblems, NOTHING_TO_DECIDE } from "../../src/shared/boss/mail/plain.mjs";
import { buildPrep, dueMeetings, linkResolves, lengthLabel, others, recordsFor, nameFromTitle, companyDomain, shortDate, clock, DISPLAY_ZONE } from "../../src/shared/boss/meetingPrep/prep.mjs";
import { askClaudeJson, googleToken, gmailHeaders } from "./lib/duty-kit.mjs";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const DIR = path.join(os.homedir(), ".boss-os", "meeting-prep");
const SENT = path.join(DIR, "sent.json");
const CACHE = path.join(DIR, "summaries.json");
export const HER_ADDRESSES = (process.env.BOSS_HER_ADDRESSES ?? "seq.taylor@gmail.com,sequoia@westpeek.ventures,staylor@spry.vc,st@time-2-read.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const WHISPER = "/opt/homebrew/bin/whisper-cli";
const WHISPER_MODEL = path.join(os.homedir(), "Library", "Caches", "how-we-know", "ggml-small.en.bin");
const SINCE_SEP = Date.parse("2026-09-01T00:00:00Z");

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2), { mode: 0o600 }); };

async function session() {
  if (!process.env.BOSS_PASSCODE) throw new Error("NAMED STOP [NO_PASSCODE] run through the vault: npm run meeting-prep");
  const u = await fetch(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }) });
  if (!u.ok) throw new Error(`NAMED STOP [UNLOCK_FAILED] Boss OS refused the passcode (${u.status})`);
  const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
  const get = async (p) => { const r = await fetch(`${ORIGIN}/api/boss${p}`, { headers: { cookie } }); if (!r.ok) throw new Error(`${p} → ${r.status}`); return (await r.json()).data; };
  const post = async (p, body) => { const r = await fetch(`${ORIGIN}/api/boss${p}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${p} → ${r.status}`); return (await r.json()).data; };
  return { get, post };
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
/** The grid's rows as the prep reads them: who sent the order, and whether it is hers. */
export function dealRowsOf(grid) {
  return (grid?.rows ?? []).map((r) => ({
    company: r.company, side: r.side, size: r.size_text ?? null, price: r.price_text ?? null,
    from_email: (EMAIL_RE.exec(`${r.from_text ?? ""} ${typeof r.parties === "string" ? r.parties : JSON.stringify(r.parties ?? "")}`)?.[0] ?? "").toLowerCase() || null,
    hers: /^yours/i.test(String(r.side ?? "")),
  }));
}

async function readRecords(api) {
  const soft = (p, f) => api.get(p).then(f).catch((e) => { console.error(`meeting-prep: ${p} not read (${e.message})`); return []; });
  const [prospects, lpReplies, people, touches, references, deals] = await Promise.all([
    soft("/lp/prospects", (d) => d?.rows ?? []),
    soft("/lp/replies", (d) => d?.rows ?? []),
    soft("/relationships/people", (d) => (Array.isArray(d) ? d : [])),
    soft(`/lp/prospects/activity?since=${SINCE_SEP}`, (d) => d?.sent ?? []),
    soft("/lp/references", (d) => d?.rows ?? []),
    soft("/capital/deals", dealRowsOf),
  ]);
  return { prospects, lpReplies, people, touches, references, deals };
}

// ─── What the referenced link is ($0) ───────────────────────────────────────

const meta = (html, prop) => new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)`, "i").exec(html)?.[1] ?? null;
const strip = (h) => String(h ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const tag = (xml, t) => new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i").exec(xml)?.[1] ?? null;

function transcribe(audioUrl, minutes) {
  if (!fs.existsSync(WHISPER) || !fs.existsSync(WHISPER_MODEL) || !(minutes > 0 && minutes <= 90)) return null;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "prep-"));
  try {
    execFileSync("/opt/homebrew/bin/ffmpeg", ["-loglevel", "error", "-i", audioUrl, "-ar", "16000", "-ac", "1", path.join(work, "a.wav")], { timeout: 600_000 });
    execFileSync(WHISPER, ["-m", WHISPER_MODEL, "-f", path.join(work, "a.wav"), "-otxt", "-of", path.join(work, "t"), "-np"], { timeout: 1_800_000 });
    return fs.readFileSync(path.join(work, "t.txt"), "utf8");
  } catch (e) { console.error(`meeting-prep: transcription skipped (${String(e.message).slice(0, 120)})`); return null; }
  finally { fs.rmSync(work, { recursive: true, force: true }); }
}

/** Title, length, five bullets (transcript or show notes, labelled). Cached by URL. */
async function describeLink(url, api, cache) {
  if (cache[url]) return cache[url];
  const out = { title: null, length_label: null, bullets: [], source: "show_notes" };
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (Macintosh) BossOS-meeting-prep" } });
    const html = await r.text();
    out.title = strip(meta(html, "og:title") ?? tag(html, "title"))?.slice(0, 160) || null;
    let notes = strip(meta(html, "og:description") ?? meta(html, "description") ?? "");
    const rss = /<link[^>]+type=["']application\/rss\+xml["'][^>]*href=["']([^"']+)/i.exec(html)?.[1];
    let transcript = null;
    if (rss) {
      const feed = await (await fetch(new URL(rss, url))).text().catch(() => "");
      const key = (out.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40);
      const item = feed.split(/<item[\s>]/i).slice(1).find((it) => key && strip(tag(it, "title")).toLowerCase().replace(/[^a-z0-9]+/g, "").includes(key.slice(0, 25)));
      if (item) {
        const dur = tag(item, "itunes:duration");
        out.length_label = lengthLabel(strip(dur));
        notes = strip(tag(item, "description") ?? tag(item, "itunes:summary")) || notes;
        const enc = /<enclosure[^>]+url=["']([^"']+)/i.exec(item)?.[1];
        const mins = Number(out.length_label?.split("-")[0]);
        if (enc) transcript = transcribe(enc, mins);
      }
    }
    if (!out.length_label && !rss) {
      const words = strip(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")).split(" ").length;
      if (words > 300) out.length_label = `${Math.max(1, Math.round(words / 230))}-min read`;
    }
    const text = transcript ?? notes;
    if (transcript) out.source = "transcript";
    if (text && text.length >= 200) {
      const s = await api.post("/research/summarize", { title: out.title, text }).catch(() => null);
      out.bullets = s?.bullets ?? [];
    }
  } catch (e) { console.error(`meeting-prep: the link was not described (${String(e.message).slice(0, 100)})`); }
  cache[url] = out;
  return out;
}

/** Google News RSS for the firm, last 30 days, two at most. $0, no key. */
async function newsFor(firm, now) {
  try {
    const xml = await (await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${firm}"`)}&hl=en-US&gl=US&ceid=US:en`)).text();
    return xml.split(/<item>/i).slice(1).map((it) => ({ title: strip(tag(it, "title")), url: strip(tag(it, "link")), at: Date.parse(strip(tag(it, "pubDate"))) }))
      .filter((n) => n.title && n.at > now - 30 * 86_400_000).slice(0, 2)
      .map((n) => ({ title: n.title.slice(0, 160), url: n.url, date: new Date(n.at).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "America/Chicago" }) }));
  } catch { return []; }
}

// ─── What the prep reads before it writes (owner, 26 Oct 2026: "nothing is inside") ────────────

/*
 * FIVE PLACES, ALL $0, EVERY ONE EVIDENCE: her personal Gmail and calendar (the Claude connector on her
 * seat, the only thing that can read them; a run whose own stream shows no Gmail call is refused, so
 * "nothing found" is never a model's guess), her Workspace mailboxes (delegated, headers only), the
 * Boss OS cards that mention them, and their company's homepage. Never a guessed fact: what is not
 * found is left out, and anything inferred says it is a guess.
 */
export const WORKSPACE_MAILBOXES = (process.env.MEETING_PREP_MAILBOXES ?? "staylor@spry.vc,sequoia@westpeek.ventures").split(",").map((s) => s.trim()).filter(Boolean);
const CONTEXT_TOOLS = "select:mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread,mcp__claude_ai_Google_Calendar__search_events";
const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";

/** The prompt for her own Gmail and calendar. Pure, so the test reads exactly what the seat is told. */
export function contextPrompt({ name, email, domain, firm, title, when, today }) {
  const terms = [email ? `from:${email} OR to:${email}` : null, domain ? `"${domain}"` : null, name ? `"${name}"` : null, firm ? `"${firm}"` : null].filter(Boolean);
  return [
    `Sequoia Taylor has a meeting "${title}" on ${when}${name ? ` with ${name}` : ""}${email ? ` <${email}>` : ""}. Today is ${today}. Find what her own Gmail and Google Calendar say about this person. Search only; never send, label, change or delete anything.`,
    `1. Gmail search_threads, each of these: ${terms.map((t) => `[${t}]`).join(", ")}. Note every address of theirs you see (old personal ones too) and search each of those as well. Count the distinct emails found with this person across all of them, the date and subject of the oldest, and the three newest.`,
    "2. Read the newest two or three threads with get_thread (PLAIN_TEXT). Note whether any says what this meeting is for, and whether the newest email is from them with no answer from her.",
    `3. Gmail: from:(mailer-daemon OR postmaster) newer_than:30d ${name ? `"${name.split(" ")[0]}"` : email ? `"${email}"` : ""} — any bounce of an email to this person, with the address that bounced.`,
    `4. Google Calendar search_events for ${name ? `"${name}"` : `"${email}"`}: earlier meetings with them (before today), date and title.`,
    "Keep ONLY what a tool result showed. Never guess, never fill a gap, never invent a purpose: null when nothing says it.",
    'Answer with JSON only, in a ```json block: {"mail":{"count":0,"more":false,"first":{"date":"YYYY-MM-DD","subject":"..."},"recent":[{"date":"YYYY-MM-DD","subject":"...","from_them":true,"snippet":"one short plain line of what it says"}]},"unanswered":null or {"date":"YYYY-MM-DD","subject":"..."},"bounces":[{"address":"...","date":"YYYY-MM-DD"}],"meetings":[{"date":"YYYY-MM-DD","title":"..."}],"purpose_hint":null or {"text":"what the email says the meeting is for, in its own words","from":"their email of 24 Oct"}}',
  ].join("\n");
}

const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? "")) ? String(v).slice(0, 10) : null);
const str = (v, n = 200) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, n) : null);

/** The seat's answer, kept only in the shape the prep reads; anything malformed is dropped. Pure. */
export function readContext(json) {
  const m = json?.mail ?? {};
  const recent = (Array.isArray(m.recent) ? m.recent : []).map((r) => ({ date: isoDay(r?.date), subject: str(r?.subject, 160), from_them: Boolean(r?.from_them), snippet: str(r?.snippet, 200) })).filter((r) => r.date && r.subject).slice(0, 3);
  const count = Number.isFinite(Number(m.count)) ? Math.max(0, Math.floor(Number(m.count))) : recent.length;
  const first = isoDay(m.first?.date) ? { date: isoDay(m.first.date), subject: str(m.first?.subject, 160) } : null;
  const un = json?.unanswered && isoDay(json.unanswered.date) && str(json.unanswered.subject) ? { date: isoDay(json.unanswered.date), subject: str(json.unanswered.subject, 160) } : null;
  const bounces = (Array.isArray(json?.bounces) ? json.bounces : []).filter((b) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(b?.address ?? ""))).map((b) => ({ address: String(b.address).toLowerCase(), date: isoDay(b.date) }))
    .filter((b, i, a) => a.findIndex((x) => x.address === b.address) === i).slice(0, 3); // one line per address, never the same bounce twice
  const meetings = (Array.isArray(json?.meetings) ? json.meetings : []).map((x) => ({ date: isoDay(x?.date), title: str(x?.title, 120) })).filter((x) => x.date).slice(0, 5);
  const hint = str(json?.purpose_hint?.text, 300) ? { text: str(json.purpose_hint.text, 300), from: str(json.purpose_hint.from, 80) ?? "an email" } : null;
  return { mail: { count: Math.max(count, recent.length), more: Boolean(m.more), first: first ?? (recent.length ? { date: recent[recent.length - 1].date, subject: recent[recent.length - 1].subject } : null), recent }, unanswered: un, bounces, meetings, purpose_hint: hint };
}

/** Workspace mail (headers only) folded into what the seat found. Pure. */
export function mergeWorkspaceMail(ctx, hits, { email = null } = {}) {
  const mine = (hits ?? []).filter((h) => h?.date && h?.subject && !/mailer-daemon|postmaster/i.test(h.from ?? ""));
  if (!mine.length) return ctx;
  const mail = { ...(ctx.mail ?? { count: 0, recent: [] }) };
  mail.count = (mail.count ?? 0) + mine.length;
  const oldest = [...mine].sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!mail.first?.date || oldest.date < mail.first.date) mail.first = { date: oldest.date, subject: oldest.subject };
  const fromThem = (h) => Boolean(email && String(h.from ?? "").toLowerCase().includes(email.toLowerCase()));
  mail.recent = [...(mail.recent ?? []), ...mine.map((h) => ({ date: h.date, subject: h.subject, from_them: fromThem(h), snippet: null }))]
    .sort((a, b) => b.date.localeCompare(a.date)).filter((r, i, a) => a.findIndex((x) => x.date === r.date && x.subject === r.subject) === i).slice(0, 3);
  return { ...ctx, mail };
}

const metaOf = (html, prop) => new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)`, "i").exec(html)?.[1] ?? null;
const textOf = (h) => String(h ?? "").replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Their homepage, read plainly: its title and what it says it is (the meta description, else /about). */
export async function siteOf(domain, fetchImpl = fetch) {
  if (!domain) return null;
  const get = async (u) => {
    const r = await fetchImpl(u, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (Macintosh) BossOS-meeting-prep" }, signal: AbortSignal.timeout(10_000) });
    return r.ok ? (await r.text()).slice(0, 400_000) : "";
  };
  try {
    const html = await get(`https://${domain}/`);
    if (!html) return null;
    const title = textOf(metaOf(html, "og:title") ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").slice(0, 120) || null;
    let about = textOf(metaOf(html, "og:description") ?? metaOf(html, "description") ?? "").slice(0, 240) || null;
    if (!about) {
      const page = await get(`https://${domain}/about`).catch(() => "");
      about = (/<p[^>]*>([\s\S]{60,600}?)<\/p>/i.exec(page || html)?.[1] ? textOf(/<p[^>]*>([\s\S]{60,600}?)<\/p>/i.exec(page || html)[1]).slice(0, 240) : null);
    }
    return title || about ? { domain, title, about } : null;
  } catch { return null; }
}

/** Everything the prep reads about one meeting, with how each source went (said on stderr, never invented). */
export async function gatherContext(event, data, { api = null, ask = askClaudeJson, fetchImpl = fetch, now = Date.now(), log = console.error } = {}) {
  const lead = others(event, HER_ADDRESSES)[0] ?? null;
  const name = (lead?.name && !lead.name.includes("@") ? lead.name : null) ?? nameFromTitle(event.title);
  const rec = recordsFor({ email: lead?.email ?? null, name }, data);
  const firm = rec.prospect?.firm ?? rec.lp?.firm ?? rec.person?.organization_name ?? (/\(([^)]+)\)/.exec(String(event.title ?? ""))?.[1] ?? null);
  const domain = companyDomain(lead?.email);
  const first = name ?? (/\+\s*([A-Z][a-z]+)/.exec(String(event.title ?? ""))?.[1] ?? null);
  let ctx = { mail: { count: 0, recent: [] }, bounces: [], meetings: [], cards: [], unanswered: null, purpose_hint: null, site: null };

  const when = `${shortDate(event.scheduled_at)} at ${clock(event.scheduled_at)} ${DISPLAY_ZONE}`;
  const today = new Date(now).toISOString().slice(0, 10);
  const r = ask(contextPrompt({ name: first, email: lead?.email ?? null, domain, firm, title: String(event.title ?? ""), when, today }), { model: "sonnet", maxTurns: 30, timeoutMs: 600_000, requireTool: /Gmail/i, toolSearch: CONTEXT_TOOLS });
  if (r.ok) ctx = { ...ctx, ...readContext(r.json) };
  else log(`meeting-prep: her Gmail and calendar were not read for "${event.title}" (${r.why})`);

  for (const mb of WORKSPACE_MAILBOXES) {
    if (!lead?.email) break;
    try {
      const token = await googleToken(GMAIL_READONLY, mb, fetchImpl);
      const q = [`from:${lead.email}`, `to:${lead.email}`, ...(domain ? [domain] : [])].join(" OR ");
      ctx = mergeWorkspaceMail(ctx, await gmailHeaders(token, q, 15, fetchImpl), { email: lead.email });
    } catch (e) { log(`meeting-prep: ${mb} not read (${String(e.message).slice(0, 100)})`); }
  }
  if (api) {
    const qs = [lead?.email, domain, name, firm].filter(Boolean).map((t) => `q=${encodeURIComponent(t)}`).join("&");
    ctx.cards = qs ? await api.get(`/commands/meeting-prep/mentions?${qs}`).then((d) => d?.cards ?? []).catch((e) => { log(`meeting-prep: Boss OS cards not read (${e.message})`); return []; }) : [];
  }
  ctx.site = await siteOf(domain, fetchImpl);
  return ctx;
}

/** One line fits her email when the plain gate passes it on its own (no file names, no code words). */
export function lineFits(line) {
  return typeof line === "string" && line.trim().length > 0 && line.length <= 240
    && plainProblems({ subject: "Prep", text: `Your prep.\n\n${NOTHING_TO_DECIDE}\n- ${line}` }).length === 0;
}

/** The plan prompt: goals, what to have ready, a running order — from the purpose and the evidence only. */
export function planPrompt({ who, purpose, context, when, minutes }) {
  const facts = JSON.stringify({ site: context?.site ?? null, mail: context?.mail ?? null, open: { bounces: context?.bounces ?? [], unanswered: context?.unanswered ?? null }, meetings: context?.meetings ?? [] });
  return [
    `Sequoia Taylor meets ${who} on ${when}${minutes ? ` for ${minutes} minutes` : ""}. Write her prep: what to aim for and how to run it.`,
    `What the meeting is for, in her words or the invite's: """${purpose}"""`,
    `What her mail, calendar and their website show (facts; use only these): ${facts}`,
    "Rules: plain English, short whole sentences, written to her (\"you\"). No file names, no code, no commands, no jargon, no markdown, no links. Never invent a fact about them; a suggestion is fine, a claim is not.",
    'Answer with JSON only, in a ```json block: {"goals":["3 to 5 goals or questions for the meeting"],"ready":["2 to 4 things to have ready, or that they should have ready"],"order":["3 to 6 steps, in order, only if the meeting has a natural running order; else []"]}',
  ].join("\n");
}

/** The seat's plan, each line through the plain gate; a line that fails is dropped, never sent. Pure. */
export function readPlan(json) {
  const list = (v, n) => (Array.isArray(v) ? v : []).map((x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim() : "")).filter(lineFits).slice(0, n);
  const plan = { goals: list(json?.goals, 5), ready: list(json?.ready, 5), order: list(json?.order, 6) };
  return plan.goals.length || plan.ready.length || plan.order.length ? plan : null;
}

/** The plan for a meeting whose purpose is known. Null (and the evidence-only goals) when the seat fails. */
export function planFor(event, prep, context, { ask = askClaudeJson, log = console.error } = {}) {
  if (!prep.purpose?.text) return null;
  const r = ask(planPrompt({ who: prep.who, purpose: prep.purpose.text, context, when: `${shortDate(event.scheduled_at)} at ${clock(event.scheduled_at)} ${DISPLAY_ZONE}`, minutes: event.duration_min }), { model: "sonnet", maxTurns: 3, timeoutMs: 300_000 });
  if (!r.ok) { log(`meeting-prep: the plan was not written (${r.why}); the prep keeps its evidence-only goals`); return null; }
  return readPlan(r.json);
}

/** The finished email for one meeting: layoutEmail, so it passes the same plain gate as every email. */
export function prepEmail(event, data, opts = {}) {
  const p = buildPrep(event, data, { herAddresses: HER_ADDRESSES, ...opts });
  const laid = layoutEmail({ who: "Simone", subject: opts.subject ?? p.subject, happened: p.happened, decide: p.decide, sections: p.sections, refs: opts.refs ?? [] });
  return { ...p, laid };
}

/** What a prep row keeps, so her reply can be answered without reading the calendar again. */
export const eventSnapshot = (e) => ({ title: e.title, scheduled_at: e.scheduled_at, duration_min: e.duration_min ?? null, location: e.location ?? null, join_url: e.join_url ?? null, description: e.description ?? null, attendees: e.attendees ?? [], ical_uid: e.ical_uid ?? null, calendar_uid: e.calendar_uid ?? null });

/** Send one prep with its row's code, so her reply in the thread finds it. `{ ok, id, error }`. */
export async function sendPrep(api, event, data, { context, purpose = null, plan = null, subject = null, thread = [], send = (who, msg) => sendAsEmployee(who, msg), to = process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com" } = {}) {
  const draft = buildPrep(event, data, { herAddresses: HER_ADDRESSES, context, purpose, plan });
  const id = (await api.post("/commands/meeting-prep", { key: draft.key, asked: draft.needsPurpose, spec: { who: draft.who, subject: subject ?? draft.subject, event: eventSnapshot(event), context } }))?.id;
  const m = prepEmail(event, data, { context, purpose, plan, refs: id ? [id] : [], subject: subject ?? draft.subject });
  const r = await send("Simone", { to, subject: m.laid.subject, prelaid: m.laid, thread });
  return { ...r, cmd: id, prep: m };
}

/**
 * HER ANSWER, AND THE FINISHED PREP IN THE SAME THREAD (simone-commands.mjs, every ten minutes). The
 * row carries the event and what was found; her words are the purpose; the plan is written from both.
 */
export async function finishPrep(api, p, { ask = askClaudeJson, send = (who, msg) => sendAsEmployee(who, msg), log = console.error } = {}) {
  const event = p.spec?.event;
  if (!event?.scheduled_at) return { ok: false, error: "the prep row has no event" };
  const data = await readRecords(api).catch(() => ({}));
  const context = p.spec.context ?? {};
  const first = buildPrep(event, data, { herAddresses: HER_ADDRESSES, context, purpose: p.purpose });
  const plan = planFor(event, first, context, { ask, log });
  const subject = `Re: ${String(p.spec.subject ?? first.subject).replace(/^re:\s*/i, "")}`;
  const m = prepEmail(event, data, { context, purpose: p.purpose, plan, refs: [p.id], subject });
  const r = await send("Simone", { to: process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com", subject: m.laid.subject, prelaid: m.laid, thread: p.thread ?? [] });
  if (r.ok) await api.post(`/commands/${p.id}/prep-done`, { message_id: r.id ?? null });
  return { ...r, prep: m };
}

async function main() {
  const argv = process.argv;
  const DRY = argv.includes("--dry-run");
  const di = argv.indexOf("--day"); const DAY = di === -1 ? null : argv[di + 1];
  const pi = argv.indexOf("--preview"); const PREVIEW = pi === -1 ? null : argv[pi + 1];
  const now = Date.now();
  // A re-run by hand (26 Oct 2026): her stated purpose, the thread to answer in, the subject to keep
  // Gmail's thread, one meeting by its title, and --force past the once-per-event record.
  const arg = (f) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };
  const PURPOSE = arg("--purpose");
  const THREAD = (arg("--thread") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const SUBJECT = arg("--subject");
  const ONLY = arg("--only");
  const FORCE = argv.includes("--force");

  const cal = await readAllCalendars({ horizonDays: 3, now });
  for (const l of cal.log) (l.includes("✗") ? console.error : console.log)(l);
  if (cal.read === 0) { console.error("NAMED STOP [NO_FEED_READ] not one calendar could be read, so no meeting prep was possible."); process.exit(6); }

  const sentState = readJson(SENT, { keys: [] });
  const sent = new Set(DAY || PREVIEW || DRY || FORCE ? [] : sentState.keys);
  const due = dueMeetings(cal.events, { now, sent, day: DAY }).filter((e) => !ONLY || String(e.title ?? "").toLowerCase().includes(ONLY.toLowerCase()));
  if (due.length === 0) { console.log(`meeting-prep: read ${cal.read} calendar(s), ${cal.events.length} event(s); no meeting due a prep now.`); return; }

  const api = await session();
  // From now on, every warm line she sends is on that person's record: her sent mail since the last
  // scan, once a day (warm-references.mjs; the backfill from 1 Sep is the first scan).
  const today = new Date(now).toISOString().slice(0, 10);
  const scanState = readJson(path.join(DIR, "scan.json"), { last: "2026-09-01" });
  if (scanState.last !== today && !DRY && !PREVIEW) {
    try {
      const { scanSent } = await import("./warm-references.mjs");
      const { rows } = await scanSent(scanState.last);
      if (rows.length) await api.post("/lp/references", { rows });
      writeJson(path.join(DIR, "scan.json"), { last: today });
      console.log(`meeting-prep: ${rows.length} warm line(s) from her sent mail stored`);
    } catch (e) { console.error(`meeting-prep: sent mail not scanned for warm lines (${e.message})`); }
  }
  const data = await readRecords(api);
  const cache = readJson(CACHE, {});
  data.summaries = {};
  data.news = {};
  const checks = [];
  for (const e of due) {
    const lead = others(e, HER_ADDRESSES)[0] ?? null;
    const rec = recordsFor({ email: lead?.email ?? null, name: lead?.name ?? nameFromTitle(e.title) }, data);
    for (const r of rec.references) {
      if (r.verified === 0 || data.summaries[r.url]) continue;
      const okLink = await linkResolves(r.url);
      checks.push({ email: r.email, url: r.url, ok: okLink });
      r.verified = okLink ? 1 : false; // never quote a link that does not resolve
      if (okLink) data.summaries[r.url] = await describeLink(r.url, api, cache);
    }
    const firm = rec.prospect?.firm ?? rec.lp?.firm ?? rec.person?.organization_name ?? null;
    if (firm && !data.news[firm]) data.news[firm] = await newsFor(firm, now);
  }
  data.references = data.references.filter((r) => r.verified !== 0 && r.verified !== false);
  writeJson(CACHE, cache);
  if (checks.length) await api.post("/lp/references/checks", { checks }).catch((e) => console.error(`meeting-prep: link checks not saved (${e.message})`));

  // What was found for each meeting, then the plan for a meeting whose purpose is known.
  const built = [];
  for (const e of due) {
    const context = await gatherContext(e, data, { api, now });
    const first = buildPrep(e, data, { herAddresses: HER_ADDRESSES, context, purpose: PURPOSE });
    const plan = planFor(e, first, context);
    built.push({ e, context, plan, m: prepEmail(e, data, { context, purpose: PURPOSE, plan, subject: SUBJECT }) });
  }
  if (PREVIEW || DRY) {
    const text = built.map(({ m }) => `${m.laid.subject}\n\n${m.laid.text}`).join("\n\n════════════════\n\n");
    if (PREVIEW) { writeJson(`${PREVIEW}.json`, built.map(({ m }) => ({ key: m.key, subject: m.subject, needs_purpose: m.needsPurpose }))); fs.writeFileSync(PREVIEW, text, { mode: 0o600 }); console.log(`meeting-prep: ${built.length} prep(s) written to ${PREVIEW}; nothing sent.`); }
    else console.log(text);
    return;
  }

  let failed = 0;
  for (const { e, context, plan, m } of built) {
    const r = await sendPrep(api, e, data, { context, purpose: PURPOSE, plan, subject: SUBJECT, thread: THREAD });
    if (!r.ok) { failed += 1; console.error(`NAMED STOP [SEND_REFUSED] "${m.subject}" was not sent: ${r.error}`); continue; }
    sentState.keys = [...new Set([...sentState.keys, m.key])].slice(-2000);
    writeJson(SENT, sentState); // after each send, so a failure later never re-sends this one
    console.log(`meeting-prep: sent "${m.laid.subject}" from ${r.from}${m.needsPurpose ? " (asks what it is for)" : ""}`);
  }
  if (failed) process.exit(9);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(String(err?.message ?? err)); process.exit(1); });
}
