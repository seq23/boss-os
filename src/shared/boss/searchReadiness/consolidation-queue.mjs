/**
 * THE CONSOLIDATION QUEUE — checklist f4 made real (owner, 2 Nov 2026: "go").
 *
 * WHY: f4 ("fold thin, zero-impression pages into their hub") was checked as "a ledger file exists",
 * so a site with 2,300 pages and ~45 Google impressions a month (virtualagency-os.com, after its
 * 25-26 Aug 2026 cliff) passed it. This finds the pages themselves:
 *
 *   a sitemap page at least AGE_DAYS old (by its sitemap lastmod, or the day the Monday audit first
 *   saw it, whichever is older) with ZERO Search Console impressions in the last 90 days
 *
 * A REQUIRED utility page (privacy, terms, disclaimer, editorial policy, contact, a thank-you
 * page) is never a candidate, whatever its impressions: it exists because the law and the ad and
 * affiliate programs require it, not to be found in search. The quality sampler already skips
 * exactly those with isUtility(); this reads the same rule.
 *
 * and groups them under their nearest hub (the closest ancestor path the sitemap lists, else the home
 * page), biggest group first, at most MAX_HUBS hubs a week and MAX_URLS pages per hub, so the repair
 * run gets a week's worth of work, not two thousand briefs. Queued as "fold into hub" briefs
 * (search-outcomes.mjs `weeklyBriefs`); NEVER deleted by the audit, and a fold always keeps a 301.
 * Unread Search Console page rows → NOT READ with the reason, never "nothing to fold".
 * Pure; proven by tests/searchOutcomes.test.ts.
 */

import { isUtility } from "./audit.mjs";

export const CONSOLIDATION = Object.freeze({ AGE_DAYS: 90, WINDOW_DAYS: 90, MAX_HUBS: 3, MAX_URLS: 25 });

const DAY = 86_400_000;
/** One comparable key per page: host without www, path without trailing slash or .html, no query. */
export function pageKey(u) {
  try { const x = new URL(u); return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/"}`; } catch { return String(u); }
}

/**
 * The fold candidates and their hubs.
 *   sitemapUrls: [url]; lastmods: { url: isoDate }; firstSeen: { pageKey: isoDay };
 *   gsc: { ok: true, pages: [url with impressions in the last 90 days] } or { ok: false, why }
 * → { status: "queued" | "clear" | "not_read", candidates, hubs: [{ hub, hubUrl, urls, total }], why? }
 */
export function consolidationQueue({ sitemapUrls = [], lastmods = {}, firstSeen = {}, gsc, now = Date.now(), protectedPaths = [] } = {}) {
  if (!gsc?.ok) return { status: "not_read", candidates: 0, hubs: [], why: gsc?.why || "Search Console page rows were not read" };
  if (!Array.isArray(gsc.pages)) return { status: "not_read", candidates: 0, hubs: [], why: "Search Console answered without page rows" };
  const seen = new Set(gsc.pages.map(pageKey));
  const urls = [...new Set(sitemapUrls)];
  const listed = new Map(urls.map((u) => [pageKey(u), u]));
  const prot = new Set(protectedPaths.map((p) => p.replace(/\/+$/, "") || "/"));
  const cutoff = now - CONSOLIDATION.AGE_DAYS * DAY;
  const old = (u) => {
    const times = [lastmods[u], firstSeen[pageKey(u)]].map((d) => Date.parse(d ?? "")).filter(Number.isFinite);
    return times.length > 0 && Math.min(...times) <= cutoff;
  };
  const cands = urls.filter((u) => {
    let path; try { path = new URL(u).pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/"; } catch { return false; }
    // A utility page is never a fold candidate. Privacy, terms, disclaimer, an
    // editorial policy and a contact page are REQUIRED to exist and are normally
    // never shown in search, so "zero impressions in 90 days" is their correct
    // state and not dilution. Queueing them produced three briefs on 3 Nov 2026
    // asking Danielle to 301 the privacy, disclaimer and editorial-policy pages of
    // uscisexam.com, dentistryguides.com and theaccidentguides.com into their home
    // pages, which would have stripped legally required disclosures (and which the
    // target repo refuses outright: it never redirects to a home page). The
    // quality sampler already excludes exactly these pages with the same helper;
    // this is the queue reading from the same rule rather than its own.
    if (isUtility(u)) return false;
    return path !== "/" && !prot.has(path) && !/\.(xml|pdf|txt|jpg|png|webp|svg)$/i.test(path) && !seen.has(pageKey(u)) && old(u);
  });
  const candSet = new Set(cands);
  const groups = new Map();
  for (const u of cands) {
    const x = new URL(u);
    const parts = x.pathname.replace(/\.html$/, "").replace(/\/+$/, "").split("/").filter(Boolean);
    let hubUrl = `${x.protocol}//${x.host}/`, hub = "/";
    for (let i = parts.length - 1; i >= 1; i--) {
      const key = `${x.hostname.replace(/^www\./, "")}/${parts.slice(0, i).join("/")}`;
      // A hub is a page the sitemap lists that is not itself being folded.
      if (listed.has(key) && !candSet.has(listed.get(key))) { hubUrl = listed.get(key); hub = `/${parts.slice(0, i).join("/")}/`; break; }
    }
    if (!groups.has(hubUrl)) groups.set(hubUrl, { hub, hubUrl, all: [] });
    groups.get(hubUrl).all.push(u);
  }
  const hubs = [...groups.values()].sort((a, b) => b.all.length - a.all.length || a.hub.localeCompare(b.hub))
    .slice(0, CONSOLIDATION.MAX_HUBS)
    .map((g) => ({ hub: g.hub, hubUrl: g.hubUrl, total: g.all.length, urls: g.all.sort().slice(0, CONSOLIDATION.MAX_URLS) }));
  return { status: cands.length ? "queued" : "clear", candidates: cands.length, hubCount: groups.size, hubs };
}

/** The first-seen ledger after this week: every sitemap page keeps the earliest day it was seen. */
export function nextFirstSeen(prev, sitemapUrls, day) {
  const out = { ...(prev ?? {}) };
  for (const u of sitemapUrls ?? []) { const k = pageKey(u); if (!out[k]) out[k] = day; }
  return out;
}
