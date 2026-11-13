#!/usr/bin/env node
/**
 * PROPERTIES.json: HER SITES, FOR THE BACKLINK PROSPECTING RUN (repair, 13 Nov 2026).
 *
 * The duty's prompt (migration 0193) has said since September: "PROPERTIES.json in your working
 * directory lists her sites and what each is about, newest performance first." NOTHING EVER WROTE
 * THAT FILE. Every run answered "blocked: missing PROPERTIES.json", delivered zero prospects, and
 * was recorded succeeded; `link_prospects` held zero rows, ever. This writes it, before the claim
 * (scripts/ops/agent-claim.sh), the way MARKETS.json and KNOWN.json are written.
 *
 *   · the sites and what each is about: src/shared/boss/searchReadiness/sites.json (`grid_repos`),
 *     HER OWN ONLY. A friend's or client's site (`category: "client"`) is left out: the prompt says
 *     "her sites", and the prospects land on her own list (personal brain, Repo categories);
 *   · "newest performance first": last week's Search Console clicks per site, read by
 *     scripts/ops/property-performance.mjs (the service account in the vault). When that cannot be
 *     read the file says `not read: <reason>` and keeps the list's own order: never 0, never a guess.
 *
 *   npm run -s vault:run -- node scripts/ops/properties-snapshot.mjs            # write the file
 *   node scripts/ops/properties-snapshot.mjs --dry-run                          # print, write nothing
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const LINKS_DIR = process.env.BOSS_OS_LINKS_WORKSPACE ?? `${process.env.HOME}/.boss-os/links`;

const hostOf = (site) => String(site ?? "").replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();

/**
 * The file's content. `perf` is property-performance.mjs's `--json` report, or `{ error }`. Sites
 * with clicks on record come first, most clicks first; the rest keep the list's own order. Pure.
 */
export function buildProperties(sites, perf, now = Date.now()) {
  const clicks = new Map();
  for (const r of Array.isArray(perf?.report) ? perf.report : []) {
    const host = hostOf(r?.site);
    if (host && Number.isFinite(Number(r?.clicks))) clicks.set(host, { clicks: Number(r.clicks), clicks_prev: Number(r.clicks_prev ?? 0) });
  }
  const rows = (sites ?? []).filter((s) => typeof s?.domain === "string" && s.domain.trim() && s.category !== "client").map((s, i) => {
    const p = clicks.get(hostOf(s.domain));
    return {
      property: s.domain.trim(), url: `https://${s.domain.trim()}/`,
      about: [s.label, s.coverage?.why].filter((x) => typeof x === "string" && x.trim()).join(". ").slice(0, 500),
      business: s.business ?? null, kind: s.kind ?? null,
      clicks_last_week: p ? p.clicks : "not read",
      clicks_week_before: p ? p.clicks_prev : "not read",
      _at: i,
    };
  });
  rows.sort((a, b) => (typeof b.clicks_last_week === "number" ? 1 : 0) - (typeof a.clicks_last_week === "number" ? 1 : 0)
    || (typeof a.clicks_last_week === "number" && typeof b.clicks_last_week === "number" ? b.clicks_last_week - a.clicks_last_week : 0)
    || a._at - b._at);
  const read = rows.filter((r) => typeof r.clicks_last_week === "number").length;
  return {
    computed_at: new Date(now).toISOString(),
    note: "Her sites and what each is about. Sites with Search Console clicks on record come first, most clicks first; work the top three. `property` is the value to put in each prospect's `property` field.",
    performance: read > 0 ? `Search Console clicks for the last full week, read for ${read} of ${rows.length} sites` : `not read: ${perf?.error ?? "Search Console returned no site this list names"}`,
    count: rows.length,
    properties: rows.map(({ _at, ...r }) => r),
  };
}

function performance() {
  return new Promise((resolve) => {
    execFile(process.execPath, [join(ROOT, "scripts/ops/property-performance.mjs"), "--json"], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return resolve({ error: `the Search Console read failed (${String(stderr || err.message).trim().split("\n")[0].slice(0, 160)})` });
      try { resolve(JSON.parse(stdout.slice(stdout.indexOf("{")))); } catch { resolve({ error: "the Search Console read printed no report" }); }
    });
  });
}

async function main() {
  const sites = JSON.parse(await readFile(join(ROOT, "src/shared/boss/searchReadiness/sites.json"), "utf8")).grid_repos ?? [];
  const out = buildProperties(sites, await performance());
  if (out.count === 0) throw Object.assign(new Error("NAMED STOP [NO_SITES] sites.json lists no site, so PROPERTIES.json was not written; backlink prospecting has nothing to work on until the list is restored"), { code: 2 });
  if (process.argv.includes("--dry-run")) { console.log(JSON.stringify(out, null, 2)); return; }
  await mkdir(LINKS_DIR, { recursive: true });
  await writeFile(join(LINKS_DIR, "PROPERTIES.json"), JSON.stringify(out, null, 2));
  console.log(`PROPERTIES.json: ${out.count} sites written to ${LINKS_DIR}; performance: ${out.performance}`);
  console.log(`OUTPUT ${out.count} properties written`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(e.code ?? 1); });
}
