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
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { passingItems,
  loadChecklist, loadSites, applies, runChecks, expandCoverage, fixBriefs, morningLines, summaryLines,
  metaContent, links, samplePages, FRESH_FILE_NAMES, indexnowKeyFiles, definitionChoice, CHECKLIST_PATH, SITES_PATH,
} from "../../src/shared/boss/searchReadiness/audit.mjs";

const OUT = process.env.SEARCH_READINESS_DIR ?? join(homedir(), ".boss-os", "search-readiness");
const REPOS = join(OUT, "repos");
const OWNER = "seq23";
const UA = "Mozilla/5.0 (compatible; BossOS-SearchReadiness/1.0; +https://boss.sequoiataylor.com)";
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const SAMPLE = Number(opt("--sample") ?? 12);
const CRAWL_CAP = 300;
const say = (...a) => console.log(...a);
const stop = (code, tag, why) => { console.error(`NAMED STOP [${tag}] ${why}`); process.exit(code); };

// ─── fetching ─────────────────────────────────────────────────────────────────

async function get(url, { redirect = "follow", timeout = 20_000, text = true, method = "GET", accept = "text/html,application/xml,text/plain,*/*" } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { method, redirect, signal: ctl.signal, headers: { "user-agent": UA, accept } });
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
  const children = [], urls = new Set(), seen = new Set(); let any = false;
  const visit = async (u, depth) => {
    if (seen.has(u)) return; seen.add(u);
    const r = await get(u);
    if (r.status !== 200) { children.push({ url: u, status: r.status ?? r.error, count: 0 }); return; }
    any = true;
    if (/<sitemapindex/i.test(r.text)) { if (depth < 2) for (const c of locs(r.text)) await visit(c, depth + 1); return; }
    const l = locs(r.text);
    children.push({ url: u, status: 200, count: l.length, lastmods: lastmods(r.text) });
    for (const x of l) urls.add(x);
  };
  for (const r of roots) await visit(r, 0);
  return { ok: any, why: any ? null : "no sitemap answered 200", roots, children, urls };
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
  const v = { ok: true, ref, files, show, workflows, fresh, indexnowKey, indexnowKeys, scriptsMentioningGscTruth, visibility: view.status === 0 ? view.stdout.trim() : null, prRunMinutes, llmRouting: show("config/llm_routing.json"), claudeMd: show("CLAUDE.md") };
  repoCache.set(name, v);
  return v;
}

// ─── one site ─────────────────────────────────────────────────────────────────

async function auditSite(site, checklist, g, gscSites, portfolio) {
  const t0 = Date.now();
  const start = await get(`https://${site.domain}/`);
  const host = start.final ? new URL(start.final).hostname : site.domain;
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

  // og:image, IndexNow key, portfolio link targets.
  const ogUrl = metaContent(home.html, "og:image")[0];
  if (ogUrl) { const abs = new URL(ogUrl, home.url).href; const r = await get(abs, { text: false }); files.__og_image = { url: abs, status: r.status }; }
  // Probe every key the repo holds: this host answers at most one of them (readRepo, indexnowKeys).
  for (const key of repo.ok ? repo.indexnowKeys ?? [] : []) {
    const r = await get(`https://${host}/${key}.txt`);
    files[`/${key}.txt`] = { status: r.status, text: (r.text ?? "").slice(0, 400) };
  }
  if (applies({ check: { applies_to: ["authority", "role:companion"] } }, site)) {
    const outs = [...new Set(pages.flatMap((p) => (p.html ? links(p.html, p.url) : [])).filter((l) => portfolio.includes(l.host) && l.host !== host.replace(/^www\./, "")).map((l) => l.url))].slice(0, 15);
    files.__targets = await pool(outs, 6, async (u) => { const r = await get(u, { text: false }); return { url: u, status: r.status, error: r.error }; });
  }
  const needsCrawl = checklist.items.some((i) => i.check.type === "no_orphans" && applies(i, site));
  const crawled = needsCrawl && home.status === 200 ? await crawl(host, home.html, CRAWL_CAP) : null;
  const gsc = await gscFor(g, gscSites, site, host);
  const ps = await psi(host);

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
  const pr = protectedReport.filter((p) => !p.sha256_matches || p.buy_link_on_page === false || (p.buy_link_status && p.buy_link_status !== 200));
  if (pr.length) results.push({ id: "protected", status: "fail", detail: pr.map((p) => `${p.path}: ${p.status !== 200 ? `answered ${p.status}` : !p.sha256_matches ? "content changed (hash differs)" : p.buy_link_on_page === false ? "the Gumroad buy link is gone" : `the Gumroad buy link answered ${p.buy_link_status}`}`).join("; "), evidence: pr.map((p) => p.path) });
  return {
    site, host, seconds: Math.round((Date.now() - t0) / 1000), home_status: home.status,
    sitemap: { ok: sitemap.ok, urls: sitemap.urls.size, children: sitemap.children.map(({ url, status, count }) => ({ url, status, count })) },
    coverage: coverage.error ? { error: coverage.error } : { targets: coverage.targets.length, missing: coverage.targets.filter((t) => !t.inSitemap || t.status !== 200).map((t) => t.url) },
    protected: protectedReport, results,
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
    const w = workQueue(JSON.parse(readFileSync(q, "utf8")).briefs);
    for (const r of w.repos) console.log(`REPO ${r.repo} ${r.n}`);
    for (const c of w.chunks) console.log(`CHUNK ${c.repo} ${c.ids.length} ${c.ids.join(",")}`);
    console.log(`QUEUE total=${w.total} workable=${w.workable} protected=${w.protected} no_repo=${w.no_repo}`);
    return;
  }
  if (flag("--queue")) {
    const q = join(OUT, "fix-queue.json");
    if (!existsSync(q)) stop(3, "NO_QUEUE", `${q} does not exist yet; run npm run sites:audit first.`);
    const v = JSON.parse(readFileSync(q, "utf8"));
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

  const siteResults = [];
  for (const site of sites) {
    try {
      const r = await auditSite(site, checklist, g, gscSites, portfolio);
      siteResults.push(r);
      say(summaryLines([r])[0]);
    } catch (e) {
      say(`${site.domain}: AUDIT FAILED ${e?.stack ?? e}`);
      siteResults.push({ site, host: site.domain, results: [{ id: "audit", status: "not_checked", detail: `the audit of this site threw: ${String(e?.message ?? e).slice(0, 200)}` }] });
    }
  }
  const ran = siteResults.reduce((n, s) => n + s.results.filter((r) => r.status === "pass" || r.status === "fail").length, 0);
  if (!ran) stop(8, "CHECKED_NOTHING", `${siteResults.length} sites and zero checks reached a verdict. Not a clean week: the auditor is blind.`);

  const day = new Date().toISOString().slice(0, 10);
  const prevPath = join(OUT, "latest.json");
  const previous = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : null;
  const report = {
    day, at: new Date().toISOString(), checklist_items: checklist.items.length,
    // Which definition measured this run, so a brief can always be traced to the sites.json that made it.
    definition: defs.source,
    sites: siteResults.map((s) => ({ ...s, failing: s.results.filter((r) => r.status === "fail").map((r) => r.id) })),
  };
  writeJson(join(OUT, `results-${day}.json`), report);
  if (!only) writeJson(prevPath, report);
  const briefs = fixBriefs(checklist, siteResults);
  if (!only) writeJson(join(OUT, "fix-queue.json"), { written_at: report.at, from: `results-${day}.json`, definition: defs.source, consumer: "Danielle's Tuesday repair run (scripts/ops/search-readiness-fix.sh, one site's repo at a time through scripts/ops/ahrefs-audit-fix.sh) and her Thursday repair run, section 'The Search Readiness fix queue' of its prompt", briefs });

  // What passes now clears its old open finding in Boss OS, so nothing asks her for what is already true.
  if (!only) {
    const passes = passingItems(siteResults);
    const cleared = await postCleared(passes, report.at);
    say(cleared.ok ? `Boss OS: ${cleared.archived} old finding(s) cleared by checks that now pass.` : `Boss OS: old findings not cleared (${cleared.why}).`);
  }

  const fails = siteResults.reduce((n, s) => n + s.results.filter((r) => r.status === "fail").length, 0);
  say(`\nSEARCH-READINESS: sites=${siteResults.length} checks=${ran} failing=${fails} briefs=${briefs.length} → ${join(OUT, `results-${day}.json`)}`);

  if (flag("--morning") && !only) {
    const { writeMorningSection } = await import("../../src/shared/boss/mail/morning.mjs");
    const statusPath = join(OUT, "fix-status.json");
    const lastRepair = existsSync(statusPath) ? JSON.parse(readFileSync(statusPath, "utf8")) : null;
    const lines = morningLines(checklist, siteResults, { previous: previous?.day !== day ? previous : null, queued: briefs.filter((b) => b.disposition === "fix").length, lastRepair });
    writeMorningSection("grid_repos", { lines, link: { label: "See every site's checks →", url: "https://boss.sequoiataylor.com/?view=morning" } });
    say(`Morning section written: ${lines.length} lines.`);
  }
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
