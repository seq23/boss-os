import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_TABLES } from "../../src/worker/boss/routes/vault";

describe("schema", () => {
  it("applies every migration and seeds both lanes", async () => {
    const lanes = await env.DB.prepare(`SELECT id, isolated FROM lanes ORDER BY id`).all<{ id: string; isolated: number }>();
    expect(lanes.results.map((l) => l.id)).toEqual(["ops", "trading"]);
    expect(lanes.results.find((l) => l.id === "trading")?.isolated).toBe(1);
  });

  it("keeps every snapshot table real, so continuity covers the whole system", async () => {
    const rows = await env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all<{ name: string }>();
    const existing = new Set(rows.results.map((r) => r.name));
    const missing = SNAPSHOT_TABLES.filter((t) => !existing.has(t));
    expect(missing).toEqual([]);
  });

  /**
   * Continuity is only as good as its coverage. A table added by a future
   * migration and forgotten here would silently not survive a rebuild, so the
   * only permitted omissions are the vault's own journals: a snapshot cannot
   * contain its own record, and restore history must outlive a restore.
   */
  it("covers every table except the vault's own journals", async () => {
    const rows = await env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'`)
      .all<{ name: string }>();
    const covered = new Set<string>(SNAPSHOT_TABLES);
    const uncovered = rows.results.map((r) => r.name).filter((n) => !covered.has(n)).sort();
    expect(uncovered).toEqual(["vault_restores", "vault_snapshots"]);
  });

  it("seeds the trading authority denied by default", async () => {
    const auth = await env.DB
      .prepare(`SELECT live_enabled, kill_switch, human_approval_recorded FROM trading_authority`)
      .first<{ live_enabled: number; kill_switch: number; human_approval_recorded: number }>();
    expect(auth?.live_enabled).toBe(0);
    expect(auth?.human_approval_recorded).toBe(0);
  });

  it("seeds the workload placement matrix with at least five scored workloads", async () => {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM workload_profiles`).first<{ n: number }>();
    expect(row!.n).toBeGreaterThanOrEqual(5);
  });

  it("seeds the seven task templates the roadmap requires", async () => {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM task_templates WHERE enabled = 1`).first<{ n: number }>();
    expect(row!.n).toBeGreaterThanOrEqual(7);
  });

  it("registers no model as benchmarked, because none has been benchmarked", async () => {
    const row = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM models WHERE benchmark_status = 'benchmarked'`)
      .first<{ n: number }>();
    expect(row!.n).toBe(0);
  });
});
