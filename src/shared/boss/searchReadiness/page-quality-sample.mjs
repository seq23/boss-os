/**
 * QUALITY SAMPLING — are the pages worth quoting, not only present? (owner, 2 Nov 2026: "go").
 *
 * WHY: the Monday audit passed virtualagency-os.com on every page-shape item because it checked that
 * markup EXISTS on twelve evenly spaced pages. This reads the words on a fresh sample of live content
 * pages each Monday (`pickSample`, seeded by the ISO week so it rotates) and scores each against the
 * page-shape items:
 *   b3 one H1, and H2s phrased as questions     b4 a 40-60 word "X is ..." definition under the H1
 *   b5 a visible FAQ when FAQPage schema exists c4 speakable selectors resolve (guide pages carry one)
 *   c6 a named author is visible                d1 the answer sits in the first 100 words
 *   d2 how-to → numbered steps; vs → a table    d3 figures link a source
 *   d4 a date is visible
 * plus TEMPLATE FILLER: the same slot phrase (8 words) more than three times in one body, or two
 * sampled pages more than half identical (5-word shingles).
 *
 * Notes, never blocking: no checklist item fails because of this. Each failing page is a line in the
 * site's weekly quality brief; a site whose sample MOSTLY fails (more than half its pages) is one red
 * line at the top of the Monday email. Only the items whose checklist entry applies to the site's kind
 * are scored (`applies`). Pure; proven by tests/searchOutcomes.test.ts.
 */
import { applies, h1Count, visibleText, wordCount, jsonLd, deepNodes, titleOf, links, isUtility } from "./audit.mjs";

export const QUALITY = Object.freeze({
  SAMPLE: 5,
  ITEMS: Object.freeze(["b3", "b4", "b5", "c4", "c6", "d1", "d2", "d3", "d4"]),
  SLOT_WORDS: 8,
  SLOT_MAX: 3,
  SHINGLE: 5,
  NEAR_DUPLICATE: 0.5,
  /** A page fails when it misses at least half the items scored on it, or is template filler. */
  PAGE_FAIL_SHARE: 0.5,
});

/** A small deterministic hash, so a week's sample is the same on a re-run and different next week. */
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/** The ISO week key "2026-W45" for a time. */
export function isoWeek(t = Date.now()) {
  const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const y = d.getUTCFullYear(), w1 = new Date(Date.UTC(y, 0, 4));
  return `${y}-W${String(1 + Math.round(((d - w1) / 86_400_000 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7)).padStart(2, "0")}`;
}

/** N content URLs from the sitemap (never the home page, a utility page or a file), rotating weekly. */
export function pickSample(urls, { n = QUALITY.SAMPLE, week = isoWeek(), exclude = [] } = {}) {
  const skip = new Set(exclude);
  const pool = [...(urls ?? [])].filter((u) => {
    try { const p = new URL(u).pathname; return p !== "/" && p !== "" && !/\.(xml|pdf|txt|jpg|jpeg|png|webp|svg|zip)$/i.test(p) && !isUtility(u) && !skip.has(new URL(u).pathname.replace(/\.html$/, "")); } catch { return false; }
  });
  return pool.map((u) => [hash(`${week}|${u}`), u]).sort((a, b) => a[0] - b[0]).slice(0, n).map((x) => x[1]);
}

/** The body text: <main> or <article> when there is one, else the page without nav, header and footer. */
export function bodyText(html) {
  const h = String(html ?? "");
  const main = h.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? h.match(/<article\b[\s\S]*?<\/article>/i)?.[0];
  return visibleText(main ?? h.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, " "));
}

// Unicode letters and marks, so "capacitación" stays one word (an ASCII class split it into "capacitaci n").
const wordsOf = (t) => String(t).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}_'’-]*/gu) ?? [];
// A byline keyword in any case ("Author:", "BY", "reviewed by"), followed by a capitalised name.
const hasByline = (vis) => [...vis.matchAll(/\b(?:written by|reviewed by|by|author:?)\s+/gi)]
  .some((m) => /^\p{Lu}[\p{L}\p{M}.'’-]+/u.test(vis.slice(m.index + m[0].length)));
const QUESTION = /\?\s*$|^(what|how|why|when|where|who|which|is|are|can|does|do|should|will|was|were)\b/i;
const ANSWER = /\b(is|are|means|costs?|takes?|requires?|depends|yes|no|can|should|will|must)\b/i;
const FIGURE = /\$\s?\d|\b\d+(?:\.\d+)?\s?%|\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s?(?:days?|weeks?|months?|years?|hours?|minutes?|miles?|mg|kg|lbs?|percent)\b/gi;
const DATE_TEXT = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:updated|published|reviewed|last (?:updated|reviewed))\b[^.]{0,30}\b(?:19|20)\d{2}\b/i;
const SOCIAL = /(^|\.)(facebook|instagram|twitter|x|linkedin|tiktok|youtube|pinterest|gumroad)\.com$/;

/** Each page-shape item on one page: null = does not apply to this page, else { ok, note }. */
export function scorePage(page, { host = "" } = {}) {
  const html = String(page.html ?? "");
  const title = titleOf(html);
  const nodes = jsonLd(html).nodes;
  const body = bodyText(html);
  const out = {};
  const h2s = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => visibleText(m[1]));
  const h1 = h1Count(html);
  out.b3 = h1 !== 1 ? { ok: false, note: `${h1} H1 headings` }
    : h2s.length >= 2 && !h2s.some((h) => QUESTION.test(h)) ? { ok: false, note: `none of its ${h2s.length} H2 headings is a question` }
    : { ok: true };
  const after = html.split(/<\/h1>/i)[1] ?? "";
  const paras = [...after.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => visibleText(m[1]));
  const first = paras.find((x) => wordCount(x) >= 20) ?? paras[0] ?? "";
  const fw = wordCount(first);
  out.b4 = fw >= 40 && fw <= 60 && /\b(is|are)\b/.test(first) ? { ok: true } : { ok: false, note: `opening paragraph is ${fw} words${/\b(is|are)\b/.test(first) ? "" : " and defines nothing"} (needs 40-60, "X is ...")` };
  const faqs = deepNodes(nodes, /^FAQPage$/);
  if (faqs.length) {
    const text = visibleText(html).toLowerCase();
    const qs = deepNodes(faqs, /^Question$/).map((q) => String(q.name ?? "").toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean);
    const hidden = qs.filter((q) => !text.includes(q.slice(0, 60)));
    out.b5 = hidden.length ? { ok: false, note: `${hidden.length} of ${qs.length} FAQ questions in the schema are not visible` } : { ok: true };
  } else out.b5 = null;
  const speak = deepNodes(nodes, /^SpeakableSpecification$/);
  const isGuide = /\/guides?\//.test(page.url ?? "");
  if (speak.length) {
    const broken = speak.flatMap((sp) => [].concat(sp.cssSelector ?? [])).filter((sel) => {
      const m = String(sel).match(/^([.#])([\w-]+)$/); if (!m) return false;
      return !(m[1] === "#" ? new RegExp(`id=["']${m[2]}["']`) : new RegExp(`class=["'][^"']*\\b${m[2]}\\b`)).test(html);
    });
    out.c4 = broken.length ? { ok: false, note: `speakable ${broken.join(", ")} is not on the page` } : { ok: true };
  } else out.c4 = isGuide ? { ok: false, note: "a guide page with no speakable markup" } : null;
  const authors = deepNodes(nodes, /./).flatMap((n) => [].concat(n.author ?? [])).map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean).map(String);
  const vis = visibleText(html);
  const named = authors.some((a) => vis.includes(a)) || hasByline(vis) || /rel=["']author["']/i.test(html);
  out.c6 = named ? { ok: true } : { ok: false, note: "no named author or reviewer is visible" };
  const lead = wordsOf(body.split(/\s+/).slice(0, 100).join(" ")).join(" ");
  const tw = wordsOf(title).filter((w) => w.length > 3 && !/^(what|how|does|your|with|from|that|this|guide|best|near)$/.test(w));
  const overlap = tw.length ? tw.filter((w) => lead.includes(w)).length / tw.length : 1;
  out.d1 = overlap >= 0.5 && ANSWER.test(lead) ? { ok: true } : { ok: false, note: "the first 100 words do not answer the title's question" };
  const t = title.toLowerCase();
  if (/\bhow to\b/.test(t) || /\bvs\.?\b|\bversus\b/.test(t)) {
    const miss = [];
    if (/\bhow to\b/.test(t) && !/<ol\b/i.test(html)) miss.push("a how-to without numbered steps");
    if (/\bvs\.?\b|\bversus\b/.test(t) && !/<table\b/i.test(html)) miss.push("a comparison without a table");
    out.d2 = miss.length ? { ok: false, note: miss.join("; ") } : { ok: true };
  } else out.d2 = wordCount(body) >= 800 && !/<(ol|ul|table)\b/i.test(html) ? { ok: false, note: "a long page with no list or table" } : null;
  const figures = (body.match(FIGURE) ?? []).length;
  if (figures >= 3) {
    const own = String(host).replace(/^www\./, "");
    const ext = links(html, page.url ?? `https://${host}/`).filter((l) => l.host && l.host !== own && !SOCIAL.test(l.host));
    out.d3 = ext.length ? { ok: true } : { ok: false, note: `${figures} figures and no source linked` };
  } else out.d3 = null;
  out.d4 = DATE_TEXT.test(vis) || /<time\b[^>]*datetime=/i.test(html) ? { ok: true } : { ok: false, note: "no visible published or updated date" };
  return out;
}

/** Slot phrases repeated more than SLOT_MAX times in one body: [{ phrase, times }]. */
export function repeatedSlots(text, { n = QUALITY.SLOT_WORDS, max = QUALITY.SLOT_MAX } = {}) {
  const w = wordsOf(text), seen = new Map();
  for (let i = 0; i + n <= w.length; i++) { const k = w.slice(i, i + n).join(" "); seen.set(k, (seen.get(k) ?? 0) + 1); }
  // One repeated sentence makes several overlapping phrases; the most repeated comes first.
  return [...seen].filter(([, c]) => c > max).sort((a, b) => b[1] - a[1]).map(([phrase, times]) => ({ phrase, times }));
}

/** Jaccard similarity of two bodies' 5-word shingles. */
export function similarity(a, b, k = QUALITY.SHINGLE) {
  const sh = (t) => { const w = wordsOf(t), s = new Set(); for (let i = 0; i + k <= w.length; i++) s.add(w.slice(i, i + k).join(" ")); return s; };
  const A = sh(a), B = sh(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * The site's sample, scored. `pages`: [{ url, status, html }]. `checklist` decides which items apply
 * to the site's kind. → { sampled, pages: [{ url, scored, failing[], notes[] }], failingPages, red, line, why? }
 * Zero readable pages is NOT READ with its reason, never a pass.
 */
export function qualitySample({ site, host, pages, checklist }) {
  const byId = Object.fromEntries((checklist?.items ?? []).map((i) => [i.id, i]));
  const items = QUALITY.ITEMS.filter((id) => byId[id] && applies(byId[id], site));
  const ok = (pages ?? []).filter((p) => p.status === 200 && p.html);
  if (!ok.length) {
    const why = (pages ?? []).length ? `none of the ${(pages ?? []).length} sampled pages answered (${[...new Set(pages.map((p) => p.status ?? p.error))].join(", ")})` : "the sitemap offered no content page to sample";
    return { sampled: 0, pages: [], failingPages: 0, red: false, status: "not_read", why, line: `page quality not read: ${why}` };
  }
  const bodies = ok.map((p) => bodyText(p.html));
  const scored = ok.map((p, i) => {
    const s = scorePage(p, { host });
    const notes = [], failing = [];
    let n = 0;
    for (const id of items) { const r = s[id]; if (!r) continue; n++; if (!r.ok) { failing.push(id); notes.push(`${id} ${r.note}`); } }
    const slots = repeatedSlots(bodies[i]);
    const twins = ok.map((q, j) => (j !== i && similarity(bodies[i], bodies[j]) > QUALITY.NEAR_DUPLICATE ? q.url : null)).filter(Boolean);
    const filler = slots.length > 0 || twins.length > 0;
    if (slots.length) notes.push(`template filler: "${slots[0].phrase}" ${slots[0].times} times`);
    if (twins.length) notes.push(`template filler: more than half identical to ${twins.slice(0, 2).join(", ")}`);
    if (filler) failing.push("filler");
    const failed = filler || (n > 0 && (failing.length) / n >= QUALITY.PAGE_FAIL_SHARE);
    return { url: p.url, scored: n, failing, notes, failed };
  });
  const failingPages = scored.filter((p) => p.failed).length;
  const red = failingPages > ok.length / 2;
  const common = Object.entries(scored.flatMap((p) => p.failing).reduce((m, id) => ((m[id] = (m[id] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => WORDS[id] ?? id);
  const line = red
    ? `${failingPages} of ${ok.length} pages sampled this week fall short of the page shape (most often: ${common.join(", ")}). Danielle is fixing the template.`
    : `${ok.length - failingPages} of ${ok.length} sampled pages meet the page shape.`;
  return { sampled: ok.length, items, pages: scored, failingPages, red, status: red ? "red" : "noted", line };
}

const WORDS = {
  b3: "question headings", b4: "a short definition at the top", b5: "a visible FAQ", c4: "read-aloud markup",
  c6: "a named author", d1: "the answer up front", d2: "steps and tables", d3: "sources for figures",
  d4: "a visible date", filler: "repeated template text",
};
