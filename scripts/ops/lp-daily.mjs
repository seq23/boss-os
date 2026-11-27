#!/usr/bin/env node
/**
 * MONIQUE'S MORNING LP RUN — every positive LP reply has a reply held in its own thread, and the
 * morning email carries one tap to send it (owner, 23 Oct 2026, ruling 10; Boss fix L).
 *
 *   06:15 Central, duty_lp_daily, before Simone's 06:40 morning email reads ~/.boss-os/morning/lp.json.
 *
 * 1. Read sequoia@westpeek.ventures through the delegation (lp-positive.mjs → refreshPositive): every
 *    reply since July is read with its whole thread; the interested replies are kept.
 * 2. For each: already answered by her (sent mail)? replied again? passed or skipped? Otherwise one
 *    reply held as a draft in their thread (lp-followups.mjs → followUps). Nothing is sent here.
 * 3. Post the tracker rows to Boss OS (names stay in D1, never a log) and get back each row's tap token.
 * 4. Write morning/lp.json: Decide items (Send as is / Edit, then send / Skip), unsent ≥2 days first.
 *
 * REPLACES lp-replies.sh, which read this mailbox through the claude.ai Gmail connector — bound to
 * her PERSONAL account — and reported "A=0" every morning while 50+ messages arrived (23 Oct 2026).
 *
 * The free reader decides what the message says. The held answer uses the fixed LP template.
 *
 *   npm run lp:daily            (through the vault: BOSS_PASSCODE + GSC_SERVICE_ACCOUNT_JSON)
 *   npm run lp:daily -- --dry   (reads and drafts nothing; prints counts and the morning file only)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bossApi } from "./lib/duty-kit.mjs";
import { callFor, callLine, CALENDAR_UNREAD_STOP, isAssistant } from "../../src/shared/boss/lp/callBooked.mjs";
import { ORIGIN, lpDecideItems, lpNudgeItems } from "../../src/shared/boss/lp/plan.mjs";
import { morningDir, writeMorningSection } from "../../src/shared/boss/mail/morning.mjs";

// The same override D's producers honour (tests and dry runs point it elsewhere); E's default otherwise.
const MORNING_DIR = process.env.BOSS_OS_MORNING_DIR ?? morningDir();

const LP_DIR = process.env.BOSS_OS_LP_DIR ?? path.join(os.homedir(), ".boss-os", "lp");

/** Address → { start, held } for everyone on the positive list with a call on her calendar. Pure. */
export function bookedCalls(people, events, now = Date.now()) {
  const out = new Map();
  for (const p of people ?? []) {
    const c = callFor(p.address, events, now, { assistant: isAssistant(`${p.said ?? ""} ${p.quote ?? ""}`) });
    if (c) out.set(p.address, c);
  }
  return out;
}

/** Bucket names refreshPositive gives a real human reply (anything but a drop reason or an autoresponder). */
const HUMAN_REPLY = new Set(["call", "warm", "departed", "negative", "other"]);

/**
 * NEVER ANOTHER OUTREACH EMAIL (owner, 15 Nov 2026). Everyone who wrote back at all, and everyone with
 * a call on her calendar, by the reason Boss OS keeps. Pure.
 */
export function doNotContact({ seenAddresses = new Map(), people = [], calls = new Map() } = {}) {
  const call_booked = [...calls.keys()].map((a) => String(a).toLowerCase());
  const booked = new Set(call_booked);
  const replied = new Set();
  for (const [a, v] of seenAddresses) if (HUMAN_REPLY.has(v?.bucket)) replied.add(String(a).toLowerCase());
  for (const p of people) if (p?.address) replied.add(String(p.address).toLowerCase());
  return { call_booked, replied: [...replied].filter((a) => !booked.has(a)) };
}

/** The morning section, per the shared interface: {decide, rows, lines}. Pure, so it is tested. */
export function lpMorning(rows, now = Date.now(), { stops = [] } = {}) {
  rows = rows.filter((r) => !r.quiet);
  // A call on her calendar (owner, 15 Nov 2026): one line each, "Name — Call booked: Mon 16 Nov, 12:00 PM CT".
  const isCall = (r) => r.status === "scheduled" && Number(r.picked_start) > 0;
  /*
   * A CALL IS NEWS ONCE BOOKED AND ONCE HELD, NEVER A WEEK LATER (23 Nov 2026 live read: "an LP
   * — Call held: Mon 16 Nov" in Done for you seven days on: the line's words changed from booked to
   * held, so it was new to the told-once list). Booked: any time before it. Held: the day after only.
   */
  const callLines = rows.filter((r) => isCall(r) && Number(r.picked_start) >= now - 36 * 3_600_000).sort((a, b) => Number(a.picked_start) - Number(b.picked_start))
    .map((r) => ({ text: `${r.name || r.address} — ${callLine(Number(r.picked_start), now)}.` }));
  rows = rows.filter((r) => !isCall(r));
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
    // The calendar could not be read: said first, never a silent old list.
    lines: [...stops.map((text) => ({ text })), ...callLines, ...lines],
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
  const { refreshPositive, LP_READS_PER_RUN } = await import("./lp-positive.mjs");
  const { people, seenAddresses, status, heldNow, counts } = await refreshPositive();
  // Every reply and opt-out on the drip's Reply Queue before its ~07:30 run (1 Nov 2026): a call-ask
  // read on Friday was otherwise only queued by Tuesday's lp-outcomes, and got the final email Sunday.
  // A failed queue write remains a named stop for the existing duty.
  try {
    const { syncReplies } = await import("./lp-bounces.mjs");
    if (people.length || [...seenAddresses.values()].some(({ bucket }) => bucket !== "auto")) {
      await syncReplies({ seenAddresses, people, commit: !dry });
    }
  } catch (e) { if (!dry) throw e; console.log(`note: ${e.message}`); }
  /*
   * A PARTIAL READ NO LONGER STOPS EVERY DRAFT (27 Nov 2026, review F6 of #583). The first run met a
   * backlog of 1,333 unread messages; reading them all at the free per-minute limit would hold every
   * draft for days. Now the read is capped per run (newest first), drafts go to everyone whose replies
   * are all read, and a sender with any unread or held reply gets nothing until it is read. The run
   * still ends on the named stop below, after the drafts, so the gap is never a pass.
   */
  const waiting = new Set([...seenAddresses].filter(([, value]) => value?.bucket === "unread").map(([address]) => address));
  if (heldNow?.length && !dry) {
    const { nameLpHeld } = await import("./lp-positive.mjs");
    await nameLpHeld(heldNow);
  }
  const unreadStop = status === "complete" ? null
    : `NAMED STOP [LP_REPLY_UNREAD] ${status}; ${counts?.unread ?? waiting.size} LP message(s) not read yet, so ${waiting.size} sender(s) get no draft until they are; the rest were drafted and unread replies will retry.`;
  const api = await bossApi();
  // Bounces first, before any system sends from the mailbox today (Twin ~07:30, Monique 09:30):
  // a hard-bounced address goes on Twin's Reply Queue and Boss OS suppression (lp-bounces.mjs).
  try {
    const { syncBounces } = await import("./lp-bounces.mjs");
    await syncBounces({ days: Number(process.env.LP_BOUNCE_DAYS ?? 7), commit: !dry, api });
  } catch (e) { console.log(`note: ${e.message}`); }
  const prior = await api.get("/lp/replies");
  const skipped = new Set((prior.rows ?? []).filter((r) => r.status === "skipped").map((r) => r.address));
  // Calls on her West Peek calendar, past and upcoming (owner, 15 Nov 2026). Unreadable → a NAMED STOP line.
  const now = Date.now();
  let calls = new Map();
  const stops = [];
  try {
    const { herEvents } = await import("./lp-booked-calls.mjs");
    calls = bookedCalls(people, await herEvents(JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null"), { now }), now);
  } catch (e) {
    stops.push(CALENDAR_UNREAD_STOP(e?.message ?? e));
    console.error(stops[0]);
  }
  const held = [...calls.values()].filter((c) => c.held).length;
  console.log(`calls on her calendar: ${calls.size - held} booked, ${held} held (counts only).`);

  // Everyone who wrote back, and everyone with a call, on the lists every LP and prospect sender reads:
  // Boss OS suppression (the prospect desk, lp-prospects.mjs) and suppress.txt (lp8-drip.mjs).
  const dnc = doNotContact({ seenAddresses, people, calls });
  const suppressPath = path.join(LP_DIR, "suppress.txt");
  const listed = new Set(fs.existsSync(suppressPath) ? fs.readFileSync(suppressPath, "utf8").split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean) : []);
  const local = [...dnc.call_booked, ...dnc.replied].filter((a) => !listed.has(a));
  if (dry) {
    console.log(`DRY RUN: would suppress ${dnc.call_booked.length} with a call and ${dnc.replied.length} who replied in Boss OS, and add ${local.length} to suppress.txt.`);
  } else {
    let added = 0;
    for (const [reason, emails] of [["call_booked", dnc.call_booked], ["replied", dnc.replied]]) {
      if (emails.length) added += (await api.post("/lp/prospects/suppress", { emails, reason })).added ?? 0;
    }
    if (local.length) { fs.mkdirSync(LP_DIR, { recursive: true }); fs.appendFileSync(suppressPath, `${local.join("\n")}\n`, { mode: 0o600 }); }
    console.log(`do-not-contact: ${added} newly suppressed in Boss OS, ${local.length} added to suppress.txt.`);
  }

  if (dry) {
    // The preview stays on her Mac (names); the console prints counts only.
    const preview = lpMorning(people.map((p) => ({ ...p, ...(calls.has(p.address) ? { status: "scheduled", picked_start: calls.get(p.address).start } : { status: "not_answered" }) })), now, { stops });
    const file = path.join(LP_DIR, "positive-preview.txt");
    fs.mkdirSync(LP_DIR, { recursive: true });
    fs.writeFileSync(file, `${preview.lines.map((l) => l.text).join("\n")}\n`, { mode: 0o600 });
    console.log(`DRY RUN: ${people.length} positive replies on the list; ${calls.size} with a call; ${skipped.size} skipped in Boss OS. Preview at ${file}. No draft written, nothing posted.`);
    return;
  }
  const { followUps } = await import("./lp-followups.mjs");
  // Where she is (Boss OS's "where I am until") and the times each LP was last offered: the held reply
  // offers times in her zone that day, and a pick of one of them becomes a one-tap confirmation + invite.
  const offered = Object.fromEntries((prior.rows ?? []).filter((r) => r.offered_slots).map((r) => [r.address, r.offered_slots]));
  const fu = await followUps(people, { skipped, where: prior.where ?? null, offered, calls, unread: waiting });
  const rows = fu.rows;
  const after = await api.post("/lp/replies", { rows });
  if (unreadStop) stops.push(`${waiting.size} LP sender(s) wait for Monique to read their replies (the free allowance reads up to ${LP_READS_PER_RUN} a morning, newest first); they get no draft and no drip until then.`);
  const file = writeMorning("lp", lpMorning(after.rows ?? [], Date.now(), { stops }));
  for (const s of fu.stops) console.log(`note: ${s}`);
  console.log(`LP-DAILY-${unreadStop ? "PARTIAL" : "COMPLETE"}: ${rows.length} on the tracker; morning section at ${file}`);
  // The census duty-run.sh records as what this run produced (`OUTPUT <n> <metric>`).
  console.log(`OUTPUT ${rows.length} LP replies on the tracker`);
  if (unreadStop) throw new Error(unreadStop);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`LP-DAILY FAILED: ${err?.message ?? err}`); process.exit(1); });
}
