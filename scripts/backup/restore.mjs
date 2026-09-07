/**
 * restore.mjs — restore a backup JSON into an EMPTY local D1.
 *
 * Refuses to run against a non-empty local D1 unless `--force` is passed (which drops
 * every existing table first). Mechanism:
 *   1. verify emptiness (or wipe with --force),
 *   2. `wrangler d1 migrations apply --local` to rebuild schema + seeds and record
 *      d1_migrations so future migrate runs stay consistent,
 *   3. drop the append-only/immutability triggers for the duration of the load,
 *   4. replace seed content with the backup's rows per table (plain INSERTs),
 *   5. RECREATE every dropped trigger and verify the full set is back,
 *   6. verify restored row counts against the backup manifest.
 *
 * Why step 3 exists: those triggers exist to stop the APPLICATION from rewriting
 * institutional history, and they do their job — they also reject the DELETEs a
 * faithful reload needs. A restore is a privileged administrative rebuild, not an
 * application flow, and it is already gated behind `--force`. Step 5 is the part
 * that matters: a restore that quietly left the guarantees off would be far worse
 * than one that failed, so the trigger set is re-created from its own recorded SQL
 * and counted back before the restore is allowed to report success.
 *
 * Usage: node scripts/backup/restore.mjs [--file <backup.json>] [--force]
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  BACKUPS_DIR,
  d1Exec,
  d1ExecMany,
  d1Migrate,
  d1Query,
  isLocalDbEmpty,
  sqlLiteral,
  wipeLocalDb,
} from "./d1.mjs";

/*
 * BATCHES ARE BOUNDED BY BYTES, NOT BY ROW COUNT — and the row count alone was a real bug.
 *
 * Fifty rows is nothing for a typical table and 200KB for one carrying JSON: `cron_runs` and
 * `vault_snapshots` store step logs and per-table counts, at up to 4KB a row. The resulting
 * `--command` argument exceeded what a shell will accept, and the restore reported "made no
 * progress; tables stuck" — which reads like a foreign-key cycle and is nothing of the sort.
 *
 * The row cap stays as a second bound so a table of enormous single rows still batches sensibly.
 */
const BATCH_SIZE = 50;
const BATCH_BYTES = 60_000;

/**
 * The newest snapshot, from either source.
 *
 * TWO PREFIXES ON PURPOSE. `wpos-backup-` is a round-trip of the local store; `wpos-prod-` is a
 * read-only pull of production. Both restore through this identical path, and the filename is the
 * only thing that says which a file is — a `backups/` directory where the two are
 * indistinguishable is a directory where someone eventually restores the wrong one.
 *
 * The matcher was `wpos-backup-` alone, so a production pull sat in the directory and reported
 * "backup file not found". Widened rather than renamed: disguising the prod file as a local backup
 * would have fixed the symptom by destroying the distinction.
 */
function latestBackupFile() {
  if (!existsSync(BACKUPS_DIR)) return null;
  const files = readdirSync(BACKUPS_DIR)
    .filter((f) => /^wpos-(backup|prod)-/.test(f) && f.endsWith(".json"))
    .sort();
  return files.length > 0 ? path.join(BACKUPS_DIR, files[files.length - 1]) : null;
}

/**
 * Statements are COLLECTED, not executed one at a time.
 *
 * Each `d1Exec` launches a wrangler process, and a production pull is three thousand rows across
 * three hundred tables — hundreds of launches, nearly all of the elapsed time being process
 * startup. Measured: over nine minutes and still going.
 *
 * That is not just slow. The sync is a button in her Dock, and a button that appears to hang for
 * ten minutes is clicked once and never again. Collected here and flushed in a single invocation.
 */
/** The INSERTs for one table, appended to a list rather than executed. Bounded by size and count. */
function collectInserts(out, table, rows) {
  if (!rows || rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const head = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES `;

  let batch = [];
  let bytes = 0;
  const flush = () => {
    if (batch.length) out.push(head + batch.join(", "));
    batch = [];
    bytes = 0;
  };
  for (const row of rows) {
    const tuple = `(${columns.map((c) => sqlLiteral(row[c])).join(", ")})`;
    // Flush BEFORE adding, so a single oversized row still goes out on its own rather than being
    // dropped or silently truncated.
    if (batch.length && (bytes + tuple.length > BATCH_BYTES || batch.length >= BATCH_SIZE)) flush();
    batch.push(tuple);
    bytes += tuple.length + 2;
  }
  flush();
}

function insertRows(table, rows) {
  // One code path builds the statements, so the fast and slow loaders cannot disagree about batching.
  const statements = [];
  collectInserts(statements, table, rows);
  for (const sql of statements) d1Exec(sql);
}

/**
 * Run `fn(table)` over tables in an FK-safe order without hardcoding dependencies:
 * retry in passes — tables whose constraints are satisfied succeed first, dependents
 * succeed in later passes (children-first for DELETE, parents-first for INSERT).
 */
function inDependencyOrder(tables, fn, label) {
  let remaining = [...tables];
  let lastError = null;
  while (remaining.length > 0) {
    const stuck = [];
    for (const table of remaining) {
      try {
        fn(table);
      } catch (err) {
        lastError = err;
        stuck.push(table);
      }
    }
    if (stuck.length === remaining.length) {
      const cause = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`${label} made no progress; tables stuck: ${stuck.join(", ")}. Last error: ${cause}`);
    }
    remaining = stuck;
  }
}

export function runRestore(backupFile, { force = false } = {}) {
  if (!backupFile || !existsSync(backupFile)) {
    throw new Error(`backup file not found: ${backupFile ?? "(none — no backups/ present)"}`);
  }
  const backup = JSON.parse(readFileSync(backupFile, "utf8"));

  /*
   * THE SCHEMA IS REBUILT ONLY WHEN IT HAS TO BE, and that is the difference between a sync she
   * uses and one she does not.
   *
   * A full restore drops three hundred tables one at a time and replays a hundred and ninety-one
   * migrations. That is right the first time and pure waste on the tenth: if the local schema is
   * already at the snapshot's version, nothing about the shape of the database needs to change —
   * only its rows. Measured, that is the bulk of the wall clock.
   *
   * THE VERSIONS MUST MATCH EXACTLY, not merely be present. A local database one migration behind
   * production would silently accept rows into an older shape and fail somewhere unrelated later,
   * so a mismatch takes the slow path rather than guessing.
   */
  const empty = isLocalDbEmpty();
  if (!empty && !force) {
    throw new Error("local D1 is not empty — refusing to restore without --force");
  }

  const localVersion = empty
    ? null
    : d1Query("SELECT migration FROM schema_version ORDER BY migration DESC LIMIT 1")[0]?.migration ?? null;
  const sameSchema = Boolean(localVersion) && localVersion === backup.meta?.schemaVersion;

  if (!sameSchema) {
    if (!empty) wipeLocalDb();
    // Rebuild schema via the migration runner so d1_migrations stays truthful.
    d1Migrate();
  } else {
    console.log(`schema already at ${localVersion} — reloading rows only.`);
  }

  const tables = Object.keys(backup.tables);

  // event_record is append-only (D15): never wiped. It is empty right after migrations
  // and gets the backup's rows appended below.
  /*
   * event_record is append-only (D15) and must be empty before the backup's rows are appended. On
   * the fast path nothing was migrated, so it is emptied here with its trigger already down —
   * skipping this check instead would let a repeat sync double every event in the log.
   */
  if (tables.includes("event_record")) {
    const eventCount = d1Query("SELECT COUNT(*) AS n FROM event_record")[0]?.n ?? 0;
    if (eventCount !== 0 && !sameSchema) {
      throw new Error("event_record is not empty after migration apply; refusing to append");
    }
  }

  // Take the append-only/immutability triggers down for the load, recording their
  // own CREATE statements so they can be put back exactly as the migrations wrote them.
  const triggers = d1Query("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL");
  // One invocation, not one per trigger. With the schema rebuild skipped these launches became the
  // bulk of a repeat sync — the same process-startup cost that made the row loader slow.
  d1ExecMany(triggers.map((t) => `DROP TRIGGER IF EXISTS "${t.name}"`));

  /*
   * THE FAST PATH, WITH THE SLOW ONE STILL BEHIND IT.
   *
   * `inDependencyOrder` discovers a foreign-key-safe order by trying and retrying, which means one
   * wrangler process per table per pass. For a production pull — three thousand rows across three
   * hundred tables — that measured at over nine minutes without finishing, and essentially all of
   * it was process startup rather than SQLite.
   *
   * That decides whether the feature gets used: the sync is a button in her Dock, and a button that
   * appears to hang for ten minutes is clicked once and never again.
   *
   * So first try everything in ONE invocation with foreign keys deferred to the commit, which makes
   * insertion order irrelevant. If that fails for any reason, fall through to the original
   * pass-by-pass logic — slower, proven, and it reports which table actually broke. Speed is an
   * optimisation; the retry loop is the correctness, and it is still there.
   */
  const fast = ["PRAGMA defer_foreign_keys = ON"];
  for (const table of tables) fast.push(`DELETE FROM "${table}"`);
  for (const table of tables) collectInserts(fast, table, backup.tables[table]);

  let loaded = false;
  try {
    d1ExecMany(fast);
    loaded = true;
  } catch (err) {
    /*
     * THE WHOLE ERROR, NOT A PREFIX. The first version truncated at 120 characters, which cut the
     * message off before the reason and left "single-pass load failed" followed by the beginning of
     * an SQL statement — the least useful 120 characters available.
     */
    console.warn("single-pass load failed; falling back to per-table passes.");
    console.warn(String(err.message).split("\n").filter((l) => /error|constraint|no such|UNIQUE|FOREIGN/i.test(l)).slice(0, 3).join("\n") || String(err.message).slice(-400));
  }

  if (!loaded) {
    // Replace migration seed content with the backup's rows.
    inDependencyOrder(tables, (table) => d1Exec(`DELETE FROM "${table}"`), "seed wipe");
    inDependencyOrder(tables, (table) => insertRows(table, backup.tables[table]), "row insert");
  }

  // Put every guarantee back, and prove it. A restored database that lost its
  // append-only enforcement is not a restored database.
  d1ExecMany(triggers.map((t) => t.sql));
  const restoredTriggers = d1Query("SELECT name FROM sqlite_master WHERE type = 'trigger'").map((r) => r.name);
  const missing = triggers.map((t) => t.name).filter((name) => !restoredTriggers.includes(name));
  if (missing.length > 0) {
    throw new Error(`restore verification failed: ${missing.length} append-only trigger(s) were not restored: ${missing.join(", ")}`);
  }

  // Verify row counts against the backup manifest.
  for (const [table, rows] of Object.entries(backup.tables)) {
    const actual = d1Query(`SELECT COUNT(*) AS n FROM "${table}"`)[0]?.n ?? 0;
    if (actual !== rows.length) {
      throw new Error(`restore verification failed: ${table} has ${actual} rows, expected ${rows.length}`);
    }
  }
  return { tables: Object.fromEntries(tables.map((t) => [t, backup.tables[t].length])), backupMeta: backup.meta };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const fileIdx = process.argv.indexOf("--file");
    const file = fileIdx >= 0 ? process.argv[fileIdx + 1] : latestBackupFile();
    const force = process.argv.includes("--force");
    const result = runRestore(file, { force });
    const summary = Object.entries(result.tables)
      .map(([t, n]) => `${t}=${n}`)
      .join(" ");
    console.log(`restored from backup of ${result.backupMeta.createdAt}: ${summary}`);
  } catch (err) {
    console.error(`restore failed: ${err.message}`);
    process.exit(1);
  }
}
