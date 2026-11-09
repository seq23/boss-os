#!/usr/bin/env node
/**
 * BUILDS THE SERIES BOOKS: every `series_books` entry of every line spec (scripts/ops/kdp-books/*.json)
 * into the files kdp-new-title.mjs uploads (KDP strategy, spry brain 8 Nov 2026).
 *
 * For each book, into ~/.boss-os/kdp/books/<slug>/ (outside the public repo):
 *   book.epub            the Kindle manuscript (front and back matter, the tracked companion link)
 *   cover.jpg            the Kindle cover, 1600×2560
 *   listing.json         every field Simone types into KDP (series, pen name, price, Select, AI answers)
 *   preview.html         the whole book as she approves it
 *   interior.pdf         paperback only: the print interior at its trim, padded to KDP's 24-page floor
 *   paperback-cover.pdf  paperback only: the full wrap (back, spine from the real page count, front)
 * and ~/.boss-os/kdp/books/covers.html, every cover side by side at Amazon's thumbnail size and full,
 * which is what goes on the approval page.
 *
 * A book that fails the gate (`seriesProblems`: KDP's listing rules, the pen-name rules, the 4,000-word
 * floor for a short but real book, the claim gate, the companion link) is NOT built and is named.
 *
 *   node scripts/ops/kdp-build.mjs                 # every series book
 *   node scripts/ops/kdp-build.mjs --line wedding  # one line
 *   node scripts/ops/kdp-build.mjs --slug wedding-vows
 *   … --root <checkout>                            # read specs and manuscripts from another checkout
 *
 * Output: `KDP-BUILD: <slug> — built (N pages)` or `KDP-BUILD: <slug> — NOT BUILT: <problems>` per
 * book, then `OUTPUT <n> kindle-books-built`. Exit 0 all built · 2 a book failed its gate · 4 no spec.
 */
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as L from "./kdp-books/lib.mjs";
import * as S from "./kdp-books/series.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BOOKS_DIR = process.env.KDP_BOOKS_DIR ?? join(process.env.HOME ?? ".", ".boss-os/kdp/books");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

/** Every line spec with series books: [{ file, line }]. */
export async function lineSpecs(root) {
  const dir = join(root, "scripts/ops/kdp-books");
  const out = [];
  for (const f of (await readdir(dir)).filter((n) => n.endsWith(".json")).sort()) {
    const line = JSON.parse(await readFile(join(dir, f), "utf8"));
    if (Array.isArray(line.series_books) && line.series_books.length) out.push({ file: f, line });
  }
  return out;
}

/** Finds a series book by its title across every line: { line, book } or null. */
export async function findSeriesBook(title, root = join(HERE, "../..")) {
  for (const { line } of await lineSpecs(root)) {
    const norm = (t) => String(t ?? "").normalize("NFKC").toLowerCase().replace(/[\u2018\u2019'"]/g, "").replace(/\s+/g, " ").trim();
    const book = line.series_books.find((b) => norm(b.title) === norm(title));
    if (book) return { line, book };
  }
  return null;
}

async function packEpub(dir, meta, secs) {
  const tmp = join(dir, ".epub");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(join(tmp, "META-INF"), { recursive: true }); await mkdir(join(tmp, "OEBPS"), { recursive: true });
  await writeFile(join(tmp, "mimetype"), "application/epub+zip");
  await writeFile(join(tmp, "META-INF/container.xml"), `<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const { opf, nav, ncx } = L.packageFiles(meta, secs, { id: randomUUID(), date: meta.built_on });
  await writeFile(join(tmp, "OEBPS/content.opf"), opf); await writeFile(join(tmp, "OEBPS/nav.xhtml"), nav); await writeFile(join(tmp, "OEBPS/toc.ncx"), ncx);
  await writeFile(join(tmp, "OEBPS/book.css"), S.SERIES_EPUB_CSS);
  for (const s of secs) await writeFile(join(tmp, `OEBPS/${s.id}.xhtml`), L.xhtml(s.title, s.html));
  const out = join(dir, "book.epub"); await rm(out, { force: true });
  execFileSync("zip", ["-X0q", out, "mimetype"], { cwd: tmp });
  execFileSync("zip", ["-Xr9Dq", out, "META-INF", "OEBPS"], { cwd: tmp });
  await rm(tmp, { recursive: true, force: true });
  return out;
}

/** A JPEG's pixel height from its SOF marker (0 when unreadable). Pure. */
export function jpegHeight(buf) {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return buf.readUInt16BE(i + 5);
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return 0;
}

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
async function photoFor(root, book) {
  const p = book.cover?.photo?.path;
  if (!p) return null;
  const file = join(root, p.startsWith("docs/") ? p : join("docs/kdp/books/assets", p));
  if (!existsSync(file)) throw new Error(`the cover photo ${p} is not in the checkout`);
  return `data:${MIME[extname(file).toLowerCase()] ?? "image/jpeg"};base64,${(await readFile(file)).toString("base64")}`;
}

/**
 * Where a book's manuscript is: in the checkout (docs/kdp/books/<slug>.md), or, for a book whose text
 * must never sit in this public repo, under the home folder ("~/.boss-os/kdp/..."). Pure.
 */
export function manuscriptPath(root, book, home = process.env.HOME ?? ".") {
  const m = book.manuscript ?? `docs/kdp/books/${book.slug}.md`;
  return m.startsWith("~/") ? join(home, m.slice(2)) : join(root, m);
}

/** Builds one book. Returns { slug, built, problems, pages }. */
export async function buildBook(browser, root, line, book, { now = new Date() } = {}) {
  const md = manuscriptPath(root, book);
  if (!existsSync(md)) return { slug: book.slug, built: false, problems: [`no manuscript at ${book.manuscript ?? md}`] };
  const chapters = S.parseManuscript(await readFile(md, "utf8"));
  const problems = S.seriesProblems(line, book, chapters);
  if (problems.length) return { slug: book.slug, built: false, problems };
  const dir = join(BOOKS_DIR, book.slug);
  await mkdir(dir, { recursive: true });
  const built_on = now.toISOString().slice(0, 10);
  const siblings = line.series_books.filter((b) => b.slug !== book.slug);
  const secs = S.seriesSections(line, book, chapters, { year: now.getUTCFullYear(), siblings });
  const photo = await photoFor(root, book);
  const page = await browser.newPage();
  try {
    // Kindle cover: the designed one (docs/kdp/books/assets/covers/<slug>.jpg, hostile-reviewed at
    // thumbnail size) when it is there and full size; else rendered from the spec's cover fields.
    const designed = join(root, "docs/kdp/books/assets/covers", `${book.slug}.jpg`);
    const front = existsSync(designed) ? await readFile(designed) : null;
    if (front && jpegHeight(front) >= 1000) await writeFile(join(dir, "cover.jpg"), front);
    else {
      if (front) console.log(`  ${book.slug}: the designed cover is ${jpegHeight(front)} px tall (KDP needs 1000+, ideally 2560); rendered from the spec instead.`);
      await page.setViewportSize({ width: 1600, height: 2560 });
      await page.setContent(S.kindleCoverHtml(line, book, { photo }), { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(dir, "cover.jpg"), type: "jpeg", quality: 92 });
    }
    const frontUrl = `data:image/jpeg;base64,${(await readFile(join(dir, "cover.jpg"))).toString("base64")}`;
    // Paperback: interior first (its page count sets the spine), then the wrap.
    let pages = null;
    if (book.paperback) {
      const trim = book.paperback.trim;
      const render = async (notesPages) => {
        await page.setContent(S.interiorHtml(secs, trim, { pages: 40, notesPages }), { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        return page.pdf({ width: `${S.TRIMS[trim].w}in`, height: `${S.TRIMS[trim].h}in`, preferCSSPageSize: true, printBackground: true });
      };
      let pdf = await render(0);
      pages = S.pdfPages(pdf);
      // KDP prints from 24 pages, and an even count keeps the last page a left-hand page.
      const pad = Math.max(0, S.KDP_LIMITS.paperbackMinPages - pages) + ((pages + Math.max(0, S.KDP_LIMITS.paperbackMinPages - pages)) % 2);
      if (pad) { pdf = await render(pad); pages = S.pdfPages(pdf); }
      await writeFile(join(dir, "interior.pdf"), pdf);
      // A PDF is laid out in CSS pixels (96 to the inch); the type stays vector and a photo keeps its own pixels.
      const wrap = S.wrapCoverHtml(line, book, { pages, dpi: 96, photo, frontImage: frontUrl });
      await page.setViewportSize({ width: Math.round(wrap.width * 96), height: Math.round(wrap.height * 96) });
      await page.setContent(wrap.html, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await writeFile(join(dir, "paperback-cover.pdf"), await page.pdf({ width: `${wrap.width}in`, height: `${wrap.height}in`, printBackground: true, pageRanges: "1" }));
    }
    const listing = S.seriesListing(line, book, { built_on, pages });
    await packEpub(dir, listing, secs);
    await writeFile(join(dir, "listing.json"), JSON.stringify(listing, null, 2) + "\n");
    const cover = (await readFile(join(dir, "cover.jpg"))).toString("base64");
    await writeFile(join(dir, "preview.html"), L.previewHtml({ ...listing, drafted_on: built_on, folder: line.series?.name ?? line.line, facts: 0 }, secs, cover)
      .replace(/The KeepMyProof Kindle book for the [^.]*\./, `Book ${listing.series?.number ?? 1} of ${line.series?.name ?? "the series"}.`)
      .replace(/\$[0-9.]+ Kindle \(70% royalty band\)/, `$${listing.price_usd.toFixed(2)} Kindle (${listing.royalty}% royalty), KDP Select${listing.paperback ? ` · paperback $${listing.paperback.price_usd.toFixed(2)}, ${listing.paperback.trim}, ${pages} pages` : ""}`)
      .replace(/On: text and cover made with AI tools, every page reviewed/, `On: text ${listing.ai_disclosure.text_detail.toLowerCase()}; images ${listing.ai_disclosure.images_detail.toLowerCase()}`));
    return { slug: book.slug, built: true, problems: [], pages, dir };
  } finally { await page.close().catch(() => {}); }
}

/** The approval page body: every cover at thumbnail size and full, with its listing line. Pure. */
export function coversHtml(results) {
  const cards = results.filter((r) => r.built).map((r) => `<figure class="b"><div class="row"><img class="thumb" src="${r.slug}/cover.jpg" alt=""><img class="full" src="${r.slug}/cover.jpg" alt="Cover: ${L.esc(r.listing.title)}"></div><figcaption><b>${L.esc(r.listing.title)}</b><br>${L.esc(r.listing.subtitle)}<br>${L.esc(r.listing.author)} · ${L.esc(r.listing.series?.name ?? "")} ${r.listing.series ? `#${r.listing.series.number}` : ""} · $${r.listing.price_usd.toFixed(2)}${r.listing.paperback ? ` · paperback $${r.listing.paperback.price_usd.toFixed(2)}` : ""}</figcaption></figure>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>Kindle covers</title><style>body{font:15px/1.5 system-ui;margin:16px;background:#f4f4f2}.b{background:#fff;border-radius:10px;padding:12px;margin:0 0 16px}.row{display:flex;gap:16px;align-items:flex-end}.thumb{height:160px}.full{height:420px}</style>${cards}`;
}

export async function run({ root = join(HERE, "../.."), lineOnly = null, slugOnly = null, log = console.log } = {}) {
  const specs = await lineSpecs(root);
  if (!specs.length) { log("NAMED STOP [NO_SERIES_SPEC] no kdp-books/*.json lists series_books; nothing to build."); return { code: 4, results: [] }; }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const { line } of specs) {
      if (lineOnly && line.line !== lineOnly) continue;
      for (const book of line.series_books) {
        if (slugOnly && book.slug !== slugOnly) continue;
        const r = await buildBook(browser, root, line, book).catch((e) => ({ slug: book.slug, built: false, problems: [String(e?.message ?? e).slice(0, 300)] }));
        if (r.built) r.listing = JSON.parse(await readFile(join(r.dir, "listing.json"), "utf8"));
        log(`KDP-BUILD: ${book.slug} — ${r.built ? `built${r.pages ? ` (paperback ${r.pages} pages)` : ""}` : `NOT BUILT: ${r.problems.join("; ")}`}`);
        results.push(r);
      }
    }
  } finally { await browser.close(); }
  if (!results.length) { log("NAMED STOP [NOTHING_MATCHED] no series book matched the filter."); return { code: 4, results }; }
  await mkdir(BOOKS_DIR, { recursive: true });
  await writeFile(join(BOOKS_DIR, "covers.html"), coversHtml(results));
  const built = results.filter((r) => r.built).length;
  log(`OUTPUT ${built} kindle-books-built`);
  return { code: built === results.length ? 0 : 2, results };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run({ root: flag("root") ?? join(HERE, "../.."), lineOnly: flag("line"), slugOnly: flag("slug") })
    .then(({ code }) => process.exit(code))
    .catch((e) => { console.error(`NAMED STOP [BUILD_FAILED] ${String(e?.message ?? e).slice(0, 300)}`); console.log("OUTPUT 0 kindle-books-built"); process.exit(1); });
}
