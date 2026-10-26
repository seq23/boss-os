#!/usr/bin/env node
/**
 * MONIQUE'S PRE-SEED WATCH (owner-approved 26 Oct 2026). Mondays 07:30 Central, launchd
 * com.seq.boss-preseed-watch through duty-run.sh → duty_preseed_watch.
 *
 * 1. Crossed your desk: pre-seed and seed pitches in her Workspace mailboxes (West Peek, Spry) —
 *    the first run looks back six months, then each week — read by Gmail search and metadata only
 *    (subject, sender, date, snippet), sorted into her sectors by fixed rules. Newsletters are not pitches.
 * 2. Funded in the market: this week's pre-seed rounds from public news headlines (Google News RSS,
 *    US edition, $0), figures marked "reported", never invented.
 * 3. The comparison, stored on the Deals page (Pre-seed watch) and one line in Monday's email.
 *
 *   npm run preseed:watch                 # run it now
 *   npm run preseed:watch -- --dry-run    # print the lists, store nothing
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { accessToken } from "./lp-positive.mjs";
import { bossApi } from "./lib/duty-kit.mjs";
import { addMorningLines } from "../../src/shared/boss/mail/morning.mjs";
import { crossedRow, fundedRow, compareLists, preseedLine } from "../../src/shared/boss/capital/preseed.mjs";
import { gmailThreadUrl, ORIGIN } from "../../src/shared/boss/lp/plan.mjs";

const MAILBOXES = (process.env.PRESEED_MAILBOXES ?? "sequoia@westpeek.ventures,staylor@spry.vc").split(",").map((s) => s.trim()).filter(Boolean);
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const STATE = path.join(os.homedir(), ".boss-os", "preseed", "state.json");
const QUERY = '("pre-seed" OR preseed OR "pre seed" OR "seed round" OR "raising our seed" OR "raising a seed") -in:sent -in:chats';

const strip = (h) => String(h ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const tag = (xml, t) => new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i").exec(xml)?.[1] ?? null;

async function mailbox(sub, days) {
  const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null");
  if (!creds) throw new Error("NAMED STOP [NO_SERVICE_ACCOUNT] run through the vault");
  const tok = await accessToken(creds, SCOPE, sub);
  const get = async (u) => { const r = await fetch(u, { headers: { authorization: `Bearer ${tok}` } }); if (!r.ok) throw new Error(`Gmail answered ${r.status}`); return r.json(); };
  const ids = [];
  let page = null;
  do {
    const j = await get(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=200&q=${encodeURIComponent(`${QUERY} newer_than:${days}d`)}${page ? `&pageToken=${page}` : ""}`);
    ids.push(...(j.messages ?? []));
    page = j.nextPageToken ?? null;
  } while (page && ids.length < 1500);
  const out = [];
  for (const m of ids) {
    const d = await get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=List-Unsubscribe`);
    const h = Object.fromEntries((d.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]));
    const from = /<([^>]+)>/.exec(h.from ?? "")?.[1] ?? h.from ?? "";
    out.push({ subject: h.subject ?? "", from, from_name: (h.from ?? "").replace(/<[^>]+>/, "").replace(/"/g, "").trim() || null, snippet: d.snippet ?? "",
      date: new Date(Number(d.internalDate)).toISOString().slice(0, 10), newsletter: Boolean(h["list-unsubscribe"]), url: gmailThreadUrl(d.threadId, sub) });
  }
  return out;
}

async function market() {
  const rows = [];
  for (const q of ['"pre-seed" raises when:7d', '"pre-seed round" when:7d', '"pre-seed funding" when:7d']) {
    const xml = await (await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`)).text().catch(() => "");
    for (const it of xml.split(/<item>/i).slice(1)) {
      const r = fundedRow({ title: strip(tag(it, "title")), url: strip(tag(it, "link")), date: new Date(Date.parse(strip(tag(it, "pubDate")))).toISOString().slice(0, 10) });
      if (r && !rows.some((x) => x.company.toLowerCase().split(" ").pop() === r.company.toLowerCase().split(" ").pop())) rows.push(r);
    }
  }
  // US first, then the rest; one row per company.
  return rows.sort((a, b) => Number(b.us) - Number(a.us));
}

async function main() {
  const DRY = process.argv.includes("--dry-run");
  const state = (() => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; } })();
  const days = state.last ? 8 : 183; // six months the first time, then each week
  const msgs = [];
  for (const mb of MAILBOXES) { try { msgs.push(...await mailbox(mb, days)); } catch (e) { console.error(`preseed: ${mb} not read (${e.message})`); } }
  const crossed = [];
  for (const m of msgs) { const r = crossedRow(m); if (r && !crossed.some((x) => x.company.toLowerCase() === r.company.toLowerCase())) crossed.push(r); }
  crossed.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const funded = await market();
  const cmp = compareLists(crossed, funded);
  const week = new Date().toISOString().slice(0, 10);
  console.log(`preseed: ${msgs.length} mails read (${days} days), ${crossed.length} crossed your desk, ${funded.length} funded in the market, ${cmp.gaps.length} gap sector(s).`);
  if (DRY) { console.log(JSON.stringify({ crossed: crossed.slice(0, 5).map((r) => ({ ...r, from: "…" })), funded: funded.slice(0, 5), cmp }, null, 1)); return; }
  const api = await bossApi();
  await api.post("/capital/preseed", { week, crossed, funded, compare: cmp });
  addMorningLines("notices", { lines: [{ text: preseedLine(crossed, funded, cmp), links: [{ label: "See both lists", url: `${ORIGIN}/?tab=capital&view=preseed` }] }] });
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ last: week }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`preseed-watch failed: ${e?.message ?? e}`); process.exit(1); });
}
