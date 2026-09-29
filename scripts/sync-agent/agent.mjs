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
 * IT NOW HAS A SECOND JOB (Stage 2, runner.mjs): claiming approved `agent_executed` runs and
 * executing them here, because Boss OS is a Cloudflare Worker and cannot reach a CLI or a model on
 * this machine. The rule above is why that job could be added without a new one — the runner also
 * decides nothing; it executes an already-approved envelope and never widens it.
 *
 * NOTHING HERE IS MACHINE-SPECIFIC EXCEPT THE FILE PATH, which is exactly the kind of thing §3.4
 * says never syncs. The device identity is a row on both sides; replacing the laptop is a
 * registration.
 */
import { createRequire } from "node:module";
import { resolveDeviceId, missingDeviceIdMessage } from "../ops/device-id.mjs";
import { createSeatExhaustion } from "./seatExhaustion.mjs";
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
  /*
   * RESOLVED, NOT READ OFF THE ENVIRONMENT. The env still wins, but a machine that registered once
   * no longer needs every caller to remember — which is why every hand-invocation of this agent
   * died until someone grepped a launchd plist for the answer.
   */
  const deviceId = resolveDeviceId();
  const origin = process.env.BOSS_OS_ORIGIN ?? DEFAULT_ORIGIN;

  if (cmd === "status") {
    console.log(JSON.stringify(status(db), null, 2));
    return;
  }
  if (!deviceId) {
    console.error(missingDeviceIdMessage());
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
  /*
   * THE SECOND JOB (Stage 2). Claim one approved `agent_executed` run, execute it here, report the
   * evidence back. It is a separate command rather than part of a sync cycle because the two jobs
   * fail differently: a sync outage is routine and retried, while a run that cannot be reported has
   * already changed a repository and needs a person. Keeping them apart keeps `once` honest.
   */
  if (cmd === "work-once" || cmd === "work") {
    const { workOnce, childEnv, SEAT_PREFLIGHT } = await import("./runner.mjs");
    /*
     * PREFLIGHT EVERY SEAT, AND ON THE ENVIRONMENT THE CHILD ACTUALLY GETS.
     *
     * Two faults lived in the four lines this replaces, and together they cost the 18 Sep 2026
     * morning brief.
     *
     *   1. It called `describeAuth()` on `process.env`. This process runs under `vault:run`, which
     *      injects every vault key; ANTHROPIC_API_KEY entered the vault when `bk_anthropic` was
     *      commissioned on 17 Sep, and from then on the claimer exited 1 before claiming anything.
     *      `childEnv` strips every credential before the CLI starts, so the key was never reachable
     *      by the thing the guard was protecting. Passing `childEnv(process.env)` keeps the refusal
     *      live against the environment it actually governs.
     *   2. It asked ONLY the Claude Code seat, and then `workOnce` claimed only for
     *      `bk_claude_code` — so `bk_codex`, enabled the same night with its executor shipped
     *      alongside, was a seat nothing could ever claim for. "Exists but nothing invokes it",
     *      one layer below where this repository usually catches it.
     *
     * A SEAT THAT CANNOT AUTHENTICATE IS SKIPPED AND NAMED, NOT FATAL. One dead seat must not stop
     * the other from doing the day's work — that is the difference between a chain member and a
     * dependency, and `bk_local_runtime`'s "NO LOCAL HOST, deferred indefinitely" is what it looks
     * like when it is got wrong. Only a run in which NO seat is usable exits non-zero.
     */
    const childEnvironment = childEnv(process.env);
    const seats = [];
    const unusableAtStart = [];
    for (const [backendId, load] of Object.entries(SEAT_PREFLIGHT)) {
      const describeAuth = await load();
      const auth = describeAuth(childEnvironment);
      if (auth.ok) seats.push(backendId);
      else { unusableAtStart.push(backendId); console.error(`${backendId}: ${auth.detail}`); }
    }
    if (seats.length === 0) {
      // A backend that cannot run says WHICH thing is wrong, rather than failing obscurely.
      console.error("No agent_executed seat can authenticate on this machine. Nothing was claimed.");
      process.exit(1);
    }
    /*
     * A SEAT WHOSE PLAN IS OUT OF USAGE IS SKIPPED UNTIL IT RESETS (29 Sep 2026). Remembered in the
     * local database, so a restart in the middle of a window does not forget. It joins the seats that
     * failed preflight — the SAME door, `fallback_from` — so the cloud can hand this machine's other
     * seat the runs parked for the spent one, when the run's ladder names it.
     */
    const exhaustion = createSeatExhaustion({
      load: () => { try { return JSON.parse(getState(db, "seat_exhausted", "{}")); } catch { return {}; } },
      save: (state) => setState(db, "seat_exhausted", JSON.stringify(state)),
    });
    const run = async () => {
      const spentNow = seats.filter((id) => exhaustion.activeUntil(id) !== null);
      const usableNow = seats.filter((id) => !spentNow.includes(id));
      const unusable = [...unusableAtStart, ...spentNow];
      if (usableNow.length === 0) {
        console.error(`every seat is out of usage until ${new Date(Math.min(...spentNow.map((id) => exhaustion.activeUntil(id)))).toISOString()}; nothing claimed.`);
        return { claimed: false, error: null, evidence: null };
      }
      /*
       * ONE CYCLE TRIES EVERY SEAT AND STOPS AT THE FIRST CLAIM. Runs are parked per backend, so a
       * queue holding only Codex work must not look like an empty queue because Claude Code had
       * nothing.
       */
      let out = { claimed: false, error: null, evidence: null };
      for (const backendId of usableNow) {
        /*
         * A USABLE SEAT MAY TAKE WORK PARKED FOR A SEAT THAT CANNOT AUTHENTICATE — when the run's
         * own ladder lists it as the next rung. That is the whole of "the ladder is working" on the
         * Mac's side: her Claude seat down, her Codex seat writes the briefing, at $0.
         */
        out = await workOnce({ origin, deviceId, cookie, backendId, fallbackFrom: unusable });
        if (out.claimed || out.error) break;
      }
      /*
       * WHAT THE RUN SAID ABOUT THE SEAT. A spent plan marks the seat that ran it; a run that
       * succeeded proves its plan has usage again. The seat is the one that CLAIMED (the packet's
       * backend_id), which after a hand-off is not the seat the run was parked for.
       */
      if (out.evidence) {
        const ranOn = out.evidence.backend_id ?? null;
        if (ranOn && out.evidence.seat_exhausted) {
          const until = exhaustion.mark(ranOn, out.evidence.seat_exhausted.retry_after_seconds);
          console.error(`${ranOn}: plan out of usage (${String(out.evidence.seat_exhausted.notice ?? "").slice(0, 120)}); skipped until ${new Date(until).toISOString()}.`);
        } else if (ranOn && out.evidence.status === "succeeded") {
          exhaustion.clear(ranOn);
        }
      }
      if (out.evidence && !out.reported) {
        /*
         * THE RUN HAPPENED AND THE CLOUD DID NOT HEAR. Printing the whole packet is the only place
         * this evidence still exists, so it goes to stdout in full rather than being summarised
         * into something nobody can act on.
         */
        console.error("REPORT FAILED — the evidence for a completed run is below and nowhere else:");
        console.error(JSON.stringify(out.evidence, null, 2));
      }
      return out;
    };
    if (cmd === "work-once") {
      console.log(JSON.stringify(await run(), null, 2));
      return;
    }
    let stopping = false;
    process.on("SIGINT", () => { stopping = true; });
    process.on("SIGTERM", () => { stopping = true; });
    while (!stopping) {
      const out = await run();
      console.log(new Date().toISOString(), JSON.stringify({ claimed: out.claimed, status: out.evidence?.status ?? null, error: out.error }));
      // Idle polling is slower than a busy loop on purpose: there is one owner and one machine, and
      // an empty queue is the normal state.
      await new Promise((r) => setTimeout(r, out.claimed ? 2_000 : 20_000));
    }
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
  console.error(`unknown command "${cmd}". One of: status, once, watch, work-once, work`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
