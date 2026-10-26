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
import { layoutEmail } from "../../src/shared/boss/mail/plain.mjs";
import { buildPrep, dueMeetings, linkResolves, lengthLabel, others, recordsFor, nameFromTitle } from "../../src/shared/boss/meetingPrep/prep.mjs";

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

/** The finished email for one meeting: layoutEmail, so it passes the same plain gate as every email. */
export function prepEmail(event, data, opts = {}) {
  const p = buildPrep(event, data, { herAddresses: HER_ADDRESSES, ...opts });
  const laid = layoutEmail({ who: "Simone", subject: p.subject, happened: p.happened, sections: p.sections });
  return { ...p, laid };
}

async function main() {
  const argv = process.argv;
  const DRY = argv.includes("--dry-run");
  const di = argv.indexOf("--day"); const DAY = di === -1 ? null : argv[di + 1];
  const pi = argv.indexOf("--preview"); const PREVIEW = pi === -1 ? null : argv[pi + 1];
  const now = Date.now();

  const cal = await readAllCalendars({ horizonDays: 3, now });
  for (const l of cal.log) (l.includes("✗") ? console.error : console.log)(l);
  if (cal.read === 0) { console.error("NAMED STOP [NO_FEED_READ] not one calendar could be read, so no meeting prep was possible."); process.exit(6); }

  const sentState = readJson(SENT, { keys: [] });
  const sent = new Set(DAY || PREVIEW || DRY ? [] : sentState.keys);
  const due = dueMeetings(cal.events, { now, sent, day: DAY });
  if (due.length === 0) { console.log(`meeting-prep: read ${cal.read} calendar(s), ${cal.events.length} event(s); no meeting due a prep now.`); return; }

  const api = await session();
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

  const emails = due.map((e) => prepEmail(e, data));
  if (PREVIEW || DRY) {
    const text = emails.map((m) => `${m.laid.subject}\n\n${m.laid.text}`).join("\n\n════════════════\n\n");
    if (PREVIEW) { writeJson(`${PREVIEW}.json`, emails.map((m) => ({ key: m.key, subject: m.subject }))); fs.writeFileSync(PREVIEW, text, { mode: 0o600 }); console.log(`meeting-prep: ${emails.length} prep(s) written to ${PREVIEW}; nothing sent.`); }
    else console.log(text);
    return;
  }

  let failed = 0;
  for (const m of emails) {
    const r = await sendAsEmployee("Simone", { to: process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com", subject: m.subject, prelaid: m.laid });
    if (!r.ok) { failed += 1; console.error(`NAMED STOP [SEND_REFUSED] "${m.subject}" was not sent: ${r.error}`); continue; }
    sentState.keys = [...new Set([...sentState.keys, m.key])].slice(-2000);
    writeJson(SENT, sentState); // after each send, so a failure later never re-sends this one
    console.log(`meeting-prep: sent "${m.subject}" from ${r.from}`);
  }
  if (failed) process.exit(9);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(String(err?.message ?? err)); process.exit(1); });
}
