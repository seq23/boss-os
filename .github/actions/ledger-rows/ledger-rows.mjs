#!/usr/bin/env node
/**
 * H5: send a posting job's confirmed posts (its posted file's runs that carry a platform receipt) to the
 * Boss OS ledger. One shared caller for every posting repo, run as a composite action from boss-os main,
 * so the rows are built by the same ledgerRowsFrom that Monday's reconciliation reads with.
 * RULE 0, every outcome named: no token → [LEDGER_TOKEN_MISSING]; the file unreadable → [POSTED_UNREAD];
 * no confirmed post in 8 days → [NO_POSTS_TO_LEDGER]; Boss OS refusing or unreachable, or refusing a
 * row → [LEDGER_WRITE_FAILED]. Each exits 1. Success prints `OUTPUT: n rows sent (w new, d already there)`.
 */
import { readFile } from "node:fs/promises";
import { ledgerRowsFrom } from "../../../src/shared/boss/growth/ledger.mjs";

export async function sendLedgerRows(env = process.env, fetchImpl = fetch, now = Date.now()) {
  const business = String(env.LEDGER_BUSINESS ?? "").trim();
  const file = String(env.LEDGER_FILE ?? "").trim();
  const channel = String(env.LEDGER_CHANNEL ?? "").trim() || null;
  const token = String(env.LEDGER_TOKEN ?? "").trim();
  const origin = String(env.LEDGER_ORIGIN ?? "https://boss.sequoiataylor.com").replace(/\/+$/, "");
  if (!token) return { code: 1, line: "NAMED STOP [LEDGER_TOKEN_MISSING] the BOSS_OPEN_LOOPS_TOKEN secret is not set on this repo" };
  if (!business || !file) return { code: 1, line: "NAMED STOP [POSTED_UNREAD] the action needs business and file" };
  let doc;
  try { doc = JSON.parse(await readFile(file, "utf8")); } catch (e) {
    return { code: 1, line: `NAMED STOP [POSTED_UNREAD] ${file}: ${String(e?.message ?? e).slice(0, 120)}` };
  }
  const rows = ledgerRowsFrom(doc, { business, channel, now });
  if (!rows.length) return { code: 1, line: `NAMED STOP [NO_POSTS_TO_LEDGER] ${file} holds no post with a platform receipt in the last 8 days` };
  let sent = 0, written = 0, duplicate = 0;
  const refused = [];
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    let body;
    try {
      const res = await fetchImpl(`${origin}/api/boss/growth/noelle/ledger`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ rows: batch }),
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
