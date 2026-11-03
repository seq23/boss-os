/**
 * THE DROP DIAGNOSIS — why did Google show the site less? (owner, 3 Nov 2026).
 *
 * WHY: the outcome alarm (search-outcomes.mjs) says THAT a site fell; nobody said WHY, so a red line
 * sat as "Danielle is looking into why" while the cause had to be dug out by hand. When a site's
 * outcome is red (more than half gone) or gold (a quarter gone two weeks running), the Monday audit
 * now reads, READ-ONLY, what Search Console and the audit already know and writes a short
 * plain-English diagnosis, most likely cause first, each line CONFIRMED (measured) or SUSPECTED
 * (a likely reading of what was measured):
 *
 *   - by page and by search, last 28 days against the 28 before: who lost the most showings, and
 *     which pages Google stopped showing at all;
 *   - URL Inspection on the top losers: indexed or not, Google's chosen canonical against the
 *     declared one, last crawl;
 *   - what the audit already holds: the sitemap's page count against last week, the quality sample,
 *     the fold queue's zero-impression pages, and the commits in the site's repo over the windows.
 *
 * NEVER CHANGES A SITE. It proposes no edit; for a site whose published pages are frozen
 * (sites.json `published_frozen`: horselegalguide.com, hicksconsulting.org) nothing downstream may
 * turn it into one either (search-outcomes.mjs `weeklyBriefs` emits no outcome or fold brief there).
 * A client's numbers stay in that client's own row; nothing here feeds her own businesses.
 *
 * Pure. The audit runner (scripts/ops/search-readiness-audit.mjs, `readDiagnosis`) does the reads and
 * hands them here as { ok: true, ... } or { ok: false, why }. An unread source is said "not read:
 * <reason>", never a zero; with neither page nor search rows the whole diagnosis is "not read".
 * Proven by tests/searchOutcomes.test.ts.
 */

export const DIAG = Object.freeze({
  /** Losers listed per dimension. */
  TOP: 5,
  /** Top losing pages put through URL Inspection. */
  INSPECT: 5,
  MAX_LINES: 6,
  /** One page or one search carrying at least this share of the loss is "the" cause. */
  CONCENTRATED: 0.5,
  /** The sitemap shrinking by at least this share in a week is a cause. */
  SITEMAP_SHRINK: 0.1,
  /** Growing by at least this share in a week is a suspect. */
  SITEMAP_SURGE: 0.5,
});

/** One full stop at the end, never two (a quoted line may already end in one). */
export const endStop = (t) => `${String(t).replace(/[.\s]+$/, "")}.`;
const num = (n) => Number(n).toLocaleString("en-US");
const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

/** A page URL shortened to its path for a plain line; anything else as it came. */
export function shortUrl(u) {
  try { const x = new URL(u); return `${x.pathname}${x.search}` || "/"; } catch { return String(u); }
}
const norm = (u) => String(u ?? "").trim().replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();

/**
 * Rows ({ key, impressions, clicks }) of the two windows → who lost the most, biggest loss first.
 * `lost` is before − after; a key absent from the current window lost everything (`gone`).
 */
export function windowLosses(current, previous) {
  const now = new Map((current ?? []).map((r) => [r.key, Number(r.impressions) || 0]));
  const out = [];
  for (const r of previous ?? []) {
    const before = Number(r.impressions) || 0, after = now.get(r.key) ?? 0;
    if (before > after) out.push({ key: r.key, before, after, lost: before - after, gone: after === 0 });
  }
  return out.sort((a, b) => b.lost - a.lost || String(a.key).localeCompare(String(b.key)));
}

/**
 * The diagnosis for one site whose outcome is red or gold.
 *   pages, queries: { ok: true, current: rows, previous: rows } | { ok: false, why }
 *   inspections:    { ok: true, items: [{ url, verdict, coverageState, googleCanonical, userCanonical, lastCrawlTime } | { url, why }] } | { ok: false, why }
 *   sitemap:        { now: number | null, before: number | null, beforeDay?: string }
 *   commits:        { ok: true, count, recent, repo } | { ok: false, why }
 *   quality, consolidation: the audit's own verdicts (page-quality-sample, consolidation-queue)
 * → { status: "diagnosed" | "not_read", lines: [{ confidence, text }], text: string[], top_pages,
 *     top_queries, lost_pages, lost_pages_count, inspections, not_read: [{ source, why }] }
 */
export function diagnoseDrop({ pages, queries, inspections, sitemap = {}, commits, quality, consolidation } = {}) {
  const notRead = [];
  const unread = (source, r, fallback) => { if (!r?.ok) notRead.push({ source, why: r?.why || fallback }); return !r?.ok; };
  const pagesUnread = unread("page rows", pages, "Search Console was not read");
  const queriesUnread = unread("search rows", queries, "Search Console was not read");
  if (pagesUnread && queriesUnread) {
    const why = [...new Set(notRead.map((n) => n.why))].join("; ");
    return { status: "not_read", why, lines: [], text: [`not read: ${why}`], top_pages: [], top_queries: [], lost_pages: [], lost_pages_count: 0, inspections: [], not_read: notRead };
  }
  const causes = [];
  const add = (weight, confidence, text) => causes.push({ weight, confidence, text });

  // ── by page ──
  const pl = pagesUnread ? [] : windowLosses(pages.current, pages.previous);
  const pageLoss = pl.reduce((n, r) => n + r.lost, 0);
  const gone = pl.filter((r) => r.gone);
  const goneLoss = gone.reduce((n, r) => n + r.lost, 0);
  if (pl.length) {
    add(50, "CONFIRMED", `Pages that lost the most Google showings: ${pl.slice(0, 3).map((r) => `${shortUrl(r.key)} (${num(r.before)} → ${num(r.after)})`).join(", ")}`);
    if (pl[0].lost >= pageLoss * DIAG.CONCENTRATED && pl.length > 1) add(70, "CONFIRMED", `One page carries ${pctOf(pl[0].lost, pageLoss)}% of the drop: ${shortUrl(pl[0].key)}`);
  }
  if (gone.length) {
    const share = pctOf(goneLoss, pageLoss);
    add(share >= DIAG.CONCENTRATED * 100 ? 80 : 40, "CONFIRMED", `${num(gone.length)} page${gone.length === 1 ? "" : "s"} Google showed in the four weeks before ${gone.length === 1 ? "was" : "were"} not shown at all in the last four (${share}% of the lost showings), led by ${shortUrl(gone[0].key)}`);
  }

  // ── by search ──
  const ql = queriesUnread ? [] : windowLosses(queries.current, queries.previous);
  const queryLoss = ql.reduce((n, r) => n + r.lost, 0);
  if (ql.length) {
    if (ql[0].lost >= queryLoss * DIAG.CONCENTRATED && ql.length > 1) add(65, "CONFIRMED", `One search carries ${pctOf(ql[0].lost, queryLoss)}% of the drop: "${ql[0].key}" (${num(ql[0].before)} → ${num(ql[0].after)})`);
    else add(25, "CONFIRMED", `Searches that lost the most: ${ql.slice(0, 3).map((r) => `"${r.key}" (${num(r.before)} → ${num(r.after)})`).join(", ")}`);
  }

  // ── URL Inspection on the top losers ──
  const items = inspections?.ok ? (inspections.items ?? []) : [];
  if (inspections && !inspections.ok) notRead.push({ source: "URL Inspection", why: inspections.why || "not read" });
  const inspected = items.filter((i) => i.verdict);
  const notIndexed = inspected.filter((i) => i.verdict !== "PASS");
  const wrongCanon = inspected.filter((i) => i.googleCanonical && i.userCanonical && norm(i.googleCanonical) !== norm(i.userCanonical));
  if (notIndexed.length) {
    const states = [...new Set(notIndexed.map((i) => i.coverageState || i.verdict))].slice(0, 2).join("; ");
    add(100, "CONFIRMED", `${notIndexed.length} of ${inspected.length} top losing pages are not in Google's index now (${states}), e.g. ${shortUrl(notIndexed[0].url)}`);
  }
  if (wrongCanon.length) add(90, "CONFIRMED", `Google chose a different main address than the site declares for ${wrongCanon.length} of ${inspected.length} top losing pages, e.g. ${shortUrl(wrongCanon[0].url)} → Google picked ${shortUrl(wrongCanon[0].googleCanonical)}`);
  if (inspections?.ok && items.some((i) => i.why) && !inspected.length) notRead.push({ source: "URL Inspection", why: items.find((i) => i.why).why });

  // ── the sitemap against last week ──
  const sNow = Number(sitemap.now), sBefore = Number(sitemap.before);
  if (sitemap.now == null || sitemap.before == null || !Number.isFinite(sNow) || !Number.isFinite(sBefore)) {
    notRead.push({ source: "last week's sitemap count", why: sitemap.now == null ? "this week's sitemap was not read" : "no audit from last week to compare" });
  } else if (sBefore > 0 && sNow < sBefore * (1 - DIAG.SITEMAP_SHRINK)) {
    add(85, "CONFIRMED", `The sitemap lists ${num(sNow)} pages, down from ${num(sBefore)} a week ago`);
  } else if (sBefore > 0 && sNow >= sBefore * (1 + DIAG.SITEMAP_SURGE)) {
    add(35, "SUSPECTED", `The sitemap grew from ${num(sBefore)} to ${num(sNow)} pages in a week; many new pages at once can thin Google's attention`);
  }

  // ── deploys ──
  if (commits?.ok) {
    if (commits.count > 0) add(45, "SUSPECTED", `${num(commits.count)} commit${commits.count === 1 ? "" : "s"} landed in ${commits.repo} over the eight weeks compared (${num(commits.recent ?? 0)} in the last four); a change to templates, canonicals or robots there is the next place to look`);
    else add(10, "CONFIRMED", `No code changed in ${commits.repo} over the eight weeks compared, so a deploy did not cause it`);
  } else if (commits) notRead.push({ source: "commits", why: commits.why || "not read" });

  // ── what the audit already knows ──
  if (quality?.red) add(55, "SUSPECTED", `Most sampled pages fall short of the page shape, which Google ranks lower: ${quality.line}`);
  const zero = Number(consolidation?.candidates) || 0;
  if (zero > 0) add(20, "SUSPECTED", `${num(zero)} pages had no Google showings in 90 days; thin or duplicate pages dilute the site`);

  // ── nothing on the site explains it ──
  const structural = notIndexed.length || wrongCanon.length || (sBefore > 0 && sNow < sBefore * (1 - DIAG.SITEMAP_SHRINK)) || (gone.length && pctOf(goneLoss, pageLoss) >= DIAG.CONCENTRATED * 100);
  if (!structural && inspected.length && pl.length > 1 && pl[0].lost < pageLoss * DIAG.CONCENTRATED) {
    add(60, "SUSPECTED", "The losing pages are still indexed under their own address and the drop is spread across many pages: most likely a ranking shift (a Google update or competitors), not a fault on the site");
  }

  causes.sort((a, b) => b.weight - a.weight);
  const room = DIAG.MAX_LINES - (notRead.length ? 1 : 0);
  const lines = causes.slice(0, room).map(({ confidence, text }) => ({ confidence, text }));
  const text = lines.map((l) => `${l.confidence}: ${endStop(l.text)}`);
  if (notRead.length) text.push(`Not read: ${notRead.map((n) => `${n.source} (${n.why})`).join("; ")}.`);
  return {
    status: "diagnosed", lines, text,
    top_pages: pl.slice(0, DIAG.TOP), top_queries: ql.slice(0, DIAG.TOP),
    lost_pages: gone.slice(0, 10).map((r) => r.key), lost_pages_count: gone.length,
    inspections: items, not_read: notRead,
  };
}

/** The diagnosis's first line in plain words, for the one-line email and red line. */
export function mostLikely(diagnosis) {
  if (!diagnosis) return null;
  if (diagnosis.status === "not_read") return `Why: not read (${diagnosis.why})`;
  const l = diagnosis.lines?.[0];
  return l ? `Most likely (${l.confidence === "CONFIRMED" ? "confirmed" : "suspected"}): ${l.text.charAt(0).toLowerCase()}${l.text.slice(1)}` : null;
}
