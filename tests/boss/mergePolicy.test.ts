import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prepareMutation, commitMutation, registerDevice, SyncRefusal } from "../../src/worker/boss/sync/ledger";
import { api, apiJson } from "./helpers";

/**
 * Batch 6 — entity-specific merge policy.
 *
 * The plan's list, one test each: append-only merges, immutable preserves both, mutable records
 * conflict on version, decisions and capital never resolve automatically, derived state is not
 * reconciled at all. And the requirement people skip — a resolution is itself a mutation, because
 * a decision the other side cannot learn about is not a resolution.
 */
const DEV = "dev_merge";

beforeAll(async () => {
  await applyD1Migrations(env.DB, (env as any).TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sync_ledger"),
    env.DB.prepare("DELETE FROM record_version"),
    env.DB.prepare("DELETE FROM sync_conflict"),
    env.DB.prepare("DELETE FROM sync_device"),
  ]);
  await registerDevice(env.DB, { deviceId: DEV, kind: "private", label: "merge" });
});

const mut = (over: Record<string, unknown> = {}) =>
  ({ mutationId: `mut_${crypto.randomUUID()}`, entity: "tasks", recordId: "r1", baseVersion: null as number | null, deviceId: DEV, ...over }) as any;

describe("Batch 6 — merge policy per entity", () => {
  it("APPEND_ONLY merges a stale base instead of conflicting", async () => {
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ entity: "audit_log", recordId: "a1" })));
    // A second device that never saw the first row is not disagreeing about anything.
    const out = await commitMutation(env.DB, await prepareMutation(env.DB, mut({ entity: "audit_log", recordId: "a1", baseVersion: 0 })));
    expect(out.status).toBe("MERGED");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sync_conflict").first<{ n: number }>()).toMatchObject({ n: 0 });
  });

  it("IMMUTABLE treats an identical rewrite as a no-op and a different one as a conflict", async () => {
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ entity: "evidence_packets", recordId: "e1", payloadHash: "sha-A" })));

    const same = await commitMutation(env.DB, await prepareMutation(env.DB, mut({ entity: "evidence_packets", recordId: "e1", payloadHash: "sha-A" })));
    expect(same.status).toBe("NOOP");

    const different = await commitMutation(env.DB, await prepareMutation(env.DB, mut({ entity: "evidence_packets", recordId: "e1", payloadHash: "sha-B" })));
    expect(different.status).toBe("CONFLICT");
    // Both survive: the original version is untouched, and the disagreement is on the record.
    const v = await env.DB.prepare("SELECT version FROM record_version WHERE entity='evidence_packets' AND record_id='e1'").first<{ version: number }>();
    expect(v!.version).toBe(1);
  });

  it("VERSIONED still conflicts on a stale base", async () => {
    await commitMutation(env.DB, await prepareMutation(env.DB, mut()));
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ baseVersion: 1 })));
    const late = await commitMutation(env.DB, await prepareMutation(env.DB, mut({ baseVersion: 1 })));
    expect(late.status).toBe("CONFLICT");
    if (late.status === "CONFLICT") expect(late.mergePolicy).toBe("VERSIONED");
  });

  it("REGENERATE refuses to synchronize at all", async () => {
    await expect(prepareMutation(env.DB, mut({ entity: "astro_days", recordId: "2026-09-06" }))).rejects.toThrow(SyncRefusal);
  });

  it("NEVER_AUTOMATIC offers only a hand merge, and the server enforces it", async () => {
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ entity: "capital_allocations", recordId: "c1" })));
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ entity: "capital_allocations", recordId: "c1", baseVersion: 1 })));
    const late = await commitMutation(env.DB, await prepareMutation(env.DB, mut({ entity: "capital_allocations", recordId: "c1", baseVersion: 1 })));
    expect(late.status).toBe("CONFLICT");

    const inbox = await apiJson("/api/sync/conflicts");
    const row = inbox.body.data.conflicts.find((x: any) => x.entity === "capital_allocations");
    expect(row.merge_policy).toBe("NEVER_AUTOMATIC");
    expect(row.safe_actions).toEqual(["MERGED_BY_HAND"]);
    expect(row.reason).toMatch(/already moved to/);

    // The rule is not a UI convention: the endpoint refuses the automatic resolutions outright.
    const auto = await api(`/api/sync/conflicts/${row.id}/resolve`, { method: "POST", body: { resolution: "APPLIED_INCOMING", by: "owner" } });
    expect(auto.status).toBe(400);
    const byHand = await api(`/api/sync/conflicts/${row.id}/resolve`, { method: "POST", body: { resolution: "MERGED_BY_HAND", by: "owner", note: "reconciled" } });
    expect(byHand.status).toBe(200);
  });

  /**
   * A decision the other side cannot learn about is not a resolution: it re-bases on a version
   * nobody agreed to and conflicts again, for ever.
   */
  it("records the resolution as a mutation, so every device learns the agreed version", async () => {
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ recordId: "r9" })));
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ recordId: "r9", baseVersion: 1 })));
    await commitMutation(env.DB, await prepareMutation(env.DB, mut({ recordId: "r9", baseVersion: 1 })));

    const inbox = await apiJson("/api/sync/conflicts");
    const id = inbox.body.data.conflicts[0].id;
    const before = await env.DB.prepare("SELECT version FROM record_version WHERE entity='tasks' AND record_id='r9'").first<{ version: number }>();

    const { body } = await apiJson(`/api/sync/conflicts/${id}/resolve`, { method: "POST", body: { resolution: "KEPT_CURRENT", by: "owner" } });
    expect(body.data.version).toBe(before!.version + 1);

    const led = await env.DB.prepare(`SELECT device_id, result_version FROM sync_ledger WHERE mutation_id = ?1`).bind(`mut_resolve_${id}`).first<any>();
    expect(led.device_id).toBe("resolution");
    expect(led.result_version).toBe(before!.version + 1);
    // And it is pullable like anything else, which is the only way the other side hears about it.
    const pulled = await apiJson(`/api/sync/pull?device_id=${DEV}`);
    expect(pulled.body.data.mutations.some((r: any) => r.mutation_id === `mut_resolve_${id}`)).toBe(true);
  });
});
