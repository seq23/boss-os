import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { logEvent } from "../lib/log";
import { AirlockRefusal } from "../policy/airlock";
import {
  prepareMutation, registerDevice, advanceCursor, openConflicts, SyncRefusal,
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
