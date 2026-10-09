/**
 * MONIQUE'S OUTREACH DESK (9 Oct 2026). Mounted at /api/outreach (public path /api/boss/outreach).
 *
 *   GET  /                      every business: route, pause, cap, today's sends, 14-day health,
 *                               prospects waiting, replies — and the two switches.
 *   POST /settings              { kill_switch?: "on"|"off", sending?: "off"|"test_only"|"live" }
 *   PUT  /business/:key         { postal_address?, resume?: true } — set the CAN-SPAM footer
 *                               address, or lift an automatic pause.
 *   POST /test-send             { business_key, step } — one sample to the test recipient only.
 *   POST /tick                  run one outreach tick now (what the hourly cron runs).
 *   GET  /referrals             partners, codes and the payout ledger.
 *   POST /referrals/conversions { code, order_ref, amount_cents, customer_ref?, occurred_at? }
 *
 *   GET|POST /u/:token          THE UNSUBSCRIBE LINK. Public by necessity (a recipient has no
 *                               passcode), so it does exactly one thing: suppress the address the
 *                               token belongs to. The token is 144 random bits, stored per address,
 *                               and reveals nothing; an unknown token gets the same page.
 */
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest, notFound } from "../lib/http";
import { audit } from "../lib/audit";
import { BUSINESSES, TEST_RECIPIENTS, businessByKey } from "../outreach/catalog";
import { BOUNCE_WINDOW_MS, chicagoParts, dailyCap } from "../outreach/brakes";
import { domainState, readSettings, runOutreachTick, sendTest } from "../outreach/engine";
import { GmailSession } from "../outreach/gmail";
import { suppress } from "../outreach/suppression";
import { recordConversion } from "../outreach/referrals";

export const outreach = new Hono<{ Bindings: Env; Variables: Vars }>();

outreach.get("/", async (c) => {
  /*
   * READ-ONLY AND A HANDFUL OF QUERIES. The Team roster calls this on every load to print the
   * brake line on Monique's card, so it must not write (it used to upsert a state row per business)
   * or fan out per business (it used to run ~50 queries) — on 9 Oct 2026 that competed with the
   * task drain in local wrangler dev and a phone journey timed out waiting for its row.
   */
  const db = c.env.DB;
  const now = Date.now();
  const today = chicagoParts(now).day;
  const [settings, states, counts, replies, sends, recent, lastTick] = await Promise.all([
    readSettings(db),
    db.prepare(`SELECT * FROM outreach_domain_state`).all<any>(),
    db.prepare(`SELECT business_key, state, COUNT(*) AS n FROM outreach_prospects WHERE source != 'test_recipient' GROUP BY business_key, state`).all<{ business_key: string; state: string; n: number }>(),
    db.prepare(`SELECT business_key, classification, COUNT(*) AS n FROM outreach_replies GROUP BY business_key, classification`).all<{ business_key: string; classification: string; n: number }>(),
    db.prepare(`SELECT business_key, status, sent_at FROM outreach_sends WHERE is_test = 0 AND status != 'failed' AND sent_at >= ?`).bind(now - BOUNCE_WINDOW_MS).all<{ business_key: string; status: string; sent_at: number }>(),
    db.prepare(`SELECT business_key, from_email, classification, excerpt, received_at FROM outreach_replies ORDER BY received_at DESC LIMIT 20`).all(),
    db.prepare(`SELECT ts, detail FROM system_events WHERE scope = 'outreach' AND event = 'tick' ORDER BY ts DESC LIMIT 1`).first<{ ts: number; detail: string }>().catch(() => null),
  ]);
  const stateOf = new Map((states.results ?? []).map((r) => [r.business_key, r]));
  const businesses = BUSINESSES.map((b) => {
    const st = stateOf.get(b.key) ?? { route_state: "awaiting_route" };
    const prospects: Record<string, number> = {};
    for (const r of counts.results ?? []) if (r.business_key === b.key) prospects[r.state] = r.n;
    const rep: Record<string, number> = {};
    for (const r of replies.results ?? []) if (r.business_key === b.key) rep[r.classification] = r.n;
    const mine = (sends.results ?? []).filter((x) => x.business_key === b.key);
    return {
      key: b.key, brand: b.brand, domain: b.domain, sender: b.sender, kind: b.kind, offer: b.offer,
      route_state: st.route_state, route_detail: st.route_detail ?? null, route_proven_at: st.route_proven_at ?? null,
      postal_address_set: Boolean(st.postal_address),
      paused: Boolean(st.paused_at), pause_reason: st.pause_reason ?? null,
      daily_cap: dailyCap(st.ramp_started_at ?? null, now),
      sent_today: mine.filter((x) => chicagoParts(x.sent_at).day === today).length,
      health_14d: {
        sent: mine.length,
        bounced: mine.filter((x) => x.status === "bounced").length,
        complaints: mine.filter((x) => x.status === "complaint").length,
      },
      prospects, replies: rep,
    };
  });
  return ok(c, {
    settings, test_recipients: TEST_RECIPIENTS, businesses, recent_replies: recent.results ?? [],
    last_tick: lastTick ? { at: lastTick.ts, detail: safeJson(lastTick.detail) } : null,
  });
});

function safeJson(s: string | null) {
  try { return s ? JSON.parse(s) : null; } catch { return s; }
}

outreach.post("/settings", async (c) => {
  const body = await c.req.json<{ kill_switch?: string; sending?: string }>().catch(() => ({} as any));
  const now = Date.now();
  if (body.kill_switch !== undefined) {
    if (!["on", "off"].includes(body.kill_switch)) throw badRequest("kill_switch is \"on\" or \"off\".");
    await c.env.DB.prepare(`UPDATE outreach_settings SET value = ?, updated_at = ?, updated_by = 'owner' WHERE key = 'kill_switch'`).bind(body.kill_switch, now).run();
  }
  if (body.sending !== undefined) {
    if (!["off", "test_only", "live"].includes(body.sending)) throw badRequest("sending is \"off\", \"test_only\" or \"live\".");
    await c.env.DB.prepare(`UPDATE outreach_settings SET value = ?, updated_at = ?, updated_by = 'owner' WHERE key = 'sending'`).bind(body.sending, now).run();
  }
  await audit(c.env.DB, { actor: "owner", lane: "ops", entityType: "outreach_settings", action: "changed", detail: body });
  return ok(c, await readSettings(c.env.DB));
});

outreach.put("/business/:key", async (c) => {
  const b = businessByKey(c.req.param("key"));
  if (!b) throw notFound("No business with that key.");
  const body = await c.req.json<{ postal_address?: string; resume?: boolean }>().catch(() => ({} as any));
  const now = Date.now();
  await domainState(c.env.DB, b.key, now);
  if (typeof body.postal_address === "string") {
    const a = body.postal_address.trim();
    if (a.length < 10) throw badRequest("A postal address is a full street or PO Box address with city, state and ZIP.");
    await c.env.DB.prepare(`UPDATE outreach_domain_state SET postal_address = ?, updated_at = ? WHERE business_key = ?`).bind(a, now, b.key).run();
  }
  if (body.resume === true) {
    await c.env.DB.prepare(`UPDATE outreach_domain_state SET paused_at = NULL, pause_reason = NULL, updated_at = ? WHERE business_key = ?`).bind(now, b.key).run();
  }
  await audit(c.env.DB, { actor: "owner", lane: "ops", entityType: "outreach_domain_state", entityId: b.key, action: "changed", detail: { postal_address_set: typeof body.postal_address === "string", resume: body.resume === true } });
  return ok(c, await domainState(c.env.DB, b.key, now));
});

outreach.post("/test-send", async (c) => {
  const body = await c.req.json<{ business_key?: string; step?: number }>().catch(() => ({} as any));
  const b = businessByKey(body.business_key ?? "");
  if (!b) throw badRequest("business_key names no business.");
  const step = [0, 1, 2].includes(Number(body.step)) ? (Number(body.step) as 0 | 1 | 2) : 0;
  const settings = await readSettings(c.env.DB);
  if (settings.killSwitch) throw badRequest("The kill switch is on.");
  const st = await domainState(c.env.DB, b.key, Date.now());
  if (st.route_state !== "ready") throw badRequest(`${b.sender} is not proven yet: ${st.route_detail ?? "awaiting the route"}.`);
  const mailbox = GmailSession.from(c.env);
  if (!mailbox) throw badRequest("The Worker holds no Google key (GSC_SERVICE_ACCOUNT_JSON).");
  return ok(c, await sendTest(c.env, mailbox, b, step, Date.now(), `test step ${step + 1}`));
});

outreach.post("/tick", async (c) => ok(c, await runOutreachTick(c.env)));

outreach.get("/referrals", async (c) => {
  const partners = await c.env.DB.prepare(`SELECT id, business_key, email, name, code, share_bps, created_at FROM referral_partners ORDER BY created_at DESC`).all();
  const payouts = await c.env.DB.prepare(`SELECT partner_id, period, amount_cents, conversions, state FROM referral_payouts ORDER BY period DESC`).all();
  const conversions = await c.env.DB.prepare(`SELECT code, business_key, order_ref, amount_cents, occurred_at FROM referral_conversions ORDER BY occurred_at DESC LIMIT 100`).all();
  return ok(c, { partners: partners.results ?? [], payouts: payouts.results ?? [], conversions: conversions.results ?? [] });
});

outreach.post("/referrals/conversions", async (c) => {
  const body = await c.req.json<any>().catch(() => null);
  if (!body) throw badRequest("Send JSON: { code, order_ref, amount_cents }.");
  try {
    return ok(c, await recordConversion(c.env.DB, body));
  } catch (err) {
    throw badRequest((err as Error).message);
  }
});

/** The public unsubscribe door, mounted ABOVE the session gate in boss/index.ts. */
export const unsubscribe = new Hono<{ Bindings: Env; Variables: Vars }>();

async function unsubscribeByToken(env: Env, token: string): Promise<void> {
  const p = await env.DB.prepare(`SELECT email FROM outreach_prospects WHERE unsub_token = ?`).bind(token).first<{ email: string }>();
  if (p) await suppress(env.DB, p.email, "unsubscribe link", "link");
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head>` +
  `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">` +
  `<h1 style="font-size:1.4rem">You are unsubscribed.</h1><p>You will not receive any more emails from us. No further action is needed.</p></body></html>`;

unsubscribe.get("/:token", async (c) => {
  await unsubscribeByToken(c.env, c.req.param("token"));
  return c.html(PAGE);
});

// RFC 8058 one-click: mail clients POST here from the List-Unsubscribe header.
unsubscribe.post("/:token", async (c) => {
  await unsubscribeByToken(c.env, c.req.param("token"));
  return c.html(PAGE);
});
