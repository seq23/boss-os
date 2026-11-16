#!/usr/bin/env node
/**
 * THE QUALITY GATE A NEW KINDLE TITLE PASSES BEFORE PUBLISH (16 Nov 2026).
 *
 * Amazon's Kindle Content Review rejected "How to Break Into Investment Banking" (15 Nov 2026) as
 * content that "might result in a disappointing customer experience". Resubmitting rejected content can
 * put the whole KDP account at risk, so every approved title is read against those grounds first, and a
 * title that fails is never put up: it goes to the team's repair, never to her.
 *
 * Amazon's grounds, as code reads them (each a named finding):
 *   AI_TEXT_UNEDITED      the AI disclosure says the text was used "with minimal or no editing"
 *   SUBTITLE_STUFFED      a subtitle over 100 characters, or one that lists 5+ topics
 *   PROMO_WORDS           "ultimate", "best", "#1", "bestselling", "complete" in the title or subtitle
 *   TITLE_TOO_LONG        title + subtitle over 200 characters (KDP's own cap)
 *   THIN                  under MIN_WORDS words of body text
 *   REPETITIVE            over 8% of paragraphs repeat another, or one sentence opening carries the book
 *   FILLER                stock AI filler phrases above FILLER_PER_10K per 10,000 words
 *   DESCRIPTION_MISMATCH  under 60% of the description's own content words appear in the book
 * Not read by code (said, never passed silently): content freely available elsewhere.
 *
 *   node scripts/ops/kdp-books/quality-gate.mjs <book folder>...   (folder = listing.json + book.epub)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const MIN_WORDS = 2500;
export const FILLER_PER_10K = 6;
const PROMO = /\b(ultimate|best|#1|number one|bestsell\w*|complete|definitive|essential)\b/i;
const FILLER = /\b(in today'?s (?:fast-paced|competitive|ever-changing)\b|delve|it(?:'s| is) (?:important|worth) (?:to note|noting)|navigat\w+ the (?:complex|landscape)|in conclusion|embark on|tapestry|game[- ]changer|unlock (?:your|the) (?:full )?potential|whether you'?re a|look no further|in the realm of|a testament to)/gi;
const STOP = new Set("the and for with your you that this from into what how are was have will can when who about their them they more most than then also just only each every over under after before which while where there here these those our out not all any its it's his her one two use used using make makes made get gets got".split(" "));

/** Body text of an EPUB, tags stripped, one paragraph per line. */
export function epubText(epub) {
  const list = execFileSync("unzip", ["-Z1", epub], { encoding: "utf8" }).split("\n").filter((f) => /\.x?html?$/i.test(f) && !/nav|toc|cover|title/i.test(f));
  return list.map((f) => execFileSync("unzip", ["-p", epub, f], { encoding: "utf8", maxBuffer: 64 << 20 }))
    .join("\n")
    .replace(/<(?:\/p|br\s*\/?|\/li|\/h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&[a-z#0-9]+;/gi, " ")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

const words = (t) => String(t ?? "").toLowerCase().match(/[a-z][a-z'’-]+/g) ?? [];

/** Every finding for one title. Pure. `listing` is listing.json, `text` the book's body text. */
export function qualityFindings(listing, text) {
  const out = [];
  const title = String(listing?.title ?? ""), sub = String(listing?.subtitle ?? "");
  if (/minimal or no editing/i.test(String(listing?.ai_disclosure?.text_detail ?? ""))) out.push({ code: "AI_TEXT_UNEDITED", why: `the AI disclosure says the text was used "${listing.ai_disclosure.text_detail}"` });
  if (sub.length > 100 || sub.split(/[,:;|&]| and /).length >= 5) out.push({ code: "SUBTITLE_STUFFED", why: `subtitle is ${sub.length} characters and lists ${sub.split(/[,:;|&]| and /).length} parts` });
  const promo = PROMO.exec(`${title} ${sub}`);
  if (promo) out.push({ code: "PROMO_WORDS", why: `"${promo[0]}" in the title or subtitle` });
  if (title.length + sub.length > 200) out.push({ code: "TITLE_TOO_LONG", why: `title + subtitle is ${title.length + sub.length} characters` });
  const w = words(text);
  if (w.length < MIN_WORDS) out.push({ code: "THIN", why: `${w.length} words of body text (floor ${MIN_WORDS})` });
  const paras = String(text ?? "").split("\n").map((p) => p.toLowerCase().replace(/[^a-z ]/g, "").trim()).filter((p) => p.length > 60);
  const seen = new Map(); for (const p of paras) seen.set(p, (seen.get(p) ?? 0) + 1);
  const dup = paras.filter((p) => seen.get(p) > 1).length;
  if (paras.length && dup / paras.length > 0.08) out.push({ code: "REPETITIVE", why: `${Math.round((dup / paras.length) * 100)}% of paragraphs repeat another` });
  const openers = new Map(); for (const p of paras) { const o = p.split(" ").slice(0, 4).join(" "); openers.set(o, (openers.get(o) ?? 0) + 1); }
  const [topOpen, topN] = [...openers.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (paras.length >= 40 && topN / paras.length > 0.06) out.push({ code: "REPETITIVE", why: `${topN} paragraphs open "${topOpen}…"` });
  const filler = String(text ?? "").match(FILLER) ?? [];
  const rate = w.length ? (filler.length / w.length) * 10_000 : 0;
  if (rate > FILLER_PER_10K) out.push({ code: "FILLER", why: `${filler.length} stock filler phrases (${rate.toFixed(1)} per 10,000 words), e.g. "${filler[0]}"` });
  const body = new Set(w);
  const desc = [...new Set(words(listing?.description).filter((x) => x.length >= 5 && !STOP.has(x)))];
  const found = desc.filter((x) => body.has(x)).length;
  if (desc.length >= 10 && found / desc.length < 0.6) out.push({ code: "DESCRIPTION_MISMATCH", why: `only ${found} of the description's ${desc.length} content words appear in the book` });
  return out;
}

/** The gate for one book folder: { title, pass, findings, words, unchecked }. */
export function gateFolder(dir) {
  return gateBook(JSON.parse(readFileSync(join(dir, "listing.json"), "utf8")), join(dir, "book.epub"));
}

/** The gate for a listing and its EPUB (a live book: existing-books.json's row and its interior). */
export function gateBook(listing, epub) {
  if (!existsSync(epub)) return { title: listing.title, pass: false, findings: [{ code: "NO_BOOK", why: "no book.epub" }], words: 0, unchecked: [] };
  const text = epubText(epub);
  const findings = qualityFindings(listing, text);
  return { title: listing.title, pass: findings.length === 0, findings, words: words(text).length, unchecked: ["freely available elsewhere (read by a person)"] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let failed = 0;
  const args = process.argv.slice(2);
  // --live: every book in existing-books.json, read only (a live listing is changed by her call alone).
  const targets = args[0] === "--live"
    ? JSON.parse(readFileSync(new URL("./existing-books.json", import.meta.url), "utf8")).books
      .map((b) => ({ listing: b, epub: b.interior?.source ? b.interior.source.replace(/^~/, process.env.HOME ?? "") : join(process.env.HOME ?? "", ".boss-os/kdp/books", b.slug, "book.epub") }))
    : args.map((dir) => ({ dir }));
  for (const t of targets) {
    const r = t.dir ? gateFolder(t.dir) : gateBook(t.listing, t.epub);
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.title} (${r.words} words)${r.findings.map((f) => `\n   ${f.code}: ${f.why}`).join("")}`);
  }
  console.log(`OUTPUT ${targets.length - failed} titles passed the quality gate`);
  process.exitCode = failed ? 3 : 0;
}
