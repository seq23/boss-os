import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  prepareMutation, commitMutation, pull, advanceCursor,
  registerDevice, revokeDevice, openConflicts, SyncRefusal,
} from "../../src/worker/boss/sync/ledger";
import { AirlockRefusal } from "../../src/worker/boss/policy/airlock";

/**
 * §10 says to design this assuming devices go offline, requests get replayed, the same mutation
 * arrives twice, clocks disagree, both sides change, a device is revoked, and the network fails
 * after the server has already committed. Each of those is a test here, because a sync layer that
 * is only tested on the happy path is a data-loss engine with good manners.
 */
const MAC = "dev_private_proving_ground";
const CLOUD = "dev_cloud";

beforeAll(async () => {
  await applyD1Migrations(env.DB, (env as any).TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sync_ledger"),
    env.DB.prepare("DELETE FROM record_version"),
    env.DB.prepare("DELETE FROM sync_conflict"),
    env.DB.prepare("DELETE FROM sync_cursor"),
    env.DB.prepare("DELETE FROM sync_device"),
  ]);
  await registerDevice(env.DB, { deviceId: MAC, kind: "private", label: "Proving ground" });
  await registerDevice(env.DB, { deviceId: CLOUD, kind: "cloud", label: "Cloudflare" });
});

const mut = (over: Partial<Parameters<typeof prepareMutation>[1]> = {}) => ({
  mutationId: `mut_${crypto.randomUUID()}`,
  entity: "tasks",
  recordId: "task_1",
  baseVersion: null as number | null,
  deviceId: MAC,
  ...over,
});

describe("Boss OS v20.1 §2.3 — the sync substrate", () => {
  it("applies a create and gives the record version 1", async () => {
    const out = await commitMutation(env.DB, await prepareMutation(env.DB, mut()));
    expect(out.status).toBe("APPLIED");
    if (out.status === "APPLIED") {
      expect(out.version).toBe(1);
      expect(out.seq).toBeGreaterThan(0);
    }
  });

  it("treats the same mutation delivered twice as one write, not two", async () => {
    const m = mut();
    const first = await commitMutation(env.DB, await prepareMutation(env.DB, m));
    const again = await commitMutation(env.DB, await prepareMutation(env.DB, m));
    expect(first.status).toBe("APPLIED");
    expect(again.status).toBe("REPLAY");
    if (first.status === "APPLIED" && again.status === "REPLAY") expect(again.seq).toBe(first.seq);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM sync_ledger").first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  /**
   * The case naive last-write-wins gets wrong. Both sides edited version 1 while apart; the second
   * one to arrive must not silently overwrite the first.
   */
  it("records a conflict instead of overwriting an edit it never saw", async () => {
    await commitMutation(env.DB, await prepareMutation(env.DB, mut()));                       // v1
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ baseVersion: 1 })));      // v2, cloud edit
    const late = await commitMutation(env.DB, await prepareMutation(env.DB, mut({ baseVersion: 1, deviceId: MAC })));

    expect(late.status).toBe("CONFLICT");
    if (late.status === "CONFLICT") {
      expect(late.currentVersion).toBe(2);
      expect(late.baseVersion).toBe(1);
    }
    // The record still holds the edit that arrived first; nothing was lost either way.
    const v = await env.DB.prepare("SELECT version FROM record_version WHERE entity='tasks' AND record_id='task_1'").first<{ version: number }>();
    expect(v!.version).toBe(2);
    expect(await openConflicts(env.DB)).toHaveLength(1);
  });

  it("refuses a sovereign entity before it is ever serialized", async () => {
    for (const entity of ["dream_entries", "decisions", "emotional_states", "meeting_captures"]) {
      await expect(prepareMutation(env.DB, mut({ entity, recordId: "r1" }))).rejects.toThrow(AirlockRefusal);
    }
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM sync_ledger").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("refuses a record tightened below its entity, even though the entity syncs", async () => {
    const { tighten } = await import("../../src/worker/boss/policy/airlock");
    await tighten(env.DB, { entity: "tasks", recordId: "task_secret", residency: "LOCAL_ONLY", reason: "names a health matter", by: "owner" });
    await expect(prepareMutation(env.DB, mut({ recordId: "task_secret" }))).rejects.toThrow(AirlockRefusal);
    // The rest of the entity is unaffected.
    await expect(prepareMutation(env.DB, mut({ recordId: "task_ordinary" }))).resolves.toBeTruthy();
  });

  it("refuses an unregistered device, and a revoked one, without accepting anything", async () => {
    await expect(prepareMutation(env.DB, mut({ deviceId: "dev_never_seen" }))).rejects.toThrow(SyncRefusal);
    await revokeDevice(env.DB, MAC, "laptop replaced");
    await expect(prepareMutation(env.DB, mut())).rejects.toThrow(/REVOKED|revoked/);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM sync_ledger").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("pulls incrementally and never returns a sovereign entity", async () => {
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ recordId: "a" })));
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ recordId: "b" })));
    // A sovereign row planted straight into the ledger, bypassing every guard above it.
    await env.DB
      .prepare(
        `INSERT INTO sync_ledger (mutation_id, entity, record_id, base_version, result_version, device_id, wall_ms)
         VALUES ('planted', 'dream_entries', 'dream_1', 0, 1, ?1, ?2)`,
      )
      .bind(MAC, Date.now())
      .run();

    const first = await pull(env.DB, CLOUD, 0, 1);
    expect(first.rows).toHaveLength(1);
    const rest = await pull(env.DB, CLOUD, first.nextSeq, 100);
    const entities = [...first.rows, ...rest.rows].map((r) => r.entity);
    expect(entities).not.toContain("dream_entries");
  });

  it("moves a cursor forward and refuses to let a stale ack rewind it", async () => {
    await advanceCursor(env.DB, CLOUD, 10);
    expect(await advanceCursor(env.DB, CLOUD, 4)).toBe(10);
    expect(await advanceCursor(env.DB, CLOUD, 12)).toBe(12);
  });

  /**
   * "Network requests can fail after the server commits." The client never hears the answer and
   * retries; the substrate must not produce a second version.
   */
  it("survives the reply being lost: the retry returns the first answer", async () => {
    const m = mut();
    const committed = await commitMutation(env.DB, await prepareMutation(env.DB, m));
    const retried = await commitMutation(env.DB, await prepareMutation(env.DB, m));
    expect(retried.status).toBe("REPLAY");
    const v = await env.DB.prepare("SELECT version FROM record_version WHERE entity='tasks' AND record_id='task_1'").first<{ version: number }>();
    expect(v!.version).toBe(1);
    if (committed.status === "APPLIED" && retried.status === "REPLAY") expect(retried.version).toBe(committed.version);
  });

  /**
   * Deletion is a tombstone, never an absence.
   *
   * A row that simply vanishes is indistinguishable from a row that never arrived, so the other
   * device re-creates it on the next pull and the deletion undoes itself — quietly, and for ever.
   * The tombstone is the difference between "gone" and "never here".
   */
  it("carries a deletion as a tombstone the other side can see", async () => {
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ recordId: "doomed" })));
    const gone = await commitMutation(env.DB, await prepareMutation(env.DB, mut({ recordId: "doomed", baseVersion: 1, tombstone: true })));
    expect(gone.status).toBe("APPLIED");

    const rv = await env.DB.prepare("SELECT version, tombstone FROM record_version WHERE entity='tasks' AND record_id='doomed'").first<{ version: number; tombstone: number }>();
    expect(rv!.version).toBe(2);
    expect(rv!.tombstone).toBe(1);

    // It travels: a puller learns the record was deleted rather than never hearing of it again.
    const page = await pull(env.DB, CLOUD, 0, 100);
    const last = page.rows.filter((r: any) => r.record_id === "doomed").pop();
    expect(last.tombstone).toBe(1);
  });

  it("a tombstoned record can still be edited afterwards, and the version keeps moving", async () => {
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ recordId: "back" })));
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ recordId: "back", baseVersion: 1, tombstone: true })));
    // Undeleting is an ordinary mutation from the tombstone's version, not a special case — which
    // is what stops "restore a deleted thing" needing a second code path nobody tests.
    const back = await commitMutation(env.DB, await prepareMutation(env.DB, mut({ recordId: "back", baseVersion: 2, tombstone: false })));
    expect(back.status).toBe("APPLIED");
    const rv = await env.DB.prepare("SELECT version, tombstone FROM record_version WHERE entity='tasks' AND record_id='back'").first<{ version: number; tombstone: number }>();
    expect(rv!.version).toBe(3);
    expect(rv!.tombstone).toBe(0);
  });

  it("registering the replacement machine is a row, not a migration", async () => {
    await revokeDevice(env.DB, MAC, "upgraded");
    await registerDevice(env.DB, { deviceId: "dev_private_the_real_one", kind: "private", label: "The laptop she actually wanted" });
    const out = await commitMutation(env.DB, await prepareMutation(env.DB, mut({ deviceId: "dev_private_the_real_one" })));
    expect(out.status).toBe("APPLIED");
  });
});
