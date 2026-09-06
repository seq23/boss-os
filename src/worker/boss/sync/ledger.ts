/**
 * The synchronization substrate: mutations, versions, conflicts and cursors.
 *
 * The rule this exists to keep (§2.3): two independently edited databases do not merge safely on
 * their own. Every eligible write declares the version it was based on, and the substrate either
 * advances that version or records a conflict. Nothing is decided by comparing clocks.
 *
 * WHAT THIS IS NOT. It is not a transport and not an endpoint. It is the local truth both sides
 * keep, so that Batch 4's cloud API and Batch 5's local agent are thin things that move rows
 * rather than clever things that decide outcomes.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { classify, AirlockRefusal } from "../policy/airlock";

export interface Mutation {
  /** Client-generated UUID. The unique key that makes replay idempotent. */
  mutationId: string;
  entity: string;
  recordId: string;
  /** The version the client believed it was editing. null means "this is a create". */
  baseVersion: number | null;
  deviceId: string;
  tombstone?: boolean;
  /** Hash of the payload the caller is writing, for integrity evidence. Never the payload. */
  payloadHash?: string | null;
  wallMs?: number;
}

export type MergePolicy = "APPEND_ONLY" | "IMMUTABLE" | "VERSIONED" | "NEVER_AUTOMATIC" | "REGENERATE";

export type MutationOutcome =
  | { status: "APPLIED"; seq: number; version: number }
  | { status: "REPLAY"; seq: number; version: number }
  | { status: "MERGED"; seq: number; version: number }
  | { status: "NOOP"; version: number }
  | { status: "CONFLICT"; conflictId: string; currentVersion: number; baseVersion: number | null; mergePolicy: MergePolicy };

export class SyncRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SyncRefusal";
  }
}

async function assertDeviceMaySync(db: D1Database, deviceId: string): Promise<void> {
  const d = await db
    .prepare(`SELECT device_id, revoked_at, revoked_reason FROM sync_device WHERE device_id = ?1`)
    .bind(deviceId)
    .first<{ device_id: string; revoked_at: number | null; revoked_reason: string | null }>();
  // An unknown device is refused for the same reason an unclassified entity is: silence is not
  // consent, and "register it on first use" is how a stolen token becomes a peer.
  if (!d) throw new SyncRefusal("UNKNOWN_DEVICE", `Device ${deviceId} is not registered. Register it before it may sync.`);
  if (d.revoked_at) {
    throw new SyncRefusal("REVOKED_DEVICE", `Device ${deviceId} was revoked${d.revoked_reason ? `: ${d.revoked_reason}` : ""}. Nothing was accepted.`);
  }
}

/**
 * Refuse a sovereign entity BEFORE it is serialized (§2.3), not while filtering output.
 *
 * The distinction is the whole design. Filtering on the way out means the record was already
 * written into a cloud structure and the only thing standing between it and a leak is a WHERE
 * clause somebody has to remember. Refusing at admission means the ledger cannot contain it.
 */
/**
 * Entities that never synchronize, whatever their residency says.
 *
 * §3.4 lists what must never cross: API keys, provider tokens, cookies, active sessions, passcode
 * material, signing keys, model weights and caches, private inference logs, machine-specific paths,
 * runtime credentials, build state. Most of those have no table — sessions live in KV, and
 * `providers` was already written to hold `api_key_var`, the NAME of a secret rather than a secret.
 *
 * `settings` is the one that is free-form: a TEXT key and a TEXT value, which is exactly the shape
 * a machine-specific path or a runtime credential ends up in. It is blocked by default rather than
 * audited by hope. If the private runtime turns out to need synced configuration, the fix is to
 * split settings into config and local runtime state in a migration — not to loosen this.
 *
 * This is a SECOND gate, not the first: residency already governs. It exists so that classifying an
 * entity CLOUD_SYNC by mistake is not sufficient to move a secret.
 */
const NEVER_SYNCS = new Set(["settings"]);

async function assertEntityMaySync(db: D1Database, entity: string, recordId: string): Promise<void> {
  if (NEVER_SYNCS.has(entity)) {
    throw new SyncRefusal(
      "NEVER_SYNCS",
      `${entity} never synchronizes: it can carry credentials, paths or runtime state (§3.4). Nothing was transmitted.`,
    );
  }
  const c = await classify(db, entity, recordId);
  if (c.residency === "LOCAL_ONLY") {
    throw new AirlockRefusal(
      entity,
      recordId,
      "residency",
      c,
      `LOCAL_ONLY — NOTHING TRANSMITTED. ${entity} is not eligible to synchronize. ${c.reason}`,
    );
  }
}

/**
 * Record a mutation.
 *
 * Returns the statements the caller must commit ALONGSIDE its own write, because §3 of Batch 3
 * requires that "a database mutation eligible for sync must not be considered successfully
 * committed if its required change-ledger entry cannot be created consistently". Handing back
 * statements rather than executing them is what lets the caller put its write and this ledger
 * entry into one `db.batch([...])` — one transaction, both or neither.
 */
export async function prepareMutation(
  db: D1Database,
  m: Mutation,
): Promise<{ outcome: MutationOutcome; statements: ReturnType<D1Database["prepare"]>[]; mutationId: string }> {
  await assertDeviceMaySync(db, m.deviceId);
  await assertEntityMaySync(db, m.entity, m.recordId);

  // Idempotent replay: the same mutation id answers with what it did the first time.
  const seen = await db
    .prepare(`SELECT seq, result_version FROM sync_ledger WHERE mutation_id = ?1`)
    .bind(m.mutationId)
    .first<{ seq: number; result_version: number }>();
  if (seen) {
    return { outcome: { status: "REPLAY", seq: seen.seq, version: seen.result_version }, statements: [], mutationId: m.mutationId };
  }

  const policyRow = await db
    .prepare(`SELECT merge_policy FROM data_policy WHERE entity = ?1`)
    .bind(m.entity)
    .first<{ merge_policy: MergePolicy }>();
  const mergePolicy: MergePolicy = policyRow?.merge_policy ?? "VERSIONED";

  /*
   * Derived state is rebuilt, not reconciled. Sending it at all is a mistake worth naming: two
   * machines arguing about the contents of a cache is a disagreement neither of them needs to win.
   */
  if (mergePolicy === "REGENERATE") {
    throw new SyncRefusal(
      "REGENERATE",
      `${m.entity} is derived or machine-local and is rebuilt rather than synchronized. Nothing was transmitted.`,
    );
  }

  const current = await db
    .prepare(`SELECT version FROM record_version WHERE entity = ?1 AND record_id = ?2`)
    .bind(m.entity, m.recordId)
    .first<{ version: number }>();
  const currentVersion = current?.version ?? 0;
  const base = m.baseVersion ?? 0;

  /*
   * An append-only log has no conflicts to have. Two devices each adding a different row are not
   * disagreeing about anything, so a version mismatch here means "you had not seen the other
   * rows yet", which is not a question for a person.
   */
  if (base !== currentVersion && mergePolicy === "APPEND_ONLY") {
    const version = currentVersion + 1;
    const wall = m.wallMs ?? Date.now();
    return {
      outcome: { status: "MERGED", seq: -1, version },
      statements: appendStatements(db, m, version, wall),
      mutationId: m.mutationId,
    };
  }

  /*
   * Immutable evidence: an identical rewrite is a no-op rather than a new version, and a DIFFERENT
   * one is a conflict where both copies survive. Overwriting evidence with a later version of
   * itself is how provenance quietly stops being provenance.
   */
  if (mergePolicy === "IMMUTABLE" && currentVersion > 0) {
    const prior = await db
      .prepare(`SELECT payload_hash FROM sync_ledger WHERE entity = ?1 AND record_id = ?2 ORDER BY seq DESC LIMIT 1`)
      .bind(m.entity, m.recordId)
      .first<{ payload_hash: string | null }>();
    if (prior && prior.payload_hash && m.payloadHash && prior.payload_hash === m.payloadHash) {
      return { outcome: { status: "NOOP", version: currentVersion }, statements: [], mutationId: m.mutationId };
    }
    const conflictId = await recordConflict(db, m, currentVersion, "IMMUTABLE");
    return {
      outcome: { status: "CONFLICT", conflictId, currentVersion, baseVersion: m.baseVersion, mergePolicy },
      statements: [],
      mutationId: m.mutationId,
    };
  }

  if (base !== currentVersion) {
    /*
     * A CONFLICT IS A ROW, NOT AN EXCEPTION.
     *
     * §11 requires explicit conflict handling rather than silent data loss. The incoming edit is
     * NOT applied and the current value is NOT overwritten: both survive, and a person decides.
     * This is the case naive last-write-wins gets wrong every time, and it is the reason clocks
     * are not the arbiter here.
     */
    const conflictId = await recordConflict(db, m, currentVersion, mergePolicy);
    return {
      outcome: { status: "CONFLICT", conflictId, currentVersion, baseVersion: m.baseVersion, mergePolicy },
      statements: [],
      mutationId: m.mutationId,
    };
  }

  const version = currentVersion + 1;
  const wall = m.wallMs ?? Date.now();
  const statements = appendStatements(db, m, version, wall);
  // seq is assigned by SQLite on insert, so it is only knowable after the batch commits.
  return { outcome: { status: "APPLIED", seq: -1, version }, statements, mutationId: m.mutationId };
}

/** Commit a prepared mutation together with the caller's own write, in one transaction. */
/** The two statements every applied mutation writes, shared by the versioned and merged paths. */
function appendStatements(db: D1Database, m: Mutation, version: number, wall: number) {
  return [
    db
      .prepare(
        `INSERT INTO sync_ledger (mutation_id, entity, record_id, base_version, result_version, device_id, tombstone, payload_hash, wall_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(m.mutationId, m.entity, m.recordId, m.baseVersion, version, m.deviceId, m.tombstone ? 1 : 0, m.payloadHash ?? null, wall),
    db
      .prepare(
        `INSERT INTO record_version (entity, record_id, version, tombstone, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (entity, record_id) DO UPDATE SET version = excluded.version, tombstone = excluded.tombstone, updated_at = excluded.updated_at`,
      )
      .bind(m.entity, m.recordId, version, m.tombstone ? 1 : 0, wall),
  ];
}

async function recordConflict(db: D1Database, m: Mutation, currentVersion: number, mergePolicy: MergePolicy): Promise<string> {
  const conflictId = `cfl_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO sync_conflict (id, entity, record_id, mutation_id, base_version, current_version, device_id, note)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(conflictId, m.entity, m.recordId, m.mutationId, m.baseVersion, currentVersion, m.deviceId, `merge policy ${mergePolicy}`)
    .run();
  return conflictId;
}

export async function commitMutation(
  db: D1Database,
  prepared: Awaited<ReturnType<typeof prepareMutation>>,
  callerStatements: ReturnType<D1Database["prepare"]>[] = [],
): Promise<MutationOutcome> {
  if (prepared.outcome.status !== "APPLIED" && prepared.outcome.status !== "MERGED") return prepared.outcome;
  /*
   * ONE BATCH, BOTH OR NEITHER. The caller's write and the ledger entry go in together, which is
   * the Batch 3 requirement that a syncable mutation "must not be considered successfully
   * committed if its required change-ledger entry cannot be created consistently".
   */
  await db.batch([...callerStatements, ...prepared.statements]);
  const row = await db
    .prepare(`SELECT seq FROM sync_ledger WHERE mutation_id = ?1`)
    .bind(prepared.mutationId)
    .first<{ seq: number }>();
  return { ...prepared.outcome, seq: row?.seq ?? prepared.outcome.seq };
}

/**
 * Incremental pull for one device.
 *
 * The LOCAL_ONLY check happens again here even though nothing sovereign can be in the table. Two
 * independent refusals, because the one that matters is the one still standing after somebody
 * edits the other — and a filter that is never load-bearing costs one query.
 */
export async function pull(
  db: D1Database,
  deviceId: string,
  afterSeq = 0,
  limit = 200,
): Promise<{ rows: any[]; nextSeq: number }> {
  await assertDeviceMaySync(db, deviceId);
  const res = await db
    .prepare(
      `SELECT l.seq, l.mutation_id, l.entity, l.record_id, l.base_version, l.result_version,
              l.device_id, l.tombstone, l.payload_hash, l.wall_ms
         FROM sync_ledger l
         JOIN data_policy p ON p.entity = l.entity
        WHERE l.seq > ?1 AND p.residency = 'CLOUD_SYNC'
        ORDER BY l.seq LIMIT ?2`,
    )
    .bind(afterSeq, limit)
    .all<any>();
  const rows = res.results ?? [];
  return { rows, nextSeq: rows.length ? rows[rows.length - 1].seq : afterSeq };
}

/** A cursor only ever moves forward: a replayed or reordered ack must not rewind a device. */
export async function advanceCursor(db: D1Database, deviceId: string, seq: number): Promise<number> {
  await assertDeviceMaySync(db, deviceId);
  await db
    .prepare(
      `INSERT INTO sync_cursor (device_id, last_seq, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (device_id) DO UPDATE SET last_seq = MAX(sync_cursor.last_seq, excluded.last_seq), updated_at = excluded.updated_at`,
    )
    .bind(deviceId, seq, Date.now())
    .run();
  const row = await db.prepare(`SELECT last_seq FROM sync_cursor WHERE device_id = ?1`).bind(deviceId).first<{ last_seq: number }>();
  return row?.last_seq ?? 0;
}

export async function registerDevice(
  db: D1Database,
  args: { deviceId: string; kind: "cloud" | "private"; label: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_device (device_id, kind, label) VALUES (?1, ?2, ?3)
       ON CONFLICT (device_id) DO UPDATE SET label = excluded.label, revoked_at = NULL, revoked_reason = NULL`,
    )
    .bind(args.deviceId, args.kind, args.label)
    .run();
}

export async function revokeDevice(db: D1Database, deviceId: string, reason: string): Promise<void> {
  await db
    .prepare(`UPDATE sync_device SET revoked_at = ?2, revoked_reason = ?3 WHERE device_id = ?1`)
    .bind(deviceId, Date.now(), reason)
    .run();
}

export async function openConflicts(db: D1Database): Promise<any[]> {
  const res = await db
    .prepare(`SELECT * FROM sync_conflict WHERE resolution = 'OPEN' ORDER BY detected_at DESC`)
    .all<any>();
  return res.results ?? [];
}
