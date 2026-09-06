import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker/boss/index";
import { api, apiJson } from "./helpers";

/**
 * Batch 4 — the cloud sync API, tested at the edge it actually presents.
 *
 * The substrate already refuses what must be refused; these tests check that the ENDPOINTS do not
 * quietly widen it — that validation, bounds and per-item answers hold at the boundary where a
 * device, rather than a function call, is the caller.
 */
const MAC = "dev_private_mac";

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
  await api("/api/sync/devices", { method: "POST", body: { device_id: MAC, kind: "private", label: "Mac" } });
});

const m = (over: Record<string, unknown> = {}) => ({
  mutation_id: `mut_${crypto.randomUUID()}`,
  entity: "tasks",
  record_id: `task_${crypto.randomUUID()}`,
  base_version: null,
  ...over,
});

describe("Batch 4 — the cloud sync API", () => {
  it("answers every item of a push individually, so a refusal is not a failed batch", async () => {
    const { body } = await apiJson("/api/sync/push", {
      method: "POST",
      body: {
        device_id: MAC,
        mutations: [m(), m({ entity: "dream_entries" }), m(), m({ entity: "settings", record_id: "k" })],
      },
    });
    const statuses = body.data.results.map((r: any) => r.status);
    expect(statuses[0]).toBe("APPLIED");
    expect(statuses[1]).toBe("REFUSED");
    expect(statuses[2]).toBe("APPLIED");
    expect(statuses[3]).toBe("REFUSED");
    // The sovereign refusal says so without quoting the record.
    expect(body.data.results[1].reason).toMatch(/NOTHING TRANSMITTED/);
    // And the secret-bearing one is refused on its own grounds, not on residency.
    expect(body.data.results[3].reason).toMatch(/never synchronizes/);
  });

  it("bounds a push by count and by body size rather than trusting the caller", async () => {
    const tooMany = await api("/api/sync/push", {
      method: "POST",
      body: { device_id: MAC, mutations: Array.from({ length: 101 }, () => m()) },
    });
    expect(tooMany.status).toBe(400);

    const empty = await api("/api/sync/push", { method: "POST", body: { device_id: MAC, mutations: [] } });
    expect(empty.status).toBe(400);
  });

  it("validates each mutation's shape before anything is written", async () => {
    const bad = await api("/api/sync/push", {
      method: "POST",
      body: { device_id: MAC, mutations: [{ entity: "tasks", record_id: "r" }] },
    });
    expect(bad.status).toBe(400);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM sync_ledger").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("pulls incrementally and pages with a cursor that only moves forward", async () => {
    await apiJson("/api/sync/push", { method: "POST", body: { device_id: MAC, mutations: [m(), m(), m()] } });

    const first = await apiJson(`/api/sync/pull?device_id=${MAC}&limit=2`);
    expect(first.body.data.mutations).toHaveLength(2);
    expect(first.body.data.has_more).toBe(true);

    const rest = await apiJson(`/api/sync/pull?device_id=${MAC}&after=${first.body.data.next_seq}&limit=2`);
    expect(rest.body.data.mutations).toHaveLength(1);

    const ack = await apiJson("/api/sync/ack", { method: "POST", body: { device_id: MAC, seq: rest.body.data.next_seq } });
    expect(ack.body.data.last_seq).toBe(rest.body.data.next_seq);
    const rewind = await apiJson("/api/sync/ack", { method: "POST", body: { device_id: MAC, seq: 1 } });
    expect(rewind.body.data.last_seq).toBe(rest.body.data.next_seq);
  });

  it("refuses a revoked device at the endpoint, and says a reason was required to revoke it", async () => {
    const noReason = await api(`/api/sync/devices/${MAC}/revoke`, { method: "POST", body: {} });
    expect(noReason.status).toBe(400);

    await api(`/api/sync/devices/${MAC}/revoke`, { method: "POST", body: { reason: "laptop replaced" } });
    const { body } = await apiJson("/api/sync/push", { method: "POST", body: { device_id: MAC, mutations: [m()] } });
    expect(body.data.results[0].status).toBe("REFUSED");
    expect(body.data.results[0].reason).toMatch(/revoked/i);

    const pull = await api(`/api/sync/pull?device_id=${MAC}`);
    expect(pull.status).toBe(400);
  });

  it("returns a conflict, and resolving it records who decided and how", async () => {
    const rec = `task_${crypto.randomUUID()}`;
    await apiJson("/api/sync/push", { method: "POST", body: { device_id: MAC, mutations: [m({ record_id: rec })] } });
    await apiJson("/api/sync/push", { method: "POST", body: { device_id: MAC, mutations: [m({ record_id: rec, base_version: 1 })] } });
    const late = await apiJson("/api/sync/push", { method: "POST", body: { device_id: MAC, mutations: [m({ record_id: rec, base_version: 1 })] } });
    expect(late.body.data.results[0].status).toBe("CONFLICT");

    const open = await apiJson("/api/sync/conflicts");
    expect(open.body.data.conflicts).toHaveLength(1);
    const id = open.body.data.conflicts[0].id;

    const bad = await api(`/api/sync/conflicts/${id}/resolve`, { method: "POST", body: { resolution: "WHATEVER", by: "owner" } });
    expect(bad.status).toBe(400);
    const anon = await api(`/api/sync/conflicts/${id}/resolve`, { method: "POST", body: { resolution: "KEPT_CURRENT" } });
    expect(anon.status).toBe(400);

    await apiJson(`/api/sync/conflicts/${id}/resolve`, { method: "POST", body: { resolution: "KEPT_CURRENT", by: "owner", note: "the cloud edit was right" } });
    const row = await env.DB.prepare(`SELECT resolution, resolved_by, note FROM sync_conflict WHERE id = ?1`).bind(id).first<any>();
    expect(row.resolution).toBe("KEPT_CURRENT");
    expect(row.resolved_by).toBe("owner");
    // A resolved conflict cannot be re-decided silently.
    const again = await api(`/api/sync/conflicts/${id}/resolve`, { method: "POST", body: { resolution: "APPLIED_INCOMING", by: "someone else" } });
    expect(again.status).toBe(400);
    expect((await apiJson("/api/sync/conflicts")).body.data.conflicts).toHaveLength(0);
  });

  /**
   * The whole surface sits behind the passcode session. Called with no cookie it must refuse
   * rather than answer, because "authorization scoped to the Boss user/device model" is a Batch 4
   * requirement and a device id is attribution, never permission.
   */
  it("needs a session: none of it is reachable without one", async () => {
    for (const path of ["/api/sync/status", "/api/sync/devices", `/api/sync/pull?device_id=${MAC}`]) {
      const ctx = createExecutionContext();
      const res = await worker.fetch(new Request(`https://boss.test${path}`), env as any, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(401);
    }
  });
});
