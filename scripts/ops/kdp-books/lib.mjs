/**
 * KEEPMYPROOF KINDLE BOOKS: the pure half of the drafting pipeline (owner, 7 Nov 2026: a front-door
 * Kindle book per KeepMyProof folder, divorce first, drafts only, S. L. Taylor, publisher Spry Labs,
 * AI disclosure on; nothing reaches KDP without her yes in the Inbox).
 *
 * Everything here is pure (no network, no disk) so the tests can hold it: which facts go in, the
 * claim gate every model-written word passes, the listing rules KDP enforces, and the EPUB / preview
 * markup. kdp-kmp-draft.mjs does the reading, the writing (free models first) and the packing.
 *
 * WHY THE FACTS ARE ONLY QUOTE-VERIFIED ONES. keepmyproof's own gate (site/lib/gate.mjs) stores, for
 * every fact whose quote was found on its official source, a key in site/data/verified/<folder>.json.
 * The book prints a fact only when that key is there, with its source and the date it was checked
 * (risk brain R-PRF-03: no invented statistics; every fact cites a source).
 */
import { createHash } from "node:crypto";

export const STATE_NAMES = Object.freeze({
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
});

/* ── The fact key, exactly as keepmyproof/site/lib/gate.mjs computes it ───────────────────────── */
const norm = (s) => String(s).normalize("NFKC").replace(/[‘’‚′`´]/g, "'").replace(/[“”„″]/g, '"').replace(/[‐-―−]/g, "-").replace(/­/g, "").replace(/\s+/g, " ").trim().toLowerCase();
export const factKey = (f) => createHash("sha256").update(`${String(f.source_url).trim()}\n${norm(f.quote)}`).digest("hex").slice(0, 20);

/**
 * The facts section: per state (A–Z by name), up to `max` verified facts from each file in the
 * book's order, plus the deduplicated official sources. A state with no verified fact is left out.
 * `files` = { "<file>": parsed JSON }, `verified` = parsed site/data/verified/<folder>.json.
 */
export function selectFacts(book, files, verified) {
  const ok = verified?.facts ?? {};
  const byState = {};
  for (const spec of book.facts) {
    const data = files[spec.file];
    for (const [code, entry] of Object.entries(data?.states ?? {})) {
      const picked = (entry.facts ?? []).filter((f) => ok[factKey(f)]).slice(0, spec.max);
      if (!picked.length) continue;
      (byState[code] ??= []).push({ label: spec.label, facts: picked.map((f) => ({ claim: f.claim_en, source_name: f.source_name, source_url: f.source_url, checked: ok[factKey(f)] || f.checked })) });
    }
  }
  return Object.keys(byState)
    .filter((c) => STATE_NAMES[c])
    .sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b]))
    .map((code) => ({ code, name: STATE_NAMES[code], groups: byState[code] }));
}
export const factCount = (states) => states.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.facts.length, 0), 0);

/* ── The claim gate: every model-written word passes it, and the whole book is read again ─────── */
/**
 * keepmyproof's banned claim words (site/lib/gate.mjs BANNED, English; "best interest(s)" is the
 * custody standard and allowed) plus the advice and evidence words a Kindle buyer would read as a
 * promise (risk brain R-ADV-01/02, the KeepMyProof brand note: no legal advice or outcomes, the save
 * date is not proof). Model prose may not carry numbers or links: every number in the book comes
 * from a sourced fact, every link is ours.
 */
export const BANNED = Object.freeze([
  [/\bcourt[\s-]*ready\b/i, "court-ready"], [/\badmissib/i, "admissible"], [/\bproves?\b|\bproof that\b|\bprove (?:it|that|your)\b/i, "proves"],
  [/\bbest\b(?!\s+interests?\b)/i, "best"], [/\bwin(?:s|ning)?\s+(?:your|the|a)\s+(?:case|custody)\b/i, "win your case"], [/\bguarantee/i, "guarantee"],
  [/\bmilitary[\s-]grade\b|\bbank[\s-]level\b|\b100% secure\b|\bunhackable\b/i, "security claim"], [/\bblack[\s-]owned\b/i, "black-owned"],
  [/\bverified\b/i, "verified"], [/\blegal(?:ly)? (?:binding|required|requires)\b/i, "legal requirement"],
  [/\b(?:the |a )?(?:judge|court)s? (?:will|always|usually|must|won't|never|tends?|likes?|wants?|looks? (?:for|at))\b/i, "prediction about courts"],
  [/\b(?:studies|research|experts?|statistics) (?:show|say|suggest|find|agree)/i, "unsourced study"],
  [/\b(?:the law|state law|federal law) (?:says|requires|lets|allows)\b/i, "statement of law"],
  [/\bevidence (?:that|of|to)\b/i, "evidence claim"], [/\bspy\b|\btrack (?:their|his|her) (?:phone|location)\b/i, "snooping"],
]);
export function claimProblems(text, { prose = false } = {}) {
  const s = String(text);
  const out = [];
  for (const [re, name] of BANNED) { const m = re.exec(s); if (m) out.push(`${name}: "${m[0]}"`); }
  if (prose) {
    const digits = s.replace(/\b(?:9-?1-?1|911)\b/g, "").match(/\d/);
    if (digits) out.push("a number in model prose (numbers come only from sourced facts)");
    if (/https?:\/\/|www\.|\.com\b|\.gov\b|\.org\b/i.test(s)) out.push("a link in model prose (links are added from the spec)");
    if (/\b(?:you should file|file for|sue|hire an attorney now)\b/i.test(s)) out.push("a legal step told as advice");
    if (/[!]/.test(s)) out.push("an exclamation mark (the brand voice has none)");
  }
  return out;
}

/**
 * A model chapter, parsed from the one format the prompt asks for: paragraphs separated by blank
 * lines, "## " sub-headings, "- " bullets. Returns blocks, or null when nothing usable came back.
 */
export function parseChapter(raw) {
  const text = String(raw ?? "").replace(/\r/g, "").replace(/^```[a-z]*\n?|```$/gm, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|\s)\*([^*]+)\*/g, "$1$2").trim();
  if (!text) return null;
  const blocks = [];
  for (const chunk of text.split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (/^#{1,2}\s/.test(lines[0]) && lines.length === 1) { blocks.push({ h: lines[0].replace(/^#+\s*/, "") }); continue; }
    if (/^#{1,2}\s/.test(lines[0])) { blocks.push({ h: lines.shift().replace(/^#+\s*/, "") }); }
    if (lines.every((l) => /^[-•*]\s/.test(l))) { blocks.push({ ul: lines.map((l) => l.replace(/^[-•*]\s*/, "")) }); continue; }
    if (lines.every((l) => /^\d+[.)]\s/.test(l))) { blocks.push({ ol: lines.map((l) => l.replace(/^\d+[.)]\s*/, "")) }); continue; }
    blocks.push({ p: lines.join(" ") });
  }
  const words = blocks.reduce((n, b) => n + JSON.stringify(b).split(/\s+/).length, 0);
  return words >= 150 ? blocks : null;
}
export const blocksText = (blocks) => blocks.map((b) => b.h ?? b.p ?? (b.ul ?? b.ol ?? []).join("\n")).join("\n\n");

/* ── The listing: what KDP itself refuses, checked before anything is shown to her ───────────── */
const STOP = new Set(["with", "your", "from", "that", "this", "when", "into", "what", "them"]);
export function repeatedTerms(title, subtitle) {
  const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const b = words(subtitle);
  return [...words(title)].filter((w) => b.has(w) && !STOP.has(w));
}
export function listingProblems(book, description) {
  const p = [];
  if (!book.title?.trim()) p.push("no title");
  if ((book.title + book.subtitle).length > 200) p.push("title + subtitle over 200 characters");
  const rep = repeatedTerms(book.title, book.subtitle);
  if (rep.length) p.push(`title and subtitle repeat "${rep.join(", ")}" (Amazon's repetitive-terms flag)`);
  if (!Array.isArray(book.keywords) || book.keywords.length !== 7) p.push(`${book.keywords?.length ?? 0} keywords (KDP takes 7)`);
  for (const k of book.keywords ?? []) if (k.length > 50) p.push(`keyword over 50 characters: ${k}`);
  if (new Set((book.keywords ?? []).map((k) => k.toLowerCase())).size !== (book.keywords ?? []).length) p.push("a keyword repeats");
  if (!Array.isArray(book.categories) || book.categories.length !== 2) p.push("not 2 categories");
  if (!(book.price_usd >= 2.99 && book.price_usd <= 9.99)) p.push("price outside $2.99–$9.99 (the 70% royalty band)");
  if (!description || description.length > 4000) p.push("description missing or over 4,000 characters");
  for (const x of claimProblems(`${book.title} ${book.subtitle} ${description} ${(book.keywords ?? []).join(" ")}`)) p.push(`listing: ${x}`);
  return p;
}

/** The product description, as KDP's box takes it (plain paragraphs and a <ul>; no links). */
export function description(book, { where, facts, checklist }) {
  const items = checklist.map((c) => `<li>${esc(c)}</li>`).join("");
  return [
    `<p><b>${esc(book.title)}</b> is a short, plain workbook for keeping the papers, messages and notes you already have in order, dated and ready to show the people helping you.</p>`,
    `<p>Inside:</p>`,
    `<ul><li>A short practical guide in ${book.chapters.length} chapters</li><li>A checklist of the papers to gather: ${checklist.length} groups</li><li>${book.logs.length} fill-in logs you can copy, or print free from the KeepMyProof website</li><li>Official court and agency pages for ${where}, with ${facts} facts taken from those official sources, each with its link and the date it was checked</li></ul>`,
    `<p>The checklist covers:</p><ul>${items}</ul>`,
    `<p>This book is educational only and is not legal advice. It does not tell you what to file, and it cannot say how any case will turn out. Rules differ by state and change; check your court's own pages or ask a lawyer.</p>`,
    `<p>Written by ${esc(book.author)}. Published by Spry Labs, the makers of KeepMyProof, a private phone app for keeping these papers in dated folders.</p>`,
  ].join("");
}

/* ── Markup ───────────────────────────────────────────────────────────────────────────────────── */
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const blockHtml = (b) => b.h ? `<h3>${esc(b.h)}</h3>` : b.p ? `<p>${esc(b.p)}</p>` : b.ul ? `<ul>${b.ul.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<ol>${b.ol.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>`;
const fmtDate = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return Number.isNaN(+d) ? iso : d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); };

export const DISCLAIMER = [
  "This book is educational only. It is not legal advice, and reading it does not make anyone your lawyer. S. L. Taylor, Spry Labs and KeepMyProof are not law firms and do not represent you.",
  "Nothing in this book predicts what a court, judge, mediator or agency will decide. A dated note or a saved copy is a record you kept; it does not prove anything on its own.",
  "Laws and court rules differ by state and county and they change. The facts at the back are quoted from official government sources and show the date each was checked; open the source, or ask your court's self-help center or a lawyer, before you rely on one.",
  "If you or a child are in danger, call 911.",
];

/**
 * The book's sections in reading order, each `{ id, title, html }` (XHTML body content). One
 * source for the EPUB and for the preview she reads, so what she approves is what is uploaded.
 */
/** "44 states and DC" — counted, never assumed. */
export const whereLabel = (states) => { const dc = states.some((s) => s.code === "DC"); const n = states.length - (dc ? 1 : 0); return n === 50 && dc ? "all 50 states and DC" : `${n} states${dc ? " and DC" : ""}`; };

export function sections(book, { chapters, checklist, states, checkedOn }) {
  const out = [];
  out.push({ id: "title", title: "Title page", toc: false, html: `<div class="titlepage"><h1>${esc(book.title)}</h1><p class="subtitle">${esc(book.subtitle)}</p><p class="author">${esc(book.author)}</p><p class="publisher">Spry Labs</p></div>` });
  out.push({ id: "copyright", title: "Copyright and disclaimer", html: `<h2>Copyright and disclaimer</h2><p>Copyright © ${new Date(`${checkedOn}T12:00:00Z`).getUTCFullYear()} ${esc(book.author)}. Published by Spry Labs. All rights reserved, except that you may copy the logs and checklists in this book for your own use.</p>${DISCLAIMER.map((d) => `<p>${esc(d)}</p>`).join("")}<p>Parts of this book were drafted with AI writing tools and then reviewed by the author. The facts section is quoted from official sources, not written by AI.</p><p>Facts last checked: ${esc(fmtDate(checkedOn))}.</p>` });
  out.push({ id: "how", title: "How to use this book", html: `<h2>How to use this book</h2><p>Read the short guide once. Then use the checklist to gather copies of what you already have, and the logs to write down what happens, on the day it happens. The back of the book lists official court and agency pages for your state.</p><p>Every log in this book can also be printed free, or filled in on screen, at <a href="${esc(book.printable_url)}">${esc(book.printable_url.replace(/^https:\/\//, ""))}</a>.</p>` });
  chapters.forEach((c, i) => out.push({ id: `ch${i + 1}`, title: `${i + 1}. ${c.title}`, html: `<h2>${i + 1}. ${esc(c.title)}</h2>${c.blocks.map(blockHtml).join("")}` }));
  out.push({ id: "checklist", title: "Checklist: papers to gather", html: `<h2>Checklist: papers to gather</h2><p>Tick each group when you have a copy in one place. Bring copies to meetings, never your only original.</p><ul class="check">${checklist.map((c) => `<li><span class="box">☐</span> ${esc(c)}</li>`).join("")}</ul><p>What matters differs by state and by case. Your lawyer, mediator or the court's self-help center can say which papers matter for yours.</p>` });
  for (const log of book.logs) {
    const entry = log.fields.map((f) => `<p class="field"><span class="label">${esc(f)}:</span> <span class="line">&#160;</span></p>`).join("");
    out.push({ id: `log-${slug(log.name)}`, title: `Log: ${log.name}`, html: `<h2>Log: ${esc(log.name)}</h2><p class="hint">One entry per event, written the same day. Copy this page into a notebook, or print it free at ${esc(book.printable_url.replace(/^https:\/\//, ""))}.</p>${Array.from({ length: log.rows }, (_, i) => `<div class="entry"><p class="entry-n">Entry ${i + 1}</p>${entry}</div>`).join("")}` });
  }
  const stateHtml = states.map((s) => `<h3 id="st-${s.code}">${esc(s.name)}</h3>${s.groups.map((g) => `<p class="group">${esc(g.label)}</p><ul class="facts">${g.facts.map((f) => `<li>${esc(f.claim)} <span class="src">Source: <a href="${esc(f.source_url)}">${esc(f.source_name)}</a>, checked ${esc(fmtDate(f.checked))}.</span></li>`).join("")}</ul>`).join("")}`).join("");
  out.push({ id: "states", title: "Official sources by state", html: `<h2>Official sources by state</h2><p>Each line below is quoted or closely restated from the official page linked after it, and shows the date it was checked. Pages move and rules change: open the link before you rely on a line, and ask the court's self-help center if anything is unclear. A state appears only when at least one of its facts passed that check.</p>${missingStates(states).length ? `<p class="missing">Not covered: ${missingStates(states).map(esc).join(", ")}. None of ${missingStates(states).length === 1 ? "its" : "their"} official facts on these topics passed our quote check by ${esc(fmtDate(checkedOn))}. Use the state court's own website, or ask its self-help center.</p>` : ""}<p class="statelist">${states.map((s) => `<a href="#st-${s.code}">${esc(s.name)}</a>`).join(" · ")}</p>${stateHtml}` });
  out.push({ id: "keepmyproof", title: "Keep it on your phone", html: `<h2>Keep it on your phone</h2><p>This book was made by the people behind KeepMyProof, a free private phone app for the papers, photos and notes you already have. It sorts them into folders with suggested checklists, puts dates on every item, and turns a folder into one PDF you can hand to a lawyer or mediator. No account, no ads, and nothing leaves your phone unless you send it. Free for your first 25 items.</p><p>See whether it is available on your phone yet, and use the free printable logs and checklists, at <a href="${esc(book.folder_url)}">${esc(book.folder_url.replace(/^https:\/\//, "").replace(/\/$/, ""))}</a>.</p>` });
  out.push({ id: "author", title: "About the author", html: `<h2>About the author</h2><p>${esc(book.author)} writes plain, practical workbooks for people gathering papers under pressure, published by Spry Labs. ${esc(book.author)} is not a lawyer, and this book is not legal advice.</p><p>If this book helped, a short review on Amazon helps another parent find it.</p>` });
  return out;
}
/** The states and DC a book leaves out, by name, so a missing state is said, never silent. */
export const missingStates = (states) => { const have = new Set(states.map((s) => s.code)); return Object.entries(STATE_NAMES).filter(([c]) => !have.has(c)).map(([, n]) => n).sort(); };
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const BOOK_CSS = `body{font-family:serif;line-height:1.5;margin:0 4%}h1,h2,h3{font-family:serif;font-weight:bold;line-height:1.2}h2{margin-top:1.2em;page-break-before:always}h3{margin-top:1.1em}
.titlepage{text-align:center;margin-top:20%}.titlepage h1{font-size:2em}.subtitle{font-style:italic}.author{margin-top:2em;font-weight:bold}
.check{list-style:none;padding-left:0}.check li{margin:.5em 0}.box{font-size:1.2em}
.entry{border-top:1px solid #999;margin-top:1em;padding-top:.3em}.entry-n{font-weight:bold;font-size:.9em}.field{margin:.6em 0}.label{font-weight:bold}.line{display:inline-block;border-bottom:1px solid #999;width:60%}
.group{font-weight:bold;margin-bottom:.2em}.facts{margin-top:.2em}.facts li{margin:.35em 0}.src{font-size:.85em}.hint{font-style:italic}.statelist{font-size:.9em}`;

export const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en"><head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="book.css"/></head><body>${body}</body></html>`;

/** The OPF, nav and NCX for an EPUB 3 KDP accepts (with an NCX for older readers). */
export function packageFiles(book, secs, { id, date }) {
  const items = secs.map((s) => `<item id="${s.id}" href="${s.id}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const spine = secs.map((s) => `<itemref idref="${s.id}"/>`).join("");
  const opf = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:${id}</dc:identifier><dc:title>${esc(book.title)}</dc:title><dc:creator>${esc(book.author)}</dc:creator><dc:publisher>Spry Labs</dc:publisher><dc:language>en</dc:language><dc:date>${date}</dc:date><meta property="dcterms:modified">${date}T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="book.css" media-type="text/css"/>${items}</manifest><spine toc="ncx">${spine}</spine></package>`;
  const tocd = secs.filter((s) => s.toc !== false);
  const nav = xhtml("Contents", `<nav epub:type="toc" id="toc"><h2>Contents</h2><ol>${tocd.map((s) => `<li><a href="${s.id}.xhtml">${esc(s.title)}</a></li>`).join("")}</ol></nav>`);
  const ncx = `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:${id}"/></head><docTitle><text>${esc(book.title)}</text></docTitle><navMap>${tocd.map((s, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(s.title)}</text></navLabel><content src="${s.id}.xhtml"/></navPoint>`).join("")}</navMap></ncx>`;
  return { opf, nav, ncx };
}

/** The cover as one HTML page at 1600×2560 (KDP's ideal), in the KeepMyProof brand. */
export function coverHtml(book, { fonts, mark, checklist }) {
  // A hyphenated word never breaks at its hyphen ("Co-" alone on a line); the size steps down for
  // long titles so three lines at most always leave room for the subtitle and the card.
  const title = esc(book.title).replace(/-/g, "\u2011");
  const longest = Math.max(...book.title.split(/\s+/).map((w) => w.length));
  const size = longest > 13 ? 150 : longest > 9 ? 196 : 220;
  const rows = checklist.slice(0, 4).map((c, i) => `<div class="row"><span class="tick ${i < 3 ? "on" : ""}"></span><span>${esc(c)}</span></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:NotoSerif;font-weight:700;src:url(data:font/woff2;base64,${fonts.serif}) format("woff2")}
@font-face{font-family:NotoSans;src:url(data:font/woff2;base64,${fonts.sans}) format("woff2")}
@font-face{font-family:NotoMono;src:url(data:font/woff2;base64,${fonts.mono}) format("woff2")}
*{box-sizing:border-box;margin:0;padding:0}html,body{width:1600px;height:2560px}
body{background:#F3F4F1;color:#1E2326;font-family:NotoSans;position:relative;overflow:hidden}
.brand{position:absolute;top:110px;left:120px;display:flex;align-items:center;gap:28px;font-family:NotoSerif;font-size:64px}
.brand svg{width:110px;height:110px}.brand b{color:#0B6E4F}
.main{position:absolute;top:290px;left:120px;right:110px;bottom:300px;display:flex;flex-direction:column}
.kicker{font-family:NotoMono;font-size:46px;letter-spacing:6px;text-transform:uppercase;color:#6B5320}
h1{margin-top:40px;font-family:NotoSerif;font-weight:700;font-size:${size}px;line-height:1.02;letter-spacing:-3px}
.sub{margin-top:56px;font-size:58px;line-height:1.32;color:#3D4448;max-width:1300px}
.card{margin-top:auto;background:#FFFFFF;border:3px solid #D6D9D3;border-radius:28px;padding:52px 64px;box-shadow:0 18px 40px rgba(30,35,38,.10)}
.card .head{display:flex;justify-content:space-between;font-family:NotoMono;font-size:36px;color:#5B6266;margin-bottom:28px}
.row{display:flex;align-items:center;gap:30px;font-size:44px;padding:20px 0;border-top:2px solid #ECEEEA}
.tick{flex:none;width:52px;height:52px;border:5px solid #0B6E4F;border-radius:10px;position:relative}
.tick.on{background:#0B6E4F}.tick.on:after{content:"";position:absolute;left:14px;top:2px;width:14px;height:28px;border:solid #fff;border-width:0 7px 7px 0;transform:rotate(45deg)}
.stamp{display:inline-block;margin-top:30px;font-family:NotoMono;font-size:34px;color:#6B5320;background:#F6EBD2;border:3px solid #D9A441;border-radius:12px;padding:14px 22px}
.foot{position:absolute;left:0;right:0;bottom:0;height:270px;background:#0B6E4F;color:#F3F4F1;display:flex;align-items:center;justify-content:space-between;padding:0 120px}
.foot .author{font-family:NotoSerif;font-weight:700;font-size:84px}.foot .tag{font-size:38px;opacity:.9;text-align:right;max-width:640px;line-height:1.3}
</style></head><body>
<div class="brand">${mark}<span>KeepMy<b>Proof</b></span></div>
<div class="main"><div class="kicker">${esc(book.cover_kicker)}</div>
<h1>${title}</h1>
<div class="sub">${esc(book.subtitle)}</div>
<div class="card"><div class="head"><span>Checklist</span><span>${checklist.length} groups</span></div>${rows}<div class="stamp">Dated · private · in one place</div></div></div>
<div class="foot"><span class="author">${esc(book.author)}</span><span class="tag">Your papers, dated and private, on your phone.</span></div>
</body></html>`;
}

/**
 * The page she reads before saying yes: the cover, the listing exactly as it would go into KDP, and
 * the whole manuscript from the same sections the EPUB is packed from. Phone first, light and dark,
 * in the KeepMyProof brand. `cover` is a base64 JPEG.
 */
export function previewHtml(meta, secs, cover) {
  const body = secs.map((s) => {
    if (s.id === "states") {
      const [intro, ...rest] = s.html.split(/(?=<h3 id="st-)/);
      const states = rest.map((h) => { const name = /<h3[^>]*>([^<]+)<\/h3>/.exec(h)?.[1] ?? ""; return `<details class="state"><summary>${name}</summary>${h.replace(/<h3[^>]*>[^<]+<\/h3>/, "")}</details>`; }).join("");
      return `<section id="${s.id}" class="sec">${intro.replace(/<p class="statelist">[\s\S]*?<\/p>/, "")}<p class="hint">Tap a state to open it. ${meta.facts} facts in all; every one links to its official source.</p>${states}</section>`;
    }
    return `<section id="${s.id}" class="sec${s.id === "title" ? " tp" : ""}">${s.html}</section>`;
  }).join("");
  const toc = secs.filter((s) => s.toc !== false).map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join("");
  return `<title>${esc(meta.title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600&family=Noto+Sans+Mono:wght@500&family=Noto+Serif:wght@700&display=swap">
<style>
/* An archive box: papers on archive white, lockbox green for the one thing to act on, brass for the stamp. One reading column. */
:root{--archive:#F3F4F1;--raised:#FFFFFF;--ink:#1E2326;--muted:#545B5F;--line:#D9DCD6;--green:#0B6E4F;--on-green:#FFFFFF;--brass:#D9A441;--brass-soft:#F6EBD2;--brass-ink:#6B5320;--serif:"Noto Serif",Georgia,serif;--sans:"Noto Sans",system-ui,sans-serif;--mono:"Noto Sans Mono",ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--archive:#121615;--raised:#1B201F;--ink:#EEF0EC;--muted:#AEB5B1;--line:#2E3533;--green:#4FC197;--on-green:#0B1A14;--brass-soft:#2E2715;--brass-ink:#E8C77A;color-scheme:dark}}
:root[data-theme="dark"]{--archive:#121615;--raised:#1B201F;--ink:#EEF0EC;--muted:#AEB5B1;--line:#2E3533;--green:#4FC197;--on-green:#0B1A14;--brass-soft:#2E2715;--brass-ink:#E8C77A;color-scheme:dark}
body{background:var(--archive);color:var(--ink);font:16px/1.6 var(--sans)}
.wrap{max-width:720px;margin:0 auto;padding-block:20px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:28px}
h1,h2,h3{font-family:var(--serif);font-weight:700;line-height:1.2;text-wrap:balance;margin:0}
h2{font-size:24px;margin-bottom:12px}h3{font-size:19px;margin:22px 0 8px}
a{color:var(--green)}p{margin:0 0 12px}
.stamp{display:inline-block;font:500 13px/1.4 var(--mono);color:var(--brass-ink);background:var(--brass-soft);border:1.5px solid var(--brass);border-radius:6px;padding:4px 10px;letter-spacing:.02em}
.top{display:grid;gap:10px}.top h1{font-size:28px}.lede{color:var(--muted);margin:0}
.book{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr);gap:20px;align-items:start}
@media (max-width:560px){.book{grid-template-columns:1fr}.book img{max-width:240px}}
.book img{width:100%;border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.18)}
.card{background:var(--raised);border:1px solid var(--line);border-radius:12px;padding:16px}
dl{margin:0;display:grid;gap:10px}dt{font:500 12px/1.3 var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}dd{margin:0;min-width:0}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chips span{border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:14px}
.desc{border-top:1px solid var(--line);padding-top:12px;margin-top:4px}.desc ul{padding-left:20px;margin:0 0 12px}
.next{border:1.5px solid var(--green);border-radius:12px;padding:14px 16px}.next p:last-child{margin:0}
details.toc summary,details.state summary{cursor:pointer;font-weight:600;padding:10px 0;min-height:44px;box-sizing:border-box}
details.toc ol{margin:0;padding-left:22px}
.ms{background:var(--raised);border:1px solid var(--line);border-radius:12px;padding:4px 18px 18px}
.sec{border-top:1px solid var(--line);padding-top:20px;margin-top:20px}.sec:first-child{border-top:0;margin-top:8px}
.tp{text-align:center;padding-block:24px}.tp h1{font-size:30px}.subtitle{font-style:italic;color:var(--muted)}.author{font-weight:600;margin-top:16px}
.check{list-style:none;padding:0}.check li{margin:8px 0}
.entry{border:1px dashed var(--line);border-radius:8px;padding:8px 12px;margin:10px 0}.entry-n{font:500 12px var(--mono);color:var(--muted);margin:0 0 4px}
.field{display:flex;gap:8px;margin:6px 0}.label{font-weight:600;flex:none;max-width:60%}.line{flex:1;border-bottom:1px solid var(--line);min-height:1.2em}
.group{font-weight:600;margin:12px 0 4px}.facts{padding-left:18px;margin:0}.facts li{margin:6px 0}.src{display:block;font-size:14px;color:var(--muted)}
.hint{font-size:14px;color:var(--muted)}details.state{border-bottom:1px solid var(--line)}
a:focus-visible,summary:focus-visible{outline:2px solid var(--green);outline-offset:2px}
</style>
<div class="wrap">
<header class="top"><span class="stamp">Draft · not on Amazon · ${esc(meta.drafted_on)}</span><h1>${esc(meta.title)}</h1><p class="lede">The KeepMyProof Kindle book for the ${esc(meta.folder)} folder. This is the cover, the Amazon listing exactly as it would be entered, and the whole book below. Nothing has been uploaded.</p></header>
<section class="book"><img src="data:image/jpeg;base64,${cover}" alt="Cover: ${esc(meta.title)}, by ${esc(meta.author)}"><div class="card"><dl>
<dt>Title</dt><dd>${esc(meta.title)}</dd><dt>Subtitle</dt><dd>${esc(meta.subtitle)}</dd>
<dt>Author · Publisher</dt><dd>${esc(meta.author)} · ${esc(meta.publisher)}</dd>
<dt>Price</dt><dd>$${meta.price_usd.toFixed(2)} Kindle (70% royalty band)</dd>
<dt>Categories</dt><dd>${meta.categories.map(esc).join("<br>")}</dd>
<dt>Keywords (7)</dt><dd class="chips">${meta.keywords.map((k) => `<span>${esc(k)}</span>`).join("")}</dd>
<dt>AI disclosure</dt><dd>On: text and cover made with AI tools, every page reviewed</dd>
</dl></div></section>
<section class="card"><dt>Description on Amazon</dt><div class="desc">${meta.description_html}</div></section>
<section class="next"><p><b>What happens next.</b> If you approve it in your Boss OS Inbox, Simone creates the book on Kindle in one pass with the AI disclosure on and presses Publish. It is never saved as a KDP draft, because that drops the AI disclosure. Send it back with a sentence and it is redone.</p></section>
<details class="toc card"><summary>Contents</summary><ol>${toc}</ol></details>
<article class="ms">${body}</article>
</div>`;
}
