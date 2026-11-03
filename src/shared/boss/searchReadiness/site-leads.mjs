/**
 * THE LEADS LINE — did anyone reach or use the site's one action? (owner, 3 Nov 2026: approved).
 *
 * WHY: the Monday audit measured Google impressions and clicks per site (search-outcomes.mjs) but
 * nothing measured whether a visitor then asked, booked or bought. virtualagency-os.com (WPP-llm) had
 * Google clicks for months and zero inquiries, and nobody saw it.
 *
 * Each of HER OWN sites (sites.json category side_business or own_business) may carry a `lead_source`
 * naming where its one action is already counted in her stack (found by reading the site's repo):
 *
 *   d1                 a COUNT(*) on the site's own Cloudflare D1 database (one row, `n`, `:since_iso`)
 *   airtable           the lead table's record count, optionally narrowed by a formula (`where`)
 *   stripe | gumroad   sale counts through the integrations the Scorecard already reads
 *   t2r                Time-2-Read signups (the Supabase reader the brain's numbers use)
 *   cf_web_analytics   Cloudflare Web Analytics page views of the action's path (a thank-you page,
 *                      a /go/ hop, a download page), optionally only visits referred by this site
 *   none               not counted anywhere yet; `track_with` says what would count it
 *
 * Aggregates only: every reader returns one number; no name, address or row leaves its source.
 * CLIENT SITES ARE NEVER READ (category client): client data never feeds her businesses, so a client
 * site gets no leads entry at all, and a lead_source on a client row is a shape problem.
 *
 * The verdict for a site, last 28 days against the 28 before:
 *   "leads: N (was M)"                         read
 *   "leads: not tracked yet — <what would>"    no source (never 0)
 *   "leads: not read: <reason>"                a source that failed (never 0, never last week's)
 *   RED when Google sent at least LEADS.MIN_CLICKS (10) clicks in the last 28 days and the site's
 *   action counted zero: "people come, nobody acts". Fewer clicks with zero leads is a plain line
 *   that says "too few visits to judge".
 *
 * Pure. The reader is scripts/ops/lib/site-leads-read.mjs; the audit runner wires the two.
 * Pinned by tests/siteLeads.test.ts.
 */

/** Red needs at least MIN_CLICKS Google visits in the window (owner, 3 Nov 2026: one click is too weak). */
export const LEADS = Object.freeze({ WINDOW_DAYS: 28, MIN_CLICKS: 10 });
export const OWN_CATEGORIES = Object.freeze(["side_business", "own_business"]);
export const LEAD_KINDS = Object.freeze(["d1", "airtable", "stripe", "gumroad", "t2r", "cf_web_analytics", "none"]);

const DAY = 86_400_000;
const num = (n) => Number(n).toLocaleString("en-US");

/** Her own site: the only kind whose leads are ever read or reported. */
export const isOwnSite = (site) => OWN_CATEGORIES.includes(site?.category);

/** The two windows, the newest ending now: { current: {from, to}, previous: {from, to} } (ms). */
export function leadWindows(now = Date.now(), days = LEADS.WINDOW_DAYS) {
  const to = now, from = now - days * DAY;
  return { current: { from, to }, previous: { from: from - days * DAY, to: from }, days };
}

/** Shape problems in sites.json's lead_source entries, by name; empty = clean. */
export function leadSourceProblems(sitesJson) {
  const out = [];
  const sites = sitesJson?.grid_repos ?? [];
  const own = sites.filter(isOwnSite);
  if (!own.length) out.push("sites.json lists none of her own sites, so the leads line would examine nothing");
  for (const s of sites) {
    const src = s.lead_source;
    if (!isOwnSite(s)) { if (src !== undefined) out.push(`${s.domain}: a ${s.category} site carries a lead_source; client sites are never read`); continue; }
    if (src === undefined) continue; // optional: the line says "not tracked yet"
    if (!LEAD_KINDS.includes(src?.kind)) { out.push(`${s.domain}: lead_source kind "${src?.kind}" is not one of ${LEAD_KINDS.join(", ")}`); continue; }
    if (!String(src.action ?? "").trim()) out.push(`${s.domain}: lead_source names no action (what one counted lead is)`);
    if (src.kind === "none") { if (!String(src.track_with ?? "").trim()) out.push(`${s.domain}: lead_source none says nothing about what would track it`); continue; }
    if (!String(src.code ?? "").trim()) out.push(`${s.domain}: lead_source cites no code that records the action`);
    const p = src.params ?? {};
    if (src.kind === "d1" && (!p.db || !/:since_iso|:since_ms/.test(String(p.sql ?? "")) || !/\bAS n\b/i.test(String(p.sql ?? "")))) out.push(`${s.domain}: a d1 lead source needs db and a COUNT … AS n with :since_iso`);
    if (src.kind === "d1" && !/^\s*SELECT\s+COUNT\(/i.test(String(p.sql ?? ""))) out.push(`${s.domain}: a d1 lead source must select one count, never a row of data`);
    if (src.kind === "airtable" && (!p.key || !p.base || !p.table)) out.push(`${s.domain}: an airtable lead source needs key, base and table`);
    if (src.kind === "stripe" && !p.key) out.push(`${s.domain}: a stripe lead source needs the vault key name`);
    if (src.kind === "t2r" && p.metric !== "signups" && p.metric !== "paid") out.push(`${s.domain}: a t2r lead source counts signups or paid`);
    if (src.kind === "cf_web_analytics" && (!p.host || !Array.isArray(p.paths) || !p.paths.length)) out.push(`${s.domain}: a cf_web_analytics lead source needs host and paths`);
  }
  return out;
}

/**
 * The verdict for one site.
 *   site: the sites.json row; read: { ok: true, current, previous, note? } or { ok: false, why };
 *   outcome: search-outcomes.mjs outcomeVerdict (for the clicks), or undefined.
 * → { status: "read" | "not_tracked" | "not_read", current?, previous?, red, line, action, why? }
 * A client site → null: it is never read and never reported.
 */
export function leadVerdict({ site, read, outcome } = {}) {
  if (!isOwnSite(site)) return null;
  const src = site.lead_source;
  const action = src?.action ?? "the site's one action";
  if (!src || src.kind === "none") {
    const what = src?.track_with || "name the site's one action and where it is counted (lead_source in sites.json)";
    return { status: "not_tracked", red: false, action, line: `leads: not tracked yet — ${what}` };
  }
  if (!read?.ok) return { status: "not_read", red: false, action, why: read?.why || "the source was not read", line: `leads: not read: ${read?.why || "the source was not read"}` };
  const current = Number(read.current), previous = Number(read.previous);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { status: "not_read", red: false, action, why: "the source answered without a number", line: "leads: not read: the source answered without a number" };
  const clicks = outcome?.status && outcome.status !== "not_read" ? Number(outcome.current?.clicks ?? 0) : null;
  const red = clicks != null && clicks >= LEADS.MIN_CLICKS && current === 0;
  const tooFew = clicks != null && clicks < LEADS.MIN_CLICKS && current === 0;
  return {
    status: "read", red, action, current, previous, clicks, note: read.note ?? null,
    line: `leads: ${num(current)} (was ${num(previous)})${tooFew ? " — too few visits to judge" : ""}`,
  };
}

/** The red line for a site whose visitors come and nobody acts; null otherwise. */
export function leadRedLine(site, v) {
  if (!v?.red) return null;
  return `${site.domain}: Google sent ${num(v.clicks)} visit${v.clicks === 1 ? "" : "s"} in the last four weeks and nobody used its one action (${v.action}: 0) — people come, nobody acts.`;
}

/**
 * The Monday email's leads line(s) for "The grid repos": her own sites only, next to Google's
 * clicks. One line for what was counted, one for what is not counted yet or not read.
 */
export function leadsMorningLines(siteResults, { max = 8 } = {}) {
  const own = (siteResults ?? []).filter((s) => s.leads && isOwnSite(s.site));
  if (!own.length) return [];
  const read = own.filter((s) => s.leads.status === "read").sort((a, b) => (b.leads.clicks ?? 0) - (a.leads.clicks ?? 0) || b.leads.current - a.leads.current);
  const untracked = own.filter((s) => s.leads.status === "not_tracked").map((s) => s.site.domain);
  const unread = own.filter((s) => s.leads.status === "not_read");
  const out = [];
  if (read.length) {
    const parts = read.slice(0, max).map((s) => `${s.site.domain} ${s.leads.clicks != null ? `${num(s.leads.clicks)} Google visits → ` : ""}${num(s.leads.current)} (was ${num(s.leads.previous)})`);
    out.push(`Leads, last four weeks: ${parts.join("; ")}${read.length > max ? `; and ${read.length - max} more on the checklist page` : ""}.`);
  }
  const rest = [];
  if (untracked.length) rest.push(`not tracked yet on ${untracked.length} site${untracked.length === 1 ? "" : "s"} (${untracked.slice(0, 3).join(", ")}${untracked.length > 3 ? ", …" : ""})`);
  if (unread.length) rest.push(`not read this week on ${unread.map((s) => `${s.site.domain} (${s.leads.why})`).slice(0, 2).join(", ")}${unread.length > 2 ? `, and ${unread.length - 2} more` : ""}`);
  if (rest.length) out.push(`Leads ${rest.join("; ")}.`);
  return out;
}
