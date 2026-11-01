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
import path from "node:path";
import { bossApi } from "./lib/duty-kit.mjs";
import { ORIGIN, lpDecideItems, lpNudgeItems } from "../../src/shared/boss/lp/plan.mjs";
import { morningDir, writeMorningSection } from "../../src/shared/boss/mail/morning.mjs";

// The same override D's producers honour (tests and dry runs point it elsewhere); E's default otherwise.
const MORNING_DIR = process.env.BOSS_OS_MORNING_DIR ?? morningDir();

/** The morning section, per the shared interface: {decide, rows, lines}. Pure, so it is tested. */
export function lpMorning(rows, now = Date.now()) {
  const decide = [...lpDecideItems(rows, now), ...lpNudgeItems(rows, now)];
  // THE TRACKER, BY NAME (owner, 24 Oct 2026: "2 drafted, 5 sent, 1 they replied again" — name them).
  // The held replies and the ones who wrote back are decisions above; this line says who is where.
  const named = (s) => rows.filter((r) => r.status === s).map((r) => r.name || r.address);
  const groups = [
    ["waiting for your reply (in Decide above)", named("drafted")],
    ["wrote back after your reply (in Decide above)", named("replied_again")],
    ["not drafted yet", named("not_answered")],
    ["you replied", named("sent")],
    ["scheduled", named("scheduled")],
    ["skipped", named("skipped")],
  ].filter(([, list]) => list.length);
  const lines = groups.length
    ? [{ text: `LP replies: ${groups.map(([label, list]) => `${label}: ${list.join(", ")}`).join("; ")}.`, links: [{ label: "See every LP reply", url: `${ORIGIN}/?tab=capital&view=lp` }] }]
    : [];
  return {
    section: "lp",
    updated_at: new Date(now).toISOString(),
    decide,
    // No rows: the tracker itself is the LP replies tab on the Deals page (D1), never re-sent by mail.
    rows: [],
    lines,
  };
}

/**
 * Every L section goes through Builder E's ONE writer (src/shared/boss/mail/morning.mjs): the shape
 * Simone's 06:40 email reads, checked before it is written. Returns the file written.
 */
export function writeMorning(section, obj) {
  writeMorningSection(section, obj, { dir: MORNING_DIR });
  return path.join(MORNING_DIR, `${section}.json`);
}

async function main() {
  const dry = process.argv.includes("--dry");
  const api = await bossApi();
  // Bounces first, before any system sends from the mailbox today (Twin ~07:30, Monique 09:30):
  // a hard-bounced address goes on Twin's Reply Queue and Boss OS suppression (lp-bounces.mjs).
  try {
    const { syncBounces } = await import("./lp-bounces.mjs");
    await syncBounces({ days: Number(process.env.LP_BOUNCE_DAYS ?? 7), commit: !dry, api });
  } catch (e) { console.log(`note: ${e.message}`); }
  const prior = await api.get("/lp/replies");
  const skipped = new Set((prior.rows ?? []).filter((r) => r.status === "skipped").map((r) => r.address));
  const { refreshPositive } = await import("./lp-positive.mjs");
  const { people, seenAddresses } = await refreshPositive();
  // Every reply and opt-out on the drip's Reply Queue before its ~07:30 run (1 Nov 2026): a call-ask
  // read on Friday was otherwise only queued by Tuesday's lp-outcomes, and got the final email Sunday.
  // A failure here is loud in the log and never blocks the held replies below.
  try {
    const { syncReplies } = await import("./lp-bounces.mjs");
    await syncReplies({ seenAddresses, people, commit: !dry });
  } catch (e) { console.log(`note: ${e.message}`); }
  if (dry) {
    console.log(`DRY RUN: ${people.length} positive replies on the list; ${skipped.size} skipped in Boss OS. No draft written, nothing posted.`);
    return;
  }
  const { followUps } = await import("./lp-followups.mjs");
  // Where she is (Boss OS's "where I am until") and the times each LP was last offered: the held reply
  // offers times in her zone that day, and a pick of one of them becomes a one-tap confirmation + invite.
  const offered = Object.fromEntries((prior.rows ?? []).filter((r) => r.offered_slots).map((r) => [r.address, r.offered_slots]));
  const { rows, stops } = await followUps(people, { skipped, where: prior.where ?? null, offered });
  const after = await api.post("/lp/replies", { rows });
  const file = writeMorning("lp", lpMorning(after.rows ?? []));
  for (const s of stops) console.log(`note: ${s}`);
  console.log(`LP-DAILY-COMPLETE: ${rows.length} on the tracker; morning section at ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`LP-DAILY FAILED: ${err?.message ?? err}`); process.exit(1); });
}
