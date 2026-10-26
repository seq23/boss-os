#!/usr/bin/env node
/**
 * WARM REFERENCES IN HER OWN SENT MAIL (owner, 26 Oct 2026). Every warm line she wrote to someone —
 * "loved your episode on …" with its link — read from her sent mail in the West Peek mailbox, the link
 * checked, and stored on that person's record for Simone's meeting prep. Her words only (quoted text
 * and signatures are cut), and a link that does not resolve is stored as not verified, never quoted.
 *
 *   npm run vault:run -- node scripts/ops/warm-references.mjs --since 2026-09-01   # the backfill
 * Simone's meeting prep runs it once a day for the days since its last scan.
 */
// The token is lp-positive's contentToken: scope gmail.readonly, the West Peek mailbox named in the JWT.
import { contentToken, messageWords } from "./lp-positive.mjs";
import { extractWarmReferences, linkResolves } from "../../src/shared/boss/meetingPrep/prep.mjs";

const HERS = /(@westpeek\.ventures|@spry\.vc|seq\.taylor@gmail\.com|@time-2-read\.com|@rainmakersecurities\.com)$/i;

/** The people one sent email went to (To and Cc), minus her own addresses. Pure. */
export function recipientsOf(headers) {
  return [...new Set(headers.filter((h) => /^(to|cc)$/i.test(h.name)).flatMap((h) => String(h.value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((a) => a.toLowerCase()).filter((a) => !HERS.test(a)))];
}

/** `[{ email, line, url, sent_at, verified }]` from her sent mail since `sinceYmd`. */
export async function scanSent(sinceYmd, { fetchImpl = fetch } = {}) {
  const tok = await contentToken();
  const get = async (u) => { const r = await fetchImpl(u, { headers: { authorization: `Bearer ${tok}` } }); if (!r.ok) throw new Error(`Gmail answered ${r.status}`); return r.json(); };
  const q = `in:sent after:${sinceYmd.replace(/-/g, "/")} (http OR https)`;
  const ids = [];
  let page = null;
  do {
    const j = await get(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=200&q=${encodeURIComponent(q)}${page ? `&pageToken=${page}` : ""}`);
    ids.push(...(j.messages ?? []).map((m) => m.id));
    page = j.nextPageToken ?? null;
  } while (page && ids.length < 2000);
  const out = [];
  const checked = new Map();
  for (const id of ids) {
    const w = await messageWords(id, { quoted: false, token: tok });
    const refs = extractWarmReferences(w?.text ?? "");
    if (!refs.length) continue;
    const meta = await get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`);
    for (const r of refs) {
      if (!checked.has(r.url)) checked.set(r.url, await linkResolves(r.url, fetchImpl));
      for (const email of recipientsOf(meta.payload?.headers ?? [])) out.push({ email, line: r.line, url: r.url, sent_at: w.at, verified: checked.get(r.url), source: "sent_mail" });
    }
  }
  return { scanned: ids.length, rows: out };
}

async function main() {
  const i = process.argv.indexOf("--since");
  const since = i === -1 ? new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10) : process.argv[i + 1];
  const { bossApi } = await import("./lib/duty-kit.mjs");
  const api = await bossApi();
  const { scanned, rows } = await scanSent(since);
  const res = rows.length ? await api.post("/lp/references", { rows }) : { recorded: 0 };
  console.log(`warm-references: ${scanned} sent emails with a link since ${since}; ${rows.length} warm line(s) found, ${res.recorded} stored (${rows.filter((r) => !r.verified).length} with a link that did not answer).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`warm-references failed: ${e?.message ?? e}`); process.exit(1); });
}
