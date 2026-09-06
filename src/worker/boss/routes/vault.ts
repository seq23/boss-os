import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId, sha256Hex } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict, AppError } from "../lib/http";

export const vault = new Hono<{ Bindings: Env; Variables: Vars }>();

/**
 * Snapshot coverage.
 *
 * Order matters on restore: parents before children, so foreign keys resolve.
 * A table missing from this list is a table that does not survive a rebuild, so
 * every table added by a migration belongs here.
 */
const SNAPSHOT_TABLES = [
  "lanes", "settings",
  "providers", "models", "routes", "budgets",
  "workload_profiles", "model_benchmarks",
  "agent_need_assessments", "agent_proposals",
  "employees", "task_templates",
  "approvals", "approval_events",
  "tasks", "task_events", "permission_envelopes", "evidence_packets",
  "employee_reviews",
  "usage_ledger", "routing_decisions",
  "memory_items", "promotion_rules", "promotion_events",
  "vault_entries",
  "days", "day_flow_blocks", "open_loops", "gate_entries",
  "organizations", "people", "relationships",
  "meetings", "meeting_briefs", "meeting_captures", "follow_ups",
  "entities", "portfolio_vehicles", "wealth_tracks", "theses",
  "deals", "lps", "opportunities",
  "decisions", "predictions", "red_team_reviews", "calibrations", "capital_allocations",
  "knowledge_surfaces", "knowledge_items", "manual_versions",
  "knowledge_retirements", "knowledge_exports",
  "mastery_lenses", "pov_cards", "prompt_packets", "prompt_scores",
  "prompt_library", "prompt_traces",
  "capabilities", "active_defaults", "bench_candidates", "discovery_inbox",
  "after_action_reviews", "capability_patches",
  "decision_rights", "emotional_states", "compliance_flags", "failure_playbooks",
  "maintenance_items", "ip_assets", "brand_profiles", "learning_entries",
  "runtime_jobs", "document_artifacts", "seo_audits", "geo_probes",
  "bridge_handoffs",
  "trading_engines", "kill_switch_probes", "deployment_stages", "strategy_desks",
  "promotion_scorecards", "scale_rungs", "trading_sequence", "trading_nevers",
  "sovereignty_packages", "sovereignty_drills",
  "manifestations", "manifestation_evidence", "rituals", "ritual_runs",
  "dream_entries", "contributions", "ancestor_entries",
  "astro_calendar", "astro_days",
  "trading_accounts", "trading_strategies", "trading_signals", "trading_orders",
  "trading_positions", "trading_fills", "trading_authority", "trading_incidents",
  "audit_log", "system_events", "cron_runs", "dead_letters",
] as const;

const SNAPSHOT_VERSION = 2;

/**
 * Ceiling on a single restore transaction. Generous for a single-user system;
 * the point is to refuse loudly rather than silently split a restore into
 * pieces that could leave the database half-loaded.
 */
const MAX_RESTORE_STATEMENTS = 20_000;

vault.get("/entries", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, lane, key, kind, bytes, sha256, note, created_at FROM vault_entries
        ORDER BY created_at DESC LIMIT 100`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

vault.get("/snapshots", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM vault_snapshots ORDER BY ts DESC LIMIT 50`).all();
  return ok(c, rows.results ?? []);
});

vault.get("/restores", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM vault_restores ORDER BY ts DESC LIMIT 50`).all();
  return ok(c, rows.results ?? []);
});

/**
 * Full JSON export of every table to R2. This is the thing that makes the
 * system rebuildable: if the Worker vanishes, the vault still has the state.
 */
export async function takeSnapshot(env: Env, label: string) {
  const id = newId("snp");
  const ts = Date.now();
  await env.DB
    .prepare(`INSERT INTO vault_snapshots (id, ts, label, status) VALUES (?,?,?,'pending')`)
    .bind(id, ts, label)
    .run();

  try {
    const dump: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};
    for (const table of SNAPSHOT_TABLES) {
      const rows = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      dump[table] = rows.results ?? [];
      counts[table] = dump[table].length;
    }

    const payload = JSON.stringify({
      snapshot_version: SNAPSHOT_VERSION,
      version: env.BOSS_OS_VERSION,
      ts,
      tables: dump,
    });
    const bytes = new TextEncoder().encode(payload);
    const sha = await sha256Hex(payload);
    const r2Key = `snapshots/${new Date(ts).toISOString()}-${id}.json`;

    await env.VAULT.put(r2Key, bytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { sha256: sha, snapshotId: id },
    });

    await env.DB
      .prepare(
        `UPDATE vault_snapshots SET r2_key = ?, bytes = ?, sha256 = ?, table_counts = ?, status = 'complete' WHERE id = ?`,
      )
      .bind(r2Key, bytes.byteLength, sha, JSON.stringify(counts), id)
      .run();

    await logEvent(env.DB, {
      level: "info", scope: "vault", event: "snapshot_complete", entityId: id,
      detail: { bytes: bytes.byteLength, tables: SNAPSHOT_TABLES.length },
    });

    return { id, r2Key, bytes: bytes.byteLength, sha256: sha, counts };
  } catch (err) {
    await env.DB
      .prepare(`UPDATE vault_snapshots SET status = 'failed' WHERE id = ?`).bind(id).run();
    await logEvent(env.DB, {
      level: "error", scope: "vault", event: "snapshot_failed", entityId: id,
      detail: { message: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

vault.post("/snapshots", async (c) => {
  const body = await c.req.json<{ label?: string }>().catch(() => ({ label: undefined }));
  const result = await takeSnapshot(c.env, body.label ?? "manual");
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "snapshot", entityId: result.id, action: "created" });
  return ok(c, result, 201);
});

vault.get("/snapshots/:id/download", async (c) => {
  const row = await c.env.DB
    .prepare(`SELECT r2_key FROM vault_snapshots WHERE id = ? AND status = 'complete'`)
    .bind(c.req.param("id")).first<{ r2_key: string }>();
  if (!row?.r2_key) throw notFound("No completed snapshot with that id");
  const obj = await c.env.VAULT.get(row.r2_key);
  if (!obj) throw notFound("The snapshot record exists but its file is missing from the vault bucket");
  return new Response(obj.body, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${row.r2_key.split("/").pop()}"`,
    },
  });
});

/** Re-reads the object from R2 and re-hashes it. A snapshot nobody verified is a hope. */
vault.get("/snapshots/:id/verify", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB
    .prepare(`SELECT id, r2_key, sha256, bytes FROM vault_snapshots WHERE id = ?`)
    .bind(id).first<{ id: string; r2_key: string | null; sha256: string | null; bytes: number }>();
  if (!row) throw notFound("No snapshot with that id");
  if (!row.r2_key) throw conflict("That snapshot never finished writing");

  const obj = await c.env.VAULT.get(row.r2_key);
  if (!obj) {
    return ok(c, { id, ok: false, reason: "The snapshot file is missing from the vault bucket" });
  }
  const text = await obj.text();
  const computed = await sha256Hex(text);
  const parsed = parseSnapshot(text);

  return ok(c, {
    id,
    ok: computed === row.sha256 && parsed.ok,
    declared_sha256: row.sha256,
    computed_sha256: computed,
    sha_match: computed === row.sha256,
    parse: parsed.ok ? { ok: true, tables: Object.keys(parsed.tables).length, rows: parsed.totalRows } : { ok: false, reason: parsed.reason },
    bytes: text.length,
  });
});

interface ParsedSnapshot {
  ok: boolean;
  reason?: string;
  ts?: number;
  tables: Record<string, any[]>;
  totalRows: number;
}

function parseSnapshot(text: string): ParsedSnapshot {
  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: "The file is not valid JSON", tables: {}, totalRows: 0 };
  }
  if (!doc || typeof doc !== "object" || !doc.tables || typeof doc.tables !== "object") {
    return { ok: false, reason: "The file has no `tables` object, so it is not a Boss OS snapshot", tables: {}, totalRows: 0 };
  }
  let totalRows = 0;
  for (const [name, rows] of Object.entries(doc.tables)) {
    if (!Array.isArray(rows)) {
      return { ok: false, reason: `Table ${name} is not an array of rows`, tables: {}, totalRows: 0 };
    }
    totalRows += rows.length;
  }
  return { ok: true, ts: doc.ts, tables: doc.tables as Record<string, any[]>, totalRows };
}

/** Columns that actually exist, so a snapshot from an older schema still loads. */
async function tableColumns(db: D1Database, table: string): Promise<Set<string>> {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set((info.results ?? []).map((r) => r.name));
}

/**
 * Restore.
 *
 * Three modes, deliberately separate:
 *   verify  — hash, parse, and count. Writes nothing. Always safe.
 *   merge   — insert rows that are not already present. Existing rows win.
 *   replace — wipe the covered tables and load the snapshot verbatim.
 *
 * `replace` destroys current state, so it demands an explicit confirmation
 * string. Everything is recorded in `vault_restores` either way.
 */
vault.post("/restore", async (c) => {
  const body = await c.req.json<any>().catch(() => null);
  if (!body) throw badRequest("Restore needs a body", "Send { snapshot_id | payload, mode }.");

  const mode = body.mode ?? "verify";
  if (!["verify", "merge", "replace"].includes(mode)) {
    throw badRequest("Mode must be verify, merge, or replace");
  }
  if (mode === "replace" && body.confirm !== "REPLACE") {
    throw conflict(
      "Replace wipes current state before loading",
      'Send { "confirm": "REPLACE" } once you have a fresh snapshot of what you are about to overwrite.',
    );
  }

  let text: string;
  let source: string;
  let declaredSha: string | null = null;

  if (body.snapshot_id) {
    const row = await c.env.DB
      .prepare(`SELECT r2_key, sha256 FROM vault_snapshots WHERE id = ? AND status = 'complete'`)
      .bind(body.snapshot_id).first<{ r2_key: string; sha256: string | null }>();
    if (!row?.r2_key) throw notFound("No completed snapshot with that id");
    const obj = await c.env.VAULT.get(row.r2_key);
    if (!obj) throw notFound("The snapshot record exists but its file is missing from the vault bucket");
    text = await obj.text();
    source = row.r2_key;
    declaredSha = row.sha256;
  } else if (typeof body.payload === "string") {
    text = body.payload;
    source = "upload";
    declaredSha = body.sha256 ?? null;
  } else {
    throw badRequest("Restore needs a source", "Send either snapshot_id or payload as a JSON string.");
  }

  const restoreId = newId("rst");
  const computed = await sha256Hex(text);
  const parsed = parseSnapshot(text);

  const fail = async (reason: string): Promise<never> => {
    await c.env.DB
      .prepare(
        `INSERT INTO vault_restores (id, ts, source, mode, declared_sha, computed_sha, status, error)
         VALUES (?,?,?,?,?,?,'failed',?)`,
      )
      .bind(restoreId, Date.now(), source, mode, declaredSha, computed, reason)
      .run();
    await logEvent(c.env.DB, {
      level: "error", scope: "vault", event: "restore_failed", entityId: restoreId, detail: { reason, mode },
    });
    throw new AppError(422, reason, "Nothing was written. Fix the source file and try again.");
  };

  if (declaredSha && declaredSha !== computed) {
    await fail(`Integrity check failed: the file hashes to ${computed.slice(0, 12)}… but ${declaredSha.slice(0, 12)}… was expected`);
  }
  if (!parsed.ok) await fail(parsed.reason ?? "The snapshot could not be parsed");

  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(parsed.tables)) counts[name] = rows.length;

  if (mode === "verify") {
    await c.env.DB
      .prepare(
        `INSERT INTO vault_restores (id, ts, source, mode, declared_sha, computed_sha, snapshot_ts, table_counts, status)
         VALUES (?,?,?,?,?,?,?,?,'verified')`,
      )
      .bind(restoreId, Date.now(), source, mode, declaredSha, computed, parsed.ts ?? null, JSON.stringify(counts))
      .run();
    return ok(c, {
      id: restoreId, status: "verified", sha256: computed, snapshot_ts: parsed.ts ?? null,
      tables: counts, total_rows: parsed.totalRows,
      note: "Nothing was written. This confirms the snapshot is intact and loadable.",
    });
  }

  // ─── Write path ────────────────────────────────────────────────────────────
  //
  // One batch, one transaction, foreign keys deferred to the commit.
  //
  // The schema contains a genuine cycle — an employee points at the proposal
  // that created it, and that proposal points back at the employee — so no
  // insert order can satisfy foreign keys row by row. Deferring the check to
  // commit is the only correct answer, and it has the bonus that a restore
  // either lands completely or not at all. A half-applied restore would be
  // worse than no restore.
  const applied: Record<string, number> = {};
  const statements: D1PreparedStatement[] = [c.env.DB.prepare(`PRAGMA defer_foreign_keys = ON`)];

  if (mode === "replace") {
    for (const table of [...SNAPSHOT_TABLES].reverse()) {
      if (!(table in parsed.tables)) continue;
      statements.push(c.env.DB.prepare(`DELETE FROM ${table}`));
    }
  }

  const verb = mode === "replace" ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
  for (const table of SNAPSHOT_TABLES) {
    const rows = parsed.tables[table];
    if (!Array.isArray(rows) || !rows.length) continue;

    const known = await tableColumns(c.env.DB, table);
    let written = 0;
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      // Only columns this schema still has, so a snapshot from an older
      // migration still loads instead of failing on a dropped column.
      const cols = Object.keys(r).filter((k) => known.has(k));
      if (!cols.length) continue;
      statements.push(
        c.env.DB
          .prepare(`${verb} INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
          .bind(...cols.map((k) => (r as any)[k])),
      );
      written++;
    }
    applied[table] = written;
  }

  if (statements.length > MAX_RESTORE_STATEMENTS) {
    await fail(
      `This snapshot needs ${statements.length} statements, over the ${MAX_RESTORE_STATEMENTS} a single ` +
      `transaction can carry. Restoring it in pieces would risk leaving the database half-loaded, so nothing was written.`,
    );
  }

  try {
    await c.env.DB.batch(statements);
  } catch (err) {
    await fail(`The restore transaction was rolled back: ${err instanceof Error ? err.message : String(err)}`);
  }

  await c.env.DB
    .prepare(
      `INSERT INTO vault_restores (id, ts, source, mode, declared_sha, computed_sha, snapshot_ts, table_counts, applied, status)
       VALUES (?,?,?,?,?,?,?,?,?,'applied')`,
    )
    .bind(
      restoreId, Date.now(), source, mode, declaredSha, computed, parsed.ts ?? null,
      JSON.stringify(counts), JSON.stringify(applied),
    )
    .run();

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "restore", entityId: restoreId,
    action: `restore_${mode}`, detail: { source, rows: applied },
  });
  await logEvent(c.env.DB, {
    level: "warn", scope: "vault", event: "restore_applied", entityId: restoreId,
    detail: { mode, source, tables: Object.keys(applied).length },
  });

  return ok(c, { id: restoreId, status: "applied", mode, sha256: computed, applied }, 201);
});

/**
 * Restore drill.
 *
 * Takes a fresh snapshot, reads it back out of R2, re-hashes it, and confirms it
 * parses and covers every table. Proves the continuity path end to end without
 * touching live state.
 */
vault.post("/drill", async (c) => {
  const started = Date.now();
  const snapshot = await takeSnapshot(c.env, "drill");

  const obj = await c.env.VAULT.get(snapshot.r2Key);
  if (!obj) throw new AppError(500, "The drill snapshot was written but could not be read back", "Check the R2 binding and bucket name.");

  const text = await obj.text();
  const computed = await sha256Hex(text);
  const parsed = parseSnapshot(text);
  const missing = SNAPSHOT_TABLES.filter((t) => !(t in (parsed.tables ?? {})));

  const passed = computed === snapshot.sha256 && parsed.ok && missing.length === 0;
  const restoreId = newId("rst");

  await c.env.DB
    .prepare(
      `INSERT INTO vault_restores (id, ts, source, mode, declared_sha, computed_sha, snapshot_ts, table_counts, status, error)
       VALUES (?,?,?,'verify',?,?,?,?,?,?)`,
    )
    .bind(
      restoreId, Date.now(), snapshot.r2Key, snapshot.sha256, computed, parsed.ts ?? null,
      JSON.stringify(snapshot.counts), passed ? "verified" : "failed",
      passed ? null : `sha_match=${computed === snapshot.sha256} parse_ok=${parsed.ok} missing=${missing.join(",")}`,
    )
    .run();

  await logEvent(c.env.DB, {
    level: passed ? "info" : "error", scope: "vault", event: "restore_drill",
    durationMs: Date.now() - started, detail: { passed, missing },
  });

  return ok(c, {
    passed,
    snapshot_id: snapshot.id,
    restore_id: restoreId,
    sha_match: computed === snapshot.sha256,
    parse_ok: parsed.ok,
    tables_covered: SNAPSHOT_TABLES.length - missing.length,
    tables_expected: SNAPSHOT_TABLES.length,
    missing_tables: missing,
    total_rows: parsed.totalRows,
    bytes: snapshot.bytes,
    took_ms: Date.now() - started,
  });
});

export { SNAPSHOT_TABLES };
