#!/usr/bin/env node
/**
 * TIME-2-READ'S MONEY NUMBERS, READ EVERY WEDNESDAY (owner's approval, 1 Nov 2026).
 *
 * The Time-2-Read brain's Numbers table had five rows sitting at [MISSING]: paying subscribers, MRR,
 * trial starts, trial → paid rate and free signups. This reads them on the Mac every Wednesday at
 * 07:30 Central (com.seq.boss-t2r-numbers, scripts/ops/install-agent-launchd.sh), ahead of the
 * Wednesday Spry Labs weekly email, and writes ONLY the Value and Last updated cells of those rows
 * (setNumber keeps each row's definition and source). The Scoreboard reads the same rows
 * (scoreboardRows), so nothing else has to change for them to show there.
 *
 * WHERE EACH NUMBER COMES FROM — the data that already exists first, no new paid service:
 *   - Paying subscribers, MRR: the dailystory Supabase `subscribers` table the Stripe webhook fills
 *     (`subscribed`, `subscription_tier`, `stripe_customer_id`, `updated_at` = the checkout moment).
 *     The table has no trial status, so a row still inside its trial window (7 days, or the access
 *     code's days from `access_code_redemptions`) counts as "in trial", not paying. Comped rows
 *     (`override_premium`, no Stripe customer) are not paying.
 *   - MRR prices come from the brain's own "List price" row ("$12.99 / $99"), the one place the
 *     price is written for the business, so this file never carries a second copy of it.
 *   - Free signups: Supabase Auth's admin user list, counted by creation month (Central).
 *   - Trial starts, trial → paid rate: the tables cannot answer these (a cancelled row loses its
 *     checkout date), so they need the LIVE Stripe API through a Time-2-Read restricted key
 *     (T2R_STRIPE_LIVE_RESTRICTED_KEY). The vault's T2R_STRIPE_TEST_SECRET_KEY is TEST mode and is
 *     never used for these numbers; a key that is not live mode is refused by its prefix AND by
 *     Stripe's own `livemode` flag on every object returned.
 *
 * TEST AND OWNER ACCOUNTS are excluded: emails listed in ~/.boss-os/t2r-test-accounts.txt (one per
 * line, on the Mac only, never in this public repo), plus any account flagged test in its auth
 * metadata or using an obvious test address. No list = no numbers (a named reason in every cell),
 * because counting her own test accounts would be a wrong number dressed as a real one.
 *
 * AGGREGATES ONLY. Names and emails are read on the Mac to exclude test accounts and never leave it:
 * the only thing sent to Boss OS is the Numbers section's text.
 *
 * RULE 0: a source that could not be read writes "not read: <reason>" into that metric's Value cell,
 * never silence and never a zero. If Boss OS refuses the write, the script exits non-zero.
 *
 *   npm run --silent vault:run -- npm run --silent brains:t2r-numbers     # what launchd runs
 *   node scripts/brains/t2r-numbers.mjs --dry-run                          # read and print, no write
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { numbersRows, sectionBody, setNumber } from "../../src/shared/boss/brains/brain.mjs";

const ORIGIN = process.env.BOSS_ORIGIN ?? "https://boss.sequoiataylor.com";
export const SLUG = "time-2-read";
/** The dailystory project's public URL (it ships in the app's own client bundle). */
export const SUPABASE_URL = process.env.DAILYSTORY_SUPABASE_URL ?? "https://cpzeuogomaixamrtnnmj.supabase.co";
export const EXCLUDE_FILE = join(homedir(), ".boss-os", "t2r-test-accounts.txt");
export const DEFAULT_TRIAL_DAYS = 7;
const DAY_MS = 86_400_000;

/** The five rows this job owns, by their exact names in the brain. */
export const METRICS = Object.freeze({
  paying: "Paying subscribers",
  mrr: "MRR",
  trialStarts: "Trial starts",
  trialRate: "Trial → paid rate",
  signups: "Free signups",
});

// ─── Pure math (unit-tested in tests/t2rNumbers.test.ts) ──────────────────────

/** YYYY-MM-DD in Central. */
export function centralDay(t) {
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}
export const monthKey = (t) => centralDay(t).slice(0, 7);
export function previousMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (key) => MONTHS[Number(key.slice(5, 7)) - 1];

/** "$12.99 / $99" → { monthly: 12.99, annual: 99 }, or null when the row cannot be read. */
export function parseListPrice(value) {
  const m = String(value ?? "").match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*\$\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const monthly = Number(m[1].replace(/,/g, ""));
  const annual = Number(m[2].replace(/,/g, ""));
  return monthly > 0 && annual > 0 ? { monthly, annual } : null;
}

/** MRR = monthly subs × monthly price + annual subs × annual price ÷ 12, in dollars to the cent. */
export function mrr({ monthly, annual }, price) {
  return Math.round((monthly * price.monthly + (annual * price.annual) / 12) * 100) / 100;
}
export const dollars = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Trials that converted to a first paid charge ÷ trials that ended. null when none ended (never a fake 0%). */
export function trialRate(converted, ended) {
  if (!ended) return null;
  if (converted < 0 || converted > ended) throw new Error(`trial rate: ${converted} converted of ${ended} ended is impossible`);
  return Math.round((converted / ended) * 1000) / 10;
}

/** The exclusion list file: one email per line, # comments. */
export function parseExcludeList(text) {
  return new Set(String(text ?? "").split("\n").map((l) => l.replace(/#.*/, "").trim().toLowerCase()).filter((l) => l.includes("@")));
}
const TEST_EMAIL = /(\+test[^@]*@)|(@(example|test)\.[a-z]+$)|(@mailinator\.com$)/i;
const truthy = (v) => v === true || v === "true" || v === 1;
/** An auth user who is her own, or flagged test, or anonymous, is not a customer. */
export function isExcludedUser(u, excluded) {
  const email = String(u?.email ?? "").toLowerCase();
  if (email && excluded.has(email)) return true;
  if (email && TEST_EMAIL.test(email)) return true;
  if (u?.is_anonymous) return true;
  const am = u?.app_metadata ?? {}; const um = u?.user_metadata ?? {};
  return truthy(am.test) || truthy(am.is_test) || truthy(um.test) || truthy(um.is_test) || truthy(um.test_account);
}

/**
 * Paying vs in-trial, from the subscribers table. A subscribed row with a Stripe customer is paying
 * once its trial window (from the checkout moment, `updated_at`) has passed; inside it, it is in trial.
 */
export function countSubscribers(rows, { excludedIds, excludedEmails, trialDaysByUser = new Map(), now = Date.now() }) {
  const out = { monthly: 0, annual: 0, inTrial: 0, unknownTier: 0 };
  for (const r of rows) {
    if (!r?.subscribed || !r.stripe_customer_id) continue;
    if (excludedIds.has(r.user_id) || excludedEmails.has(String(r.email ?? "").toLowerCase())) continue;
    const started = Date.parse(r.updated_at ?? r.created_at ?? "");
    const days = trialDaysByUser.get(r.user_id) ?? DEFAULT_TRIAL_DAYS;
    if (!Number.isFinite(started) || now < started + days * DAY_MS) { out.inTrial++; continue; }
    if (r.subscription_tier === "annual") out.annual++;
    else if (r.subscription_tier === "monthly") out.monthly++;
    else out.unknownTier++;
  }
  return out;
}

/** New accounts by Central creation month: { this, last } for the month `now` is in and the one before. */
export function countSignups(users, { excluded, now = Date.now() }) {
  const thisKey = monthKey(now); const lastKey = previousMonthKey(thisKey);
  let thisMonth = 0; let lastMonth = 0;
  for (const u of users) {
    if (isExcludedUser(u, excluded)) continue;
    const k = monthKey(u.created_at);
    if (k === thisKey) thisMonth++; else if (k === lastKey) lastMonth++;
  }
  return { thisKey, lastKey, thisMonth, lastMonth };
}

/**
 * Live Stripe subscriptions → trial starts per month and trials converted ÷ ended per month.
 * Converted = the subscription went on to a paid period: still active, or cancelled after the trial
 * had already ended (it paid at least once). Ended = trial_end has passed and fell in that month.
 */
export function stripeTrials(subs, { excludedEmails, now = Date.now() }) {
  const thisKey = monthKey(now); const lastKey = previousMonthKey(thisKey);
  const blank = () => ({ starts: 0, ended: 0, converted: 0 });
  const by = { [thisKey]: blank(), [lastKey]: blank() };
  for (const s of subs) {
    if (s.livemode !== true) throw Object.assign(new Error("not read: Stripe returned a test-mode object; these numbers are live only"), { code: 4 });
    const email = String(s.customer?.email ?? "").toLowerCase();
    if (email && (excludedEmails.has(email) || TEST_EMAIL.test(email))) continue;
    if (!s.trial_start || !s.trial_end) continue;
    const startKey = monthKey(s.trial_start * 1000);
    if (by[startKey]) by[startKey].starts++;
    const endMs = s.trial_end * 1000;
    if (endMs > now) continue;
    const endKey = monthKey(endMs);
    if (!by[endKey]) continue;
    by[endKey].ended++;
    const paid = s.status === "active" || (s.status === "canceled" && s.canceled_at && s.canceled_at * 1000 > endMs + DAY_MS);
    if (paid) by[endKey].converted++;
  }
  return { thisKey, lastKey, by };
}

// ─── The cell words ──────────────────────────────────────────────────────────

export function payingWords(c) {
  const total = c.monthly + c.annual + c.unknownTier;
  const parts = [`${c.monthly} monthly`, `${c.annual} annual`];
  if (c.unknownTier) parts.push(`${c.unknownTier} plan unknown`);
  return `${total} (${parts.join(" · ")}); ${c.inTrial} more in trial`;
}
export function monthPairWords(thisN, lastN, thisKey, lastKey) {
  return `${thisN} in ${monthName(thisKey)} so far · ${lastN} in ${monthName(lastKey)}`;
}
export function rateWords(t) {
  const one = (k) => {
    const r = trialRate(t.by[k].converted, t.by[k].ended);
    return r === null ? `no trials ended in ${monthName(k)}` : `${r}% in ${monthName(k)} (${t.by[k].converted} of ${t.by[k].ended})`;
  };
  return `${one(t.thisKey)} · ${one(t.lastKey)}`;
}
/** A cell must never break the table: no pipes, no newlines. */
export const cell = (s) => String(s).replace(/\|/g, "/").replace(/\s*\n\s*/g, " ").trim();

/** Apply the five values to the brain and return the new Numbers section text. Only Value and day change. */
export function numbersSection(md, values, day) {
  let next = md;
  for (const [metric, value] of Object.entries(values)) next = setNumber(next, metric, cell(value), day);
  return sectionBody(next, "Numbers");
}

// ─── Sources (I/O, injectable) ───────────────────────────────────────────────

async function supabaseGet(path, key, fetchImpl) {
  const r = await fetchImpl(`${SUPABASE_URL}${path}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`not read: Supabase ${path.split("?")[0]} answered ${r.status}`);
  return r.json();
}

export async function readSupabase({ key, fetchImpl = fetch }) {
  const subscribers = await supabaseGet("/rest/v1/subscribers?select=*", key, fetchImpl);
  let redemptions = [];
  let redemptionsNote = null;
  try {
    redemptions = await supabaseGet("/rest/v1/access_code_redemptions?select=user_id,trial_days,status&status=eq.completed", key, fetchImpl);
  } catch (e) { redemptionsNote = e.message; }
  const users = [];
  for (let page = 1; page <= 100; page++) {
    const r = await supabaseGet(`/auth/v1/admin/users?page=${page}&per_page=1000`, key, fetchImpl);
    const batch = Array.isArray(r) ? r : (r.users ?? []);
    users.push(...batch);
    if (batch.length < 1000) break;
  }
  return { subscribers, redemptions, redemptionsNote, users };
}

export async function readStripe({ key, fetchImpl = fetch, since }) {
  const subs = [];
  let after = null;
  for (let i = 0; i < 50; i++) {
    const q = new URLSearchParams({ status: "all", limit: "100", "created[gte]": String(Math.floor(since / 1000)), "expand[]": "data.customer" });
    if (after) q.set("starting_after", after);
    const r = await fetchImpl(`https://api.stripe.com/v1/subscriptions?${q}`, { headers: { authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`not read: Stripe answered ${r.status}${r.status === 401 ? " (key rejected)" : r.status === 403 ? " (key lacks subscription read)" : ""}`);
    const body = await r.json();
    subs.push(...body.data);
    if (!body.has_more || !body.data.length) break;
    after = body.data[body.data.length - 1].id;
  }
  return subs;
}

/** Is this a live-mode Stripe key? (prefix only; the value itself is never printed.) */
export const isLiveStripeKey = (k) => /^(rk|sk)_live_/.test(String(k ?? ""));

// ─── The run ─────────────────────────────────────────────────────────────────

/** Read every source and return the five cell values. Each failure becomes that metric's named reason. */
export async function computeValues({ md, env = process.env, now = Date.now(), fetchImpl = fetch, excludeText, seen = {} }) {
  const values = {};
  const fail = (metrics, why) => { for (const m of metrics) values[m] = why.startsWith("not read:") ? why : `not read: ${why}`; };

  if (excludeText == null) {
    fail(Object.values(METRICS), `test-account list missing (${EXCLUDE_FILE.replace(homedir(), "~")}), so her own accounts would be counted`);
    return values;
  }
  const excluded = parseExcludeList(excludeText);

  // Supabase: paying, MRR, signups.
  const sbKey = env.DAILYSTORY_SUPABASE_SERVICE_ROLE_KEY;
  if (!sbKey) {
    fail([METRICS.paying, METRICS.mrr, METRICS.signups], "DAILYSTORY_SUPABASE_SERVICE_ROLE_KEY not in this run's environment (run through vault:run)");
  } else {
    try {
      const { subscribers, redemptions, users } = await readSupabase({ key: sbKey, fetchImpl });
      if (!users.length) throw new Error("not read: Supabase Auth returned no accounts at all");
      const excludedUsers = users.filter((u) => isExcludedUser(u, excluded));
      const excludedIds = new Set(excludedUsers.map((u) => u.id));
      const excludedEmails = new Set([...excluded, ...excludedUsers.map((u) => String(u.email ?? "").toLowerCase()).filter(Boolean)]);
      const trialDaysByUser = new Map(redemptions.filter((r) => r.trial_days > 0).map((r) => [r.user_id, r.trial_days]));
      const counts = countSubscribers(subscribers, { excludedIds, excludedEmails, trialDaysByUser, now });
      Object.assign(seen, { subscriber_rows: subscribers.length, subscribed_rows: subscribers.filter((r) => r?.subscribed).length, accounts: users.length, accounts_excluded: excludedUsers.length });
      values[METRICS.paying] = payingWords(counts);
      const price = parseListPrice(numbersRows(md).find((r) => /^list price$/i.test(r.metric))?.value);
      if (!price) values[METRICS.mrr] = "not read: the brain's List price row is not \"$monthly / $annual\"";
      else if (counts.unknownTier) values[METRICS.mrr] = `not read: ${counts.unknownTier} paying row(s) have no monthly/annual plan`;
      else values[METRICS.mrr] = `${dollars(mrr(counts, price))} at list price`;
      const s = countSignups(users, { excluded, now });
      values[METRICS.signups] = monthPairWords(s.thisMonth, s.lastMonth, s.thisKey, s.lastKey);
    } catch (e) {
      fail([METRICS.paying, METRICS.mrr, METRICS.signups], e.message);
    }
  }

  // Stripe (live only): trial starts and trial → paid rate.
  const stripeKey = env.T2R_STRIPE_LIVE_RESTRICTED_KEY;
  if (!stripeKey) {
    fail([METRICS.trialStarts, METRICS.trialRate], "needs a live Time-2-Read Stripe restricted key (T2R_STRIPE_LIVE_RESTRICTED_KEY) in the vault; the app tables do not keep trial history and the vault's T2R Stripe key is test mode");
  } else if (!isLiveStripeKey(stripeKey)) {
    fail([METRICS.trialStarts, METRICS.trialRate], "T2R_STRIPE_LIVE_RESTRICTED_KEY is not a live-mode key; test numbers are never shown as real ones");
  } else {
    try {
      const lastKey = previousMonthKey(monthKey(now));
      // Trials ending last month can have started up to two years (730-day codes) before; read wide.
      const since = Date.parse(`${lastKey}-01T00:00:00Z`) - 731 * DAY_MS;
      const subs = await readStripe({ key: stripeKey, fetchImpl, since });
      const t = stripeTrials(subs, { excludedEmails: excluded, now });
      values[METRICS.trialStarts] = monthPairWords(t.by[t.thisKey].starts, t.by[t.lastKey].starts, t.thisKey, t.lastKey);
      values[METRICS.trialRate] = rateWords(t);
    } catch (e) {
      fail([METRICS.trialStarts, METRICS.trialRate], e.message);
    }
  }
  return values;
}

async function unlock({ passcode, fetchImpl }) {
  if (!passcode) throw Object.assign(new Error("NAMED STOP [NO_PASSCODE] BOSS_PASSCODE is not set; the caller injects it from the vault."), { code: 3 });
  const u = await fetchImpl(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) });
  if (!u.ok) throw Object.assign(new Error(`NAMED STOP [UNLOCK_REFUSED] Boss OS refused the passcode (${u.status}).`), { code: 3 });
  return (u.headers.get("set-cookie") ?? "").split(";")[0];
}

export async function run({ dryRun = false, env = process.env, now = Date.now(), fetchImpl = fetch, excludeText = existsSync(EXCLUDE_FILE) ? readFileSync(EXCLUDE_FILE, "utf8") : null } = {}) {
  const cookie = await unlock({ passcode: env.BOSS_PASSCODE, fetchImpl });
  const g = await fetchImpl(`${ORIGIN}/api/boss/brains/${SLUG}`, { headers: { cookie } });
  if (!g.ok) throw Object.assign(new Error(`NAMED STOP [BRAIN_UNREAD] could not read the ${SLUG} brain (${g.status}).`), { code: 2 });
  const md = (await g.json()).data.body_md;
  const seen = {};
  const values = await computeValues({ md, env, now, fetchImpl, excludeText, seen });
  const day = centralDay(now);
  const text = numbersSection(md, values, day);
  if (!dryRun) {
    const p = await fetchImpl(`${ORIGIN}/api/boss/brains/${SLUG}`, {
      method: "PUT", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ section: "Numbers", text, note: "Weekly Time-2-Read numbers (t2r-numbers.mjs)" }),
    });
    if (!p.ok) throw Object.assign(new Error(`NAMED STOP [NOT_RECORDED] Boss OS did not keep the Numbers (${p.status}).`), { code: 2 });
  }
  return { values, day, seen };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dryRun = process.argv.includes("--dry-run");
  run({ dryRun })
    .then(({ values, day, seen }) => {
      if (Object.keys(seen).length) console.log(`read: ${Object.entries(seen).map(([k, v]) => `${k}=${v}`).join(" ")}`);
      for (const [m, v] of Object.entries(values)) console.log(`${m}: ${v}`);
      console.log(`${dryRun ? "dry run, not written" : `written to the ${SLUG} brain`} (${day})`);
    })
    .catch((e) => { console.error(e.message); process.exit(e.code ?? 1); });
}
