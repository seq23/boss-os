/**
 * THE SERIES BOOKS: the pure half of the build for every Kindle line (KDP strategy, spry brain
 * 8 Nov 2026: short real books, one pen name and one Amazon series per line, a tracked link to each
 * book's companion page, KDP Select, paperbacks for the logs/binders/planners, AI disclosure always).
 *
 * A line's spec is `scripts/ops/kdp-books/<line>.json` with `series_books`; each book's words are a
 * hand-written manuscript in `docs/kdp/books/<slug>.md`. Nothing here touches the network or the
 * disk, so the tests can hold it: the manuscript format, the front and back matter the engine adds
 * (title page, copyright, AI note, disclaimer, the companion link), the claim gate, the listing rules
 * KDP enforces, the covers (Kindle front, paperback full wrap with spine) and the print interior.
 * `scripts/ops/kdp-build.mjs` does the reading, the rendering and the packing.
 *
 * The existing KeepMyProof drafter (`books` in keepmyproof.json, lib.mjs, kdp-kmp-draft.mjs) and the
 * live Co-Parenting Log it built are untouched by this file.
 */
import { esc, claimProblems, repeatedTerms, slug as slugOf } from "./lib.mjs";

export const UTM = Object.freeze({ utm_source: "kindle", utm_medium: "book" });
export const PUBLISHER = "Spry Labs";
/** A short but real book (KDP strategy: 20–40 pages, never a thin ad book). An early-reader line sets its own `min_words`. */
export const MIN_WORDS = 2000;
/** KDP's own limits (help pages, 8 Nov 2026). */
export const KDP_LIMITS = Object.freeze({ unpublishedDrafts: 10, keywords: 7, keywordChars: 50, categories: 3, descriptionChars: 4000, titleSubtitleChars: 200, paperbackMinPages: 24 });

/** The link printed in the book: the fixed companion page, tagged with the book's slug. Pure. */
export function companionLink(book) {
  if (!book.companion_url) return null;
  const u = new URL(book.companion_url);
  for (const [k, v] of Object.entries(UTM)) u.searchParams.set(k, v);
  u.searchParams.set("utm_campaign", book.slug);
  return u.toString();
}
/** The link as printed for a reader to type: no scheme, no tracking. Pure. */
export const shortLink = (url) => String(url).replace(/^https?:\/\//, "").replace(/\?.*$/, "").replace(/\/$/, "");

/**
 * A line with no companion page (`companion: false`): the book prints no site link and the gate
 * asks for none. Ambitious Grads (owner, 9 Nov 2026): "just opportunistically post them to amazon
 * publishing no extra landing pages". Pure.
 */
export const hasCompanion = (line, book) => (book.companion ?? line.companion) !== false;

/** The author of a book: its own pen name, else the line's. Pure. */
export const authorOf = (line, book) => book.author ?? line.author;

/* ── The manuscript ─────────────────────────────────────────────────────────────────────────── */

/**
 * The manuscript format (docs/kdp/books/<slug>.md): "# " starts a chapter, "## " a section,
 * paragraphs, "- " and "1. " lists, "- [ ] " checklist lines, and a markdown table is a fill-in log
 * (header row; an optional `<!-- rows: N -->` line before it says how many blank rows to print).
 * `{{companion}}` is the book's tracked companion link. Returns `[{ title, blocks }]`. Pure.
 */
export function parseManuscript(md) {
  const lines = String(md ?? "").replace(/\r/g, "").split("\n");
  const chapters = [];
  let cur = null;
  let para = [];
  let rowsNext = null;
  const flush = () => { if (para.length && cur) cur.blocks.push({ p: para.join(" ") }); para = []; };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    const rows = /^<!--\s*rows:\s*(\d+)\s*-->$/.exec(line);
    if (rows) { flush(); rowsNext = Number(rows[1]); continue; }
    if (/^<!--.*-->$/.test(line)) continue;
    if (/^#\s+/.test(line)) { flush(); cur = { title: line.replace(/^#\s+/, ""), blocks: [] }; chapters.push(cur); continue; }
    if (!cur) { if (line) { cur = { title: "", blocks: [] }; chapters.push(cur); } else continue; }
    if (!line) { flush(); continue; }
    if (/^#{2,}\s+/.test(line)) { flush(); cur.blocks.push({ h: line.replace(/^#+\s+/, "") }); continue; }
    if (/^\|.*\|$/.test(line)) {
      flush();
      const head = line.slice(1, -1).split("|").map((c) => c.trim());
      const body = [];
      while (i + 1 < lines.length && /^\|.*\|$/.test(lines[i + 1].trim())) {
        i += 1;
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
        body.push(cells);
      }
      cur.blocks.push({ table: { head, body: body.filter((r) => r.some(Boolean)), rows: rowsNext ?? Math.max(8, body.length) } });
      rowsNext = null;
      continue;
    }
    if (/^[-*]\s+\[[ xX]?\]\s+/.test(line)) {
      flush();
      const items = [line];
      while (i + 1 < lines.length && /^[-*]\s+\[[ xX]?\]\s+/.test(lines[i + 1].trim())) items.push(lines[(i += 1)].trim());
      cur.blocks.push({ check: items.map((l) => l.replace(/^[-*]\s+\[[ xX]?\]\s+/, "")) });
      continue;
    }
    if (/^[-*•]\s+/.test(line)) {
      flush();
      const items = [line];
      while (i + 1 < lines.length && /^[-*•]\s+(?!\[)/.test(lines[i + 1].trim())) items.push(lines[(i += 1)].trim());
      cur.blocks.push({ ul: items.map((l) => l.replace(/^[-*•]\s+/, "")) });
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      flush();
      const items = [line];
      while (i + 1 < lines.length && /^\d+[.)]\s+/.test(lines[i + 1].trim())) items.push(lines[(i += 1)].trim());
      cur.blocks.push({ ol: items.map((l) => l.replace(/^\d+[.)]\s+/, "")) });
      continue;
    }
    para.push(line);
  }
  flush();
  return chapters.filter((c) => c.title || c.blocks.length);
}

/** All the words of a manuscript, for the claim gate and the length floor. Pure. */
export function manuscriptText(chapters) {
  return chapters.map((c) => [c.title, ...c.blocks.map((b) => b.h ?? b.p ?? (b.ul ?? b.ol ?? b.check ?? (b.table ? [...b.table.head, ...b.table.body.flat()] : [])).join("\n"))].join("\n\n")).join("\n\n");
}
export const wordCount = (text) => (String(text).match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? []).length;

/** Inline markup: **bold**, *italic*, [text](url), {{companion}}; everything else escaped. Pure. */
export function inline(s, { companion } = {}) {
  let t = esc(s);
  t = t.replace(/\{\{companion\}\}/g, companion ? `<a href="${esc(companion)}">${esc(shortLink(companion))}</a>` : "");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, txt, url) => `<a href="${url}">${txt}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
  return t;
}

function blockHtml(b, ctx) {
  const x = (s) => inline(s, ctx);
  if (b.h) return `<h3>${x(b.h)}</h3>`;
  if (b.p) return `<p>${x(b.p)}</p>`;
  if (b.ul) return `<ul>${b.ul.map((i) => `<li>${x(i)}</li>`).join("")}</ul>`;
  if (b.ol) return `<ol>${b.ol.map((i) => `<li>${x(i)}</li>`).join("")}</ol>`;
  if (b.check) return `<ul class="check">${b.check.map((i) => `<li><span class="box">☐</span> ${x(i)}</li>`).join("")}</ul>`;
  if (b.table) {
    const { head, body, rows } = b.table;
    const filled = body.map((r) => `<tr>${head.map((_, j) => `<td>${x(r[j] ?? "")}</td>`).join("")}</tr>`).join("");
    const blank = Array.from({ length: Math.max(0, rows - body.length) }, () => `<tr>${head.map(() => "<td>&#160;</td>").join("")}</tr>`).join("");
    return `<table class="log"><thead><tr>${head.map((h) => `<th>${x(h)}</th>`).join("")}</tr></thead><tbody>${filled}${blank}</tbody></table>`;
  }
  return "";
}

/* ── Front and back matter the engine adds ──────────────────────────────────────────────────── */

export const DISCLAIMERS = Object.freeze({
  legal: [
    "This book is educational only. It is not legal advice, and reading it does not create a lawyer–client relationship. The author and Spry Labs are not a law firm.",
    "Nothing in this book predicts what a court, agency or employer will decide. A record you keep is your own record; it does not prove anything on its own.",
    "Rules differ by state and change over time. Check the official source, or ask a lawyer or the agency itself, before you rely on anything here.",
  ],
  medical: [
    "This book is educational only. It is not medical or legal advice, and it does not replace a doctor, a licensed professional or the agency that decides your case.",
    "Rules, forms and fees change. Check the official agency page before you rely on anything here.",
  ],
  education: [
    "This book is for general information and practice. It is not medical, psychological or professional advice; if something in your life feels unsafe or unmanageable, talk to a qualified professional.",
  ],
  careers: [
    "This book is general career information. Pay, recruiting dates, company names and tax rules change; check a current source before you rely on a figure, and talk to a tax professional before you exercise stock options.",
  ],
  none: [],
});

/** The AI note printed in every book (KDP strategy: AI disclosure always). Pure. */
export function aiNote(line) {
  const d = line.ai_disclosure ?? {};
  if (d.note) return d.note;
  if (d.text === "none") return "";
  return d.text === "some"
    ? "Parts of this book were drafted with AI writing tools and then reviewed and edited by the author."
    : "This book was written with the help of AI writing tools and reviewed by the author.";
}

/**
 * Every section of a series book in reading order, `{ id, title, html, toc? }`. One source for the
 * EPUB, the print interior and the preview she approves, so what she approves is what is uploaded.
 */
export function seriesSections(line, book, chapters, { year, siblings = [] } = {}) {
  const author = authorOf(line, book);
  const companion = hasCompanion(line, book) ? companionLink(book) : null;
  const ctx = { companion };
  const series = line.series?.name ? `${line.series.name}, Book ${book.series_number ?? 1}` : null;
  const disclaimer = (DISCLAIMERS[book.disclaimer ?? line.disclaimer ?? "none"] ?? []).map((d) => `<p>${esc(d)}</p>`).join("");
  const out = [];
  out.push({ id: "title", title: "Title page", toc: false, html: `<div class="titlepage"><h1>${esc(book.title)}</h1>${book.subtitle ? `<p class="subtitle">${esc(book.subtitle)}</p>` : ""}${series ? `<p class="series">${esc(series)}</p>` : ""}<p class="author">${esc(author)}</p><p class="publisher">${PUBLISHER}</p></div>` });
  out.push({ id: "copyright", title: "Copyright", toc: false, html: `<h2>Copyright</h2><p>Copyright © ${year} ${esc(author)}. Published by ${PUBLISHER}. All rights reserved, except that you may copy the checklists, logs and worksheets in this book for your own use.</p>${disclaimer}${aiNote(line) ? `<p>${esc(aiNote(line))}</p>` : ""}` });
  if (companion) out.push({ id: "companion-front", title: "Free printables for this book", html: `<h2>Free printables for this book</h2><p>The checklists and pages in this book are also free to print, with updates, at <a href="${esc(companion)}">${esc(shortLink(companion))}</a>.</p>` });
  chapters.forEach((c, i) => out.push({ id: `ch${i + 1}`, title: c.title || `Part ${i + 1}`, html: `${c.title ? `<h2>${inline(c.title, ctx)}</h2>` : ""}${c.blocks.map((b) => blockHtml(b, ctx)).join("")}` }));
  if (companion) out.push({ id: "next", title: "Your next step", html: `<h2>Your next step</h2><p>Everything in this book, ready to print or fill in on screen, is at <a href="${esc(companion)}">${esc(shortLink(companion))}</a>.</p>${siblings.length ? `<p>Also in ${esc(line.series?.name ?? "this series")}:</p><ul>${siblings.map((s) => `<li>${esc(s.title)}</li>`).join("")}</ul>` : ""}` });
  else if (siblings.length) out.push({ id: "next", title: `Also in ${line.series?.name ?? "this series"}`, html: `<h2>Also in ${esc(line.series?.name ?? "this series")}</h2><ul>${siblings.map((sb) => `<li>${esc(sb.title)}${sb.subtitle ? `: ${esc(sb.subtitle)}` : ""}</li>`).join("")}</ul>` });
  out.push({ id: "author", title: "About the author", html: `<h2>About the author</h2><p>${esc(line.about_author ?? `${author} writes short, practical books, published by ${PUBLISHER}.`)}</p><p>If this book helped, a short review on Amazon helps the next reader find it.</p>` });
  return out;
}

/* ── The gate: what stops a book before she ever sees it ────────────────────────────────────── */

/**
 * Everything wrong with a series book, from KDP's own rules and the KDP strategy. An empty array
 * means it may be shown to her. Pure.
 */
export function seriesProblems(line, book, chapters) {
  const p = [];
  const author = authorOf(line, book);
  const linked = hasCompanion(line, book);
  for (const f of ["slug", "title", "subtitle", "description", ...(linked ? ["companion_url"] : []), "manuscript"]) if (!book[f]) p.push(`no ${f}`);
  if (!author) p.push("no author (pen name)");
  // Her own byline only on her own writing (`own_name`, a line of books she wrote herself); every other line keeps a pen name.
  if (author && !(book.own_name ?? line.own_name) && /\btaylor\b|\bsequoia\b/i.test(author)) p.push("the pen name is related to the owner");
  if (author && /^(dr|prof|attorney|esq)\.?\s|\b(phd|md|jd|esq|lcsw|lpc)\b/i.test(author)) p.push("the pen name carries a credential");
  if (`${book.title}${book.subtitle ?? ""}`.length > KDP_LIMITS.titleSubtitleChars) p.push("title + subtitle over 200 characters");
  const rep = repeatedTerms(book.title ?? "", book.subtitle ?? "");
  if (rep.length) p.push(`title and subtitle repeat "${rep.join(", ")}" (Amazon's repetitive-terms flag)`);
  if (!Array.isArray(book.keywords) || book.keywords.length !== KDP_LIMITS.keywords) p.push(`${book.keywords?.length ?? 0} keywords (KDP takes 7)`);
  for (const k of book.keywords ?? []) if (k.length > KDP_LIMITS.keywordChars) p.push(`keyword over 50 characters: ${k}`);
  if (new Set((book.keywords ?? []).map((k) => k.toLowerCase())).size !== (book.keywords ?? []).length) p.push("a keyword repeats");
  if (!Array.isArray(book.categories) || book.categories.length < 1 || book.categories.length > KDP_LIMITS.categories) p.push("categories: 1 to 3 (KDP)");
  if (!(book.price_usd >= 0.99 && book.price_usd <= 2.99)) p.push("Kindle price outside $0.99–$2.99 (KDP strategy)");
  if (book.paperback && !(book.paperback.price_usd >= 5.99 && book.paperback.price_usd <= 14.99)) p.push("paperback price outside $5.99–$14.99");
  if (book.paperback && !TRIMS[book.paperback.trim]) p.push(`paperback trim "${book.paperback.trim}" is not one of ${Object.keys(TRIMS).join(", ")}`);
  if (!book.description || book.description.length > KDP_LIMITS.descriptionChars) p.push("description missing or over 4,000 characters");
  if (/<[a-z]/i.test(book.description ?? "")) p.push("description carries HTML (plain paragraphs only)");
  if (linked) try { const u = new URL(book.companion_url); if (!/\/amazon\/[a-z0-9-]+\/$/.test(u.pathname) || u.search) p.push("companion_url is not a bare /amazon/<slug>/ page"); } catch { p.push("companion_url is not a URL"); }
  if (linked && book.companion_url && !String(book.companion_url).includes(`/amazon/${book.slug}/`)) p.push("companion_url does not end in the book's own slug");
  const text = manuscriptText(chapters);
  const words = wordCount(text);
  const floor = book.min_words ?? line.min_words ?? MIN_WORDS;
  if (words < floor) p.push(`${words} words: under the ${floor}-word floor for a short but real book (20–40 pages)`);
  if (linked && !/\{\{companion\}\}/.test(JSON.stringify(chapters))) p.push("the manuscript never prints {{companion}}");
  if (!linked && /\{\{companion\}\}/.test(JSON.stringify(chapters))) p.push("the manuscript prints {{companion}} but this line has no companion page");
  // A placeholder left for her words (e.g. "[HER LINE]") never reaches Amazon.
  const placeholder = /\[(?:HER|HIS|TODO|TBD|PLACEHOLDER|INSERT)[A-Z ]*\]|\bTODO\b|\bTBD\b/.exec(text);
  if (placeholder) p.push(`the manuscript still holds the placeholder "${placeholder[0]}"`);
  if (/<[a-z][^>]*>/i.test(text)) p.push("raw HTML in the manuscript");
  const gated = book.claim_gate ?? line.claim_gate ?? false;
  if (gated) for (const x of claimProblems(`${text}\n${book.title} ${book.subtitle} ${book.description} ${(book.keywords ?? []).join(" ")}`)) p.push(`claim gate: ${x}`);
  return p;
}

/* ── The listing, as kdp-new-title.mjs enters it ────────────────────────────────────────────── */

/** Plain paragraphs (and "- " lines) → the HTML KDP's description box takes. Pure. */
export function descriptionHtml(text) {
  return String(text).trim().split(/\n{2,}/).map((chunk) => {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length && lines.every((l) => /^[-•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^[-•]\s+/, ""))}</li>`).join("")}</ul>`;
    return `<p>${inline(lines.join(" ")).replace(/<a [^>]*>|<\/a>/g, "")}</p>`;
  }).join("");
}

/** The KDP AI-disclosure answers for a series book, from its line's `ai_disclosure`. Pure. */
export function seriesAi(line) {
  const d = line.ai_disclosure ?? {};
  const texts = d.text === "none" ? "None" : d.text === "some_minimal" ? "Some sections, with minimal or no editing" : d.text === "some" ? "Some sections, with extensive editing" : "Entire work, with extensive editing";
  const images = d.images === "ai_generated" ? "One or a few AI-generated images, with minimal or no editing" : "None";
  return { text_detail: texts, images_detail: images, tool_names: d.tool_names ?? "Anthropic Claude" };
}

/** listing.json for one book: every field kdp-new-title.mjs types into KDP. Pure. */
export function seriesListing(line, book, { built_on, pages = null } = {}) {
  return {
    line: line.line, slug: book.slug, title: book.title, subtitle: book.subtitle ?? "",
    author: authorOf(line, book), publisher: PUBLISHER,
    series: line.series?.name ? { name: line.series.name, number: book.series_number ?? 1, description: line.series.description ?? "" } : null,
    description: book.description, description_html: descriptionHtml(book.description),
    keywords: book.keywords, categories: book.categories,
    price_usd: book.price_usd, royalty: book.price_usd >= 2.99 ? 70 : 35, kdp_select: true,
    paperback: book.paperback ? { ...book.paperback, pages } : null,
    companion_url: hasCompanion(line, book) ? book.companion_url : null, companion_link: hasCompanion(line, book) ? companionLink(book) : null,
    ai_disclosure: seriesAi(line), models: [], built_on,
  };
}

/* ── Paperback geometry (KDP print specs: white paper, bleed on the cover) ──────────────────── */

export const TRIMS = Object.freeze({ "6x9": { w: 6, h: 9 }, "8.5x11": { w: 8.5, h: 11 } });
export const PAPER_IN_PER_PAGE = 0.002252; // white paper, black ink
export const BLEED_IN = 0.125;
/** Spine width in inches for a page count (KDP: page count × 0.002252 for white paper). Pure. */
export const spineInches = (pages) => Math.round(pages * PAPER_IN_PER_PAGE * 10000) / 10000;
/** KDP prints spine text only from 79 pages. Pure. */
export const spineHasText = (pages) => pages >= 79;
/** The full-wrap cover size in inches: back + spine + front, with bleed all round. Pure. */
export function wrapSize(trim, pages) {
  const t = TRIMS[trim];
  if (!t) throw new Error(`unknown trim ${trim}`);
  const spine = spineInches(pages);
  return { width: Math.round((BLEED_IN * 2 + t.w * 2 + spine) * 10000) / 10000, height: t.h + BLEED_IN * 2, spine, trim: t };
}
/** Inside margin (gutter) KDP asks for by page count. Pure. */
export const gutterInches = (pages) => (pages <= 150 ? 0.375 : pages <= 300 ? 0.5 : pages <= 500 ? 0.625 : 0.75);
/** Pages in a PDF's bytes (counts page objects, not the page tree). Pure. */
export const pdfPages = (buf) => (Buffer.from(buf).toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

/* ── Covers ─────────────────────────────────────────────────────────────────────────────────── */

const DEFAULT_COLORS = { bg: "#F4F1EA", fg: "#1D2327", accent: "#0B6E4F" };
const titleSize = (title, base) => {
  const longest = Math.max(...String(title).split(/\s+/).map((w) => w.length));
  const len = String(title).length;
  return Math.round(base * (longest > 13 ? 0.68 : longest > 10 ? 0.82 : 1) * (len > 40 ? 0.8 : len > 26 ? 0.9 : 1));
};

/**
 * The front cover's inner HTML at a given pixel width (the height is width × 1.6): the title huge
 * (readable at Amazon's ~160 px thumbnail), one promise, the series line, the pen name. `photo` is a
 * data URL or null. Pure.
 */
export function frontHtml(line, book, { width = 1600, photo = null } = {}) {
  const c = { ...DEFAULT_COLORS, ...(book.cover ?? {}) };
  const u = width / 1600;
  const author = authorOf(line, book);
  const series = line.series?.name ? `${line.series.name} · Book ${book.series_number ?? 1}` : "";
  const title = esc(book.title).replace(/-/g, "‑");
  return `<div class="front" style="width:${width}px;height:${Math.round(width * 1.6)}px;background:${c.bg};color:${c.fg};position:relative;overflow:hidden;font-family:'Noto Sans',system-ui,sans-serif">
${photo ? `<div style="position:absolute;left:0;right:0;top:0;height:${Math.round(1010 * u)}px;background:url(${photo}) center/cover"></div><div style="position:absolute;left:0;right:0;top:${Math.round(760 * u)}px;height:${Math.round(260 * u)}px;background:linear-gradient(to bottom,transparent,${c.bg})"></div>` : `<div style="position:absolute;left:0;right:0;top:0;height:${Math.round(36 * u)}px;background:${c.accent}"></div>`}
<div style="position:absolute;left:${Math.round(120 * u)}px;right:${Math.round(110 * u)}px;top:${Math.round((photo ? 1040 : 260) * u)}px;bottom:${Math.round(330 * u)}px;display:flex;flex-direction:column">
${book.cover?.kicker ? `<div style="font-family:'Noto Sans Mono',monospace;font-size:${Math.round(48 * u)}px;letter-spacing:${Math.round(6 * u)}px;text-transform:uppercase;color:${c.accent};font-weight:600">${esc(book.cover.kicker)}</div>` : ""}
<h1 style="margin:${Math.round(36 * u)}px 0 0;font-family:'Noto Serif',Georgia,serif;font-weight:800;font-size:${Math.round(titleSize(book.title, photo ? 190 : 230) * u)}px;line-height:1.0;letter-spacing:${Math.round(-3 * u)}px">${title}</h1>
${book.cover?.promise ? `<div style="margin-top:auto;font-size:${Math.round(70 * u)}px;line-height:1.22;font-weight:600;max-width:${Math.round(1300 * u)}px">${esc(book.cover.promise)}</div>` : ""}
</div>
<div style="position:absolute;left:0;right:0;bottom:0;height:${Math.round(280 * u)}px;background:${c.accent};color:${c.bg};display:flex;align-items:center;justify-content:space-between;padding:0 ${Math.round(120 * u)}px">
<span style="font-family:'Noto Serif',Georgia,serif;font-weight:700;font-size:${Math.round(84 * u)}px">${esc(author)}</span>
<span style="font-size:${Math.round(38 * u)}px;opacity:.92;text-align:right;max-width:${Math.round(620 * u)}px;line-height:1.3">${esc(series)}</span>
</div></div>`;
}

const FONTS_LINK = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600&family=Noto+Sans+Mono:wght@600&family=Noto+Serif:wght@700;800&display=swap">`;
const pageShell = (body, w, h) => `<!doctype html><html><head><meta charset="utf-8">${FONTS_LINK}<style>*{box-sizing:border-box;margin:0;padding:0}html,body{width:${w}px;height:${h}px;overflow:hidden}</style></head><body>${body}</body></html>`;

/** The Kindle cover page at 1600×2560 (KDP's ideal). Pure. */
export const kindleCoverHtml = (line, book, { photo = null } = {}) => pageShell(frontHtml(line, book, { width: 1600, photo }), 1600, 2560);

/**
 * The paperback full-wrap cover at `dpi`: back (blurb, the companion line, a clear box where KDP
 * prints the barcode), spine (title and pen name only from 79 pages), front. Pure.
 */
export function wrapCoverHtml(line, book, { pages, dpi = 300, photo = null, frontImage = null }) {
  const { width, height, spine, trim } = wrapSize(book.paperback.trim, pages);
  const px = (inches) => Math.round(inches * dpi);
  const c = { ...DEFAULT_COLORS, ...(book.cover ?? {}) };
  const frontW = px(trim.w + BLEED_IN);
  // The designed Kindle front (when there is one) fills the front panel, cropped to the trim's shape.
  const front = frontImage
    ? `<div style="width:${frontW}px;height:${px(height)}px;background:url(${frontImage}) center/cover"></div>`
    : frontHtml(line, book, { width: frontW, photo }).replace(/height:\d+px;background/, `height:${px(height)}px;background`);
  const blurb = String(book.description).split(/\n{2,}/).slice(0, 2).map((x) => `<p style="margin:0 0 ${px(0.15)}px">${inline(x.replace(/^[-•]\s+/gm, ""))}</p>`).join("");
  const back = `<div style="position:absolute;left:0;top:0;width:${px(trim.w + BLEED_IN)}px;height:${px(height)}px;background:${c.accent};color:${c.bg};font-family:'Noto Sans',system-ui,sans-serif;padding:${px(0.75)}px ${px(0.6)}px ${px(0.75)}px ${px(0.6 + BLEED_IN)}px">
<div style="font-family:'Noto Serif',Georgia,serif;font-weight:800;font-size:${px(0.34)}px;line-height:1.1;margin-bottom:${px(0.3)}px">${esc(book.title)}</div>
<div style="font-size:${px(0.15)}px;line-height:1.45;max-width:${px(trim.w - 1.4)}px">${blurb}</div>
${book.companion_url && hasCompanion(line, book) ? `<div style="font-size:${px(0.14)}px;margin-top:${px(0.25)}px;font-weight:600">Free printables: ${esc(shortLink(book.companion_url))}</div>` : ""}
<div style="position:absolute;right:${px(0.25)}px;bottom:${px(0.25 + BLEED_IN)}px;width:${px(2)}px;height:${px(1.2)}px;background:#FFFFFF"></div>
<div style="position:absolute;left:${px(0.6 + BLEED_IN)}px;bottom:${px(0.45 + BLEED_IN)}px;font-size:${px(0.13)}px;opacity:.9">${PUBLISHER}</div></div>`;
  const spineHtml = `<div style="position:absolute;left:${px(trim.w + BLEED_IN)}px;top:0;width:${Math.max(1, px(spine))}px;height:${px(height)}px;background:${c.fg};color:${c.bg};display:flex;align-items:center;justify-content:center;overflow:hidden">${spineHasText(pages) ? `<div style="transform:rotate(90deg);white-space:nowrap;font-family:'Noto Serif',Georgia,serif;font-weight:700;font-size:${Math.min(px(spine) * 0.55, px(0.22))}px">${esc(book.title)} · ${esc(authorOf(line, book))}</div>` : ""}</div>`;
  const frontAt = `<div style="position:absolute;left:${px(trim.w + BLEED_IN + spine)}px;top:0;width:${frontW}px;height:${px(height)}px;overflow:hidden">${front}</div>`;
  return { html: pageShell(`${back}${spineHtml}${frontAt}`, px(width), px(height)), width, height, spine };
}

/* ── The print interior ─────────────────────────────────────────────────────────────────────── */

export const PRINT_CSS = (trim, pages = 40) => `@page{size:${TRIMS[trim].w}in ${TRIMS[trim].h}in;margin:0.75in 0.6in 0.75in ${gutterInches(pages)}in}
@page :left{margin:0.75in ${gutterInches(pages)}in 0.75in 0.6in}
body{font-family:'Noto Serif',Georgia,serif;font-size:${trim === "8.5x11" ? 12 : 11}pt;line-height:1.45;color:#000}
h1,h2,h3{font-weight:700;line-height:1.2;break-after:avoid}h2{font-size:1.6em;break-before:page;margin:0 0 .6em}h3{font-size:1.15em;margin:1.1em 0 .4em}
p{margin:0 0 .6em;orphans:2;widows:2}a{color:#000;text-decoration:none}
.titlepage{text-align:center;padding-top:30%}.titlepage h1{font-size:2.4em}.subtitle{font-style:italic;font-size:1.2em}.series,.publisher{font-size:.95em}.author{margin-top:2em;font-weight:700;font-size:1.2em}
section{break-before:page}section:first-child{break-before:auto}
.check{list-style:none;padding-left:0}.check li{margin:.45em 0}.box{font-size:1.2em}
table.log{width:100%;border-collapse:collapse;margin:.6em 0;font-family:'Noto Sans',system-ui,sans-serif;font-size:.85em}
table.log th,table.log td{border:0.75pt solid #555;padding:.35em .4em;text-align:left;vertical-align:top}table.log td{height:2.1em}
table.log thead{display:table-header-group}table.log tr{break-inside:avoid}
.notes{break-before:page}.notes .rule{border-bottom:0.5pt solid #888;height:2.1em}`;

/** The print interior as one HTML document; `notesPages` lined pages pad it to KDP's 24-page floor. Pure. */
export function interiorHtml(secs, trim, { pages = 40, notesPages = 0 } = {}) {
  const notes = Array.from({ length: notesPages }, () => `<div class="notes"><h3>Notes</h3>${Array.from({ length: trim === "8.5x11" ? 22 : 17 }, () => '<div class="rule"></div>').join("")}</div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS_LINK}<style>${PRINT_CSS(trim, pages)}</style></head><body>${secs.map((s) => `<section id="${s.id}">${s.html}</section>`).join("")}${notes}</body></html>`;
}

/** The EPUB's stylesheet for series books: the KMP one plus the fill-in tables. */
export const SERIES_EPUB_CSS = `body{font-family:serif;line-height:1.5;margin:0 4%}h1,h2,h3{font-family:serif;font-weight:bold;line-height:1.2}h2{margin-top:1.2em;page-break-before:always}h3{margin-top:1.1em}
.titlepage{text-align:center;margin-top:20%}.titlepage h1{font-size:2em}.subtitle{font-style:italic}.series{font-size:.95em}.author{margin-top:2em;font-weight:bold}
.check{list-style:none;padding-left:0}.check li{margin:.5em 0}.box{font-size:1.2em}
table.log{width:100%;border-collapse:collapse;margin:.6em 0;font-size:.9em}table.log th,table.log td{border:1px solid #888;padding:.3em;text-align:left;vertical-align:top}table.log td{height:1.8em}`;

export { slugOf };
