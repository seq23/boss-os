/**
 * THE SCORECARD'S READERS — one function per reader id a scorecard row may name
 * (src/shared/boss/scorecard/scorecard.mjs READER_IDS; tests/scorecard.test.ts pins that both lists match).
 *
 * Each reader takes the row's `params` and a context `{ env, now, fetch, gh, home }` and returns
 * `{ raw, at? }`: one number (or, for a start condition, a date), never a name, an address or a row of
 * data. Counts only: LP, prospect and customer names never leave their source.
 *
 * A source that cannot be read THROWS a NamedStop: `NAMED STOP [CODE] what happened`. A key the vault
 * does not hold is `KEY_MISSING` and names the key, so the row shows "No number" with the key to add.
 * A report older than the row allows is `SOURCE_STALE` — an old number is never passed off as this week's.
 *
 * Runs on her Mac through the vault (`npm run scorecard:monday`), where every key lives.
 */
import { createSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DAY_MS } from "../../../src/shared/boss/scorecard/scorecard.mjs";
import { readSupabase, parseExcludeList, isExcludedUser, EXCLUDE_FILE, DEFAULT_TRIAL_DAYS } from "../../brains/t2r-numbers.mjs";

export class NamedStop extends Error {
  constructor(code, sentence) { super(`NAMED STOP [${code}] ${sentence}`); this.code = code; }
}
const need = (env, key) => {
  if (!env[key]) throw new NamedStop("KEY_MISSING", `${key} is not in the Boss OS vault, so this number cannot be read. Add it with vault:set ${key}.`);
  return env[key];
};
const sinceMs = (now, days) => now - days * DAY_MS;
const sinceIso = (now, days) => new Date(sinceMs(now, days)).toISOString().replace("T", " ").slice(0, 19);

// ─── Cloudflare D1 (counts from her own databases, read-only) ─────────────────────────────────────

const dbIds = new Map();
async function d1Query(ctx, db, sql) {
  const acct = need(ctx.env, "CLOUDFLARE_ACCOUNT_ID");
  const tok = need(ctx.env, "CLOUDFLARE_API_TOKEN");
  const h = { authorization: `Bearer ${tok}`, "content-type": "application/json" };
  if (!dbIds.size) {
    const r = await ctx.fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database?per_page=100`, { headers: h });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new NamedStop("D1_UNREADABLE", `Cloudflare refused the database list (${r.status}).`);
    for (const d of j.result ?? []) dbIds.set(d.name, d.uuid);
  }
  const id = dbIds.get(db);
  if (!id) throw new NamedStop("D1_NOT_FOUND", `no database named ${db} in the Cloudflare account.`);
  const r = await ctx.fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${id}/query`, { method: "POST", headers: h, body: JSON.stringify({ sql }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new NamedStop("D1_QUERY_FAILED", `${db}: ${String(j?.errors?.[0]?.message ?? r.status).slice(0, 160)}`);
  return j.result?.[0]?.results ?? [];
}

/** `params.sql` returns one row with `n`. `:since_ms` / `:since_iso` are `params.days` before now. */
export function d1Sql(params, now) {
  let sql = String(params.sql);
  if (/:since_(ms|iso)/.test(sql)) {
    if (!params.days) throw new NamedStop("ROW_SHAPE", "the query uses a window but the row gives no days.");
    sql = sql.replaceAll(":since_ms", String(sinceMs(now, params.days))).replaceAll(":since_iso", `'${sinceIso(now, params.days)}'`);
  }
  return sql;
}

async function d1(params, ctx) {
  const rows = await d1Query(ctx, params.db, d1Sql(params, ctx.now));
  if (rows.length !== 1 || !("n" in rows[0])) throw new NamedStop("D1_SHAPE", `${params.db} returned ${rows.length} rows, not one number.`);
  const n = rows[0].n;
  return { raw: n == null ? null : typeof n === "number" ? n : /^\d{4}-\d\d-\d\d/.test(String(n)) ? String(n) : Number(n) };
}

// ─── Google (Search Console through the service account) ──────────────────────────────────────────

const b64url = (b) => Buffer.from(b).toString("base64url");
export async function googleAccess(ctx, scope, sub = null) {
  const raw = need(ctx.env, "GSC_SERVICE_ACCOUNT_JSON");
  const creds = JSON.parse(raw);
  const t = Math.floor(ctx.now / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: creds.client_email, ...(sub ? { sub } : {}), scope, aud: "https://oauth2.googleapis.com/token", iat: t, exp: t + 3600 }));
  const s = createSign("RSA-SHA256"); s.update(`${head}.${claims}`);
  const r = await ctx.fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${b64url(s.sign(creds.private_key))}` }) });
  if (!r.ok) throw new NamedStop("GOOGLE_REFUSED", `Google refused the service account (${r.status}).`);
  return (await r.json()).access_token;
}

/** The Spry Labs sites, from the one list (src/shared/boss/searchReadiness/sites.json), never retyped here. */
export function spryLabsDomains(sitesJson) {
  return (sitesJson.grid_repos ?? []).filter((s) => s.entity_parent === "spry-labs" && s.category !== "client" && !/^(time-2-read|heygetonmylevel)\.com$/.test(s.domain)).map((s) => s.domain);
}

async function gsc(params, ctx) {
  const tok = await googleAccess(ctx, "https://www.googleapis.com/auth/webmasters.readonly");
  const h = { authorization: `Bearer ${tok}`, "content-type": "application/json" };
  const list = await ctx.fetch("https://www.googleapis.com/webmasters/v3/sites", { headers: h }).then((r) => r.json());
  const have = new Set((list.siteEntry ?? []).map((s) => s.siteUrl));
  const domains = params.sites ?? spryLabsDomains(ctx.sites);
  if (!domains.length) throw new NamedStop("GSC_NO_SITES", "the row names no site.");
  // Search Console lags about three days; the window ends there so a fresh week is not read as empty.
  const end = new Date(ctx.now - 3 * DAY_MS).toISOString().slice(0, 10);
  const start = new Date(ctx.now - (3 + params.days) * DAY_MS).toISOString().slice(0, 10);
  let total = 0; const unread = [];
  for (const d of domains) {
    const site = [`sc-domain:${d}`, `https://${d}/`, `https://www.${d}/`].find((s) => have.has(s));
    if (!site) { unread.push(d); continue; }
    const r = await ctx.fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, { method: "POST", headers: h, body: JSON.stringify({ startDate: start, endDate: end }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { unread.push(d); continue; }
    total += Number(j.rows?.[0]?.[params.metric] ?? 0);
  }
  if (unread.length === domains.length) throw new NamedStop("GSC_UNREADABLE", `Search Console would not give numbers for ${unread.join(", ")}.`);
  return { raw: total, note: unread.length ? `not read: ${unread.join(", ")}` : undefined };
}

// ─── Gumroad, Stripe, Airtable ────────────────────────────────────────────────────────────────────

async function gumroad(params, ctx) {
  const tok = need(ctx.env, "GUMROAD_ACCESS_TOKEN");
  const after = new Date(sinceMs(ctx.now, params.days)).toISOString().slice(0, 10);
  let url = `https://api.gumroad.com/v2/sales?after=${after}`; let n = 0;
  for (let page = 0; url && page < 50; page++) {
    const r = await ctx.fetch(url, { headers: { authorization: `Bearer ${tok}` } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new NamedStop("KEY_REFUSED", "Gumroad refused GUMROAD_ACCESS_TOKEN (401).");
    if (!r.ok || !j.success) throw new NamedStop("GUMROAD_UNREADABLE", `Gumroad sales did not load (${r.status}).`);
    for (const s of j.sales ?? []) if ((Number(s.price) > 0) === (params.kind === "paid") && !s.refunded) n++;
    url = j.next_page_url ? `https://api.gumroad.com${j.next_page_url}` : null;
  }
  return { raw: n };
}

async function stripe(params, ctx) {
  const key = need(ctx.env, params.key);
  const since = Math.floor(sinceMs(ctx.now, params.days) / 1000);
  let n = 0; let after = null;
  for (let page = 0; page < 20; page++) {
    const r = await ctx.fetch(`https://api.stripe.com/v1/charges?limit=100&created[gte]=${since}${after ? `&starting_after=${after}` : ""}`, { headers: { authorization: `Bearer ${key}` } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new NamedStop("KEY_REFUSED", `Stripe refused ${params.key} (401).`);
    if (!r.ok) throw new NamedStop("STRIPE_UNREADABLE", `Stripe charges did not load (${r.status}).`);
    for (const c of j.data ?? []) if (c.paid && c.status === "succeeded" && !c.refunded && c.livemode) n++;
    if (!j.has_more) break;
    after = j.data.at(-1).id;
  }
  return { raw: n };
}

async function airtable(params, ctx) {
  const tok = need(ctx.env, params.key);
  const formula = `IS_AFTER(CREATED_TIME(), DATEADD(NOW(), -${Number(params.days)}, 'days'))`;
  let n = 0; let offset = null;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ filterByFormula: formula, pageSize: "100", ...(offset ? { offset } : {}) });
    const r = await ctx.fetch(`https://api.airtable.com/v0/${params.base}/${encodeURIComponent(params.table)}?${q}`, { headers: { authorization: `Bearer ${tok}` } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) throw new NamedStop("KEY_REFUSED", `Airtable refused ${params.key} for the lead table (${r.status}).`);
    if (!r.ok) throw new NamedStop("AIRTABLE_UNREADABLE", `Airtable did not load the lead table (${r.status} ${String(j?.error?.type ?? "").slice(0, 60)}).`);
    n += (j.records ?? []).length;
    offset = j.offset ?? null;
    if (!offset) break;
  }
  return { raw: n };
}

// ─── Reports her repos already publish ────────────────────────────────────────────────────────────

export function pick(obj, path) {
  return String(path).split(".").reduce((o, k) => (o == null ? undefined : o[/^\d+$/.test(k) ? Number(k) : k]), obj);
}

async function repoJson(params, ctx) {
  const vals = [];
  for (const f of params.files) {
    let text;
    try { text = ctx.gh(["api", `repos/seq23/${f.repo}/contents/${f.path}`, "-H", "Accept: application/vnd.github.raw"]); }
    catch { throw new NamedStop("REPORT_MISSING", `${f.repo} has no ${f.path} on its default branch.`); }
    let j; try { j = JSON.parse(text); } catch { throw new NamedStop("REPORT_UNREADABLE", `${f.repo}'s report is not JSON.`); }
    const v = Number(pick(j, f.field));
    if (!Number.isFinite(v)) throw new NamedStop("REPORT_EMPTY", `${f.repo}'s report has no number at ${f.field}.`);
    if (params.maxAgeDays && f.at) {
      const at = Date.parse(pick(j, f.at));
      if (!Number.isFinite(at) || ctx.now - at > params.maxAgeDays * DAY_MS) throw new NamedStop("SOURCE_STALE", `${f.repo}'s report is older than ${params.maxAgeDays} days.`);
    }
    vals.push(v);
  }
  const combine = params.combine ?? "sum";
  return { raw: combine === "min" ? Math.min(...vals) : vals.reduce((a, b) => a + b, 0) };
}

// ─── Files Boss OS jobs keep on her Mac (counts only) ─────────────────────────────────────────────

function lpOutcomes(params, ctx) {
  const file = join(ctx.home, ".boss-os", "lp", "outcomes.json");
  if (!existsSync(file)) throw new NamedStop("LP_OUTCOMES_MISSING", "the weekly LP outcomes count has not been written on this Mac.");
  const o = JSON.parse(readFileSync(file, "utf8"));
  const at = Date.parse(o.generated_at);
  if (!Number.isFinite(at) || ctx.now - at > (params.maxAgeDays ?? 9) * DAY_MS) throw new NamedStop("SOURCE_STALE", "the LP outcomes count is more than a week old.");
  // `replied` is the list of everyone who has replied (its length only — never a name); `tally` is what changed in one run.
  const sent = Number(o.sent_rows); const replied = Array.isArray(o.replied) ? o.replied.length : NaN;
  if (!Number.isFinite(sent) || !Number.isFinite(replied)) throw new NamedStop("REPORT_EMPTY", "the LP outcomes count has no sent or replied total.");
  return { raw: sent > 0 ? Math.round((1000 * replied) / sent) / 10 : null };
}

function kdpUnits(params, ctx) {
  const file = join(ctx.home, ".boss-os", "kdp", "units.json");
  if (!existsSync(file)) throw new NamedStop("KDP_UNITS_NOT_RECORDED", "Simone's monthly KDP check has not recorded units sold yet (~/.boss-os/kdp/units.json: { at, days: { \"YYYY-MM-DD\": units } }).");
  const o = JSON.parse(readFileSync(file, "utf8"));
  const at = Date.parse(o.at);
  if (!Number.isFinite(at) || ctx.now - at > (params.maxAgeDays ?? 35) * DAY_MS) throw new NamedStop("SOURCE_STALE", "the KDP units count is more than a month old.");
  const since = new Date(sinceMs(ctx.now, params.days)).toISOString().slice(0, 10);
  return { raw: Object.entries(o.days ?? {}).filter(([d]) => d >= since).reduce((a, [, u]) => a + Number(u || 0), 0) };
}

async function t2r(params, ctx) {
  const key = need(ctx.env, "DAILYSTORY_SUPABASE_SERVICE_ROLE_KEY");
  if (!existsSync(EXCLUDE_FILE)) throw new NamedStop("T2R_TEST_LIST_MISSING", "the Time-2-Read test-account list is not on this Mac, so her own accounts would be counted.");
  const excluded = parseExcludeList(readFileSync(EXCLUDE_FILE, "utf8"));
  const { subscribers, redemptions, users } = await readSupabase({ key, fetchImpl: ctx.fetch });
  if (!users.length) throw new NamedStop("REPORT_EMPTY", "Supabase returned no accounts at all.");
  const since = sinceMs(ctx.now, params.days);
  if (params.metric === "signups") return { raw: users.filter((u) => !isExcludedUser(u, excluded) && Date.parse(u.created_at) >= since).length };
  const bad = new Set(users.filter((u) => isExcludedUser(u, excluded)).map((u) => u.id));
  const trial = new Map(redemptions.filter((r) => r.trial_days > 0).map((r) => [r.user_id, r.trial_days]));
  // A parent becomes paying when the trial after checkout ends (the same rule as t2r-numbers' countSubscribers).
  const n = subscribers.filter((r) => {
    if (!r?.subscribed || !r.stripe_customer_id || bad.has(r.user_id)) return false;
    const paidFrom = Date.parse(r.updated_at ?? r.created_at ?? "") + (trial.get(r.user_id) ?? DEFAULT_TRIAL_DAYS) * DAY_MS;
    return paidFrom >= since && paidFrom <= ctx.now;
  }).length;
  return { raw: n };
}

async function sum(params, ctx) {
  let total = 0;
  for (const p of params.of) { const r = await READERS[p.reader](p.params, ctx); total += Number(r.raw ?? 0); }
  return { raw: total };
}

export const READERS = Object.freeze({
  d1, gsc, gumroad, stripe, airtable, "repo-json": repoJson, "lp-outcomes": lpOutcomes, t2r, "kdp-units": kdpUnits, sum,
});

/** The default context on her Mac. */
export function macContext({ env = process.env, now = Date.now(), sites } = {}) {
  return {
    env, now, sites, home: homedir(), fetch: globalThis.fetch,
    gh: (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 << 20 }),
  };
}

/** Read one metric: `{ raw, error }`, never throwing. */
export async function readMetric(metric, ctx) {
  try {
    const fn = READERS[metric.reader];
    if (!fn) throw new NamedStop("UNKNOWN_READER", `no reader named ${metric.reader}.`);
    const r = await fn(metric.params ?? {}, ctx);
    return { raw: r.raw ?? null, note: r.note ?? null, error: null };
  } catch (e) {
    const msg = String(e?.message ?? e);
    return { raw: null, error: msg.startsWith("NAMED STOP") ? msg : `NAMED STOP [SOURCE_FAILED] ${msg.slice(0, 200)}` };
  }
}
