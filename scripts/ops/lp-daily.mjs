#!/usr/bin/env node
/**
 * MONIQUE'S MORNING LP RUN — every positive LP reply has a reply held in its own thread, and the
 * morning email carries one tap to send it (owner, 23 Oct 2026, ruling 10; Boss fix L).
 *
 *   06:15 Central, duty_lp_daily, before Simone's 06:40 morning email reads ~/.boss-os/morning/lp.json.
 *
 * 1. Read sequoia@westpeek.ventures through the delegation (lp-positive.mjs → refreshPositive): every
 *    reply to the outreach since July, screened, the positive ones kept. The first run IS the backfill.
 * 2. For each: already answered by her (sent mail)? replied again? passed or skipped? Otherwise one
 *    reply held as a draft in their thread (lp-followups.mjs → followUps). Nothing is sent here.
 * 3. Post the tracker rows to Boss OS (names stay in D1, never a log) and get back each row's tap token.
 * 4. Write morning/lp.json: Decide items (Send as is / Edit, then send / Skip), unsent ≥2 days first.
 *
 * REPLACES lp-replies.sh, which read this mailbox through the claude.ai Gmail connector — bound to
 * her PERSONAL account — and reported "A=0" every morning while 50+ messages arrived (23 Oct 2026).
 *
 * LP names never reach a model: the reply is a fixed template (plan.mjs lpReplyBody).
 *
 *   npm run lp:daily            (through the vault: BOSS_PASSCODE + GSC_SERVICE_ACCOUNT_JSON)
 *   npm run lp:daily -- --dry   (reads and drafts nothing; prints counts and the morning file only)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bossApi } from "./lib/duty-kit.mjs";
import { LP_STATUS_LABEL, lpDecideItems } from "../../src/shared/boss/lp/plan.mjs";

const MORNING_DIR = process.env.BOSS_OS_MORNING_DIR ?? path.join(os.homedir(), ".boss-os", "morning");

/** The morning section, per the shared interface: {decide, rows, lines}. Pure, so it is tested. */
export function lpMorning(rows, now = Date.now()) {
  const decide = lpDecideItems(rows, now);
  const count = (s) => rows.filter((r) => r.status === s).length;
  const lines = [];
  const again = rows.filter((r) => r.status === "replied_again");
  for (const r of again.slice(0, 3)) lines.push(`${r.name || "An LP"} wrote back after your reply. Open the thread in Gmail.`);
  const tally = Object.keys(LP_STATUS_LABEL).map((s) => [LP_STATUS_LABEL[s], count(s)]).filter(([, n]) => n > 0);
  if (tally.length) lines.push(`LP tracker: ${tally.map(([l, n]) => `${n} ${l.toLowerCase()}`).join(", ")}.`);
  return {
    section: "lp",
    updated_at: new Date(now).toISOString(),
    decide,
    rows: rows.map((r) => ({ name: r.name, firm: r.firm, status: LP_STATUS_LABEL[r.status] ?? r.status, since: r.first_seen })),
    lines,
  };
}

export function writeMorning(section, obj) {
  fs.mkdirSync(MORNING_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(MORNING_DIR, `${section}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  return file;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const api = await bossApi();
  const prior = await api.get("/lp/replies");
  const skipped = new Set((prior.rows ?? []).filter((r) => r.status === "skipped").map((r) => r.address));
  const { refreshPositive } = await import("./lp-positive.mjs");
  const { people } = await refreshPositive();
  if (dry) {
    console.log(`DRY RUN: ${people.length} positive replies on the list; ${skipped.size} skipped in Boss OS. No draft written, nothing posted.`);
    return;
  }
  const { followUps } = await import("./lp-followups.mjs");
  const { rows, stops } = await followUps(people, { skipped });
  const after = await api.post("/lp/replies", { rows });
  const file = writeMorning("lp", lpMorning(after.rows ?? []));
  for (const s of stops) console.log(`note: ${s}`);
  console.log(`LP-DAILY-COMPLETE: ${rows.length} on the tracker; morning section at ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`LP-DAILY FAILED: ${err?.message ?? err}`); process.exit(1); });
}
