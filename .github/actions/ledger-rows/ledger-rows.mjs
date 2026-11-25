#!/usr/bin/env node
/**
 * H5: send a posting job's confirmed posts (its posted file's runs that carry a platform receipt) to the
 * Boss OS ledger. One shared caller for every posting repo, run as a composite action from boss-os main,
 * so the rows are built by the same ledgerRowsFrom that Monday's reconciliation reads with.
 * A Pinterest path has no posted file: `feed` is the account's Pinterest profile feed, whose pins are the receipt.
 * RULE 0, every outcome named: no token → [LEDGER_TOKEN_MISSING]; the file or feed unreadable → [POSTED_UNREAD];
 * no confirmed post in 8 days → [NO_POSTS_TO_LEDGER]; Boss OS refusing or unreachable, or refusing a
 * row → [LEDGER_WRITE_FAILED]. Each exits 1. Success prints `OUTPUT: n rows sent (w new, d already there)`.
 */
import { readFile } from "node:fs/promises";
import { ledgerRowsFrom } from "../../../src/shared/boss/growth/ledger.mjs";

/** A Pinterest profile feed: the platform's own list of the pins it took (the receipt for an RSS-fed board). */
export const PIN_FEED = /^https:\/\/www\.pinterest\.com\/[A-Za-z0-9_]{1,30}\/feed\.rss$/;

export async function sendLedgerRows(env = process.env, fetchImpl = fetch, now = Date.now()) {
  const business = String(env.LEDGER_BUSINESS ?? "").trim();
  const file = String(env.LEDGER_FILE ?? "").trim();
  const channel = String(env.LEDGER_CHANNEL ?? "").trim() || null;
  const token = String(env.LEDGER_TOKEN ?? "").trim();
  const origin = String(env.LEDGER_ORIGIN ?? "https://boss.sequoiataylor.com").replace(/\/+$/, "");
  if (!token) return { code: 1, line: "NAMED STOP [LEDGER_TOKEN_MISSING] the BOSS_OPEN_LOOPS_TOKEN secret is not set on this repo" };
  const feed = String(env.LEDGER_FEED ?? "").trim();
  if (!business || (!file && !feed) || (file && feed)) return { code: 1, line: "NAMED STOP [POSTED_UNREAD] the action needs business and one of file or feed" };
  if (feed && !PIN_FEED.test(feed)) return { code: 1, line: `NAMED STOP [POSTED_UNREAD] ${feed.slice(0, 120)} is not a Pinterest profile feed (https://www.pinterest.com/<account>/feed.rss)` };
  const source = file || feed;
  let doc;
  try {
    if (file) doc = JSON.parse(await readFile(file, "utf8"));
    else {
      const res = await fetchImpl(feed, { redirect: "error", signal: AbortSignal.timeout(20_000), headers: { accept: "application/rss+xml" } });
      if (!res.ok) return { code: 1, line: `NAMED STOP [POSTED_UNREAD] ${feed}: Pinterest answered ${res.status}` };
      doc = await res.text();
      if (!/<rss\b/i.test(doc) || !/<channel\b/i.test(doc)) {
        return { code: 1, line: "NAMED STOP [POSTED_UNREAD] Pinterest did not return a profile RSS feed" };
      }
    }
  } catch (e) {
    return { code: 1, line: `NAMED STOP [POSTED_UNREAD] ${source}: ${String(e?.message ?? e).slice(0, 120)}` };
  }
  const rows = ledgerRowsFrom(doc, { business, channel: feed ? "pinterest" : channel, now });
  if (!rows.length) return { code: 1, line: `NAMED STOP [NO_POSTS_TO_LEDGER] ${source} holds no post with a platform receipt in the last 8 days` };
  let sent = 0, written = 0, duplicate = 0;
  const refused = [];
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    let body;
    try {
      const res = await fetchImpl(`${origin}/api/boss/growth/noelle/ledger`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ rows: batch }),
      });
      body = await res.json().catch(() => null);
      if (!res.ok) return { code: 1, line: `NAMED STOP [LEDGER_WRITE_FAILED] Boss OS answered ${res.status}; ${sent} of ${rows.length} rows sent` };
    } catch (e) {
      return { code: 1, line: `NAMED STOP [LEDGER_WRITE_FAILED] ${String(e?.message ?? e).slice(0, 120)}; ${sent} of ${rows.length} rows sent` };
    }
    const d = body?.data ?? body ?? {};
    if (typeof d.written !== "number" || typeof d.duplicate !== "number") return { code: 1, line: `NAMED STOP [LEDGER_WRITE_FAILED] Boss OS gave no counts; ${sent} of ${rows.length} rows sent` };
    sent += batch.length; written += d.written; duplicate += d.duplicate;
    refused.push(...(Array.isArray(d.refused) ? d.refused : []));
  }
  if (refused.length) return { code: 1, line: `NAMED STOP [LEDGER_WRITE_FAILED] ${refused.length} rows refused (${refused.slice(0, 3).join(", ")}); ${written} new, ${duplicate} already there` };
  return { code: 0, line: `OUTPUT: ${sent} rows sent (${written} new, ${duplicate} already there)` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await sendLedgerRows();
  console.log(r.line);
  process.exit(r.code);
}
