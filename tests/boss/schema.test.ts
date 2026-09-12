import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_TABLES } from "../../src/worker/boss/routes/vault";
import { CHASSIS_TABLES, CHASSIS_TABLE_CEILING } from "./chassisTables";
import { LOCAL_DEFAULT_MIN_BENCHMARKS } from "../../src/worker/boss/router/policy";

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
  it("covers every Boss table except the vault's own journals", async () => {
    const rows = await env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'`)
      .all<{ name: string }>();
    const all = rows.results.map((r) => r.name);
    // An empty read would make every assertion below vacuously true.
    expect(all.length).toBeGreaterThan(0);

    const chassis = new Set<string>(CHASSIS_TABLES);
    const covered = new Set<string>(SNAPSHOT_TABLES);
    const uncoveredBoss = all.filter((n) => !chassis.has(n) && !covered.has(n)).sort();

    // The original invariant, unweakened, over the tables Boss OS owns.
    expect(uncoveredBoss).toEqual(["vault_restores", "vault_snapshots"]);
  });

  /**
   * The ratchet. Cloning the chassis put West Peek's tables in this database, outside the vault's
   * snapshot list. That is recorded rather than excused: the count may fall as the fund domain is
   * removed, and this fails the moment it rises.
   */
  it("carries no more West Peek tables than it did at the port", async () => {
    const rows = await env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'`)
      .all<{ name: string }>();
    const chassis = new Set<string>(CHASSIS_TABLES);
    const present = rows.results.map((r) => r.name).filter((n) => chassis.has(n));
    expect(present.length).toBeGreaterThan(0);
    expect(present.length).toBeLessThanOrEqual(CHASSIS_TABLE_CEILING);
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

  /**
   * WAS: "registers no model as benchmarked, because none has been benchmarked."
   *
   * That was true until 0231, and it was asserting the FACT rather than the RULE. Migration 0231
   * promotes `mdl_cf_llama33_70b` on six operator-scored `approved` verdicts across six distinct
   * workloads, with an approved card, because every model the router could reach was cleared to
   * `low` risk and so every `medium` task — most of her mail-driven work — failed before it started.
   *
   * The rule is what mattered and it is pinned here instead: `benchmark_status = 'benchmarked'` is
   * the column the router's high-risk gate trusts, so it may never be set on a model that has not
   * earned it. A count of zero would go green again the day somebody deleted the evidence.
   */
  it("marks a model benchmarked only on enough approved benchmarks to earn it", async () => {
    const marked = await env.DB
      .prepare(`SELECT id, display_name FROM models WHERE benchmark_status = 'benchmarked'`)
      .all<{ id: string; display_name: string }>();

    for (const m of marked.results ?? []) {
      const n = await env.DB
        .prepare(
          `SELECT COUNT(DISTINCT workload_id) AS n FROM model_benchmarks
            WHERE model_id = ? AND verdict = 'approved'`,
        )
        .bind(m.id)
        .first<{ n: number }>();
      expect(
        n!.n,
        `${m.display_name} is marked benchmarked on ${n!.n} approved workload(s)`,
      ).toBeGreaterThanOrEqual(LOCAL_DEFAULT_MIN_BENCHMARKS);
    }
  });

  /**
   * And the clearance the same migration raises: above `low` needs evidence AND an approved card.
   * §3.1, as `router/index.ts` states it — "a promotion needs benchmark evidence and an approved
   * card, not a quiet UPDATE by whoever hit the wall first."
   */
  it("clears no model above low risk without approved benchmarks and an approved card", async () => {
    const promoted = await env.DB
      .prepare(`SELECT id, display_name, max_risk FROM models WHERE max_risk <> 'low'`)
      .all<{ id: string; display_name: string; max_risk: string }>();

    for (const m of promoted.results ?? []) {
      expect(m.max_risk, `${m.display_name} is cleared to high risk by a migration`).toBe("medium");

      const n = await env.DB
        .prepare(
          `SELECT COUNT(DISTINCT workload_id) AS n FROM model_benchmarks
            WHERE model_id = ? AND verdict = 'approved'`,
        )
        .bind(m.id)
        .first<{ n: number }>();
      expect(n!.n, `${m.display_name} is cleared to ${m.max_risk} on ${n!.n} approved workload(s)`)
        .toBeGreaterThanOrEqual(LOCAL_DEFAULT_MIN_BENCHMARKS);

      const card = await env.DB
        .prepare(
          `SELECT id FROM approvals
            WHERE kind = 'model_promotion' AND status = 'approved'
              AND payload LIKE ? AND payload LIKE ? AND payload LIKE ?`,
        )
        .bind(`%"model_id":"${m.id}"%`, `%"change":"max_risk"%`, `%"to":"${m.max_risk}"%`)
        .first<{ id: string }>();
      expect(card?.id, `${m.display_name} is cleared to ${m.max_risk} with no approved card`).toBeTruthy();
    }
  });
});
