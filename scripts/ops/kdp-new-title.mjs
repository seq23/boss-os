#!/usr/bin/env node
/**
 * A NEW KINDLE BOOK SHE APPROVED, PUT ON AMAZON AND FOLLOWED TO LIVE (owner, 7 Nov 2026: KeepMyProof
 * front-door books; her yes in the Inbox or her own words recorded there as `kdp_new_title`).
 * Simone runs it on her own every day (owner, 8 Nov 2026: "Yes, publish on her own"), and tells her.
 *
 * ─── What went wrong on 7–8 Nov 2026, and what stops it now ───────────────
 * "The Co-Parenting Log" was Live from 7 Nov, yet she was told to re-run three times and every run
 * pressed Create, leaving two duplicate drafts. The run never read the bookshelf BEFORE creating, and
 * after publishing it took the first row whose text held the title (a draft) and a case-sensitive
 * "Live". Now, before anything is typed:
 *   1. the bookshelf is read (`shelfRows`, every row with its KDP id, title, state, price, ASIN);
 *   2. `planTitle` matches the approved title to the bookshelf's "Title: Subtitle" rows and decides:
 *      Live → recorded, approval done, one "done" email · In review / Publishing → recorded, one line
 *      on her Updates page, followed to Live by the next daily run · Blocked → a stop to her ·
 *      a Draft → that draft is RESUMED ("Continue setup"), never a second one created · none → Create.
 *   It is read again in the visible run right before acting, so a book she finished by hand in the
 *   meantime is never created twice.
 *
 * ─── Sign-in: Simone first, then her hands in the window ──────────────────
 * Amazon asks for a fresh sign-in on every title-setup page (`ap/signin?max_auth_age=0`). Attended
 * runs leave it to the person at the Mac. Nothing ever solves a picture check. The
 * unattended run sends her a heads-up HEADS_UP_LEAD_MS before it opens Chrome; when Amazon asks for a
 * sign-in, Simone signs in once herself with the existing kdp-signin.mjs steps (her ruling 8 Nov 2026);
 * when that fails, Amazon shows a picture check, or anything else stops it, the window STAYS OPEN on that step, she is emailed at once with
 * the one thing to do there, and the run waits for her up to HANDOFF_MS: a sign-in done → it carries
 * on; a book she finished by hand → seen on the bookshelf, recorded, "done". Otherwise one
 * "still waiting" note, an Open Loops row the next good run clears, and the window closes cleanly.
 *
 * ─── What it does in the visible part ──────────────────────────────────────
 *   details  title, subtitle, author, description, own-the-rights, keywords, not adult, categories
 *   content  the EPUB, the cover, the AI disclosure (what the draft record says was made by AI)
 *   pricing  70% royalty and the approved US price, both read back, then — after reading the AI
 *            disclosure back on the content step — Publish. NEVER "Save as Draft" (drops the AI answers).
 * The result is what the BOOKSHELF says afterwards (In review, Live, …), recorded to Boss OS
 * (`POST /api/boss/kdp/new-titles/:id/attempt`; a LIVE record takes the title off her approved list).
 *
 *   npm run kdp:new-title                       # every approved new title, visible, she is present
 *   npm run kdp:new-title -- --title "The Co-Parenting Log"
 *   npm run kdp:new-title -- --dry-run          # everything except Publish (a KDP draft is left)
 *   … --unattended                              # kdp-publish.sh's daily slot: heads-up, emails, bounded waits
 *
 * Output: `KDP-NEW-TITLE: <state> — <detail>` per book and one census line `OUTPUT <n> kindle-titles-submitted`.
 * Exit 0 every approved title is In review or Live (or none approved) · 1 a field or step missing (named)
 *      3 a sign-in or a stop she did not finish within the wait · 4 no draft on this Mac
 *      5 the KDP Chrome profile is already open · 9 Amazon refused
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openProfile, profilePath } from "./browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const DRAFTS = process.env.KMP_KDP_DIR ?? join(process.env.HOME ?? ".", ".boss-os/kdp/keepmyproof");
const KDP = "https://kdp.amazon.com/en_US";
const SIGNIN_WAIT_MS = Number(process.env.KDP_SIGNIN_WINDOW_MS ?? 10 * 60_000);
/** How long before the unattended run opens Chrome she is told it will (owner, 8 Nov 2026). One constant. */
export const HEADS_UP_LEAD_MS = Number(process.env.KDP_HEADS_UP_LEAD_MS ?? 30 * 60_000);
/** How long an unattended stop keeps the window open for her before one "still waiting" note. One constant. */
export const HANDOFF_MS = Number(process.env.KDP_HANDOFF_MS ?? 2 * 60 * 60_000);
const WATCH_EVERY_MS = 60_000;
const STEP_MS = 90_000;
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const UNATTENDED = args.includes("--unattended");
const TO = process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com";
/** The one command she can run herself (from her boss-os checkout). */
export const runCommand = (title) => `cd ~/GitHub/boss-os && npm run kdp:new-title -- --title "${title}"`;

const stop = (code, msg, exit = 1) => Object.assign(new Error(`NAMED STOP [${code}] ${msg}`), { code: exit, stop: code });
const say = (state, detail) => console.log(`KDP-NEW-TITLE: ${state} — ${detail}`);
const SIGNIN = /\/ap\/(?:signin|mfa|cvf|challenge)|\/ap\/[a-z]*auth|captcha/i;

/** Maker names for the models a draft records (`listing.models`, e.g. "gemini:gemini-3.5-flash-lite"). Pure. */
export function toolNames(models) {
  const names = new Set();
  for (const m of models ?? []) {
    const id = String(m).toLowerCase();
    if (/gemini|gemma|google/.test(id)) names.add("Google Gemini");
    else if (/claude|anthropic|opus|sonnet|haiku/.test(id)) names.add("Anthropic Claude");
    else if (/codex|openai|gpt|o\d/.test(id)) names.add("OpenAI");
    else if (/llama|meta/.test(id)) names.add("Meta Llama");
    else if (/mistral/.test(id)) names.add("Mistral");
    else if (/qwen/.test(id)) names.add("Qwen");
    else if (/deepseek/.test(id)) names.add("DeepSeek");
    else names.add(String(m).split(":").pop());
  }
  return [...names].join("; ");
}

/**
 * Pure: the KDP AI-disclosure answers for a book, from what its DRAFT RECORD says was made by AI.
 * Hostile review, 8 Nov 2026: the old default claimed "Some sections, with extensive editing", AI
 * cover images and "Google Gemini; Anthropic Claude" for every book. The guide is written by the
 * free models the draft names, and nobody edits it extensively, so the honest default is the whole
 * work with minimal editing; the cover is drawn from the brand's own type and logo (not AI images)
 * unless the record says otherwise; the tools are the models the draft actually used. A book whose
 * record says it was edited can say so (`text_detail`, `images_detail`).
 */
export function aiAnswers(spec, listing = null) {
  const d = { ...(spec?.ai_disclosure ?? {}), ...(listing?.ai_disclosure ?? {}) };
  const texts = d.text_detail ?? (d.text === "none" ? "None" : "Entire work, with minimal or no editing");
  const images = d.images_detail ?? (d.images === "ai_generated" && d.cover_is_ai === true ? "One or a few AI-generated images, with minimal or no editing" : "None");
  const tools = d.tool_names ?? (toolNames(listing?.models) || "Google Gemini");
  return { used: texts !== "None" || images !== "None", texts, images, translations: "None", tools };
}

/** Pure: a bookshelf state word, any case ("LIVE" when CSS capitalises it), or null. */
export function shelfState(text) {
  const t = String(text ?? "").trim();
  if (/^live\b/i.test(t)) return "LIVE";
  if (/^in review\b/i.test(t)) return "IN_REVIEW";
  if (/^publishing\b/i.test(t)) return "PUBLISHING";
  if (/^blocked\b/i.test(t)) return "BLOCKED";
  if (/^draft\b/i.test(t)) return "DRAFT";
  return null;
}

/** Pure: a title compared loosely (case, dashes, quotes, spacing). */
export const normTitle = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u2018\u2019\u201c\u201d"']/g, "").replace(/\s+/g, " ").trim();

/**
 * Pure: is this bookshelf title the approved one? KDP lists "Title: Subtitle" (7 Nov: "The
 * Co-Parenting Log: A Custody Documentation Workbook …"), so equal, or the title then ":", " -",
 * " (" — never a mere substring ("The Co-Parenting Log Two" is another book).
 */
export function titleMatches(want, shelfTitle) {
  const w = normTitle(want), t = normTitle(shelfTitle);
  if (!w || !t) return false;
  return t === w || (t.startsWith(w) && /^\s*(:|-|\(|\u2013|\u2014)/.test(t.slice(w.length)));
}

/**
 * Pure: one bookshelf row's lines → what it says. The state is the Kindle eBook's own state line
 * (the first state word after "Kindle eBook"; a paperback below it is ignored).
 */
export function parseShelfRow(lines) {
  const L = (lines ?? []).map((x) => String(x).trim()).filter(Boolean);
  const byAt = L.findIndex((l) => /^by\s+/i.test(l));
  const title = byAt > 0 ? L[byAt - 1] : L[0] ?? "";
  const kindleAt = L.findIndex((l) => /^kindle e-?book$/i.test(l));
  const from = kindleAt >= 0 ? kindleAt + 1 : 0;
  const paperAt = L.findIndex((l, i) => i > from && /^(paperback|hardcover)$/i.test(l));
  const scope = L.slice(from, paperAt > 0 ? paperAt : undefined);
  const state = scope.map(shelfState).find(Boolean) ?? null;
  const text = scope.join(" ");
  const price = /\$\s?(\d+(?:\.\d{2})?)\s*USD/i.exec(text)?.[1];
  return {
    title, author: byAt >= 0 ? L[byAt].replace(/^by\s+/i, "") : "", state,
    asin: /ASIN:?\s*([A-Z0-9]{10})/.exec(L.join(" "))?.[1] ?? null,
    price_usd: price ? Number(price) : null,
  };
}

/**
 * In-page (and fixture-tested): every title on the bookshelf page, keyed by the KDP id in its links.
 * Self-contained (runs through `page.evaluate`). The row is the nearest ancestor of a title link
 * whose text holds exactly one "by …" line, so a block holding two books is never read as one.
 * @returns {{ id: string, lines: string[] }[]}
 */
export function shelfRowsIn(doc) {
  const linesOf = (el) => {
    if (typeof el.innerText === "string" && el.innerText.includes("\n")) return el.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
    const out = [];
    const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) { const t = c.textContent.trim(); if (t) out.push(t); } else if (c.nodeType === 1 && !/^(SCRIPT|STYLE)$/.test(c.tagName)) walk(c); } };
    walk(el);
    return out;
  };
  const bys = (ls) => ls.filter((l) => /^by\s+/i.test(l)).length;
  const seen = new Map();
  for (const a of doc.querySelectorAll('a[href*="/title-setup/kindle/"], a[href*="/marketing/"], a[href*="/bookshelf/"]')) {
    const m = /\/(?:title-setup\/kindle|marketing|bookshelf\/[a-z-]+)\/([A-Z0-9]{10,16})(?:\/|\?|$)/.exec(a.getAttribute("href") || "");
    if (!m || seen.has(m[1])) continue;
    let row = null;
    for (let el = a.parentElement, i = 0; el && i < 14; el = el.parentElement, i += 1) {
      const n = bys(linesOf(el));
      if (n > 1) break;
      if (n === 1 && linesOf(el).some((l) => /^kindle e-?book$/i.test(l))) { row = el; break; }
    }
    if (row) seen.set(m[1], linesOf(row));
  }
  return [...seen].map(([id, lines]) => ({ id, lines }));
}

/**
 * Pure: what to do for one approved title, given the bookshelf rows (newest first, as KDP sorts).
 *   done      a Live row: record it, mark the approval done, tell her once
 *   watch     In review / Publishing: record it; the next daily run follows it to Live
 *   blocked   Amazon blocked it: a stop only she can clear
 *   resume    a Draft exists: continue THAT draft (never a second one); `extra` are duplicates to name
 *   create    nothing on the shelf: Create
 */
export function planTitle(title, rows, { kindleOnPage = 0 } = {}) {
  const mine = (rows ?? []).map((r) => ({ ...r, ...parseShelfRow(r.lines) })).filter((r) => titleMatches(title, r.title));
  const drafts = mine.filter((r) => r.state === "DRAFT");
  const pick = (st) => mine.find((r) => r.state === st);
  const live = pick("LIVE");
  if (live) return { action: "done", row: live, extra: drafts };
  const review = pick("IN_REVIEW") ?? pick("PUBLISHING");
  if (review) return { action: "watch", row: review, extra: drafts };
  const blocked = pick("BLOCKED");
  if (blocked) return { action: "blocked", row: blocked, extra: drafts };
  if (drafts.length) return { action: "resume", row: drafts[0], extra: drafts.slice(1) };
  if (mine.length) return { action: "unknown", row: mine[0], extra: [] };
  // The page shows more Kindle books than were read as rows: the reader is blind, so "absent" is unproven.
  if (kindleOnPage > (rows ?? []).length) return { action: "unknown", row: null, extra: [] };
  return { action: "create", row: null, extra: [] };
}

/**
 * In-page (and fixture-tested in tests/kdpNewTitleUpload.test.ts): what an upload on KDP's content
 * step shows right now. Runs inside the page via `page.evaluate`, so it is self-contained.
 *
 * 7 Nov 2026 the cover upload stopped as UPLOAD_NOT_CONFIRMED after 6 minutes. The old wait was
 * `getByText(/Cover uploaded successfully/).first().waitFor()`: the FIRST matching element in the
 * page, waited on until visible. KDP's page (Amazon AUI) keeps its status messages in the DOM,
 * hidden with `aok-hidden`/`a-hidden` until they apply, so a hidden copy earlier in the DOM never
 * becomes visible and the wait runs out even after Amazon shows "Cover uploaded successfully!"
 * with the cover thumbnail (KDP help G200641240). Here only SHOWN elements count, the new cover
 * thumbnail counts too, and a shown error is Amazon's refusal, named with its own words.
 *
 * @returns {{ state: "done"|"refused"|"working"|"waiting", via: string|null, text: string }}
 */
export function uploadStatus(doc, kind, inputSel, beforeSrcs = []) {
  const shown = (el) => {
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkVisibilityCSS: true })) return false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cls = typeof e.className === "string" ? e.className : (e.getAttribute("class") ?? "");
      if (e.hidden || /(^|\s)(aok-hidden|a-hidden|hidden|a-hide)(\s|$)/.test(cls)) return false;
      const cs = doc.defaultView?.getComputedStyle?.(e);
      if (cs && (cs.display === "none" || cs.visibility === "hidden")) return false;
    }
    return true;
  };
  const text = (el) => String(el.textContent ?? "").replace(/\s+/g, " ").trim();
  const okRe = kind === "cover" ? /cover\b[^.!]{0,80}uploaded successfully/i : /manuscript\b[^!]{0,200}uploaded successfully/i;
  const word = kind === "cover" ? /cover/i : /manuscript|e-?book file|interior/i;
  const input = doc.querySelector(inputSel);
  // The upload's own section: the input's nearest ancestor holding a heading-ish mention of it.
  let section = input?.parentElement ?? doc.body;
  for (let e = section, i = 0; e && i < 8; e = e.parentElement, i += 1) { section = e; if (word.test(text(e)) && e.querySelector("img, .a-alert, [class*='alert']")) break; }
  // Leaf-most shown element whose text says it uploaded.
  for (const el of doc.querySelectorAll("body *")) {
    if (!okRe.test(text(el)) || [...el.children].some((c) => okRe.test(text(c)))) continue;
    if (shown(el)) return { state: "done", via: "message", text: text(el).slice(0, 200) };
  }
  const errs = [...doc.querySelectorAll(".a-alert-error, .a-color-error, [role='alert']")].filter((el) => shown(el) && text(el) && (section.contains(el) || word.test(text(el))));
  if (errs.length) return { state: "refused", via: "error", text: errs.map(text).join(" ").slice(0, 400) };
  const busy = [...section.querySelectorAll("*")].some((el) => shown(el) && /^(uploading|processing|converting)\b/i.test(text(el)) && el.children.length === 0);
  if (busy) return { state: "working", via: null, text: "" };
  if (kind === "cover") {
    const thumb = [...section.querySelectorAll("img")].find((im) => {
      const src = im.getAttribute("src") ?? "";
      return src && !beforeSrcs.includes(src) && !/spinner|loading|placeholder|transparent|grey-pixel|blank/i.test(src) && shown(im);
    });
    if (thumb) return { state: "done", via: "thumbnail", text: "" };
  }
  return { state: "waiting", via: null, text: "" };
}

/**
 * In-page (and fixture-tested): one step of KDP's category chooser. Picks `label` in the first
 * dropdown that offers it, else ticks the checkbox carrying it. Names compare loosely ("&" = "and",
 * case and punctuation ignored), because the book file says "Family & Relationships" and AUI pages
 * vary. AUI dropdowns are a native <select> behind a styled button, so the select itself may be
 * visually hidden; it is set and its change event fired, which is what AUI listens to.
 * `boxesOnly` skips the dropdowns (a leaf just chosen in one may then offer its own tick box).
 * @returns {{ did: "selected"|"ticked"|"already"|"missing", seen: string[] }}
 */
export function categoryStep(root, label, boxesOnly = false) {
  const norm = (s) => String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  const want = norm(label);
  const off = (el) => { for (let e = el; e && e !== root; e = e.parentElement) { const c = e.getAttribute("class") ?? ""; if (e.hidden || /(^|\s)(aok-hidden|a-hidden)(\s|$)/.test(c)) return true; } return false; };
  const seen = [];
  for (const sel of boxesOnly ? [] : root.querySelectorAll("select")) {
    if (off(sel)) continue;
    const opts = [...sel.options];
    seen.push(...opts.map((o) => o.text.trim()).filter(Boolean));
    const opt = opts.find((o) => norm(o.text) === want);
    if (!opt) continue;
    if (sel.value === opt.value) return { did: "already", seen };
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    return { did: "selected", seen };
  }
  for (const box of root.querySelectorAll('input[type="checkbox"]')) {
    if (off(box)) continue;
    const doc = box.ownerDocument;
    const name = (box.id && doc.querySelector(`label[for="${box.id}"]`)?.textContent) || box.closest("label")?.textContent || box.getAttribute("aria-label") || box.parentElement?.textContent || "";
    seen.push(String(name).trim());
    if (norm(name) !== want) continue;
    if (box.checked) return { did: "already", seen };
    box.click();
    return { did: "ticked", seen };
  }
  return { did: "missing", seen: [...new Set(seen)].slice(0, 40) };
}

/** On a stop, keep what the page showed (HTML + screenshot) next to the draft, for the next root cause. */
async function snapshot(page, dir, name) {
  try {
    await writeFile(join(dir, `${name}.html`), await page.content());
    await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    return join(dir, `${name}.png`);
  } catch { return null; }
}

/* ── Sign-in: Simone once (unattended), else her hands in the window ────────────────────────── */
/**
 * What the run does while Amazon shows a sign-in, MFA, CAPTCHA or challenge page. `run` is the
 * run's own settings (exported for the test): attended → print one line, wait SIGNIN_WAIT_MS;
 * unattended → Simone signs in once (`run.autoSignin`, the existing kdp-signin.mjs steps); if that
 * fails or Amazon shows a picture check, tell her at once by email (`run.tellSignin`, BEFORE any
 * wait), leave the window up, and wait up to `run.handoffMs`. Never solves a picture check; a page that is
 * still a sign-in at the ceiling is the named stop SIGNIN_NOT_DONE.
 */
export const RUN = { unattended: false, handoffMs: HANDOFF_MS, signinMs: SIGNIN_WAIT_MS, tellSignin: async () => {}, autoSignin: null, lastUrl: null, title: null };
export async function waitForHer(page, run = RUN) {
  if (!SIGNIN.test(page.url())) return;
  const ceiling = run.unattended ? run.handoffMs : run.signinMs;
  const mins = Math.round(ceiling / 60_000);
  // SIMONE SIGNS IN FIRST (her ruling 8 Nov 2026, "it is okay for simone to sign in to amazon kdp for
  // me", reaffirming 21 Sep): the existing kdp-signin.mjs steps on this same window, once per visit.
  // Signed in → carry on, no email. A picture check, a phone push or any failure → she is told.
  if (run.unattended && run.autoSignin) {
    const r = await run.autoSignin(page, run.lastUrl).catch((e) => ({ code: 1, state: "failed", detail: String(e?.message ?? e).slice(0, 200) }));
    console.log(`KDP-SIGNIN: ${r.state} — ${String(r.detail ?? "").slice(0, 200)}`);
    if (r.code === 0 && !SIGNIN.test(page.url())) { console.log(">>> Simone signed in. Carrying on.\n"); return; }
  }
  if (run.unattended) await run.tellSignin();
  else console.log(`\n>>> SIGN IN NEEDED: Amazon is asking you to sign in again. Do it in the Chrome window that is open (password, code, or picture check). This run waits up to ${mins} minutes and then carries on by itself.\n`);
  for (let waited = 0; waited < ceiling; waited += 2000) {
    await page.waitForTimeout(2000);
    if (!SIGNIN.test(page.url())) { console.log(">>> Signed in. Carrying on.\n"); await page.waitForLoadState("domcontentloaded").catch(() => {}); return; }
  }
  throw stop("SIGNIN_NOT_DONE", `Amazon's sign-in was not finished within ${mins} minutes. Nothing was published.`, 3);
}
async function go(page, url) { RUN.lastUrl = url; await page.goto(url, { waitUntil: "domcontentloaded", timeout: STEP_MS }); await waitForHer(page); }

/** The first selector that exists and is visible. */
async function first(page, sels) {
  for (const s of sels) {
    const l = typeof s === "string" ? page.locator(s) : s(page);
    if (await l.count().catch(() => 0)) { const f = l.first(); if (await f.isVisible().catch(() => false)) return f; }
  }
  return null;
}
async function fillField(page, name, sels, value) {
  const el = await first(page, sels);
  if (!el) throw stop("FIELD_NOT_FOUND", `the ${name} box is not on the page; nothing was saved past this step.`);
  await el.fill(String(value));
  const back = await el.inputValue();
  if (back !== String(value)) throw stop("FIELD_DID_NOT_TAKE", `the ${name} box reads "${back}" after filling "${value}".`);
}
async function clickOne(page, name, sels) {
  const el = await first(page, sels);
  if (!el) throw stop("CONTROL_NOT_FOUND", `the ${name} control is not on the page.`);
  await el.click();
  await waitForHer(page);
}

/* ── The three steps ────────────────────────────────────────────────────────────────────────── */
/** `ref`: the KDP id of the draft being resumed, or null to Create (only when the bookshelf has none). */
async function details(page, book, dir, ref = null) {
  await go(page, `${KDP}/title-setup/kindle/${ref ?? "new"}/details`);
  await fillField(page, "title", ['input[name="data[title]"]', "#data-title", (p) => p.getByLabel(/^Book Title/i)], book.title);
  await fillField(page, "subtitle", ['input[name="data[subtitle]"]', "#data-subtitle", (p) => p.getByLabel(/^Subtitle/i)], book.subtitle);
  const [firstName, lastName] = [book.author.split(" ").slice(0, -1).join(" "), book.author.split(" ").at(-1)];
  await fillField(page, "author first name", ['input[name="data[primary_author][first_name]"]', "#data-primary-author-first-name"], firstName);
  await fillField(page, "author last name", ['input[name="data[primary_author][last_name]"]', "#data-primary-author-last-name"], lastName);
  // Description: KDP's description is a CKEditor 4 instance ("editor1", inside an iframe) that loads
  // AFTER the title boxes, backed by a hidden INPUT data[description] (not a textarea). 7 Nov 2026: the
  // first live run filled title/subtitle/author, then found no editor because CKEditor wasn't ready yet.
  // So wait for a ready instance, set it, and read the editor back.
  await page.waitForFunction(() => {
    const C = window.CKEDITOR;
    return !!C?.instances && Object.values(C.instances).some((e) => e.status === "ready");
  }, null, { timeout: 30000 }).catch(() => {});
  const set = await page.evaluate((html) => {
    const C = window.CKEDITOR;
    const eds = C?.instances ? Object.values(C.instances).filter((e) => e.status === "ready") : [];
    for (const e of eds) e.setData(html);
    for (const el of document.querySelectorAll('input[name="data[description]"], textarea[name="data[description]"]')) { el.value = html; el.dispatchEvent(new Event("change", { bubbles: true })); }
    return eds.length > 0;
  }, book.description_html);
  if (set) {
    await page.waitForTimeout(500);
    const back = await page.evaluate(() => Object.values(window.CKEDITOR.instances).map((e) => e.getData()).join(""));
    if (!back || back.replace(/<[^>]+>|\s/g, "").length < 40) throw stop("FIELD_DID_NOT_TAKE", "the description editor reads empty after filling it; nothing was saved.");
  }
  if (!set) throw stop("FIELD_NOT_FOUND", "the description editor is not on the page; nothing was saved.");
  await clickOne(page, "own-the-copyright choice", ['input[name="data-is-public-domain"][value="false"]', 'input[name="data[is_public_domain]"][value="false"]', "#non-public-domain", (p) => p.getByLabel(/I own the copyright/i)]);
  for (let i = 0; i < 7; i += 1) await fillField(page, `keyword ${i + 1}`, [`input[name="data[keywords][${i}]"]`, `#data-keywords-${i}`], book.keywords[i]);
  // The adult question first: KDP refuses to open the category chooser until it is answered
  // ("Answer the Adult-only question before choosing a category", live page 7 Nov 2026).
  const adult = await first(page, ['input[name="data[is_adult_content]-radio"][value="false"]', 'input[name="data[is_adult_content]"][value="false"]', "#data-is-adult-content-false"]);
  if (adult) await adult.check();
  await categories(page, book.categories, dir);
  if (DRY) say("DRY_RUN", "details filled; Save and Continue is pressed even in a dry run (a KDP draft is left)");
  await clickOne(page, "Save and Continue", ["#save-and-continue-announce", (p) => p.getByRole("button", { name: /Save and Continue/i })]);
  await page.waitForURL(/\/content/, { timeout: STEP_MS }).catch(() => {});
  await waitForHer(page);
  if (!/\/content/.test(page.url())) throw stop("DETAILS_NOT_SAVED", `Amazon did not move on from the details step: ${(await page.locator(".a-alert-content, .a-color-error").allInnerTexts().catch(() => [])).join(" ").slice(0, 300) || "no message shown"}.`, 9);
}

/**
 * Categories: set by the run itself, never by her (her coordinator, 7 Nov 2026, after a run that
 * waited 10 minutes on her and stopped CATEGORIES_NOT_SET).
 */
async function categories(page, cats, dir) {
  // KDP's Kindle chooser (read live 7 Nov 2026): a modal with a "Category" select, a "Subcategory"
  // select, then checkboxes for the leaves; up to 3 placements; Save closes it and the page button
  // turns from "Choose categories" to "Edit categories". That button text is what "set" means here.
  // Old faults: a two-level path ("Family & Relationships › Divorce & Separation") gave up when the
  // second name was a checkbox rather than a subcategory option; the label match was exact text;
  // and Save was looked for as <button>/<input> WITH text, which an AUI button (a text-less
  // input.a-button-input under a span) never is, so even ticked boxes were never saved.
  const btn = page.locator("#categories-modal-button");
  const isSet = async () => /Edit categories/i.test((await btn.innerText().catch(() => "")) || "");
  if (await isSet()) return;
  await clickOne(page, "Choose categories", ["#categories-modal-button", (p) => p.getByRole("button", { name: /(Choose|Edit) categories/i })]);
  await page.waitForTimeout(1500);
  const modal = (await page.locator('.a-popover[aria-hidden="false"]').count()) ? page.locator('.a-popover[aria-hidden="false"]').last() : page.locator('[role="dialog"]').last();
  // Mark the open box, then run the step as a page expression (a string evaluate needs no eval in
  // the page, which Amazon's content-security policy may forbid).
  await modal.evaluate((el) => { document.querySelectorAll("[data-kmp-cat]").forEach((x) => x.removeAttribute("data-kmp-cat")); el.setAttribute("data-kmp-cat", "1"); }).catch(() => {});
  const step = (label, boxesOnly = false) => `(${categoryStep})(document.querySelector('[data-kmp-cat="1"]'), ${JSON.stringify(label)}, ${boxesOnly})`;
  let ticked = 0;
  const missed = [];
  for (const path of cats) {
    const parts = path.split("›").map((x) => x.trim()).filter(Boolean);
    for (const [i, part] of parts.entries()) {
      let r = { did: "missing", seen: [] };
      for (let t = 0; t < 12 && r.did === "missing"; t += 1) { r = await page.evaluate(step(part)).catch(() => r); if (r.did === "missing") await page.waitForTimeout(700); }
      if (r.did === "missing") { missed.push(`"${part}" (in ${path}); the box offered: ${r.seen.slice(0, 15).join(", ") || "nothing"}`); break; }
      const last = i === parts.length - 1;
      // A leaf KDP lists as a dropdown option may then offer its own tick box; tick it if so.
      if (last && r.did === "selected") { await page.waitForTimeout(900); const b = await page.evaluate(step(part, true)).catch(() => null); if (b && b.did !== "missing") r = b; }
      if (last && r.did !== "missing") ticked += 1;
      await page.waitForTimeout(900);
    }
  }
  if (ticked) {
    const save = await first(page, [
      (p) => modal.getByRole("button", { name: /^\s*save/i }),
      (p) => modal.locator(".a-button").filter({ hasText: /^\s*save/i }).locator("input, button"),
      (p) => modal.locator("button, input[type=submit], .a-button-text").filter({ hasText: /save/i }),
    ]);
    if (save) await save.click().catch(() => {});
    for (let t = 0; t < 10 && !(await isSet()); t += 1) await page.waitForTimeout(1000);
    if (await isSet()) { console.log(`categories set: ${ticked} of ${cats.length}${missed.length ? ` (not found: ${missed.join("; ")})` : ""}.`); return; }
  }
  const shot = await snapshot(page, dir, "stop-categories");
  throw stop("CATEGORIES_NOT_SET", `KDP's category box did not take ${cats.join(" and ")}${missed.length ? `: not found ${missed.join("; ")}` : ticked ? ": ticked but Save did not close the box" : ""}. Nothing was saved past the details step. Page kept at ${shot ?? "(screenshot failed)"}.`);
}

const UPLOAD_MS = 6 * 60_000;
async function upload(page, kind, sels, file, dir) {
  const name = kind === "cover" ? "cover" : "manuscript";
  const sel = sels.join(", ");
  const input = page.locator(sel);
  if (!(await input.count())) throw stop("FIELD_NOT_FOUND", `the ${name} upload is not on the page.`);
  const before = await page.evaluate(() => [...document.images].map((i) => i.getAttribute("src") ?? ""));
  await input.first().setInputFiles(file);
  const probe = `(${uploadStatus})(document, ${JSON.stringify(kind)}, ${JSON.stringify(sel)}, ${JSON.stringify(before)})`;
  const deadline = Date.now() + UPLOAD_MS;
  let last = { state: "waiting" };
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    await waitForHer(page);
    last = await page.evaluate(probe).catch(() => last);
    if (last.state === "done") { console.log(`${name} upload confirmed by Amazon (${last.via}${last.text ? `: "${last.text}"` : ""}).`); return last; }
    if (last.state === "refused") { await snapshot(page, dir, `stop-${kind}-refused`); throw stop("UPLOAD_REFUSED", `Amazon refused the ${name}: ${last.text}`, 9); }
  }
  const shot = await snapshot(page, dir, `stop-${kind}-not-confirmed`);
  throw stop("UPLOAD_NOT_CONFIRMED", `Amazon showed neither "${name} uploaded successfully" nor a ${kind === "cover" ? "cover thumbnail" : "confirmation"} within 6 minutes (last seen: ${last.state}). Page kept at ${shot ?? "(screenshot failed)"}.`, 9);
}

/**
 * In-page (and fixture-tested): reads KDP's AI question. Amazon draws it as an AUI accordion
 * (8 Nov 2026 stop page): "Yes"/"No" are `[data-a-accordion-row-name]` rows whose `role="radio"`
 * div carries aria-checked, NOT radio inputs, and each answer is a native <select> inside a span
 * labelled `generative-ai-questionnaire-<text|images|translations>-label`.
 * @returns {{ found: boolean, yes: boolean, selects: Record<string,string>, options: Record<string,string[]>, tools: Record<string,string|null> }}
 */
export function aiState(doc) {
  const root = doc.querySelector('[data-a-accordion-name="generative-ai-questionnaire-accordion"], [aria-labelledby="generative-ai-questionnaire-question"]');
  const out = { found: !!root, yes: false, selects: {}, options: {}, tools: {} };
  if (!root) return out;
  const yesRow = root.querySelector('[data-a-accordion-row-name="yes"]');
  const radio = yesRow?.querySelector('[role="radio"]');
  out.yes = radio?.getAttribute("aria-checked") === "true" || /a-icon-radio-active/.test(yesRow?.querySelector("i")?.getAttribute("class") ?? "");
  for (const key of ["text", "images", "translations"]) {
    const sel = root.querySelector(`[aria-labelledby="generative-ai-questionnaire-${key}-label"] select`);
    if (!sel) continue;
    out.options[key] = [...sel.options].map((o) => o.text.trim());
    out.selects[key] = sel.selectedIndex > 0 ? sel.options[sel.selectedIndex].text.trim() : "";
  }
  const ph = { text: "e.g. ChatGPT", images: "e.g. DALL-E" };
  for (const [key, p] of Object.entries(ph)) {
    const inp = root.querySelector(`input[placeholder="${p}"], textarea[placeholder="${p}"]`);
    out.tools[key] = inp ? (inp.value ?? "") : null;
  }
  return out;
}

/** Sets the AI answers (Yes, texts, images, translations, tool names) and reads them back. */
async function aiDisclosure(page, ans, { write }) {
  const read = () => page.evaluate(`(${aiState})(document)`);
  let st = await read();
  if (!st.found) throw stop("AI_DISCLOSURE_NOT_FOUND", "the AI-generated content question is not on the content step; nothing was published.");
  const root = page.locator('[data-a-accordion-name="generative-ai-questionnaire-accordion"], [aria-labelledby="generative-ai-questionnaire-question"]').first();
  if (write) {
    if (!st.yes) {
      const yes = root.locator('[data-a-accordion-row-name="yes"] a.a-accordion-row, [data-a-accordion-row-name="yes"] [role="radio"]').first();
      if (!(await yes.count())) throw stop("AI_DISCLOSURE_NOT_FOUND", "no Yes answer in the AI question.");
      await yes.click();
      await page.waitForTimeout(1000);
    }
    const want = { text: ans.texts, images: ans.images, translations: ans.translations };
    for (const [key, label] of Object.entries(want)) {
      const sel = root.locator(`[aria-labelledby="generative-ai-questionnaire-${key}-label"] select`).first();
      if (!(await sel.count())) throw stop("AI_DISCLOSURE_NOT_FOUND", `no ${key} answer in the AI question.`);
      const opts = st.options[key] ?? (await read()).options[key] ?? [];
      if (opts.length && !opts.some((o) => o.toLowerCase() === label.toLowerCase())) throw stop("AI_DISCLOSURE_NOT_SET", `KDP's ${key} answer offers ${JSON.stringify(opts)}, not "${label}"; nothing was published.`);
      await sel.selectOption({ label }, { force: true });
      await page.waitForTimeout(600);
    }
    for (const [key, p] of Object.entries({ text: "e.g. ChatGPT", images: "e.g. DALL-E" })) {
      if (/^none$/i.test(want[key])) continue;
      const inp = root.locator(`input[placeholder="${p}"], textarea[placeholder="${p}"]`).first();
      if ((await inp.count()) && !(await inp.inputValue())) await inp.fill(ans.tools);
    }
    await page.waitForTimeout(800);
    st = await read();
  }
  const result = { yes: st.yes, selects: st.selects, tools: st.tools };
  const eq = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
  const ok = st.yes && eq(st.selects.text, ans.texts) && eq(st.selects.images, ans.images) && eq(st.selects.translations, ans.translations);
  if (!ok) throw stop("AI_DISCLOSURE_NOT_SET", `the AI answers read back as ${JSON.stringify(result)}; nothing was published.`);
  return result;
}

const COVER_CHOICE_MS = 8 * 60_000;
/** KDP's cover choice is an AUI accordion; open the "Upload a cover you already have" row and prove it is open. */
async function chooseCoverUpload(page, dir) {
  const row = page.locator('[data-a-accordion-row-name="upload"]').first();
  const isOpen = async () => (await row.locator("[aria-expanded]").first().getAttribute("aria-expanded").catch(() => null)) === "true"
    || /a-icon-radio-active/.test((await row.locator("i.a-accordion-radio").first().getAttribute("class").catch(() => "")) ?? "");
  if (await row.count()) {
    // KDP keeps this row disabled while the manuscript is still "Processing your file…"
    // (8 Nov 2026 stop page: data[cover_upload_disabled]), so a single click is ignored.
    // Keep trying until it opens, up to COVER_CHOICE_MS; force past the "Save Successful!" overlay.
    const deadline = Date.now() + COVER_CHOICE_MS;
    while (Date.now() < deadline) {
      if (await isOpen()) return;
      await row.locator("a.a-accordion-row").first().click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(5000);
    }
    if (await isOpen()) return;
  } else {
    const alt = await first(page, [(p) => p.getByLabel(/Upload a cover you already have/i), (p) => p.getByText(/Upload a cover you already have/i)]);
    if (alt) { await alt.click(); return; }
  }
  const shot = await snapshot(page, dir, "stop-cover-choice");
  throw stop("COVER_CHOICE_NOT_SET", `"Upload a cover you already have" did not open; nothing was published. Page kept at ${shot ?? "(screenshot failed)"}.`);
}

async function content(page, dir, ans) {
  if (!/\/content/.test(page.url())) throw stop("WRONG_STEP", `expected the content step, at ${page.url()}.`);
  await upload(page, "manuscript", ['#data-assets-interior-file-upload-AjaxInput', 'input[type="file"][id*="interior"]', 'input[type="file"][name*="interior"]'], join(dir, "book.epub"), dir);
  await chooseCoverUpload(page, dir);
  await upload(page, "cover", ['#data-assets-cover-file-upload-AjaxInput', 'input[type="file"][id*="cover"]', 'input[type="file"][name*="cover"]'], join(dir, "cover.jpg"), dir);
  await aiDisclosure(page, ans, { write: true });
  await clickOne(page, "Save and Continue", ["#save-and-continue-announce", (p) => p.getByRole("button", { name: /Save and Continue/i })]);
  await page.waitForURL(/\/pricing/, { timeout: STEP_MS }).catch(() => {});
  await waitForHer(page);
  if (!/\/pricing/.test(page.url())) throw stop("CONTENT_NOT_SAVED", "Amazon did not move on from the content step.", 9);
}

/** The last step: read the AI disclosure back on the content step, then price, then Publish. */
async function pricingAndPublish(page, book, ans) {
  const base = page.url().replace(/\/pricing.*$/, "");
  await go(page, `${base}/content`);
  const seen = await aiDisclosure(page, ans, { write: false });
  console.log(`AI disclosure read back before Publish: ${JSON.stringify(seen)}`);
  await go(page, `${base}/pricing`);
  const royalty = await first(page, [(p) => p.getByLabel(/^70%/), 'input[value="SEVENTY"]', 'input[name*="royalty"][value*="70"]']);
  if (!royalty) throw stop("FIELD_NOT_FOUND", "the 70% royalty choice is not on the pricing step.");
  await royalty.check();
  if (!(await royalty.isChecked().catch(() => false))) throw stop("FIELD_DID_NOT_TAKE", "the 70% royalty choice reads unticked after choosing it; nothing was published.");
  await fillField(page, "Amazon.com price", ['input[name="data[digital_list_price][USD]"]', 'input[id*="price"][id*="US"]', (p) => p.locator("tr, .a-row").filter({ hasText: "Amazon.com" }).locator('input[type="text"]')], book.price_usd.toFixed(2));
  // Read the price back as Amazon will use it (the box, not what was typed), right before Publish.
  const priceBox = await first(page, ['input[name="data[digital_list_price][USD]"]', 'input[id*="price"][id*="US"]']);
  const shown = priceBox ? Number(String(await priceBox.inputValue().catch(() => "")).replace(/[^0-9.]/g, "")) : NaN;
  if (priceBox && Math.abs(shown - book.price_usd) > 0.001) throw stop("PRICE_NOT_SET", `the Amazon.com price reads $${shown} and the approved price is $${book.price_usd.toFixed(2)}; nothing was published.`);
  if (DRY) return { published: false };
  await clickOne(page, "Publish Your Kindle eBook", [(p) => p.getByRole("button", { name: /Publish Your Kindle eBook/i }), "#save-and-publish-announce"]);
  await page.waitForTimeout(8000);
  const err = (await page.locator(".a-alert-error .a-alert-content, .a-color-error").allInnerTexts().catch(() => [])).join(" ").trim();
  if (err) throw stop("PUBLISH_REFUSED", `Amazon refused Publish: ${err.slice(0, 400)}`, 9);
  return { published: true };
}

/** Reads the bookshelf rows on the page as it is (no navigation), and how many Kindle books it shows. */
async function rowsOnPage(page) {
  const rows = await page.evaluate(`(${shelfRowsIn})(document)`).catch(() => []);
  const kindleOnPage = await page.evaluate(() => (document.body?.innerText ?? "").split("\n").filter((l) => /^\s*kindle e-?book\s*$/i.test(l)).length).catch(() => 0);
  return Object.assign(rows, { kindleOnPage });
}
/** planTitle with the page's own count. */
const plan = (title, rows) => planTitle(title, rows, { kindleOnPage: rows?.kindleOnPage ?? 0 });
/**
 * The bookshelf, searched for this title first (KDP pages its list; a title on page 2 must not read
 * as "not there", which is how a second draft gets created). The search box is best effort; the
 * default page is read either way.
 */
async function bookshelf(page, title) {
  await go(page, `${KDP}/bookshelf`);
  await page.waitForTimeout(4000);
  const box = await first(page, ["#podbookshelftable-search-input", 'input[name="search"]', 'input[placeholder*="Search" i]', (p) => p.getByLabel(/Search by title/i)]);
  if (box) {
    await box.fill(title).catch(() => {});
    await box.press("Enter").catch(() => {});
    await page.waitForTimeout(4000);
    await waitForHer(page);
  }
  return rowsOnPage(page);
}

/* ── Boss OS ─────────────────────────────────────────────────────────────────────────────────── */
async function boss() {
  if (!process.env.BOSS_PASSCODE) throw stop("NO_PASSCODE", "run through the vault: npm run kdp:new-title", 3);
  const u = await fetch(`${ORIGIN}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }) });
  if (!u.ok) throw stop("UNLOCK_REFUSED", `Boss OS refused the passcode (${u.status}).`, 3);
  const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
  return {
    approved: async () => { const r = await fetch(`${ORIGIN}/api/boss/kdp/new-titles`, { headers: { cookie } }); if (!r.ok) throw stop("APPROVALS_UNREAD", `could not read approved titles (${r.status}).`, 2); return (await r.json()).data.approved; },
    attempt: (id, body) => fetch(`${ORIGIN}/api/boss/kdp/new-titles/${id}/attempt`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.ok).catch(() => false),
    post: (path, body) => fetch(`${ORIGIN}/api/boss${path}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.ok).catch(() => false),
  };
}

/** After a stop: leave the Amazon window up for her to finish by hand; return when she is done. */
async function handOff(context, page, dir, ans) {
  console.error(`
>>> THE AMAZON WINDOW STAYS OPEN — finish by hand from where it stopped.
    Files for this book: ${join(dir, "book.epub")} (manuscript) and ${join(dir, "cover.jpg")} (cover).
    Cover: choose "Upload a cover you already have", then "Upload your cover file" and pick cover.jpg.
    AI question: Yes; Texts "${ans.texts}"; Images "${ans.images}"; Translations "${ans.translations}"; tools "${ans.tools}".
    When you're done (or want to stop), close the Amazon window or press Enter here.`);
  await new Promise((resolve) => {
    context.once("close", resolve);
    page.once("close", resolve);
    process.stdin.resume();
    process.stdin.once("data", resolve);
  });
  process.stdin.pause();
}

/* ── What Simone tells her (owner, 8 Nov 2026), through her one channel: Simone's mail ──────── */

const CT = "America/Chicago";
/** Pure: "10:15 am" in her Mac's zone, with Central in brackets when it differs. */
export function herTime(ms, zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const f = (tz) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ms)).replace(" AM", " am").replace(" PM", " pm");
  return zone === CT ? f(CT) : `${f(zone)} (${f(CT)} Central)`;
}
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const quoted = (ts) => list(ts.map((t) => `"${t}"`));

/** The one thing to do in the open window, per stop, in plain words. Pure. */
export function oneThing(code) {
  const finish = "Finish that step on the screen and press Publish Your Kindle eBook. I will see it on your bookshelf and tell you.";
  return {
    SIGNIN: "Sign in to Amazon in that Chrome window (password, code or picture check). I carry on by myself the moment you have.",
    CATEGORIES_NOT_SET: `Pick the categories on the screen, press Save, then carry on to the end and press Publish Your Kindle eBook. I will see it on your bookshelf and tell you.`,
    BLOCKED: "Open the book on your Kindle bookshelf and read Amazon's message there; reply to this email with what it says and I take it from there.",
    SHELF_UNREADABLE: "Look at the book on your Kindle bookshelf in that window. If it is a draft, press Continue setup and finish it; if it is In review or Live, nothing to do.",
  }[code] ?? finish;
}

/** Heads-up, sent HEADS_UP_LEAD_MS before Chrome opens. Pure. */
export function headsUpMail({ titles, startAt, zone }) {
  const when = herTime(startAt, zone);
  const what = titles.length === 1 ? `put ${quoted(titles)} on Kindle` : `put ${titles.length} books on Kindle: ${quoted(titles)}`;
  return {
    subject: `Kindle: at ${when.split(" (")[0]} I open Chrome to ${titles.length === 1 ? `publish ${titles[0]}` : `publish ${titles.length} books`}`,
    layout: { happened: `At ${when} a Chrome window for Amazon KDP opens on your Mac and I ${what}. You approved ${titles.length === 1 ? "it" : "them"}.`, details: [
      "Please keep the Mac awake and on until it is done (about 20 minutes).",
      "If Amazon asks for a sign-in, I sign in for you; I only need you if Amazon shows a picture check, and then I email you at once.",
      "When it is up I email you the Amazon link.",
    ] },
    owner: { layout: "note", why: `In ${Math.round(HEADS_UP_LEAD_MS / 60_000)} minutes I put your approved Kindle book${titles.length === 1 ? "" : "s"} up on Amazon.`, act: "Nothing to do now; keep the Mac awake" },
  };
}

/** A stop: what happened, that the window is open, the one thing to do there. Pure. */
export function stopMail({ title, code, said, waitMs = HANDOFF_MS, id = null }) {
  const signin = code === "SIGNIN";
  const hours = waitMs >= 3_600_000 ? `${Math.round(waitMs / 3_600_000)} hour${waitMs >= 7_200_000 ? "s" : ""}` : `${Math.round(waitMs / 60_000)} minutes`;
  const happened = signin
    ? `I tried to sign in to Amazon for you to put "${title}" up, and Amazon needs you: it is showing a picture check, or it did not accept my sign-in. The Chrome window is open on your Mac at that page.`
    : `I stopped part way through putting "${title}" up: ${plainStop(code, said)} Nothing is published yet. The Chrome window is open on your Mac on that step.`;
  return {
    subject: signin ? `Kindle: Amazon wants you to sign in to publish ${title}` : `Kindle: ${title} stopped part way, one thing to finish`,
    layout: { happened, details: [`The one thing to do: ${oneThing(code)}`, `I keep the window open and keep watching for ${hours}. If it is not done by then, I close it and try again tomorrow morning, with a heads-up first.`] },
    owner: { layout: "note", ref: id, why: signin ? `Your Kindle book "${title}" needs you to sign in to Amazon.` : `Your Kindle book "${title}" needs one step finished by hand.`, act: signin ? "Sign in to Amazon in the Chrome window that is open on your Mac" : "Finish the step in the Chrome window that is open on your Mac" },
  };
}

/** Plain words for a stop the code named. Pure. */
export function plainStop(code, said = "") {
  const m = {
    CATEGORIES_NOT_SET: "Amazon's category box did not take the categories.",
    UPLOAD_NOT_CONFIRMED: "Amazon did not confirm the upload of the book file or the cover.",
    UPLOAD_REFUSED: "Amazon refused the book file or the cover.",
    AI_DISCLOSURE_NOT_FOUND: "I could not find Amazon's question about AI on the page.",
    AI_DISCLOSURE_NOT_SET: "Amazon's AI question did not keep the answers.",
    COVER_CHOICE_NOT_SET: "the choice to upload your own cover did not open.",
    FIELD_NOT_FOUND: "a box I fill in was not on the page.",
    FIELD_DID_NOT_TAKE: "a box did not keep what I typed.",
    PRICE_NOT_SET: "the price did not read back as the price you approved.",
    PUBLISH_REFUSED: "Amazon refused the Publish button.",
    PUBLISH_NOT_CONFIRMED: "after Publish, the bookshelf did not show the book as In review.",
    DETAILS_NOT_SAVED: "Amazon did not save the first page.",
    CONTENT_NOT_SAVED: "Amazon did not save the book file and cover page.",
    BLOCKED: "Amazon shows the book as Blocked.",
    SHELF_UNREADABLE: "I could not tell from your bookshelf whether the book is already there.",
  };
  return m[code] ?? `something on the page was not as expected.`;
}

/** After HANDOFF_MS with nothing finished: one note, then the window closes. Pure. */
export function stillWaitingMail({ title, code, id = null }) {
  return {
    subject: `Kindle: ${title} is still waiting; I try again tomorrow`,
    layout: { happened: `"${title}" is not published yet. ${code === "SIGNIN" ? "Amazon's sign-in was not done" : "The step that stopped was not finished"}, so I closed the Chrome window.`, details: [
      "Tomorrow morning I try again by myself, with a heads-up 30 minutes before.",
      `If you would rather not wait, say "publish the Kindle book now" to Claude on your Mac and it opens the same window with you.`,
    ] },
    owner: { layout: "note", ref: id, why: `"${title}" is still waiting to go up on Kindle.`, act: "Nothing to do now; I try again tomorrow morning" },
  };
}

/** Live: the Amazon link, price and ASIN. Pure. */
export function doneMail({ title, asin, price_usd, extraDrafts = 0 }) {
  const link = asin ? `https://www.amazon.com/dp/${asin}` : null;
  return {
    subject: `Kindle: ${title} is live on Amazon`,
    layout: { happened: `"${title}" is live on Amazon${price_usd ? ` at $${Number(price_usd).toFixed(2)}` : ""}.`, details: [
      ...(link ? [`Amazon page: ${link}`] : []),
      ...(asin ? [`ASIN: ${asin}`] : []),
      ...(extraDrafts ? [`Your bookshelf also has ${extraDrafts} unfinished draft${extraDrafts === 1 ? "" : "s"} with the same title from earlier runs. You can delete ${extraDrafts === 1 ? "it" : "them"} there (the ⋯ menu, Delete draft); I never make another.`] : []),
    ] },
    owner: { layout: "delivered", why: `Your approved Kindle book "${title}" is live.`, act: "Nothing to do" },
  };
}

/** In review: one line on her Updates page, never an email. Pure. */
export const reviewUpdate = ({ id, title }) => ({ key: `kdp-review:${String(id).toLowerCase()}`, from_name: "Simone", subject: `Kindle: ${title} is in Amazon's review`, body: `"${title}" is submitted and in Amazon's review (usually up to 72 hours). I email you the Amazon link when it is live.` });

/** The Open Loops row for a title still waiting on her. Pure. */
export function waitingLoop({ title, folder, cleared = false, day }) {
  return {
    repo: "seq23/boss-os", stop: `KDP_NEW_TITLE_${String(folder).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`, owner: "sequoia", business: "spry",
    title: `"${title}" is waiting to go up on Kindle`,
    finish_line: `"${title}" shows In review or Live on the Kindle bookshelf`,
    next_step: "Simone tries again every morning with a heads-up first; sign in when Amazon asks. This closes itself when the bookshelf shows it.",
    next_date: day,
    ...(cleared ? { cleared: true } : {}),
  };
}

/* ── Told once (her rule: no duplicate messages) ────────────────────────────────────────────── */
const TOLD = join(DRAFTS, "told.json");
/** Pure: has this key been told? `told` is { key: iso }. */
export const toldBefore = (told, key) => Boolean(told?.[key]);
async function tell(key, msg, { dry = DRY } = {}) {
  let told = {};
  try { told = JSON.parse(await readFile(TOLD, "utf8")); } catch {}
  if (toldBefore(told, key)) { console.log(`(already told: ${key})`); return true; }
  if (dry) { console.log(`DRY: would email "${msg.subject}"`); return true; }
  const { sendAsEmployee } = await import("./notify.mjs");
  const r = await sendAsEmployee("Simone", { to: TO, subject: msg.subject, layout: msg.layout, owner: msg.owner });
  if (!r.ok) { console.error(`NAMED STOP [SEND_REFUSED] "${msg.subject}" was not sent: ${r.error}`); return false; }
  told[key] = new Date().toISOString();
  await writeFile(TOLD, JSON.stringify(told, null, 2)).catch(() => {});
  console.log(`emailed her: ${msg.subject}`);
  return true;
}

/** Is the KDP Chrome profile already open (Chrome's SingletonLock names a live process)? */
export function profileBusy(dir, { lstat = lstatSync, readlink = readlinkSync, alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } } } = {}) {
  try { lstat(join(dir, "SingletonLock")); } catch { return false; }
  const pid = Number(/-(\d+)$/.exec(String(readlink(join(dir, "SingletonLock"))))?.[1]);
  return Number.isFinite(pid) && pid > 0 ? alive(pid) : true;
}

const dayCT = (ms = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: CT }).format(new Date(ms));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Simone's own sign-in on the open window: the existing kdp-signin.mjs steps, with the vault's launch env. */
async function autoSignin(page, target) {
  const email = process.env.KDP_ACCOUNT_EMAIL ?? "", password = process.env.KDP_ACCOUNT_PASSWORD ?? "";
  if (!email || !password) return { code: 3, state: "no_credentials", detail: "the KDP sign-in is not in this launch (run through the vault)" };
  const { signInOnPage } = await import("./kdp-signin.mjs");
  return signInOnPage(page, { email, password, editUrl: target ?? `${KDP}/bookshelf` });
}

async function main() {
  const api = await boss();
  const spec = JSON.parse(await readFile(join(HERE, "kdp-books/keepmyproof.json"), "utf8"));
  const only = flag("title");
  const approved = (await api.approved()).filter((a) => !only || a.title === only);
  if (!approved.length) { say("NOTHING_APPROVED", "no approved new Kindle title is waiting; nothing to do."); console.log("OUTPUT 0 kindle-titles-submitted"); return 0; }

  // Each approved title, with its local draft.
  const books = [];
  let code = 0;
  for (const a of approved) {
    const book0 = spec.books.find((b) => normTitle(b.title) === normTitle(a.title));
    const dir = book0 ? join(DRAFTS, book0.folder) : null;
    if (!book0 || !existsSync(join(dir, "book.epub")) || !existsSync(join(dir, "listing.json"))) {
      say("NO_DRAFT", `"${a.title}" has no draft on this Mac (${dir ?? "no folder"}); run kdp-kmp-draft.mjs first.`);
      console.error(`NAMED STOP [NO_DRAFT] "${a.title}" is approved and its draft is not on this Mac.`);
      await api.attempt(a.id, { run_outcome: "could-not-run", stop_code: "NO_DRAFT", amazon_message: null });
      code = 4; continue;
    }
    const listing = JSON.parse(await readFile(join(dir, "listing.json"), "utf8"));
    books.push({ a, folder: book0.folder, dir, book: { ...listing }, ans: aiAnswers(spec, listing) });
  }

  if (!books.length) { console.log("OUTPUT 0 kindle-titles-submitted"); return code; }
  const profile = profilePath("kdp");
  if (profileBusy(profile)) {
    console.error("NAMED STOP [PROFILE_IN_USE] the KDP Chrome window is already open on this Mac (someone is using it); nothing was opened or typed. The next run tries again.");
    say("PROFILE_IN_USE", "the KDP Chrome profile is open already; nothing done.");
    console.log("OUTPUT 0 kindle-titles-submitted");
    return 5;
  }

  let submitted = 0;
  /** Records what the bookshelf says and tells her once. Returns true when nothing is left to do. */
  const settle = async (b, plan) => {
    const { a, book } = b;
    const st = plan.row?.state ?? null;
    if (plan.action === "done") {
      await api.attempt(a.id, { resulting_state: "LIVE", run_outcome: "attempted", title_ref: plan.row.id, publish_attempted: false, cover_uploaded: false });
      await writeFile(join(b.dir, "publish.json"), JSON.stringify({ at: new Date().toISOString(), judgement_id: a.id, resulting_state: "LIVE", title_ref: plan.row.id, asin: plan.row.asin, price_usd: plan.row.price_usd }, null, 2));
      if (plan.row.price_usd != null && Math.abs(plan.row.price_usd - book.price_usd) > 0.001) console.error(`NAMED STOP [PRICE_DIFFERS] "${book.title}" is Live at $${plan.row.price_usd}; the approved price is $${book.price_usd.toFixed(2)}.`);
      await tell(`live:${a.id}`, doneMail({ title: book.title, asin: plan.row.asin, price_usd: plan.row.price_usd ?? book.price_usd, extraDrafts: plan.extra.length }));
      await api.post("/open-loops/intake", waitingLoop({ title: book.title, folder: b.folder, cleared: true, day: dayCT() }));
      say("LIVE", `${book.title}: Live on the bookshelf${plan.row.asin ? ` (ASIN ${plan.row.asin})` : ""}; approval marked done.`);
      submitted += 1; return true;
    }
    if (plan.action === "watch") {
      await api.attempt(a.id, { resulting_state: st, run_outcome: "attempted", title_ref: plan.row.id });
      await api.post("/task-notices/update", reviewUpdate({ id: a.id, title: book.title }));
      await api.post("/open-loops/intake", waitingLoop({ title: book.title, folder: b.folder, cleared: true, day: dayCT() }));
      say(st, `${book.title}: ${st === "IN_REVIEW" ? "In review" : "Publishing"} on the bookshelf; the next daily run follows it to Live.`);
      submitted += 1; return true;
    }
    return false;
  };

  // 1. LOOK FIRST, headless, before telling her anything or typing anything.
  const todo = [];
  {
    const { context } = await openProfile("kdp", { headed: false });
    const page = context.pages()[0] ?? (await context.newPage());
    let rows = null;
    try {
      await page.goto(`${KDP}/bookshelf`, { waitUntil: "domcontentloaded", timeout: STEP_MS });
      await page.waitForTimeout(5000);
      if (!SIGNIN.test(page.url())) rows = await rowsOnPage(page);
    } catch (e) { console.log(`bookshelf not read headless (${String(e.message).slice(0, 120)}); the visible run reads it first.`); }
    await context.close().catch(() => {});
    for (const b of books) {
      if (rows && (await settle(b, plan(b.book.title, rows)))) continue;
      todo.push(b);
    }
  }
  if (!todo.length) { console.log(`OUTPUT ${submitted} kindle-titles-submitted`); return code; }

  // 2. HEADS-UP, then the window (unattended); attended runs start now.
  if (UNATTENDED) {
    const startAt = Date.now() + HEADS_UP_LEAD_MS;
    await tell(`headsup:${dayCT()}:${todo.map((b) => b.a.id).join(",")}`, headsUpMail({ titles: todo.map((b) => b.book.title), startAt }));
    console.log(`heads-up sent; Chrome opens at ${herTime(startAt)}.`);
    await sleep(HEADS_UP_LEAD_MS);
    if (profileBusy(profile)) { console.error("NAMED STOP [PROFILE_IN_USE] the KDP Chrome window was opened by someone during the heads-up; nothing typed. The next run tries again."); console.log(`OUTPUT ${submitted} kindle-titles-submitted`); return 5; }
  }

  const { context } = await openProfile("kdp", { headed: true });
  let closed = false;
  context.once("close", () => { closed = true; });
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    for (const b of todo) {
      const { a, book, dir, ans } = b;
      Object.assign(RUN, {
        unattended: UNATTENDED, title: book.title,
        tellSignin: () => tell(`stop:${a.id}:SIGNIN:${dayCT()}`, stopMail({ title: book.title, code: "SIGNIN", id: a.id })),
        autoSignin: autoSignin,
      });
      const report = { title_ref: null, cover_uploaded: false, publish_attempted: false, resulting_state: null, run_outcome: "attempted", stop_code: null, amazon_message: null };
      try {
        // Read again right before acting: she may have finished it by hand during the heads-up.
        const p0 = plan(book.title, await bookshelf(page, book.title));
        if (await settle(b, p0)) continue;
        if (p0.action === "blocked") throw stop("BLOCKED", `"${book.title}" shows Blocked on the bookshelf; only she can read Amazon's reason there.`);
        if (p0.action === "unknown") throw stop("SHELF_UNREADABLE", `"${book.title}" is on the bookshelf but its state could not be read; nothing was created.`);
        if (p0.action === "resume") console.log(`resuming the existing draft ${p0.row.id} (Continue setup), never a second one${p0.extra.length ? `; ${p0.extra.length} older duplicate draft(s) left for her to delete` : ""}.`);
        report.title_ref = p0.row?.id ?? null;
        await details(page, book, dir, p0.row?.id ?? null);
        report.title_ref = /title-setup\/kindle\/([A-Z0-9]+)/.exec(page.url())?.[1] ?? report.title_ref;
        await content(page, dir, ans);
        report.cover_uploaded = true;
        const { published } = await pricingAndPublish(page, book, ans);
        report.publish_attempted = published;
        if (!published) { say("DRY_RUN", `${book.title}: everything but Publish done; a KDP draft is left.`); continue; }
        await page.waitForTimeout(10_000);
        const after = plan(book.title, await bookshelf(page, book.title));
        report.resulting_state = after.row?.state ?? "NOT_FOUND";
        if (!(await settle(b, after))) throw stop("PUBLISH_NOT_CONFIRMED", `after Publish the bookshelf reads ${report.resulting_state} for "${book.title}".`, 9);
      } catch (e) {
        report.stop_code = e.stop ?? "FAILED"; report.amazon_message = String(e.message).slice(0, 800);
        if (!closed) await snapshot(page, dir, `stop-${String(e.stop ?? "failed").toLowerCase()}`);
        say("STOPPED", e.message);
        await api.attempt(a.id, report);
        const ok = await handBack(b, e, { api, context, page, isClosed: () => closed, settle });
        if (!ok) code = e.code ?? 1;
        break; // the window is closed now; any other approved title goes in the next run

      }
    }
  } finally {
    await context.close().catch(() => {});
  }
  console.log(`OUTPUT ${submitted} kindle-titles-submitted`);
  return code;
}

/**
 * A stop, handed back to her with the window left open (owner, 8 Nov 2026, unattended and TTY
 * alike). Unattended: one email at once with the one thing to do, then watch — read-only, never
 * navigating her window — for up to HANDOFF_MS: the page she is on, or once she closes the window,
 * the bookshelf headless. In review or Live → settled. Else one "still waiting" note and an Open
 * Loops row. Attended (a person at the terminal): the window stays until she closes it or presses
 * Enter, then the bookshelf is read once. Returns true when the title ended In review or Live.
 */
async function handBack(b, e, { api, context, page, isClosed, settle }) {
  const { a, book, folder } = b;
  const code = e.stop === "SIGNIN_NOT_DONE" ? "SIGNIN" : e.stop ?? "FAILED";
  if (!UNATTENDED && !process.stdin.isTTY) return false;
  if (UNATTENDED && code !== "SIGNIN") await tell(`stop:${a.id}:${code}:${dayCT()}`, stopMail({ title: book.title, code, said: e.message, id: a.id }));
  if (!UNATTENDED) await handOff(context, page, b.dir, b.ans);
  else if (code !== "SIGNIN") {
    // Watch, bounded. Her window is never navigated: only the page she is on is read.
    const deadline = Date.now() + HANDOFF_MS;
    while (Date.now() < deadline && !isClosed()) {
      await sleep(WATCH_EVERY_MS);
      if (isClosed()) break;
      if (/\/bookshelf/.test(page.url()) && (await settle(b, plan(book.title, await rowsOnPage(page))))) return true;
    }
  }
  await context.close().catch(() => {});
  // One last look, headless, now the window is closed.
  try {
    const { context: c2 } = await openProfile("kdp", { headed: false });
    const p2 = c2.pages()[0] ?? (await c2.newPage());
    await p2.goto(`${KDP}/bookshelf`, { waitUntil: "domcontentloaded", timeout: STEP_MS });
    await p2.waitForTimeout(5000);
    const rows = SIGNIN.test(p2.url()) ? [] : await rowsOnPage(p2);
    await c2.close().catch(() => {});
    if (await settle(b, plan(book.title, rows))) return true;
  } catch {}
  if (UNATTENDED) {
    await tell(`waiting:${a.id}:${dayCT()}`, stillWaitingMail({ title: book.title, code, id: a.id }));
    await api.post("/open-loops/intake", waitingLoop({ title: book.title, folder, day: dayCT(Date.now() + 86_400_000) }));
  }
  console.error(`NAMED STOP [WAITING_FOR_HER_AT_THE_MAC] "${book.title}" is approved and not published: ${code}. She was told; the next daily run tries again. To do it now: ${runCommand(book.title)}`);
  return false;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((c) => process.exit(c)).catch((e) => { say("STOPPED", e.message); console.log("OUTPUT 0 kindle-titles-submitted"); process.exit(e.code ?? 1); });
}
