#!/usr/bin/env node
/**
 * THE BOOKS ALREADY ON AMAZON, BROUGHT UP TO THE KDP STRATEGY (owner, 8 Nov 2026: "the 8 existing
 * books may be adjusted under this plan, beyond subtitles/keywords/categories"; spry brain: "subtitles
 * rewritten as a promise (not raw search phrases); keywords and categories rechecked").
 *
 * Reads `scripts/ops/kdp-books/existing-books.json` (one row per title on the bookshelf) and, for each
 * title that is Live, changes on KDP only what the row changes:
 *   details  the subtitle, the 7 keywords, the categories (replaced). NEVER the title's author
 *            (KDP locks it, and the pen names are for new books only).
 *   content  the cover (docs/kdp/books/assets/covers/<slug>.jpg, full size) and the manuscript,
 *            re-linked so the companion page is a live link with the book's utm tag
 *   pricing  KDP Select, the price (35% below $2.99, 70% from it), then Publish
 * A title In review (or Blocked) is left alone. Every change made is recorded in
 * ~/.boss-os/kdp/live-updates.json and on the title's row in kdp-register.json (`updated`), so
 * Simone's runs see the true state. Signed in by Simone's own steps; a stop keeps a snapshot.
 *
 *   npm run -s vault:run -- node scripts/ops/kdp-update-live.mjs [--slug credit-dispute-letter] [--dry-run]
 *
 * Output: `KDP-UPDATE: <slug> — <what changed> → <bookshelf state>` per title and
 * `OUTPUT <n> live-kindle-titles-updated`.
 */
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openProfile } from "./browser.mjs";
import { companionLink } from "./kdp-books/series.mjs";
import { jpegHeight } from "./kdp-build.mjs";
import { snapshot, go, first, fillField, clickOne, categories, upload, autoSignin, RUN, normTitle, shelfRowsIn, parseShelfRow } from "./kdp-new-title.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const KDP = "https://kdp.amazon.com/en_US";
const OUT_DIR = process.env.BOSS_OS_KDP_DIR ?? `${process.env.HOME}/.boss-os/kdp`;
const WORK = join(OUT_DIR, "live-updates");
const RECORD = join(OUT_DIR, "live-updates.json");
const REGISTER = process.env.BOSS_OS_KDP_REGISTER ?? join(HERE, "kdp-register.json");
const STEP_MS = 90_000;
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const stop = (code, msg, exit = 1) => Object.assign(new Error(`NAMED STOP [${code}] ${msg}`), { code: exit, stop: code });
const home = (p) => String(p ?? "").replace(/^~(?=\/)/, process.env.HOME ?? "~");

/**
 * The companion link made live and tagged, in one XHTML file: an existing <a href> to the companion
 * page (or to an `also` URL, e.g. the site's home page) is pointed at `link`; the companion URL written
 * as plain text (with or without https://, a trailing slash or a full stop after it) becomes a link.
 * Text inside an existing <a> is never wrapped twice. Pure.
 */
export function relinkHtml(html, { companion, link, also = [] }) {
  const bare = (u) => String(u).replace(/^https?:\/\//, "").replace(/\/$/, "");
  const targets = [companion, ...also].map(bare);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const amp = link.replace(/&/g, "&amp;");
  let out = String(html).replace(/href="([^"]*)"/g, (m, href) => (targets.includes(bare(href.split("?")[0])) ? `href="${amp}"` : m));
  const plain = new RegExp(`(?:https?:\\/\\/)?${esc(bare(companion))}\\/?`, "g");
  let depth = 0;
  out = out.split(/(<[^>]+>)/).map((part) => {
    if (part.startsWith("<")) { if (/^<a[\s>]/i.test(part)) depth += 1; else if (/^<\/a>/i.test(part)) depth = Math.max(0, depth - 1); return part; }
    return depth ? part : part.replace(plain, (m) => `<a href="${amp}">${m.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>`);
  }).join("");
  return out;
}

/** What one existing-books row changes against the bookshelf row it matches. Pure. */
export function changesFor(spec, shelf) {
  const c = [];
  const nowSub = String(shelf.title ?? "").includes(":") ? shelf.title.split(":").slice(1).join(":").trim() : "";
  if (spec.subtitle && normTitle(spec.subtitle) !== normTitle(nowSub)) c.push("subtitle");
  if (Array.isArray(spec.keywords) && spec.keywords.length === 7) c.push("keywords");
  if (Array.isArray(spec.categories) && spec.categories.length) c.push("categories");
  if (spec.price_usd && shelf.price_usd != null && Math.abs(shelf.price_usd - spec.price_usd) > 0.001) c.push("price");
  if (spec.cover?.preview) c.push("cover");
  if (spec.in_book_link_fix && spec.interior?.source) c.push("manuscript");
  c.push("select");
  return c;
}

async function relinkEpub(src, out, spec) {
  const tmp = join(WORK, `${spec.slug}.x`);
  await rm(tmp, { recursive: true, force: true }); await mkdir(tmp, { recursive: true });
  execFileSync("unzip", ["-q", src, "-d", tmp]);
  const link = companionLink({ companion_url: spec.companion_url, slug: spec.slug });
  const also = /home page/i.test(spec.in_book_link_now ?? "") ? [new URL(spec.companion_url).origin] : /^https?:\/\//.test(String(spec.in_book_link_now ?? "").split(" ")[0]) ? [String(spec.in_book_link_now).split(" ")[0]] : [];
  let changed = 0;
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.x?html?$/i.test(e.name)) { const a = await readFile(p, "utf8"); const b = relinkHtml(a, { companion: spec.companion_url, link, also }); if (a !== b) { changed += 1; await writeFile(p, b); } }
    }
  };
  await walk(tmp);
  if (!changed) throw stop("LINK_NOT_FOUND", `the companion link ${spec.companion_url} is not printed anywhere in ${src}; the manuscript was not changed.`);
  await rm(out, { force: true });
  execFileSync("zip", ["-X0q", out, "mimetype"], { cwd: tmp });
  execFileSync("zip", ["-Xr9Dq", out, ".", "-x", "mimetype"], { cwd: tmp });
  await rm(tmp, { recursive: true, force: true });
  return changed;
}

/** Categories, replaced: the placements KDP holds now are removed first, then ours are ticked. */
async function replaceCategories(page, cats, dir) {
  const btn = page.locator("#categories-modal-button");
  if (/Edit categories/i.test((await btn.innerText().catch(() => "")) || "")) {
    await btn.click(); await page.waitForTimeout(2000);
    const modal = page.locator('.a-popover[aria-hidden="false"]').last();
    for (let i = 0; i < 6; i += 1) {
      const rm = modal.getByRole("button", { name: /^\s*Remove\s*$/i }).first();
      if (await rm.count().catch(() => 0)) { await rm.click().catch(() => {}); await page.waitForTimeout(700); continue; }
      const box = modal.locator('input[type="checkbox"]:checked').first();
      if (await box.count().catch(() => 0)) { await box.click().catch(() => {}); await page.waitForTimeout(700); continue; }
      break;
    }
    const save = modal.getByRole("button", { name: /^\s*save/i }).first();
    if (await save.count().catch(() => 0)) await save.click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  await categories(page, cats, dir);
}

async function update(page, spec, row, todo, dir) {
  await go(page, `${KDP}/title-setup/kindle/${row.id}/details`);
  await page.waitForTimeout(2500);
  // The author is never touched: read it, and stop if the page is not the title the register names.
  const last = await page.locator("#data-primary-author-last-name, input[name=\"data[primary_author][last_name]\"]").first().inputValue().catch(() => "");
  if (spec.author && last && !spec.author.endsWith(last)) throw stop("NOT_THIS_TITLE", `the details page reads author "${last}", not ${spec.author}; nothing was changed.`);
  if (todo.includes("subtitle")) await fillField(page, "subtitle", ['input[name="data[subtitle]"]', "#data-subtitle"], spec.subtitle);
  if (todo.includes("keywords")) for (let i = 0; i < 7; i += 1) await fillField(page, `keyword ${i + 1}`, [`input[name="data[keywords][${i}]"]`, `#data-keywords-${i}`], spec.keywords[i]);
  if (todo.includes("categories")) await replaceCategories(page, spec.categories, dir).catch((e) => { console.log(`  ${spec.slug}: categories kept as they were (${String(e.message).slice(0, 160)})`); todo.splice(todo.indexOf("categories"), 1); });
  await clickOne(page, "Save and Continue", ["#save-and-continue-announce", (p) => p.getByRole("button", { name: /Save and Continue/i })]);
  await page.waitForURL(/\/content/, { timeout: STEP_MS }).catch(() => {});
  if (!/\/content/.test(page.url())) throw stop("DETAILS_NOT_SAVED", `Amazon did not move on from the details step: ${(await page.locator(".a-alert-content, .a-color-error").allInnerTexts().catch(() => [])).join(" ").slice(0, 300) || "no message shown"}.`, 9);
  if (todo.includes("manuscript")) await upload(page, "manuscript", ["#data-assets-interior-file-upload-AjaxInput", 'input[type="file"][id*="interior"]'], join(dir, "book.epub"), dir);
  if (todo.includes("cover")) {
    const choose = await first(page, [(p) => p.getByLabel(/Upload a cover you already have/i), (p) => p.getByText(/Upload a cover you already have/i)]);
    if (choose) await choose.click().catch(() => {});
    await upload(page, "cover", ["#data-assets-cover-file-upload-AjaxInput", 'input[type="file"][id*="cover"]'], join(dir, "cover.jpg"), dir);
  }
  await clickOne(page, "Save and Continue", ["#save-and-continue-announce", (p) => p.getByRole("button", { name: /Save and Continue/i })]);
  await page.waitForURL(/\/pricing/, { timeout: STEP_MS }).catch(() => {});
  if (!/\/pricing/.test(page.url())) throw stop("CONTENT_NOT_SAVED", "Amazon did not move on from the content step.", 9);
  const sel = await first(page, ["#data-is-select"]);
  if (sel && !(await sel.isChecked().catch(() => true))) await sel.check().catch(() => {});
  if (todo.includes("price")) {
    const pct = spec.price_usd >= 2.99 ? /^70%/ : /^35%/;
    const r = await first(page, [(p) => p.getByLabel(pct)]);
    if (r) await r.check().catch(() => {});
    await fillField(page, "Amazon.com price", ['input[name="data[digital_list_price][USD]"]', 'input[id*="price"][id*="US"]'], spec.price_usd.toFixed(2));
  }
  if (DRY) return "DRY_RUN";
  await clickOne(page, "Publish Your Kindle eBook", [(p) => p.getByRole("button", { name: /Publish Your Kindle eBook/i }), "#save-and-publish-announce"]);
  await page.waitForTimeout(8000);
  const err = (await page.locator(".a-alert-error .a-alert-content, .a-color-error").allInnerTexts().catch(() => [])).join(" ").trim();
  if (err) throw stop("PUBLISH_REFUSED", `Amazon refused the update: ${err.slice(0, 300)}`, 9);
  return "submitted";
}

async function bookshelfRows(page) {
  await go(page, `${KDP}/bookshelf`);
  await page.waitForTimeout(5000);
  const rows = [];
  for (let p = 0; p < 4; p += 1) {
    rows.push(...(await page.evaluate(`(${shelfRowsIn})(document)`).catch(() => [])));
    const next = page.locator(".a-pagination .a-last a").first();
    if (!(await next.count().catch(() => 0))) break;
    await next.click().catch(() => {}); await page.waitForTimeout(4000);
  }
  return rows.map((r) => ({ id: r.id, ...parseShelfRow(r.lines) }));
}

async function recordRegister(spec, row, todo, state) {
  const reg = JSON.parse(await readFile(REGISTER, "utf8"));
  const t = reg.titles.find((x) => x.title_ref === row.id || x.asin === row.asin || normTitle(x.title) === normTitle(spec.title));
  const entry = { on: new Date().toISOString().slice(0, 10), changed: todo, state_after: state, subtitle: spec.subtitle, price_usd: spec.price_usd };
  if (t) t.updated = entry;
  else reg.titles.push({ title_ref: row.id, title: spec.title, author: spec.author, target: "LIVE", status: "LIVE", status_as_of: entry.on, asin: row.asin, line: spec.line, updated: entry });
  await writeFile(REGISTER, JSON.stringify(reg, null, 2) + "\n");
}

export async function run({ only = flag("slug") } = {}) {
  const specs = JSON.parse(await readFile(join(ROOT, "scripts/ops/kdp-books/existing-books.json"), "utf8")).books.filter((b) => !only || b.slug === only);
  let record = {};
  try { record = JSON.parse(await readFile(RECORD, "utf8")); } catch {}
  await mkdir(WORK, { recursive: true });
  Object.assign(RUN, { unattended: true, autoSignin, tellSignin: async () => {} });
  const { context } = await openProfile("kdp", { headed: args.includes("--headed") });
  const page = context.pages()[0] ?? (await context.newPage());
  let n = 0, code = 0;
  try {
    const rows = await bookshelfRows(page);
    for (const spec of specs) {
      const dir = join(WORK, spec.slug);
      await mkdir(dir, { recursive: true });
      if (record[spec.slug]?.state === "submitted") { console.log(`KDP-UPDATE: ${spec.slug} — already updated on ${record[spec.slug].at.slice(0, 10)}`); continue; }
      const row = rows.find((r) => normTitle(r.title).startsWith(normTitle(spec.title)));
      if (!row) { console.log(`KDP-UPDATE: ${spec.slug} — not on the bookshelf; nothing changed.`); continue; }
      if (row.state !== "LIVE") { console.log(`KDP-UPDATE: ${spec.slug} — left alone: ${row.state ?? "state unread"} on the bookshelf.`); continue; }
      const todo = changesFor(spec, row);
      try {
        if (todo.includes("cover")) {
          const img = join(ROOT, spec.cover.preview);
          if (!existsSync(img) || jpegHeight(await readFile(img)) < 1000) { todo.splice(todo.indexOf("cover"), 1); console.log(`  ${spec.slug}: cover kept (no full-size file at ${spec.cover.preview}).`); }
          else await writeFile(join(dir, "cover.jpg"), await readFile(img));
        }
        if (todo.includes("manuscript")) {
          const src = home(spec.interior.source);
          if (!existsSync(src)) { todo.splice(todo.indexOf("manuscript"), 1); console.log(`  ${spec.slug}: manuscript kept (source ${spec.interior.source} not on this Mac).`); }
          else await relinkEpub(src, join(dir, "book.epub"), spec).catch((e) => { todo.splice(todo.indexOf("manuscript"), 1); console.log(`  ${spec.slug}: manuscript kept (${String(e.message).slice(0, 160)})`); });
        }
        const r = await update(page, spec, row, todo, dir);
        record[spec.slug] = { at: new Date().toISOString(), state: r, changed: todo, title_ref: row.id };
        if (r === "submitted") { await recordRegister(spec, row, todo, "IN_REVIEW"); n += 1; }
        console.log(`KDP-UPDATE: ${spec.slug} — ${todo.join(", ")} → ${r}`);
      } catch (e) {
        await snapshot(page, dir, `stop-${String(e.stop ?? "failed").toLowerCase()}`);
        console.log(`KDP-UPDATE: ${spec.slug} — STOPPED ${String(e.message).slice(0, 300)}`);
        code = e.code ?? 1;
        if (e.stop === "SIGNIN_NOT_DONE") break;
      }
    }
  } finally {
    await context.close().catch(() => {});
    await writeFile(RECORD, JSON.stringify(record, null, 2) + "\n");
  }
  console.log(`OUTPUT ${n} live-kindle-titles-updated`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().then((c) => process.exit(c)).catch((e) => { console.error(String(e?.message ?? e)); console.log("OUTPUT 0 live-kindle-titles-updated"); process.exit(1); });
}
