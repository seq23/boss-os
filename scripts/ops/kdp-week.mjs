#!/usr/bin/env node
/**
 * SIMONE'S MONDAY KINDLE LINE (KDP strategy, spry brain 8 Nov 2026): what the week's books did.
 *
 * Reads what kdp-units.mjs just wrote (~/.boss-os/kdp/units.json: units and Kindle Unlimited pages per
 * title) and counts visits to each book's companion page (`companion_url` in kdp-books/*.json, the
 * page the link printed in the book opens) over the last 7 days, through the existing Cloudflare Web
 * Analytics reader (site-leads-read.mjs `rumCount`). Writes ~/.boss-os/kdp/week.json and prints
 *
 *   KDP-WEEK: 0 sold · 58 KU pages · 4 companion visits
 *
 * which kdp-publish.sh puts on the run's OUTPUT line (what Today shows for her Monday run).
 * A part that could not be read says "not read", never 0 (Rule 0).
 *
 *   npm run -s vault:run -- node scripts/ops/kdp-week.mjs
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { salesLine } from "./lib/kdp-units.mjs";

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

/** The one line. Pure. */
export function weekLine({ units, visits }) {
  const v = visits?.unread ? "companion visits not read" : `${visits?.total ?? 0} companion visits`;
  return `${salesLine(units)} · ${v}`;
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
  const line = weekLine({ units, visits });
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "week.json"), JSON.stringify({ at: new Date(now).toISOString(), line, units, visits }, null, 2) + "\n");
  return { line, visits };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().then(({ line, visits }) => {
    console.log(`KDP-WEEK: ${line}`);
    for (const [slug, why] of Object.entries(visits.not_read ?? {})) console.log(`  companion visits not read for ${slug}: ${why}`);
  }).catch((e) => { console.log(`KDP-WEEK: not read: ${String(e?.message ?? e).slice(0, 160)}`); process.exit(2); });
}
