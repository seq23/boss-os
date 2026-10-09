/**
 * MONIQUE'S OUTREACH, ONE TICK. Runs on every hourly cron tick, in this order:
 *
 *   1. REPLIES FIRST, ALWAYS — even with the kill switch on. An unsubscribe is honoured on the next
 *      tick no matter what else is switched off.
 *   2. BRAKES: per business, a bounce rate over 3% or any complaint in 14 days pauses it.
 *   3. ROUTES: a business whose sending address appears in the mailbox's send-as list is proven
 *      with one email to the test recipient, then marked ready. Nothing else sends before that.
 *   4. SENDS: within the cap, the window, the flag and the kill switch.
 *   5. LISTS: one public-listing slice and a few website reads, while a business is short of
 *      prospects.
 *   6. PAYOUTS: on the 1st (Chicago), last month's referral ledger.
 *
 * Every refusal is recorded with its reason. A tick that did nothing says why.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { BUSINESSES, TEST_RECIPIENTS, businessByKey, type Business } from "./catalog";
import {
  BOUNCE_WINDOW_MS, DAY_MS, chicagoParts, dailyCap, pauseReason, refusal, sendsThisTick, type Sending,
} from "./brakes";
import { bouncedAddress, classifyReply, ownWords, type ReplyClass } from "./classify";
import { composeEmail } from "./compose";
import { mailAuthRefusal } from "./mailauth";
import { GmailSession, addressOf } from "./gmail";
import { crawlCandidates, randomToken, readNextSlice } from "./lists";
import { isSuppressed, suppress } from "./suppression";
import { ensurePartner, runMonthlyPayouts } from "./referrals";

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
  lists: { slice: string | null; crawled: number; admitted: number };
  payouts: unknown;
  stop?: string;
}

export async function runOutreachTick(env: Env, now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<TickResult> {
  const db = env.DB;
  const out: TickResult = { replies: 0, paused: [], routesProven: [], sent: 0, refused: {}, lists: { slice: null, crawled: 0, admitted: 0 }, payouts: null };
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

  for (const b of BUSINESSES) {
    const st = await domainState(db, b.key, now);
    const reason = pauseReason(await healthOf(db, b.key, now));
    if (reason && !st.paused_at) {
      await db.prepare(`UPDATE outreach_domain_state SET paused_at = ?, pause_reason = ?, updated_at = ? WHERE business_key = ?`)
        .bind(now, reason, now, b.key).run();
      out.paused.push(b.key);
      await logEvent(db, { level: "warn", scope: "outreach", event: "domain_paused", entityId: b.key, detail: { reason } }).catch(() => {});
    }
  }

  if (mailbox && !settings.killSwitch && settings.sending !== "off") {
    try {
      out.routesProven = await proveRoutes(env, mailbox, now);
    } catch (err) {
      out.refused.routes = (err as Error).message;
    }
    for (const b of BUSINESSES) {
      try {
        out.sent += await sendForBusiness(env, mailbox, b, settings, now, out.refused, fetchImpl);
      } catch (err) {
        out.refused[b.key] = (err as Error).message;
      }
    }
  } else if (settings.killSwitch) {
    out.refused.all = "The global kill switch is on.";
  } else if (settings.sending === "off") {
    out.refused.all = "Sending is off.";
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

  await logEvent(db, { level: "info", scope: "outreach", event: "tick", detail: out }).catch(() => {});
  return out;
}

/** Businesses with fewer than a week of prospects waiting at the top of the ramp. */
async function businessesShortOfProspects(db: D1Database): Promise<string[]> {
  const r = await db.prepare(
    `SELECT business_key, COUNT(*) AS n FROM outreach_prospects WHERE state = 'new' GROUP BY business_key`,
  ).all<{ business_key: string; n: number }>();
  const have = new Map((r.results ?? []).map((x) => [x.business_key, x.n]));
  return BUSINESSES.filter((b) => (have.get(b.key) ?? 0) < 50).map((b) => b.key);
}

/**
 * A ROUTE IS PROVEN, NOT ASSUMED. The sending address must be in the mailbox's send-as list (so
 * Gmail will not rewrite the From), and then one email to the test recipient must go out and come
 * back from Gmail's Sent copy with that From. Only then is the business 'ready'.
 */
async function proveRoutes(env: Env, mailbox: GmailSession, now: number): Promise<string[]> {
  const db = env.DB;
  const proven: string[] = [];
  const pending = await db.prepare(
    `SELECT business_key FROM outreach_domain_state WHERE route_state = 'awaiting_route'`,
  ).all<{ business_key: string }>();
  if (!(pending.results ?? []).length) return proven;
  const sendAs = await mailbox.sendAsAddresses();
  for (const row of pending.results ?? []) {
    const b = businessByKey(row.business_key);
    if (!b) continue;
    if (!sendAs.has(b.sender)) {
      await db.prepare(`UPDATE outreach_domain_state SET route_detail = ?, updated_at = ? WHERE business_key = ?`)
        .bind(`${b.sender} is not yet a send-as address of the mailbox.`, now, b.key).run();
      continue;
    }
    const sent = await sendTest(env, mailbox, b, 0, now, "route proof");
    if (sent.ok) {
      await db.prepare(
        `UPDATE outreach_domain_state SET route_state = 'ready', route_proven_at = ?, route_detail = ?, updated_at = ? WHERE business_key = ?`,
      ).bind(now, `Proven ${new Date(now).toISOString()}: Gmail sent ${sent.id} From ${b.sender}.`, now, b.key).run();
      proven.push(b.key);
    } else {
      await db.prepare(`UPDATE outreach_domain_state SET route_detail = ?, updated_at = ? WHERE business_key = ?`)
        .bind(`Route proof failed: ${sent.detail}`, now, b.key).run();
    }
  }
  return proven;
}

/** Send one sample of a business's sequence step to the test recipient. Never to anyone else. */
export async function sendTest(
  env: Env, mailbox: GmailSession, b: Business, step: 0 | 1 | 2, now: number, why: string,
): Promise<{ ok: true; id: string } | { ok: false; detail: string }> {
  const db = env.DB;
  const to = TEST_RECIPIENTS[0];
  const st = await domainState(db, b.key, now);
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
      postalAddress: st?.postal_address || "(postal address not yet set — test send only)",
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

async function sendForBusiness(
  env: Env, mailbox: GmailSession, b: Business, settings: OutreachSettings, now: number, refused: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<number> {
  const db = env.DB;
  const st = await domainState(db, b.key, now);
  const gateBase = {
    killSwitch: settings.killSwitch,
    sending: settings.sending,
    routeReady: st.route_state === "ready",
    hasPostalAddress: Boolean(st.postal_address && String(st.postal_address).trim().length >= 10),
    pausedReason: st.paused_at ? st.pause_reason : null,
  };
  // DNS is read only once every other brake would let a live send through; a gap refuses it.
  const no = refusal({ ...gateBase, mailAuthMissing: null, isTestRecipient: false })
    ?? refusal({ ...gateBase, mailAuthMissing: await mailAuthRefusal(b.sender.split("@")[1]!, fetchImpl), isTestRecipient: false });
  if (no) { refused[b.key] = no; return 0; }

  const cap = dailyCap(st.ramp_started_at, now);
  const n = sendsThisTick(cap, await sentToday(db, b.key, now), now);
  if (n === 0) { refused[b.key] = "Outside the sending window, or today's cap is reached."; return 0; }

  const due = await db.prepare(
    `SELECT * FROM outreach_prospects
      WHERE business_key = ? AND source != 'test_recipient'
        AND ((state = 'new' AND step = 0) OR (state = 'in_sequence' AND next_due_at <= ?))
      ORDER BY step DESC, created_at LIMIT ?`,
  ).bind(b.key, now, n).all<any>();

  let sent = 0;
  for (const p of due.results ?? []) {
    if (await isSuppressed(db, p.email)) {
      await db.prepare(`UPDATE outreach_prospects SET state = 'suppressed', next_due_at = NULL, updated_at = ? WHERE id = ?`).bind(now, p.id).run();
      continue;
    }
    const step = Math.min(p.step, 2) as 0 | 1 | 2;
    const mail = composeEmail({
      business: b, step, to: p.email, org: p.org_name ?? "", metro: p.metro ?? "", unsubToken: p.unsub_token,
      postalAddress: st.postal_address, firstSubject: p.last_subject, inReplyTo: p.last_message_id,
    });
    const res = await mailbox.send(b, mail.raw, p.thread_id);
    const messageId = step === 0 ? await mailbox.messageIdOf(res.id).catch(() => null) : p.last_message_id;
    const next = step < 2 ? now + (b.steps[step + 1]?.afterDays ?? 4) * DAY_MS : null;
    await db.prepare(
      `UPDATE outreach_prospects SET state = ?, step = ?, next_due_at = ?, thread_id = ?, last_message_id = COALESCE(?, last_message_id),
              last_subject = COALESCE(last_subject, ?), updated_at = ? WHERE id = ?`,
    ).bind(step < 2 ? "in_sequence" : "done", step + 1, next, res.threadId, messageId, mail.subject, now, p.id).run();
    await recordSend(db, b.key, p.id, p.email, step, false, res, "sent", null, now);
    sent += 1;
  }
  if (sent > 0 && !st.ramp_started_at) {
    await db.prepare(`UPDATE outreach_domain_state SET ramp_started_at = ?, updated_at = ? WHERE business_key = ?`).bind(now, now, b.key).run();
  }
  return sent;
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
    const approvalId = cls === "interested" && prospect ? await raiseInterested(env, prospect, from, msg, now) : null;
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
  let code: string | null = null;
  if (b.kind === "affiliate") code = (await ensurePartner(env.DB, b, p, now)).code;
  const link = code ? `${b.offerUrl}?ref=${code}` : b.offerUrl;
  const reply =
    b.kind === "local_guide"
      ? `Thank you! Here is how the featured listing works and how to start your 2 free months: ${b.offerUrl}\n\nReply with the best contact for the listing and we will have it live this week.\n\n— The ${b.brand} team`
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
