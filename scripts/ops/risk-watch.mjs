#!/usr/bin/env node
/**
 * TONI'S DAILY RISK WATCH — money and mail, quiet unless something moves (owner, 22 Oct 2026).
 *
 * duty_risk_watch (migration 0288), daily 08:20 CT on her Mac through duty-run.sh. Toni is the Chief
 * Risk Officer; her trading lane is untouched — this duty lives in the `ops` lane and never trades,
 * never spends (R32), never touches `trading_authority`.
 *
 * What it reads, each one an answer or a NAMED STOP line (never faked):
 *   openrouter     balance never below $0, and any new spend since the last run (every model call is
 *                  meant to be $0 — AI cost posture, 11 Oct 2026)
 *   cloudflare     Workers / account subscriptions and their price (needs Billing Read on the token)
 *   supabase       organisation plans (needs SUPABASE_ACCESS_TOKEN)
 *   renewals       every grid and sender domain's expiry over public RDAP; inside 30 days is named
 *   charges        receipt / invoice notices in the spry.vc mailbox (service account, metadata only)
 *                  and in her personal Gmail (her Claude session's connector)
 *   senders        per outreach sender: complaints, bounces, unsubscribes over 14 days; one over
 *                  threshold is PAUSED (PUT /outreach/business/:key) and named
 *   dkim           google._domainkey for every sender domain (theindustryguides.com stuck since 13 Oct)
 *
 * It emails her as Toni only when a reading changes state. Rule 0: every source unreadable → exit 3.
 *
 *   npm run risk:watch              # read, pause what must pause, email what moved
 *   npm run risk:watch -- --dry     # read and print; no pause, no email, state not saved
 */
import { GRID } from "../../src/shared/boss/grid.mjs";
import {
  askClaudeJson, bossApi, fromDomain, gmailHeaders, googleToken, loadState, movedReadings,
  readNothingStop, saveState, sendAs, stateMap,
} from "./lib/duty-kit.mjs";

const DRY = process.argv.includes("--dry");
/** The one model this duty names (its duty row says the same): a short Haiku run on her Claude seat, mail headers or the gallery only. */
export const MODEL = "claude-haiku-4-5-20251001";
const DAY = 86_400_000;

export const THRESHOLDS = Object.freeze({
  openrouterFloorUsd: 0,
  renewalWarnDays: 30,
  bounceRate: 0.03,
  bounceMinSample: 20,
  bounceAbsolute: 3,
  unsubscribeRate: 0.02,
  unsubscribeMinSample: 20,
});

// ─── Pure judgements (tested) ───────────────────────────────────────────────

/** The OpenRouter reading from /credits plus the last run's usage. */
export function openrouterReading(credits, prevUsage) {
  const total = Number(credits?.total_credits ?? NaN);
  const usage = Number(credits?.total_usage ?? NaN);
  if (!Number.isFinite(total) || !Number.isFinite(usage)) return { key: "openrouter", state: "stop", line: "OpenRouter answered without a balance." };
  const balance = total - usage;
  if (balance < THRESHOLDS.openrouterFloorUsd) {
    return { key: "openrouter", state: "alert", line: `OpenRouter balance is $${balance.toFixed(2)} — below $0. Paid calls are being made on credit; every model call is meant to be free.`, usage };
  }
  if (Number.isFinite(prevUsage) && usage - prevUsage > 0.0001) {
    return { key: "openrouter", state: "alert", line: `New OpenRouter spend: $${(usage - prevUsage).toFixed(4)} since the last check (balance $${balance.toFixed(2)}). Something called a paid model.`, usage };
  }
  return { key: "openrouter", state: "ok", line: `OpenRouter balance $${balance.toFixed(2)}, no new spend.`, usage };
}

/** Days until a domain's RDAP expiration, or null. */
export function rdapExpiry(rdap) {
  const ev = (rdap?.events ?? []).find((e) => /expiration/i.test(String(e?.eventAction ?? "")));
  const t = ev ? Date.parse(ev.eventDate) : NaN;
  return Number.isFinite(t) ? t : null;
}

export function renewalReading(domain, expiresAt, now) {
  const key = `renewal:${domain}`;
  if (expiresAt === null) return { key, state: "stop", line: `${domain}: RDAP gave no expiry date.` };
  const days = Math.floor((expiresAt - now) / DAY);
  if (days <= THRESHOLDS.renewalWarnDays) {
    return { key, state: "alert", line: `${domain} renews in ${days} day${days === 1 ? "" : "s"} (${new Date(expiresAt).toISOString().slice(0, 10)}) — a renewal is a charge; nobody on the team pays it (R32).` };
  }
  return { key, state: "ok", line: `${domain}: ${days} days to renewal.` };
}

/**
 * The pause reason for one outreach sender, or null. The tick's own brakes pause on complaints and
 * bounces; Toni holds the same line AND unsubscribes, and catches a sender the tick has not reached.
 */
export function senderPauseReason(b) {
  const h = b?.health_14d ?? {};
  const sent = Number(h.sent ?? 0), bounced = Number(h.bounced ?? 0), complaints = Number(h.complaints ?? 0);
  const unsub = Number(b?.replies?.unsubscribe ?? b?.replies?.unsubscribed ?? 0);
  if (complaints > 0) return `${complaints} spam complaint${complaints === 1 ? "" : "s"} in 14 days (any complaint pauses)`;
  if (sent >= THRESHOLDS.bounceMinSample && bounced / sent > THRESHOLDS.bounceRate) return `bounce rate ${((bounced / sent) * 100).toFixed(1)}% (${bounced} of ${sent}) is over 3%`;
  if (sent < THRESHOLDS.bounceMinSample && bounced >= THRESHOLDS.bounceAbsolute) return `${bounced} bounces in ${sent} sends`;
  if (sent >= THRESHOLDS.unsubscribeMinSample && unsub / sent > THRESHOLDS.unsubscribeRate) return `unsubscribe rate ${((unsub / sent) * 100).toFixed(1)}% (${unsub} of ${sent}) is over 2%`;
  return null;
}

/** Whether a TXT answer carries a DKIM key with a non-empty p=. */
export function hasDkim(txts) {
  return (txts ?? []).some((t) => /v=DKIM1/i.test(t) && /\bp=[A-Za-z0-9+/]{20,}/.test(t.replace(/["\s]/g, "")));
}

// ─── Readers ────────────────────────────────────────────────────────────────

async function readOpenRouter(prev) {
  if (!process.env.OPENROUTER_API_KEY) return { key: "openrouter", state: "stop", line: "OpenRouter: no key in the vault run. Missing key: OPENROUTER_API_KEY" };
  const r = await fetch("https://openrouter.ai/api/v1/credits", { headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } });
  if (!r.ok) return { key: "openrouter", state: "stop", line: `OpenRouter refused the balance read (${r.status}).` };
  return openrouterReading((await r.json())?.data, Number(prev?.openrouter_usage));
}

async function readCloudflare() {
  const token = process.env.CLOUDFLARE_BILLING_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return { key: "cloudflare", state: "stop", line: "Cloudflare bills: no token. Missing key: CLOUDFLARE_BILLING_TOKEN" };
  const h = { authorization: `Bearer ${token}` };
  const acc = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: h }).then((r) => r.json()).catch(() => ({}));
  const id = acc?.result?.[0]?.id;
  if (!id) return { key: "cloudflare", state: "stop", line: "Cloudflare bills: the token sees no account." };
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${id}/subscriptions`, { headers: h });
  if (r.status === 403) {
    return { key: "cloudflare", state: "stop", line: "Cloudflare bills cannot be read: the vault's token has no Billing Read permission (probed 22 Oct 2026, 403). Missing key: CLOUDFLARE_BILLING_TOKEN — a token with Account › Billing › Read, emailed as SECRET CLOUDFLARE_BILLING_TOKEN=…" };
  }
  if (!r.ok) return { key: "cloudflare", state: "stop", line: `Cloudflare bills: subscriptions read refused (${r.status}).` };
  const subs = (await r.json())?.result ?? [];
  const paid = subs.filter((s) => Number(s?.price ?? 0) > 0);
  const total = paid.reduce((a, s) => a + Number(s.price), 0);
  return { key: "cloudflare", state: paid.length ? "alert" : "ok", line: paid.length ? `Cloudflare: ${paid.length} paid subscription(s), $${total.toFixed(2)} per period (${paid.map((s) => s?.rate_plan?.public_name ?? s?.product?.name ?? "plan").join(", ")}).` : "Cloudflare: no paid subscriptions.", fingerprint: total.toFixed(2) };
}

async function readSupabase() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) return { key: "supabase", state: "stop", line: "Supabase bills cannot be read: no management token in the vault. Missing key: SUPABASE_ACCESS_TOKEN" };
  const r = await fetch("https://api.supabase.com/v1/organizations", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return { key: "supabase", state: "stop", line: `Supabase: organisations read refused (${r.status}).` };
  const orgs = await r.json();
  const paid = (orgs ?? []).filter((o) => o?.plan && !/free/i.test(String(o.plan)));
  return { key: "supabase", state: paid.length ? "alert" : "ok", line: paid.length ? `Supabase: ${paid.length} organisation(s) on a paid plan (${paid.map((o) => o.plan).join(", ")}).` : `Supabase: ${(orgs ?? []).length} organisation(s), none on a paid plan the API reports.` };
}

async function readRenewals(domains, now) {
  const out = [];
  for (const d of domains) {
    try {
      const r = await fetch(`https://rdap.org/domain/${d}`, { headers: { accept: "application/rdap+json" }, redirect: "follow" });
      out.push(r.ok ? renewalReading(d, rdapExpiry(await r.json()), now) : { key: `renewal:${d}`, state: "stop", line: `${d}: RDAP answered ${r.status}.` });
    } catch (e) {
      out.push({ key: `renewal:${d}`, state: "stop", line: `${d}: RDAP unreachable.` });
    }
  }
  return out;
}

async function readChargesSpry() {
  try {
    const token = await googleToken("https://www.googleapis.com/auth/gmail.readonly", "staylor@spry.vc");
    const hits = await gmailHeaders(token, 'newer_than:2d (subject:(receipt OR invoice OR "payment received" OR "your order" OR "you were charged" OR "payment confirmation"))', 20);
    return hits.map((m) => ({ key: `charge:${m.id}`, state: "notice", line: `Charge notice ${m.date}: ${fromDomain(m.from)} — "${m.subject}" (spry.vc mailbox).` }))
      .concat([{ key: "charges:spry", state: "ok", line: `spry.vc mailbox read: ${hits.length} charge notice(s) in 2 days.` }]);
  } catch (e) {
    return [{ key: "charges:spry", state: "stop", line: `The spry.vc mailbox could not be read for charge notices (${String(e?.message ?? e).slice(0, 120)}).` }];
  }
}

function readChargesPersonal() {
  if (process.env.RISK_WATCH_CONNECTOR === "0") return [{ key: "charges:personal", state: "stop", line: "Personal Gmail charge check switched off (RISK_WATCH_CONNECTOR=0)." }];
  const a = askClaudeJson(
    "Use the Gmail tool on my mailbox. Search: newer_than:2d (subject:(receipt OR invoice OR \"payment received\" OR \"your order\" OR \"you were charged\" OR \"renewal\")). " +
    "Do not open bodies. Reply with ONLY a JSON array, one object per message: {\"id\":\"<message id>\",\"from_domain\":\"<sender domain>\",\"subject\":\"<subject, max 120 chars>\",\"date\":\"YYYY-MM-DD\"}. An empty mailbox result is [].",
    { model: MODEL },
  );
  if (!a.ok || !Array.isArray(a.json)) return [{ key: "charges:personal", state: "stop", line: `Her personal Gmail could not be read for charge notices: ${a.ok ? "the answer was not a list" : a.why}.` }];
  return a.json.slice(0, 20).map((m) => ({ key: `charge:${String(m.id).slice(0, 40)}`, state: "notice", line: `Charge notice ${m.date ?? ""}: ${m.from_domain ?? "unknown"} — "${String(m.subject ?? "").slice(0, 120)}" (personal Gmail).` }))
    .concat([{ key: "charges:personal", state: "ok", line: `Personal Gmail read: ${a.json.length} charge notice(s) in 2 days.` }]);
}

async function readSenders(api) {
  let data;
  try { data = await api.get("/outreach"); } catch (e) { return [{ key: "senders", state: "stop", line: `Outreach health could not be read from Boss OS (${String(e?.message ?? e).slice(0, 120)}).` }]; }
  const out = [];
  for (const b of data?.businesses ?? []) {
    const reason = senderPauseReason(b);
    const key = `sender:${b.key}`;
    if (!reason) { out.push({ key, state: b.paused ? "paused" : "ok", line: `${b.sender}: ${b.paused ? `paused (${b.pause_reason ?? "no reason"})` : "healthy"}.` }); continue; }
    if (!b.paused && !DRY) {
      try {
        await api.put(`/outreach/business/${encodeURIComponent(b.key)}`, { pause: true, by: "toni", pause_reason: `Paused by Toni (risk watch): ${reason}.` });
        out.push({ key, state: "alert", line: `PAUSED ${b.sender} (${b.brand}): ${reason}. Monique's card says why; Resume on Team → Outreach sends again once the cause is fixed.` });
      } catch (e) {
        out.push({ key, state: "alert", line: `${b.sender} is over threshold (${reason}) and the pause FAILED: ${String(e?.message ?? e).slice(0, 100)}.` });
      }
    } else {
      out.push({ key, state: b.paused ? "paused" : "alert", line: `${b.sender}: ${reason}${b.paused ? " — already paused" : ""}.` });
    }
  }
  if (!out.length) out.push({ key: "senders", state: "stop", line: "Boss OS listed no outreach senders." });
  return { readings: out, domains: [...new Set((data?.businesses ?? []).map((b) => String(b.sender ?? "").split("@")[1]).filter(Boolean))] };
}

async function readDkim(domain) {
  const key = `dkim:${domain}`;
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=google._domainkey.${domain}&type=TXT`, { headers: { accept: "application/dns-json" } });
    if (!r.ok) return { key, state: "stop", line: `${domain}: DKIM lookup answered ${r.status}.` };
    const txts = ((await r.json())?.Answer ?? []).map((a) => String(a.data ?? ""));
    return hasDkim(txts)
      ? { key, state: "ok", line: `${domain}: Google DKIM published.` }
      : { key, state: "alert", line: `${domain}: no Google DKIM key published — live sends from it are refused until it is (mailAuthRefusal).` };
  } catch {
    return { key, state: "stop", line: `${domain}: DKIM lookup unreachable.` };
  }
}

// ─── The run ────────────────────────────────────────────────────────────────

async function main() {
  const now = Date.now();
  const prev = loadState("risk-watch");
  const readings = [];

  const or = await readOpenRouter(prev);
  readings.push(or);
  readings.push(await readCloudflare());
  readings.push(await readSupabase());

  let api = null;
  try { api = await bossApi(); } catch (e) { readings.push({ key: "senders", state: "stop", line: String(e?.message ?? e) }); }
  const senders = api ? await readSenders(api) : { readings: [], domains: [] };
  readings.push(...(Array.isArray(senders) ? senders : senders.readings));
  const senderDomains = Array.isArray(senders) ? [] : senders.domains;
  for (const d of [...new Set([...senderDomains, "theindustryguides.com"])]) readings.push(await readDkim(d));

  const domains = [...new Set([...GRID.flatMap((p) => p.domains ?? []), ...senderDomains])].sort();
  readings.push(...(await readRenewals(domains, now)));
  readings.push(...(await readChargesSpry()));
  readings.push(...readChargesPersonal());

  for (const r of readings) console.log(`  [${r.state}] ${r.line}`);
  const stop = readNothingStop(readings, "RISK_WATCH_READ_NOTHING");
  if (stop) { console.error(stop); process.exit(3); }

  const moved = movedReadings(readings, prev.states ?? {});
  console.log(`risk watch: ${readings.length} readings, ${readings.filter((r) => r.state === "alert").length} alerting, ${readings.filter((r) => r.state === "stop").length} unreadable, ${moved.length} moved since the last run.`);
  if (DRY) { console.log("RISK-WATCH-COMPLETE: dry"); return; }

  if (moved.length) {
    const alerts = moved.filter((m) => m.state === "alert" || m.state === "paused" || m.state === "notice");
    const cleared = moved.filter((m) => m.state === "ok" || m.state === "cleared");
    const stops = moved.filter((m) => m.state === "stop");
    const text = [
      "Sequoia,", "",
      `${alerts.length ? `${alerts.length} thing${alerts.length === 1 ? "" : "s"} moved on money or mail.` : "Nothing needs you; this is what changed."}`, "",
      ...(alerts.length ? ["NEEDS A LOOK", ...alerts.map((m) => `- ${m.line}`), ""] : []),
      ...(cleared.length ? ["CLEARED", ...cleared.map((m) => `- ${m.line}`), ""] : []),
      ...(stops.length ? ["I COULD NOT READ (said once; I will say again only if it changes)", ...stops.map((m) => `- ${m.line}`), ""] : []),
      "Nobody on the team pays for anything: a renewal or a bill is yours to approve.",
      "",
      "— Toni, Chief Risk Officer",
    ].join("\n");
    const subject = alerts.length ? `Risk: ${alerts.length} moved — ${alerts[0].line.slice(0, 70)}` : `Risk: ${cleared.length} cleared, ${stops.length} unreadable`;
    if (!(await sendAs("Toni", { subject, text }))) { console.error("NAMED STOP [NO_MAIL_SENT] readings moved and no email could be sent; state not saved so the next run says it again."); process.exit(8); }
  }
  saveState("risk-watch", { at: new Date(now).toISOString(), states: stateMap(readings), openrouter_usage: or.usage ?? prev.openrouter_usage ?? null });
  console.log(`RISK-WATCH-COMPLETE: ${moved.length} moved`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`RISK-WATCH FAILED: ${err?.message ?? err}`); process.exit(1); });
}
