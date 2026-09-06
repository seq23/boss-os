import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { logEvent } from "../lib/log";
import { AirlockRefusal } from "../policy/airlock";
import {
  prepareMutation, commitMutation, pull as pullLedger, registerDevice, revokeDevice,
  advanceCursor, openConflicts, assertEntityMaySync, SyncRefusal,
} from "../sync/ledger";
import { ensureDay, dayId } from "./today";

/**
 * Where an offline capture lands when the connection comes back — Batch 7.
 *
 * ONE ITEM PER REQUEST, ON PURPOSE. A batch endpoint would have to invent an answer for "three of
 * five applied", and the honest ones are all worse than sending three requests. Each capture is
 * independently identified and independently idempotent, so the client can retry exactly the ones
 * that did not land without reasoning about partial success.
 *
 * THE SESSION AUTHORIZES; THE DEVICE ID ATTRIBUTES. A browser device is registered on first flush,
 * which is safe here and would not be at the transport layer: this route sits behind the passcode
 * session, so the caller has already proved who they are. The device id exists to attribute a
 * mutation and carry a cursor, not to grant anything.
 */
export const sync = new Hono<{ Bindings: Env; Variables: Vars }>();

const KINDS = new Set(["open_loop"]);
const LOOP_ENTITY = "open_loops";

sync.post("/outbox", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b?.mutation_id || !b?.record_id || !b?.kind) throw badRequest("A capture needs mutation_id, record_id and kind");
  if (!KINDS.has(String(b.kind))) throw badRequest(`"${b.kind}" is not a kind of offline capture`, `One of: ${[...KINDS].join(", ")}`);
  if (!b?.device_id) throw badRequest("A capture needs the device it was written on");

  const payload = b.payload ?? {};
  if (!payload.title || !String(payload.title).trim()) throw badRequest("An open loop needs a title");

  await registerDevice(c.env.DB, {
    deviceId: String(b.device_id),
    kind: "cloud",
    label: String(b.device_label ?? "Browser"),
  });

  let prepared;
  try {
    prepared = await prepareMutation(c.env.DB, {
      mutationId: String(b.mutation_id),
      entity: LOOP_ENTITY,
      recordId: String(b.record_id),
      baseVersion: null,
      deviceId: String(b.device_id),
    });
  } catch (err) {
    if (err instanceof AirlockRefusal || err instanceof SyncRefusal) {
      await logEvent(c.env.DB, {
        level: "warn", scope: "sync", event: "capture_refused",
        detail: { entity: LOOP_ENTITY, reason: (err as Error).message },
      }).catch(() => {});
      // 4xx, so the client stops retrying something that will never be accepted.
      throw badRequest((err as Error).message, "The capture was refused and nothing was written.");
    }
    throw err;
  }

  if (prepared.outcome.status === "REPLAY") {
    return ok(c, { status: "REPLAY", record_id: b.record_id, version: prepared.outcome.version });
  }
  if (prepared.outcome.status === "CONFLICT") {
    return ok(c, { status: "CONFLICT", conflict_id: prepared.outcome.conflictId, record_id: b.record_id });
  }

  const day = await ensureDay(c.env.DB, payload.day_id ? String(payload.day_id) : dayId(Date.now()));
  const now = Date.now();

  /*
   * THE CAPTURE AND ITS LEDGER ENTRY COMMIT TOGETHER.
   *
   * Batch 3 requires that a syncable mutation is not considered committed unless its ledger entry
   * was created consistently. Writing the loop first and the ledger after would leave a record the
   * substrate has never heard of, which is invisible to every device including this one.
   */
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO open_loops (id, day_id, kind, title, detail, source_type, source_id, priority, status, created_at, updated_at)
         VALUES (?1,?2,?3,?4,NULL,'offline_capture',NULL,?5,'open',?6,?6)`,
      )
      .bind(String(b.record_id), day.id, String(payload.kind ?? "other"), String(payload.title).trim(), Number(payload.priority ?? 3), now),
    ...prepared.statements,
  ]);

  await logEvent(c.env.DB, {
    level: "info", scope: "sync", event: "capture_applied",
    detail: { entity: LOOP_ENTITY, device: b.device_id },
  }).catch(() => {});

  return ok(c, { status: "APPLIED", record_id: b.record_id, version: prepared.outcome.version });
});

/** What the reader is owed: what is waiting, and what disagreed. */
sync.get("/status", async (c) => {
  const conflicts = await openConflicts(c.env.DB);
  const devices = await c.env.DB
    .prepare(`SELECT device_id, kind, label, registered_at, last_seen_at, revoked_at FROM sync_device ORDER BY registered_at`)
    .all<any>();
  const ledger = await c.env.DB.prepare(`SELECT COUNT(*) AS n, MAX(seq) AS head FROM sync_ledger`).first<{ n: number; head: number | null }>();
  return ok(c, {
    conflicts,
    devices: devices.results ?? [],
    ledger: { mutations: ledger?.n ?? 0, head: ledger?.head ?? 0 },
  });
});

sync.post("/cursor", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b?.device_id || typeof b?.seq !== "number") throw badRequest("A cursor needs device_id and seq");
  const at = await advanceCursor(c.env.DB, String(b.device_id), Number(b.seq));
  return ok(c, { device_id: b.device_id, last_seq: at });
});


/* ─── Batch 4 — the cloud sync API ────────────────────────────────────────────
 *
 * Thin on purpose. The substrate in sync/ledger.ts decides every outcome — applied, replayed,
 * conflicted, refused — so these endpoints validate, bound and record, and never adjudicate. An
 * endpoint that could decide a merge would be a second place to get merging wrong.
 */

/** A push is bounded in count and in body size. An unbounded batch is a denial-of-service with a schema. */
const MAX_BATCH = 100;
const MAX_BODY_BYTES = 512 * 1024;
/** Per-device write ceiling per minute. */
const RATE_PER_MINUTE = 600;

/**
 * Rate limiting is measured from the ledger itself rather than a counter table.
 *
 * The thing worth bounding is how much a device WRITES, and the ledger already is that record — so
 * there is no second source of truth to keep in step, and nothing to reset or migrate. The honest
 * limitation: refused and conflicted requests never reach the ledger, so a flood of invalid pushes
 * is bounded by the body and batch caps above and by the passcode session, not by this.
 */
async function assertUnderRate(db: Parameters<typeof openConflicts>[0], deviceId: string): Promise<void> {
  const since = Date.now() - 60_000;
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM sync_ledger WHERE device_id = ?1 AND created_at > ?2`)
    .bind(deviceId, since)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= RATE_PER_MINUTE) {
    throw badRequest(
      `Device ${deviceId} has written ${row?.n} mutations in the last minute, at the ceiling of ${RATE_PER_MINUTE}.`,
      "Nothing was accepted. Retry after the window rolls.",
    );
  }
}

function validateMutation(m: any, i: number): void {
  const where = `item ${i}`;
  for (const field of ["mutation_id", "entity", "record_id"]) {
    if (typeof m?.[field] !== "string" || !m[field].trim()) throw badRequest(`${where}: ${field} is required`);
  }
  if (m.base_version !== null && m.base_version !== undefined && !Number.isInteger(m.base_version)) {
    throw badRequest(`${where}: base_version must be an integer or null`);
  }
  if (m.tombstone !== undefined && typeof m.tombstone !== "boolean") throw badRequest(`${where}: tombstone must be a boolean`);
  if (m.payload_hash !== undefined && m.payload_hash !== null && typeof m.payload_hash !== "string") {
    throw badRequest(`${where}: payload_hash must be a string or null`);
  }
}

/**
 * Push a batch of mutations.
 *
 * Every item is answered INDIVIDUALLY. A batch that fails as a unit would make the client re-send
 * work that already landed, and idempotency would save it — but only by accident. Per-item results
 * mean the client retries exactly what did not apply.
 */
sync.post("/push", async (c) => {
  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) throw badRequest(`A push may not exceed ${MAX_BODY_BYTES} bytes.`, "Nothing was accepted.");
  const b = JSON.parse(raw || "null");
  if (!b?.device_id) throw badRequest("A push needs device_id");
  if (!Array.isArray(b.mutations)) throw badRequest("A push needs a mutations array");
  if (b.mutations.length === 0) throw badRequest("A push with no mutations is not a push");
  if (b.mutations.length > MAX_BATCH) throw badRequest(`A push may carry at most ${MAX_BATCH} mutations.`, "Nothing was accepted.");
  b.mutations.forEach(validateMutation);

  await assertUnderRate(c.env.DB, String(b.device_id));

  const results: any[] = [];
  for (const m of b.mutations) {
    try {
      const prepared = await prepareMutation(c.env.DB, {
        mutationId: String(m.mutation_id),
        entity: String(m.entity),
        recordId: String(m.record_id),
        baseVersion: m.base_version ?? null,
        deviceId: String(b.device_id),
        tombstone: Boolean(m.tombstone),
        payloadHash: m.payload_hash ?? null,
      });
      const outcome = await commitMutation(c.env.DB, prepared);
      results.push({ mutation_id: m.mutation_id, ...outcome });
    } catch (err) {
      // A refusal is an ANSWER for that item, not a failure of the batch.
      results.push({
        mutation_id: m.mutation_id,
        status: "REFUSED",
        reason: (err as Error).message,
      });
    }
  }

  await logEvent(c.env.DB, {
    level: "info", scope: "sync", event: "push",
    detail: { device: b.device_id, count: b.mutations.length, refused: results.filter((r) => r.status === "REFUSED").length },
  }).catch(() => {});

  return ok(c, { results });
});

/** Pull everything after a cursor. The substrate excludes sovereign entities; this only pages. */
sync.get("/pull", async (c) => {
  const device = c.req.query("device_id");
  if (!device) throw badRequest("A pull needs device_id");
  const after = Number(c.req.query("after") ?? 0);
  const limit = Math.min(Number(c.req.query("limit") ?? 200), 500);
  if (!Number.isFinite(after) || after < 0) throw badRequest("after must be a non-negative number");
  try {
    const page = await pullLedger(c.env.DB, device, after, limit);
    return ok(c, { mutations: page.rows, next_seq: page.nextSeq, has_more: page.rows.length === limit });
  } catch (err) {
    if (err instanceof SyncRefusal) throw badRequest((err as Error).message);
    throw err;
  }
});

/** Acknowledgement: the client says how far it has durably stored. Cursors only move forward. */
sync.post("/ack", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b?.device_id || !Number.isInteger(b?.seq)) throw badRequest("An ack needs device_id and an integer seq");
  try {
    const at = await advanceCursor(c.env.DB, String(b.device_id), Number(b.seq));
    return ok(c, { device_id: b.device_id, last_seq: at });
  } catch (err) {
    if (err instanceof SyncRefusal) throw badRequest((err as Error).message);
    throw err;
  }
});

sync.get("/devices", async (c) => {
  const res = await c.env.DB
    .prepare(`SELECT device_id, kind, label, registered_at, last_seen_at, revoked_at, revoked_reason FROM sync_device ORDER BY registered_at`)
    .all<any>();
  return ok(c, { devices: res.results ?? [] });
});

sync.post("/devices", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b?.device_id || !b?.label) throw badRequest("A device needs device_id and label");
  if (b.kind !== "cloud" && b.kind !== "private") throw badRequest('kind must be "cloud" or "private"');
  await registerDevice(c.env.DB, { deviceId: String(b.device_id), kind: b.kind, label: String(b.label) });
  await logEvent(c.env.DB, { level: "info", scope: "sync", event: "device_registered", detail: { device: b.device_id, kind: b.kind } }).catch(() => {});
  return ok(c, { device_id: b.device_id, kind: b.kind });
});

sync.post("/devices/:id/revoke", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b?.reason) throw badRequest("Revoking a device needs a reason", "It is recorded, and it is what somebody reads later.");
  await revokeDevice(c.env.DB, c.req.param("id"), String(b.reason));
  await logEvent(c.env.DB, { level: "warn", scope: "sync", event: "device_revoked", detail: { device: c.req.param("id"), reason: b.reason } }).catch(() => {});
  return ok(c, { device_id: c.req.param("id"), revoked: true });
});

/**
 * The conflict inbox (Batch 6).
 *
 * It shows what a person needs to decide with: the entity, both versions, the base they diverged
 * from, why it conflicted, and which resolutions are SAFE for that entity. A NEVER_AUTOMATIC
 * entity - a decision, a capital allocation, the emotional-state gate - offers no one-press
 * "apply theirs", because the whole point of that class is that a machine may not pick a winner
 * and a UI that offers it invites one anyway.
 */
sync.get("/conflicts", async (c) => {
  const rows = await openConflicts(c.env.DB);
  const conflicts = [];
  for (const r of rows) {
    const policy = await c.env.DB
      .prepare(`SELECT merge_policy, residency FROM data_policy WHERE entity = ?1`)
      .bind(r.entity)
      .first<{ merge_policy: string; residency: string }>();
    const merge = policy?.merge_policy ?? "VERSIONED";
    conflicts.push({
      ...r,
      merge_policy: merge,
      base_version: r.base_version,
      cloud_version: r.current_version,
      local_version: r.base_version,
      reason:
        merge === "IMMUTABLE"
          ? "This record is written once. A different version arrived, and both are kept."
          : `Edited from version ${r.base_version ?? 0} while the record had already moved to ${r.current_version}.`,
      safe_actions:
        merge === "NEVER_AUTOMATIC"
          ? ["MERGED_BY_HAND"]
          : ["KEPT_CURRENT", "APPLIED_INCOMING", "MERGED_BY_HAND"],
    });
  }
  return ok(c, { conflicts });
});

/**
 * Resolving a conflict is itself a mutation (Batch 6).
 *
 * Marking a disagreement resolved without recording who decided and which side won would leave the
 * system unable to answer the only question anyone asks afterwards: why does it say this?
 */
sync.post("/conflicts/:id/resolve", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const RESOLUTIONS = new Set(["KEPT_CURRENT", "APPLIED_INCOMING", "MERGED_BY_HAND"]);
  if (!RESOLUTIONS.has(b?.resolution)) throw badRequest(`resolution must be one of: ${[...RESOLUTIONS].join(", ")}`);
  if (!b?.by) throw badRequest("A resolution needs to say who made it");

  const row = await c.env.DB.prepare(`SELECT * FROM sync_conflict WHERE id = ?1`).bind(c.req.param("id")).first<any>();
  if (!row) throw badRequest("No such conflict");
  if (row.resolution !== "OPEN") throw badRequest("That conflict is already resolved", `It was ${row.resolution}.`);

  /*
   * A NEVER_AUTOMATIC entity accepts only a hand merge. The endpoint enforces it rather than
   * trusting the UI to hide the other buttons: a rule that only exists in a screen is a rule that
   * a curl command does not have to follow.
   */
  const policy = await c.env.DB
    .prepare(`SELECT merge_policy FROM data_policy WHERE entity = ?1`)
    .bind(row.entity)
    .first<{ merge_policy: string }>();
  if (policy?.merge_policy === "NEVER_AUTOMATIC" && b.resolution !== "MERGED_BY_HAND") {
    throw badRequest(
      `${row.entity} is NEVER_AUTOMATIC: a machine may not pick a winner here.`,
      "Reconcile it by hand and record the result as MERGED_BY_HAND.",
    );
  }

  const now = Date.now();
  await c.env.DB
    .prepare(`UPDATE sync_conflict SET resolution = ?2, resolved_at = ?3, resolved_by = ?4, note = ?5 WHERE id = ?1`)
    .bind(c.req.param("id"), b.resolution, now, String(b.by), b.note ?? null)
    .run();

  /*
   * THE RESOLUTION IS ITSELF A MUTATION (Batch 6).
   *
   * Otherwise the two sides stay diverged: one of them decided, and the other has no way to learn
   * that a decision happened, so it re-bases on a version that is no longer the agreed one and
   * conflicts again. Writing it to the ledger means every device pulls the resolution the same way
   * it pulls anything else, and the version moves - deliberately, even for KEPT_CURRENT, because
   * everyone must re-base on the state that was agreed rather than the one they happened to hold.
   */
  /*
   * THE RESOLUTION GOES THROUGH THE SAME DOOR AS EVERY OTHER MUTATION.
   *
   * Found in review: this path wrote to sync_ledger directly, which is the one place in the system
   * that reaches the ledger without passing prepareMutation — and therefore without the airlock or
   * the never-syncs list. A conflict row for a sovereign entity, however it got there, would have
   * been resolvable into a ledger entry naming it. The pull query would still have filtered it, but
   * "a second gate would have caught it" is not a reason to leave the first one open.
   */
  await assertEntityMaySync(c.env.DB, row.entity, row.record_id).catch((err) => {
    throw badRequest(
      `${row.entity} is not eligible to synchronize, so a resolution cannot be recorded for it.`,
      (err as Error).message,
    );
  });

  const nextVersion = (row.current_version ?? 0) + 1;
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO sync_ledger (mutation_id, entity, record_id, base_version, result_version, device_id, tombstone, payload_hash, wall_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, 'resolution', 0, NULL, ?6)`,
      )
      .bind(`mut_resolve_${c.req.param("id")}`, row.entity, row.record_id, row.current_version, nextVersion, now),
    c.env.DB
      .prepare(
        `INSERT INTO record_version (entity, record_id, version, tombstone, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4)
         ON CONFLICT (entity, record_id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at`,
      )
      .bind(row.entity, row.record_id, nextVersion, now),
  ]);
  await logEvent(c.env.DB, {
    level: "info", scope: "sync", event: "conflict_resolved",
    detail: { conflict: c.req.param("id"), entity: row.entity, resolution: b.resolution, by: b.by },
  }).catch(() => {});
  return ok(c, { id: c.req.param("id"), resolution: b.resolution, version: nextVersion });
});
