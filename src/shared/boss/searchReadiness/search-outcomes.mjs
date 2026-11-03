/**
 * THE OUTCOME ALARM — did Google keep showing the site? (owner, 2 Nov 2026: "go").
 *
 * WHY: virtualagency-os.com (WPP-llm) lost ~99% of its Google impressions on 25-26 Aug 2026 (≈190 a
 * day to 1-4 a day) and nothing noticed for ten weeks. The Monday audit scored it 53 checks, 0
 * failing, because every check asks whether a thing is PRESENT (a sitemap, a schema node, a title),
 * never whether search still SHOWS the site. This module asks that, from Search Console's own numbers:
 *
 *   RED when, last 28 days against the 28 before them,
 *     - impressions fell more than half and the earlier window had at least MIN_PRIOR_IMPRESSIONS, or
 *     - clicks fell more than half and the earlier window had at least MIN_PRIOR_CLICKS, or
 *     - the site lists at least DENSITY_MIN_URLS pages in its sitemap and earned fewer than one
 *       impression per ten pages in the last 28 days (a big site Google has stopped showing: a cliff
 *       that happened before both windows still reads red).
 *   NOT READ when the numbers could not be read: said as "not read: <reason>", never 0, never silent.
 *
 * Pure: the audit runner (scripts/ops/search-readiness-audit.mjs, `readOutcomes`) is the ONE reader
 * (the gsc-bot service account from the vault, read-only scope, one query per site) and hands the
 * daily rows here. Proven by tests/searchOutcomes.test.ts with the real WPP-llm August rows (red) and
 * a steady site (green).
 *
 * Also here: the red lines that head the Monday email and the weekly briefs (outcome, quality,
 * consolidation) that go into fix-queue.json. They never block: no checklist item fails because of
 * them, and the repair run works each brief once a week (disposition "weekly", `--plan` ONCE lines).
 */
import { mayAutoFix } from "../siteAudit/repoPolicy.mjs";
import { isOwnSite, leadRedLine } from "./site-leads.mjs";

export const OUTCOME = Object.freeze({
  WINDOW_DAYS: 28,
  /** Search Console's numbers settle about three days late; the newest window ends three days ago. */
  LAG_DAYS: 3,
  DROP: 0.5,
  MIN_PRIOR_IMPRESSIONS: 50,
  MIN_PRIOR_CLICKS: 10,
  DENSITY_MIN_URLS: 200,
  /** One impression per ten pages per 28 days. */
  DENSITY_PER_PAGE: 0.1,
});

const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const num = (n) => Number(n).toLocaleString("en-US");

/** The two windows, newest ending LAG_DAYS before `now`: { current, previous, start, end } (ISO days). */
export function outcomeWindows(now = Date.now(), { days = OUTCOME.WINDOW_DAYS, lag = OUTCOME.LAG_DAYS } = {}) {
  const end = Date.parse(iso(now)) - lag * DAY;
  const curStart = end - (days - 1) * DAY;
  const prevEnd = curStart - DAY, prevStart = prevEnd - (days - 1) * DAY;
  return {
    current: { start: iso(curStart), end: iso(end) },
    previous: { start: iso(prevStart), end: iso(prevEnd) },
    start: iso(prevStart), end: iso(end),
  };
}

/** Sum daily rows ({ date, impressions, clicks }) inside a window, inclusive. */
export function sumWindow(rows, w) {
  let impressions = 0, clicks = 0, days = 0;
  for (const r of rows ?? []) {
    const d = String(r.date ?? r.keys?.[0] ?? "");
    if (d >= w.start && d <= w.end) { impressions += Number(r.impressions) || 0; clicks += Number(r.clicks) || 0; days++; }
  }
  return { impressions, clicks, days };
}

/**
 * The verdict for one site.
 *   read: { ok: true, rows } or { ok: false, why }
 *   sitemapUrls: how many URLs the live sitemap lists (null = unknown; the density rule then sits out)
 * → { status: "red" | "green" | "not_read", current, previous, windows, reasons[], why? }
 */
export function outcomeVerdict({ read, sitemapUrls = null, now = Date.now() } = {}) {
  const windows = outcomeWindows(now);
  if (!read?.ok) return { status: "not_read", windows, reasons: [], why: read?.why || "Search Console was not read" };
  if (!Array.isArray(read.rows)) return { status: "not_read", windows, reasons: [], why: "Search Console answered without daily rows" };
  const current = sumWindow(read.rows, windows.current), previous = sumWindow(read.rows, windows.previous);
  const reasons = [];
  const fell = (now_, before) => before > 0 && now_ < before * (1 - OUTCOME.DROP);
  if (previous.impressions >= OUTCOME.MIN_PRIOR_IMPRESSIONS && fell(current.impressions, previous.impressions)) {
    reasons.push({ rule: "impressions_drop", text: `Google showed it ${num(current.impressions)} times in the last four weeks, down from ${num(previous.impressions)} (${pct(current.impressions, previous.impressions)})` });
  }
  if (previous.clicks >= OUTCOME.MIN_PRIOR_CLICKS && fell(current.clicks, previous.clicks)) {
    reasons.push({ rule: "clicks_drop", text: `visits from Google fell to ${num(current.clicks)} from ${num(previous.clicks)} (${pct(current.clicks, previous.clicks)})` });
  }
  const urls = Number(sitemapUrls);
  if (Number.isFinite(urls) && urls >= OUTCOME.DENSITY_MIN_URLS && current.impressions < urls * OUTCOME.DENSITY_PER_PAGE) {
    reasons.push({ rule: "density", text: `${num(urls)} pages earned ${num(current.impressions)} Google showings in four weeks (fewer than one per ten pages)` });
  }
  return { status: reasons.length ? "red" : "green", windows, current, previous, sitemapUrls: Number.isFinite(urls) ? urls : null, reasons };
}

const pct = (a, b) => `${Math.round((1 - a / b) * 100)}% down`;

// ─── Red lines and weekly briefs ─────────────────────────────────────────────

/**
 * The red lines for the top of the Monday email and report, one per site per kind, plain words.
 * `siteResults[i]` carries `.outcome` (outcomeVerdict), `.quality` (page-quality-sample) and
 * `.consolidation` (consolidation-queue). An outcome NOT READ for every site is one red line of its own
 * (Rule 0: the alarm went blind); one site not read is said in that site's report row, not here.
 */
export function redLines(siteResults) {
  const out = [];
  const all = siteResults ?? [];
  for (const s of all) {
    const d = s.site?.domain ?? s.host;
    if (s.outcome?.status === "red") out.push({ domain: d, kind: "outcome", line: `${d}: ${s.outcome.reasons.map((r) => r.text).join("; ")}. Danielle is looking into why.` });
    if (s.quality?.red) out.push({ domain: d, kind: "quality", line: `${d}: ${s.quality.line}` });
    // Leads (3 Nov 2026): clicks but nobody used the one action. Her own sites only.
    const lead = isOwnSite(s.site) ? leadRedLine(s.site, s.leads) : null;
    if (lead) out.push({ domain: d, kind: "leads", line: lead });
  }
  const outcomes = all.filter((s) => s.outcome);
  if (outcomes.length && outcomes.every((s) => s.outcome.status === "not_read")) {
    const why = [...new Set(outcomes.map((s) => s.outcome.why))].slice(0, 2).join("; ");
    out.unshift({ domain: null, kind: "outcome_blind", line: `Google's numbers were not read for any site this week (${why}), so a drop would not have been seen. The team is fixing it.` });
  }
  return out;
}

/** The same disposition rule as every other brief: no repo, a client's report-only repo, or weekly. */
const dispositionOf = (site) => (!site?.repo ? "no_repo" : !mayAutoFix(site.repo) ? "client_repo" : "weekly");

/**
 * One brief per red outcome, per site whose quality sample found pages to fix, and per hub the
 * consolidation queue suggests. Never a deletion: a fold brief moves a page's useful words into its
 * hub with a 301 and drops it from the sitemap.
 */
export function weeklyBriefs(siteResults, { now = Date.now() } = {}) {
  const at = new Date(now).toISOString();
  const briefs = [];
  for (const s of siteResults ?? []) {
    const site = s.site ?? {};
    const base = { created_at: at, domain: site.domain, canonical_host: s.host, repo: site.repo ?? null, category: site.category, protected: null, missing_urls: [], disposition: dispositionOf(site) };
    if (s.outcome?.status === "red") {
      briefs.push({
        ...base, id: `so-${site.domain}-outcome`, kind: "outcome", item_id: "o1", item_title: "Google keeps showing the site (last 28 days against the 28 before)",
        why: "A site can pass every presence check while Google stops showing it (virtualagency-os.com, 25-26 Aug 2026: -99% for ten weeks, unseen).",
        check: "Search Console daily impressions and clicks, last 28 days against the previous 28; and impressions per sitemap page.",
        failure: s.outcome.reasons.map((r) => r.text).join("; "),
        evidence: [`current ${s.outcome.windows.current.start}..${s.outcome.windows.current.end}: ${s.outcome.current.impressions} impressions, ${s.outcome.current.clicks} clicks`, `previous ${s.outcome.windows.previous.start}..${s.outcome.windows.previous.end}: ${s.outcome.previous.impressions} impressions, ${s.outcome.previous.clicks} clicks`, ...(s.outcome.sitemapUrls != null ? [`sitemap URLs: ${s.outcome.sitemapUrls}`] : [])],
        brief: "Find the cause before changing content: Search Console's Pages report (indexed count over time, 'crawled - currently not indexed', 'duplicate without user-selected canonical') and Manual actions; robots.txt, noindex and canonical changes deployed in the week the line fell (git log for that week); host or redirect changes. Fix the cause at source; if the site is mostly thin or templated pages, fold them (see the consolidation briefs) rather than add more.",
      });
    }
    const q = s.quality;
    if (q?.pages?.some((p) => p.failing.length)) {
      const bad = q.pages.filter((p) => p.failing.length);
      briefs.push({
        ...base, id: `so-${site.domain}-quality`, kind: "quality", item_id: "q1", item_title: "Sampled pages meet the page shape (answer first, question headings, sourced figures, dates, no template filler)",
        why: "Presence checks pass a page that is there but not worth quoting; this reads the words on a fresh sample every Monday.",
        check: "Five live content pages sampled each Monday, scored on b3, b4, b5, c4, c6, d1, d2, d3, d4 and the template-filler test.",
        failure: `${bad.length} of ${q.pages.length} sampled pages fall short: ${bad.slice(0, 5).map((p) => `${p.url} (${p.failing.join(", ")})`).join("; ")}`,
        evidence: bad.flatMap((p) => p.notes.map((n) => `${p.url}: ${n}`)).slice(0, 25),
        brief: "Fix the generator or template that made these pages, never the five pages by hand: the same gap is on every page it built. A template-filler note means rewrite the slot text so each page says something only it can say, or fold the near-duplicates into one hub.",
      });
    }
    for (const h of s.consolidation?.hubs ?? []) {
      briefs.push({
        ...base, id: `so-${site.domain}-fold-${h.hub.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root"}`, kind: "consolidate", item_id: "f4", item_title: "Fold zero-impression pages into their hub",
        why: "Pages Google has not shown once in 90 days dilute the site; folding them into a hub concentrates what works (checklist f4).",
        check: "Sitemap pages at least 90 days old with zero Search Console impressions in the last 90 days, grouped under their nearest hub.",
        failure: `${h.urls.length}${h.total > h.urls.length ? ` of ${h.total}` : ""} pages under ${h.hub} had no Google impressions in 90 days`,
        evidence: h.urls.slice(0, 25), missing_urls: [], suggested_hub: h.hubUrl, fold_urls: h.urls,
        brief: `Fold each listed page into ${h.hubUrl}: move any unique, useful words into the hub, 301 the page to it, drop it from the sitemap, and record it in the repo's consolidation ledger. Never delete a page without its 301; skip (and say why) any page that is a protected page, takes payments, or was published in the last 90 days.`,
      });
    }
  }
  return briefs;
}
