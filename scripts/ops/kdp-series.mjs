#!/usr/bin/env node
/**
 * ONE AMAZON SERIES PER KINDLE LINE (KDP strategy, spry brain 8 Nov 2026: "Each line is an Amazon
 * series with an author page"). Creates the series page for a line's `series` (kdp-books/<line>.json)
 * once, so kdp-new-title.mjs can add each book to it ("Add to series" → Existing series).
 *
 * KDP's own page (read live 8 Nov 2026): Create → "Create series page" → /series-setup/series/new,
 * with Language, Series title, Reading order (ordered / un-ordered), an optional Description, and
 * "Submit updates". Signed in by Simone's own steps (kdp-signin.mjs signInOnPage; her ruling 8 Nov
 * 2026); a picture check or a failed sign-in is a NAMED STOP to the owner, never solved here.
 *
 * It never creates a series twice: a line already in ~/.boss-os/kdp/series.json, or whose series name
 * the bookshelf already shows, is skipped.
 *
 *   npm run -s vault:run -- node scripts/ops/kdp-series.mjs [--line wedding] [--dry-run]
 *
 * Output: `KDP-SERIES: <line> — created|exists|STOPPED …` per line and `OUTPUT <n> kindle-series-created`.
 * Exit 0 every series exists · 3 sign-in needs her · 9 Amazon refused.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openProfile } from "./browser.mjs";
import { lineSpecs } from "./kdp-build.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.BOSS_OS_KDP_DIR ?? `${process.env.HOME}/.boss-os/kdp`;
const RECORD = join(OUT_DIR, "series.json");
const KDP = "https://kdp.amazon.com/en_US";
const SIGNIN = /\/ap\/(?:signin|mfa|cvf|challenge)|captcha/i;
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const stop = (code, msg, exit = 9) => Object.assign(new Error(`NAMED STOP [${code}] ${msg}`), { code: exit, stop: code });

/** Which lines still need a series, given the record and the bookshelf's text. Pure. */
export function seriesToCreate(lines, record = {}, shelfText = "") {
  const shelf = String(shelfText).toLowerCase();
  return lines.filter((l) => l.series?.name && !record[l.line] && !shelf.includes(l.series.name.toLowerCase()));
}

async function signedIn(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(4000);
  if (!SIGNIN.test(page.url())) return;
  const { signInOnPage } = await import("./kdp-signin.mjs");
  const r = await signInOnPage(page, { email: process.env.KDP_ACCOUNT_EMAIL ?? "", password: process.env.KDP_ACCOUNT_PASSWORD ?? "", editUrl: url });
  if (r.code !== 0) throw stop("SIGNIN", `Simone could not sign in to KDP (${r.state}): ${r.detail}`, 3);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(4000);
  if (SIGNIN.test(page.url())) throw stop("SIGNIN", "Amazon still asks for a sign-in after Simone signed in.", 3);
}

async function create(page, line) {
  await signedIn(page, `${KDP}/series-setup/series/new`);
  const title = page.locator("#data-series-title");
  if (!(await title.count())) throw stop("FIELD_NOT_FOUND", "the series title box is not on the series setup page.");
  await title.fill(line.series.name);
  await page.locator('input[name="data[is_series_ordered]"]').first().check().catch(() => {});
  if (line.series.description) {
    await page.waitForFunction(() => Object.values(window.CKEDITOR?.instances ?? {}).some((e) => e.status === "ready"), null, { timeout: 15_000 }).catch(() => {});
    await page.evaluate((html) => { for (const e of Object.values(window.CKEDITOR?.instances ?? {})) e.setData(html); }, `<p>${line.series.description.replace(/[<>&]/g, "")}</p>`).catch(() => {});
  }
  if (DRY) return "dry-run";
  await page.locator("#publish-button-announce").click();
  await page.waitForTimeout(8000);
  const err = (await page.locator(".a-alert-error .a-alert-content, .a-color-error").allInnerTexts().catch(() => [])).join(" ").trim();
  if (err) throw stop("SERIES_REFUSED", `Amazon refused the series "${line.series.name}": ${err.slice(0, 300)}`);
  // KDP opens the new series' own page (/series/<id>?action=publish) and says it goes live with its
  // first published main-content title (live page, 8 Nov 2026). No id = not created: a stop, never a guess.
  const id = /\/series\/([A-Z0-9]{8,})/.exec(page.url())?.[1];
  if (!id) throw stop("SERIES_NOT_CREATED", `KDP did not open a series page after Submit (at ${page.url().split("?")[0]}).`);
  return id;
}

export async function run({ only = flag("line"), root = flag("root") ?? join(HERE, "../..") } = {}) {
  const lines = (await lineSpecs(root)).map((s) => s.line).filter((l) => !only || l.line === only);
  let record = {};
  try { record = JSON.parse(await readFile(RECORD, "utf8")); } catch {}
  const { context } = await openProfile("kdp", { headed: false });
  const page = context.pages()[0] ?? (await context.newPage());
  let made = 0, code = 0;
  try {
    await page.goto(`${KDP}/bookshelf`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(5000);
    const shelf = SIGNIN.test(page.url()) ? "" : await page.locator("body").innerText().catch(() => "");
    const todo = seriesToCreate(lines, record, shelf);
    for (const l of lines.filter((x) => !todo.includes(x))) console.log(`KDP-SERIES: ${l.line} — exists ("${l.series?.name}")`);
    for (const l of todo) {
      try {
        const id = await create(page, l);
        if (id !== "dry-run") { record[l.line] = { name: l.series.name, id, at: new Date().toISOString() }; made += 1; }
        console.log(`KDP-SERIES: ${l.line} — ${id === "dry-run" ? "dry run, nothing submitted" : `created "${l.series.name}" (${id})`}`);
      } catch (e) { console.log(`KDP-SERIES: ${l.line} — STOPPED ${e.message}`); code = e.code ?? 9; if (e.stop === "SIGNIN") break; }
    }
  } finally {
    await context.close().catch(() => {});
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(RECORD, JSON.stringify(record, null, 2) + "\n");
  }
  console.log(`OUTPUT ${made} kindle-series-created`);
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().then((c) => process.exit(c)).catch((e) => { console.error(String(e?.message ?? e)); console.log("OUTPUT 0 kindle-series-created"); process.exit(e?.code ?? 1); });
}
