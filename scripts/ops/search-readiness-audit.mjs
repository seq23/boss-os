#!/usr/bin/env node
/**
 * THE SEARCH READINESS AUDIT — every checklist item, against every grid repo site, every Monday.
 *
 * Owner, 25 Oct 2026: make the pinned Search Readiness Checklist enforce itself on all her sites.
 * Before this the checklist was a page whose ticks lived in a browser; nothing ran it, and gaps were
 * found only when she asked (memphisseniorcarehomes.com: two empty sitemaps, no neighborhood,
 * extra-town or hospital pages).
 *
 *   npm run sites:audit                       look at every site, print, write the results
 *   npm run sites:audit -- --site uscisexam.com   one site
 *   npm run sites:audit -- --morning          also write the morning email's "grid repos" section
 *   npm run sites:audit -- --dry-run          audit for real, post nothing to Boss OS, no morning section
 *                                             (with SEARCH_READINESS_DIR=<copy> nothing of hers is written)
 *   npm run sites:fix-queue                   print the fix queue Danielle's Thursday run reads
 *
 * `sites:audit` runs through the vault (`npm run -s vault:run`) so GSC_SERVICE_ACCOUNT_JSON is in
 * this process's environment and nowhere else; it is read, never printed. Without it the three
 * Search Console items are recorded as NOT CHECKED, never as passing.
 *
 * WHAT IT SPENDS: nothing. Plain GETs to her own public sites, Search Console's free API as the
 * gsc-bot service account (read-only scope), PageSpeed Insights' free keyless endpoint, `gh` reads
 * (GET only) and public `git` clones into its own cache. No paid API, no OpenSEO, no model call.
 *
 * WHAT IT WRITES (all under ~/.boss-os/search-readiness/):
 *   results-<day>.json, latest.json   per site: every item's status, the failing ids, missing URLs
 *   fix-queue.json                    one brief per failure (repo, item, missing URLs, evidence)
 *   repos/<repo>                      its own blobless clones; her checkouts are never touched
 * and with --morning, ~/.boss-os/morning/grid_repos.json through `writeMorningSection`.
 *
 * IT FIXES NOTHING. The fix lane is Danielle's weekly repair run (ahrefs-audit-fix.sh), whose prompt
 * reads fix-queue.json. Briefs on a PROTECTED page (the Spry Labs download page) carry its rule.
 *
 * RULE 0: a run that examined zero sites, or ran zero checks, exits non-zero by name.
 */
import { createSign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { passingItems, auditHost, currentBriefs, failureSplit, splitLine,
  loadChecklist, loadSites, applies, runChecks, expandCoverage, fixBriefs, morningLines, searchLanes, summaryLines, liveSameAs, hostOf, bare, entityFor, ENTITY_WATCH_RE,
  metaContent, links, tags, ogImageSource, FRESH_FILE_NAMES, indexnowKeyFiles, definitionChoice, CHECKLIST_PATH, SITES_PATH,
} from "../../src/shared/boss/searchReadiness/audit.mjs";
import { fetchLoopWeeks } from "./lib/search-loop-week.mjs";
import { outcomeVerdict, outcomeWindows, redLines, slipLines, weeklyBriefs, pickLastWeekDay, approvalCard } from "../../src/shared/boss/searchReadiness/search-outcomes.mjs";
import { diagnoseDrop, windowLosses, DIAG } from "../../src/shared/boss/searchReadiness/drop-diagnosis.mjs";
import { pickSample, qualitySample } from "../../src/shared/boss/searchReadiness/page-quality-sample.mjs";
import { consolidationQueue, nextFirstSeen, CONSOLIDATION } from "../../src/shared/boss/searchReadiness/consolidation-queue.mjs";
import { readRepoCategories } from "./lib/repo-categories.mjs";
import { isOwnSite, leadVerdict } from "../../src/shared/boss/searchReadiness/site-leads.mjs";
import { readLeads } from "./lib/site-leads-read.mjs";
import { macContext } from "./lib/scorecard-readers.mjs";

const OUT = process.env.SEARCH_READINESS_DIR ?? join(homedir(), ".boss-os", "search-readiness");
const REPOS = join(OUT, "repos");
const OWNER = "seq23";
const UA = "Mozilla/5.0 (compatible; BossOS-SearchReadiness/1.0; +https://boss.sequoiataylor.com)";
// A social profile answers a robot UA with a login wall; the sameAs probe (k3) reads as a browser does.
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const SAMPLE = Number(opt("--sample") ?? 12);
/**
 * --dry-run: audit for real, print, and write results only under SEARCH_READINESS_DIR; post nothing to
 * Boss OS (no approval card, no cleared findings) and write no morning section.
 */
const DRY = flag("--dry-run");
const CRAWL_CAP = 300;
const say = (...a) => console.log(...a);
const stop = (code, tag, why) => { console.error(`NAMED STOP [${tag}] ${why}`); process.exit(code); };

// ─── fetching ─────────────────────────────────────────────────────────────────

async function get(url, { redirect = "follow", timeout = 20_000, text = true, method = "GET", accept = "text/html,application/xml,text/plain,*/*", ua = UA } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { method, redirect, signal: ctl.signal, headers: { "user-agent": ua, accept } });
    const headers = Object.fromEntries(res.headers.entries());
    const body = text && method !== "HEAD" ? await res.text().catch(() => "") : "";
    return { url, status: res.status, final: res.url, redirected: res.redirected, location: headers.location ?? null, type: headers["content-type"] ?? "", headers, text: body };
  } catch (e) {
    return { url, status: null, error: e?.name === "AbortError" ? "timed out" : String(e?.cause?.code ?? e?.message ?? e) };
  } finally { clearTimeout(t); }
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

const locs = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
const lastmods = (xml) => [...String(xml).matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/gi)].map((m) => m[1]);

async function readSitemaps(host, robotsText) {
  const roots = [...new Set([...(robotsText ?? "").matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]).concat([`https://${host}/sitemap.xml`]))];
  const children = [], urls = new Set(), seen = new Set(), urlLastmod = {}; let any = false;
  const visit = async (u, depth) => {
    if (seen.has(u)) return; seen.add(u);
    const r = await get(u);
    if (r.status !== 200) { children.push({ url: u, status: r.status ?? r.error, count: 0 }); return; }
    any = true;
    if (/<sitemapindex/i.test(r.text)) { if (depth < 2) for (const c of locs(r.text)) await visit(c, depth + 1); return; }
    const l = locs(r.text);
    children.push({ url: u, status: 200, count: l.length, lastmods: lastmods(r.text) });
    for (const x of l) urls.add(x);
    // Each page's own lastmod (the consolidation queue's age floor).
    for (const m of r.text.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
      const loc = locs(m[1])[0], lm = lastmods(m[1])[0];
      if (loc && lm) urlLastmod[loc] = lm;
    }
  };
  for (const r of roots) await visit(r, 0);
  return { ok: any, why: any ? null : "no sitemap answered 200", roots, children, urls, urlLastmod };
}

function samplePages(urls, n, protectedPaths) {
  const all = [...urls].filter((u) => !/\.(xml|pdf|txt|jpg|png|webp|svg)$/i.test(u));
  if (all.length <= n) return all;
  const step = all.length / n; const out = [];
  for (let i = 0; i < n; i++) out.push(all[Math.floor(i * step)]);
  // A protected page is always looked at (its hash and buy link are verified separately).
  for (const p of protectedPaths) { const hit = all.find((u) => new URL(u).pathname.replace(/\.html$/, "") === p); if (hit && !out.includes(hit)) out.push(hit); }
  return out;
}

async function crawl(host, startHtml, cap) {
  const reached = new Set([`https://${host}/`]); let frontier = [{ url: `https://${host}/`, html: startHtml }];
  for (let depth = 1; depth <= 3 && reached.size < cap; depth++) {
    const next = [];
    for (const p of frontier) for (const l of links(p.html ?? "", p.url)) {
      if (new URL(l.url).hostname !== host || /\.(pdf|jpg|png|webp|svg|xml|txt|zip|css|js)$/i.test(l.url)) continue;
      const u = l.url.split("?")[0];
      if (!reached.has(u) && reached.size < cap) { reached.add(u); next.push(u); }
    }
    if (depth === 3) break;
    frontier = (await pool(next, 8, (u) => get(u))).filter((r) => r.status === 200 && /html/i.test(r.type)).map((r) => ({ url: r.final ?? r.url, html: r.text }));
  }
  return { reached, capped: reached.size >= cap, cap };
}

// ─── Search Console (read-only scope, the gsc-bot service account) ─────────────

async function gscToken() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) return { ok: false, why: "no Search Console key in this process (run it as npm run sites:audit, which goes through the vault)" };
  let creds; try { creds = JSON.parse(raw); } catch { return { ok: false, why: "the Search Console key in the vault does not parse" }; }
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: creds.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const s = createSign("RSA-SHA256"); s.update(unsigned);
  const jwt = `${unsigned}.${s.sign(creds.private_key).toString("base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) }).catch(() => null);
  if (!res?.ok) return { ok: false, why: `Search Console token refused (${res?.status ?? "no answer"})` };
  return { ok: true, token: (await res.json()).access_token };
}
const gscGet = async (tok, path, body) => {
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  return res?.ok ? res.json() : { __error: res?.status ?? "no answer" };
};

async function gscFor(g, gscSites, site, host) {
  if (!g.ok) return { ok: false, why: g.why };
  const candidates = [`sc-domain:${site.domain}`, `https://${host}/`, `https://${site.domain}/`, `https://www.${site.domain}/`];
  const property = candidates.find((c) => gscSites.has(c)) ?? null;
  if (!property) return { ok: true, property: null };
  const enc = encodeURIComponent(property);
  const sm = await gscGet(g.token, `sites/${enc}/sitemaps`);
  const end = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10), start = new Date(Date.now() - 92 * 86_400_000).toISOString().slice(0, 10);
  const q = await gscGet(g.token, `sites/${enc}/searchAnalytics/query`, { startDate: start, endDate: end, dimensions: ["page"], rowLimit: 100 });
  const rows = (q.rows ?? []).filter((r) => r.impressions > 0).map((r) => r.keys[0]);
  const pages = await pool(rows, 8, async (u) => {
    const r = await get(u, { redirect: "manual", text: false, method: "GET" });
    if ([301, 308].includes(r.status) && r.location) { const f = await get(new URL(r.location, u).href, { text: false }); return { url: u, status: 301, final: f.status }; }
    return { url: u, status: r.status, error: r.error };
  });
  return { ok: true, property, sitemaps: (sm.sitemap ?? []).map((s) => ({ path: s.path, errors: s.errors, lastDownloaded: s.lastDownloaded })), pages: q.__error ? null : pages };
}

/**
 * THE ONE READER for the outcome alarm and the consolidation queue (2 Nov 2026): Search Console's
 * daily impressions and clicks for the two 28-day windows, and every page with an impression in the
 * last 90 days. An unread source comes back { ok: false, why }, never an empty list.
 */
async function readOutcomes(g, gsc, site) {
  const no = (why) => ({ daily: { ok: false, why }, pages: { ok: false, why } });
  if (!g.ok) return no(g.why);
  if (!gsc?.ok) return no(gsc?.why ?? "Search Console was not read");
  if (!gsc.property) return no(`no Search Console property for ${site.domain} is shared with the audit's service account`);
  const enc = encodeURIComponent(gsc.property);
  const w = outcomeWindows();
  // A week further back than the two windows, so last week's verdict can be recomputed (the gold rule).
  const from = new Date(Date.parse(w.start) - 7 * 86_400_000).toISOString().slice(0, 10);
  const d = await gscGet(g.token, `sites/${enc}/searchAnalytics/query`, { startDate: from, endDate: w.end, dimensions: ["date"], rowLimit: 500 });
  const pStart = new Date(Date.parse(w.end) - (CONSOLIDATION.WINDOW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const p = await gscGet(g.token, `sites/${enc}/searchAnalytics/query`, { startDate: pStart, endDate: w.end, dimensions: ["page"], rowLimit: 25000 });
  return {
    daily: d.__error ? { ok: false, why: `Search Console answered ${d.__error} for the daily numbers` } : { ok: true, from, rows: (d.rows ?? []).map((r) => ({ date: r.keys[0], impressions: r.impressions, clicks: r.clicks })) },
    pages: p.__error ? { ok: false, why: `Search Console answered ${p.__error} for the page rows` } : { ok: true, pages: (p.rows ?? []).filter((r) => r.impressions > 0).map((r) => r.keys[0]) },
  };
}

/**
 * THE DROP DIAGNOSIS'S READS (3 Nov 2026), only for a red or gold outcome. READ-ONLY: Search
 * Console rows by page and by search for both windows, URL Inspection on the top losing pages, and
 * the commit count in the site's repo over the windows (`gh api`, GET). Each unread source is
 * { ok: false, why }; drop-diagnosis.mjs says it "not read", never 0.
 */
async function readDiagnosis(g, gsc, site, outcome, { sitemapNow, lastWeekSite, quality, consolidation }) {
  const no = (why) => ({ ok: false, why });
  const sitemap = { now: sitemapNow, before: lastWeekSite?.sitemap?.ok ? lastWeekSite.sitemap.urls : null };
  const commits = readCommits(site.repo, outcome.windows);
  if (!g.ok || !gsc?.ok || !gsc.property) {
    const why = !g.ok ? g.why : !gsc?.ok ? (gsc?.why ?? "Search Console was not read") : `no Search Console property for ${site.domain}`;
    return diagnoseDrop({ pages: no(why), queries: no(why), inspections: no(why), sitemap, commits, quality, consolidation });
  }
  const enc = encodeURIComponent(gsc.property);
  const q = (dim, win) => gscGet(g.token, `sites/${enc}/searchAnalytics/query`, { startDate: win.start, endDate: win.end, dimensions: [dim], rowLimit: 5000 });
  const [pc, pp, qc, qp] = await Promise.all([q("page", outcome.windows.current), q("page", outcome.windows.previous), q("query", outcome.windows.current), q("query", outcome.windows.previous)]);
  const rows = (r) => (r.rows ?? []).map((x) => ({ key: x.keys[0], impressions: x.impressions, clicks: x.clicks }));
  const pair = (a, b, what) => (a.__error || b.__error ? no(`Search Console answered ${a.__error ?? b.__error} for the ${what} rows`) : { ok: true, current: rows(a), previous: rows(b) });
  const pages = pair(pc, pp, "page"), queries = pair(qc, qp, "search");
  let inspections;
  if (!pages.ok) inspections = no(pages.why);
  else {
    const urls = windowLosses(pages.current, pages.previous).slice(0, DIAG.INSPECT).map((r) => r.key);
    const items = [];
    for (const url of urls) {
      const res = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", headers: { authorization: `Bearer ${g.token}`, "content-type": "application/json" }, body: JSON.stringify({ inspectionUrl: url, siteUrl: gsc.property }) }).catch(() => null);
      if (!res?.ok) { items.push({ url, why: `URL Inspection answered ${res?.status ?? "no answer"}` }); continue; }
      const r = (await res.json())?.inspectionResult?.indexStatusResult ?? {};
      items.push({ url, verdict: r.verdict ?? null, coverageState: r.coverageState ?? null, googleCanonical: r.googleCanonical ?? null, userCanonical: r.userCanonical ?? null, lastCrawlTime: r.lastCrawlTime ?? null, robotsTxtState: r.robotsTxtState ?? null, indexingState: r.indexingState ?? null });
    }
    inspections = { ok: true, items };
  }
  return diagnoseDrop({ pages, queries, inspections, sitemap, commits, quality, consolidation });
}

/** Commits on the site repo's default branch over both windows, and in the newest one (gh, GET). */
function readCommits(repo, windows) {
  if (!repo) return { ok: false, why: "the site has no repo" };
  const count = (since, until) => {
    const r = spawnSync("gh", ["api", "--paginate", `repos/${OWNER}/${repo}/commits?since=${since}T00:00:00Z&until=${until}T23:59:59Z&per_page=100`, "--jq", ".[].sha"], { encoding: "utf8", timeout: 60_000 });
    return r.status === 0 ? r.stdout.split("\n").filter(Boolean).length : null;
  };
  const all = count(windows.previous.start, windows.current.end);
  if (all == null) return { ok: false, why: `gh could not read ${repo}'s commits` };
  return { ok: true, repo, count: all, recent: count(windows.current.start, windows.current.end) ?? 0 };
}

/**
 * Last week's audit, from the dated results files (results-<day>.json): the newest 5-10 days ago that
 * holds each site. → Map domain → that site's row, plus `day`. A missing history is an empty map.
 */
function lastWeekRows(today) {
  const days = existsSync(OUT) ? readdirSync(OUT).map((f) => /^results-(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1]).filter(Boolean) : [];
  const out = new Map();
  const tried = new Set();
  for (;;) {
    const day = pickLastWeekDay(days.filter((d) => !tried.has(d)), today);
    if (!day) break;
    tried.add(day);
    try {
      for (const s of JSON.parse(readFileSync(join(OUT, `results-${day}.json`), "utf8")).sites ?? []) {
        const d = s.site?.domain;
        if (d && !out.has(d)) out.set(d, { ...s, day });
      }
    } catch { /* an unreadable file: the older one is tried */ }
  }
  return out;
}

/**
 * Every earlier dated run (results-<day>.json before `today`, last 60 days), for the weekly split.
 * An unreadable file is skipped; no history at all makes every site "new", which the split says.
 */
function earlierRuns(today) {
  const days = existsSync(OUT) ? readdirSync(OUT).map((f) => /^results-(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1]).filter((d) => d && d < today && Date.parse(today) - Date.parse(d) <= 60 * 86_400_000) : [];
  const out = [];
  for (const day of days) {
    try { const r = JSON.parse(readFileSync(join(OUT, `results-${day}.json`), "utf8")); out.push({ day, sites: (r.sites ?? []).map((x) => ({ site: { domain: x.site?.domain }, results: (x.results ?? []).map((y) => ({ id: y.id, status: y.status })) })) }); } catch { /* skipped */ }
  }
  return out;
}

// ─── PageSpeed Insights (free, keyless) ───────────────────────────────────────

async function psi(host) {
  if (flag("--no-psi")) return { ok: false, why: "PageSpeed skipped for this run (--no-psi)" };
  const u = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(`https://${host}/`)}&strategy=mobile&category=performance&category=seo&category=accessibility`;
  const r = await get(u, { timeout: 90_000 });
  if (r.status !== 200) return { ok: false, why: `PageSpeed Insights answered ${r.status ?? r.error} (free quota); not checked this week` };
  try {
    const c = JSON.parse(r.text).lighthouseResult.categories;
    return { ok: true, scores: { performance: Math.round(c.performance.score * 100), seo: Math.round(c.seo.score * 100), accessibility: Math.round(c.accessibility.score * 100) } };
  } catch { return { ok: false, why: "PageSpeed Insights answered without scores" }; }
}

// ─── the definition this run measures with (origin's, never a stale checkout's) ───

// Her checkout runs the audit (launchd) and nothing updates it. On 26 Oct 2026 it sat at #147 while
// main held the corrected aplayermode.com → sprylabs-hpc-site mapping, and the run wrote five fix
// briefs against a repo that never served that host. The definition files are read from
// origin/<default> every run; the checkout only supplies the code.
const SELF = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function definitions() {
  const git = (...a) => spawnSync("git", ["-C", SELF, ...a], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const fetched = git("fetch", "-q", "--no-tags", "origin");
  const head = git("symbolic-ref", "--short", "refs/remotes/origin/HEAD").stdout.trim().replace(/^origin\//, "")
    || git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim() || "main";
  const ref = `origin/${head}`;
  const rel = (abs) => abs.slice(SELF.length).replace(/^\/+/, "");
  const pick = (abs) => {
    const path = rel(abs);
    const o = git("show", `${ref}:${path}`);
    const choice = definitionChoice({
      local: existsSync(abs) ? readFileSync(abs, "utf8") : null,
      remote: o.status === 0 ? o.stdout : null,
      path,
    });
    if (!choice.text) stop(2, "NO_DEFINITION", choice.why);
    if (choice.stale) say(`DEFINITION: ${choice.why} (${ref})`);
    else if (choice.unverified) say(`DEFINITION: ${choice.why}${fetched.status === 0 ? "" : " — git fetch failed"}`);
    return choice;
  };
  const c = pick(CHECKLIST_PATH), si = pick(SITES_PATH);
  return {
    checklist: loadChecklist(c.text),
    sites: loadSites(si.text),
    source: { ref, checklist: c.source, sites: si.source, stale: Boolean(c.stale || si.stale) },
  };
}

// ─── repos (own blobless clones; read only) ──────────────────────────────────

const git = (dir, ...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const repoCache = new Map();

async function readRepo(name) {
  if (!name) return { ok: false, noRepo: true, why: "no repository on her GitHub for this site" };
  if (repoCache.has(name)) return repoCache.get(name);
  const dir = join(REPOS, name);
  mkdirSync(REPOS, { recursive: true });
  let r = existsSync(join(dir, "HEAD")) ? git(dir, "fetch", "-q", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*")
    : spawnSync("git", ["clone", "-q", "--bare", "--filter=blob:none", `https://github.com/${OWNER}/${name}.git`, dir], { encoding: "utf8" });
  if (r.status !== 0 && !existsSync(join(dir, "HEAD"))) {
    const v = { ok: false, why: `could not clone ${OWNER}/${name}: ${(r.stderr ?? "").trim().slice(0, 120)}` }; repoCache.set(name, v); return v;
  }
  const head = git(dir, "symbolic-ref", "--short", "HEAD").stdout.trim() || "main";
  // A bare clone's refs are refs/heads/*; a fetch above updates refs/remotes/origin/*. Prefer the newer.
  const ref = git(dir, "rev-parse", "--verify", "-q", `refs/remotes/origin/${head}`).status === 0 ? `refs/remotes/origin/${head}` : head;
  const files = git(dir, "ls-tree", "-r", "--name-only", ref).stdout.split("\n").filter(Boolean);
  const show = (p) => { const o = git(dir, "show", `${ref}:${p}`); return o.status === 0 ? o.stdout : null; };
  const workflows = files.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f)).map((f) => ({ name: f.split("/").pop(), text: show(f) ?? "" }));
  const fresh = {};
  for (const want of FRESH_FILE_NAMES) {
    fresh[want] = files.filter((f) => f.endsWith(want)).slice(0, 40).map((p) => ({ path: p, at: Number(git(dir, "log", "-1", "--format=%ct", ref, "--", p).stdout.trim()) * 1000 })).filter((x) => x.at);
  }
  // EVERY IndexNow key file, not the first. A repo that serves several hosts gives each host its
  // own key (sprylabs-hpc-site: one key at the root for spryexecutiveos.com and
  // billionairehighperformancecoach.com, a second under aplayermode/ for aplayermode.com, because a
  // key is valid only on the host that serves it). Taking the first one made every other host on
  // that repo fail e3/i8 for a key that was never meant to answer there.
  //
  // AND EVERY VALID KEY SHAPE, not only lowercase hex. The detection moved into
  // indexnowKeyFiles(), which reads IndexNow's real contract - a key file's body is its own key -
  // instead of guessing from the name. See the comment on it: the old hex-only pattern missed
  // porchandparty901.com's UUID key and invented two fix briefs a week for a file that existed.
  const keyFiles = indexnowKeyFiles(files, show);
  const indexnowKeys = [...new Set(keyFiles.map((f) => f.split("/").pop().replace(/\.txt$/, "")))].slice(0, 8);
  const indexnowKey = indexnowKeys[0] ?? null;
  const scriptsMentioningGscTruth = files.filter((f) => /\.(m?js|py|ts|sh)$/.test(f) && /gsc|search/i.test(f)).slice(0, 40).filter((f) => /gsc_truth|gsc_search_analytics/.test(show(f) ?? ""));
  const view = spawnSync("gh", ["repo", "view", `${OWNER}/${name}`, "--json", "visibility", "--jq", ".visibility"], { encoding: "utf8" });
  const runs = spawnSync("gh", ["run", "list", "-R", `${OWNER}/${name}`, "--event", "pull_request", "--status", "completed", "--limit", "5", "--json", "createdAt,updatedAt"], { encoding: "utf8" });
  let prRunMinutes = null; try { prRunMinutes = JSON.parse(runs.stdout || "[]").map((x) => (Date.parse(x.updatedAt) - Date.parse(x.createdAt)) / 60_000); } catch { /* gh not signed in */ }
  // k6: the newest run of the weekly entity-backlink-watch, per workflow file (null = never ran).
  const entityWatchRuns = {};
  for (const w of workflows.filter((x) => ENTITY_WATCH_RE.test(x.name))) {
    const o = spawnSync("gh", ["run", "list", "-R", `${OWNER}/${name}`, "--workflow", w.name, "--limit", "1", "--json", "conclusion,status,createdAt"], { encoding: "utf8" });
    if (o.status === 0) { try { entityWatchRuns[w.name] = JSON.parse(o.stdout || "[]")[0] ?? null; } catch { /* left unread: not_checked */ } }
  }
  // f2, f7, f8, f10, f11 (the search growth loop, 1 Nov 2026): the newest search-loop-week reports.
  // Unread stays undefined (not_checked, with the reason), never an empty list that reads as "none".
  const loop = fetchLoopWeeks(name);
  const loopWeeks = loop.problem ? undefined : loop.weeks;
  const v = { ok: true, ref, files, show, workflows, entityWatchRuns, loopWeeks, loopWhy: loop.problem ?? null, fresh, indexnowKey, indexnowKeys, scriptsMentioningGscTruth, visibility: view.status === 0 ? view.stdout.trim() : null, prRunMinutes, llmRouting: show("config/llm_routing.json"), claudeMd: show("CLAUDE.md") };
  repoCache.set(name, v);
  return v;
}

// ─── one site ─────────────────────────────────────────────────────────────────

async function auditSite(site, checklist, g, gscSites, portfolio, firstSeen = {}, lastWeekSite = null) {
  const t0 = Date.now();
  const start = await get(`https://${site.domain}/`);
  // The same site only (www ↔ apex): a home page that redirects to ANOTHER site keeps this site's own
  // host, so its sitemap and pages are read, never the other site's (spryexecutiveos.com, 6 Nov 2026).
  const host = auditHost(site.domain, start.final);
  // `final` is where the HTML actually came from. A host whose / answers 308 to
  // its one money page returns that page's HTML here, and the canonical check
  // must compare against the page it got, not the URL it asked for.
  const home = { url: `https://${host}/`, final: start.final ?? `https://${host}/`, status: start.status, html: start.text ?? "", headers: start.headers ?? {} };
  const protectedPaths = (site.protected_pages ?? []).map((p) => p.path);
  const otherHost = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  const [robots, other, notFound, ...fileRes] = await Promise.all([
    get(`https://${host}/robots.txt`), get(`https://${otherHost}/`, { redirect: "manual", text: false }), get(`https://${host}/sr-check-${Date.now().toString(36)}-nope/`, { redirect: "manual", text: false }),
    ...["/llms.txt", "/favicon.ico", "/apple-touch-icon.png", "/site.webmanifest", "/about/", "/about"].map((p) => get(`https://${host}${p}`)),
  ]);
  const files = {};
  ["/llms.txt", "/favicon.ico", "/apple-touch-icon.png", "/site.webmanifest", "/about/", "/about"].forEach((p, i) => { files[p] = { status: fileRes[i].status, type: fileRes[i].type, text: (fileRes[i].text ?? "").slice(0, 200_000) }; });
  files.__other_host = { from: `https://${otherHost}/`, status: other.status, location: other.location, error: other.error };
  files.__not_found = { status: notFound.status, location: notFound.location };
  const sitemap = await readSitemaps(host, robots.text);
  const sample = samplePages(sitemap.urls, SAMPLE, protectedPaths);
  const repo = await readRepo(site.repo);

  // Coverage targets → URLs, checked against the sitemap and live.
  let coverage;
  try {
    let cities = null;
    if (site.coverage?.model === "repo_cities") {
      const cr = await readRepo(site.coverage.repo);
      const raw = cr.ok ? cr.show(site.coverage.file) : null;
      if (!raw) throw new Error(`the city file ${site.coverage.file} is not on ${site.coverage.repo}'s default branch`);
      cities = JSON.parse(raw);
    }
    const sitemapPaths = new Set([...sitemap.urls].map((u) => { try { return new URL(u).pathname.replace(/\/+$/, ""); } catch { return u; } }));
    const targets = expandCoverage(site, cities).map((t) => ({ ...t, url: `https://${host}${t.path}`, inSitemap: sitemapPaths.has(t.path.replace(/\/+$/, "")) }));
    const live = await pool(targets, 8, (t) => get(t.url, { text: true }));
    targets.forEach((t, i) => { t.status = live[i].status; t.error = live[i].error; t.html = live[i].status === 200 ? live[i].text : null; t.redirected = live[i].redirected; if (live[i].redirected) t.status = `redirect → ${live[i].final}`; });
    coverage = { targets };
  } catch (e) { coverage = { targets: [], error: String(e?.message ?? e) }; }

  const fetched = await pool(sample, 6, (u) => get(u));
  const pages = [{ url: home.url, final: home.final, status: home.status, html: home.html, headers: home.headers, redirected: home.final !== home.url, fromSitemap: false },
    ...fetched.map((r, i) => ({ url: sample[i], final: r.final ?? sample[i], status: r.status, html: r.text, headers: r.headers ?? {}, redirected: r.redirected, fromSitemap: true }))];
  // Two coverage town pages, so the directory checks read real town pages.
  for (const t of (coverage.targets ?? []).filter((x) => x.kind === "town" && x.html).slice(0, 2)) pages.push({ url: t.url, final: t.url, status: 200, html: t.html, headers: {}, fromSitemap: t.inSitemap, coverageKind: "town" });

  // og:image, Clarity loader, IndexNow key, portfolio link targets.
  const og = ogImageSource(pages, host);
  if (og) { const r = await get(og.image, { text: false }); files.__og_image = { url: og.image, status: r.status, page: og.page }; }
  const loader = tags(home.html, "script").map((t) => t.src).find((s) => s && /clarity/i.test(s));
  if (loader) files.__clarity_loader = true;
  // Probe every key the repo holds: this host answers at most one of them (readRepo, indexnowKeys).
  for (const key of repo.ok ? repo.indexnowKeys ?? [] : []) {
    const r = await get(`https://${host}/${key}.txt`);
    files[`/${key}.txt`] = { status: r.status, text: (r.text ?? "").slice(0, 400) };
  }
  if (applies({ check: { applies_to: ["authority", "role:companion"] } }, site)) {
    const outs = [...new Set(pages.flatMap((p) => (p.html ? links(p.html, p.url) : [])).filter((l) => portfolio.includes(l.host) && l.host !== host.replace(/^www\./, "")).map((l) => l.url))].slice(0, 15);
    files.__targets = await pool(outs, 6, async (u) => { const r = await get(u, { text: false }); return { url: u, status: r.status, error: r.error }; });
  }
  // k3: every external sameAs in the live JSON-LD (never this site, never a grid sibling), fetched as a browser.
  if (checklist.items.some((i) => i.check.type === "same_as_resolves" && applies(i, site))) {
    const own = new Set([bare(host), bare(site.domain), ...((entityFor(repo, site)?.root?.own_hosts) ?? []).map(bare)]);
    const grid = new Set(portfolio.map(bare));
    const ext = [...new Set(pages.flatMap((p) => (p.status === 200 && p.html ? liveSameAs(p.html) : [])))].filter((u) => { const h = hostOf(u); return h && !own.has(h) && !grid.has(h); }).slice(0, 12);
    files.__same_as = await pool(ext, 4, async (u) => { const r = await get(u, { text: false, ua: BROWSER_UA }); return { url: u, status: r.status, error: r.error }; });
  }
  const needsCrawl = checklist.items.some((i) => i.check.type === "no_orphans" && applies(i, site));
  const crawled = needsCrawl && home.status === 200 ? await crawl(host, home.html, CRAWL_CAP) : null;
  const gsc = await gscFor(g, gscSites, site, host);
  const ps = await psi(host);

  // Outcomes, page quality and the fold queue (2 Nov 2026): notes and red lines, never a failing check.
  const read = await readOutcomes(g, gsc, site);
  // Last week's stored outcome when that run had one; otherwise recomputed from this week's rows.
  const lwo = lastWeekSite?.outcome;
  const outcome = outcomeVerdict({ read: read.daily, sitemapUrls: sitemap.ok ? sitemap.urls.size : null, ...(lwo?.current && lwo?.previous ? { lastWeek: { current: lwo.current, previous: lwo.previous, source: "stored", day: lastWeekSite.day } } : {}) });
  // Leads (3 Nov 2026): her own sites only; a client site is never read (site-leads.mjs).
  const leads = isOwnSite(site) ? leadVerdict({ site, read: await readLeads(site, macContext()), outcome }) : null;
  const qUrls = pickSample(sitemap.urls, { exclude: protectedPaths });
  const qFetched = await pool(qUrls, 5, (u) => get(u));
  const quality = qualitySample({ site, host, checklist, pages: qFetched.map((r, i) => ({ url: qUrls[i], status: r.status, error: r.error, html: r.status === 200 ? r.text : null })) });
  const consolidation = sitemap.ok
    ? consolidationQueue({ sitemapUrls: [...sitemap.urls], lastmods: sitemap.urlLastmod, firstSeen, gsc: read.pages, protectedPaths })
    : { status: "not_read", candidates: 0, hubs: [], why: sitemap.why ?? "no sitemap" };

  // Red or gold → the read-only diagnosis (3 Nov 2026).
  const diagnosis = outcome.status === "red" || outcome.status === "gold"
    ? await readDiagnosis(g, gsc, site, outcome, { sitemapNow: sitemap.ok ? sitemap.urls.size : null, lastWeekSite, quality, consolidation })
    : null;

  // The protected pages: hash and buy link, every run.
  const protectedReport = [];
  for (const pp of site.protected_pages ?? []) {
    // Accept */*, as the recorded hash was taken: the host serves a different variant to an HTML Accept.
    const r = await get(`https://${host}${pp.path}`, { accept: "*/*" });
    const { createHash } = await import("node:crypto");
    const sha = r.status === 200 ? createHash("sha256").update(r.text).digest("hex") : null;
    const buy = r.status === 200 && pp.buy_link ? r.text.includes(pp.buy_link) : null;
    const buyLive = pp.buy_link ? (await get(pp.buy_link, { text: false })).status : null;
    protectedReport.push({ path: pp.path, status: r.status, sha256_matches: sha === pp.sha256, sha256: sha, buy_link_on_page: buy, buy_link_status: buyLive });
  }

  const ctx = { site, host, home, pages, robots: { status: robots.status, type: robots.type, text: robots.text ?? "" }, sitemap, files, gsc, repo, crawl: crawled, coverage, psi: ps, portfolio, protectedPaths, now: Date.now() };
  const results = runChecks(checklist, ctx);
  // Which searches win (engine v1.6.0 lanes): the site's row and the Monday email.
  const lanes = searchLanes(ctx);
  const pr = protectedReport.filter((p) => !p.sha256_matches || p.buy_link_on_page === false || (p.buy_link_status && p.buy_link_status !== 200));
  if (pr.length) results.push({ id: "protected", status: "fail", detail: pr.map((p) => `${p.path}: ${p.status !== 200 ? `answered ${p.status}` : !p.sha256_matches ? "content changed (hash differs)" : p.buy_link_on_page === false ? "the Gumroad buy link is gone" : `the Gumroad buy link answered ${p.buy_link_status}`}`).join("; "), evidence: pr.map((p) => p.path) });
  return {
    site, host, seconds: Math.round((Date.now() - t0) / 1000), home_status: home.status,
    sitemap: { ok: sitemap.ok, urls: sitemap.urls.size, children: sitemap.children.map(({ url, status, count }) => ({ url, status, count })) },
    coverage: coverage.error ? { error: coverage.error } : { targets: coverage.targets.length, missing: coverage.targets.filter((t) => !t.inSitemap || t.status !== 200).map((t) => t.url) },
    protected: protectedReport, results, outcome, ...(diagnosis ? { diagnosis } : {}), ...(leads ? { leads } : {}), ...(lanes ? { lanes } : {}), quality, consolidation, sitemapUrls: [...sitemap.urls],
  };
}

// ─── main ─────────────────────────────────────────────────────────────────────

const writeJson = (p, v) => { const tmp = `${p}.tmp`; writeFileSync(tmp, JSON.stringify(v, null, 1)); renameSync(tmp, p); };

async function main() {
  /*
   * --plan: the repos the queue run still has to work, one per line ("REPO <name> <count>"), then a
   * "QUEUE" totals line. Read by scripts/ops/search-readiness-fix.sh, which loops until no REPO
   * lines are left. Protected and no_repo briefs are never listed.
   */
  if (flag("--plan")) {
    const q = join(OUT, "fix-queue.json");
    if (!existsSync(q)) stop(3, "NO_QUEUE", `${q} does not exist yet; run npm run sites:audit first.`);
    const { workQueue } = await import("../../src/shared/boss/searchReadiness/audit.mjs");
    // Only items the checklist still holds: a queue written before an item was removed never works it.
    const w = workQueue(currentBriefs(definitions().checklist, JSON.parse(readFileSync(q, "utf8")).briefs));
    for (const r of w.repos) console.log(`REPO ${r.repo} ${r.n}`);
    for (const c of w.chunks) console.log(`CHUNK ${c.repo} ${c.ids.length} ${c.ids.join(",")}`);
    for (const c of w.once) console.log(`ONCE ${c.repo} ${c.ids.length} ${c.ids.join(",")}`);
    console.log(`QUEUE total=${w.total} workable=${w.workable} protected=${w.protected} no_repo=${w.no_repo} weekly=${w.weekly}`);
    return;
  }
  if (flag("--queue")) {
    const q = join(OUT, "fix-queue.json");
    if (!existsSync(q)) stop(3, "NO_QUEUE", `${q} does not exist yet; run npm run sites:audit first.`);
    const v = JSON.parse(readFileSync(q, "utf8"));
    v.briefs = currentBriefs(definitions().checklist, v.briefs);
    say(`${v.briefs.length} fix briefs, written ${v.written_at}`);
    for (const b of v.briefs) say(`- ${b.domain} [${b.repo ?? "no repo"}] ${b.item_id} ${b.item_title}${b.protected ? " (PROTECTED)" : ""}: ${b.failure.slice(0, 160)}${b.missing_urls.length ? ` | ${b.missing_urls.length} missing URLs` : ""}`);
    return;
  }
  const defs = definitions();
  const checklist = defs.checklist;
  const { grid_repos } = defs.sites;
  const only = opt("--site");
  const sites = only ? grid_repos.filter((s) => s.domain === only) : grid_repos;
  if (!sites.length) stop(2, "NO_SITES", only ? `no grid repo site is called ${only}` : "sites.json lists no grid repo sites");
  mkdirSync(OUT, { recursive: true });
  const portfolio = grid_repos.map((s) => s.domain);

  const g = await gscToken();
  let gscSites = new Set();
  if (g.ok) { const l = await gscGet(g.token, "sites"); gscSites = new Set((l.siteEntry ?? []).map((s) => s.siteUrl)); say(`Search Console: ${gscSites.size} properties visible to the service account.`); }
  else say(`Search Console: not read — ${g.why}`);

  const firstSeenPath = join(OUT, "first-seen.json");
  const firstSeen = existsSync(firstSeenPath) ? JSON.parse(readFileSync(firstSeenPath, "utf8")) : {};
  const siteResults = [];
  const lastWeek = lastWeekRows(new Date().toISOString().slice(0, 10));
  for (const site of sites) {
    try {
      const r = await auditSite(site, checklist, g, gscSites, portfolio, firstSeen[site.domain] ?? {}, lastWeek.get(site.domain) ?? null);
      siteResults.push(r);
      say(summaryLines([r])[0]);
      if (r.lanes) say(`  ${r.lanes.line}`);
      if (r.leads) say(`  ${r.leads.line}${r.leads.red ? " — RED: people come, nobody acts" : ""}`);
    } catch (e) {
      say(`${site.domain}: AUDIT FAILED ${e?.stack ?? e}`);
      siteResults.push({ site, host: site.domain, results: [{ id: "audit", status: "not_checked", detail: `the audit of this site threw: ${String(e?.message ?? e).slice(0, 200)}` }] });
    }
  }
  const ran = siteResults.reduce((n, s) => n + s.results.filter((r) => r.status === "pass" || r.status === "fail").length, 0);
  if (!ran) stop(8, "CHECKED_NOTHING", `${siteResults.length} sites and zero checks reached a verdict. Not a clean week: the auditor is blind.`);

  const day = new Date().toISOString().slice(0, 10);
  // The first-seen ledger: the day each sitemap page was first seen (the fold queue's age floor).
  for (const s of siteResults) if (s.sitemapUrls) { firstSeen[s.site.domain] = nextFirstSeen(firstSeen[s.site.domain], s.sitemapUrls, day); delete s.sitemapUrls; }
  if (!only) writeJson(firstSeenPath, firstSeen);
  const red = redLines(siteResults);
  const gold = slipLines(siteResults);
  const prevPath = join(OUT, "latest.json");
  const previous = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : null;
  // Why each failure is on the list (owner, 6 Nov 2026): new site, slipped back, new item, still open,
  // counted from this run against the earlier dated runs.
  const history = earlierRuns(day);
  const split = failureSplit(checklist, siteResults, { history });
  const report = {
    day, at: new Date().toISOString(), checklist_items: checklist.items.length,
    // Which definition measured this run, so a brief can always be traced to the sites.json that made it.
    definition: defs.source,
    // The red lines head the report and the Monday email: outcomes and quality, never presence.
    red_lines: red,
    // Gold (3 Nov 2026): a quarter or more down two weeks running, each with its diagnosis.
    gold_lines: gold,
    failure_split: { ...split, line: splitLine(split), history_runs: history.length },
    sites: siteResults.map((s) => ({ ...s, failing: s.results.filter((r) => r.status === "fail").map((r) => r.id) })),
  };
  writeJson(join(OUT, `results-${day}.json`), report);
  if (!only) writeJson(prevPath, report);
  // Her yes (Hicks, 3 Nov 2026): an approved plan for a site in the last 14 days lets its briefs be worked.
  const boss = DRY ? { ok: false, why: "dry run: nothing is posted" } : await bossSession();
  const approvedOrigins = boss.ok ? await approvedPlanOrigins(boss) : null;
  for (const s of siteResults) if (s.site?.owner_approval) s.approved = Boolean(approvedOrigins?.some((o) => o.startsWith(`sr-${s.site.domain}-`)));
  const briefs = [...fixBriefs(checklist, siteResults), ...weeklyBriefs(siteResults)];
  if (!only && !DRY) for (const s of siteResults) {
    const card = approvalCard(s, briefs);
    if (!card) continue;
    const r = boss.ok ? await raiseApproval(boss, card) : { ok: false, why: boss.why };
    s.approval = r.ok ? { origin_id: card.origin_id, raised: r.raised } : { not_read: r.why };
    say(r.ok ? `${s.site.domain}: fix plan ${r.raised ? "sent to you for approval" : "already waiting for your approval"}.` : `${s.site.domain}: NAMED STOP [APPROVAL_NOT_RAISED] the fix plan could not be sent for approval (${r.why}); its briefs stay held.`);
  }
  if (!only) writeJson(join(OUT, "fix-queue.json"), { written_at: report.at, from: `results-${day}.json`, definition: defs.source, approved_sites: siteResults.filter((s) => s.site?.owner_approval && s.approved).map((s) => s.site.domain), consumer: "Danielle's Tuesday repair run (scripts/ops/search-readiness-fix.sh, one site's repo at a time through scripts/ops/ahrefs-audit-fix.sh) and her Thursday repair run, section 'The Search Readiness fix queue' of its prompt", briefs });

  // What passes now clears its old open finding in Boss OS, so nothing asks her for what is already true.
  if (!only && !DRY) {
    const passes = passingItems(siteResults);
    const cleared = await postCleared(passes, report.at);
    say(cleared.ok ? `Boss OS: ${cleared.archived} old finding(s) cleared by checks that now pass.` : `Boss OS: old findings not cleared (${cleared.why}).`);
  }

  const fails = siteResults.reduce((n, s) => n + s.results.filter((r) => r.status === "fail").length, 0);
  say(`\nRED LINES (${red.length}):${red.length ? "" : " none"}`);
  for (const r of red) say(`  RED ${r.line}`);
  say(`SLIPPING (${gold.length}):${gold.length ? "" : " none"}`);
  for (const r of gold) say(`  GOLD ${r.line}`);
  for (const s of siteResults) for (const l of s.diagnosis?.text ?? []) say(`    ${s.site.domain} · ${l}`);
  for (const s of siteResults) if (s.outcome?.status === "not_read") say(`  ${s.site.domain}: search results not read: ${s.outcome.why}`);
  say(`\nSPLIT (against ${history.length} earlier runs): ${splitLine(split)}`);
  say(`\nSEARCH-READINESS: sites=${siteResults.length} checks=${ran} failing=${fails} new_sites=${split.new_sites} slipped_back=${split.slipped_back} new_items=${split.new_items} still_open=${split.still_open} briefs=${briefs.length}${DRY ? " DRY-RUN (nothing posted)" : ""} → ${join(OUT, `results-${day}.json`)}`);

  if (flag("--morning") && !only && !DRY) {
    const { writeMorningSection } = await import("../../src/shared/boss/mail/morning.mjs");
    const statusPath = join(OUT, "fix-status.json");
    const lastRepair = existsSync(statusPath) ? JSON.parse(readFileSync(statusPath, "utf8")) : null;
    const lines = morningLines(checklist, siteResults, { redLines: red, goldLines: gold, categories: readRepoCategories(), previous: previous?.day !== day ? previous : null, history, queued: briefs.filter((b) => b.disposition === "fix").length, lastRepair });
    writeMorningSection("grid_repos", { lines, link: { label: "See every site's checks →", url: "https://boss.sequoiataylor.com/?view=morning" } });
    say(`Morning section written: ${lines.length} lines.`);
  }
}

/** A Boss OS session cookie, or { ok: false, why }. */
async function bossSession() {
  if (!process.env.BOSS_PASSCODE) return { ok: false, why: "no passcode in this process" };
  try {
    const origin = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
    const u = await fetch(`${origin}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }) });
    if (!u.ok) return { ok: false, why: `unlock ${u.status}` };
    return { ok: true, origin, cookie: (u.headers.get("set-cookie") ?? "").split(";")[0] };
  } catch (e) { return { ok: false, why: String(e?.message ?? e).slice(0, 120) }; }
}
const approvalRows = async (b, status) => {
  const r = await fetch(`${b.origin}/api/boss/approvals?status=${status}`, { headers: { cookie: b.cookie } }).catch(() => null);
  return r?.ok ? ((await r.json()).data ?? []) : null;
};
/** A row time as ms: epoch number or ISO text. */
const whenMs = (v) => (typeof v === "number" ? v : /^\d+$/.test(String(v ?? "")) ? Number(v) : Date.parse(String(v ?? "")) || 0);
/** Origins of search fix plans she approved in the last 14 days; null when unread (then nothing is released). */
async function approvedPlanOrigins(b) {
  const rows = await approvalRows(b, "approved");
  if (!rows) return null;
  const since = Date.now() - 14 * 86_400_000;
  return rows.filter((a) => a.kind === "search_fix_plan" && whenMs(a.decided_at ?? a.requested_at) >= since).map((a) => String(a.origin_id ?? ""));
}
/** Raise the card once per site per week: a pending row with the same origin is left alone. */
async function raiseApproval(b, card) {
  const pending = await approvalRows(b, "pending");
  if (!pending) return { ok: false, why: "the pending approvals could not be read" };
  if (pending.some((a) => a.origin_id === card.origin_id)) return { ok: true, raised: false };
  const r = await fetch(`${b.origin}/api/boss/approvals`, { method: "POST", headers: { cookie: b.cookie, "content-type": "application/json" }, body: JSON.stringify(card) }).catch(() => null);
  return r?.ok ? { ok: true, raised: true } : { ok: false, why: `Boss OS answered ${r?.status ?? "nothing"}` };
}

/** POST the passing items; `{ ok, archived }` or `{ ok: false, why }`. Never fails the audit. */
async function postCleared(passes, at) {
  if (!process.env.BOSS_PASSCODE) return { ok: false, why: "no passcode in this process" };
  try {
    const origin = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
    const u = await fetch(`${origin}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }) });
    if (!u.ok) return { ok: false, why: `unlock ${u.status}` };
    const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
    const r = await fetch(`${origin}/api/boss/engineering/site-audit-findings/cleared`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ passes, at }) });
    if (!r.ok) return { ok: false, why: `answered ${r.status}` };
    return { ok: true, archived: (await r.json()).data?.archived ?? 0 };
  } catch (e) { return { ok: false, why: String(e?.message ?? e).slice(0, 120) }; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`SEARCH READINESS AUDIT FAILED: ${e?.stack ?? e}`); process.exit(1); });
}
