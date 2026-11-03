/**
 * THE LEADS READER — one count per own site for each 28-day window (site-leads.mjs has the rules).
 *
 * Every source here returns ONE number per window, never a row: the count kinds reuse the
 * Scorecard's readers (scripts/ops/lib/scorecard-readers.mjs: d1, airtable, stripe, gumroad, t2r),
 * read for 56 and 28 days back, the earlier window being the difference; Cloudflare Web Analytics is
 * asked for each window's page-view count directly.
 *
 * A client site is never read: `readLeads` refuses before any request exists (client data never
 * feeds her businesses). A source that fails comes back { ok: false, why } — the line then says
 * "not read: <why>", never 0.
 *
 * Runs on her Mac inside the Monday audit (`npm run sites:audit`, through the vault), where
 * CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID and the Scorecard's keys live; nothing is printed.
 */
import { READERS } from "./scorecard-readers.mjs";
import { isOwnSite, leadWindows, LEADS } from "../../../src/shared/boss/searchReadiness/site-leads.mjs";

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
const short = (e) => String(e?.message ?? e).replace(/^NAMED STOP \[[A-Z_]+\]\s*/, "").slice(0, 160);

/** Cloudflare Web Analytics: the site tag for a host (zone auto-install or a manual beacon site). */
const rumSites = new WeakMap();
async function rumSiteTag(ctx, host) {
  let list = rumSites.get(ctx);
  if (!list) {
    const acct = ctx.env.CLOUDFLARE_ACCOUNT_ID, tok = ctx.env.CLOUDFLARE_API_TOKEN;
    if (!acct || !tok) throw new Error("CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not in this process (run through the vault)");
    list = [];
    for (let page = 1; page < 10; page++) {
      const r = await ctx.fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/rum/site_info/list?per_page=100&page=${page}`, { headers: { authorization: `Bearer ${tok}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) throw new Error(`Cloudflare refused the Web Analytics site list (${r.status})`);
      list.push(...(j.result ?? []));
      if ((j.result ?? []).length < 100) break;
    }
    rumSites.set(ctx, list);
  }
  const bare = String(host).replace(/^www\./, "");
  const hit = list.find((s) => [s.host, s.ruleset?.zone_name].map((h) => String(h ?? "").replace(/^www\./, "")).includes(bare));
  if (!hit) throw new Error(`${host} has no Cloudflare Web Analytics site`);
  return hit.site_tag;
}

/** Page views of `paths` on `host` between from and to (ms); `referer_host` keeps only visits sent by that site. */
export async function rumCount(ctx, params, from, to) {
  const tag = await rumSiteTag(ctx, params.host);
  const pathOr = params.paths.map((p) => (p.endsWith("*") ? { requestPath_like: `${p.slice(0, -1)}%` } : { requestPath: p }));
  const refs = params.referer_host ? [params.referer_host, `www.${String(params.referer_host).replace(/^www\./, "")}`] : null;
  const filter = {
    AND: [
      { siteTag: tag, datetime_geq: new Date(from).toISOString(), datetime_lt: new Date(to).toISOString() },
      { OR: pathOr },
      ...(refs ? [{ OR: refs.map((h) => ({ refererHost: h })) }] : []),
    ],
  };
  const query = "query($a:String!,$f:AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject){viewer{accounts(filter:{accountTag:$a}){rumPageloadEventsAdaptiveGroups(limit:1,filter:$f){count}}}}";
  const r = await ctx.fetch(GRAPHQL, { method: "POST", headers: { authorization: `Bearer ${ctx.env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query, variables: { a: ctx.env.CLOUDFLARE_ACCOUNT_ID, f: filter } }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors?.length) throw new Error(`Cloudflare Web Analytics answered ${r.status}${j.errors?.length ? `: ${String(j.errors[0].message).slice(0, 100)}` : ""}`);
  const rows = j.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups;
  if (!Array.isArray(rows)) throw new Error("Cloudflare Web Analytics answered without a count");
  return rows.reduce((n, x) => n + Number(x.count || 0), 0);
}

/**
 * One own site's leads: { ok: true, current, previous, note? } | { ok: false, why } | null (no source:
 * the verdict says "not tracked yet"). Throws only for a client site — a caller bug, never a quiet skip.
 */
export async function readLeads(site, ctx) {
  if (!isOwnSite(site)) throw new Error(`readLeads refused ${site?.domain}: a ${site?.category} site is never read`);
  const src = site.lead_source;
  if (!src || src.kind === "none") return null;
  try {
    const w = leadWindows(ctx.now);
    if (src.kind === "cf_web_analytics") {
      const [current, previous] = [await rumCount(ctx, src.params, w.current.from, w.current.to), await rumCount(ctx, src.params, w.previous.from, w.previous.to)];
      return { ok: true, current, previous, note: "Cloudflare Web Analytics page views (sampled on small sites)" };
    }
    const fn = READERS[src.kind];
    if (!fn) return { ok: false, why: `no reader for ${src.kind}` };
    const at = async (days) => {
      const r = await fn({ ...src.params, days }, ctx);
      if (r.raw == null || !Number.isFinite(Number(r.raw))) throw new Error("the source answered without a number");
      return Number(r.raw);
    };
    const n28 = await at(LEADS.WINDOW_DAYS), n56 = await at(2 * LEADS.WINDOW_DAYS);
    if (n56 < n28) return { ok: false, why: "the two windows disagree (fewer in 56 days than in 28)" };
    return { ok: true, current: n28, previous: n56 - n28 };
  } catch (e) {
    return { ok: false, why: short(e) };
  }
}
