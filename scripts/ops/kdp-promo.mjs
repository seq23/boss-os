#!/usr/bin/env node
/**
 * THE 5 FREE DAYS FOR EACH NEW BOOK (KDP strategy, spry brain 8 Nov 2026: "Launch per batch (free):
 * 5 free days"). For every series book that is Live (its ~/.boss-os/kdp/books/<slug>/publish.json,
 * written by kdp-new-title.mjs from the bookshelf) and has no promo.json yet, Simone schedules one
 * KDP Select Free Book Promotion of 5 days, starting LEAD_DAYS out, through the book's own promotion
 * manager (read live 8 Nov 2026: /marketing/<id>/promotion-manager → "Free Book Promotion" →
 * /create-freebook, a start and an end date picker, "Save Changes"). Free to run; nothing is spent.
 *
 *   npm run -s vault:run -- node scripts/ops/kdp-promo.mjs [--dry-run]
 *
 * Output: `KDP-PROMO: <slug> — scheduled <start>–<end>` (or why not) per book and
 * `OUTPUT <n> kindle-free-promos-scheduled`. A sign-in Simone cannot finish is a NAMED STOP (exit 3).
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openProfile } from "./browser.mjs";
import { BOOKS_DIR } from "./kdp-build.mjs";

const KDP = "https://kdp.amazon.com";
const SIGNIN = /\/ap\/(?:signin|mfa|cvf|challenge)|captcha/i;
const DAY = 86_400_000;
/** Start a few days out: the review ask to the site's list goes the day the free days begin. */
export const LEAD_DAYS = Number(process.env.KDP_PROMO_LEAD_DAYS ?? 3);
export const FREE_DAYS = 5;
const DRY = process.argv.includes("--dry-run");

/** The promo window in Pacific dates (KDP's promotion days are midnight Pacific). Pure. */
export function promoWindow(now, { lead = LEAD_DAYS, days = FREE_DAYS } = {}) {
  const pt = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(ms));
  return { start: pt(now + lead * DAY), end: pt(now + (lead + days - 1) * DAY) };
}

/** Which built books are Live with a KDP id and no promotion yet. Pure but for `read`. */
export async function booksDue(dir = BOOKS_DIR, read = (f) => readFile(f, "utf8")) {
  const out = [];
  let slugs = [];
  try { slugs = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return out; }
  for (const slug of slugs) {
    if (existsSync(join(dir, slug, "promo.json"))) continue;
    try {
      const pub = JSON.parse(await read(join(dir, slug, "publish.json")));
      const listing = JSON.parse(await read(join(dir, slug, "listing.json")));
      if (pub?.resulting_state === "LIVE" && pub.title_ref && listing.kdp_select) out.push({ slug, id: pub.title_ref, title: listing.title });
    } catch {}
  }
  return out;
}

async function pickDate(page, input, iso) {
  const [y, m, d] = iso.split("-").map(Number);
  await page.locator(input).click();
  for (let i = 0; i < 4; i += 1) {
    const cell = page.locator(`.ui-datepicker-calendar td[data-year="${y}"][data-month="${m - 1}"] a`).filter({ hasText: new RegExp(`^${d}$`) }).first();
    if (await cell.count()) { await cell.click(); await page.waitForTimeout(800); return; }
    await page.locator(".ui-datepicker-next").first().click().catch(() => {});
    await page.waitForTimeout(500);
  }
  throw new Error(`the date ${iso} is not offered by KDP's picker`);
}

async function schedule(page, book, win) {
  const url = `${KDP}/marketing/${book.id}/promotion-manager/create-freebook`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(4000);
  if (SIGNIN.test(page.url())) {
    const { signInOnPage } = await import("./kdp-signin.mjs");
    const r = await signInOnPage(page, { email: process.env.KDP_ACCOUNT_EMAIL ?? "", password: process.env.KDP_ACCOUNT_PASSWORD ?? "", editUrl: url });
    if (r.code !== 0) throw Object.assign(new Error(`NAMED STOP [SIGNIN] Simone could not sign in to KDP (${r.state}): ${r.detail}`), { code: 3, signin: true });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(4000);
  }
  if (!(await page.locator("#start-date-input").count())) throw new Error("the free promotion form is not offered (not in KDP Select yet, or this period's promotion is used)");
  await pickDate(page, "#start-date-input", win.start);
  await pickDate(page, "#end-date-input", win.end);
  if (DRY) return "dry-run";
  await page.locator("#promotion-manager-freebook-save-changes-announce, [aria-labelledby=\"promotion-manager-freebook-save-changes-announce\"]").first().click();
  await page.waitForTimeout(6000);
  const err = (await page.locator(".a-alert-error .a-alert-content, .a-color-error").allInnerTexts().catch(() => [])).join(" ").trim();
  if (err) throw new Error(`Amazon refused the promotion: ${err.slice(0, 200)}`);
  return "scheduled";
}

export async function run({ now = Date.now() } = {}) {
  const due = await booksDue();
  if (!due.length) { console.log("KDP-PROMO: none due — no Live series book is waiting for its free days."); console.log("OUTPUT 0 kindle-free-promos-scheduled"); return 0; }
  const win = promoWindow(now);
  const { context } = await openProfile("kdp", { headed: false });
  const page = context.pages()[0] ?? (await context.newPage());
  let n = 0, code = 0;
  try {
    for (const b of due) {
      try {
        const r = await schedule(page, b, win);
        if (r === "scheduled") { await writeFile(join(BOOKS_DIR, b.slug, "promo.json"), JSON.stringify({ at: new Date(now).toISOString(), ...win, title_ref: b.id }, null, 2) + "\n"); n += 1; }
        console.log(`KDP-PROMO: ${b.slug} — ${r} ${win.start}–${win.end} (Pacific)`);
      } catch (e) { console.log(`KDP-PROMO: ${b.slug} — not scheduled: ${String(e.message).slice(0, 240)}`); if (e.signin) { code = 3; break; } code = code || 9; }
    }
  } finally { await context.close().catch(() => {}); }
  console.log(`OUTPUT ${n} kindle-free-promos-scheduled`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().then((c) => process.exit(c)).catch((e) => { console.error(String(e?.message ?? e)); console.log("OUTPUT 0 kindle-free-promos-scheduled"); process.exit(1); });
}
