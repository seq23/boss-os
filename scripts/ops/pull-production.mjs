/**
 * PULL PRODUCTION INTO THE LOCAL DATABASE, SO THE OFFLINE APP SHOWS HER REAL DATA.
 *
 * `Boss OS (Local)` runs the same Worker against a database in `.wrangler/state` — the same code,
 * a different and empty world. That gap is the whole reason the local app was worth building and
 * also the reason it was not yet worth using: an application that looks like Boss OS and shows an
 * empty screen is worse than no application, because she would trust the empty screen.
 *
 * This closes it. Production is read table by table into the exact payload `scripts/backup/backup.mjs`
 * produces, and `scripts/backup/restore.mjs` loads it — the restore path already knows how to drop
 * the immutability triggers, rebuild the schema from migrations, load rows and put every trigger
 * back. One restore path, two sources, rather than a second loader to keep in step.
 *
 * ─── ONE DIRECTION, AND IT IS ENFORCED RATHER THAN INTENDED ─────────────────
 *
 * PRODUCTION → LOCAL. Never the reverse, and there is no flag for it. A script that could push a
 * laptop's copy back over her live database is one keystroke away from destroying the real thing
 * with a stale one — and the moment it exists, it will eventually be run by someone tired.
 *
 * Every statement this file issues is a SELECT, checked before it is sent. Not because the strings
 * are hard to read, but because a guard makes the property survive the next edit.
 *
 * ─── The copy is real data on her laptop, and that is the point ─────────────
 *
 * It lands in `backups/`, which is gitignored, and it contains everything — her chart, her
 * relationships, her reports. That is not a leak: it is the same data, on the machine she owns,
 * which is strictly more sovereign than living only in Cloudflare. It is worth saying plainly
 * because "download the whole database" deserves a sentence rather than a shrug.
 *
 * ─── Read in chunks ─────────────────────────────────────────────────────────
 *
 * `wrangler d1 execute --remote` returns one JSON blob, and a table large enough to blow that limit
 * fails as a parse error that looks like a bug in this file. Paging by primary-key-free LIMIT/OFFSET
 * keeps every response small and makes the failure mode "slower", not "wrong".
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const DB = process.env.BOSS_OS_PROD_DB ?? "boss-os";
const ENVIRONMENT = process.env.BOSS_OS_PROD_ENV ?? "production";
const BACKUPS = path.resolve(new URL("../../backups", import.meta.url).pathname);
const PAGE = Number(process.env.PULL_PAGE_SIZE ?? 2000);

/**
 * Run one statement against production, and refuse anything that is not a read.
 *
 * The check is on the statement rather than on the caller's intent: a future edit that passes an
 * UPDATE here fails immediately and loudly instead of quietly modifying her live database.
 */
function prodQuery(sql) {
  const trimmed = sql.trim();
  if (!/^SELECT\b/i.test(trimmed) || /;/.test(trimmed.slice(0, -1))) {
    throw new Error(`refused: this script only reads. Rejected statement: ${trimmed.slice(0, 80)}`);
  }
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB, "--env", ENVIRONMENT, "--remote", "--json", "--command", trimmed],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CI: "true" } },
  );
  // wrangler prints progress lines before the JSON; take the array.
  const start = out.indexOf("[");
  if (start < 0) throw new Error(`no JSON in wrangler output: ${out.slice(0, 200)}`);
  return JSON.parse(out.slice(start)).flatMap((e) => e.results ?? []);
}

function main() {
  console.log(`Reading ${DB} (${ENVIRONMENT}) — read-only, one table at a time.\n`);

  const tables = prodQuery(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' " +
    "AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name <> 'd1_migrations' ORDER BY name",
  ).map((r) => r.name);

  if (tables.length === 0) throw new Error("production reported no tables, which cannot be right");

  const data = {};
  let totalRows = 0;
  let widest = Math.max(...tables.map((t) => t.length));

  for (const table of tables) {
    const rows = [];
    for (;;) {
      /*
       * A STABLE ORDER IS REQUIRED FOR PAGING TO BE CORRECT. Without ORDER BY, SQLite may return
       * rows in a different order between pages and OFFSET would then skip and duplicate rows —
       * silently, producing a local database that is subtly not the real one. `rowid` exists on
       * every ordinary SQLite table and is the cheapest stable key available.
       */
      const page = prodQuery(`SELECT * FROM "${table}" ORDER BY rowid LIMIT ${PAGE} OFFSET ${rows.length}`);
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    data[table] = rows;
    totalRows += rows.length;
    if (rows.length) console.log(`  ${table.padEnd(widest)}  ${String(rows.length).padStart(6)} rows`);
  }

  const migrationsApplied = prodQuery("SELECT name FROM d1_migrations ORDER BY name").map((r) => r.name);
  const schemaVersion = data.schema_version?.length
    ? data.schema_version.map((r) => r.migration).sort().at(-1)
    : null;

  const createdAt = new Date().toISOString();
  const file = path.join(BACKUPS, `wpos-prod-${createdAt.replace(/[:.]/g, "-")}.json`);

  /*
   * THE SAME PAYLOAD SHAPE AS `backup.mjs`, deliberately, so `restore.mjs` needs no knowledge that
   * this source exists. `meta.source` is the one honest difference: a restored local database should
   * be able to say where its rows came from.
   */
  mkdirSync(BACKUPS, { recursive: true });
  writeFileSync(file, JSON.stringify({
    meta: {
      createdAt,
      source: `production D1 (${DB}, env ${ENVIRONMENT}) — read-only pull`,
      binding: "WP_OS_DB",
      schemaVersion,
      migrationsApplied,
      tables: tables.map((t) => ({ name: t, rows: data[t].length })),
      totalRows,
    },
    tables: data,
  }, null, 2));

  console.log(`\n${tables.length} tables / ${totalRows} rows (schema ${schemaVersion ?? "none"})`);
  console.log(`WROTE ${file}`);
  console.log("\nLoad it with:  npm run local:restore -- --force");
}

try {
  main();
} catch (err) {
  console.error(`production pull failed: ${err.message}`);
  process.exit(1);
}
