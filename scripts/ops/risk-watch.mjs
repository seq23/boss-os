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
 *   cloudflare-usage  this month's Workers requests, D1 rows read/written and D1 storage, projected to
 *                  the month's end, against what the Workers Paid plan includes (GraphQL analytics)
 *   github         this month's metered use, what included discounts cover, and what is due (the Mac's
 *                  `gh` sign-in; the billing API needs its `user` scope, which only she can grant)
 *   stripe         every live Stripe key in the vault: a failed payout in 30 days, or payouts switched off
 *   billing        a vendor's "we could not charge your card" mail in either mailbox (14 days back), read
 *                  by the model, never by subject keywords (owner, 19 Nov 2026, phase 1 billing watch:
 *                  GitHub's "payment failed, attempt 3 of 3" sat unseen while its metered use was covered)
 *   supabase       organisation plans (needs SUPABASE_ACCESS_TOKEN)
 *   renewals       every grid and sender domain's expiry over public RDAP; inside 30 days is named
 *   charges        receipt / invoice notices in the spry.vc mailbox (service account, metadata only)
 *                  and in her personal Gmail (her Claude session's connector)
 *   senders        per outreach sender: complaints, bounces, unsubscribes over 14 days; one over
 *                  threshold is PAUSED (PUT /outreach/business/:key) and named
 *   dkim           google._domainkey for every sender domain (theindustryguides.com stuck since 13 Oct)
 *
 * WHAT SHE SEES (owner, 23 Oct 2026, rules 1 and 3): routine risk is NOT its own email any more. A
 * reading that moved becomes, by `planRisk`: a Decide item in Simone's morning email (a renewal, a paid
 * plan — only she pays), a line under "Done for you" (a receipt, a sender paused for complaints, a
 * reading back to normal), or a fix job for the team (a source it cannot read, a token missing a
 * permission, a DKIM gap). Only money at risk RIGHT NOW (paid model calls on OpenRouter) is its own
 * email, as a problem email, sent after the team's fix job is open. Rule 0: every source unreadable
 * → exit 3.
 *
 *   npm run risk:watch              # read, pause what must pause, email what moved
 *   npm run risk:watch -- --dry     # read and print; no pause, no email, state not saved
 */
import { execFileSync } from "node:child_process";
import { GRID } from "../../src/shared/boss/grid.mjs";
import {
  PERSONAL_GMAIL, askClaudeJson, bossApi, fromDomain, gmailHeaders, googleToken, loadState, movedReadings,
  readNothingStop, saveState, sendAs, stateMap, toMorning, fixJob,
} from "./lib/duty-kit.mjs";
import { gmailSearchLink } from "../../src/shared/boss/mail/plain.mjs";
import { ownerEmail } from "../../src/shared/boss/mail/ownerLayout.mjs";

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
    // A sentence in cents she reads (23 Nov 2026 live read: "New OpenRouter spend: $0.5225 since …").
    const spent = usage - prevUsage;
    return { key: "openrouter", state: "alert", line: `OpenRouter charged ${spent < 0.01 ? "under 1 cent" : `$${spent.toFixed(2)}`} since the last check, and $${balance.toFixed(2)} is left on the account. Something called a paid model.`, usage };
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

/** The RDAP server to ask for a domain. Pure. */
export function rdapUrl(domain) {
  const tld = String(domain).split(".").pop().toLowerCase();
  if (tld === "com" || tld === "net") return `https://rdap.verisign.com/${tld}/v1/domain/${domain}`;
  if (tld === "org") return `https://rdap.publicinterestregistry.org/rdap/domain/${domain}`;
  return `https://rdap.org/domain/${domain}`;
}

/** Whether a TXT answer carries a DKIM key with a non-empty p=. */
export function hasDkim(txts) {
  return (txts ?? []).some((t) => /v=DKIM1/i.test(t) && /\bp=[A-Za-z0-9+/]{20,}/.test(t.replace(/["\s]/g, "")));
}

/** "$1,234.50". Pure. */
const usd = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * GitHub's billing usage summary (GET /users/<login>/settings/billing/usage/summary) → one reading. The
 * metered total, what included discounts cover, and what is due; anything due is an alert. Pure.
 */
export function githubUsageReading(summary) {
  const items = Array.isArray(summary?.usageItems) ? summary.usageItems : null;
  if (!items) return { key: "github", state: "stop", line: "GitHub answered the billing read without usage items." };
  const sum = (f) => Math.round(items.reduce((a, i) => a + Number(i?.[f] ?? 0), 0) * 100) / 100;
  const gross = sum("grossAmount"), discount = sum("discountAmount"), net = sum("netAmount");
  const covered = net <= 0.005;
  const line = covered
    ? `GitHub this month: ${usd(gross)} of metered use, all covered by included discounts, so ${usd(0)} is due from it.`
    : `GitHub this month: ${usd(gross)} of metered use, ${usd(discount)} covered by included discounts, ${usd(net)} due.`;
  return { key: "github", state: covered ? "ok" : "alert", line, gross, net };
}

/**
 * What the Workers Paid plan includes each month (Cloudflare pricing, read 20 Nov 2026). The account is
 * on it: 25 D1 databases is past the free plan's 10, and 61 million rows read in one day is past free's 5
 * million (both CONFIRMED 20 Nov 2026).
 */
export const CLOUDFLARE_INCLUDED = Object.freeze({
  requests: { label: "Workers requests", included: 10_000_000 },
  rowsRead: { label: "D1 rows read", included: 25_000_000_000 },
  rowsWritten: { label: "D1 rows written", included: 50_000_000 },
  storageBytes: { label: "D1 storage", included: 5_000_000_000 },
});
/** A share of the included amount, projected to the month's end, that counts as "near its cap". */
export const NEAR_CAP = 0.8;

const big = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} billion` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : Math.round(n).toLocaleString("en-US"));

/**
 * Month-to-date Cloudflare use → one reading. Counters are projected to the month's end from the days
 * already complete; storage is read as it stands. Any projection at NEAR_CAP of what the plan includes is
 * an alert naming it. Pure.
 */
export function cloudflareUsageReading(mtd, { daysDone, daysInMonth }) {
  const near = [];
  const parts = [];
  for (const [k, { label, included }] of Object.entries(CLOUDFLARE_INCLUDED)) {
    const v = Number(mtd?.[k]);
    if (!Number.isFinite(v)) return { key: "cloudflare-usage", state: "stop", line: `Cloudflare use: ${label} was not in the analytics answer.` };
    const projected = k === "storageBytes" ? v : (v / Math.max(1, daysDone)) * daysInMonth;
    const share = projected / included;
    const words = k === "storageBytes" ? `${(v / 1e9).toFixed(2)} GB of ${included / 1e9} GB` : `${big(projected)} of ${big(included)} expected this month`;
    parts.push(`${label} ${words}`);
    if (share >= NEAR_CAP) near.push(`${label} at ${Math.round(share * 100)}% of what the plan includes`);
  }
  return near.length
    ? { key: "cloudflare-usage", state: "alert", line: `Cloudflare is heading past what its plan includes: ${near.join("; ")} (${parts.join(", ")}). Past it, Cloudflare charges per use.` }
    : { key: "cloudflare-usage", state: "ok", line: `Cloudflare use is inside its plan: ${parts.join(", ")}.` };
}

/**
 * Workers AI is billed per UTC day: 10,000 neurons free, then $0.011 per 1,000 (Cloudflare pricing,
 * read 17 Sep 2026). The owner's bar (20 Nov 2026): "we should strive for $0", and an overage under
 * $1 a month is the most she accepts. Red-team runs took the account to 29,072 neurons on 20 Nov and
 * the plan reading above never saw it, because it counts requests and D1 only.
 */
export const WORKERS_AI_FREE_NEURONS = 10_000;
export const WORKERS_AI_DAY_CEILING = 9_000;
export const WORKERS_AI_MONTH_LIMIT_USD = 0.99;
const NEURON_USD = 0.011 / 1000;

/** Neurons per UTC day this month (complete days) → one reading. Pure. */
export function workersAiReading(byDay) {
  const key = "workers-ai";
  if (!byDay || typeof byDay !== "object") return { key, state: "stop", line: "Workers AI use: the analytics answer had no neuron counts." };
  const days = Object.entries(byDay).filter(([, n]) => Number.isFinite(Number(n))).sort(([a], [b]) => a.localeCompare(b));
  const overUsd = days.reduce((s, [, n]) => s + Math.max(0, Number(n) - WORKERS_AI_FREE_NEURONS) * NEURON_USD, 0);
  const hot = days.filter(([, n]) => Number(n) > WORKERS_AI_DAY_CEILING).map(([d, n]) => `${d} ${big(Number(n))}`);
  const money = `$${overUsd.toFixed(2)} past the free neurons this month`;
  if (overUsd >= WORKERS_AI_MONTH_LIMIT_USD) return { key, state: "alert", line: `Workers AI is at ${money}, at or past her $0.99 limit (days over ${big(WORKERS_AI_DAY_CEILING)}: ${hot.join(", ")}). Find the caller by model in Cloudflare's AI analytics and stop it at source.` };
  if (hot.length) return { key, state: "alert", line: `Workers AI went past ${big(WORKERS_AI_DAY_CEILING)} neurons on ${hot.join(", ")} (${money}; the aim is $0). Find the caller by model and cap it.` };
  return { key, state: "ok", line: `Workers AI stayed under ${big(WORKERS_AI_DAY_CEILING)} neurons every day this month (${money}).` };
}

/** One Stripe account's payouts (last 30 days) and account record → one reading. Pure. */
export function stripeReading(label, { payouts, account }) {
  const key = `stripe:${label}`;
  if (!Array.isArray(payouts)) return { key, state: "stop", line: `Stripe (${label}): payouts could not be read.` };
  const failed = payouts.filter((p) => p?.status === "failed");
  if (failed.length) {
    const f = failed[0];
    return { key, state: "alert", line: `Stripe (${label}) could not pay out ${usd(Number(f.amount ?? 0) / 100)} to the bank${f.failure_message ? `: ${String(f.failure_message).replace(/\.\s*$/, "").slice(0, 140)}` : ""}${failed.length > 1 ? ` (${failed.length} failed payouts in 30 days)` : ""}.` };
  }
  if (account && account.payouts_enabled === false) {
    return { key, state: "alert", line: `Stripe (${label}) has payouts switched off${account.requirements?.disabled_reason ? ` (${account.requirements.disabled_reason})` : ""}; money stays in Stripe until it is fixed.` };
  }
  return { key, state: "ok", line: `Stripe (${label}): ${payouts.length} payout(s) in 30 days, none failed.` };
}

/**
 * Billing-problem notices (a model already read each one as `payment_failed`) → one alert per vendor,
 * keyed by its newest message, so a later failed attempt is news again and the same one is said once.
 * Pure.
 */
export function billingProblemReadings(notices) {
  const byVendor = new Map();
  for (const n of notices ?? []) {
    if (n?.kind !== "payment_failed") continue;
    // A vendor billing through Stripe mails from stripe.com: the vendor the model names is the one owed.
    const d = String(n.from_domain ?? "unknown").toLowerCase();
    const who = String(n.vendor ?? "").trim();
    const id = who ? `${d}/${who.toLowerCase()}` : d;
    const prev = byVendor.get(id);
    if (!prev) byVendor.set(id, { domain: d, who, newest: n, count: 1 });
    else { prev.count += 1; if (String(n.date ?? "") >= String(prev.newest.date ?? "")) prev.newest = n; }
  }
  return [...byVendor.values()].map(({ domain, who, newest, count }) => ({
    key: `billing-problem:${domain}:${String(newest.id).slice(0, 40)}`,
    state: "alert",
    domain,
    vendor: who || vendorName(domain),
    subject: String(newest.subject ?? "").slice(0, 120),
    line: `Your payment to ${who || vendorName(domain)} did not go through${dayWords(newest.date)}${count > 1 ? ` (${count} notices)` : ""}${newest.detail ? `: ${String(newest.detail).replace(/\.\s*$/, "").slice(0, 160)}` : ""}.`,
  }));
}

/** " on 17 Nov" from "2026-11-17"; "" when there is no date. Pure. */
export function dayWords(day) {
  const t = Date.parse(`${String(day ?? "").slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(t) ? ` on ${new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "";
}

/** "github.com" → "GitHub"; others by their domain's first label. Pure. */
export function vendorName(domain) {
  const known = { "github.com": "GitHub", "cloudflare.com": "Cloudflare", "stripe.com": "Stripe", "google.com": "Google", "apple.com": "Apple", "anthropic.com": "Anthropic", "openai.com": "OpenAI" };
  const d = String(domain ?? "").toLowerCase().replace(/^(?:[a-z0-9-]+\.)*?([a-z0-9-]+\.[a-z]{2,})$/, "$1");
  if (known[d]) return known[d];
  const first = d.split(".")[0] ?? "A vendor";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** Where to fix a vendor's payment. Pure. */
export function billingPage(domain) {
  const d = String(domain ?? "").toLowerCase();
  if (d.endsWith("github.com")) return "https://github.com/settings/billing";
  if (d.endsWith("cloudflare.com")) return "https://dash.cloudflare.com/?to=/:account/billing";
  return null;
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

/** The scope line she runs once so Toni can read GitHub's bill (interactive sign-in: only she can). */
export const GITHUB_SCOPE_COMMAND = "gh auth refresh -h github.com -s user";

function readGithub(run = execFileSync) {
  const gh = (args) => run("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  try {
    const login = gh(["api", "/user", "-q", ".login"]).trim();
    return githubUsageReading(JSON.parse(gh(["api", `/users/${login}/settings/billing/usage/summary`])));
  } catch (e) {
    const why = String(e?.stderr ?? e?.message ?? e);
    if (/needs the "user" scope|Resource not accessible|404/i.test(why)) {
      return { key: "github", state: "stop", needsHer: true, line: `GitHub's bill cannot be read yet: the Mac's GitHub sign-in lacks the billing permission. One line in Terminal adds it (a sign-in, so only you can): ${GITHUB_SCOPE_COMMAND}` };
    }
    return { key: "github", state: "stop", line: `GitHub's bill could not be read (${why.trim().split("\n").pop().slice(0, 120)}).` };
  }
}

/** Days of the month already complete in Central, and the month's length. Pure. */
export function monthProgress(now) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(now));
  const [y, m, d] = day.split("-").map(Number);
  return { first: `${y}-${String(m).padStart(2, "0")}-01`, yesterday: new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10), daysDone: Math.max(1, d - 1), daysInMonth: new Date(Date.UTC(y, m, 0)).getUTCDate() };
}

async function readCloudflareUsage(now) {
  const token = process.env.CLOUDFLARE_API_TOKEN, acct = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !acct) return { key: "cloudflare-usage", state: "stop", line: "Cloudflare use: no token or account id in the vault run. Missing key: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID" };
  const h = { authorization: `Bearer ${token}` };
  const p = monthProgress(now);
  // On the 1st nothing is complete yet: last month's last day stands in, so the read is never empty.
  const since = p.yesterday < p.first ? p.yesterday : p.first;
  const q = `{viewer{accounts(filter:{accountTag:"${acct}"}){w:workersInvocationsAdaptive(limit:10000,filter:{date_geq:"${since}",date_leq:"${p.yesterday}"}){sum{requests}} d:d1AnalyticsAdaptiveGroups(limit:10000,filter:{date_geq:"${since}",date_leq:"${p.yesterday}"}){sum{rowsRead rowsWritten}} ai:aiInferenceAdaptiveGroups(limit:10000,filter:{date_geq:"${since}",date_leq:"${p.yesterday}"}){sum{totalNeurons} dimensions{date}}}}}`;
  try {
    const g = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ query: q }) });
    const gj = await g.json();
    const a = gj?.data?.viewer?.accounts?.[0];
    if (!g.ok || !a) return { key: "cloudflare-usage", state: "stop", line: `Cloudflare use: analytics refused (${g.status} ${String(gj?.errors?.[0]?.message ?? "").slice(0, 100)}).` };
    const total = (rows, f) => (rows ?? []).reduce((n, r) => n + Number(r?.sum?.[f] ?? 0), 0);
    const dbs = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database?per_page=1000`, { headers: h }).then((r) => r.json());
    if (!Array.isArray(dbs?.result)) return { key: "cloudflare-usage", state: "stop", line: "Cloudflare use: the D1 database list could not be read." };
    const mtd = { requests: total(a.w, "requests"), rowsRead: total(a.d, "rowsRead"), rowsWritten: total(a.d, "rowsWritten"), storageBytes: dbs.result.reduce((n, d) => n + Number(d?.file_size ?? 0), 0) };
    const neurons = Array.isArray(a.ai) ? a.ai.reduce((m, r) => ({ ...m, [r.dimensions.date]: (m[r.dimensions.date] ?? 0) + Number(r?.sum?.totalNeurons ?? 0) }), {}) : null;
    return [cloudflareUsageReading(mtd, { daysDone: since === p.first ? p.daysDone : 1, daysInMonth: p.daysInMonth }), workersAiReading(neurons)];
  } catch (e) {
    return { key: "cloudflare-usage", state: "stop", line: `Cloudflare use: unreachable (${String(e?.message ?? e).slice(0, 100)}).` };
  }
}

/** Every live Stripe key in the vault, one reading per account (two keys on one account read once). */
async function readStripe(now) {
  const keys = Object.keys(process.env).filter((k) => /^STRIPE_[A-Z0-9_]+_LIVE_(SECRET|RESTRICTED)$/.test(k)).sort();
  if (!keys.length) return [{ key: "stripe", state: "stop", line: "Stripe: no live key in the vault run." }];
  const out = [], seen = new Set();
  for (const k of keys) {
    const label = k.replace(/^STRIPE_/, "").replace(/_LIVE_(SECRET|RESTRICTED)$/, "").toLowerCase().replace(/_/g, "-");
    const h = { authorization: `Bearer ${process.env[k]}` };
    try {
      const acc = await fetch("https://api.stripe.com/v1/account", { headers: h });
      const account = acc.ok ? await acc.json() : null; // a restricted key may not read the account (403): payouts still tell
      if (account?.id) { if (seen.has(account.id)) continue; seen.add(account.id); }
      const since = Math.floor((now - 30 * DAY) / 1000);
      const r = await fetch(`https://api.stripe.com/v1/payouts?limit=100&created[gte]=${since}`, { headers: h });
      out.push(stripeReading(label, { payouts: r.ok ? (await r.json())?.data : null, account }));
    } catch (e) {
      out.push({ key: `stripe:${label}`, state: "stop", line: `Stripe (${label}): unreachable (${String(e?.message ?? e).slice(0, 100)}).` });
    }
  }
  return out;
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
      // rdap.org answers 403 to a request with no User-Agent (CONFIRMED 22 Oct 2026); the registries' own
      // RDAP servers are asked directly for .com/.net and .org, rdap.org's bootstrap for the rest.
      const r = await fetch(rdapUrl(d), { headers: { accept: "application/rdap+json", "user-agent": "boss-os-risk-watch/1.0 (+https://boss.sequoiataylor.com)" }, redirect: "follow" });
      out.push(r.ok ? renewalReading(d, rdapExpiry(await r.json()), now) : { key: `renewal:${d}`, state: "stop", line: `${d}: RDAP answered ${r.status}.` });
    } catch (e) {
      out.push({ key: `renewal:${d}`, state: "stop", line: `${d}: RDAP unreachable.` });
    }
  }
  return out;
}

/**
 * The mail search behind both charge readers: receipts from the last 2 days, and anything that may be a
 * billing problem from the last 14 (a failed card keeps being retried for days). The search only gathers
 * candidates; what each message IS (receipt, failed payment, renewal, other) is read by the model.
 */
// GitHub's CI mail ("Run failed", 200 a fortnight) buried GitHub's own billing mail (CONFIRMED 20 Nov 2026),
// so notifications@github.com is left out of the 14-day search; billing mail comes from noreply@github.com.
export const CHARGE_QUERY = '(newer_than:2d subject:(receipt OR invoice OR "payment received" OR "your order" OR "you were charged" OR "payment confirmation" OR renewal)) OR (newer_than:14d -from:notifications@github.com subject:(payment OR billing OR declined OR "past due" OR overdue OR "payment failed" OR "unable to charge" OR suspended))';

// Her household bills are never reported (her ruling: no personal bills in reports), so the model files
// them as "personal" and nothing reads that kind.
const KIND_RULE = 'kind is one of "receipt" (a business service took money or issued an invoice), "payment_failed" (a business service could not charge a card or payment, or an account is past due or suspended for non-payment), "renewal" (a business service will charge soon), "personal" (a household or personal bill or card: phone or internet carrier, utilities, personal credit cards, bank, rent, insurance, personal shopping), "other" (none of these, e.g. a job listing). Business services are the software, hosting, domains, AI, payment and marketing tools her companies use';

/** A charge notice's reading: failed payments are gathered by vendor later; the rest are notices. Pure. */
export function chargeReading(m, where) {
  return { key: `charge:${String(m.id).slice(0, 40)}`, state: "notice", line: `Charge notice ${m.date ?? ""}: ${m.from_domain ?? "unknown"} — "${String(m.subject ?? "").slice(0, 120)}" (${where}).` };
}

/** Readings from model-read notices of one mailbox. Pure. */
export function noticeReadings(notices, where, sourceKey, now = Date.now()) {
  const list = (notices ?? []).slice(0, 25);
  // Receipts and renewals are news for 2 days; only a billing problem is looked for 14 days back.
  const recent = (m) => !Number.isFinite(Date.parse(m?.date)) || now - Date.parse(m.date) <= 2 * DAY + DAY / 2;
  return list.filter((m) => (m?.kind === "receipt" || m?.kind === "renewal") && recent(m)).map((m) => chargeReading(m, where))
    .concat(billingProblemReadings(list))
    .concat([{ key: sourceKey, state: "ok", line: `${where.charAt(0).toUpperCase()}${where.slice(1)} read: ${list.filter((m) => ["receipt", "payment_failed", "renewal"].includes(m?.kind)).length} business charge or billing notice(s).` }]);
}

async function readChargesSpry() {
  try {
    const token = await googleToken("https://www.googleapis.com/auth/gmail.readonly", "staylor@spry.vc");
    const hits = await gmailHeaders(token, CHARGE_QUERY, 25);
    if (!hits.length) return noticeReadings([], "spry.vc mailbox", "charges:spry");
    // Metadata only (sender domain, subject, date): the model reads what each one is.
    const a = askClaudeJson(
      `Each line is one email's sender domain, date and subject. ${KIND_RULE}. Reply with ONLY a JSON array, one object per line, in order: {"id":"<id>","kind":"<kind>"}.\n` +
      hits.map((m) => `${m.id}\t${fromDomain(m.from)}\t${m.date}\t${m.subject}`).join("\n"),
      { model: MODEL, maxTurns: 1 },
    );
    if (!a.ok || !Array.isArray(a.json)) return [{ key: "charges:spry", state: "stop", line: `The spry.vc charge notices could not be read: ${a.ok ? "the answer was not a list" : a.why}.` }];
    const kinds = new Map(a.json.map((x) => [String(x?.id), x?.kind]));
    return noticeReadings(hits.map((m) => ({ id: m.id, from_domain: fromDomain(m.from), subject: m.subject, date: m.date, kind: kinds.get(m.id) ?? "other" })), "spry.vc mailbox", "charges:spry");
  } catch (e) {
    return [{ key: "charges:spry", state: "stop", line: `The spry.vc mailbox could not be read for charge notices (${String(e?.message ?? e).slice(0, 120)}).` }];
  }
}

function readChargesPersonal() {
  if (process.env.RISK_WATCH_CONNECTOR === "0") return [{ key: "charges:personal", state: "stop", line: "Personal Gmail charge check switched off (RISK_WATCH_CONNECTOR=0)." }];
  const a = askClaudeJson(
    `Use the Gmail tool on my mailbox. Search: ${CHARGE_QUERY}. ` +
    `For each message decide its kind from the sender, subject and snippet: ${KIND_RULE}. ` +
    "Open a message's body only when its kind is payment_failed, to read what was not paid. " +
    "Reply with ONLY a JSON array, one object per message: {\"id\":\"<message id>\",\"from_domain\":\"<sender domain>\",\"subject\":\"<subject, max 120 chars>\",\"date\":\"YYYY-MM-DD\",\"kind\":\"<kind>\",\"vendor\":\"<the company asking to be paid, e.g. from the sender name; for a payment page like Stripe, the business behind it>\",\"detail\":\"<payment_failed only: one plain sentence from the email: what was not paid, the amount if stated, and the attempt (e.g. attempt 3 of 3) if stated; else empty>\"}. An empty mailbox result is [].",
    { model: MODEL, ...PERSONAL_GMAIL, evidence: "risk-watch-charges-personal" },
  );
  if (!a.ok || !Array.isArray(a.json)) return [{ key: "charges:personal", state: "stop", line: `Her personal Gmail could not be read for charge notices: ${a.ok ? "the answer was not a list" : a.why}.` }];
  return noticeReadings(a.json, "personal Gmail", "charges:personal");
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

// ─── What she sees, from what moved (pure; tested) ───────────────────────────

const RISK_LABELS = [
  [/^openrouter$/, () => "OpenRouter spend"], [/^cloudflare$/, () => "Cloudflare bills"], [/^supabase$/, () => "Supabase bills"],
  [/^github$/, () => "GitHub's bill"], [/^cloudflare-usage$/, () => "Cloudflare use"], [/^stripe:(.+)$/, (m) => `Stripe payouts (${m[1]})`],
  [/^billing-problem:([^:]+):/, (m) => `${vendorName(m[1])}'s payment`],
  [/^renewal:(.+)$/, (m) => `The ${m[1]} renewal`], [/^sender:(.+)$/, (m) => `Outreach from ${m[1]}`], [/^dkim:(.+)$/, (m) => `The ${m[1]} sending setup`],
];
const labelOf = (key) => { for (const [re, f] of RISK_LABELS) { const m = re.exec(key); if (m) return f(m); } return key.split(":")[0]; };

/** Money at risk is an alarm (C, owner layout 7 Nov 2026): line 1 says why and that the team has it. Pure. */
export function urgentEmail(urgent) {
  return ownerEmail({ who: "Toni", layout: "alarm", subject: urgent.subject, why: "Money is at risk: a job is paying for AI calls that should be free",
    act: "Nothing to do. The team is switching it back to a free model", broke: urgent.happened, doing: urgent.did, status: urgent.status });
}

/**
 * `{ urgent, decide, lines, fixes }` for the readings that moved. `urgent` is the one problem email
 * (money at risk now); everything else goes into the morning email or to the team.
 */
export function planRisk(moved, { github = null } = {}) {
  const out = { urgent: null, decide: [], lines: [], fixes: [] };
  for (const r of moved) {
    const key = r.key;
    if (r.state === "stop" && r.needsHer) {
      // A sign-in only she can give (interactive): said once, as a Decide item, never a team chore.
      out.decide.push({ title: `Let Toni read ${labelOf(key)}?`, body: r.line, buttons: [{ label: "What the line does", url: "https://cli.github.com/manual/gh_auth_refresh" }], priority: 0 });
      continue;
    }
    if (r.state === "stop") {
      out.fixes.push({ title: `Toni cannot check ${labelOf(key)}`, prompt: `Toni's daily risk watch (scripts/ops/risk-watch.mjs) could not read ${key}: ${r.line} Fix the read (a token, a permission, a key in the vault) so the check runs again. This is a team chore, never her email.` });
      continue;
    }
    if (r.state === "ok" || r.state === "cleared") {
      // A billing-problem mail ageing out of the 14-day search is not proof it was paid: say nothing.
      if (key.startsWith("billing-problem:")) continue;
      if (r.was === "alert" || r.was === "paused") out.lines.push(`${labelOf(key)} is back to normal.`);
      continue;
    }
    if (key.startsWith("billing-problem:")) {
      const domain = r.domain ?? key.split(":")[1];
      const extra = domain === "github.com" && github && github.state !== "stop" ? ` ${github.line}` : "";
      const page = billingPage(domain);
      out.decide.push({
        title: `${r.vendor ?? vendorName(domain)} could not take a payment`,
        body: `${r.line}${extra} Only you can update the card or pay it.`,
        buttons: [...(page ? [{ label: "Open the billing page", url: page }] : []), { label: "Open the email", url: r.subject ? gmailSearchLink(r.subject) : `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`from:${domain}`)}` }],
        priority: 3,
      });
      continue;
    }
    if (key === "github") {
      out.decide.push({ title: "GitHub will charge for this month's use", body: `${r.line} Included discounts no longer cover it.`, buttons: [{ label: "Open the billing page", url: "https://github.com/settings/billing" }], priority: 2 });
      continue;
    }
    if (key === "cloudflare-usage") {
      out.decide.push({ title: "Cloudflare use is near what the plan includes", body: r.line, buttons: [{ label: "Open Cloudflare billing", url: "https://dash.cloudflare.com/?to=/:account/billing" }], priority: 1 });
      continue;
    }
    if (key.startsWith("stripe:")) {
      out.decide.push({ title: `Stripe payouts need you (${key.slice(7)})`, body: r.line, buttons: [{ label: "Open Stripe payouts", url: "https://dashboard.stripe.com/payouts" }], priority: 3 });
      continue;
    }
    if (key === "openrouter") {
      out.fixes.push({ title: "Paid AI calls on OpenRouter — switch them back to free", touches: "money", prompt: `Toni's risk watch: ${r.line} Every model call is meant to be $0 (AI cost posture). Find which job called a paid model, switch it back to a free one, and say what it was.` });
      out.urgent = {
        subject: "Paid AI calls are being charged — the team is on it",
        happened: r.line.replace(/\s*Paid calls are being made on credit;.*$/, "").replace(/\s*Something called a paid model\.?$/, ""),
        did: "Opened a job for the team to find the job that called a paid model and switch it back to a free one.",
        status: "Being fixed now; what it was will be in tomorrow's morning email.",
      };
      continue;
    }
    if (key === "cloudflare" || key === "supabase") {
      const url = key === "cloudflare" ? "https://dash.cloudflare.com/" : "https://supabase.com/dashboard/org";
      out.decide.push({ title: `Keep paying for ${key === "cloudflare" ? "Cloudflare" : "Supabase"}?`, body: r.line, buttons: [{ label: "Open the billing page", url }], priority: 1 });
      continue;
    }
    if (key.startsWith("renewal:")) {
      const domain = key.slice("renewal:".length);
      out.decide.push({ title: `Renew ${domain}?`, body: r.line, buttons: [{ label: "See who it is registered with", url: `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(domain)}` }], priority: 2 });
      continue;
    }
    if (key.startsWith("charge:")) {
      const subj = /"([^"]+)"/.exec(r.line)?.[1] ?? "";
      const from = /:\s*([a-z0-9.-]+\.[a-z]{2,})\s*—/i.exec(r.line)?.[1] ?? "a company";
      out.lines.push({ text: `New receipt from ${from}${subj ? `: "${subj}"` : ""}.`, links: subj ? [{ label: "Open the email", url: gmailSearchLink(subj) }] : [] });
      continue;
    }
    if (key.startsWith("dkim:")) {
      out.fixes.push({ title: `Publish the Google DKIM key for ${key.slice(5)}`, touches: "outreach", prompt: `Toni's risk watch: ${r.line} Publish the google._domainkey record (Google Admin → Gmail → Authenticate email, then the DNS record) and confirm live sends are allowed again.` });
      continue;
    }
    if (key.startsWith("sender:")) {
      // Bounces are the bounce agent's (rule 4): it replaces the address and restarts outreach itself.
      if (/bounce/i.test(r.line)) continue;
      out.lines.push(`${labelOf(key)} paused itself to protect the sending address: ${r.line.replace(/^[^:]+:\s*/, "")}`);
      continue;
    }
    out.lines.push(r.line);
  }
  return out;
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
  const github = readGithub();
  readings.push(github);
  readings.push(...[await readCloudflareUsage(now)].flat());
  readings.push(...(await readStripe(now)));

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
  console.log(`OUTPUT ${readings.filter((r) => r.state !== "stop").length} readings`);
  console.log(`risk watch: ${readings.length} readings, ${readings.filter((r) => r.state === "alert").length} alerting, ${readings.filter((r) => r.state === "stop").length} unreadable, ${moved.length} moved since the last run.`);
  if (DRY) { console.log("RISK-WATCH-COMPLETE: dry"); return; }

  let reported = false;
  if (moved.length) {
    const plan = planRisk(moved, { github });
    for (const f of plan.fixes) { const why = api ? await fixJob(api, f) : "Boss OS was not reachable"; console.log(`  fix job: ${f.title}${why ? ` — NOT opened (${why})` : ""}`); }
    if (plan.lines.length || plan.decide.length) {
      if (!toMorning("risk", { lines: plan.lines, decide: plan.decide })) { console.error("state not saved so the next run says it again."); process.exit(8); }
      reported = true;
    }
    if (plan.urgent) {
      const laid = urgentEmail(plan.urgent);
      if (!(await sendAs("Toni", { subject: laid.subject, text: laid.text, prelaid: laid }))) { console.error("NAMED STOP [NO_MAIL_SENT] money at risk and no email could be sent; state not saved so the next run says it again."); process.exit(8); }
    }
  }
  // Nothing moved: an empty "all clear", so the morning email can tell a quiet day from a run that never reported in.
  if (!reported && !toMorning("risk", {})) { console.error("state not saved."); process.exit(8); }
  saveState("risk-watch", { at: new Date(now).toISOString(), states: stateMap(readings), openrouter_usage: or.usage ?? prev.openrouter_usage ?? null });
  console.log(`RISK-WATCH-COMPLETE: ${moved.length} moved`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`RISK-WATCH FAILED: ${err?.message ?? err}`); process.exit(1); });
}
