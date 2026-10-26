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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  return a.includes(site.kind) || (site.roles ?? []).some((r) => a.includes(`role:${r}`));
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
      if (p.service_town) for (const s of c.services ?? []) out.push({ kind: "service_town", name: `${s.name} in ${t.name}`, path: fill(p.service_town, { town: t.slug, service: s.slug }) });
    }
    if (p.neighborhood) for (const n of c.neighborhoods ?? []) out.push({ kind: "neighborhood", name: n.name, path: fill(p.neighborhood, { slug: n.slug }) });
    if (p.anchor) for (const a of c.anchors ?? []) out.push({ kind: "anchor", name: a.name, path: fill(p.anchor, { slug: a.slug }) });
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
    if (!(c.neighborhoods?.length >= 1)) p.push("hyperlocal needs neighborhoods");
    if (!(c.anchors?.length >= 1)) p.push("hyperlocal needs local anchors (hospitals, venues)");
    if (!(c.services?.length >= 1) || !c.url_patterns?.service_town) p.push("hyperlocal needs services and a service_town pattern");
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
const isUtility = (url) => /\/(privacy|terms|legal|cookie|disclaimer|accessibility|contact|thank|thanks|login|signin|404|search|unsubscribe|sitemap)/i.test(new URL(url).pathname);

// ─── The checks ───────────────────────────────────────────────────────────────
// Each takes the fetched context and returns { status, detail, evidence?, missing? }.
// ctx: { site, host (canonical), home: {url,status,html,headers}, pages: [{url,status,html,headers,redirected,final}],
//        robots: {status,type,text}, sitemap: {ok, roots, children:[{url,status,count,lastmods}], urls:Set},
//        files: {path: {status,type,text}}, gsc, repo, crawl, coverage, psi, portfolio: [hosts], protectedPaths }

const pass = (detail, extra = {}) => ({ status: "pass", detail, ...extra });
const fail = (detail, extra = {}) => ({ status: "fail", detail, ...extra });
const notChecked = (detail) => ({ status: "not_checked", detail });
const okPages = (ctx) => ctx.pages.filter((p) => p.status === 200 && p.html);
const list = (arr, n = 5) => arr.slice(0, n).join("; ") + (arr.length > n ? `; and ${arr.length - n} more` : "");

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
  lastmod_from_content(ctx) {
    const s = ctx.sitemap; if (!s?.ok) return notChecked("no sitemap");
    const bad = [];
    for (const c of s.children) {
      const lm = (c.lastmods ?? []).map((x) => String(x).slice(0, 10));
      if (lm.length < 20) continue;
      const counts = {}; for (const d of lm) counts[d] = (counts[d] ?? 0) + 1;
      const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      const age = (ctx.now - Date.parse(top)) / 86_400_000;
      if (n / lm.length >= 0.9 && age <= 2) bad.push(`${c.url}: ${n} of ${lm.length} lastmod = ${top}`);
    }
    return bad.length ? fail(`lastmod looks like the build date: ${list(bad, 3)}`) : pass("lastmod dates vary with content");
  },
  llms_txt(ctx) {
    const f = ctx.files["/llms.txt"];
    if (!f || f.status !== 200) return fail(`/llms.txt answered ${f?.status ?? "nothing"}`, { missing: [`https://${ctx.host}/llms.txt`] });
    if (/<html/i.test(f.text.slice(0, 400))) return fail("/llms.txt serves HTML (a catch-all), not the file");
    if (!/text\/plain|text\/markdown/i.test(f.type ?? "")) return fail(`/llms.txt is served as ${f.type}`);
    const w = wordCount(f.text);
    return w > 2400 ? fail(`/llms.txt is ${w} words; keep it under about 2,000`) : pass(`/llms.txt is ${w} words`);
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
    // Distinct URLs, not page entries. The page list is the homepage, the sitemap sample and two
    // coverage town pages, and the sample can draw the homepage or a town page again: on 25 Oct 2026
    // time-2-read.com, memphisseniorcarehomes.com and neuroevalguides.com each "shared a title" with
    // themselves, and the fixer was briefed to fix a duplicate that did not exist.
    const norm = (u) => String(u).replace(/[?#].*$/, "").replace(/\/+$/, "");
    const checked = new Set();
    for (const p of okPages(ctx)) {
      if (checked.has(norm(p.url))) continue;
      checked.add(norm(p.url));
      const t = titleOf(p.html);
      if (t.length < 30 || t.length > 65) bad.push(`${p.url} title is ${t.length} chars`);
      (seen[t] ??= []).push(p.url);
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
    const bad = [];
    for (const p of guides) {
      const after = p.html.split(/<\/h1>/i)[1] ?? "";
      // The first real paragraph: a one-line disclaimer or byline above it is not the definition.
      const paras = [...after.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => visibleText(m[1]));
      const para = paras.find((x) => wordCount(x) >= 20) ?? paras[0] ?? "";
      const w = wordCount(para);
      if (w < 40 || w > 60 || !/\b(is|are)\b/.test(para)) bad.push(`${p.url} first paragraph ${w} words`);
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass(`${guides.length} guide pages open with a 40–60 word definition`);
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
    const bad = okPages(ctx).filter((p) => !isUtility(p.url) && new URL(p.url).pathname !== "/").map((p) => ({ u: p.url, w: wordCount(visibleText(p.html)) })).filter((x) => x.w < min).map((x) => `${x.u} (${x.w} words)`);
    return bad.length ? fail(`thin pages: ${list(bad)}`, { evidence: bad }) : pass(`no sampled content page under ${min} words`);
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
    if (ctx.site.kind === "hyperlocal") {
      const lb = deepNodes(all, /LocalBusiness|HomeAndConstructionBusiness|EntertainmentBusiness|FoodEstablishment|ProfessionalService/).find((n) => n.telephone && n.address && n.areaServed);
      return lb ? pass(`${typesOf(lb)[0]} with telephone, address and areaServed`) : fail("no LocalBusiness with telephone, address and areaServed on any sampled page");
    }
    const prod = deepNodes(all, /^(SoftwareApplication|WebApplication|MobileApplication|Product|Service|Course|Book)$/).find((n) => deepNodes([n], /^(Offer|AggregateOffer)$/).some((o) => o.price !== undefined || o.lowPrice !== undefined));
    return prod ? pass(`${typesOf(prod)[0]} with an Offer and a price`) : fail("no SoftwareApplication, Product or Service with a priced Offer on any sampled page");
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
      for (const q of deepNodes(nodes, /^Question$/)) {
        const n = String(q.name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
        if (n && !text.includes(n.slice(0, 60))) bad.push(`${p.url}: FAQ "${n.slice(0, 40)}" not visible`);
      }
      for (const o of deepNodes(nodes, /^Offer$/)) {
        const price = o.price; if (price === undefined || Number(price) === 0) continue;
        const s = String(price).replace(/\.0+$/, "");
        if (!text.includes(s)) bad.push(`${p.url}: schema price ${price} not on the page`);
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
    return /clarity\.ms|clarity\.js|\/clarity[-.]|microsoft clarity/i.test(h) || ctx.files.__clarity_loader ? pass("Clarity loads on the homepage") : fail("the homepage does not load Clarity");
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
    const bad = [];
    for (const p of guides) {
      const w = wordCount(visibleText(p.html)), why = [];
      if (w < (params?.min_words ?? 1800)) why.push(`${w} words`);
      if (!/<h2[^>]*>[^<]*quick answer/i.test(p.html)) why.push("no Quick answer H2");
      if (deepNodes(jsonLd(p.html).nodes, /^FAQPage$/).length > 1) why.push("more than one FAQPage");
      if (!links(p.html, p.url).some((l) => /request-assistance/.test(l.url) && /vertical=/.test(l.url) && /(kind|page_kind)=/.test(l.url) && /slug=/.test(l.url))) why.push("no CTA with vertical, kind and slug");
      if (why.length) bad.push(`${p.url}: ${why.join(", ")}`);
    }
    return bad.length ? fail(list(bad), { evidence: bad }) : pass(`${guides.length} guides in the house shape`);
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
    if (c.status === "pass" && k.status === "pass") return pass("Clarity and the IndexNow key are live (Bing is account-side, not read)");
    if (k.status === "no_repo") return c.status === "pass" ? { status: "no_repo", detail: k.detail } : fail(c.detail);
    return fail([c, k].filter((x) => x.status !== "pass").map((x) => x.detail).join("; "), { missing: k.missing });
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
};

/** The daily Search Console truth file: the checklist's name, and the generator's name for the same file. */
export const GSC_TRUTH_NAMES = ["gsc_truth.json", "gsc_search_analytics_export.json"];
export const FRESH_FILE_NAMES = [...GSC_TRUTH_NAMES, "index_coverage.json"];

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
    const scoped = cosmetic.has(item.id) && ctx.protectedPaths?.length
      ? { ...ctx, pages: ctx.pages.filter((p) => !ctx.protectedPaths.some((pp) => new URL(p.url).pathname.replace(/\.html$/, "") === pp)) }
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
    for (const r of s.results.filter((x) => x.status === "fail")) {
      const item = byId[r.id];
      // A KNOWN LIMIT is a failure the repo cannot fix at source (the host decides it, or it waits on a
      // named stop), recorded on the site in sites.json with its reason. It stays in the results and
      // the queue, so it is never hidden, but it is not workable: no pass is spent on it.
      const limit = (s.site.known_limits ?? []).find((k) => k.item === r.id) ?? null;
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
        disposition: !s.site.repo ? "no_repo" : limit ? "known_limit" : "fix",
        ...(limit ? { known_limit: limit.why } : {}),
      });
    }
  }
  return briefs;
}

// ─── Plain words for the morning email ───────────────────────────────────────

const short = (s) => s.domain;

/**
 * The lines for the morning email's "The grid repos" section (owner's make-it-calm rules: what is
 * broken, what was fixed, what is being built; plain words, no ids, no commands). `previous` is
 * last week's result so a fix can be named as fixed.
 */
export function morningLines(checklist, siteResults, { previous = null, queued = 0, lastRepair = null, max = 4 } = {}) {
  const byId = Object.fromEntries(checklist.items.map((i) => [i.id, i]));
  const failing = siteResults.map((s) => ({ s, f: s.results.filter((r) => r.status === "fail") }));
  const clean = failing.filter((x) => !x.f.length).length;
  const lines = [];
  lines.push(`We checked all ${siteResults.length} grid repo sites against your Search Readiness Checklist this week. ${clean} pass every check${clean === siteResults.length ? "." : `; ${siteResults.length - clean} have gaps.`}`);
  const worst = failing.filter((x) => x.f.length).sort((a, b) => b.f.length - a.f.length);
  const cov = worst.map((x) => ({ s: x.s, c: x.f.find((r) => r.id === "j9") })).filter((x) => x.c);
  if (cov.length) lines.push(`Missing local pages: ${cov.slice(0, 3).map((x) => `${short(x.s.site)} is missing ${x.c.missing?.length ?? 0}`).join(", ")}${cov.length > 3 ? `, and ${cov.length - 3} more sites` : ""}.`);
  if (worst.length) {
    const top = worst.slice(0, 3).map((x) => `${short(x.s.site)} (${x.f.slice(0, 2).map((r) => (byId[r.id]?.title ?? r.id).split(/[;:,(]/)[0].trim().toLowerCase()).join("; ")})`);
    lines.push(`Most to fix: ${top.join(", ")}.`);
  }
  if (previous) {
    const was = new Set(previous.sites.flatMap((s) => s.results.filter((r) => r.status === "fail").map((r) => `${s.site.domain}|${r.id}`)));
    const now = new Set(siteResults.flatMap((s) => s.results.filter((r) => r.status === "fail").map((r) => `${s.site.domain}|${r.id}`)));
    const fixed = [...was].filter((k) => !now.has(k)).length;
    if (fixed) lines.push(`Fixed since last week: ${fixed} gaps closed.`);
  }
  if (queued || lastRepair) lines.push(repairLine(lastRepair, queued));
  return lines.slice(0, max);
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
  const workable = list.filter((b) => b.repo && b.disposition === "fix" && !isProtected(b));
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
  return { total: list.length, workable: workable.length, protected: prot.length, no_repo: noRepo.length, repos, chunks };
}

/**
 * The Monday email's line (owner's wording, 25 Oct 2026): "Danielle fixes these every Tuesday: N
 * fixed last week, M left". N comes from the last repair run's status file; M is what this
 * morning's audit queued for her. No status file yet says so rather than inventing a zero.
 */
export function repairLine(lastRepair, left) {
  const fixed = lastRepair && Number.isFinite(Number(lastRepair.fixed)) ? Number(lastRepair.fixed) : null;
  return `Danielle fixes these every Tuesday: ${fixed === null ? "no repair run on record yet" : `${fixed} fixed last week`}, ${left} left.`;
}

/** The plain-English line for the morning email: what the queue run did today. No ids, no commands. */
export function queueRunLine({ started, fixed, left, protectedLeft = 0, noRepo = 0 }) {
  const parts = [`Search fixes today: ${fixed} of ${started} fixed and live.`];
  if (left > 0) parts.push(`${left} still to do; Danielle carries on tomorrow morning.`);
  else parts.push("Nothing left that can be fixed automatically.");
  const kept = [];
  if (protectedLeft) kept.push(`${protectedLeft} on the Spry Labs download page, which is only ever changed on its own`);
  if (noRepo) kept.push(`${noRepo} on sites with no code to change`);
  if (kept.length) parts.push(`Left alone on purpose: ${kept.join(", and ")}.`);
  return parts.join(" ");
}
