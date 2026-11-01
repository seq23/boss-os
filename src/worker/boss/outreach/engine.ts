/**
 * MONIQUE'S OUTREACH, ONE TICK. Runs on every hourly cron tick, in this order:
 *
 *   1. REPLIES FIRST, ALWAYS — even with the kill switch on. An unsubscribe is honoured on the next
 *      tick no matter what else is switched off.
 *   2. BRAKES: per business, a bounce rate over 3% or any complaint in 14 days pauses it.
 *   3. ROUTES: a business whose sending address appears in the mailbox's send-as list is proven
 *      with one email to the test recipient, then marked ready. Nothing else sends before that.
 *   4. SENDS: within the cap, the window, the flag and the kill switch. A business with an exclusive
 *      seat reads the site's public seat JSON first (short timeout, last value on failure) and
 *      picks its pitch from it; its seat holder is never written to.
 *   5. LISTS: a business's own licensed directory once a day, one public-listing slice and a few
 *      website reads, while a business is short of prospects.
 *   6. PAYOUTS: on the 1st (Chicago), last month's referral ledger.
 *
 * Every refusal is recorded with its reason. A tick that did nothing says why.
 *
 * A ROUTE-READY BUSINESS THAT SENDS NOTHING IS A NAMED STOP, NOT A QUIET SKIP (16 Oct 2026). Memphis
 * Senior Care Homes joined the catalog route-proven but with no postal address, and the tick refused
 * it every hour for two days with nobody told. So: a business with no address inherits the one every
 * other business shares (`effectivePostalAddress`), and a route-ready business refused inside the
 * sending window for a missing precondition writes `stop_reason` on its row, which Today shows her
 * (`outreachStopAlerts`) until a tick sends for it or the cause is fixed. A deliberate hold — the kill
 * switch, sending off or test-only, a bounce or complaint pause, today's cap reached — is not a stop.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { BUSINESSES, MAX_FOLLOW_UPS, TEST_RECIPIENTS, businessByKey, outreachStateBlock, type Business } from "./catalog";
import {
  BOUNCE_WINDOW_MS, DAY_MS, chicagoParts, dailyCap, inSendWindow, pauseReason, refusal, sendsThisTick, type Sending,
} from "./brakes";
import { bouncedAddress, classifyReply, ownWords, type ReplyClass } from "./classify";
import { composeEmail, signatureFor } from "./compose";
import { mailAuthRefusal } from "./mailauth";
import { GmailSession, addressOf } from "./gmail";
import { crawlCandidates, randomToken, readDirectories, readNextSlice } from "./lists";
import { isSuppressed, suppress } from "./suppression";
import { fixBounces, recordBounce, recordRestart } from "./bounceFix";
import { ensurePartner, runMonthlyPayouts } from "./referrals";
import { SEAT_OPEN, isSeatHolder, pitchFor, readSeat, type Seat } from "./seat";
import { feedScoreboard, groupSendGate, queueReady, summary as groupSummary } from "./groups";
import { GROUPS_KEY, groupSizeIn, suggestedPrice, wantsPrice } from "../../../shared/boss/t2rGroups/rules.mjs";

export interface OutreachSettings {
  killSwitch: boolean;
  sending: Sending;
}

export async function readSettings(db: D1Database): Promise<OutreachSettings> {
  const rows = await db.prepare(`SELECT key, value FROM outreach_settings`).all<{ key: string; value: string }>();
  const m = Object.fromEntries((rows.results ?? []).map((r) => [r.key, r.value]));
  const sending = (["off", "test_only", "live"] as const).includes(m.sending as Sending) ? (m.sending as Sending) : "off";
  // A missing or unreadable kill switch reads as ON. The safe state is never a fallback's accident.
  return { killSwitch: m.kill_switch !== "off", sending };
}

export async function domainState(db: D1Database, key: string, now: number): Promise<any> {
  await db.prepare(
    `INSERT INTO outreach_domain_state (business_key, updated_at) VALUES (?, ?) ON CONFLICT(business_key) DO NOTHING`,
  ).bind(key, now).run();
  return db.prepare(`SELECT * FROM outreach_domain_state WHERE business_key = ?`).bind(key).first<any>();
}

export async function healthOf(db: D1Database, key: string, now: number) {
  const r = await db.prepare(
    `SELECT COUNT(*) AS sent,
            SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
            SUM(CASE WHEN status = 'complaint' THEN 1 ELSE 0 END) AS complaints
       FROM outreach_sends WHERE business_key = ? AND is_test = 0 AND status != 'failed' AND sent_at >= ?`,
  ).bind(key, now - BOUNCE_WINDOW_MS).first<any>();
  return { sent: r?.sent ?? 0, bounced: r?.bounced ?? 0, complaints: r?.complaints ?? 0 };
}

export async function sentToday(db: D1Database, key: string, now: number): Promise<number> {
  const today = chicagoParts(now).day;
  const r = await db.prepare(
    `SELECT sent_at FROM outreach_sends WHERE business_key = ? AND is_test = 0 AND status != 'failed' AND sent_at >= ?`,
  ).bind(key, now - 2 * DAY_MS).all<{ sent_at: number }>();
  return (r.results ?? []).filter((x) => chicagoParts(x.sent_at).day === today).length;
}

export interface TickResult {
  replies: number;
  paused: string[];
  routesProven: string[];
  sent: number;
  refused: Record<string, string>;
  lists: { slice: string | null; crawled: number; admitted: number; directories?: { read: string[]; prospects: number; candidates: number } };
  payouts: unknown;
  stop?: string;
  /** NAMED STOPs this tick: a route-ready business refused in the sending window for a missing precondition. */
  stops: Record<string, string>;
  /** The bounce agent this tick (bounceFix.ts): replacements found and bounced addresses dropped. */
  bounceFixes?: { replaced: number; dropped: number };
  /** Time-2-Read groups made ready for the engine this tick (groups.ts). */
  groupsQueued?: number;
  /** Queued prospects taken out this tick because their state is one the business never writes to. */
  stateBlocked?: number;
}

export const NAMED_STOP_PREFIX = "NAMED STOP";

/** The words she reads on Today for a business that is route-ready and sent nothing. */
export function outreachStopText(b: Business, reason: string): string {
  const fix = /postal address/i.test(reason)
    ? ` Set the CAN-SPAM address on Team → Outreach (PUT /api/boss/outreach/business/${b.key}).`
    : "";
  return `${NAMED_STOP_PREFIX}: ${b.brand} outreach is route-ready but sent nothing in the sending window: ${reason}${fix}`;
}

/**
 * THE ADDRESS A BUSINESS SENDS WITH. Its own when set; otherwise the one address every other business
 * shares, read from their rows (never from source: the address is private runtime data). Two
 * different addresses on the other rows is ambiguous, so nothing is inherited and the business stops.
 */
export async function effectivePostalAddress(db: D1Database, key: string, own: string | null | undefined): Promise<{ address: string | null; inherited: boolean }> {
  if (own && String(own).trim().length >= 10) return { address: String(own).trim(), inherited: false };
  const r = await db.prepare(
    `SELECT DISTINCT TRIM(postal_address) AS a FROM outreach_domain_state
      WHERE business_key != ? AND postal_address IS NOT NULL AND LENGTH(TRIM(postal_address)) >= 10 LIMIT 2`,
  ).bind(key).all<{ a: string }>();
  const found = r.results ?? [];
  return found.length === 1 ? { address: found[0]!.a, inherited: true } : { address: null, inherited: false };
}

async function setStop(db: D1Database, b: Business, reason: string | null, now: number) {
  if (reason === null) {
    await db.prepare(`UPDATE outreach_domain_state SET stop_reason = NULL, stop_at = NULL WHERE business_key = ? AND stop_at IS NOT NULL`).bind(b.key).run();
    return;
  }
  await db.prepare(
    `UPDATE outreach_domain_state SET stop_reason = ?, stop_at = COALESCE(stop_at, ?), updated_at = ? WHERE business_key = ?`,
  ).bind(reason, now, now, b.key).run();
  await logEvent(db, { level: "warn", scope: "outreach", event: "named_stop", entityId: b.key, detail: { reason } }).catch(() => {});
}

export async function runOutreachTick(env: Env, now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<TickResult> {
  const db = env.DB;
  const out: TickResult = { replies: 0, paused: [], routesProven: [], sent: 0, refused: {}, stops: {}, lists: { slice: null, crawled: 0, admitted: 0 }, payouts: null };
  const settings = await readSettings(db);
  const mailbox = GmailSession.from(env, fetchImpl);

  if (!mailbox) {
    out.stop = "NAMED STOP: the Worker holds no Google key (GSC_SERVICE_ACCOUNT_JSON), so outreach can neither read replies nor send.";
  } else {
    try {
      out.replies = await processReplies(env, mailbox, now);
    } catch (err) {
      out.refused.replies = (err as Error).message;
    }
  }
  // The bounce agent (rule 4, 23 Oct 2026): a working replacement for each bounced address, same day.
  try {
    out.bounceFixes = await fixBounces(db, fetchImpl, now);
  } catch (err) {
    out.refused.bounceFixes = (err as Error).message;
  }

  for (const b of BUSINESSES) {
    const st = await domainState(db, b.key, now);
    const reason = pauseReason(await healthOf(db, b.key, now));
    if (reason && !st.paused_at) {
      await db.prepare(`UPDATE outreach_domain_state SET paused_at = ?, pause_reason = ?, updated_at = ? WHERE business_key = ?`)
        .bind(now, reason, now, b.key).run();
      out.paused.push(b.key);
      await logEvent(db, { level: "warn", scope: "outreach", event: "domain_paused", entityId: b.key, detail: { reason } }).catch(() => {});
    }
    if (!reason && st.paused_at && /^Paused automatically: (bounce rate|\d+ bounces)/.test(st.pause_reason ?? "")) {
      // A bounce pause is a verdict on a 14-day window; when the window no longer supports it the
      // pause lifts itself. A complaint pause is never lifted here.
      await db.prepare(`UPDATE outreach_domain_state SET paused_at = NULL, pause_reason = NULL, updated_at = ? WHERE business_key = ?`)
        .bind(now, b.key).run();
      st.paused_at = null; st.pause_reason = null;
      await recordRestart(db, b.key, now).catch(() => {});
    }
  }

  // Prospects already queued in a state a business may never write to leave the queue, each logged.
  try {
    out.stateBlocked = await dropStateBlocked(db, now);
  } catch (err) {
    out.refused.stateBlocked = (err as Error).message;
  }

  // Time-2-Read groups whose address and code are ready become prospects (groups.ts). Idempotent.
  try {
    out.groupsQueued = await queueReady(db, now);
  } catch (err) {
    out.refused.groups = (err as Error).message;
  }

  if (mailbox && !settings.killSwitch && settings.sending !== "off") {
    try {
      out.routesProven = await proveRoutes(env, mailbox, now);
    } catch (err) {
      out.refused.routes = (err as Error).message;
    }
    for (const b of BUSINESSES) {
      let r: SendOutcome;
      try {
        r = await sendForBusiness(env, mailbox, b, settings, now, out.refused, fetchImpl);
      } catch (err) {
        out.refused[b.key] = (err as Error).message;
        r = { sent: 0, stop: (err as Error).message };
      }
      out.sent += r.sent;
      // Outside the window nothing is expected to send, so a stop is neither raised nor cleared there.
      if (r.sent > 0 || (r.stop === null && inSendWindow(now))) await setStop(db, b, null, now);
      else if (r.stop && inSendWindow(now)) {
        const st = await domainState(db, b.key, now);
        if (routeReadyFor(b, st)) {
          out.stops[b.key] = outreachStopText(b, r.stop);
          await setStop(db, b, r.stop, now);
        }
      }
    }
  } else if (settings.killSwitch) {
    out.refused.all = "The global kill switch is on.";
  } else if (settings.sending === "off") {
    out.refused.all = "Sending is off.";
  }

  try {
    const dir = await readDirectories(db, fetchImpl, now);
    out.lists.directories = { read: dir.read, prospects: dir.prospects, candidates: dir.candidates };
  } catch (err) {
    out.refused.directories = (err as Error).message;
  }
  try {
    const short = await businessesShortOfProspects(db);
    if (short.length) {
      const slice = await readNextSlice(db, fetchImpl, now, short);
      out.lists.slice = slice?.slice ?? null;
    }
    const crawl = await crawlCandidates(db, fetchImpl, now);
    out.lists.crawled = crawl.crawled;
    out.lists.admitted = crawl.admitted;
  } catch (err) {
    out.refused.lists = (err as Error).message;
  }

  try {
    out.payouts = await runMonthlyPayouts(env, now);
  } catch (err) {
    out.refused.payouts = (err as Error).message;
  }
  // The time-2-read scoreboard rows, fed from the groups duty; a revision only when a number moved.
  try {
    await feedScoreboard(env, now);
  } catch (err) {
    out.refused.scoreboard = (err as Error).message;
  }

  await logEvent(db, { level: "info", scope: "outreach", event: "tick", detail: out }).catch(() => {});
  return out;
}

/**
 * Takes every queued prospect (new or mid-sequence) in a state its business may never write to
 * (catalog.ts `outreachStateBlock`) out of the queue, logging the reason for each. Idempotent.
 */
export async function dropStateBlocked(db: D1Database, now: number): Promise<number> {
  let dropped = 0;
  for (const b of BUSINESSES) {
    if (!b.noOutreachStates) continue;
    const rows = await db.prepare(
      `SELECT id, metro FROM outreach_prospects WHERE business_key = ? AND state IN ('new','in_sequence')`,
    ).bind(b.key).all<any>();
    for (const p of rows.results ?? []) {
      const reason = outreachStateBlock(b, p.metro);
      if (!reason) continue;
      await dropProspect(db, b, p.id, reason, now);
      dropped += 1;
    }
  }
  return dropped;
}

async function dropProspect(db: D1Database, b: Business, id: string, reason: string, now: number) {
  await db.prepare(`UPDATE outreach_prospects SET state = 'done', next_due_at = NULL, updated_at = ? WHERE id = ?`).bind(now, id).run();
  await logEvent(db, { level: "info", scope: "outreach", event: "prospect_state_blocked", entityId: id, detail: { business: b.key, reason } }).catch(() => {});
}

/** Businesses with fewer than a week of prospects waiting at the top of the ramp. */
async function businessesShortOfProspects(db: D1Database): Promise<string[]> {
  const r = await db.prepare(
    `SELECT business_key, COUNT(*) AS n FROM outreach_prospects WHERE state = 'new' GROUP BY business_key`,
  ).all<{ business_key: string; n: number }>();
  const have = new Map((r.results ?? []).map((x) => [x.business_key, x.n]));
  // A business with no public-listing segments (Time-2-Read groups: researched on the Mac) reads none.
  return BUSINESSES.filter((b) => b.segments.length > 0 && (have.get(b.key) ?? 0) < 50).map((b) => b.key);
}

/** A business's route is ready only when it was proven for the sender it uses NOW. */
export function routeReadyFor(b: Business, st: { route_state?: string | null; route_sender?: string | null } | null | undefined): boolean {
  return st?.route_state === "ready" && st.route_sender === b.sender;
}

/**
 * A ROUTE IS PROVEN, NOT ASSUMED — ONCE PER SENDER. The sending address must be in the mailbox's
 * send-as list (so Gmail will not rewrite the From), and then one email to the test recipient must
 * go out and come back from Gmail's Sent copy with that From. Every business that sends from that
 * address is then 'ready' on the same proof: the six guides share one route (owner, 13 Oct 2026).
 * A business whose sender changed is not ready until its new sender is proven.
 */
async function proveRoutes(env: Env, mailbox: GmailSession, now: number): Promise<string[]> {
  const db = env.DB;
  const proven: string[] = [];
  const rows = await db.prepare(`SELECT business_key, route_state, route_sender, route_detail FROM outreach_domain_state`).all<any>();
  const stateOf = new Map((rows.results ?? []).map((r) => [r.business_key, r]));
  const pending = BUSINESSES.filter((b) => stateOf.has(b.key) && !routeReadyFor(b, stateOf.get(b.key)));
  if (!pending.length) return proven;
  const markReady = async (keys: string[], sender: string, detail: string) => {
    for (const k of keys) {
      await db.prepare(
        `UPDATE outreach_domain_state SET route_state = 'ready', route_sender = ?, route_proven_at = ?, route_detail = ?, updated_at = ? WHERE business_key = ?`,
      ).bind(sender, now, detail, now, k).run();
      proven.push(k);
    }
  };
  let sendAs: Set<string> | null = null;
  for (const sender of [...new Set(pending.map((b) => b.sender))]) {
    const waiting = pending.filter((b) => b.sender === sender);
    const already = BUSINESSES.find((b) => b.sender === sender && routeReadyFor(b, stateOf.get(b.key)));
    if (already) {
      await markReady(waiting.map((b) => b.key), sender, `Shares the route proven for ${sender} (${already.key}): ${stateOf.get(already.key)?.route_detail ?? ""}`);
      continue;
    }
    sendAs ??= await mailbox.sendAsAddresses();
    if (!sendAs.has(sender)) {
      for (const b of waiting) {
        await db.prepare(`UPDATE outreach_domain_state SET route_state = 'awaiting_route', route_detail = ?, updated_at = ? WHERE business_key = ?`)
          .bind(`${sender} is not yet a send-as address of the mailbox.`, now, b.key).run();
      }
      continue;
    }
    const sent = await sendTest(env, mailbox, waiting[0]!, 0, now, "route proof");
    if (sent.ok) {
      await markReady(waiting.map((b) => b.key), sender, `Proven ${new Date(now).toISOString()}: Gmail sent ${sent.id} From ${sender}.`);
    } else {
      for (const b of waiting) {
        await db.prepare(`UPDATE outreach_domain_state SET route_state = 'awaiting_route', route_detail = ?, updated_at = ? WHERE business_key = ?`)
          .bind(`Route proof failed: ${sent.detail}`, now, b.key).run();
      }
    }
  }
  return proven;
}

/** Send one sample of a business's sequence step to the test recipient. Never to anyone else. */
export async function sendTest(
  env: Env, mailbox: GmailSession, b: Business, step: 0 | 1, now: number, why: string,
): Promise<{ ok: true; id: string } | { ok: false; detail: string }> {
  const db = env.DB;
  const to = TEST_RECIPIENTS[0];
  const st = await domainState(db, b.key, now);
  const postal = await effectivePostalAddress(db, b.key, st?.postal_address);
  const token = randomToken();
  await db.prepare(
    `INSERT INTO outreach_prospects (id, business_key, email, email_domain, org_name, segment, metro, website, source, source_url,
       mx_verified_at, state, step, unsub_token, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,'test_recipient','owner test list',?,'done',3,?,?,?)
     ON CONFLICT(business_key, email) DO UPDATE SET unsub_token = unsub_token`,
  ).bind(newId("opr"), b.key, to, to.split("@")[1] ?? "", "Test", b.segments[0]?.key ?? "test", "New York City", null, now, token, now, now).run();
  const p = await db.prepare(`SELECT unsub_token FROM outreach_prospects WHERE business_key = ? AND email = ?`).bind(b.key, to).first<any>();
  try {
    const mail = composeEmail({
      business: b, step, to, org: "Test", metro: "New York City", unsubToken: p.unsub_token,
      postalAddress: postal.address || "(postal address not yet set — test send only)",
      firstSubject: `[${why}] ${b.brand}`,
    });
    const sent = await mailbox.send(b, mail.raw, null);
    const from = await mailbox.fromOf(sent.id);
    const ok = addressOf(from) === b.sender;
    await recordSend(db, b.key, null, to, step, true, sent, ok ? "sent" : "failed", ok ? why : `Gmail rewrote From to ${from}`, now);
    return ok ? { ok: true, id: sent.id } : { ok: false, detail: `Gmail sent it From ${from}, not ${b.sender}.` };
  } catch (err) {
    await recordSend(db, b.key, null, to, step, true, null, "failed", (err as Error).message, now);
    return { ok: false, detail: (err as Error).message };
  }
}

async function recordSend(
  db: D1Database, key: string, prospectId: string | null, to: string, step: number, isTest: boolean,
  sent: { id: string; threadId: string } | null, status: string, detail: string | null, now: number,
) {
  await db.prepare(
    `INSERT INTO outreach_sends (id, business_key, prospect_id, to_email, step, is_test, gmail_message_id, gmail_thread_id, status, detail, sent_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(newId("osd"), key, prospectId, to, step, isTest ? 1 : 0, sent?.id ?? null, sent?.threadId ?? null, status, detail, now).run();
}

/**
 * The last step a business sends: the first email is step 0, so this is never past MAX_FOLLOW_UPS
 * (one follow-up, risk brain R-EML-04), whatever a catalog entry holds. A prospect already past it is
 * marked done by the send loop below and never written to again.
 */
export function lastStepOf(b: Business): number {
  return Math.min(b.steps.length - 1, MAX_FOLLOW_UPS);
}

/** First emails still allowed today under a business's own weekday limit. Pure. */
export function newAllowance(perDay: number, firstSentToday: number): number {
  return Math.max(0, perDay - firstSentToday);
}

async function firstSendsToday(db: D1Database, key: string, now: number): Promise<number> {
  const today = chicagoParts(now).day;
  const r = await db.prepare(
    `SELECT sent_at FROM outreach_sends WHERE business_key = ? AND is_test = 0 AND step = 0 AND status != 'failed' AND sent_at >= ?`,
  ).bind(key, now - 2 * DAY_MS).all<{ sent_at: number }>();
  return (r.results ?? []).filter((x) => chicagoParts(x.sent_at).day === today).length;
}

/** `stop` is the missing precondition that refused a business, or null when nothing was missing. */
interface SendOutcome { sent: number; stop: string | null }

async function sendForBusiness(
  env: Env, mailbox: GmailSession, b: Business, settings: OutreachSettings, now: number, refused: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<SendOutcome> {
  const db = env.DB;
  const st = await domainState(db, b.key, now);
  // A business added after the address was set inherits the one the others share. Read at send
  // time, not copied onto its row, so it never spreads to a row the owner left empty on purpose.
  const postal = await effectivePostalAddress(db, b.key, st.postal_address);
  const gateBase = {
    killSwitch: settings.killSwitch,
    sending: settings.sending,
    routeReady: routeReadyFor(b, st),
    hasPostalAddress: Boolean(postal.address),
    pausedReason: st.paused_at ? st.pause_reason : null,
  };
  // DNS is read only once every other brake would let a live send through; a gap refuses it.
  const hold = refusal({ ...gateBase, mailAuthMissing: null, isTestRecipient: false });
  if (hold) {
    refused[b.key] = hold;
    // A deliberate hold (kill switch, flag, unproven route, a pause) is not a stop; a missing address is.
    return { sent: 0, stop: gateBase.routeReady && !gateBase.hasPostalAddress && !gateBase.pausedReason && settings.sending === "live" ? hold : null };
  }
  const authGap = await mailAuthRefusal(b.sender.split("@")[1]!, fetchImpl);
  const no = refusal({ ...gateBase, mailAuthMissing: authGap, isTestRecipient: false });
  if (no) { refused[b.key] = no; return { sent: 0, stop: no }; }

  const cap = dailyCap(st.ramp_started_at, now);
  const today = await sentToday(db, b.key, now);
  const n = sendsThisTick(cap, today, now);
  // First emails today, for a business with its own weekday limit on new ones (Time-2-Read groups: 10).
  let newLeft = b.newPerDay === undefined ? Infinity : newAllowance(b.newPerDay, await firstSendsToday(db, b.key, now));
  if (n === 0) {
    refused[b.key] = "Outside the sending window, or today's cap is reached.";
    // In the window with nothing sent today, a zero is no cap at all: that is a stop, not a hold.
    return { sent: 0, stop: inSendWindow(now) && today === 0 ? `Today's cap reads ${cap}, so nothing can send.` : null };
  }

  // THE SEAT, read at send time and never allowed to block the tick (seat.ts).
  let seat: Seat = SEAT_OPEN;
  if (b.seat) {
    const last: Seat | null = st.seat_read_at ? { active: st.seat_active === 1, end: st.seat_end ?? null } : null;
    const read = await readSeat(b.seat.url, last, fetchImpl);
    seat = read.seat;
    await db.prepare(
      `UPDATE outreach_domain_state SET seat_active = ?, seat_end = ?, seat_read_at = COALESCE(?, seat_read_at), seat_detail = ?, updated_at = ? WHERE business_key = ?`,
    ).bind(seat.active ? 1 : 0, seat.end, read.source === "fetched" ? now : null, read.detail, now, b.key).run();
  }
  const pitch = pitchFor(b, seat);

  const due = await db.prepare(
    `SELECT * FROM outreach_prospects
      WHERE business_key = ? AND source != 'test_recipient'
        AND ((state = 'new' AND step = 0) OR (state = 'in_sequence' AND next_due_at <= ?))
      ORDER BY step DESC, created_at LIMIT ?`,
  ).bind(b.key, now, n).all<any>();

  let sent = 0;
  const last = lastStepOf(b);
  for (const p of due.results ?? []) {
    if (p.step === 0 && newLeft <= 0) continue;
    if (await isSuppressed(db, p.email)) {
      await db.prepare(`UPDATE outreach_prospects SET state = 'suppressed', next_due_at = NULL, updated_at = ? WHERE id = ?`).bind(now, p.id).run();
      continue;
    }
    // A state the business may never write to: refused before anything is composed.
    const blocked = outreachStateBlock(b, p.metro);
    if (blocked) {
      await dropProspect(db, b, p.id, blocked, now);
      continue;
    }
    // The seat holder is the business's paying partner: never cold-pitched, pitch A least of all.
    if (b.seat && isSeatHolder(p, st.seat_holder_domain)) {
      await db.prepare(`UPDATE outreach_prospects SET state = 'done', next_due_at = NULL, updated_at = ? WHERE id = ?`).bind(now, p.id).run();
      continue;
    }
    // A sequence is exactly as long as the business's steps; a prospect past it is done, never written to.
    if (p.step > last) {
      await db.prepare(`UPDATE outreach_prospects SET state = 'done', next_due_at = NULL, updated_at = ? WHERE id = ?`).bind(now, p.id).run();
      continue;
    }
    const step = p.step as 0 | 1;
    let groupCode: string | null = null;
    if (b.key === GROUPS_KEY) {
      const gate = await groupSendGate(db, p.id);
      if ("refuse" in gate) {
        // Taken out of the queue, said by name: a refused group never blocks the ones behind it.
        refused[`${b.key}:${p.id}`] = gate.refuse;
        await db.prepare(`UPDATE outreach_prospects SET state = 'done', next_due_at = NULL, updated_at = ? WHERE id = ?`).bind(now, p.id).run();
        await logEvent(db, { level: "warn", scope: "outreach", event: "group_send_refused", entityId: p.id, detail: { reason: gate.refuse } }).catch(() => {});
        continue;
      }
      groupCode = gate.code;
    }
    const mail = composeEmail({
      business: b, step, to: p.email, org: p.org_name ?? "", metro: p.metro ?? "", unsubToken: p.unsub_token,
      postalAddress: postal.address!, firstSubject: p.last_subject, inReplyTo: p.last_message_id,
      pitch, seatEnd: seat.end, groupCode,
    });
    const res = await mailbox.send(b, mail.raw, p.thread_id);
    const messageId = step === 0 ? await mailbox.messageIdOf(res.id).catch(() => null) : p.last_message_id;
    const next = step < last ? now + (b.steps[step + 1]?.afterDays ?? 4) * DAY_MS : null;
    await db.prepare(
      `UPDATE outreach_prospects SET state = ?, step = ?, next_due_at = ?, thread_id = ?, last_message_id = COALESCE(?, last_message_id),
              last_subject = COALESCE(last_subject, ?), updated_at = ? WHERE id = ?`,
    ).bind(step < last ? "in_sequence" : "done", step + 1, next, res.threadId, messageId, mail.subject, now, p.id).run();
    await recordSend(db, b.key, p.id, p.email, step, false, res, "sent", b.seat ? `pitch ${pitch}` : groupCode ? `code ${groupCode}` : null, now);
    sent += 1;
    if (step === 0) newLeft -= 1;
  }
  if (sent > 0 && !st.ramp_started_at) {
    await db.prepare(`UPDATE outreach_domain_state SET ramp_started_at = ?, updated_at = ? WHERE business_key = ?`).bind(now, now, b.key).run();
  }
  return { sent, stop: null };
}

/**
 * Read what came back: replies in threads outreach started, and bounce notices. Nothing else in the
 * mailbox is fetched.
 */
export async function processReplies(env: Env, mailbox: GmailSession, now: number): Promise<number> {
  const db = env.DB;
  const threads = await db.prepare(
    `SELECT id, business_key, email, thread_id, state FROM outreach_prospects WHERE thread_id IS NOT NULL AND updated_at >= ?`,
  ).bind(now - 60 * DAY_MS).all<any>();
  const byThread = new Map((threads.results ?? []).map((p) => [p.thread_id, p]));
  const candidates = [
    ...(await mailbox.list("in:inbox newer_than:7d -from:me", 100)).filter((m) => byThread.has(m.threadId)),
    ...(await mailbox.list("from:(mailer-daemon OR postmaster) newer_than:7d", 50)),
  ];
  let handled = 0;
  for (const c of candidates) {
    const seen = await db.prepare(`SELECT id FROM outreach_replies WHERE gmail_message_id = ?`).bind(c.id).first();
    if (seen) continue;
    const msg = await mailbox.read(c.id);
    const from = addressOf(msg.headers["from"] ?? "");
    const cls = classifyReply({ from, subject: msg.headers["subject"] ?? "", body: msg.body, headers: msg.headers });
    let prospect = byThread.get(msg.threadId) ?? null;
    let subject = from;
    if (cls === "bounce") {
      const failed = bouncedAddress(msg.body, msg.headers) ?? prospect?.email ?? null;
      if (failed) {
        prospect = prospect ?? (await db.prepare(`SELECT * FROM outreach_prospects WHERE email = ? ORDER BY updated_at DESC LIMIT 1`).bind(failed).first<any>());
        subject = failed;
        await suppress(db, failed, "hard bounce", "bounce", now);
        await recordBounce(db, prospect, failed, now);
        if (prospect) {
          await db.prepare(`UPDATE outreach_prospects SET state = 'bounced', next_due_at = NULL, updated_at = ? WHERE id = ?`).bind(now, prospect.id).run();
          await db.prepare(
            `UPDATE outreach_sends SET status = 'bounced' WHERE id = (SELECT id FROM outreach_sends WHERE prospect_id = ? AND status = 'sent' ORDER BY sent_at DESC LIMIT 1)`,
          ).bind(prospect.id).run();
        }
      }
    } else if (prospect) {
      await act(env, cls, prospect, from, msg, now);
    }
    if (!prospect && cls !== "bounce") continue;
    // Time-2-Read groups: a question about the price or paying goes to her whatever else it said.
    const groupPrice = prospect?.business_key === GROUPS_KEY && cls !== "bounce" && cls !== "auto_reply" && cls !== "unsubscribe" && cls !== "complaint" && wantsPrice(ownWords(msg.body));
    const approvalId = (cls === "interested" || groupPrice) && prospect ? await raiseInterested(env, prospect, from, msg, now) : null;
    await db.prepare(
      `INSERT INTO outreach_replies (id, gmail_message_id, business_key, prospect_id, from_email, classification, excerpt, approval_id, received_at)
       VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(gmail_message_id) DO NOTHING`,
    ).bind(newId("orp"), c.id, prospect?.business_key ?? null, prospect?.id ?? null, subject, cls,
      ownWords(msg.body).slice(0, 300), approvalId, msg.internalDate || now).run();
    handled += 1;
  }
  return handled;
}

async function act(env: Env, cls: ReplyClass, p: any, from: string, msg: { body: string }, now: number) {
  const db = env.DB;
  if (cls === "auto_reply") return;
  // Stop on ANY human reply: the sequence never follows up on someone who wrote back.
  await db.prepare(`UPDATE outreach_prospects SET state = 'replied', next_due_at = NULL, updated_at = ? WHERE id = ?`).bind(now, p.id).run();
  if (cls === "unsubscribe") await suppress(db, p.email, "asked to stop", "reply", now);
  if (cls === "complaint") {
    await suppress(db, p.email, "complaint", "reply", now);
    if (from && from !== p.email) await suppress(db, from, "complaint", "reply", now);
    await db.prepare(
      `UPDATE outreach_sends SET status = 'complaint' WHERE id = (SELECT id FROM outreach_sends WHERE prospect_id = ? ORDER BY sent_at DESC LIMIT 1)`,
    ).bind(p.id).run();
  }
}

async function raiseInterested(env: Env, p: any, from: string, msg: { body: string }, now: number): Promise<string | null> {
  const b = businessByKey(p.business_key);
  if (!b) return null;
  const { raiseJudgementCall } = await import("../approvals/raise");
  if (b.key === GROUPS_KEY) return raiseGroupReply(env, b, p, from, msg, now, raiseJudgementCall);
  let code: string | null = null;
  if (b.kind === "affiliate") code = (await ensurePartner(env.DB, b, p, now)).code;
  const link = code ? `${b.offerUrl}?ref=${code}` : b.offerUrl;
  const reply =
    b.seat
      ? `Thank you, glad to hear it. Everything about how it works, and how to start, is here: ${b.offerUrl}\n\nSend me the best contact for family referrals and I will get you set up this week.\n\n${signatureFor(b)}`
      : b.kind === "local_guide"
      ? `Thank you, glad to hear it. Here is how the listing works and how to start your 2 free months: ${b.offerUrl}\n\nSend me the best contact for the listing and I will have it live this week.\n\n${signatureFor(b)}`
      : b.kind === "affiliate"
        ? `Great to have you. Your personal referral link is ${link} (code ${code}). You earn 30% of the first year's revenue from everyone who buys through it; payouts are monthly.\n\n— The ${b.brand} team`
        : `Thank you! Here is a free look for your staff: ${b.offerUrl}. A site licence is $49/month when you are ready.\n\n— The ${b.brand} team`;
  const raised = await raiseJudgementCall(env, {
    title: `${b.brand}: ${p.org_name ?? from} is interested`,
    question:
      `${p.org_name ?? from} (${from}) replied to Monique's outreach for ${b.brand}:\n\n"${ownWords(msg.body).slice(0, 500)}"\n\n` +
      `Suggested next step: ${b.nextStep}\n\nApprove and the reply below goes to your drafts in ${"st@time-2-read.com"}, addressed to them:\n\n${reply}`,
    resumeKind: "outreach_interested",
    employeeId: "emp_relationship",
    lane: "ops",
    risk: "low",
    resumeDetail: { prospect_id: p.id, to: from, subject: `Re: ${p.last_subject ?? b.brand}`, body: reply, business_key: b.key },
  }, now);
  return raised.approvalId;
}

/**
 * A TIME-2-READ GROUP WROTE BACK (owner, 31 Oct 2026). Every real reply goes to her as one Decide
 * card. A reply about the price or paying carries a SUGGESTED price for her — Monique never quotes:
 * nothing is sent until she approves, and the approved words go to her drafts, not to them.
 */
async function raiseGroupReply(
  env: Env, b: Business, p: any, from: string, msg: { body: string }, now: number,
  raise: typeof import("../approvals/raise").raiseJudgementCall,
): Promise<string | null> {
  const words = ownWords(msg.body);
  const g = await env.DB.prepare(`SELECT code, tier, kind, checkouts_started, signups FROM t2r_groups WHERE prospect_id = ?`).bind(p.id).first<any>();
  const code = g?.code ?? null;
  const price = wantsPrice(words);
  const size = groupSizeIn(words);
  const suggestion = suggestedPrice(size);
  const used = g?.checkouts_started === null || g?.checkouts_started === undefined ? "not tracked yet" : `${g.checkouts_started} started, ${g.signups ?? 0} signed up`;
  const reply = price
    ? `Thank you for asking. For your group: ${suggestion.replace(/^Suggested:\s*/, "").replace(/\s+—.*$/, "")}.${code ? ` The trial code ${code} keeps working while you decide.` : ""}\n\n${signatureFor(b)}`
    : `Thank you, so glad to hear it.${code ? ` Your families can start with the code ${code} at ${b.offerUrl}; it gives each family 15 days free.` : ""} Any other questions, just reply here.\n\n${signatureFor(b)}`;
  const totals = await groupSummary(env.DB).catch(() => null);
  const raised = await raise(env, {
    title: price ? `Time2Read groups: ${p.org_name ?? from} asked the price` : `Time2Read groups: ${p.org_name ?? from} replied`,
    question:
      `${p.org_name ?? from} (${from}), a ${g?.kind ?? "group"} Monique wrote to, replied:\n\n"${words.slice(0, 500)}"\n\n` +
      `Their code: ${code ?? "none yet"} (${used}).${totals ? ` All groups so far: ${totals.line}.` : ""}\n\n` +
      (price ? `${suggestion} Monique never quotes a price; this is yours to set.\n\n` : "") +
      `Approve and the reply below goes to your drafts in st@time-2-read.com, addressed to them:\n\n${reply}`,
    resumeKind: "outreach_interested",
    employeeId: "emp_relationship",
    lane: "ops",
    risk: "low",
    resumeDetail: { prospect_id: p.id, to: from, subject: `Re: ${p.last_subject ?? b.brand}`, body: reply, business_key: b.key },
  }, now);
  return raised.approvalId;
}
