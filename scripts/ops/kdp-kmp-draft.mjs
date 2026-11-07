#!/usr/bin/env node
/**
 * KEEPMYPROOF KINDLE DRAFTS — one front-door book per KeepMyProof folder (owner, 7 Nov 2026, spry
 * brain: "a KDP front-door book per KeepMyProof folder, divorce first"; S. L. Taylor, publisher Spry
 * Labs, AI disclosure on; drafts only).
 *
 * WHAT ONE RUN DOES. Picks a book (`--folder divorce`, or `--next`: the first folder in
 * kdp-books/keepmyproof.json with no entry in kdp-register.json), reads its sourced facts and
 * checklist from seq23/keepmyproof, has the short guide written (free models first: Gemini free,
 * OpenRouter :free, then ~/bin/ai-run worker, then brain; $0), passes every word through the claim
 * gate, and writes into ~/.boss-os/kdp/keepmyproof/<folder>/:
 *   book.epub · cover.jpg (1600×2560) · listing.json · preview.html · chapters.json (kept, so a
 *   reviewed chapter is never silently rewritten; --rewrite to start over) · sample-*.png
 *
 * IT NEVER TOUCHES KDP. Uploading is publishing (her yes, through the Inbox: kdp-kmp-raise.mjs raises
 * the `kdp_new_title` judgement call; kdp-new-title.mjs acts only on her approval).
 *
 * Rule 0: every run prints one `OUTPUT <n> kmp-kindle-drafts <folder|->` line. Zero is a NAMED STOP:
 *   0 ALL_FIVE_DRAFTED (the duty's end; nothing left to draft) · 1 CLAIM_GATE / LISTING (problems named)
 *   2 NO_VERIFIED_FACTS / SOURCE_UNREAD / KDP_DRAFT_CAP · 9 NO_MODEL (every rung spent; next run retries)
 *
 *   node scripts/ops/kdp-kmp-draft.mjs --folder divorce [--rewrite] [--review] [--source ~/GitHub/keepmyproof]
 *   npm run vault:run -- node scripts/ops/kdp-kmp-draft.mjs --next --review     (the monthly duty)
 */
import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as L from "./kdp-books/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SPEC_PATH = join(HERE, "kdp-books/keepmyproof.json");
const REGISTER = process.env.BOSS_OS_KDP_REGISTER ?? join(HERE, "kdp-register.json");
const OUT_ROOT = process.env.KMP_KDP_DIR ?? join(process.env.HOME ?? ".", ".boss-os/kdp/keepmyproof");
const RAW = "https://raw.githubusercontent.com/seq23/keepmyproof/main/";
const ROSTER = "https://raw.githubusercontent.com/seq23/search-loop/main/config/free-models.json";
export const KDP_DRAFT_LIMIT = 10;

const stop = (code, msg, exit) => Object.assign(new Error(`NAMED STOP [${code}] ${msg}`), { code: exit, stop: code });

/* ── Which book ───────────────────────────────────────────────────────────────────────────────── */
export function nextBook(spec, register) {
  const have = new Set((register?.titles ?? []).filter((t) => t?.line === spec.line).map((t) => t.kmp_folder));
  return spec.books.find((b) => !have.has(b.folder)) ?? null;
}
/** KDP holds at most 10 unpublished drafts (spry brain). Every non-Live title counts against it. */
export const unpublished = (register) => (register?.titles ?? []).filter((t) => t?.status !== "LIVE").length;

/** The register row a draft adds: not on Amazon, waiting on her yes, counted by kdp-line-counts. */
export function registerEntry(book, { day, dir }) {
  return {
    title_ref: `draft:${book.slug}`, title: book.title, subtitle: book.subtitle, author: "S. L. Taylor", publisher: "Spry Labs",
    target: "LIVE", status: "DRAFT_LOCAL", status_as_of: day, line: "keepmyproof", kmp_folder: book.folder,
    ai_disclosure: true, draft_dir: dir.replace(process.env.HOME ?? "~", "~"),
    note: "Drafted, not on Amazon. Nothing uploads to KDP until she approves it in the Inbox (kdp_new_title); then kdp-new-title.mjs creates it in one pass and presses Publish, never Save as Draft (Save as Draft drops the AI disclosure).",
  };
}

/* ── Reading keepmyproof ──────────────────────────────────────────────────────────────────────── */
async function sourceReader(dir, fetchImpl = fetch) {
  return async (path, binary = false) => {
    if (dir) return binary ? readFile(join(dir, path)) : readFile(join(dir, path), "utf8");
    const r = await fetchImpl(RAW + path);
    if (!r.ok) throw stop("SOURCE_UNREAD", `could not read ${path} from seq23/keepmyproof (${r.status}); the next run retries.`, 2);
    return binary ? Buffer.from(await r.arrayBuffer()) : r.text();
  };
}

/* ── The writing ladder: free first, then Codex, then Claude; a named stop when all are spent ── */
const CHAPTER_RULES = (book) => `You write one chapter of a short, practical Kindle workbook for ${book.audience ?? "a stressed, ordinary reader on a phone"}.
Book: "${book.title}: ${book.subtitle}". Author S. L. Taylor. Published by Spry Labs, makers of the KeepMyProof app.
Voice: quiet and exact, like a good paralegal. Plain words, short sentences, "you" and "your". Warm but not chatty. No exclamation marks, no emoji, no hype.
HARD RULES (a chapter that breaks one is thrown away):
- Educational only. Never legal advice, never tell the reader what to file or what the law says, never predict what a judge, court, mediator or agency will do or likes.
- Never say a note, copy or record proves anything, is evidence, is admissible, court-ready, verified or guaranteed. Say "a record you kept".
- No numbers or digits at all, no statistics, no studies, no percentages, no dates, no links or website names. (Calling 911 in danger is the only exception.)
- Only what the reader already has, received or wrote. Never snooping on anyone's phone, email, accounts or location, never recording in secret, never hiding money.
- Examples are invented and use no names: "the other parent", "our child", "my manager".
- Do not mention any app or product, and do not end with a summary of the book.
FORMAT: 350 to 550 words. Plain paragraphs separated by blank lines. You may use up to three sub-headings, each on its own line starting with "## ", and short lists with lines starting with "- ". No title line, no bold, no markdown tables.`;

const chapterPrompt = (book, ch, problems) => `${CHAPTER_RULES(book)}

Chapter title: ${ch.title}
What this chapter covers: ${ch.brief}
${problems?.length ? `\nYour last attempt was thrown away for: ${problems.join("; ")}. Fix that.\n` : ""}
Write the chapter now. Output only the chapter text.`;

async function freeRoster(fetchImpl) {
  try {
    const r = await fetchImpl(ROSTER);
    const j = await r.json();
    if (j?.policy?.max_cost_usd !== 0 || j?.policy?.fallback_to_paid !== false) return { gemini: [], openrouter: [] };
    return {
      gemini: (j.gemini_models ?? []).map((m) => (typeof m === "string" ? { id: m } : m)),
      openrouter: (j.free_models ?? []).filter((m) => String(m?.pricing?.prompt) === "0" && String(m?.pricing?.completion) === "0" && m.id.endsWith(":free")).map((m) => m.id).filter((id) => !(id in (j.excluded_models ?? {}))),
    };
  } catch { return { gemini: [], openrouter: [] }; }
}
async function post(fetchImpl, url, key, body, ms = 90_000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetchImpl(url, { method: "POST", signal: c.signal, headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (j?.usage?.cost != null && Number(j.usage.cost) !== 0) throw stop("PAID_MODEL", `a free route reported usage.cost=${j.usage.cost}; refusing (agents never spend money).`, 9);
    return r.ok ? String(j?.choices?.[0]?.message?.content ?? "") : null;
  } catch (e) { if (e.stop) throw e; return null; } finally { clearTimeout(t); }
}
function aiRun(role, prompt) {
  const bin = process.env.AI_RUN_BIN ?? join(process.env.HOME ?? "", "bin/ai-run");
  if (!existsSync(bin)) return null;
  const marked = `${prompt}\n\nPut the chapter between a line reading <<<CHAPTER and a line reading CHAPTER>>>. Do not create or edit any file.`;
  const r = spawnSync(bin, ["--role", role, "--", marked], { encoding: "utf8", timeout: 15 * 60_000, maxBuffer: 16 << 20, env: { ...process.env, AI_RUN_CALLER: "kdp-kmp-draft" } });
  const m = /<<<CHAPTER\n([\s\S]*?)\nCHAPTER>>>/.exec(String(r.stdout ?? ""));
  return m ? m[1] : null;
}

/** One chapter, down the ladder, until a version passes the gate. Returns { blocks, model } or null. */
export async function writeChapter(book, ch, { fetchImpl = fetch, env = process.env, roster, log = () => {} } = {}) {
  let problems = [];
  const tryText = (raw, model) => {
    const blocks = L.parseChapter(raw);
    // Models often echo the chapter title as the first line; the book prints it once, as the heading.
    if (blocks && blocks[0] && (blocks[0].p ?? blocks[0].h)?.trim().toLowerCase() === ch.title.toLowerCase()) blocks.shift();
    if (!blocks) { problems = ["too short or empty"]; log(`  ${model}: too short`); return null; }
    problems = L.claimProblems(L.blocksText(blocks), { prose: true });
    if (problems.length) { log(`  ${model}: gate — ${problems.join("; ")}`); return null; }
    return { blocks, model };
  };
  const messages = () => [{ role: "user", content: chapterPrompt(book, ch, problems) }];
  if (env.GEMINI_API_KEY) for (const m of roster.gemini) {
    const raw = await post(fetchImpl, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", env.GEMINI_API_KEY, { model: m.id, messages: messages(), max_tokens: 3000, temperature: 0.4, reasoning_effort: m.reasoning_effort ?? "none" });
    if (raw != null) { const ok = tryText(raw, `gemini:${m.id}`); if (ok) return ok; }
  }
  if (env.OPENROUTER_API_KEY) for (const id of roster.openrouter.slice(0, 6)) {
    const raw = await post(fetchImpl, "https://openrouter.ai/api/v1/chat/completions", env.OPENROUTER_API_KEY, { model: id, messages: messages(), max_tokens: 4000, temperature: 0.4, reasoning: { enabled: false }, usage: { include: true }, provider: { allow_fallbacks: false } });
    if (raw != null) { const ok = tryText(raw, `openrouter:${id}`); if (ok) return ok; }
  }
  for (const role of ["worker", "brain"]) {
    const raw = aiRun(role, messages()[0].content);
    if (raw != null) { const ok = tryText(raw, `ai-run:${role}`); if (ok) return ok; }
  }
  return null;
}

/**
 * The review a person would do, for books the duty drafts unattended: Claude (ai-run brain) reads
 * every chapter against the rules and returns each one corrected. A review that returns nothing
 * keeps the gated draft and says so; it never blocks the draft (her look in the Inbox is the gate).
 */
function review(book, chapters, log) {
  const body = chapters.map((c, i) => `=== CHAPTER ${i + 1}: ${c.title}\n${L.blocksText(c.blocks)}`).join("\n\n");
  const prompt = `${CHAPTER_RULES(book)}\n\nYou are the reviewer. Read the chapters below as the real buyer would, on a phone, under stress. Fix anything that breaks a rule, anything vague, repeated or padded, and anything that would make a reader stop, guess or worry. Keep each chapter's format. Return every chapter, each between a line <<<CHAPTER and a line CHAPTER>>>, in order. Do not create or edit any file.\n\n${body}`;
  const bin = process.env.AI_RUN_BIN ?? join(process.env.HOME ?? "", "bin/ai-run");
  if (!existsSync(bin)) { log("review: ai-run missing; kept the gated drafts"); return chapters; }
  const r = spawnSync(bin, ["--role", "brain", "--", prompt], { encoding: "utf8", timeout: 20 * 60_000, maxBuffer: 16 << 20 });
  const got = [...String(r.stdout ?? "").matchAll(/<<<CHAPTER\n([\s\S]*?)\nCHAPTER>>>/g)].map((m) => L.parseChapter(m[1]));
  if (got.length !== chapters.length || got.some((b) => !b || L.claimProblems(L.blocksText(b), { prose: true }).length)) { log(`review: returned ${got.length}/${chapters.length} usable chapters; kept the gated drafts`); return chapters; }
  log("review: every chapter reviewed and re-gated");
  return chapters.map((c, i) => ({ ...c, blocks: got[i], reviewed: "ai-run:brain" }));
}

/* ── Packing ──────────────────────────────────────────────────────────────────────────────────── */
async function packEpub(dir, book, secs, day) {
  const tmp = join(dir, ".epub");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(join(tmp, "META-INF"), { recursive: true }); await mkdir(join(tmp, "OEBPS"), { recursive: true });
  await writeFile(join(tmp, "mimetype"), "application/epub+zip");
  await writeFile(join(tmp, "META-INF/container.xml"), `<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const { opf, nav, ncx } = L.packageFiles(book, secs, { id: randomUUID(), date: day });
  await writeFile(join(tmp, "OEBPS/content.opf"), opf); await writeFile(join(tmp, "OEBPS/nav.xhtml"), nav); await writeFile(join(tmp, "OEBPS/toc.ncx"), ncx);
  await writeFile(join(tmp, "OEBPS/book.css"), L.BOOK_CSS);
  for (const s of secs) await writeFile(join(tmp, `OEBPS/${s.id}.xhtml`), L.xhtml(s.title, s.html));
  const out = join(dir, "book.epub"); await rm(out, { force: true });
  execFileSync("zip", ["-X0q", out, "mimetype"], { cwd: tmp });
  execFileSync("zip", ["-Xr9Dq", out, "META-INF", "OEBPS"], { cwd: tmp });
  await rm(tmp, { recursive: true, force: true });
  return out;
}
async function shoot(dir, html, file, { width, height, type = "jpeg" }) {
  const { chromium } = await import("playwright");
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width, height } });
    await p.setContent(html, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: join(dir, file), type, ...(type === "jpeg" ? { quality: 92 } : {}), fullPage: false });
  } finally { await b.close(); }
}

/* ── One run ──────────────────────────────────────────────────────────────────────────────────── */
export async function run({ folder = null, next = false, rewrite = false, doReview = false, sourceDir = process.env.KMP_SOURCE ?? null, env = process.env, fetchImpl = fetch, log = console.log, now = new Date() } = {}) {
  const spec = JSON.parse(await readFile(SPEC_PATH, "utf8"));
  const register = JSON.parse(await readFile(REGISTER, "utf8"));
  const book0 = next ? nextBook(spec, register) : spec.books.find((b) => b.folder === folder);
  if (!book0 && next) return { count: 0, stop: "ALL_FIVE_DRAFTED", detail: `all ${spec.books.length} KeepMyProof books are on the register; nothing left to draft.` };
  if (!book0) throw stop("NO_SUCH_FOLDER", `"${folder}" is not one of ${spec.books.map((b) => b.folder).join(", ")}.`, 2);
  if (next && unpublished(register) >= KDP_DRAFT_LIMIT) throw stop("KDP_DRAFT_CAP", `${unpublished(register)} titles are not Live (KDP holds at most ${KDP_DRAFT_LIMIT} unpublished); publish or retire one first. The next run retries.`, 2);
  const book = { ...book0, author: spec.author };
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now);
  const dir = join(OUT_ROOT, book.folder);
  await mkdir(dir, { recursive: true });
  const read = await sourceReader(sourceDir, fetchImpl);

  const topics = JSON.parse(await read("topics.json"));
  const topic = topics.topics.find((t) => t.id === book.topic_id);
  const checklist = (topic?.checklist_items ?? []).map((c) => c.name.en);
  if (!checklist.length) throw stop("SOURCE_UNREAD", `topics.json has no checklist for ${book.topic_id}.`, 2);
  const files = {};
  for (const f of book.facts) files[f.file] = JSON.parse(await read(`site/data/facts/${book.folder}/${f.file}`));
  const verified = JSON.parse(await read(`site/data/verified/${book.folder}.json`));
  const states = L.selectFacts(book, files, verified);
  const facts = L.factCount(states);
  if (facts < 30) throw stop("NO_VERIFIED_FACTS", `only ${facts} quote-verified facts for ${book.folder}; a facts section that thin is not a book.`, 2);
  const checkedOn = states.flatMap((s) => s.groups.flatMap((g) => g.facts.map((f) => f.checked))).sort().at(-1) ?? day;

  // Chapters: kept once written (a reviewed chapter is never silently rewritten).
  const chPath = join(dir, "chapters.json");
  let chapters = !rewrite && existsSync(chPath) ? JSON.parse(await readFile(chPath, "utf8")) : null;
  if (!chapters || chapters.length !== book.chapters.length) {
    const roster = await freeRoster(fetchImpl);
    chapters = [];
    for (const ch of book.chapters) {
      log(`writing: ${ch.title}`);
      const got = await writeChapter(book, ch, { fetchImpl, env, roster, log });
      if (!got) throw stop("NO_MODEL", `no model wrote "${ch.title}" past the claim gate (free routes, Codex and Claude all tried). The next run retries; chapters written so far are not kept.`, 9);
      chapters.push({ id: ch.id, title: ch.title, blocks: got.blocks, model: got.model });
    }
    if (doReview) chapters = review(book, chapters, log);
    await writeFile(chPath, JSON.stringify(chapters, null, 2));
  }

  // The gate, over the whole book: model prose strictly, the rest for claim words.
  const prose = chapters.flatMap((c) => L.claimProblems(L.blocksText(c.blocks), { prose: true }).map((p) => `${c.title}: ${p}`));
  const desc = L.description(book, { where: L.whereLabel(states), facts, checklist });
  const listing = L.listingProblems(book, desc);
  if (prose.length || listing.length) throw stop("CLAIM_GATE", [...prose, ...listing].join(" | "), 1);

  const secs = L.sections(book, { chapters, checklist, states, checkedOn });
  const epub = await packEpub(dir, book, secs, day);

  const fonts = {
    serif: (await read("assets/site/noto-serif-700.woff2", true)).toString("base64"),
    sans: (await read("assets/site/noto-sans.woff2", true)).toString("base64"),
    mono: (await read("assets/site/noto-sans-mono-500.woff2", true)).toString("base64"),
  };
  const mark = (await read("assets/site/mark.svg")).replace(/width="\d+" height="\d+"/, "");
  await shoot(dir, L.coverHtml(book, { fonts, mark, checklist }), "cover.jpg", { width: 1600, height: 2560 });

  const meta = {
    folder: book.folder, title: book.title, subtitle: book.subtitle, author: spec.author, publisher: spec.publisher,
    description_html: desc, keywords: book.keywords, categories: book.categories, price_usd: book.price_usd, currency: spec.currency,
    language: spec.language, ai_disclosure: spec.ai_disclosure, drm: false, kdp_select: false,
    facts, states: states.length, where: L.whereLabel(states), checked_on: checkedOn, drafted_on: day,
    models: [...new Set(chapters.map((c) => c.model))], files: { epub: "book.epub", cover: "cover.jpg", preview: "preview.html" },
  };
  await writeFile(join(dir, "listing.json"), JSON.stringify(meta, null, 2));
  await writeFile(join(dir, "sections.json"), JSON.stringify(secs, null, 2));
  await writeFile(join(dir, "preview.html"), L.previewHtml(meta, secs, (await readFile(join(dir, "cover.jpg"))).toString("base64")));
  return { count: 1, book, dir, epub, meta, sections: secs, register: registerEntry(book, { day, dir }) };
}

/** Adds the draft's row to the register file (idempotent by title_ref). Returns true when it changed. */
export async function addToRegister(entry, path = REGISTER) {
  // Keeps the file's own shape: two-space JSON and a final newline, as committed.
  const reg = JSON.parse(await readFile(path, "utf8"));
  if (reg.titles.some((t) => t.title_ref === entry.title_ref)) return false;
  reg.titles.push(entry);
  await writeFile(path, `${JSON.stringify(reg, null, 2)}\n`);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const a = process.argv.slice(2);
  const val = (n) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : null; };
  if (a.includes("--register-only")) {
    // The register row for a draft already on this Mac, with no rebuild (kdp-register-pr.sh).
    const spec = JSON.parse(await readFile(SPEC_PATH, "utf8"));
    const book = spec.books.find((b) => b.folder === val("folder"));
    const listing = book && JSON.parse(await readFile(join(OUT_ROOT, book.folder, "listing.json"), "utf8").catch(() => "null"));
    if (!listing) { console.error(`NAMED STOP [NO_DRAFT] no draft for ${val("folder")} on this Mac.`); process.exit(2); }
    const changed = await addToRegister(registerEntry(book, { day: listing.drafted_on, dir: join(OUT_ROOT, book.folder) }), val("register") ?? REGISTER);
    console.log(`register: ${changed ? "added" : "already there"} draft:${book.slug}`);
    process.exit(0);
  }
  run({ folder: val("folder"), next: a.includes("--next"), rewrite: a.includes("--rewrite"), doReview: a.includes("--review"), sourceDir: val("source") ?? process.env.KMP_SOURCE ?? null })
    .then(async (r) => {
      if (!r.count) { console.error(`NAMED STOP [${r.stop}] ${r.detail}`); console.log(`OUTPUT 0 kmp-kindle-drafts -`); return; }
      if (a.includes("--register")) console.log(`register: ${(await addToRegister(r.register)) ? "added" : "already there"} ${r.register.title_ref}`);
      console.log(`draft: ${r.dir} — ${r.meta.facts} facts, ${r.meta.where}, ${r.sections.length} sections, models ${r.meta.models.join(", ")}`);
      console.log(`OUTPUT 1 kmp-kindle-drafts ${r.book.folder}`);
    })
    .catch((e) => { console.error(String(e?.message ?? e)); console.log("OUTPUT 0 kmp-kindle-drafts -"); process.exit(e?.code ?? 1); });
}
