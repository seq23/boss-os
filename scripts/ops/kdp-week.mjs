#!/usr/bin/env node
/**
 * SIMONE'S MONDAY KINDLE LINE (KDP strategy, spry brain 8 Nov 2026): what the week's books did.
 *
 * Reads what kdp-units.mjs just wrote (~/.boss-os/kdp/units.json: units and Kindle Unlimited pages per
 * title) and counts visits to each book's companion page (`companion_url` in kdp-books/*.json, the
 * page the link printed in the book opens) over the last 7 days, through the existing Cloudflare Web
 * Analytics reader (site-leads-read.mjs `rumCount`). Writes ~/.boss-os/kdp/week.json and prints
 *
 *   KDP-WEEK: 2 live, 0 in review, 7 queued, 0 stopped | 0 sold, 58 KU pages, 4 companion visits
 *
 * which kdp-publish.sh puts on the run's OUTPUT line (what Today shows for her Monday run).
 * A part that could not be read says "not read", never 0 (Rule 0).
 *
 *   npm run -s vault:run -- node scripts/ops/kdp-week.mjs
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.BOSS_OS_KDP_DIR ?? `${process.env.HOME}/.boss-os/kdp`;
const DAY = 86_400_000;

/** Every book's companion page, from every line spec: [{ slug, host, path }]. Pure but for `read`. */
export function companionPages(dir = join(HERE, "kdp-books"), read = (f) => readFileSync(f, "utf8"), list = () => readdirSync(dir)) {
  const out = [];
  for (const f of list().filter((n) => n.endsWith(".json")).sort()) {
    let spec; try { spec = JSON.parse(read(join(dir, f))); } catch { continue; }
    for (const b of [...(spec.series_books ?? []), ...(spec.books ?? []), ...(spec.titles ?? [])]) {
      if (!b?.companion_url) continue;
      try { const u = new URL(b.companion_url); out.push({ slug: b.slug, host: u.hostname, path: u.pathname }); } catch {}
    }
  }
  return out;
}

/** Every series book's title, from every line spec. Pure but for `read`. */
export function seriesTitles(dir = join(HERE, "kdp-books"), read = (f) => readFileSync(f, "utf8"), list = () => readdirSync(dir)) {
  const out = [];
  for (const f of list().filter((n) => n.endsWith(".json")).sort()) {
    try { for (const b of JSON.parse(read(join(dir, f))).series_books ?? []) if (b?.title) out.push(b.title); } catch {}
  }
  return out;
}

const norm = (t) => String(t ?? "").normalize("NFKC").toLowerCase().replace(/[\u2018\u2019'"]/g, "").replace(/\s+/g, " ").trim();

/**
 * The series books' state, from the LIVE bookshelf rows (`{ title, state }`, never from the queue
 * file): live · in review (In review or Publishing) · stopped (Blocked, or a Draft left behind) ·
 * queued (approved and built, not on the bookshelf yet). Pure.
 */
export function shelfCounts(titles, rows) {
  const out = { live: 0, review: 0, queued: 0, stopped: 0, stoppedTitles: [] };
  for (const t of titles) {
    const row = rows.find((r) => norm(r.title).startsWith(norm(t)));
    const st = row?.state ?? null;
    if (st === "LIVE") out.live += 1;
    else if (st === "IN_REVIEW" || st === "PUBLISHING") out.review += 1;
    else if (st === "BLOCKED" || st === "DRAFT") { out.stopped += 1; out.stoppedTitles.push(t); }
    else out.queued += 1;
  }
  return out;
}

/** Books stopped this week AND last week, by name. Pure. */
export const stoppedTwoWeeks = (prev = [], now = []) => now.filter((t) => prev.includes(t));

/**
 * Today shows at most 80 BYTES after the count (duty-run.sh's grep under launchd's C locale, and
 * rules.mjs / duties.ts), so the line is plain ASCII with commas, and longer words shorten first.
 */
export const OUTPUT_MAX = 80;
const SHORTER = [[" companion visits", " visits"], [" KU pages", " KU pg"], [" in review", " in rev"]];

/** Her Monday line: the bookshelf, then the sales. A part not read says so, never 0. Pure. */
export function weekLine({ shelf, units, visits }) {
  const books = !shelf || shelf.unread ? "bookshelf not read" : `${shelf.live} live, ${shelf.review} in review, ${shelf.queued} queued, ${shelf.stopped} stopped`;
  const sales = !units || units.unread ? "sales not read" : `${units.units_total} sold, ${units.kenp_total} KU pages`;
  const v = visits?.unread ? "visits not read" : `${visits?.total ?? 0} companion visits`;
  let line = `${books} | ${sales}, ${v}`;
  for (const [a, b] of SHORTER) if (Buffer.byteLength(line) > OUTPUT_MAX) line = line.split(a).join(b);
  return line.slice(0, OUTPUT_MAX);
}

export async function run({ env = process.env, now = Date.now(), fetchImpl = fetch } = {}) {
  let units;
  try { units = JSON.parse(readFileSync(join(OUT_DIR, "units.json"), "utf8")); } catch { units = { unread: "units.json is missing" }; }
  const pages = companionPages();
  const visits = { from: new Date(now - 7 * DAY).toISOString(), per_page: {}, total: 0, not_read: {} };
  try {
    const { rumCount } = await import("./lib/site-leads-read.mjs");
    const ctx = { env, fetch: fetchImpl, now };
    for (const p of pages) {
      try { const n = await rumCount(ctx, { host: p.host, paths: [p.path, `${p.path}*`] }, now - 7 * DAY, now); visits.per_page[p.slug] = n; visits.total += n; }
      catch (e) { visits.not_read[p.slug] = String(e?.message ?? e).slice(0, 120); }
    }
    if (!pages.length) visits.unread = "no book lists a companion page";
    else if (Object.keys(visits.not_read).length === pages.length) visits.unread = Object.values(visits.not_read)[0];
  } catch (e) { visits.unread = String(e?.message ?? e).slice(0, 160); }
  let shelf;
  try { shelf = shelfCounts(seriesTitles(), await readShelf()); } catch (e) { shelf = { unread: String(e?.message ?? e).slice(0, 160) }; }
  let prev = {};
  try { prev = JSON.parse(readFileSync(join(OUT_DIR, "week.json"), "utf8")); } catch {}
  const twoWeeks = shelf.unread ? [] : stoppedTwoWeeks(prev.shelf?.stoppedTitles ?? [], shelf.stoppedTitles);
  const line = weekLine({ shelf, units, visits });
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "week.json"), JSON.stringify({ at: new Date(now).toISOString(), line, shelf, units, visits, stopped_two_weeks: twoWeeks }, null, 2) + "\n");
  return { line, visits, shelf, twoWeeks };
}

/** The bookshelf as it is now (headless, Simone's KDP profile; reading it needs no fresh sign-in). */
async function readShelf() {
  const { openProfile } = await import("./browser.mjs");
  const { bookshelfRows } = await import("./kdp-update-live.mjs");
  const { context } = await openProfile("kdp", { headed: false });
  try {
    const rows = await bookshelfRows(context.pages()[0] ?? (await context.newPage()));
    if (!rows.length) throw new Error("the bookshelf showed no title (signed out?)");
    return rows;
  } finally { await context.close().catch(() => {}); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().then(({ line, visits, twoWeeks }) => {
    console.log(`KDP-WEEK: ${line}`);
    // A book stopped two Mondays running is named where Today shows a run's stop (duty-run.sh reads it).
    if (twoWeeks?.length) console.error(`NAMED STOP [STOPPED_TWO_WEEKS] ${twoWeeks.join("; ")} — stopped on the bookshelf two Mondays running.`);
    for (const [slug, why] of Object.entries(visits.not_read ?? {})) console.log(`  companion visits not read for ${slug}: ${why}`);
  }).catch((e) => { console.log(`KDP-WEEK: not read: ${String(e?.message ?? e).slice(0, 160)}`); process.exit(2); });
}
