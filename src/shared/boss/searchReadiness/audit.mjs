/**
 * THE SEARCH READINESS CHECKLIST, ENFORCED — the pure half (owner, 25 Oct 2026).
 *
 * Her pinned Search Readiness Checklist was a page whose ticks lived in a browser; nothing ran it,
 * so gaps were found only when she asked (25 Oct: memphisseniorcarehomes.com had two empty sitemaps
 * and no neighborhood, extra-town or hospital pages). The checklist is now data:
 *
 *   checklist.json  every item (72: the page's 71 plus j9, hyperlocal coverage) as a machine check
 *                   or a manual item with its reason.
 *   sites.json      the grid repos: every site it runs on, its category, kind and coverage targets.
 *
 * This file holds everything that does not touch the network — the HTML/sitemap readers, every check
 * as a function of what was fetched, the coverage expansion, the fix briefs and the morning lines —
 * so it is tested (`tests/searchReadiness.test.ts`). `scripts/ops/search-readiness-audit.mjs` does
 * the fetching and the writing. `scripts/ops/search-readiness-page.mjs` renders the page from the
 * same checklist.json, so the page and the checks are one definition.
 */
import { categoryOf } from "../repos/categories.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { weekFor, publishingOn, capOk, checksRan, aiMeasured, laneLine, LANES_NOT_YET, CAP } from "../searchLoop/week.mjs";
import { mayAutoFix } from "../siteAudit/repoPolicy.mjs";
import { heldForOwner } from "./ownerApproval.mjs";
import { leadsMorningLines } from "./site-leads.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CHECKLIST_PATH = join(HERE, "checklist.json");
export const SITES_PATH = join(HERE, "sites.json");
export const loadChecklist = (raw) => JSON.parse(raw ?? readFileSync(CHECKLIST_PATH, "utf8"));
export const loadSites = (raw) => JSON.parse(raw ?? readFileSync(SITES_PATH, "utf8"));

/**
 * WHICH DEFINITION THE AUDIT MEASURES WITH — the branch's, never a stale checkout's.
 *
 * 26 Oct 2026: the audit runs from her own boss-os checkout (launchd, `com.seq.boss-sites-audit`),
 * which nothing updates. That checkout sat at #147 while main held the corrected aplayermode.com
 * mapping (#148, 25 Oct), so the run measured the apex against seq23/aplayer-mode — a repo that
 * never served that host — and wrote five fix briefs (e3, e4, e5, i3, i6) for files that were
 * present all along in the repo that does serve it. A stale definition does not fail; it invents
 * work. So the runner reads checklist.json and sites.json from origin/<default> and measures with
 * those, saying so when they differ from the checkout.
 *
 * Pure on purpose: the git read lives in the runner, the decision is tested here.
 * `remote` is the text at origin/<default> (null when git could not be read), `local` the checkout's.
 */
export function definitionChoice({ local, remote, path = "" } = {}) {
  const parses = (t) => { if (typeof t !== "string" || !t.trim()) return null; try { JSON.parse(t); return t; } catch { return null; } };
  const r = parses(remote), l = parses(local);
  if (!l && !r) return { text: null, source: "none", stale: false, why: `neither the checkout nor origin holds readable JSON at ${path}` };
  if (!r) return { text: l, source: "checkout", stale: false, unverified: true, why: `origin's ${path} could not be read; measured with the checkout's copy` };
  if (!l) return { text: r, source: "origin", stale: true, why: `the checkout has no readable ${path}; measured with origin's` };
  if (r === l) return { text: l, source: "checkout", stale: false, why: `${path} matches origin` };
  return { text: r, source: "origin", stale: true, why: `the checkout's ${path} differs from origin; measured with origin's` };
}

/** Item statuses. Only `fail` makes a fix brief; `not_checked` and `no_repo` are said, never passed. */
export const STATUS = Object.freeze(["pass", "fail", "not_checked", "no_repo", "skipped"]);

// ─── Which items apply to which site ─────────────────────────────────────────

export function applies(item, site) {
  const a = item.check?.applies_to ?? [];
  // `flag:ymyl` reaches only the sites sites.json marks ymyl: true (medical, legal, financial). No item
  // uses it since k5 (a named reviewer) was removed on 6 Nov 2026; it stays for YMYL care items.
  // `flag:search_loop` reaches only the selling sites sites.json gives a `search_loop` entry (1 Nov 2026).
  return a.includes(site.kind) || (site.roles ?? []).some((r) => a.includes(`role:${r}`)) || (site.ymyl === true && a.includes("flag:ymyl"))
    || (!!site.search_loop && a.includes("flag:search_loop"));
}

/**
 * WHERE A SITE SHOWS (owner, 1 Nov 2026: the client ban is replaced by her repo categories, read from
 * the personal brain's "## Repo categories"; src/shared/boss/repos/categories.mjs). Every site is
 * audited the same. "mine" sites are her standings and her email; "friends" sites show in their own
 * "Friends' sites" section and reach her email only when something needs her; "system" repos only on
 * failure. A repo in no category (or unreadable categories) shows as hers, never hidden.
 */
export function siteSection(site, categories) {
  const c = categoryOf(site?.repo, categories);
  return c === "friends" || c === "system" ? c : "mine";
}

// ─── Coverage ────────────────────────────────────────────────────────────────

export function haversineMiles(a, b) {
  const R = 3958.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const fill = (pattern, vars) => pattern.replace(/\{(\w+)\}/g, (_, k) => {
  if (vars[k] === undefined) throw new Error(`url pattern ${pattern} needs {${k}}`);
  return vars[k];
});

/**
 * The coverage targets of one site as `{ kind, name, path }`. `repoCities` is the parsed city file
 * for a `repo_cities` site (the generator's own list); hyperlocal sites carry their lists inline.
 * A `not_local` site has none — it still has a coverage entry saying why.
 */
export function expandCoverage(site, repoCities = null) {
  const c = site.coverage;
  if (!c || c.model === "not_local") return [];
  const out = [];
  if (c.model === "repo_cities") {
    if (!Array.isArray(repoCities)) throw new Error(`${site.domain}: the city file ${c.file} was not read`);
    for (const city of repoCities) {
      if (c.filter && Object.entries(c.filter).some(([k, v]) => city[k] !== v)) continue;
      out.push({ kind: "town", name: city.marketLabel ?? city.city ?? city.slug, path: fill(c.url_pattern, { slug: city.slug }) });
    }
    return out;
  }
  if (c.model === "hyperlocal") {
    const p = c.url_patterns ?? {};
    for (const t of c.towns ?? []) {
      if (p.town) out.push({ kind: "town", name: t.name, path: fill(p.town, { town: t.slug, slug: t.slug }) });
      // A town may name the services it carries (`services`: slugs, with `services_why`):
      // a service x town page folded into a nearby hub by a 301 is not a coverage target.
      const svc = Array.isArray(t.services) ? (c.services ?? []).filter((s) => t.services.includes(s.slug)) : (c.services ?? []);
      if (p.service_town) for (const s of svc) out.push({ kind: "service_town", name: `${s.name} in ${t.name}`, path: fill(p.service_town, { town: t.slug, service: s.slug }) });
    }
    if (p.neighborhood) for (const n of c.neighborhoods ?? []) out.push({ kind: "neighborhood", name: n.name, path: fill(p.neighborhood, { slug: n.slug }) });
    if (p.anchor) for (const a of c.anchors ?? []) out.push({ kind: "anchor", name: a.name, path: fill(p.anchor, { slug: a.slug }) });
    // A site that folded its place pages into hubs (`folded_why`) is held to the hubs they land on.
    for (const h of c.hubs ?? []) out.push({ kind: "hub", name: h.name, path: h.path });
    return out;
  }
  throw new Error(`${site.domain}: unknown coverage model "${c.model}"`);
}

/** What is wrong with a site's coverage entry. `[]` = checkable. Pure; the guard test calls it. */
export function coverageProblems(site) {
  const c = site.coverage;
  if (!c || typeof c !== "object") return ["no coverage entry"];
  if (!c.model) return ["coverage has no model"];
  if (!c.why || c.why.length < 20) return ["coverage has no reason worth reading (why)"];
  const p = [];
  if (c.model === "repo_cities") {
    if (!c.repo || !c.file || !c.url_pattern) p.push("repo_cities needs repo, file and url_pattern");
  } else if (c.model === "hyperlocal") {
    if (!c.center || typeof c.radius_miles !== "number") p.push("hyperlocal needs a center and radius_miles");
    if (!(c.towns?.length >= 5)) p.push("hyperlocal needs the towns inside its radius (at least five)");
    for (const t of c.towns ?? []) if (c.center && haversineMiles(c.center, t) > c.radius_miles) p.push(`${t.name} is ${haversineMiles(c.center, t).toFixed(1)} miles out, past the ${c.radius_miles}-mile radius`);
    // FOLDED (p-n-p #180, 4 Nov 2026): place pages folded into service hubs by 301s need no
    // neighborhood or anchor list, but must say so (`folded_why`) and name the hubs they land on.
    const folded = String(c.folded_why ?? "").length >= 20;
    if (folded && !(c.hubs?.length >= 1 && c.hubs.every((h) => h?.name && /^\//.test(String(h?.path ?? ""))))) p.push("a folded hyperlocal site names the hubs its places now land on (hubs)");
    if (!folded && !(c.neighborhoods?.length >= 1)) p.push("hyperlocal needs neighborhoods");
    if (!folded && !(c.anchors?.length >= 1)) p.push("hyperlocal needs local anchors (hospitals, venues)");
    if (!(c.services?.length >= 1) || !c.url_patterns?.service_town) p.push("hyperlocal needs services and a service_town pattern");
    for (const t of c.towns ?? []) if (Array.isArray(t.services) && !(String(t.services_why ?? "").length >= 20)) p.push(`town ${t.slug} narrows its services without a reason (services_why)`);
  } else if (c.model !== "not_local") p.push(`unknown coverage model ${c.model}`);
  return p;
}

// ─── HTML readers (regex, no dependency: the pages are machine-built) ──────────

const decode = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

export function attrs(tag) {
  const out = {};
  for (const m of String(tag).matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? "");
  return out;
}
export const tags = (html, name) => [...String(html).matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => ({ raw: m[0], ...attrs(m[0]) }));
export function metaContent(html, key) {
  const hits = tags(html, "meta").filter((t) => (t.name ?? t.property ?? "").toLowerCase() === key.toLowerCase());
  return hits.map((t) => t.content ?? "");
}
export const titleOf = (html) => decode((String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim());
export const canonicalOf = (html) => tags(html, "link").find((t) => (t.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"))?.href ?? null;
export const h1Count = (html) => (String(html).match(/<h1\b/gi) ?? []).length;

export function visibleText(html) {
  return decode(String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
export const wordCount = (text) => (String(text).match(/[A-Za-z0-9][\w'’-]*/g) ?? []).length;
/*
 * Word limits follow the owner's ruling of 2 Nov 2026 (personal brain, Settled decisions): "over a
 * word limit never fails; under one fails only below 75% of it". A page a few words short of a
 * target is a note, not a defect a reader would notice. Before this, guide_shape failed
 * dentistryguides.com guides at 1,679-1,796 words against an 1,800 target (93-99.8% of it) and
 * queued them as fix work; the generator's own guide floor already applied the cushion.
 */
export const FLOOR_FAIL_SHARE = 0.75;
export const hardFloor = (floor) => Math.ceil(floor * FLOOR_FAIL_SHARE);
const shortNote = (rows, target) => rows.length ? `; ${rows.length} under the ${target.toLocaleString("en-US")}-word target but not below ${hardFloor(target).toLocaleString("en-US")}, not blocking: ${list(rows)}` : "";

/** Every JSON-LD node on the page, @graph flattened. Unparseable blocks are returned as errors. */
export function jsonLd(html) {
  const nodes = [], errors = [];
  for (const m of String(html).matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1]);
      const walk = (x) => {
        if (Array.isArray(x)) return x.forEach(walk);
        if (x && typeof x === "object") { if (x["@graph"]) walk(x["@graph"]); if (x["@type"]) nodes.push(x); }
      };
      walk(v);
    } catch (e) { errors.push(String(e.message).slice(0, 80)); }
  }
  return { nodes, errors };
}
export const typesOf = (n) => [].concat(n?.["@type"] ?? []).map(String);
const hasType = (nodes, re) => nodes.some((n) => typesOf(n).some((t) => re.test(t)));
/** Every node of a type, including nested ones (mainEntity, itemListElement, item…). */
export function deepNodes(nodes, re) {
  const out = [], seen = new Set();
  const walk = (x) => {
    if (!x || typeof x !== "object" || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) return x.forEach(walk);
    if (typesOf(x).some((t) => re.test(t))) out.push(x);
    for (const v of Object.values(x)) if (v && typeof v === "object") walk(v);
  };
  walk(nodes);
  return out;
}

export function links(html, base) {
  const out = [];
  for (const t of tags(html, "a")) {
    if (!t.href || /^(#|mailto:|tel:|javascript:)/i.test(t.href)) continue;
    let u; try { u = new URL(t.href, base); } catch { continue; }
    out.push({ url: u.href.split("#")[0], host: u.hostname.replace(/^www\./, ""), rel: (t.rel ?? "").toLowerCase(), raw: t.raw });
  }
  return out;
}

const norm = (u) => { try { const x = new URL(u); return `${x.protocol}//${x.hostname}${x.pathname.replace(/\/+$/, "") || ""}${x.search}`; } catch { return String(u); } };
// A page that exists because something requires it to, not to be found in search.
// `editorial-policy` joined the list on 3 Nov 2026: it is the page a publication
// points its byline at, required for the authorship disclosure, and never a search
// target - but it was missing here, so the consolidation queue offered
// uscisexam.com/editorial-policy/ and dentistryguides.com/editorial-policy/ as
// pages to 301 into their home pages.
export const isUtility = (url) => /\/(privacy|terms|legal|cookie|disclaimer|editorial-policy|accessibility|contact|thank|thanks|login|signin|404|search|unsubscribe|sitemap)/i.test(new URL(url).pathname);

// ─── The checks ───────────────────────────────────────────────────────────────
// Each takes the fetched context and returns { status, detail, evidence?, missing? }.
// ctx: { site, host (canonical), home: {url,status,html,headers}, pages: [{url,status,html,headers,redirected,final}],
//        robots: {status,type,text}, sitemap: {ok, roots, children:[{url,status,count,lastmods}], urls:Set},
//        files: {path: {status,type,text}}, gsc, repo, crawl, coverage, psi, portfolio: [hosts], protectedPaths }

const pass = (detail, extra = {}) => ({ status: "pass", detail, ...extra });
const fail = (detail, extra = {}) => ({ status: "fail", detail, ...extra });
const notChecked = (detail) => ({ status: "not_checked", detail });
const okPages = (ctx) => ctx.pages.filter((p) => p.status === 200 && p.html);
/*
 * The URL a page's HTML actually came from. Our fetches follow redirects, so a record's `url` is what
 * was asked for and `final` is what answered; two requests that land on one page must count as one
 * page. canonical_self has read it this way since 26 Oct 2026.
 */
const pageUrl = (p) => p.final ?? p.url;
const urlKey = (u) => String(u).replace(/[?#].*$/, "").replace(/\/+$/, "");
const list = (arr, n = 5) => arr.slice(0, n).join("; ") + (arr.length > n ? `; and ${arr.length - n} more` : "");
// i11 paid_routes_gated: where server code lives, what a paid call looks like, and the two credential shapes.
const SERVER_PATH = /^(functions|workers?|api|server|supabase\/functions|app\/api|pages\/api|src\/(worker|server|pages\/api|app\/api))\/|(^|\/)_worker\.js$/;
const PAID_CALL = /api\.openai\.com|api\.anthropic\.com|openrouter\.ai\/api|api\.elevenlabs\.io|api\.fish\.audio|api\.d-id\.com|api\.heygen\.com|generativelanguage\.googleapis\.com|api\.replicate\.com|fal\.run|api\.resend\.com|api\.sendgrid\.com|api\.twilio\.com|maps\.googleapis\.com|places\.googleapis\.com|env\.AI\.run\(/;
const ACCEPTED_HASH = /(PASSWORD|PASSCODE|ADMIN)[A-Z_]*HASH\s*=\s*['"`][0-9a-fA-F]{32,}['"`]/;
const FALLBACK_SECRET = /(PASSWORD|PASSCODE|SECRET|ADMIN_KEY|ADMIN_TOKEN)[A-Z_]*\s*(\|\||\?\?)\s*['"`][^'"`\s]{3,}['"`]/;
const RATE_LIMIT = /rate.?limit|too many|\b429\b/i;

export const CHECKS = {
  host_redirect(ctx) {
    const r = ctx.files.__other_host;
    if (!r) return notChecked("the other host was not probed");
    if (r.error && /ENOTFOUND|getaddrinfo/i.test(r.error)) return pass(`${r.from} has no DNS record, so it cannot split signals`);
    if ([301, 308].includes(r.status) && r.location && new URL(r.location, r.from).hostname === ctx.host) return pass(`${r.from} answers ${r.status} to ${ctx.host}`);
    return fail(`${r.from} answered ${r.status ?? r.error}${r.location ? ` → ${r.location}` : ""}, not a 301 to ${ctx.host}`, { evidence: [r.from] });
  },
  // The canonical is compared against the URL the HTML actually came from, not
  // the URL that was requested. Our fetches follow redirects, so a host whose /
  // answers 308 to its one money page hands back that page's HTML under the
  // request URL `https://host/`; comparing the two called three correct sites
  // broken on 26 Oct 2026 (weddingbudgetspreadsheet.com,
  // weddingseatingchartmaker.com, weddingtimelinetemplate.com - each / is a 308
  // to a page whose canonical is itself, which is right, not a defect). A page
  // that redirects is reported as a redirect by sitemap_clean; it is not this
  // check's business. `final` is the fetch's resolved URL; `url` is the fallback
  // for records that carry no redirect information.
  canonical_self(ctx) {
    const bad = [];
    for (const p of okPages(ctx)) {
      const served = p.final ?? p.url;
      const c = canonicalOf(p.html);
      if (!c) { bad.push(`${served} has no canonical`); continue; }
      let abs; try { abs = new URL(c, served).href; } catch { abs = c; }
      const via = served === p.url ? "" : ` (${p.url} → ${served})`;
      if (norm(abs) !== norm(served)) bad.push(`${served}${via} → canonical ${abs}`);
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass(`${okPages(ctx).length} pages carry a self canonical`);
  },
  indexable_pages(ctx) {
    const bad = okPages(ctx).filter((p) => metaContent(p.html, "robots").some((c) => /noindex/i.test(c)) || /noindex/i.test(p.headers?.["x-robots-tag"] ?? "")).map((p) => p.url);
    return bad.length ? fail(`noindex on ${list(bad)}`, { evidence: bad }) : pass("no sampled page is noindexed");
  },
  robots_ok(ctx, params) {
    const r = ctx.robots;
    if (!r || r.status !== 200) return fail(`robots.txt answered ${r?.status ?? "nothing"}`);
    const why = [];
    if (!/text\/plain/i.test(r.type ?? "")) why.push(`served as ${r.type || "no type"}`);
    if (!/^\s*sitemap\s*:/im.test(r.text)) why.push("no Sitemap line");
    // Group the rules by user-agent and look for Disallow: / under any AI agent or under * with no override.
    const groups = []; let cur = null;
    for (const line of r.text.split(/\r?\n/)) {
      const m = line.match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*(#.*)?$/i); if (!m) continue;
      const k = m[1].toLowerCase(), v = m[2];
      if (k === "user-agent") { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
      else if (cur && (k === "disallow" || k === "allow")) cur.rules.push({ k, v });
    }
    const blocks = (g) => g && g.rules.some((x) => x.k === "disallow" && x.v === "/") && !g.rules.some((x) => x.k === "allow" && x.v === "/");
    for (const a of params?.ai_agents ?? []) {
      const own = groups.find((g) => g.agents.includes(a.toLowerCase()));
      if (own ? blocks(own) : blocks(groups.find((g) => g.agents.includes("*")))) why.push(`${a} is disallowed`);
    }
    return why.length ? fail(`robots.txt: ${why.join(", ")}`) : pass("robots.txt is 200 text/plain with a Sitemap line; AI crawlers allowed");
  },
  sitemap_valid(ctx) {
    const s = ctx.sitemap;
    if (!s?.ok) return fail(`no readable sitemap (${s?.why ?? "not fetched"})`);
    const why = [], evidence = [];
    for (const c of s.children) {
      if (c.status !== 200) { why.push(`${c.url} answered ${c.status}`); evidence.push(c.url); }
      else if (c.count === 0) { why.push(`${c.url} is empty`); evidence.push(c.url); }
    }
    const off = [...s.urls].filter((u) => { try { return new URL(u).hostname !== ctx.host; } catch { return true; } });
    if (off.length) why.push(`${off.length} URLs are not on ${ctx.host} (e.g. ${off[0]})`);
    const redirected = ctx.pages.filter((p) => p.fromSitemap && (p.redirected || p.status !== 200)).map((p) => `${p.url} (${p.status}${p.redirected ? ", redirects" : ""})`);
    if (redirected.length) { why.push(`sampled sitemap URLs not a clean 200: ${list(redirected, 3)}`); evidence.push(...redirected); }
    return why.length ? fail(list(why, 6), { evidence }) : pass(`${s.urls.size} URLs across ${s.children.length || 1} sitemap file(s), none empty`);
  },
  llms_txt(ctx) {
    const f = ctx.files["/llms.txt"];
    if (!f || f.status !== 200) return fail(`/llms.txt answered ${f?.status ?? "nothing"}`, { missing: [`https://${ctx.host}/llms.txt`] });
    if (/<html/i.test(f.text.slice(0, 400))) return fail("/llms.txt serves HTML (a catch-all), not the file");
    if (!/text\/plain|text\/markdown/i.test(f.type ?? "")) return fail(`/llms.txt is served as ${f.type}`);
    const w = wordCount(f.text);
    // Over a word limit never fails (owner, 2 Nov 2026): a long llms.txt is a note.
    return pass(w > 2400 ? `/llms.txt is ${w} words; note: about 2,000 reads best, not blocking` : `/llms.txt is ${w} words`);
  },
  gsc_pages_live(ctx) {
    const g = ctx.gsc; if (!g?.ok) return notChecked(g?.why ?? "Search Console not read");
    if (!g.pages) return notChecked("Search Console page rows not read");
    const dead = g.pages.filter((p) => !(p.status === 200 || (p.status === 301 && p.final === 200)) && !p.error?.startsWith("skipped")).map((p) => `${p.url} (${p.status ?? p.error})`);
    return dead.length ? fail(`pages with impressions that do not answer: ${list(dead)}`, { evidence: dead, missing: g.pages.filter((p) => p.status === 404 || p.status === 410).map((p) => p.url) }) : pass(`${g.pages.length} pages with impressions all answer`);
  },
  site_basics(ctx) {
    const f = ctx.files, why = [];
    const nf = f.__not_found;
    if (nf && nf.status !== 404) why.push(`a made-up path answered ${nf.status}${nf.location ? ` → ${nf.location}` : ""}, not 404`);
    for (const p of ["/favicon.ico", "/apple-touch-icon.png", "/site.webmanifest"]) {
      const r = f[p]; if (!r || r.status !== 200 || /<html/i.test((r.text ?? "").slice(0, 200))) why.push(`${p} answered ${r?.status ?? "nothing"}${r?.status === 200 ? " (HTML)" : ""}`);
    }
    return why.length ? fail(why.join("; "), { missing: why.filter((w) => w.startsWith("/")).map((w) => `https://${ctx.host}${w.split(" ")[0]}`) }) : pass("HTTPS, a real 404, favicon, touch icon and manifest");
  },
  lighthouse_mobile(ctx, params) {
    const p = ctx.psi; if (!p?.ok) return notChecked(p?.why ?? "PageSpeed Insights not read");
    const low = Object.entries(params).filter(([k, min]) => p.scores[k] !== undefined && p.scores[k] < min).map(([k, min]) => `${k} ${p.scores[k]} (needs ${min})`);
    return low.length ? fail(`mobile Lighthouse: ${low.join(", ")}`) : pass(`mobile Lighthouse ${Object.entries(p.scores).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  },
  title_band(ctx) {
    const bad = [], seen = {};
    // Distinct PAGES, keyed on the URL the HTML actually came from, not the one that was requested.
    // The page list is the homepage, the sitemap sample and two coverage town pages, and the sample
    // can draw the homepage or a town page again: on 25 Oct 2026 time-2-read.com,
    // memphisseniorcarehomes.com and neuroevalguides.com each "shared a title" with themselves, and
    // the fixer was briefed to fix a duplicate that did not exist. Deduplicating on the requested URL
    // fixed only half of that. Our fetches follow redirects, so a host whose / answers 308 to its one
    // money page hands the same HTML back twice under two different request URLs: on 31 Oct 2026
    // weddingbudgetspreadsheet.com was briefed for a duplicate title on
    // https://weddingbudgetspreadsheet.com/ and .../wedding-budget-spreadsheet, which are one page -
    // the first is a 308 to the second - and its own crawl of all 25 URLs found no duplicate title at
    // all. Those 308 roots are correct, not a defect (the same three sites, 26 Oct 2026, under
    // canonical_self). `final` is the fetch's resolved URL; `url` is the fallback for records that
    // carry no redirect information, exactly as canonical_self reads it.
    const checked = new Set();
    for (const p of okPages(ctx)) {
      const served = pageUrl(p);
      if (checked.has(urlKey(served))) continue;
      checked.add(urlKey(served));
      const t = titleOf(p.html);
      if (t.length < 30 || t.length > 65) bad.push(`${served} title is ${t.length} chars`);
      (seen[t] ??= []).push(served);
    }
    for (const [t, us] of Object.entries(seen)) if (us.length > 1) bad.push(`"${t.slice(0, 50)}" on ${us.length} pages (${us.slice(0, 3).join(", ")})`);
    return bad.length ? fail(list(bad), { evidence: bad }) : pass("titles 30–65 characters and unique");
  },
  meta_description(ctx) {
    const bad = [];
    for (const p of okPages(ctx)) {
      const d = metaContent(p.html, "description");
      if (d.length !== 1) bad.push(`${p.url} has ${d.length} descriptions`);
      else if (d[0].length < 120 || d[0].length > 160) bad.push(`${p.url} description is ${d[0].length} chars`);
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass("one 120–160 character description per page");
  },
  one_h1(ctx) {
    const bad = okPages(ctx).filter((p) => h1Count(p.html) !== 1).map((p) => `${p.url} has ${h1Count(p.html)} H1`);
    return bad.length ? fail(list(bad), { evidence: bad }) : pass("one H1 per page");
  },
  definition_paragraph(ctx) {
    const guides = okPages(ctx).filter((p) => /\/guides?\/[^/]+/.test(new URL(p.url).pathname));
    if (!guides.length) return notChecked("no guide page in the sample");
    const bad = [], notes = [];
    for (const p of guides) {
      const after = p.html.split(/<\/h1>/i)[1] ?? "";
      // The first real paragraph: a one-line disclaimer or byline above it is not the definition.
      const paras = [...after.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => visibleText(m[1]));
      const para = paras.find((x) => wordCount(x) >= 20) ?? paras[0] ?? "";
      const w = wordCount(para);
      if (w < hardFloor(40) || !/\b(is|are)\b/.test(para)) bad.push(`${p.url} first paragraph ${w} words`);
      else if (w < 40 || w > 60) notes.push(`${p.url} (${w} words)`);
    }
    return bad.length ? fail(list(bad), { evidence: bad })
      : pass(`${guides.length} guide pages open with a definition${notes.length ? `; ${notes.length} outside the 40–60 word target, not blocking: ${list(notes)}` : ""}`);
  },
  faq_schema_visible(ctx) {
    const bad = [];
    for (const p of okPages(ctx)) {
      const { nodes } = jsonLd(p.html);
      const faqs = deepNodes(nodes, /^FAQPage$/);
      if (faqs.length > 1) bad.push(`${p.url} has ${faqs.length} FAQPage nodes`);
      const text = visibleText(p.html).toLowerCase();
      for (const q of deepNodes(faqs, /^Question$/)) {
        const name = String(q.name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
        if (name && !text.includes(name.slice(0, 60))) bad.push(`${p.url}: schema question "${name.slice(0, 50)}" is not on the page`);
      }
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass("FAQ schema matches visible questions, one per page");
  },
  social_tags(ctx) {
    const need = ["og:title", "og:description", "og:type", "og:url", "og:site_name", "og:image", "og:image:width", "og:image:height"];
    const bad = [];
    for (const p of okPages(ctx)) {
      const miss = need.filter((k) => !metaContent(p.html, k).some(Boolean));
      if (!metaContent(p.html, "twitter:card").includes("summary_large_image")) miss.push("twitter:card summary_large_image");
      if (miss.length) bad.push(`${p.url} lacks ${miss.join(", ")}`);
    }
    const img = ctx.files.__og_image;
    if (img && img.status !== 200) bad.push(`og:image ${img.url} answered ${img.status}`);
    if (img?.url) { try { if (new URL(img.url).hostname.replace(/^www\./, "") !== ctx.host.replace(/^www\./, "")) bad.push(`og:image is on ${new URL(img.url).hostname}, not the site's own host`); } catch { /* malformed */ } }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass("complete social tags, og:image on the own host");
  },
  no_orphans(ctx) {
    const c = ctx.crawl; if (!c) return notChecked("no crawl");
    const s = ctx.sitemap; if (!s?.ok) return notChecked("no sitemap to compare with");
    const reached = new Set([...c.reached].map(norm));
    const orphans = [...s.urls].filter((u) => !reached.has(norm(u)));
    if (c.capped && orphans.length) return notChecked(`crawl stopped at its ${c.cap}-page cap with ${orphans.length} sitemap URLs not yet reached; not conclusive`);
    return orphans.length ? fail(`${orphans.length} sitemap URLs are not reachable within three clicks: ${list(orphans, 4)}`, { evidence: orphans.slice(0, 50) }) : pass(`every sitemap URL reached within three clicks (${reached.size} pages)`);
  },
  img_alt(ctx) {
    const bad = [];
    for (const p of okPages(ctx)) {
      const n = tags(p.html, "img").filter((t) => (t.alt === undefined || !t.alt.trim()) && t.role !== "presentation" && t["aria-hidden"] !== "true").length;
      if (n) bad.push(`${p.url}: ${n} images without alt`);
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass("every sampled image has alt text");
  },
  word_count(ctx, params) {
    const min = params?.min_words ?? 300;
    const measured = okPages(ctx).filter((p) => !isUtility(p.url) && new URL(p.url).pathname !== "/").map((p) => ({ u: p.url, w: wordCount(visibleText(p.html)) }));
    const bad = measured.filter((x) => x.w < hardFloor(min)).map((x) => `${x.u} (${x.w} words)`);
    const short = measured.filter((x) => x.w >= hardFloor(min) && x.w < min).map((x) => `${x.u} (${x.w} words)`);
    return bad.length ? fail(`thin pages: ${list(bad)}`, { evidence: bad }) : pass(`no sampled content page under ${hardFloor(min)} words${shortNote(short, min)}`);
  },
  organization_node(ctx) {
    const bad = [];
    for (const p of okPages(ctx)) {
      const org = deepNodes(jsonLd(p.html).nodes, /Organization|LocalBusiness|Corporation|NewsMediaOrganization|ProfessionalService/)[0];
      if (!org) { bad.push(`${p.url} has no Organization`); continue; }
      const miss = ["name", "url", "logo", "sameAs"].filter((k) => !org[k] || (Array.isArray(org[k]) && !org[k].length));
      if (miss.length) bad.push(`${p.url} Organization lacks ${miss.join(", ")}`);
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass("Organization with name, url, logo and sameAs on every page");
  },
  page_types(ctx) {
    const bad = [];
    const home = ctx.home?.html ? jsonLd(ctx.home.html).nodes : [];
    if (!hasType(home, /^WebSite$/)) bad.push("homepage has no WebSite");
    for (const p of okPages(ctx)) {
      const nodes = jsonLd(p.html).nodes;
      if (!deepNodes(nodes, /WebPage$|^AboutPage$|^ContactPage$|^FAQPage$|^CollectionPage$|^ItemPage$|^ProfilePage$|^SearchResultsPage$|^MedicalWebPage$|^QAPage$/).length) bad.push(`${p.url} has no WebPage`);
      if (new URL(p.url).pathname !== "/" && !hasType(deepNodes(nodes, /^BreadcrumbList$/), /BreadcrumbList/)) bad.push(`${p.url} has no BreadcrumbList`);
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass("WebSite, WebPage and BreadcrumbList where they belong");
  },
  business_type(ctx) {
    const all = okPages(ctx).flatMap((p) => jsonLd(p.html).nodes);
    // "The business type THAT FITS, fully filled" (the item's own title). A fully filled
    // LocalBusiness counts wherever it is found, not only on a site whose kind is "hyperlocal".
    // 3 Nov 2026: cynthiabrowndds.com is kind "brand", a dentist with two real offices and no product;
    // dental advertising rules (risk brain R-ADV-08 / R-CLI-07) bar the cost promises a priced Offer
    // would be, so the brand branch was unpassable by any honest fix. Not a loosening: a site with
    // none of these still fails, and telephone + address + areaServed is harder to fake than a price.
    const lb = deepNodes(all, /LocalBusiness|HomeAndConstructionBusiness|EntertainmentBusiness|FoodEstablishment|ProfessionalService/).find((n) => n.telephone && n.address && n.areaServed);
    if (lb) return pass(`${typesOf(lb)[0]} with telephone, address and areaServed`);
    if (ctx.site.kind === "hyperlocal") return fail("no LocalBusiness with telephone, address and areaServed on any sampled page");
    // PRICE ON REQUEST (owner, 6 Nov 2026): a business with no set pricing (detoxdenver.org) never
    // invents one. An Offer with no price counts when it says so honestly (a description naming a
    // call, contact, request or quote) and gives the url to ask at. An empty Offer still fails.
    const priced = (o) => o.price !== undefined || o.lowPrice !== undefined;
    const onRequest = (o) => /contact|call|request|quote/i.test(String(o.description ?? "")) && Boolean(String(o.url ?? "").trim());
    const nodes = deepNodes(all, /^(SoftwareApplication|WebApplication|MobileApplication|Product|Service|Course|Book)$/);
    const prod = nodes.find((n) => deepNodes([n], /^(Offer|AggregateOffer)$/).some(priced));
    if (prod) return pass(`${typesOf(prod)[0]} with an Offer and a price`);
    const asked = nodes.find((n) => deepNodes([n], /^(Offer|AggregateOffer)$/).some(onRequest));
    return asked ? pass(`${typesOf(asked)[0]} with a price-on-request Offer and where to ask`) : fail("no SoftwareApplication, Product or Service with a priced Offer, or an honest price-on-request Offer (description and url), and no LocalBusiness with telephone, address and areaServed, on any sampled page");
  },
  speakable(ctx) {
    const bad = []; let any = 0;
    for (const p of okPages(ctx)) {
      for (const sp of deepNodes(jsonLd(p.html).nodes, /^SpeakableSpecification$/)) {
        any++;
        for (const sel of [].concat(sp.cssSelector ?? [])) {
          const m = String(sel).match(/^([.#])([\w-]+)$/);
          if (!m) continue;
          const re = m[1] === "#" ? new RegExp(`id=["']${m[2]}["']`) : new RegExp(`class=["'][^"']*\\b${m[2]}\\b`);
          if (!re.test(p.html)) bad.push(`${p.url}: speakable ${sel} is not on the page`);
        }
      }
    }
    const guides = okPages(ctx).filter((p) => /\/guides?\//.test(p.url));
    if (!any && guides.length) bad.push(`no SpeakableSpecification on ${guides.length} sampled guide pages`);
    return bad.length ? fail(list(bad), { evidence: bad }) : pass(any ? `${any} speakable selectors resolve` : "no guide page in the sample needs one");
  },
  schema_supported(ctx) {
    const bad = [];
    for (const p of okPages(ctx)) {
      const nodes = jsonLd(p.html).nodes, text = visibleText(p.html).toLowerCase();
      // Porch prices are printed as "$1,200+", while Offer.price is 1200.
      // Compare whole numeric amounts, so 11,200 or 1,200.50 cannot stand in for 1200.
      const amounts = new Set([...text.matchAll(/\b\d+(?:,\d{3})*(?:\.\d+)?\b/g)].map((m) => Number(m[0].replace(/,/g, ""))));
      for (const q of deepNodes(nodes, /^Question$/)) {
        const n = String(q.name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
        if (n && !text.includes(n.slice(0, 60))) bad.push(`${p.url}: FAQ "${n.slice(0, 40)}" not visible`);
      }
      for (const o of deepNodes(nodes, /^Offer$/)) {
        const price = o.price; if (price === undefined || Number(price) === 0) continue;
        if (!amounts.has(Number(price))) bad.push(`${p.url}: schema price ${price} not on the page`);
      }
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass("every FAQ and price in schema is on the page");
  },
  about_page(ctx) {
    const a = ctx.files["/about/"]?.status === 200 ? "/about/" : ctx.files["/about"]?.status === 200 ? "/about" : null;
    if (!a) return fail("no /about/ page answers 200", { missing: [`https://${ctx.host}/about/`] });
    const linked = ctx.home?.html && links(ctx.home.html, ctx.home.url).some((l) => /\/about\/?$/.test(new URL(l.url).pathname));
    return linked ? pass("About page exists and the homepage links it") : fail("the homepage does not link the About page");
  },
  steps_and_tables(ctx) {
    const bad = [];
    for (const p of okPages(ctx)) {
      const t = titleOf(p.html).toLowerCase();
      if (/\bhow to\b/.test(t) && !/<ol\b/i.test(p.html)) bad.push(`${p.url} is a how-to without numbered steps`);
      if (/\bvs\.?\b|\bversus\b/.test(t) && !/<table\b/i.test(p.html)) bad.push(`${p.url} is a comparison without a table`);
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass("how-to pages carry steps; comparisons carry tables");
  },
  dates_visible(ctx) {
    const bad = []; let n = 0;
    for (const p of okPages(ctx)) {
      const d = deepNodes(jsonLd(p.html).nodes, /./).map((x) => x.dateModified ?? x.datePublished).find(Boolean);
      if (!d) continue; n++;
      const iso = String(d).slice(0, 10), dt = new Date(iso);
      if (Number.isNaN(dt.getTime())) continue;
      const text = visibleText(p.html);
      const forms = [iso, dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }), dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }), dt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }), dt.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })];
      if (!forms.some((f) => text.includes(f)) && !p.html.includes(`datetime="${iso}`)) bad.push(`${p.url}: schema date ${iso} is not shown on the page`);
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass(n ? `${n} pages show the date their schema states` : "no sampled page states a date");
  },
  gsc_property(ctx) {
    const g = ctx.gsc; if (!g?.ok) return notChecked(g?.why ?? "Search Console not read");
    return g.property ? pass(`Search Console property ${g.property}`) : fail(`no Search Console property for ${ctx.site.domain} is shared with the service account`);
  },
  gsc_sitemap(ctx) {
    const g = ctx.gsc; if (!g?.ok) return notChecked(g?.why ?? "Search Console not read");
    if (!g.property) return fail("no Search Console property, so no sitemap is submitted");
    const sm = g.sitemaps ?? [];
    if (!sm.length) return fail("no sitemap submitted in Search Console", { missing: [`https://${ctx.host}/sitemap.xml`] });
    const bad = sm.filter((s) => Number(s.errors ?? 0) > 0 || (s.lastDownloaded && ctx.now - Date.parse(s.lastDownloaded) > 14 * 86_400_000)).map((s) => `${s.path} (${s.errors ?? 0} errors, last read ${String(s.lastDownloaded ?? "never").slice(0, 10)})`);
    return bad.length ? fail(list(bad)) : pass(`${sm.length} sitemap(s) submitted, no errors`);
  },
  indexnow_key(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    // A repo may hold one key per host it serves (a key is valid only on the host that serves it),
    // so this host passes when ANY of the repo's key files answers here with its key inside.
    // Reading only the first key failed every other host on a shared repo (aplayermode.com, 25 Oct 2026).
    const keys = r.indexnowKeys?.length ? r.indexnowKeys : (r.indexnowKey ? [r.indexnowKey] : []);
    if (!keys.length) return fail("no IndexNow key file in the repo");
    const served = keys.find((k) => { const f = ctx.files[`/${k}.txt`]; return f?.status === 200 && String(f.text ?? "").includes(k); });
    if (served) return pass(`IndexNow key served at /${served}.txt`);
    const tried = keys.map((k) => `/${k}.txt answered ${ctx.files[`/${k}.txt`]?.status ?? "nothing"}`);
    return fail(`no IndexNow key file answers on this host (${tried.join("; ")})`, { missing: keys.map((k) => `https://${ctx.host}/${k}.txt`) });
  },
  gsc_truth_fresh: (ctx) => repoFresh(ctx, GSC_TRUTH_NAMES),
  index_coverage_fresh: (ctx) => repoFresh(ctx, ["index_coverage.json"]),
  clarity(ctx) {
    // A site marked clarity: false in sites.json does not use Clarity, by the owner's ruling (25 Oct
    // 2026: Clarity only where visitors fill a form or buy; how-we-know's audience is on YouTube).
    if (ctx.site?.clarity === false) return pass(`Clarity not used on this site: ${ctx.site.clarity_why || "owner ruling"}`);
    const h = ctx.home?.html ?? "";
    if (loadsClarity(h) || ctx.files?.__clarity_loader) return pass("Clarity loads on the homepage");
    // Clarity belongs on the pages where visitors fill a form or buy (e9), so one of those loading it
    // is Clarity installed, whether or not the homepage is such a page.
    const scoped = (ctx.pages ?? []).find((p) => p.status === 200 && p.html && loadsClarity(p.html) && formOrBuy(p.html, p.url));
    if (scoped) return pass(`Clarity loads on ${scoped.url}, a page where visitors fill a form or buy`);
    // A site with no form and no buy link anywhere in the sample has nowhere e9 allows Clarity to
    // sit: the homepage is sampled too, so installing it there fails e9 and leaving it off fails
    // this check. Demanding it anyway made e6/i8 and e9 jointly unsatisfiable (horselegalguide.com,
    // 28 Oct 2026, after PR #58 scoped that repo's installer to form/buy pages). The owner's ruling
    // is the scope one - "Clarity only where visitors fill a form or buy" (25 Oct 2026) - so a site
    // with no such page is correctly without Clarity. An empty or absent sample is not evidence of
    // that, and still fails.
    const sampled = (ctx.pages ?? []).filter((p) => p.status === 200 && p.html);
    if (sampled.length && !sampled.some((p) => formOrBuy(p.html, p.url)))
      return pass("no sampled page has a form or a buy link, so e9 leaves Clarity no page it may sit on");
    return fail("neither the homepage nor any sampled form or buy page loads Clarity");
  },
  /*
   * e9 — CLARITY ONLY WHERE A VISITOR FILLS A FORM OR BUYS (owner, 25 Oct 2026). Session recording
   * is for watching people get stuck on the step that earns money; anywhere else it is weight on the
   * page and data nobody reads. Any sampled page that loads Clarity must carry a form or a buy link.
   */
  clarity_scoped(ctx) {
    if (ctx.site?.clarity === false) return pass(`Clarity not used on this site: ${ctx.site.clarity_why || "owner ruling"}`);
    const loading = okPages(ctx).filter((p) => loadsClarity(p.html));
    if (!loading.length) return pass("no sampled page loads Clarity outside a form or buy page");
    const bad = loading.filter((p) => !formOrBuy(p.html, p.url)).map((p) => p.url);
    return bad.length
      ? fail(`Clarity loads on ${bad.length} page${bad.length === 1 ? "" : "s"} with no form and no buy link: ${list(bad)}`, { evidence: bad })
      : pass(`Clarity loads only on form or buy pages (${loading.length} sampled)`);
  },
  /*
   * b10 — EVERY TITLE NAMES ITS OWN SITE, NEVER A SIBLING'S. A shared template once stamped one
   * site's brand onto another's pages, so search results credited the wrong site. The brand is the
   * host's own name (or the homepage's og:site_name / Organization or WebSite name or alternateName,
   * the short name a site declares for itself, e.g. BHPC); a sibling is any other
   * grid site whose name is not part of this one's.
   */
  title_names_own_site(ctx) {
    const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const stem = (h) => norm(String(h).replace(/^www\./, "").split(".")[0]);
    const own = stem(ctx.host);
    const home = ctx.home?.html ?? "";
    const brands = [own, ...metaContent(home, "og:site_name").map(norm), ...deepNodes(jsonLd(home).nodes, /^(Organization|WebSite)$/).flatMap((n) => [n?.name, ...[n?.alternateName].flat()]).map(norm)].filter((b) => b.length >= 4);
    const siblings = (ctx.portfolio ?? []).map(stem).filter((s) => s.length >= 6 && s !== own && !brands.some((b) => b.includes(s)));
    const bad = [], seen = new Set();
    // Same keying as title_band: the URL the HTML came from, so a 308 root and its target are one
    // page and are judged, and reported, once.
    for (const p of okPages(ctx)) {
      const served = pageUrl(p);
      if (seen.has(urlKey(served))) continue; seen.add(urlKey(served));
      const t = norm(titleOf(p.html));
      const sib = siblings.find((s) => t.includes(s));
      if (sib) bad.push(`${served} title names ${sib}`);
      else if (!brands.some((b) => t.includes(b))) bad.push(`${served} title does not name the site`);
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass("every sampled title names this site and no sibling");
  },
  gbp_maps_link(ctx) {
    const h = ctx.home?.html ?? "";
    const all = [h, ...okPages(ctx).map((p) => p.html)].join(" ");
    return /maps\.google\.com\/\?cid=|google\.com\/maps|maps\.app\.goo\.gl|g\.page\//i.test(all) ? pass("links Google Maps") : fail("no Google Maps link (Business Profile) on the homepage or sampled pages");
  },
  consolidation_ledger(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const f = r.files.find((x) => /consolidat/i.test(x));
    return f ? pass(`ledger at ${f}`) : fail("no consolidation ledger in the repo");
  },
  brand_capture(ctx) {
    const h = ctx.home?.html ?? "";
    const ws = deepNodes(jsonLd(h).nodes, /^WebSite$/)[0];
    const og = metaContent(h, "og:site_name")[0];
    const name = ws?.name ?? og;
    const why = [];
    if (!ws?.name) why.push("no WebSite name in schema");
    if (!og) why.push("no og:site_name");
    if (name && !titleOf(h).toLowerCase().includes(String(name).toLowerCase())) why.push(`homepage title does not contain "${name}"`);
    return why.length ? fail(why.join("; ")) : pass(`"${name}" in schema, og:site_name and title`);
  },
  links_followed(ctx) {
    const bad = [];
    for (const p of okPages(ctx)) for (const l of links(p.html, p.url)) if (ctx.portfolio.includes(l.host) && l.host !== ctx.host.replace(/^www\./, "") && /nofollow|sponsored|ugc/.test(l.rel)) bad.push(`${p.url} → ${l.url} (rel=${l.rel})`);
    return bad.length ? fail(`${bad.length} portfolio links are not followed: ${list(bad, 3)}`, { evidence: bad.slice(0, 50) }) : pass("portfolio links are followed");
  },
  deep_links_live(ctx) {
    const out = okPages(ctx).flatMap((p) => links(p.html, p.url)).filter((l) => ctx.portfolio.includes(l.host) && l.host !== ctx.host.replace(/^www\./, ""));
    if (!out.length) return fail("no links to portfolio sites on sampled pages");
    const deep = out.filter((l) => new URL(l.url).pathname.replace(/\/$/, "") !== "");
    const dead = (ctx.files.__targets ?? []).filter((t) => t.status !== 200).map((t) => `${t.url} (${t.status ?? t.error})`);
    const why = [];
    if (!deep.length) why.push("every portfolio link points at a homepage");
    if (dead.length) why.push(`targets that do not answer 200: ${list(dead, 3)}`);
    return why.length ? fail(why.join("; "), { evidence: dead }) : pass(`${deep.length} deep portfolio links; sampled targets answer`);
  },
  link_concentration(ctx) {
    const bad = [], perUrl = {};
    for (const p of okPages(ctx)) {
      const ext = links(p.html, p.url).filter((l) => l.host !== ctx.host.replace(/^www\./, ""));
      if (ext.length < 4) continue;
      const by = {}; for (const l of ext) { by[l.host] = (by[l.host] ?? 0) + 1; perUrl[l.url] = (perUrl[l.url] ?? 0) + 1; }
      for (const [h, n] of Object.entries(by)) if (ctx.portfolio.includes(h) && n / ext.length > 0.25) bad.push(`${p.url}: ${h} has ${n} of ${ext.length} outbound links`);
    }
    for (const [u, n] of Object.entries(perUrl)) if (n > 10) bad.push(`${u} linked ${n} times across the sample`);
    return bad.length ? fail(list(bad), { evidence: bad }) : pass("no target over a quarter of a page's outbound links");
  },
  ownership_disclosure(ctx) {
    const linking = okPages(ctx).filter((p) => links(p.html, p.url).some((l) => ctx.portfolio.includes(l.host) && l.host !== ctx.host.replace(/^www\./, "")));
    if (!linking.length) return notChecked("no sampled page links the portfolio");
    const bad = linking.filter((p) => !/commonly owned|common ownership|same owner|under common|affiliated|we own|our own (sites|publications)/i.test(visibleText(p.html))).map((p) => p.url);
    return bad.length ? fail(`no common-ownership line on ${list(bad)}`, { evidence: bad }) : pass("every linking page carries the disclosure");
  },
  post_deploy_check(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const hit = r.workflows.find((w) => /post[-_ ]?deploy|live[-_ ]?check|smoke|verify[-_ ]?live|live[-_ ]?verify/i.test(w.name + "\n" + w.text));
    return hit ? pass(`live check in ${hit.name}`) : fail("no workflow runs a post-deploy live check");
  },
  merge_gate_fast(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const d = r.prRunMinutes;
    if (!d?.length) return notChecked("no completed pull-request runs to time");
    const med = [...d].sort((a, b) => a - b)[Math.floor(d.length / 2)];
    return med <= 5 ? pass(`median PR check ${med.toFixed(1)} min`) : fail(`median PR check ${med.toFixed(1)} min (target 5)`);
  },
  companion_routes(ctx) {
    const pieces = okPages(ctx).filter((p) => new URL(p.url).pathname !== "/" && !isUtility(p.url));
    if (!pieces.length) return notChecked("no companion piece in the sample");
    const bad = pieces.filter((p) => !links(p.html, p.url).some((l) => ctx.portfolio.includes(l.host) && /request-assistance/.test(l.url) && /[?&](utm_|ref=|src=|source=)/.test(l.url))).map((p) => p.url);
    return bad.length ? fail(`no tracked link to a canonical intake on ${list(bad)}`, { evidence: bad }) : pass(`${pieces.length} pieces route to a canonical intake`);
  },
  guide_shape(ctx, params) {
    const guides = okPages(ctx).filter((p) => /\/guides\/[^/]+/.test(new URL(p.url).pathname));
    if (!guides.length) return notChecked("no /guides/ page in the sample");
    const bad = [], short = [], min = params?.min_words ?? 1800;
    for (const p of guides) {
      const w = wordCount(visibleText(p.html)), why = [];
      if (w < hardFloor(min)) why.push(`${w} words`);
      if (!/<h2[^>]*>[^<]*quick answer/i.test(p.html)) why.push("no Quick answer H2");
      if (deepNodes(jsonLd(p.html).nodes, /^FAQPage$/).length > 1) why.push("more than one FAQPage");
      if (!links(p.html, p.url).some((l) => /request-assistance/.test(l.url) && /vertical=/.test(l.url) && /(kind|page_kind)=/.test(l.url) && /slug=/.test(l.url))) why.push("no CTA with vertical, kind and slug");
      if (why.length) bad.push(`${p.url}: ${why.join(", ")}`);
      else if (w < min) short.push(`${p.url} (${w} words)`);
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass(`${guides.length} guides in the house shape${shortNote(short, min)}`);
  },
  directory_listings(ctx) {
    const towns = okPages(ctx).filter((p) => p.coverageKind === "town");
    if (!towns.length) return fail("no town page answered, so no directory could be read");
    const bad = [];
    for (const p of towns) {
      const items = deepNodes(deepNodes(jsonLd(p.html).nodes, /^ItemList$/), /LocalBusiness|AssistedLiving|NursingHome|MedicalBusiness|ResidentialCare|LodgingBusiness/);
      if (!items.length) { bad.push(`${p.url} has no ItemList of LocalBusiness listings`); continue; }
      const thin = items.filter((n) => !(n.telephone && n.address && n.geo && n.hasMap)).length;
      if (thin) bad.push(`${p.url}: ${thin} of ${items.length} listings lack telephone, address, geo or hasMap`);
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass(`${towns.length} town pages carry full listings`);
  },
  listing_maps(ctx) {
    const maps = okPages(ctx).flatMap((p) => deepNodes(jsonLd(p.html).nodes, /./).map((n) => n.hasMap).filter(Boolean)).flat();
    if (!maps.length) return fail("no listing carries hasMap");
    const bad = maps.filter((m) => !/^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl)/.test(String(m?.url ?? m)));
    return bad.length ? fail(`${bad.length} of ${maps.length} hasMap values are not Google Maps URLs`) : pass(`${maps.length} hasMap values are Google Maps URLs`);
  },
  hyperlocal_coverage(ctx) {
    const c = ctx.coverage; if (!c) return notChecked("coverage not expanded");
    if (c.error) return notChecked(c.error);
    if (!c.targets.length) return pass("no place-based targets for this site (coverage model not_local)");
    const missing = c.targets.filter((t) => !t.inSitemap || t.status !== 200);
    const byKind = {}; for (const t of missing) byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
    const totalByKind = {}; for (const t of c.targets) totalByKind[t.kind] = (totalByKind[t.kind] ?? 0) + 1;

    // A url_pattern that does not match the site's real routing misses EVERY
    // page of its kind, and the plain count reads it as a coverage gap. That
    // happened to memphisseniorcarehomes.com on 25 and 26 Oct 2026: the
    // service_town pattern was /{town}/{service}/ on a site that has only ever
    // served flat /{service}-{town}/ URLs, so the brief said "54 of 106
    // coverage pages missing" when 20 of those 54 were live and in the sitemap
    // the whole time, and the real gap was 34. Two passes were sent to build
    // pages that already existed.
    //
    // The tell is the shape of the miss, not its size: one kind wholly absent
    // while another kind is almost entirely present means the site is healthy
    // and the pattern is wrong, because a site that really had built none of
    // one kind would not have built its towns either. Say that instead of a
    // count, and name the pattern to read off the live site.
    const suspectKinds = Object.keys(totalByKind).filter((k) => {
      if (totalByKind[k] < 4 || (byKind[k] ?? 0) !== totalByKind[k]) return false;
      const others = Object.keys(totalByKind).filter((o) => o !== k);
      const otherTotal = others.reduce((n, o) => n + totalByKind[o], 0);
      const otherMissing = others.reduce((n, o) => n + (byKind[o] ?? 0), 0);
      return otherTotal >= 4 && otherMissing / otherTotal <= 0.1;
    });
    if (suspectKinds.length) {
      const k = suspectKinds[0];
      return fail(
        `url_patterns.${k} does not match this site: all ${totalByKind[k]} ${k.replace("_", " × ")} URLs are absent while the rest of the coverage is live`,
        {
          missing: missing.map((t) => t.url),
          evidence: [
            `every ${k} URL expanded from url_patterns.${k} is missing, and ${Object.keys(totalByKind).filter((o) => o !== k).map((o) => `${totalByKind[o] - (byKind[o] ?? 0)} of ${totalByKind[o]} ${o}`).join(", ")} are live and in the sitemap.`,
            `A site that had built none of one kind would not have built the others, so read the real URL shape off the live site and correct url_patterns.${k} in sites.json before treating this as a coverage gap.`,
            ...missing.filter((t) => t.kind === k).slice(0, 5).map((t) => `${t.url}: ${t.status === 200 ? "not in sitemap" : `answered ${t.status ?? t.error}`}`),
          ],
        },
      );
    }
    return missing.length
      ? fail(`${missing.length} of ${c.targets.length} coverage pages missing (${Object.entries(byKind).map(([k, n]) => `${n} ${k.replace("_", " × ")}`).join(", ")})`, { missing: missing.map((t) => t.url), evidence: missing.slice(0, 20).map((t) => `${t.url}: ${t.status === 200 ? "not in sitemap" : `answered ${t.status ?? t.error}`}`) })
      : pass(`all ${c.targets.length} coverage pages live and in the sitemap`);
  },
  repo_public(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    return r.visibility === "PUBLIC" ? pass("repo is public") : r.visibility ? fail(`repo is ${r.visibility}`) : notChecked("visibility not read");
  },
  no_deploy_step(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const hits = r.workflows.filter((w) => /wrangler(-action)?[^\n]*\b(deploy|pages deploy)\b|cloudflare\/(wrangler|pages)-action/i.test(w.text)).map((w) => w.name);
    return hits.length ? fail(`deploy step in ${hits.join(", ")}`) : pass("no deploy step in any workflow");
  },
  llm_routing_free(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const raw = r.llmRouting; if (!raw) return fail("no config/llm_routing.json");
    let cfg; try { cfg = JSON.parse(raw); } catch { return fail("config/llm_routing.json does not parse"); }
    const ids = [], costs = [];
    const walk = (x, k) => { if (Array.isArray(x)) return x.forEach((v) => walk(v, k)); if (x && typeof x === "object") return Object.entries(x).forEach(([kk, v]) => walk(v, kk)); if (typeof x === "string" && /^(model|models|id|primary|fallback|fallbacks|order)$/i.test(k ?? "") && x.includes("/")) ids.push(x); if (/max_cost_usd/i.test(k ?? "")) costs.push(x); };
    walk(cfg);
    const why = [];
    if (!costs.length || costs.some((c) => Number(c) !== 0)) why.push(`max_cost_usd is ${costs.length ? costs.join(", ") : "missing"}`);
    const paid = ids.filter((i) => !/:free$/.test(i));
    if (paid.length) why.push(`non-free models: ${list(paid, 3)}`);
    return why.length ? fail(why.join("; ")) : pass(`${ids.length} model ids, all :free; max_cost_usd 0`);
  },
  gsc_daily_workflow(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const hit = r.workflows.find((w) => /schedule:/i.test(w.text) && (/gsc_truth|gsc_search_analytics|search_intelligence/i.test(w.text) || r.scriptsMentioningGscTruth.some((f) => w.text.includes(f.split("/").pop()))));
    return hit ? pass(`scheduled in ${hit.name}`) : fail("no scheduled workflow writes the daily Search Console file");
  },
  clarity_indexnow(ctx) {
    const c = CHECKS.clarity(ctx), k = CHECKS.indexnow_key(ctx);
    // Say which way Clarity passed: on a site with no money step e6 passes without a tag, and
    // "Clarity is live" would be a false sentence on the owner's grid page.
    if (c.status === "pass" && k.status === "pass") return pass(`${c.detail}; the IndexNow key answers (Bing is account-side, not read)`);
    if (k.status === "no_repo") return c.status === "pass" ? { status: "no_repo", detail: k.detail } : fail(c.detail);
    return fail([c, k].filter((x) => x.status !== "pass").map((x) => x.detail).join("; "), { missing: k.missing });
  },
  /*
   * h6 — A CACHED BUILD IS KEYED ON EVERY TRACKED FILE EXCEPT THE WORKFLOWS (sprylabs-hpc-site #147,
   * 25 Oct 2026). The key left out committed artifacts/, a commit that changed only one of them hit
   * the cache, and the restored tree put the previous commit's bytes back over the checkout. Too broad
   * costs a rebuild; too narrow ships a stale tree. Workflows are the one exclusion: no producer reads
   * them and a restored tree must never overwrite them.
   */
  build_cache_key(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const caches = buildCaches(r.workflows ?? []);
    if (!caches.length) return pass("no workflow restores a cached build");
    const hashers = (r.files ?? []).filter((f) => /(^|\/)(\.github\/scripts|scripts|tools)\/[^/]*(hash|cache|key)[^/]*\.(sh|m?js|py|ts)$/i.test(f)).slice(0, 12);
    const texts = [...(r.workflows ?? []).map((w) => w.text), ...hashers.map((f) => r.show?.(f) ?? "")];
    const wholeTree = texts.some((t) => wholeTreeKey(t));
    const bad = caches.filter((c) => !wholeTreeKey(c.key) && !wholeTree).map((c) => `${c.workflow} caches ${c.path} under a key that does not hash every tracked file (${c.key.slice(0, 80)})`);
    return bad.length ? fail(list(bad, 3), { evidence: bad }) : pass(`${caches.length} build cache${caches.length === 1 ? "" : "s"} keyed on every tracked file except the workflows`);
  },
  /*
   * j10 — JUNK LEAD DOMAINS ARE BLOCKED THROUGH A SITE SETTING, NEVER IN PUBLIC CODE (owner, 26 Oct
   * 2026). The repos are public and the list names real organisations, so it lives only in the
   * deployment's BLOCKED_LEAD_DOMAINS variable (comma-separated). A lead endpoint must read that
   * variable, and no source file may carry a hardcoded list of blocked email domains.
   */
  blocked_lead_domains(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const src = (r.files ?? []).filter((f) => /\.(m?js|ts|py)$/.test(f) && !/(^|\/)(node_modules|dist|build|tests?|__tests__)\//.test(f) && !/\.test\./.test(f));
    const leadFiles = src.filter((f) => /^(functions|src|lib|workers?|api|server)\//.test(f) && /(lead|request-assistance|intake|inquir|quote|contact)/i.test(f)).slice(0, 15);
    if (!leadFiles.length) return pass("no lead endpoint in this repo");
    const listy = src.filter((f) => /(lead|block|junk|spam|deny|ban)/i.test(f)).slice(0, 25);
    const hard = [...new Set([...leadFiles, ...listy])].filter((f) => HARDCODED_DOMAIN_LIST.test(r.show?.(f) ?? ""));
    if (hard.length) return fail(`a blocked-domain list is written into public code: ${list(hard, 3)}`, { evidence: hard });
    const reads = src.filter((f) => /BLOCKED_LEAD_DOMAINS/.test(r.show?.(f) ?? "")).slice(0, 3);
    return reads.length ? pass(`the lead endpoint reads BLOCKED_LEAD_DOMAINS (${reads.join(", ")})`) : fail(`no lead endpoint reads BLOCKED_LEAD_DOMAINS (${list(leadFiles, 3)})`);
  },
  weekly_report_workflow(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const weekly = (w) => [...w.text.matchAll(/cron:\s*['"]([^'"]+)['"]/g)].some((m) => { const f = m[1].trim().split(/\s+/); return f.length === 5 && f[4] !== "*" && f[2] === "*"; });
    const hit = r.workflows.find((w) => weekly(w) && /report|outcome|weekly/i.test(w.name + w.text));
    return hit ? pass(`weekly report in ${hit.name}`) : fail("no weekly report workflow");
  },
  zero_paid_doc(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const why = [];
    if (!r.files.includes("docs/cost/zero-paid-llm.md")) why.push("no docs/cost/zero-paid-llm.md");
    if (!/nothing paid/i.test(r.claudeMd ?? "")) why.push('CLAUDE.md does not say "nothing paid"');
    return why.length ? fail(why.join("; ")) : pass("zero-paid doc and CLAUDE.md line present");
  },

  // i11 (3 Nov 2026): an outside scanner found Time-2-Read's ElevenLabs TTS callable with no login and
  // no limit, and the sweep that followed found a site whose admin "password" was a hash committed in
  // the repo. Three shapes are cheap to see in code: a password hash the server accepts (the hash IS the
  // credential), a hardcoded fallback password, and a paid API called from server code that has no
  // rate limit anywhere. The full list (auth, ceilings, RLS, webhooks) is the risk brain's rule.
  paid_routes_gated(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const code = (r.files ?? []).filter((f) => /\.(m?[jt]sx?|py)$/.test(f) && !/(^|\/)(node_modules|dist|build|tests?|__tests__)\//.test(f) && !/\.(test|spec)\./.test(f));
    const server = code.filter((f) => SERVER_PATH.test(f)).slice(0, 300);
    const shipped = code.filter((f) => /^(assets|public|static)\//.test(f)).slice(0, 100);
    if (!server.length && !shipped.length) return pass("no server code in this repo");
    const text = (f) => r.show?.(f) ?? "";
    const hashHits = [...server, ...shipped].filter((f) => ACCEPTED_HASH.test(text(f)));
    if (hashHits.length) return fail(`a password hash is committed in code (whoever reads the repo holds the credential): ${list(hashHits, 3)}`, { evidence: hashHits });
    const fallbackHits = server.filter((f) => FALLBACK_SECRET.test(text(f)));
    if (fallbackHits.length) return fail(`a hardcoded fallback password or secret: ${list(fallbackHits, 3)}`, { evidence: fallbackHits });
    const paid = server.filter((f) => PAID_CALL.test(text(f)));
    if (!paid.length) return pass(`${server.length} server files, none calls a paid service directly`);
    const limited = server.filter((f) => RATE_LIMIT.test(text(f)));
    if (!limited.length) return fail(`paid service called with no rate limit anywhere in server code: ${list(paid, 3)}`, { evidence: paid });
    return pass(`paid calls in ${list(paid, 2)}; rate limit in ${list(limited, 2)}`);
  },

  // ─── K · Authority and entity (31 Oct 2026, the authority audit) ───────────
  entity_json(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const e = entityFor(r, ctx.site);
    if (!e) return fail(ctx.site.entity_file ? `${ctx.site.entity_file} is missing or not JSON` : `no entity.json in the repo holds ${ctx.site.domain}`);
    const why = [];
    if (!e.node.name) why.push("no name");
    if (!Array.isArray(e.node.sameAs)) why.push("no sameAs list");
    return why.length ? fail(`${e.path} (${ctx.site.domain}): ${why.join(", ")}`) : pass(`${e.path} holds ${ctx.site.domain}: ${e.node.sameAs.length} sameAs, ${(e.node.profiles_pending ?? []).length} pending`);
  },
  same_as_not_self(ctx) {
    const e = entityFor(ctx.repo, ctx.site);
    const own = ownHosts(ctx, e);
    const pages = okPages(ctx);
    const bad = [];
    let n = 0;
    for (const u of e?.node?.sameAs ?? []) { n++; if (own.has(hostOf(u))) bad.push(`${e.path}: ${u}`); }
    for (const p of pages) for (const u of liveSameAs(p.html)) { n++; if (own.has(hostOf(u))) bad.push(`${p.final ?? p.url}: ${u}`); }
    const uniq = [...new Set(bad)];
    if (uniq.length) return fail(`sameAs points at the site itself: ${list(uniq)}`, { evidence: uniq });
    if (!n) return notChecked("no sameAs anywhere to read (k3 fails for that)");
    return pass(`${n} sameAs URLs read${e ? ` in ${e.path} and` : ""} on ${pages.length} pages; none is this site's own host`);
  },
  same_as_resolves(ctx) {
    const probes = ctx.files?.__same_as;
    if (!probes) return notChecked("the sameAs profiles were not fetched");
    if (!probes.length) return fail("the live JSON-LD lists no external profile in sameAs (only the site itself, a grid sibling, or nothing)");
    const ok = probes.filter((p) => p.status >= 200 && p.status < 300);
    const walled = probes.filter((p) => !ok.includes(p) && JS_WALLED.test(hostOf(p.url)) && p.status && ![404, 410].includes(p.status));
    const dead = probes.filter((p) => !ok.includes(p) && !walled.includes(p));
    const say = (arr) => list(arr.map((p) => `${p.url} (${p.status ?? p.error})`));
    if (ok.length) return pass(`${ok.length} of ${probes.length} external profiles resolve: ${list(ok.map((p) => p.url), 3)}${dead.length ? `; dead: ${say(dead)}` : ""}`);
    // A login-walled platform (Instagram, LinkedIn, Gumroad, Maps) refusing a robot is UNVERIFIABLE: said, never passed.
    if (!dead.length) return notChecked(`unverifiable: ${say(walled)} refuse an automated read; the repo's own weekly watch records them`);
    return fail(`no external profile resolves: ${say(dead)}`, { evidence: dead.map((p) => p.url) });
  },
  parent_organization(ctx) {
    const want = ctx.site.entity_parent;
    if (!ENTITY_PARENTS.includes(want)) return fail(`sites.json gives ${ctx.site.domain} no entity_parent (one of ${ENTITY_PARENTS.join(", ")})`);
    const r = ctx.repo;
    const e = entityFor(r, ctx.site);
    const pages = okPages(ctx);
    if (want !== "spry-labs") {
      // A friend's business (client) or her own business outside Spry Labs never carries the Spry Labs parent.
      const bad = [];
      if (e && JSON.stringify(e.node).includes(SPRY_LABS_HOME)) bad.push(e.path);
      for (const p of pages) if (JSON.stringify(jsonLd(p.html).nodes).includes(SPRY_LABS_HOME)) bad.push(p.final ?? p.url);
      if (bad.length) return fail(`a ${want} site must never name Spry Labs as its parent: ${list(bad)}`, { evidence: bad });
      return pages.length || e ? pass(`${want}: no Spry Labs parent in ${e ? `${e.path} or ` : ""}${pages.length} pages`) : notChecked("no entity file and no page to read");
    }
    const own = ownHosts(ctx, e);
    // The parent is Spry Labs, a grid parent on another host (The Industry Guides), or a brand node on this
    // host that itself points there (dream-wedding-builder: each site → Dream Wedding Builder → Spry Labs).
    const grid = (ctx.portfolio ?? []).map(bare);
    const okParent = (v, byId = new Map(), depth = 0) => {
      const id = idOf(v); if (!id || depth > 3) return false;
      const h = hostOf(id);
      if (id.includes(SPRY_LABS_HOME) || (!own.has(h) && grid.includes(h))) return true;
      const up = byId.get(id);
      return Boolean(up) && okParent(up.parentOrganization, byId, depth + 1);
    };
    const idsIn = (x) => new Map(deepNodesAny(x).filter((n) => typeof n["@id"] === "string").map((n) => [n["@id"], n]));
    const isSpry = (n) => String(idOf(n) ?? "").includes(SPRY_LABS_HOME);
    const why = [];
    if (!r?.ok) why.push(r?.noRepo ? "no repo to hold entity.json" : "the repo was not read");
    else if (!e) why.push("no entity.json for this site");
    else if (!isSpry(e.node) && !okParent(e.node.parentOrganization, idsIn(e.root))) why.push(`${e.path} has no parentOrganization pointing at Spry Labs or a grid parent (${idOf(e.node.parentOrganization) ?? "none"})`);
    if (!pages.length) return why.length ? fail(why.join("; ")) : notChecked("no page to read");
    // A page passes when a node on it names the parent; on the Spry Labs sites themselves the
    // Organization node that IS Spry Labs counts too (it is the parent, not a child of it).
    const live = pages.filter((p) => { const nodes = jsonLd(p.html).nodes; const byId = idsIn(nodes); return deepNodes(nodes, /./).some((n) => okParent(n.parentOrganization, byId) || (isSpry(n) && typesOf(n).some((t) => /Organization/.test(t)))); });
    if (!live.length) why.push(`none of ${pages.length} sampled pages' JSON-LD carries parentOrganization pointing at Spry Labs or a grid parent`);
    return why.length ? fail(why.join("; "), { evidence: pages.filter((p) => !live.includes(p)).map((p) => p.final ?? p.url).slice(0, 10) }) : pass(`parent set in ${e.path} and on ${live.length} of ${pages.length} pages`);
  },
  entity_watch_green(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const w = r.workflows.find((x) => ENTITY_WATCH_RE.test(x.name));
    if (!w) return fail("no entity-backlink-watch workflow in .github/workflows");
    const why = [];
    if (!/schedule:/.test(w.text) || !/cron:/.test(w.text)) why.push("no schedule");
    if (!/workflow_dispatch/.test(w.text)) why.push("no workflow_dispatch");
    if (why.length) return fail(`${w.name}: ${why.join(", ")}`);
    const run = r.entityWatchRuns?.[w.name];
    if (run === undefined) return notChecked(`the runs of ${w.name} were not read`);
    if (run === null) return fail(`${w.name} has never run`);
    const days = (ctx.now - Date.parse(run.createdAt)) / 86_400_000;
    if (run.conclusion !== "success") return fail(`${w.name}'s newest run (${run.createdAt.slice(0, 10)}) is ${run.conclusion || run.status}`);
    if (!(days <= 8)) return fail(`${w.name} last ran ${Math.round(days)} days ago (weekly means under 8)`);
    return pass(`${w.name} green ${days.toFixed(1)} days ago`);
  },
  // ─── F · The search growth loop (owner, 1 Nov 2026) ────────────────────────
  // Every selling site runs the shared engine (seq23/search-loop): find low-competition searches
  // weekly → publish straight away under a quality gate and a cap that grows with results → every page ends in
  // the site's one action → 2/4/8-week checks strengthen, undo or merge → AI visits and bot reads
  // measured. The repo side (config + caller workflow) is read from the clone; the running side from
  // the newest `search-loop-week` report (src/shared/boss/searchLoop/week.mjs). A site with no report
  // fails every running stage by name, so a site missing a stage is never a quiet pass.
  search_loop_adopted(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const na = notAdopted(ctx); if (na) return na;
    const why = [];
    const cfg = loopConfigFor(r, ctx.site.domain);
    if (cfg.error) why.push(`${cfg.path} ${cfg.error}`);
    const caller = loopCaller(r);
    if (!caller) { const u = unreadWorkflows(r); if (u) return notChecked(u); why.push(`no workflow calls the shared engine (uses: ${LOOP_ENGINE_USES})`); }
    // A site whose menu pages need her approval (sites.json) must say so to the engine.
    if (ctx.site.search_loop?.menu_pages_need_approval === true && cfg.node?.menu_pages_need_approval !== true) why.push(`${cfg.path} does not set menu_pages_need_approval: true, so the engine may edit its menu pages`);
    if (ctx.site.search_loop?.strict_health_gate === true && !["health", "dental"].includes(cfg.node?.health_gate)) why.push(`${cfg.path} does not set health_gate to health or dental, so health claims are not gated`);
    return why.length ? fail(why.join("; ")) : pass(`${cfg.path} names the site; ${caller.name} calls the shared engine`);
  },
  publish_straight_away(ctx) {
    const na = notAdopted(ctx); if (na) return na;
    const w = loopWeek(ctx); if (w.result) return w.result;
    const cfg = loopConfigFor(ctx.repo, ctx.site.domain);
    if (cfg?.node?.mode === "off") return fail(`${cfg.path} sets mode "off", so the site publishes nothing`);
    const p = publishingOn(w.week);
    return p.ok ? pass(p.why) : fail(p.why);
  },
  loop_discovery_weekly(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const na = notAdopted(ctx); if (na) return na;
    const caller = loopCaller(r);
    if (!caller) { const u = unreadWorkflows(r); if (u) return notChecked(u); return fail(`no workflow calls the shared engine, so nothing finds new searches (uses: ${LOOP_ENGINE_USES})`); }
    if (!/schedule:/.test(caller.text) || !/cron:/.test(caller.text)) return fail(`${caller.name} has no schedule, so discovery is not weekly`);
    const cfg = loopConfigFor(r, ctx.site.domain);
    const paid = [caller.text, cfg?.raw ?? ""].join("\n").match(PAID_SEO_RE);
    if (paid) return fail(`discovery names a paid search-data service (${paid[0]}); the loop is $0: measured Search Console rows or free signals`);
    const w = loopWeek(ctx); if (w.result) return w.result;
    return pass(`${caller.name} runs on a schedule; the newest weekly report is from ${String(w.week.generated_at).slice(0, 10)}`);
  },
  loop_pace(ctx) {
    const na = notAdopted(ctx); if (na) return na;
    const w = loopWeek(ctx); if (w.result) return w.result;
    // v1.3.0: the run guard (cap.max_per_day) never grows past 10 a day; the cap itself grows only with results.
    const perDay = Number(loopConfigFor(ctx.repo, ctx.site.domain)?.node?.cap?.max_per_day);
    if (Number.isFinite(perDay) && perDay > CAP.max_per_day) return fail(`the config lets the engine publish ${perDay} pages a day (the run guard is at most ${CAP.max_per_day})`);
    const p = capOk(w.week);
    return p.ok ? pass(p.why) : fail(p.why);
  },
  one_action_every_page(ctx) {
    const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
    const na = notAdopted(ctx); if (na) return na;
    const cfg = loopConfigFor(r, ctx.site.domain);
    const action = oneActionOf(cfg);
    if (!action) return fail(`${cfg.path} has no action.url, so no page can be held to the site's one action`);
    const pages = okPages(ctx).filter((p) => { const u = new URL(pageUrl(p)); return u.pathname !== "/" && !isUtility(u.href); });
    if (!pages.length) return notChecked("no content page in the sample");
    const hits = (p) => {
      const base = pageUrl(p);
      const targets = [...links(p.html, base).map((l) => l.url), ...tags(p.html, "form").map((f) => { try { return new URL(f.action ?? "", base).href; } catch { return ""; } })];
      return targets.some((t) => actionMatches(t, action, base));
    };
    const bad = pages.filter((p) => !hits(p)).map(pageUrl);
    return bad.length ? fail(`${bad.length} of ${pages.length} sampled pages do not lead to the site's one action (${action}): ${list(bad, 3)}`, { evidence: bad }) : pass(`all ${pages.length} sampled content pages lead to ${action}`);
  },
  loop_checks_248(ctx) {
    const na = notAdopted(ctx); if (na) return na;
    const w = loopWeek(ctx); if (w.result) return w.result;
    const c = checksRan(w.week);
    return c.ok ? pass(c.why) : fail(c.why);
  },
  ai_measured(ctx) {
    const na = notAdopted(ctx); if (na) return na;
    const w = loopWeek(ctx); if (w.result) return w.result;
    const a = aiMeasured(w.week);
    return a.ok ? pass(a.why) : fail(a.why);
  },
};

// ─── Search growth loop helpers (f2, f7–f12; 1 Nov 2026) ────────────────────

/** The reusable workflow a site's caller pins (seq23/search-loop README, "How a site adopts it"). */
export const LOOP_ENGINE_USES = "seq23/search-loop/.github/workflows/search-loop.yml@v1";
const LOOP_CALLER_RE = /uses:\s*['"]?seq23\/search-loop\/\.github\/workflows\/search-loop\.yml@v1(?:\.\d+){0,2}['"]?\s*$/m;
/** The engine's config file (a caller may name another path with `with: config:`). */
export const LOOP_CONFIG_RE = /(^|\/)search-loop\.config\.json$/;
export const LOOP_CONFIG_SCHEMA = "search-loop-config-v1";

/**
 * A site with no engine config that names it has not adopted the loop yet. The rollout agents own
 * adoption, wave by wave, so this is said ("Search loop: not adopted yet (wave N)") and never a fix
 * brief; the loop items only judge (and brief) once the config exists. A config that does not parse
 * counts as adopted, so it fails by name.
 */
export function notAdopted(ctx) {
  if (loopConfigFor(ctx.repo, ctx.site.domain)) return null;
  const wave = ctx.site.search_loop?.wave;
  return { status: "skipped", detail: `Search loop: not adopted yet${wave ? ` (wave ${wave})` : ""}` };
}
/** Paid search-data services; the loop is $0. */
export const PAID_SEO_RE = /(?<![a-z])(ahrefs|semrush|dataforseo|moz_?api|serpapi|spyfu|openseo|similarweb)(?![a-z])/i;

/**
 * Workflows whose contents could not be read from the clone (a blobless clone's fetch failed). With one
 * unread, "no workflow calls the engine" is unproven, so the loop checks say "not checked" by name
 * instead of failing a site that may well run it (7 Nov 2026, time-2-read.com f7/f12). Null when all read.
 */
export function unreadWorkflows(repo) {
  const u = (repo?.workflows ?? []).filter((w) => w.unread).map((w) => w.name);
  return u.length ? `could not read ${u.slice(0, 3).join(", ")}${u.length > 3 ? ` and ${u.length - 3} more` : ""} from the clone, so whether a workflow calls the shared engine is unproven` : null;
}

export function loopCaller(repo) {
  return (repo?.workflows ?? []).find((w) => LOOP_CALLER_RE.test(w.text ?? "")) ?? null;
}

/**
 * The engine config that names this site (`site`, one host, schema search-loop-config-v1):
 * `{ path, raw, cfg, node }`, `{ path, error, node: {} }` when a config file that may be this site's does
 * not parse or is not v1, or null when none names it. Read from `search-loop.config.json` anywhere in
 * the repo and from any path a caller passes as `with: config:`.
 */
export function loopConfigFor(repo, domain) {
  const d = bare(domain);
  const named = (repo?.workflows ?? []).filter((w) => LOOP_CALLER_RE.test(w.text ?? ""))
    .map((w) => /^\s*config:\s*['"]?([^'"\s#]+)/m.exec(w.text ?? "")?.[1]).filter(Boolean);
  const paths = [...new Set([...(repo?.files ?? []).filter((f) => LOOP_CONFIG_RE.test(f) && !/(^|\/)(node_modules|tests?|fixtures?|examples?)\//.test(f)), ...named])];
  let broken = null;
  for (const path of paths) {
    const raw = repo.show?.(path);
    if (raw == null) continue;
    let cfg; try { cfg = JSON.parse(raw); } catch { broken = broken ?? { path, error: "does not parse as JSON", node: {} }; continue; }
    if (bare(cfg?.site) !== d && bare(cfg?.base_url) !== d) continue;
    if (cfg?.schema !== LOOP_CONFIG_SCHEMA) return { path, error: `is not a ${LOOP_CONFIG_SCHEMA} config (schema ${JSON.stringify(cfg?.schema ?? null)})`, node: cfg };
    return { path, raw, cfg, node: cfg };
  }
  return broken;
}

/** The site's one action: the config's `action.url` (a URL or a path), or null. */
export function oneActionOf(cfg) {
  const v = cfg?.node?.action?.url;
  return v && String(v).trim() ? String(v).trim() : null;
}

/** Does a link or form target reach the one action? Same host (or the action's own host) and path prefix. */
export function actionMatches(target, action, base) {
  let t, a;
  try { t = new URL(target, base); a = new URL(action, base); } catch { return false; }
  if (bare(t.hostname) !== bare(a.hostname)) return false;
  // A static site links its pages as files: /download.html (or /download/index.html) IS /download.
  const path = (u) => u.pathname.replace(/\/index\.html$/i, "/").replace(/\.html$/i, "").replace(/\/+$/, "");
  const ap = path(a), tp = path(t);
  return ap === "" ? tp === "" : tp === ap || tp.startsWith(`${ap}/`);
}

/**
 * THE HOST A SITE IS AUDITED ON (6 Nov 2026). spryexecutiveos.com's home page answers 301 to
 * billionairehighperformancecoach.com, and the audit took that host as the site's: it read the other
 * site's sitemap and failed f9 on twelve of ITS pages. Following the home page is right for the same
 * site (www ↔ apex); a redirect to another site never makes that site's pages this one's.
 */
export function auditHost(domain, finalUrl) {
  let h; try { h = finalUrl ? new URL(finalUrl).hostname : null; } catch { h = null; }
  return h && bare(h) === bare(domain) ? h : domain;
}

/**
 * THE PAGE WHOSE SOCIAL CARD IS THIS SITE'S (7 Nov 2026, item b6). The og:image probe read the home
 * page as fetched, redirects followed. spryexecutiveos.com/ answers 301 to
 * billionairehighperformancecoach.com, so b6 graded the OTHER site's card ("og:image is on
 * billionairehighperformancecoach.com") while every one of the spry host's 55 sitemap pages carried
 * its own 1200x630 card on its own host. Same rule as auditHost: a redirect to another site never
 * makes that site's page this one's. The home page counts when it answered on this site (www and
 * apex alike); otherwise the first sampled page that answered 200 on this site with an og:image.
 * Returns null when no page of this site states one, which social_tags then fails on its own terms.
 */
export function socialCardPage(domain, pages) {
  const onSite = (p) => { try { return bare(new URL(p.final ?? p.url).hostname) === bare(domain); } catch { return false; } };
  return (pages ?? []).find((p) => p.status === 200 && p.html && onSite(p) && metaContent(p.html, "og:image")[0]) ?? null;
}

/** The site's newest usable weekly report, or `{ result }`: the status to return instead. */
export function loopWeek(ctx) {
  const r = ctx.repo;
  if (!r?.ok) return { result: r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read") };
  if (r.loopWeeks === undefined || r.loopWeeks === null) return { result: notChecked(`the weekly search-loop report was not read${r.loopWhy ? `: ${r.loopWhy}` : ""}`) };
  const got = weekFor(r.loopWeeks, { domain: ctx.site.domain, repo: ctx.site.repo, now: ctx.now ?? Date.now() });
  if (got.none) return { result: fail("no search-loop-week report from this site yet: the engine has not uploaded one") };
  if (got.problem) return { result: fail(`the newest search-loop-week report cannot be used: ${got.problem}`) };
  return { week: got.week };
}

/**
 * Which kind of search wins on this site (engine v1.6.0 lanes), as `{ line }` for the site's row and
 * the Monday email; null when the site has not adopted the loop. A report that was not read says so.
 */
export function searchLanes(ctx) {
  if (!ctx?.repo?.ok || notAdopted(ctx)) return null;
  const r = ctx.repo;
  if (r.loopWeeks === undefined || r.loopWeeks === null) return { line: "Which searches win: not read: this week's search report did not arrive" };
  const got = weekFor(r.loopWeeks, { domain: ctx.site.domain, repo: ctx.site.repo, now: ctx.now ?? Date.now() });
  if (got.none) return { line: "Which searches win: not read: the site has not sent a weekly search report yet" };
  if (got.problem) return { line: `Which searches win: not read: the newest weekly search report cannot be used (${got.problem})` };
  return { line: laneLine(got.week) };
}

// ─── Authority and entity helpers (k1–k6) ────────────────────────────────────

/** The Spry Labs entity home every side business points parentOrganization at (owner, 30 Oct 2026). */
export const SPRY_LABS_ID = "https://billionairehighperformancecoach.com/spry-labs#organization";
const SPRY_LABS_HOME = "billionairehighperformancecoach.com/spry-labs";
/** sites.json `entity_parent`: spry-labs (side businesses), client (friends' businesses), own (hers, outside Spry Labs). */
export const ENTITY_PARENTS = Object.freeze(["spry-labs", "client", "own"]);
export const ENTITY_FILE_RE = /(^|\/)entity\.json$/;
export const ENTITY_WATCH_RE = /^entity[-_]backlink[-_]watch\.ya?ml$/;
/** Platforms that refuse a robot or render in JS: a non-404 answer is unverifiable, not dead. */
export const JS_WALLED = /(^|\.)(instagram\.com|facebook\.com|linkedin\.com|gumroad\.com|tiktok\.com|x\.com|twitter\.com|maps\.google\.com|g\.page|crunchbase\.com)$|^google\.com$/;

export const bare = (h) => String(h ?? "").toLowerCase().replace(/^www\./, "");
export const hostOf = (u) => { try { return bare(new URL(u).hostname); } catch { return ""; } };
const idOf = (v) => (typeof v === "string" ? v : v && typeof v === "object" ? v["@id"] ?? v.url ?? null : null);

/** Every sameAs URL in a page's JSON-LD, nested nodes included. */
export function liveSameAs(html) {
  const out = new Set();
  for (const n of deepNodes(jsonLd(html).nodes, /./)) for (const u of [].concat(n.sameAs ?? [])) if (typeof u === "string") out.add(u);
  return [...out];
}

/**
 * The site's own entry in the repo's entity file. A multi-site repo keys each site under `sites`
 * (sprylabs-hpc-site config/entity.json, dream-wedding-builder) or keeps one file per site whose url
 * names its host (local-guides-generator data/entity/<pack>/entity.json). `entity_file` in sites.json
 * names a file not called entity.json (hicksconsulting.org: data/entities/org_schema.json).
 */
export function entityFor(repo, site) {
  if (!repo?.ok || !site) return null;
  const domain = bare(site.domain);
  const paths = site.entity_file ? [site.entity_file] : repo.files.filter((f) => ENTITY_FILE_RE.test(f) && !/(^|\/)node_modules\//.test(f)).slice(0, 60);
  const parsed = [];
  for (const path of paths) {
    let json; try { json = JSON.parse(repo.show(path) ?? ""); } catch { continue; }
    if (!json || typeof json !== "object" || Array.isArray(json)) continue;
    const keyed = json.sites && typeof json.sites === "object" ? Object.entries(json.sites).find(([k]) => bare(k) === domain)?.[1] : null;
    if (keyed && typeof keyed === "object") return { path, node: keyed, root: json };
    const names = [json.url, json["@id"]].map(hostOf).concat(bare(json.domain ?? ""), (json.own_hosts ?? []).map(bare));
    if (names.includes(domain)) return { path, node: json, root: json };
    parsed.push({ path, node: json, root: json });
  }
  return site.entity_file || parsed.length === 1 ? parsed[0] ?? null : null;
}

/** Every object in a JSON value (typed or not): the entity file's nodes carry @id but no @type. */
function deepNodesAny(x, out = [], seen = new Set()) {
  if (!x || typeof x !== "object" || seen.has(x)) return out;
  seen.add(x);
  if (!Array.isArray(x)) out.push(x);
  for (const v of Object.values(x)) deepNodesAny(v, out, seen);
  return out;
}

function ownHosts(ctx, e) {
  return new Set([bare(ctx.host), bare(ctx.site?.domain), ...(e?.root?.own_hosts ?? []), ...(e?.node?.own_hosts ?? [])].map(bare).filter(Boolean));
}

export const CLARITY_RE = /clarity\.ms|clarity\.js|\/clarity[-.]/i;

/** Privacy disclosures and documentation links do not load a recording script. */
export function loadsClarity(html) {
  const active = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  return [...active.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].some((m) => {
    const a = attrs(m[1]);
    if (a.type && !/^(?:module|(?:text|application)\/(?:java|ecma)script)$/i.test(a.type.trim())) return false;
    return CLARITY_RE.test(a.src ?? "") || (!a.src && CLARITY_RE.test(m[2]));
  });
}

/** A page where a visitor fills a form or buys: a real <form>, or a link to a checkout. */
export function formOrBuy(html, base = "https://x.invalid/") {
  if (/<form\b/i.test(String(html))) return true;
  return links(html, base).some((l) => /(^|\.)(gumroad\.com|stripe\.com|paypal\.com|lemonsqueezy\.com|square\.link|checkout\.shopify\.com)$/.test(l.host) || /\/(checkout|cart|buy|order|book(ing)?)(\/|$|\?)/i.test(new URL(l.url).pathname));
}

/** actions/cache steps in workflows that hold a BUILD (not dependencies or model downloads). */
export function buildCaches(workflows) {
  const out = [];
  for (const w of workflows) {
    const lines = String(w.text ?? "").split("\n");
    lines.forEach((line, i) => {
      if (!/uses:\s*actions\/cache(\/restore)?@/.test(line)) return;
      const block = lines.slice(i + 1, i + 14).join("\n");
      const path = /\bpath:\s*\|?\s*([^\n]+(?:\n\s{10,}[^\n:]+)*)/.exec(block)?.[1]?.trim() ?? "";
      const key = /\bkey:\s*([^\n]+)/.exec(block)?.[1]?.trim() ?? "";
      if (!path || /node_modules|\.npm\b|pip|~\/\.cache|huggingface|playwright|\.cargo|gradle|vlm|whisper/i.test(path)) return;
      if (!/build|dist|_site|\bout\b|public|tree|\.next|\.astro|site|render|\.tar/i.test(path)) return;
      out.push({ workflow: w.name, path, key });
    });
  }
  return out;
}

/** Does this text build a cache key over every tracked file, excluding only .github/workflows? */
export function wholeTreeKey(text) {
  const t = String(text ?? "");
  if (/hashFiles\(\s*['"]\*\*(\/\*)?['"]\s*,\s*['"]!\.github\/workflows\/\*\*['"]\s*\)/.test(t)) return true;
  if (!/git\s+ls-files/.test(t)) return false;
  if (!/\.github\/workflows/.test(t)) return false;
  // Any other exclusion of tracked paths from the listing makes the key too narrow.
  const excl = [...t.matchAll(/grep\s+-[a-zA-Z]*v[a-zA-Z]*\s+(['"])(.*?)\1/g)].map((m) => m[2]);
  return excl.every((e) => /\.github\/workflows/.test(e) && !/\|/.test(e.replace(/\\\|/g, "")));
}

/** A literal list of email domains next to a block/junk/spam/deny name. */
export const HARDCODED_DOMAIN_LIST = /(block|junk|spam|deny|ban)\w*\s*[:=]\s*(?:new\s+Set\(\s*)?\[\s*(?:['"`][a-z0-9.-]+\.[a-z]{2,}['"`]\s*,\s*)+['"`][a-z0-9.-]+\.[a-z]{2,}['"`]/i;

/** The daily Search Console truth file: the checklist's name, and the generator's name for the same file. */
export const GSC_TRUTH_NAMES = ["gsc_truth.json", "gsc_search_analytics_export.json"];
export const FRESH_FILE_NAMES = [...GSC_TRUTH_NAMES, "index_coverage.json"];

/**
 * The IndexNow key files a repository holds.
 *
 * IndexNow's rule for a key is 8-128 characters of a-z, A-Z, 0-9 and dashes, so a UUID is a valid
 * key. The old detector was /(^|\/)[0-9a-f]{32,64}\.txt$/ - lowercase hex, no dashes - and
 * porchandparty901.com's key is a UUID: 5f1f13a4-...-9c2d90c3b7d2.txt, committed at the root of
 * p-n-p, served 200 with its key inside, submitted by that repo's deploy lane and guarded by that
 * repo's own validator, which accepts dashes. It did not match, so items e3 and i8 failed every run
 * with "no IndexNow key file in the repo" and wrote two fix briefs a week against a site that had
 * one all along (26 Oct 2026). A checker that invents work is worse than one that misses something.
 *
 * Allowing dashes alone is not enough to be right, though: `llms-full.txt` is 8-128 characters of
 * exactly that alphabet. The name shape cannot tell a key from any other hyphenated text file, so
 * this uses IndexNow's actual contract - A KEY FILE'S BODY IS ITS OWN KEY - which is the same test
 * p-n-p's validator applies and the same one the search engine applies when it verifies ownership.
 * `robots.txt`, `llms.txt`, `llms-full.txt` and a `CNAME` all fail it. `indexnow.txt` is accepted
 * by name because the checklist names that form, and by body like any other.
 *
 * `show` reads a file out of the tree; when it is not available (a caller with only a file list)
 * the name shape alone is used, and the caller is trusting a weaker signal on purpose.
 */
export const INDEXNOW_KEY_NAME = /(^|\/)(indexnow|[A-Za-z0-9][A-Za-z0-9-]{6,126}[A-Za-z0-9])\.txt$/;
export function indexnowKeyFiles(files, show) {
  const named = (files ?? []).filter((f) => INDEXNOW_KEY_NAME.test(f));
  if (typeof show !== "function") return named;
  return named.filter((f) => {
    const key = f.split("/").pop().replace(/\.txt$/, "");
    let body = null;
    try { body = show(f); } catch { return false; }
    return typeof body === "string" && body.trim() === key;
  });
}

function repoFresh(ctx, names) {
  const r = ctx.repo; if (!r?.ok) return r?.noRepo ? { status: "no_repo", detail: r.why } : notChecked(r?.why ?? "repo not read");
  const all = names.flatMap((n) => r.fresh?.[n] ?? []);
  // A repo serving several sites keeps one file per site under a folder named for it: use that one.
  const own = all.filter((x) => x.path.includes(ctx.site.domain));
  const hits = own.length ? own : all;
  const name = names.join(" or ");
  if (!hits.length) return fail(`no ${name} in the repo`);
  const newest = Math.max(...hits.map((h) => h.at));
  const days = (ctx.now - newest) / 86_400_000;
  return days <= 3 ? pass(`${name} committed ${days.toFixed(1)} days ago`) : fail(`${name} last committed ${days.toFixed(0)} days ago`);
}

/** Run every applicable item for one site. Protected pages are taken out of cosmetic items. */
export function runChecks(checklist, ctx) {
  const results = [];
  const cosmetic = new Set(checklist.cosmetic_items ?? []);
  for (const item of checklist.items) {
    if (!applies(item, ctx.site)) continue;
    const c = item.check;
    if (c.mode === "manual") { results.push({ id: item.id, status: "manual", detail: c.reason }); continue; }
    const fn = CHECKS[c.type];
    if (!fn) { results.push({ id: item.id, status: "fail", detail: `no check is implemented for type ${c.type}` }); continue; }
    // An ACCEPTED EXCEPTION is one check on one protected page that she decided stays as it is
    // (26 Oct 2026: b2 and c1 on the Spry Labs download page). Only that page leaves only that check.
    const excepted = (ctx.site?.protected_pages ?? []).filter((pp) => (pp.accepted_exceptions ?? []).some((x) => x.item === item.id)).map((pp) => pp.path);
    const skip = [...(cosmetic.has(item.id) ? (ctx.protectedPaths ?? []) : []), ...excepted];
    const scoped = skip.length
      ? { ...ctx, pages: (ctx.pages ?? []).filter((p) => !skip.some((pp) => new URL(p.url).pathname.replace(/\.html$/, "") === pp)) }
      : ctx;
    let r;
    try { r = fn(scoped, c.params); } catch (e) { r = { status: "not_checked", detail: `the check threw: ${String(e?.message ?? e).slice(0, 160)}` }; }
    results.push({ id: item.id, ...r });
  }
  return results;
}

// ─── Fix briefs: the auto-fix lane's queue ────────────────────────────────────

/**
 * One machine-readable brief per failing item per site. Danielle's weekly fixer
 * (`scripts/ops/ahrefs-audit-fix.sh`, prompt section "The Search Readiness fix queue") reads them.
 * A failure on a protected page is flagged `protected` with its rule; it is never bundled.
 */
export function fixBriefs(checklist, siteResults, { now = Date.now() } = {}) {
  const byId = Object.fromEntries(checklist.items.map((i) => [i.id, i]));
  const briefs = [];
  for (const s of siteResults) {
    // Only items the checklist still holds (6 Nov 2026: a6 and k5 removed): a stale result is dropped.
    for (const r of s.results.filter((x) => x.status === "fail" && byId[x.id])) {
      const item = byId[r.id];
      // A KNOWN LIMIT is a failure the repo cannot fix at source (the host decides it, or it waits on a
      // named stop), recorded on the site in sites.json with its reason. It stays in the results and
      // the queue, so it is never hidden, but it is not workable: no pass is spent on it.
      // A known limit with review_after stops excusing the item on that date, so a limit set from a
      // measurement is measured again rather than kept for ever (26 Oct 2026).
      const limit = (s.site.known_limits ?? []).find((k) => k.item === r.id && !(k.review_after && Date.parse(k.review_after) <= now)) ?? null;
      const prot = (s.site.protected_pages ?? []).filter((pp) => [r.detail, ...(r.evidence ?? []), ...(r.missing ?? [])].join(" ").includes(pp.path));
      briefs.push({
        id: `sr-${s.site.domain}-${r.id}`,
        created_at: new Date(now).toISOString(),
        domain: s.site.domain,
        canonical_host: s.host,
        repo: s.site.repo,
        category: s.site.category,
        item_id: r.id,
        item_title: item?.title ?? r.id,
        why: item ? item.why_html.replace(/<[^>]+>/g, "") : "",
        check: item?.check?.how ?? "",
        failure: r.detail,
        missing_urls: r.missing ?? [],
        evidence: (r.evidence ?? []).slice(0, 25),
        protected: prot.length ? prot.map((pp) => ({ path: pp.path, rule: pp.rule, buy_link: pp.buy_link, sha256: pp.sha256 })) : null,
        // A SUNSETTING site (sites.json `sunsetting`, owner 7 Nov 2026: spryexecutiveos.com lapses with
        // its domain) is audited and reported, and its briefs are recorded, never worked.
        // A NAMED STOP is a failure only the owner can clear (a check that sets `named_stop`).
        // It stays in the queue so it is said every week, but no fix pass is ever spent on it.
        // A repo the fixer may never branch (a client's report-only repo, repoPolicy NO_AUTO_FIX) is
        // recorded, never worked: its site reports in its own repo (1 Nov 2026).
        // A site whose published pages change only with her yes (sites.json `owner_approval`: Hicks,
        // owner 3 Nov 2026) holds a brief until she approves this week's plan (`s.approved`), EXCEPT a
        // repair whose every page is an already-published post under the site's direct-repair paths
        // (owner, 3 Nov 2026: "if it has repairs for already published resources they should just fix
        // them not queue"): that one is worked like any other site (`heldForOwner`, ownerApproval.mjs).
        disposition: !s.site.repo ? "no_repo" : !mayAutoFix(s.site.repo) ? "client_repo" : s.site.sunsetting ? "sunsetting" : heldForOwner(s.site, { approved: s.approved, texts: [r.detail, ...(r.evidence ?? []), ...(r.missing ?? [])] }) ? "owner_approval" : s.site.client_approval ? "client_draft" : limit ? "known_limit" : r.named_stop ? "named_stop" : "fix",
        ...(limit ? { known_limit: limit.why } : {}),
        ...(r.named_stop ? { named_stop: r.named_stop } : {}),
      });
    }
  }
  return briefs;
}

/** Brief kinds that are not checklist items (search-outcomes.mjs `weeklyBriefs`): kept as they are. */
const WEEKLY_BRIEF_KINDS = ["outcome", "quality", "consolidate"];

/**
 * THE QUEUE AS READ (6 Nov 2026). A fix-queue.json written last Monday may hold briefs for items the
 * owner has since removed (a6, k5); the Tuesday run reads that file, so the queue is filtered again
 * on every read: a checklist brief stays only while its item does. Zero items is a blind filter.
 */
export function currentBriefs(checklist, briefs) {
  const ids = new Set((checklist?.items ?? []).map((i) => i.id));
  if (!ids.size) throw Object.assign(new Error("NAMED STOP [CHECKLIST_EMPTY] the checklist holds no items, so no brief can be kept or dropped; read checklist.json again"), { code: 2 });
  return (Array.isArray(briefs) ? briefs : []).filter((b) => WEEKLY_BRIEF_KINDS.includes(b?.kind) || ids.has(b?.item_id));
}

// ─── The weekly split: why each failure is on the list (owner, 6 Nov 2026) ─────

export const NEW_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

/**
 * Every failure this run, in one of four groups, each counted once, in this order:
 *   new_sites     the site was first audited within NEW_WINDOW_DAYS, or never before (new to sites.json).
 *                 A site in the OLDEST run on record is the baseline, never new: the audit itself began
 *                 on 25 Oct 2026, so "first audited" there means "already there when we started".
 *   slipped_back  the site's most recent earlier run that judged the item passed it
 *   new_items     the item entered the checklist (`added`) within NEW_WINDOW_DAYS
 *   still_open    everything else
 * `history` is the earlier runs (results-<day>.json: `{ day, sites }`), never this run. Only items the
 * checklist still holds are counted. Every number comes from `siteResults`, this run's results.
 */
export function failureSplit(checklist, siteResults, { history = [], now = Date.now(), windowDays = NEW_WINDOW_DAYS } = {}) {
  const byId = new Map((checklist?.items ?? []).map((i) => [i.id, i]));
  const recent = (day) => Number.isFinite(Date.parse(day)) && now - Date.parse(day) < windowDays * DAY_MS;
  const runs = (history ?? []).filter((h) => h?.day && Array.isArray(h.sites)).sort((a, b) => String(b.day).localeCompare(String(a.day)));
  const firstSeen = new Map();
  for (const h of runs) for (const s of h.sites) { const d = s?.site?.domain; if (d) firstSeen.set(d, h.day); } // newest → oldest: the last write is the earliest
  const baseline = runs.length ? runs[runs.length - 1].day : null;
  const isNewSite = (d) => { const first = firstSeen.get(d); return !first || (first !== baseline && recent(first)); };
  const lastVerdict = (domain, id) => {
    for (const h of runs) {
      const r = h.sites.find((s) => s?.site?.domain === domain)?.results?.find((x) => x.id === id && (x.status === "pass" || x.status === "fail"));
      if (r) return r.status;
    }
    return null;
  };
  const groups = { new_sites: [], slipped_back: [], new_items: [], still_open: [] };
  for (const s of siteResults ?? []) {
    const d = s?.site?.domain;
    for (const r of (s?.results ?? []).filter((x) => x.status === "fail" && byId.has(x.id))) {
      const key = `${d}|${r.id}`;
      if (isNewSite(d)) groups.new_sites.push(key);
      else if (lastVerdict(d, r.id) === "pass") groups.slipped_back.push(key);
      else if (recent(byId.get(r.id).added)) groups.new_items.push(key);
      else groups.still_open.push(key);
    }
  }
  const n = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));
  return { total: n.new_sites + n.slipped_back + n.new_items + n.still_open, ...n, groups };
}

/** The split in plain words, from this run's numbers only. */
export function splitLine(split) {
  if (!split?.total) return "Nothing is failing this week.";
  const parts = [
    split.new_sites ? `${split.new_sites} on new sites` : null,
    split.new_items ? `${split.new_items} from new checklist items` : null,
    split.slipped_back ? `${split.slipped_back} slipped back` : null,
    split.still_open ? `${split.still_open} still open` : null,
  ].filter(Boolean);
  return `${split.total} ${split.total === 1 ? "check" : "checks"} failing: ${parts.join(", ")}.`;
}

// ─── Plain words for the morning email ───────────────────────────────────────

// The business first (owner, 7 Nov 2026): "Industry Guides (dentistryguides.com)", never a vertical alone.
const short = (s) => (s.business ? `${s.business} (${s.domain})` : s.domain);

/**
 * The lines for the morning email's "The grid repos" section (owner's make-it-calm rules: what is
 * broken, what was fixed, what is being built; plain words, no ids, no commands). `previous` is
 * last week's result so a fix can be named as fixed.
 */
export function morningLines(checklist, allResults, { previous = null, history = null, now = Date.now(), queued = 0, lastRepair = null, max = 4, categories = null, redLines = [], goldLines = [] } = {}) {
  // Her own sites carry the routine lines; a friend's site only when it needs her (a named stop).
  const mine = (x) => siteSection(x.site, categories) === "mine";
  const siteResults = (allResults ?? []).filter(mine);
  const needsHer = (allResults ?? []).filter((x) => siteSection(x.site, categories) === "friends")
    .flatMap((x) => (x.results ?? []).filter((r) => r.status === "fail" && r.named_stop).map((r) => `${x.site.domain} (${r.named_stop})`));
  const byId = Object.fromEntries(checklist.items.map((i) => [i.id, i]));
  const failing = siteResults.map((s) => ({ s, f: s.results.filter((r) => r.status === "fail") }));
  const clean = failing.filter((x) => !x.f.length).length;
  const lines = [];
  // Why each failure is on the list (6 Nov 2026), counted from THIS run: never an older run's words.
  const split = splitLine(failureSplit(checklist, siteResults, { history: (history ?? (previous ? [previous] : [])).map((h) => ({ ...h, sites: (h.sites ?? []).filter(mine) })), now }));
  lines.push(`We checked all ${siteResults.length} grid repo sites against your Search Readiness Checklist this week. ${clean} pass every check${clean === siteResults.length ? "." : `; ${siteResults.length - clean} have gaps.`} ${split}`);
  const worst = failing.filter((x) => x.f.length).sort((a, b) => b.f.length - a.f.length);
  const cov = worst.map((x) => ({ s: x.s, c: x.f.find((r) => r.id === "j9") })).filter((x) => x.c);
  if (cov.length) lines.push(`Missing local pages: ${cov.slice(0, 3).map((x) => `${short(x.s.site)} is missing ${x.c.missing?.length ?? 0}`).join(", ")}${cov.length > 3 ? `, and ${cov.length - 3} more sites` : ""}.`);
  if (worst.length) {
    const top = worst.slice(0, 3).map((x) => `${short(x.s.site)} (${x.f.slice(0, 2).map((r) => (byId[r.id]?.title ?? r.id).split(/[;:,(]/)[0].trim().toLowerCase()).join("; ")})`);
    lines.push(`Most to fix: ${top.join(", ")}.`);
  }
  if (previous) {
    const was = new Set(previous.sites.filter(mine).flatMap((s) => s.results.filter((r) => r.status === "fail").map((r) => `${s.site.domain}|${r.id}`)));
    const now = new Set(siteResults.flatMap((s) => s.results.filter((r) => r.status === "fail").map((r) => `${s.site.domain}|${r.id}`)));
    const fixed = [...was].filter((k) => !now.has(k)).length;
    if (fixed) lines.push(`Fixed since last week: ${fixed} gaps closed.`);
  }
  if (queued || lastRepair) lines.push(repairLine(lastRepair, queued));
  const out = lines.slice(0, needsHer.length ? max - 1 : max);
  if (needsHer.length) out.push(`Friends' sites that need you: ${needsHer.slice(0, 2).join(", ")}${needsHer.length > 2 ? `, and ${needsHer.length - 2} more` : ""}.`);
  // Leads next to Google's visits, her own sites only (3 Nov 2026, site-leads.mjs).
  return [...redTop(redLines, allResults, categories), ...goldTop(goldLines, allResults, categories), ...out, ...leadsMorningLines(siteResults), ...laneMorningLines(siteResults)];
}

/**
 * WHICH SEARCHES WIN, PER SITE (engine v1.6.0, 3 Nov 2026), her own sites only: one line per site
 * with lane numbers or a "not read" reason (never 0), at most MAX_LANES; sites on an older engine
 * share one line ("lanes start with engine v1.6").
 */
const MAX_LANES = 8;
export function laneMorningLines(siteResults) {
  const withLanes = (siteResults ?? []).filter((s) => s.lanes?.line);
  const older = withLanes.filter((s) => s.lanes.line === LANES_NOT_YET).map((s) => short(s.site));
  const read = withLanes.filter((s) => s.lanes.line !== LANES_NOT_YET);
  const out = read.slice(0, MAX_LANES).map((s) => `${short(s.site)}: ${s.lanes.line}.`);
  if (read.length > MAX_LANES) out.push(`And ${read.length - MAX_LANES} more sites' search lanes on the checklist page.`);
  if (older.length) out.push(`${older.slice(0, 3).join(", ")}${older.length > 3 ? `, and ${older.length - 3} more` : ""}: ${LANES_NOT_YET}.`);
  return out;
}

/**
 * THE RED LINES GO FIRST (2 Nov 2026, the WPP-llm cliff nobody saw). Outcome and quality red lines
 * (search-outcomes.mjs `redLines`) head the section, never cut by `max`: her own sites one line each
 * (at most MAX_RED, then "and N more"), friends' sites folded into one line. A blind alarm (no site
 * read) is always shown.
 */
const MAX_RED = 5;
function redTop(red, allResults, categories) {
  if (!red?.length) return [];
  const siteOf = new Map((allResults ?? []).map((x) => [x.site?.domain, x.site]));
  const blind = red.filter((r) => !r.domain).map((r) => r.line);
  const mine = red.filter((r) => r.domain && siteSection(siteOf.get(r.domain) ?? { domain: r.domain }, categories) !== "friends");
  const friends = [...new Set(red.filter((r) => r.domain && !mine.includes(r)).map((r) => r.domain))];
  const out = [...blind, ...mine.slice(0, MAX_RED).map((r) => `Red: ${r.line}`)];
  if (mine.length > MAX_RED) out.push(`And ${mine.length - MAX_RED} more red lines on the checklist page.`);
  if (friends.length) out.push(`Friends' sites with a red line: ${friends.slice(0, 3).join(", ")}${friends.length > 3 ? `, and ${friends.length - 3} more` : ""}.`);
  return out;
}

/**
 * THE GOLD LINES (3 Nov 2026): a quarter or more down two weeks running ("slipping"), each with its
 * diagnosis's most likely cause. A nudge, never an alarm, so after the red lines. Friends' and
 * clients' sites are named in one line only; their numbers and diagnosis stay in their own row on
 * the checklist page (client data never feeds her own lines).
 */
function goldTop(gold, allResults, categories) {
  if (!gold?.length) return [];
  const siteOf = new Map((allResults ?? []).map((x) => [x.site?.domain, x.site]));
  const mine = gold.filter((r) => siteSection(siteOf.get(r.domain) ?? { domain: r.domain }, categories) !== "friends");
  const friends = [...new Set(gold.filter((r) => !mine.includes(r)).map((r) => r.domain))];
  const out = mine.slice(0, MAX_RED).map((r) => `Slipping: ${r.line}`);
  if (mine.length > MAX_RED) out.push(`And ${mine.length - MAX_RED} more slipping sites on the checklist page.`);
  if (friends.length) out.push(`Friends' sites slipping in Google: ${friends.slice(0, 3).join(", ")}${friends.length > 3 ? `, and ${friends.length - 3} more` : ""}. Why is on their row of the checklist page.`);
  return out;
}

/** One line per site, for the log and the report: "domain: N failing (ids)". */
export function summaryLines(siteResults) {
  return siteResults.map((s) => {
    const f = s.results.filter((r) => r.status === "fail").map((r) => r.id);
    const nc = s.results.filter((r) => r.status === "not_checked").length;
    const miss = s.results.find((r) => r.id === "j9" && r.status === "fail")?.missing?.length ?? 0;
    return `${s.site.domain}: ${f.length ? `${f.length} failing (${f.join(" ")})` : "all pass"}${miss ? `; ${miss} coverage URLs missing` : ""}${nc ? `; ${nc} not checked` : ""}`;
  });
}

// ─── The fix queue, worked to empty (owner, 25 Oct 2026: "why can't all 242 be fixed now?") ─────

/**
 * What the daily queue run still has to do. A brief is WORKABLE when it names a repo and is not on a
 * protected page; protected briefs (the Spry Labs download page) are fixed only on their own, and
 * no_repo briefs have nowhere to land. Those two are what may be left when the run says "done".
 */
export function workQueue(briefs, { chunkSize = 10 } = {}) {
  const list = Array.isArray(briefs) ? briefs : [];
  const isProtected = (b) => Array.isArray(b.protected) ? b.protected.length > 0 : Boolean(b.protected);
  const noRepo = list.filter((b) => !b.repo || b.disposition === "no_repo");
  const prot = list.filter((b) => b.repo && b.disposition !== "no_repo" && isProtected(b));
  // client_draft (Horse, 3 Nov 2026): worked like a fix, but drafted into the client's approval queue, never made live.
  const WEEKLY_KINDS = ["outcome", "quality", "consolidate"];
  const workable = list.filter((b) => b.repo && (b.disposition === "fix" || (b.disposition === "client_draft" && !WEEKLY_KINDS.includes(b.kind))) && !isProtected(b));
  const byRepo = {};
  for (const b of workable) byRepo[b.repo] = (byRepo[b.repo] ?? 0) + 1;
  const repos = Object.entries(byRepo).sort((a, b) => b[1] - a[1]).map(([repo, n]) => ({ repo, n }));
  /*
   * CHUNKS, NOT WHOLE REPOS (25 Oct 2026). The first full run gave local-guides-generator's 61 briefs
   * to one pass; it hit its 250-turn limit before opening a single PR and everything it had done was
   * lost. A pass is now handed at most `chunkSize` briefs of one repo, so each one can finish, land,
   * and leave the rest for the next pass.
   */
  const chunks = [];
  for (const { repo } of repos) {
    const ids = workable.filter((b) => b.repo === repo).map((b) => b.id);
    for (let i = 0; i < ids.length; i += chunkSize) chunks.push({ repo, ids: ids.slice(i, i + chunkSize) });
  }
  /*
   * WEEKLY BRIEFS (2 Nov 2026): the outcome alarm, the quality sample and the fold queue. Each gets ONE
   * pass a week (the first round, `--plan` ONCE lines), never the round-until-empty loop: a 28-day
   * window stays red for weeks after its fix lands, so counting it as workable would stall every run.
   */
  const weekly = list.filter((b) => b.repo && (b.disposition === "weekly" || (b.disposition === "client_draft" && WEEKLY_KINDS.includes(b.kind))) && !isProtected(b));
  const once = [];
  for (const repo of [...new Set(weekly.map((b) => b.repo))]) {
    const ids = weekly.filter((b) => b.repo === repo).map((b) => b.id);
    for (let i = 0; i < ids.length; i += chunkSize) once.push({ repo, ids: ids.slice(i, i + chunkSize) });
  }
  return { total: list.length, workable: workable.length, protected: prot.length, no_repo: noRepo.length, weekly: weekly.length, repos, chunks, once };
}

/**
 * The Monday email's line (owner's wording, 25 Oct 2026): "Danielle fixes these every Tuesday: N
 * fixed last week, M left". N comes from the last repair run's status file; M is what this
 * morning's audit queued for her. No status file yet says so rather than inventing a zero.
 */
export function repairLine(lastRepair, left, now = Date.now()) {
  /*
   * THE REAL NUMBER, NOT THE LAST FILE'S (26 Oct 2026). The Monday email said "0 fixed last week, 17
   * left" while the overnight run was fixing 129: the audit read fix-status.json at 06:00, mid-run,
   * and the file still held an older run's count. The status now keeps every run of the last week
   * (`history`) and the run in progress (`running`), and this sums them.
   */
  const weekFixed = repairsThisWeek(lastRepair, now);
  const running = lastRepair?.running ? " Danielle is fixing them now." : "";
  return `Danielle fixes these every Tuesday: ${weekFixed === null ? "no repair run on record yet" : `${weekFixed} fixed last week`}, ${left} left.${running}`;
}

const WEEK_MS = 7 * 86_400_000;

/** Fixes in the last seven days: every finished run in `history`, plus the run in progress. */
export function repairsThisWeek(status, now = Date.now()) {
  if (!status) return null;
  const recent = (status.history ?? []).filter((h) => Date.parse(h.at) > now - WEEK_MS);
  if (!recent.length && !status.running && !Array.isArray(status.history)) {
    return Number.isFinite(Number(status.fixed)) ? Number(status.fixed) : null; // a status written before history existed
  }
  return recent.reduce((n, h) => n + (Number(h.fixed) || 0), 0) + (status.running ? Number(status.running.fixed) || 0 : 0);
}

/** The status file after a round (`running`) or at the end of a run (`history` + the run's own line). */
export function nextFixStatus(prev, { started, fixed, left, protectedLeft = 0, noRepo = 0, done = false, at = new Date().toISOString() }) {
  const history = (prev?.history ?? []).filter((h) => Date.parse(h.at) > Date.parse(at) - 4 * WEEK_MS);
  if (!done) return { ...(prev ?? {}), history, running: { at, started, fixed } };
  const line = queueRunLine({ started, fixed, left, protectedLeft, noRepo });
  return { at, started, fixed, left, protected: protectedLeft, no_repo: noRepo, line, history: [...history, { at, fixed }], running: null };
}

/** The plain-English line for the morning email: what the queue run did today. No ids, no commands. */
export function queueRunLine({ started, fixed, left, protectedLeft = 0, noRepo = 0 }) {
  const parts = [`Search fixes today: ${fixed} of ${started} fixed and live.`];
  if (left > 0) parts.push(`${left} still to do; Danielle picks them up on her next run.`);
  else parts.push("Nothing left that can be fixed automatically.");
  const kept = [];
  if (protectedLeft) kept.push(`${protectedLeft} on the Spry Labs download page, which is only ever changed on its own`);
  if (noRepo) kept.push(`${noRepo} on sites with no code to change`);
  if (kept.length) parts.push(`Left alone on purpose: ${kept.join(", and ")}.`);
  return parts.join(" ");
}

/**
 * WHAT NOW PASSES CLEARS ITS OLD FINDING (26 Oct 2026). A repair run's "surfaced" row stayed live
 * after the check it was about passed: "no Search Console property for howweknowdeep.com" (the
 * property had been shared all along; that night's token was refused) and two "dead sitemaps" that
 * answered 200 with their URLs once PR #91 landed. Both were relayed to her as things to do. Every
 * audit now posts the items that PASSED on each site, and Boss OS retires the older open findings
 * for that site and item. `[{ project, item }]`, one per passing item per site.
 */
export function passingItems(siteResults) {
  return (siteResults ?? []).flatMap((s) => (s.results ?? []).filter((r) => r.status === "pass").map((r) => ({ project: `checklist:${s.site?.domain ?? s.host}`, item: r.id })));
}
