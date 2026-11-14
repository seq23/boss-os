#!/usr/bin/env node
/**
 * THE PAPERBACK FOR A BOOK WHOSE KINDLE EDITION IS ON AMAZON (KDP strategy, spry brain 8 Nov 2026:
 * paperbacks for the KeepMyProof logs/binders and the three wedding books, about $7.99–$9.99).
 *
 * For every built series book with `listing.paperback`, whose Kindle edition kdp-new-title.mjs has
 * put In review or Live (its publish.json / the bookshelf), and with no paperback in review or live:
 * "+ Create paperback" on that Kindle title (KDP links the formats and carries the title, subtitle,
 * author, description and keywords over), then
 *   details  own the rights, not adult, categories → Save and Continue
 *   content  a free KDP ISBN, black & white on white paper, the trim, no bleed, matte cover, the
 *            interior PDF, the full-wrap cover PDF, the AI answers, the previewer approved
 *   pricing  the approved US price, read back, then Publish
 * and the state is read from the BOOKSHELF afterwards, never from the click. Every stop keeps a
 * snapshot (stop-paperback-*.png/.html) in the book's folder and names the step.
 *
 *   npm run -s vault:run -- node scripts/ops/kdp-paperback.mjs [--slug wedding-vows] [--dry-run] [--headed]
 *
 * Output: `KDP-PAPERBACK: <slug> — <state>` per book and `OUTPUT <n> paperbacks-submitted`.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openProfile } from "./browser.mjs";
import { BOOKS_DIR } from "./kdp-build.mjs";
import { snapshot, go, first, fillField, clickOne, categories, upload, aiDisclosure, aiAnswers, autoSignin, RUN, normTitle, shelfState, confirmAiAnswers, tickAui } from "./kdp-new-title.mjs";

const KDP = "https://kdp.amazon.com";
const STEP_MS = 90_000;
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const stop = (code, msg, exit = 1) => Object.assign(new Error(`NAMED STOP [${code}] ${msg}`), { code: exit, stop: code });

/** The paperback's state on one bookshelf row's lines (the word after "Paperback"), or null when none exists. Pure. */
export function paperbackState(lines) {
  const L = (lines ?? []).map((x) => String(x).trim()).filter(Boolean);
  const at = L.findIndex((l) => /^paperback$/i.test(l));
  if (at < 0) return null;
  const end = L.findIndex((l, i) => i > at && /^hardcover$/i.test(l));
  const scope = L.slice(at + 1, end > 0 ? end : undefined);
  if (scope.some((l) => /^\+\s*create paperback/i.test(l))) return null;
  return scope.map(shelfState).find(Boolean) ?? null;
}

/** The KDP item-set id of a Kindle title, from the bookshelf's own markup (needed by "+ Create paperback"). Pure. */
export function itemSetFor(html, titleId) {
  const s = String(html);
  const a = new RegExp(`digitalTitleId&quot;:&quot;${titleId}&quot;[^>]{0,400}?itemSetId&quot;:&quot;(\\w+)`).exec(s);
  const b = new RegExp(`itemSetId&quot;:&quot;(\\w+)&quot;[^>]{0,400}?digitalTitleId&quot;:&quot;${titleId}`).exec(s);
  return a?.[1] ?? b?.[1] ?? null;
}

async function due(only) {
  const out = [];
  for (const d of await readdir(BOOKS_DIR, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || (only && d.name !== only)) continue;
    const dir = join(BOOKS_DIR, d.name);
    try {
      const listing = JSON.parse(await readFile(join(dir, "listing.json"), "utf8"));
      if (!listing.paperback || !existsSync(join(dir, "interior.pdf")) || !existsSync(join(dir, "paperback-cover.pdf"))) continue;
      const pb = existsSync(join(dir, "paperback.json")) ? JSON.parse(await readFile(join(dir, "paperback.json"), "utf8")) : null;
      if (pb && ["IN_REVIEW", "PUBLISHING", "LIVE"].includes(pb.state)) continue;
      out.push({ slug: d.name, dir, listing });
    } catch {}
  }
  return out;
}

const FREE_ISBN = [(p) => p.getByLabel(/Get a free KDP ISBN/i), (p) => p.getByText(/Get a free KDP ISBN/i)];

/**
 * Waits for the content step's ISBN section to draw. Amazon moves the URL to /content before the form
 * renders (parallel-parenting, 9 Nov 2026: CONTROL_NOT_FOUND on a page showing only KDP's spinner),
 * so reading it at once found no ISBN control. Returns "assigned" (a resumed draft already has one),
 * "free" (the free KDP ISBN choice is shown), or null when neither appears within `timeout`.
 */
export async function isbnSection(page, { timeout = STEP_MS, every = 1000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.getByText(/ISBN\s*:?\s*97[89]/).count().catch(() => 0)) return "assigned";
    if (await first(page, FREE_ISBN)) return "free";
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(every);
  }
}

/** Content step: ISBN, print options, the two files, the AI answers, the previewer. */
async function content(page, b) {
  const { dir, listing } = b;
  // A free KDP ISBN (never a paid one). Already assigned on a resumed draft → nothing to do.
  if ((await isbnSection(page)) !== "assigned") {
    await clickOne(page, "free KDP ISBN", FREE_ISBN);
    await clickOne(page, "Assign ISBN", [(p) => p.getByRole("button", { name: /^\s*Assign ISBN\s*$/i })]);
    await page.waitForTimeout(2500);
    const confirm = page.locator('.a-popover[aria-hidden="false"]').last().getByRole("button", { name: /Assign ISBN/i });
    if (await confirm.count().catch(() => 0)) { await confirm.click(); await page.waitForTimeout(5000); }
  }
  for (const [name, re] of [["black and white interior on white paper", /Black (&|and) white interior.*white paper/i], ["no bleed", /^\s*No Bleed\s*$/i], ["matte cover", /^\s*Matte\s*$/i]]) {
    const el = await first(page, [(p) => p.getByLabel(re), (p) => p.getByText(re)]);
    if (el) await el.click().catch(() => {});
    else console.log(`paperback: the ${name} choice was not found; KDP's default stays.`);
  }
  if (listing.paperback.trim !== "6x9") {
    await clickOne(page, "Select a different size", [(p) => p.getByRole("button", { name: /Select a different size/i })]);
    await page.waitForTimeout(2000);
    const size = listing.paperback.trim === "8.5x11" ? /8\.5\s*x\s*11\s*in/i : /6\s*x\s*9\s*in/i;
    await clickOne(page, `trim ${listing.paperback.trim}`, [(p) => p.locator('.a-popover[aria-hidden="false"]').last().getByText(size).first()]);
    const ok = page.locator('.a-popover[aria-hidden="false"]').last().getByRole("button", { name: /^\s*(Select|Done|Save|OK)\s*$/i });
    if (await ok.count().catch(() => 0)) await ok.first().click();
    await page.waitForTimeout(1500);
  }
  await upload(page, "manuscript", ['input[type="file"][id*="interior"]', 'input[type="file"][name*="interior"]', "#data-print-book-publisher-interior-file-upload-AjaxInput"], join(dir, "interior.pdf"), dir);
  const own = await first(page, [(p) => p.getByLabel(/Upload a cover you already have/i), (p) => p.getByText(/Upload a cover you already have/i)]);
  if (own) await own.click().catch(() => {});
  await upload(page, "cover", ['input[type="file"][id*="cover"]', 'input[type="file"][name*="cover"]', "#data-print-book-publisher-cover-file-upload-AjaxInput"], join(dir, "paperback-cover.pdf"), dir);
  await aiDisclosure(page, aiAnswers({}, listing), { write: true });
  await confirmAiAnswers(page);
  // The previewer: KDP will not move on until the printed book is approved in it.
  await clickOne(page, "Launch Previewer", [(p) => p.getByRole("button", { name: /Launch Previewer/i }), "#print-preview-confirm-button"]);
  const approve = page.getByRole("button", { name: /^\s*Approve\s*$/i }).first();
  await approve.waitFor({ timeout: 8 * 60_000 }).catch(() => {});
  if (!(await approve.count().catch(() => 0))) { const shot = await snapshot(page, dir, "stop-paperback-previewer"); throw stop("PREVIEWER", `the print previewer offered no Approve within 8 minutes. Page kept at ${shot}.`, 9); }
  const issues = (await page.locator(".issue, .a-alert-error .a-alert-content").allInnerTexts().catch(() => [])).join(" ").trim();
  if (issues) console.log(`previewer notes: ${issues.slice(0, 300)}`);
  await approve.click();
  await page.waitForTimeout(6000);
  await clickOne(page, "Save and Continue", ["#save-and-continue-announce", (p) => p.getByRole("button", { name: /Save and Continue/i })]);
  await page.waitForURL(/\/pricing/, { timeout: STEP_MS }).catch(() => {});
  if (!/\/pricing/.test(page.url())) { const shot = await snapshot(page, dir, "stop-paperback-content"); throw stop("CONTENT_NOT_SAVED", `Amazon did not move on from the paperback content step. Page kept at ${shot}.`, 9); }
}

async function pricing(page, b) {
  const want = Number(b.listing.paperback.price_usd).toFixed(2);
  await page.waitForTimeout(1000);
  await fillField(page, "paperback Amazon.com price", ['input[name="data[print_book][amazon_channel][us][price_vat_exclusive]"]', 'input[id*="price"][id*="us"]', (p) => p.locator("tr, .a-row").filter({ hasText: "Amazon.com" }).locator('input[type="text"]')], want);
  await page.keyboard.press("Tab").catch(() => {});
  await page.waitForTimeout(3000);
  const err = (await page.locator(".a-alert-error:visible .a-alert-content, .a-alert-inline-error:visible").allInnerTexts().catch(() => [])).join(" ").trim();
  if (err && /minimum|printing cost/i.test(err)) throw stop("PRICE_BELOW_PRINT_COST", `KDP says $${want} is under the print cost: ${err.slice(0, 200)}`, 9);
  if (DRY) return false;
  await clickOne(page, "Publish Your Paperback Book", [(p) => p.getByRole("button", { name: /Publish Your Paperback/i }), "#save-and-publish-announce"]);
  await page.waitForTimeout(8000);
  const refused = (await page.locator(".a-alert-error:visible .a-alert-content").allInnerTexts().catch(() => [])).join(" ").trim();
  if (refused && /fix the highlighted|set a list price|refused|cannot be published/i.test(refused)) throw stop("PUBLISH_REFUSED", `Amazon refused the paperback: ${refused.slice(0, 300)}`, 9);
  return true;
}

async function shelfRow(page, title) {
  await go(page, `${KDP}/en_US/bookshelf`);
  await page.waitForTimeout(4000);
  const box = await first(page, ["#podbookshelftable-search-input", 'input[name="search"]', 'input[placeholder*="Search" i]']);
  if (box) { await box.fill(title).catch(() => {}); await box.press("Enter").catch(() => {}); await page.waitForTimeout(4000); }
  const { shelfRowsIn, parseShelfRow } = await import("./kdp-new-title.mjs");
  const rows = await page.evaluate(`(${shelfRowsIn})(document)`).catch(() => []);
  const row = rows.find((r) => normTitle(parseShelfRow(r.lines).title).startsWith(normTitle(title)));
  return row ? { ...row, html: await page.content() } : null;
}

export async function run({ only = flag("slug") } = {}) {
  const books = await due(only);
  if (!books.length) { console.log("KDP-PAPERBACK: none due — no built paperback is waiting on a Kindle edition."); console.log("OUTPUT 0 paperbacks-submitted"); return 0; }
  Object.assign(RUN, { unattended: true, autoSignin, tellSignin: async () => {} });
  const { context } = await openProfile("kdp", { headed: args.includes("--headed") });
  const page = context.pages()[0] ?? (await context.newPage());
  let n = 0, code = 0;
  try {
    for (const b of books) {
      try {
        const row = await shelfRow(page, b.listing.title);
        if (!row) { console.log(`KDP-PAPERBACK: ${b.slug} — waiting: its Kindle edition is not on the bookshelf yet.`); continue; }
        const st = paperbackState(row.lines);
        if (st && st !== "DRAFT") { await writeFile(join(b.dir, "paperback.json"), JSON.stringify({ at: new Date().toISOString(), state: st, kindle_ref: row.id }, null, 2) + "\n"); console.log(`KDP-PAPERBACK: ${b.slug} — ${st}`); if (st !== "BLOCKED") n += 1; continue; }
        if (st === "DRAFT") throw stop("PAPERBACK_DRAFT_EXISTS", `a paperback draft already exists for "${b.listing.title}"; it is resumed by hand from the bookshelf (never a second one).`, 1);
        const item = itemSetFor(row.html, row.id);
        if (!item) throw stop("NO_ITEM_SET", `the bookshelf did not show the format link for "${b.listing.title}".`);
        await go(page, `${KDP}/action/dualbookshelf.addprintformat/title-setup/paperback/new/details?existing=${row.id}&item=${item}`);
        await page.waitForTimeout(4000);
        await tickAui(page, 'input[name="data-print-book-is-public-domain"][value="false"]');
        await tickAui(page, 'input[name="data[print_book][is_adult_content]-radio"][value="false"]');
        await categories(page, b.listing.categories, b.dir);
        // The first press after the category box can do nothing (seen live on Kindle and print, 8 Nov 2026): at most two.
        for (let i = 0; i < 2 && !/\/content/.test(page.url()); i += 1) {
          await page.locator("#save-and-continue-announce").scrollIntoViewIfNeeded().catch(() => {});
          await clickOne(page, "Save and Continue", ["#save-and-continue-announce", (p) => p.getByRole("button", { name: /Save and Continue/i })]);
          await page.waitForURL(/\/content/, { timeout: STEP_MS }).catch(() => {});
        }
        if (!/\/content/.test(page.url())) { const shot = await snapshot(page, b.dir, "stop-paperback-details"); throw stop("DETAILS_NOT_SAVED", `Amazon did not move on from the paperback details step. Page kept at ${shot}.`, 9); }
        await content(page, b);
        const published = await pricing(page, b);
        const after = published ? await shelfRow(page, b.listing.title) : null;
        const state = after ? paperbackState(after.lines) ?? "NOT_FOUND" : "DRY_RUN";
        await writeFile(join(b.dir, "paperback.json"), JSON.stringify({ at: new Date().toISOString(), state, kindle_ref: row.id }, null, 2) + "\n");
        console.log(`KDP-PAPERBACK: ${b.slug} — ${state}`);
        if (["IN_REVIEW", "PUBLISHING", "LIVE"].includes(state)) n += 1;
      } catch (e) {
        await snapshot(page, b.dir, `stop-paperback-${String(e.stop ?? "failed").toLowerCase()}`);
        console.log(`KDP-PAPERBACK: ${b.slug} — STOPPED ${String(e.message).slice(0, 300)}`);
        code = e.code ?? 1;
        if (e.stop === "SIGNIN_NOT_DONE") break;
      }
    }
  } finally { await context.close().catch(() => {}); }
  console.log(`OUTPUT ${n} paperbacks-submitted`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().then((c) => process.exit(c)).catch((e) => { console.error(String(e?.message ?? e)); console.log("OUTPUT 0 paperbacks-submitted"); process.exit(1); });
}
