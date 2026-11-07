#!/usr/bin/env node
/**
 * A NEW KINDLE BOOK SHE APPROVED, PUT ON AMAZON IN ONE VISIBLE RUN (owner, 7 Nov 2026: KeepMyProof
 * front-door books; her yes in the Inbox or her own words recorded there as `kdp_new_title`).
 *
 * ─── Why it is visible and she is present ──────────────────────────────────
 * Amazon answers every title-setup page with `ap/signin?max_auth_age=0` (proved 11 Sep 2026 and
 * again 7 Nov 2026 after a fresh sign-in): editing needs a login in the same session. No script
 * types her password or reads a one-time code (her coordinator, 7 Nov 2026). So the run opens
 * Simone's Chrome in a window and, whenever Amazon asks her to sign in, prints one plain line and
 * waits up to 10 minutes for her to do it in that window, then carries on in the same run.
 *
 * ─── What it does, in one pass ─────────────────────────────────────────────
 *   details  title, subtitle, author, description, own-the-rights, keywords, categories, not adult
 *   content  the EPUB, the cover, the AI disclosure (text and cover: yes; translations: none)
 *   pricing  70% royalty, the approved US price, then — after reading the AI disclosure back on the
 *            content step — Publish. NEVER "Save as Draft": it silently drops the AI disclosure.
 * Every field is read back after it is filled; anything the page does not have is a NAMED STOP
 * before the next Save, with the field's name. The result is what the BOOKSHELF says afterwards
 * (Live, In review, …), recorded to Boss OS (`POST /api/boss/kdp/new-titles/:id/attempt`), never
 * "Publish was clicked".
 *
 *   npm run kdp:new-title                       # every approved new title, visible window
 *   npm run kdp:new-title -- --title "The Co-Parenting Log"
 *   npm run kdp:new-title -- --dry-run          # everything except Publish (a KDP draft is left)
 *   … --waiting                                 # kdp-publish.sh's unattended slot: names what waits, opens nothing
 *
 * Output: one `KDP-NEW-TITLE: <state> — <detail>` line per book.
 * Exit 0 published (bookshelf read) or nothing approved · 1 a field or step missing (named)
 *      3 she did not finish a sign-in within the window · 4 no draft on this Mac · 9 Amazon refused
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openProfile } from "./browser.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const DRAFTS = process.env.KMP_KDP_DIR ?? join(process.env.HOME ?? ".", ".boss-os/kdp/keepmyproof");
const KDP = "https://kdp.amazon.com/en_US";
const SIGNIN_WAIT_MS = Number(process.env.KDP_SIGNIN_WINDOW_MS ?? 10 * 60_000);
const STEP_MS = 90_000;
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");

const stop = (code, msg, exit = 1) => Object.assign(new Error(`NAMED STOP [${code}] ${msg}`), { code: exit, stop: code });
const say = (state, detail) => console.log(`KDP-NEW-TITLE: ${state} — ${detail}`);
const SIGNIN = /\/ap\/(?:signin|mfa|cvf|challenge)|\/ap\/[a-z]*auth|captcha/i;

/** Pure: the KDP AI-disclosure answers for a book, from the spec (text and cover yes, translations none). */
export function aiAnswers(spec) {
  return {
    used: true,
    texts: /extensive/i.test(spec?.ai_disclosure?.text_detail ?? "") ? spec.ai_disclosure.text_detail : "Some sections, with extensive editing",
    images: spec?.ai_disclosure?.images_detail ?? "Entire work, with extensive editing",
    translations: "None",
    tools: spec?.ai_disclosure?.tool_names ?? "Google Gemini; Anthropic Claude",
  };
}
/** Pure: what the bookshelf row's text says about the title. */
export function shelfState(text) {
  const t = String(text ?? "");
  if (/\bLive\b/.test(t)) return "LIVE";
  if (/In review/i.test(t)) return "IN_REVIEW";
  if (/Publishing/i.test(t)) return "PUBLISHING";
  if (/Blocked/i.test(t)) return "BLOCKED";
  if (/Draft/i.test(t)) return "DRAFT";
  return null;
}

/* ── Sign-in: her hands, in the window; this run only waits ─────────────────────────────────── */
async function waitForHer(page) {
  if (!SIGNIN.test(page.url())) return;
  console.log("\n>>> SIGN IN NEEDED: Amazon is asking you to sign in again. Do it in the Chrome window that is open (password, code, or picture check). This run waits up to 10 minutes and then carries on by itself.\n");
  const deadline = Date.now() + SIGNIN_WAIT_MS;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    if (!SIGNIN.test(page.url())) { console.log(">>> Thank you, signed in. Carrying on.\n"); await page.waitForLoadState("domcontentloaded").catch(() => {}); return; }
  }
  throw stop("SIGNIN_NOT_DONE", "Amazon's sign-in was not finished within 10 minutes. Nothing was published. Run the same command again when you are at the Mac.", 3);
}
async function go(page, url) { await page.goto(url, { waitUntil: "domcontentloaded", timeout: STEP_MS }); await waitForHer(page); }

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
async function details(page, book) {
  await go(page, `${KDP}/title-setup/kindle/new/details`);
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
  await categories(page, book.categories);
  if (DRY) say("DRY_RUN", "details filled; Save and Continue is pressed even in a dry run (a KDP draft is left)");
  await clickOne(page, "Save and Continue", ["#save-and-continue-announce", (p) => p.getByRole("button", { name: /Save and Continue/i })]);
  await page.waitForURL(/\/content/, { timeout: STEP_MS }).catch(() => {});
  await waitForHer(page);
  if (!/\/content/.test(page.url())) throw stop("DETAILS_NOT_SAVED", `Amazon did not move on from the details step: ${(await page.locator(".a-alert-content, .a-color-error").allInnerTexts().catch(() => [])).join(" ").slice(0, 300) || "no message shown"}.`, 9);
}

/**
 * Categories: automatic where the chooser has a search box; otherwise the run asks her, on screen,
 * to tick the two named categories in the open window, and waits up to 10 minutes for both to show.
 */
async function categories(page, cats) {
  // KDP's Kindle chooser (read live 7 Nov 2026): a modal with a "Category" select, a "Subcategory"
  // select, then checkboxes for the leaves; up to 3 placements; Save closes it and the page button
  // turns from "Choose categories" to "Edit categories". That button text is what "set" means here,
  // so categories she picks by hand count too (the names in the book file may not exist on KDP).
  const btn = page.locator("#categories-modal-button");
  const isSet = async () => /Edit categories/i.test((await btn.innerText().catch(() => "")) || "");
  if (await isSet()) return;
  await clickOne(page, "Choose categories", ["#categories-modal-button", (p) => p.getByRole("button", { name: /(Choose|Edit) categories/i })]);
  const modal = page.locator('.a-popover[aria-hidden="false"]').last();
  let ticked = 0;
  for (const path of cats) {
    const [top, sub, leaf] = path.split("›").map((x) => x.trim());
    const sels = modal.locator("select");
    const pick = await sels.nth(0).selectOption({ label: top }).then(() => true).catch(() => false);
    if (!pick) continue;
    await page.waitForTimeout(800);
    if (sub && !(await sels.nth(1).selectOption({ label: sub }).then(() => true).catch(() => false))) continue;
    await page.waitForTimeout(800);
    const box = modal.locator("label").filter({ hasText: new RegExp(`^\\s*${(leaf ?? sub).replace(/[.*+?^${}()|[\]\\&]/g, "\\$&")}\\s*$`) }).locator('input[type="checkbox"]');
    if (await box.count()) { if (await box.first().check({ force: true }).then(() => true).catch(() => false)) ticked += 1; }
  }
  if (ticked) {
    const save = modal.locator("button, input[type=submit]").filter({ hasText: /save/i });
    if (await save.count()) await save.first().click().catch(() => {});
    await page.waitForTimeout(1500);
    if (await isSet()) return;
  }
  console.log(`\n>>> CATEGORIES: pick up to 3 categories in the open window and press Save in that box (suggested:\n    1. ${cats[0]}\n    2. ${cats[1]}).\n    Any categories you choose count. This run waits up to 10 minutes and then carries on.\n`);
  const deadline = Date.now() + SIGNIN_WAIT_MS;
  while (Date.now() < deadline) { await page.waitForTimeout(3000); if (await isSet()) return; }
  throw stop("CATEGORIES_NOT_SET", "no categories were saved within 10 minutes; nothing was saved past the details step.");
}

async function upload(page, name, sels, file, done) {
  const input = page.locator(sels.join(", "));
  if (!(await input.count())) throw stop("FIELD_NOT_FOUND", `the ${name} upload is not on the page.`);
  await input.first().setInputFiles(file);
  await page.getByText(done).first().waitFor({ timeout: 6 * 60_000 }).catch(() => { throw stop("UPLOAD_NOT_CONFIRMED", `Amazon did not confirm the ${name} upload within 6 minutes.`, 9); });
}

/** Sets the AI answers inside the AI section, and reads them back. Returns what the page shows. */
async function aiDisclosure(page, ans, { write }) {
  // The smallest element holding both the AI question and its radio buttons is the section.
  const found = await page.evaluate(() => {
    const re = /AI[- ]generated content|use AI(?:-based)? tools/i;
    const all = [...document.querySelectorAll("fieldset, section, div")].filter((el) => re.test(el.innerText ?? "") && el.querySelector('input[type="radio"]'));
    all.sort((x, y) => x.querySelectorAll("*").length - y.querySelectorAll("*").length);
    document.querySelectorAll("[data-kmp-ai]").forEach((el) => el.removeAttribute("data-kmp-ai"));
    if (all[0]) all[0].setAttribute("data-kmp-ai", "1");
    return !!all[0];
  });
  if (!found) throw stop("AI_DISCLOSURE_NOT_FOUND", "the AI-generated content question is not on the content step; nothing was published.");
  const section = page.locator('[data-kmp-ai="1"]');
  if (write) {
    const yes = section.getByRole("radio", { name: /^Yes$/i });
    if (!(await yes.count())) throw stop("AI_DISCLOSURE_NOT_FOUND", "no Yes answer in the AI question.");
    await yes.first().check();
    await page.waitForTimeout(1000);
  }
  const result = await section.evaluate((root, { a, w }) => {
    const checked = root.querySelector('input[type="radio"]:checked');
    const label = checked ? (checked.closest("label")?.innerText ?? document.querySelector(`label[for="${checked.id}"]`)?.innerText ?? checked.value) : "";
    const out = { yes: /^(yes|true)$/i.test(String(label).trim()), selects: {} };
    const want = { text: a.texts, image: a.images, translat: a.translations };
    for (const sel of root.querySelectorAll("select")) {
      const ctx = (sel.closest("div")?.parentElement?.innerText ?? "").toLowerCase();
      const key = Object.keys(want).find((k) => ctx.includes(k) && !(k in out.selects));
      if (!key) continue;
      if (w) {
        const opt = [...sel.options].find((o) => o.text.trim().toLowerCase() === want[key].toLowerCase()) ?? (key === "translat" ? [...sel.options].find((o) => /^(none|no)\b/i.test(o.text.trim())) : null);
        if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
      }
      out.selects[key] = sel.options[sel.selectedIndex]?.text.trim() ?? "";
    }
    if (w) for (const inp of root.querySelectorAll('input[type="text"], textarea')) if (!inp.value) { inp.value = a.tools; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); }
    return out;
  }, { a: ans, w: write });
  const ok = result.yes && result.selects.text?.toLowerCase() === ans.texts.toLowerCase() && result.selects.image?.toLowerCase() === ans.images.toLowerCase();
  if (!ok) throw stop("AI_DISCLOSURE_NOT_SET", `the AI answers read back as ${JSON.stringify(result)}; nothing was published.`);
  return result;
}

async function content(page, dir, ans) {
  if (!/\/content/.test(page.url())) throw stop("WRONG_STEP", `expected the content step, at ${page.url()}.`);
  await upload(page, "manuscript", ['#data-assets-interior-file-upload-AjaxInput', 'input[type="file"][id*="interior"]', 'input[type="file"][name*="interior"]'], join(dir, "book.epub"), /Manuscript .* uploaded successfully|uploaded successfully/i);
  const coverChoice = await first(page, [(p) => p.getByLabel(/Upload a cover you already have/i), (p) => p.getByText(/Upload a cover you already have/i)]);
  if (coverChoice) await coverChoice.click();
  await upload(page, "cover", ['#data-assets-cover-file-upload-AjaxInput', 'input[type="file"][id*="cover"]', 'input[type="file"][name*="cover"]'], join(dir, "cover.jpg"), /Cover uploaded successfully/i);
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
  await fillField(page, "Amazon.com price", ['input[name="data[digital_list_price][USD]"]', 'input[id*="price"][id*="US"]', (p) => p.locator("tr, .a-row").filter({ hasText: "Amazon.com" }).locator('input[type="text"]')], book.price_usd.toFixed(2));
  if (DRY) return { published: false };
  await clickOne(page, "Publish Your Kindle eBook", [(p) => p.getByRole("button", { name: /Publish Your Kindle eBook/i }), "#save-and-publish-announce"]);
  await page.waitForTimeout(8000);
  const err = (await page.locator(".a-alert-error .a-alert-content, .a-color-error").allInnerTexts().catch(() => [])).join(" ").trim();
  if (err) throw stop("PUBLISH_REFUSED", `Amazon refused Publish: ${err.slice(0, 400)}`, 9);
  return { published: true };
}

async function bookshelf(page, title) {
  await go(page, `${KDP}/bookshelf`);
  const row = page.locator("div[id^='zme-indie-bookshelf-dual-print-price'], .bookshelf-row, tr, [data-test-id*='bookshelf']").filter({ hasText: title }).first();
  const text = (await row.count()) ? await row.innerText() : "";
  return { state: shelfState(text) ?? (text ? null : "NOT_FOUND"), text: text.slice(0, 300) };
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
  };
}

async function main() {
  const api = await boss();
  const spec = JSON.parse(await readFile(join(HERE, "kdp-books/keepmyproof.json"), "utf8"));
  const only = flag("title");
  const approved = (await api.approved()).filter((a) => !only || a.title === only);
  if (!approved.length) { say("NOTHING_APPROVED", "no approved new Kindle title is waiting; nothing to do."); return 0; }
  if (args.includes("--waiting")) {
    // The unattended slot: never opens a window. A title she approved that is not Live is named.
    for (const a of approved) console.error(`NAMED STOP [WAITING_FOR_HER_AT_THE_MAC] "${a.title}" is approved and not Live. It goes up in one visible run she is present for (Amazon asks her to sign in): npm run kdp:new-title -- --title "${a.title}" (about 10 minutes).`);
    say("WAITING_FOR_HER", `${approved.length} approved title(s) wait for one visible run: npm run kdp:new-title`);
    return 0;
  }
  let code = 0;
  for (const a of approved) {
    const book0 = spec.books.find((b) => b.title === a.title);
    const dir = book0 ? join(DRAFTS, book0.folder) : null;
    if (!book0 || !existsSync(join(dir, "book.epub")) || !existsSync(join(dir, "listing.json"))) { say("NO_DRAFT", `"${a.title}" has no draft on this Mac (${dir ?? "no folder"}); run kdp-kmp-draft.mjs first.`); code = 4; continue; }
    const listing = JSON.parse(await readFile(join(dir, "listing.json"), "utf8"));
    const book = { ...listing, author: listing.author };
    const ans = aiAnswers(spec);
    const { context } = await openProfile("kdp", { headed: true });
    const page = context.pages()[0] ?? (await context.newPage());
    const report = { title_ref: null, cover_uploaded: false, publish_attempted: false, resulting_state: null, run_outcome: "attempted", stop_code: null, amazon_message: null };
    try {
      await details(page, book);
      await content(page, dir, ans);
      report.cover_uploaded = true;
      const { published } = await pricingAndPublish(page, book, ans);
      report.publish_attempted = published;
      const shelf = await bookshelf(page, book.title);
      report.resulting_state = shelf.state;
      report.title_ref = /title-setup\/kindle\/([A-Z0-9]+)/.exec(page.url())?.[1] ?? null;
      say(published ? (shelf.state ?? "UNKNOWN") : "DRY_RUN", `${book.title}: the bookshelf reads "${shelf.text.replace(/\s+/g, " ").slice(0, 160)}"`);
      await writeFile(join(dir, "publish.json"), JSON.stringify({ at: new Date().toISOString(), judgement_id: a.id, ...report, shelf }, null, 2));
    } catch (e) {
      report.stop_code = e.stop ?? "FAILED"; report.amazon_message = String(e.message).slice(0, 800);
      say("STOPPED", e.message); code = e.code ?? 1;
    } finally {
      if (!(await api.attempt(a.id, report))) console.error("NAMED STOP [ATTEMPT_NOT_RECORDED] Boss OS did not keep this attempt; the line above is the record.");
      await context.close().catch(() => {});
    }
  }
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((c) => process.exit(c)).catch((e) => { say("STOPPED", e.message); process.exit(e.code ?? 1); });
}
