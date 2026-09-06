#!/usr/bin/env node
/**
 * Batch 5 — the private-side sync agent.
 *
 * Runs on the machine that holds the private domain and moves cloud-eligible rows between it and
 * boss.sequoiataylor.com. It is the counterpart to Batch 4's endpoints and it decides nothing:
 * outcomes come from the cloud substrate, and this keeps a durable local record of what it sent,
 * what it received, what disagreed, and when it last succeeded.
 *
 * THE RULE THAT OUTRANKS EVERYTHING HERE (§ Batch 5): "No cloud outage may cause LOCAL_ONLY
 * information to be promoted into a cloud path." The agent therefore never decides what may leave.
 * It pushes only what is already in its outbox, and only the cloud's airlock admits it — so a
 * degraded, retrying, half-connected agent has no path to widen residency, because it never had
 * one to begin with.
 *
 * NOTHING HERE IS MACHINE-SPECIFIC EXCEPT THE FILE PATH, which is exactly the kind of thing §3.4
 * says never syncs. The device identity is a row on both sides; replacing the laptop is a
 * registration.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/*
 * node:sqlite is loaded through createRequire rather than imported.
 *
 * It is a Node built-in, but Vite — which the test runner uses to transform this file — does not
 * yet know it as one: it strips the `node:` prefix, looks for a package called "sqlite", and fails
 * before a single test collects. createRequire hands the specifier straight to Node at runtime,
 * where it is exactly what it says it is. Nothing about the agent needs bundling; only the tests
 * pass through Vite at all.
 */
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

export const DEFAULT_DB = join(homedir(), ".boss-os", "local.db");
const DEFAULT_ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";

/** Exponential with a ceiling. A device that has been offline for a day must not hammer on return. */
export function backoffMs(attempt) {
  return Math.min(2 ** Math.max(0, attempt) * 1000, 5 * 60_000);
}

export function openLocal(path = DEFAULT_DB) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_outbox (
      mutation_id TEXT PRIMARY KEY,
      entity      TEXT NOT NULL,
      record_id   TEXT NOT NULL,
      base_version INTEGER,
      tombstone   INTEGER NOT NULL DEFAULT 0,
      payload_hash TEXT,
      created_at  INTEGER NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      next_try_at INTEGER NOT NULL DEFAULT 0,
      last_error  TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_inbox (
      seq INTEGER PRIMARY KEY, mutation_id TEXT NOT NULL, entity TEXT NOT NULL, record_id TEXT NOT NULL,
      result_version INTEGER NOT NULL, tombstone INTEGER NOT NULL DEFAULT 0, received_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_conflict (
      mutation_id TEXT PRIMARY KEY, entity TEXT NOT NULL, record_id TEXT NOT NULL,
      reason TEXT NOT NULL, detected_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}

const getState = (db, k, fallback = null) =>
  db.prepare(`SELECT value FROM agent_state WHERE key = ?`).get(k)?.value ?? fallback;
const setState = (db, k, v) =>
  db.prepare(`INSERT INTO agent_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).run(k, String(v));

export function enqueue(db, { entity, recordId, baseVersion = null, tombstone = false, payloadHash = null }) {
  const mutationId = `mut_${crypto.randomUUID()}`;
  db.prepare(
    `INSERT INTO agent_outbox (mutation_id, entity, record_id, base_version, tombstone, payload_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(mutationId, entity, recordId, baseVersion, tombstone ? 1 : 0, payloadHash, Date.now());
  return mutationId;
}

/**
 * One cycle: push what is due, then pull what is new, then acknowledge.
 *
 * ACK ONLY AFTER THE ROWS ARE DURABLE. Acknowledging first would advance the cursor past mutations
 * this machine never stored, and nothing would ever send them again — silent, permanent, and
 * invisible until someone noticed a record missing months later.
 */
export async function syncOnce(db, { origin = DEFAULT_ORIGIN, deviceId, fetchImpl = fetch, cookie = "", now = Date.now() } = {}) {
  const health = { pushed: 0, refused: 0, conflicts: 0, pulled: 0, kept: 0, error: null };
  const call = (path, init = {}) =>
    fetchImpl(`${origin}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
    });

  const due = db.prepare(`SELECT * FROM agent_outbox WHERE next_try_at <= ? ORDER BY created_at LIMIT 100`).all(now);
  if (due.length > 0) {
    try {
      const res = await call("/api/boss/sync/push", {
        method: "POST",
        body: JSON.stringify({
          device_id: deviceId,
          mutations: due.map((d) => ({
            mutation_id: d.mutation_id, entity: d.entity, record_id: d.record_id,
            base_version: d.base_version, tombstone: Boolean(d.tombstone), payload_hash: d.payload_hash,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);

      for (const r of body.data.results) {
        const item = due.find((d) => d.mutation_id === r.mutation_id);
        if (r.status === "APPLIED" || r.status === "REPLAY") {
          db.prepare(`DELETE FROM agent_outbox WHERE mutation_id = ?`).run(r.mutation_id);
          health.pushed++;
        } else if (r.status === "CONFLICT") {
          /*
           * A conflict LEAVES the outbox and is kept as a conflict. Retrying it would produce the
           * same conflict for ever, and a queue that cannot drain stops being read.
           */
          db.prepare(`INSERT OR REPLACE INTO agent_conflict (mutation_id, entity, record_id, reason, detected_at) VALUES (?,?,?,?,?)`)
            .run(r.mutation_id, item.entity, item.record_id, `base ${item.base_version} vs current ${r.currentVersion}`, now);
          db.prepare(`DELETE FROM agent_outbox WHERE mutation_id = ?`).run(r.mutation_id);
          health.conflicts++;
        } else {
          // REFUSED is the cloud's final answer — airlock, policy, or a revoked device. Recorded,
          // dropped, and never retried into a different outcome.
          db.prepare(`INSERT OR REPLACE INTO agent_conflict (mutation_id, entity, record_id, reason, detected_at) VALUES (?,?,?,?,?)`)
            .run(r.mutation_id, item.entity, item.record_id, r.reason ?? "refused", now);
          db.prepare(`DELETE FROM agent_outbox WHERE mutation_id = ?`).run(r.mutation_id);
          health.refused++;
        }
      }
    } catch (err) {
      // Transport failure: keep everything, back off, and say so. Nothing is dropped on an outage.
      for (const d of due) {
        db.prepare(`UPDATE agent_outbox SET attempts = attempts + 1, next_try_at = ?, last_error = ? WHERE mutation_id = ?`)
          .run(now + backoffMs(d.attempts + 1), String(err), d.mutation_id);
      }
      health.kept = due.length;
      health.error = String(err);
      setState(db, "last_error", String(err));
      return health;
    }
  }

  try {
    const after = Number(getState(db, "cursor", "0"));
    const res = await call(`/api/boss/sync/pull?device_id=${encodeURIComponent(deviceId)}&after=${after}&limit=200`);
    const body = await res.json();
    if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);

    for (const row of body.data.mutations) {
      db.prepare(
        `INSERT OR REPLACE INTO agent_inbox (seq, mutation_id, entity, record_id, result_version, tombstone, received_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(row.seq, row.mutation_id, row.entity, row.record_id, row.result_version, row.tombstone ?? 0, now);
      health.pulled++;
    }

    if (body.data.mutations.length > 0) {
      const head = body.data.next_seq;
      await call("/api/boss/sync/ack", { method: "POST", body: JSON.stringify({ device_id: deviceId, seq: head }) });
      setState(db, "cursor", head);
    }
    setState(db, "last_success_at", now);
    setState(db, "last_error", "");
  } catch (err) {
    health.error = String(err);
    setState(db, "last_error", String(err));
  }
  return health;
}

export function status(db) {
  return {
    outbox: db.prepare(`SELECT COUNT(*) AS n FROM agent_outbox`).get().n,
    conflicts: db.prepare(`SELECT COUNT(*) AS n FROM agent_conflict`).get().n,
    received: db.prepare(`SELECT COUNT(*) AS n FROM agent_inbox`).get().n,
    cursor: Number(getState(db, "cursor", "0")),
    last_success_at: Number(getState(db, "last_success_at", "0")) || null,
    last_error: getState(db, "last_error", "") || null,
  };
}

/** Unlock once and reuse the cookie; the passcode is read from the environment, never stored. */
export async function unlock(origin, passcode, fetchImpl = fetch) {
  const res = await fetchImpl(`${origin}/api/boss/auth/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode }),
  });
  if (!res.ok) throw new Error(`unlock failed: HTTP ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

/* ─── CLI ────────────────────────────────────────────────────────────────── */

async function main() {
  const cmd = process.argv[2] ?? "status";
  const db = openLocal(process.env.BOSS_OS_LOCAL_DB ?? DEFAULT_DB);
  const deviceId = process.env.BOSS_OS_DEVICE_ID;
  const origin = process.env.BOSS_OS_ORIGIN ?? DEFAULT_ORIGIN;

  if (cmd === "status") {
    console.log(JSON.stringify(status(db), null, 2));
    return;
  }
  if (!deviceId) {
    console.error("BOSS_OS_DEVICE_ID is not set. Register the device first, then export its id.");
    process.exit(1);
  }
  if (!process.env.BOSS_PASSCODE) {
    console.error("BOSS_PASSCODE is not set. The agent authenticates as you; it holds no credential of its own.");
    process.exit(1);
  }
  const cookie = await unlock(origin, process.env.BOSS_PASSCODE);

  if (cmd === "once") {
    console.log(JSON.stringify(await syncOnce(db, { origin, deviceId, cookie }), null, 2));
    return;
  }
  if (cmd === "watch") {
    /*
     * SAFE CANCELLATION. A signal sets a flag; the loop finishes the cycle it is in and exits
     * between cycles. Killing mid-push would be survivable — every mutation is idempotent — but
     * "survivable" is not the same as "clean", and the difference is what you want at 3am.
     */
    let stopping = false;
    const stop = () => {
      if (stopping) process.exit(1);
      stopping = true;
      console.error("stopping after this cycle…");
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    while (!stopping) {
      const h = await syncOnce(db, { origin, deviceId, cookie });
      console.log(new Date().toISOString(), JSON.stringify(h));
      const wait = h.error ? 30_000 : 10_000;
      await new Promise((r) => setTimeout(r, wait));
    }
    return;
  }
  console.error(`unknown command "${cmd}". One of: status, once, watch`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
