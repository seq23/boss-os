import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocal, enqueue, syncOnce, status, backoffMs } from "../scripts/sync-agent/agent.mjs";

/**
 * Batch 5 — the private-side sync agent.
 *
 * IT LIVES IN THE CHASSIS SUITE, NOT tests/boss, and the reason is mechanical: the agent uses
 * node:sqlite for its local replica, and tests/boss runs inside workerd where that does not exist.
 * The code under test is a Node process on the private machine, so a Node test is the honest place
 * for it.
 *
 * The cloud is stubbed. What matters here is not that a happy path works but that an OUTAGE does
 * not lose anything, because losing a capture during an outage is the one failure an agent exists
 * to prevent and the one nobody notices for months.
 */
let dir: string;
let db: any;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "boss-agent-"));
  db = openLocal(join(dir, "local.db"));
});
afterEach(() => {
  try { db?.close?.(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

const reply = (data: unknown, ok = true, httpOk = true) =>
  ({ ok: httpOk, status: httpOk ? 200 : 500, json: async () => (ok ? { ok: true, data } : { ok: false, error: "no" }), headers: new Headers() }) as any;

function cloud(handlers: Record<string, (body: any) => any>) {
  const seen: string[] = [];
  const fetchImpl = async (url: string, init: any = {}) => {
    const path = new URL(url).pathname;
    seen.push(path);
    const body = init.body ? JSON.parse(init.body) : {};
    const h = Object.entries(handlers).find(([p]) => path.startsWith(p));
    if (!h) return reply({});
    return h[1](body);
  };
  return { fetchImpl, seen };
}

const opts = (fetchImpl: any) => ({ origin: "https://boss.test", deviceId: "dev_mac", fetchImpl, now: 1_000_000 });

describe("Batch 5 — the local sync agent", () => {
  it("drains the outbox when the cloud applies what it sent", async () => {
    const id = enqueue(db, { entity: "tasks", recordId: "t1" });
    const { fetchImpl } = cloud({
      "/api/boss/sync/push": () => reply({ results: [{ mutation_id: id, status: "APPLIED", seq: 1, version: 1 }] }),
      "/api/boss/sync/pull": () => reply({ mutations: [], next_seq: 0 }),
    });
    const h = await syncOnce(db, opts(fetchImpl));
    expect(h.pushed).toBe(1);
    expect(status(db).outbox).toBe(0);
    expect(status(db).last_success_at).toBeTruthy();
  });

  /** The case that matters. */
  it("keeps everything through an outage, backs off, and drops nothing", async () => {
    enqueue(db, { entity: "tasks", recordId: "t1" });
    enqueue(db, { entity: "tasks", recordId: "t2" });
    const { fetchImpl } = cloud({ "/api/boss/sync/push": () => { throw new Error("ECONNREFUSED"); } });

    const h = await syncOnce(db, opts(fetchImpl));
    expect(h.kept).toBe(2);
    expect(h.error).toMatch(/ECONNREFUSED/);
    expect(status(db).outbox).toBe(2);
    expect(status(db).last_error).toMatch(/ECONNREFUSED/);

    const rows = db.prepare("SELECT attempts, next_try_at FROM agent_outbox").all();
    for (const r of rows) {
      expect(r.attempts).toBe(1);
      expect(r.next_try_at).toBeGreaterThan(1_000_000);
    }
  });

  it("moves a conflict out of the outbox so the queue can still drain", async () => {
    const id = enqueue(db, { entity: "tasks", recordId: "t1", baseVersion: 1 });
    const { fetchImpl } = cloud({
      "/api/boss/sync/push": () => reply({ results: [{ mutation_id: id, status: "CONFLICT", currentVersion: 3 }] }),
      "/api/boss/sync/pull": () => reply({ mutations: [], next_seq: 0 }),
    });
    const h = await syncOnce(db, opts(fetchImpl));
    expect(h.conflicts).toBe(1);
    const s = status(db);
    expect(s.outbox).toBe(0);
    expect(s.conflicts).toBe(1);
    expect(db.prepare("SELECT reason FROM agent_conflict").get().reason).toMatch(/base 1 vs current 3/);
  });

  it("records a refusal and never retries it into a different answer", async () => {
    const id = enqueue(db, { entity: "dream_entries", recordId: "d1" });
    const { fetchImpl } = cloud({
      "/api/boss/sync/push": () => reply({ results: [{ mutation_id: id, status: "REFUSED", reason: "LOCAL_ONLY — NOTHING TRANSMITTED" }] }),
      "/api/boss/sync/pull": () => reply({ mutations: [], next_seq: 0 }),
    });
    const h = await syncOnce(db, opts(fetchImpl));
    expect(h.refused).toBe(1);
    expect(status(db).outbox).toBe(0);
    expect(db.prepare("SELECT reason FROM agent_conflict").get().reason).toMatch(/NOTHING TRANSMITTED/);
  });

  /**
   * Acknowledging before the rows are durable would advance the cursor past mutations this machine
   * never stored, and nothing would send them again — silent and permanent.
   */
  it("stores what it pulled BEFORE it acknowledges, and only then moves the cursor", async () => {
    const { fetchImpl, seen } = cloud({
      "/api/boss/sync/pull": () => reply({ mutations: [{ seq: 7, mutation_id: "m1", entity: "tasks", record_id: "t9", result_version: 2 }], next_seq: 7 }),
      "/api/boss/sync/ack": () => reply({ last_seq: 7 }),
    });
    const h = await syncOnce(db, opts(fetchImpl));
    expect(h.pulled).toBe(1);
    expect(seen.indexOf("/api/boss/sync/pull")).toBeLessThan(seen.indexOf("/api/boss/sync/ack"));
    expect(status(db).cursor).toBe(7);
    expect(status(db).received).toBe(1);
  });

  it("does not advance the cursor when the pull fails", async () => {
    const { fetchImpl } = cloud({ "/api/boss/sync/pull": () => { throw new Error("gone"); } });
    const h = await syncOnce(db, opts(fetchImpl));
    expect(h.error).toMatch(/gone/);
    expect(status(db).cursor).toBe(0);
  });

  it("backs off exponentially and stops at five minutes", () => {
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(30)).toBe(300_000);
  });
});
