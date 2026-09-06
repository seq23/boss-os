import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DAY_MS,
  HOUR_MS,
  MAINTENANCE_HOUR_UTC,
  SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_KEEP,
  maintenanceDue,
  maintenanceWindowOpensAt,
  snapshotDue,
} from "../../src/worker/boss/cron/cadence";
import { runScheduled } from "../../src/worker/boss/index";
import { takeSnapshot, pruneSnapshots } from "../../src/worker/boss/routes/vault";
import { all, insertMemory, row } from "./helpers";

/**
 * THE REGRESSION THIS SUITE EXISTS FOR.
 *
 * The Boss maintenance run was wired to a quarter-hourly cron with no guard and produced 62
 * snapshots in under fifteen hours in production, on an empty database, with no retention. These
 * tests fail if any part of that becomes possible again.
 *
 * Every one of them is written to fail for the right reason: the negative cases assert that the
 * guard REFUSES, not merely that the happy path works. A cadence guard that never says no is the
 * defect, not the fix.
 */

const day = (n: number) => n * DAY_MS;

describe("cron cadence — the guard that was missing", () => {
  describe("daily maintenance window", () => {
    it("refuses before the documented hour, on a day that has not run", () => {
      const midnight = day(20_000);
      expect(maintenanceDue(midnight, null)).toBe(false);
      expect(maintenanceDue(midnight + 2 * HOUR_MS + 59 * 60_000, null)).toBe(false);
    });

    it("is due on the first tick at or after 03:00 UTC", () => {
      const opensAt = day(20_000) + MAINTENANCE_HOUR_UTC * HOUR_MS;
      expect(maintenanceDue(opensAt, null)).toBe(true);
      expect(maintenanceDue(opensAt + 60_000, null)).toBe(true);
    });

    it("refuses every remaining tick of the day once one run has started", () => {
      const opensAt = day(20_000) + MAINTENANCE_HOUR_UTC * HOUR_MS;
      // 96 ticks a day is what actually happened. Walk all of them.
      let allowed = 0;
      let lastStartedAt: number | null = null;
      for (let tick = 0; tick < 96; tick++) {
        const now = day(20_000) + tick * 15 * 60_000;
        if (maintenanceDue(now, lastStartedAt)) {
          allowed += 1;
          lastStartedAt = now;
        }
      }
      expect(allowed).toBe(1);
      expect(lastStartedAt).toBe(opensAt);
    });

    it("runs again the next day rather than drifting later each time", () => {
      const ranAt = day(20_000) + MAINTENANCE_HOUR_UTC * HOUR_MS + 47 * 60_000;
      const nextOpensAt = maintenanceWindowOpensAt(ranAt + DAY_MS);
      expect(maintenanceDue(nextOpensAt - 1, ranAt)).toBe(false);
      expect(maintenanceDue(nextOpensAt, ranAt)).toBe(true);
      // Anchored to the hour, not to "24h after the last run" — otherwise 47 minutes of drift
      // compounds into a run that wanders through the day.
      expect(nextOpensAt).toBe(day(20_001) + MAINTENANCE_HOUR_UTC * HOUR_MS);
    });

    it("still runs after a missed day rather than skipping it silently", () => {
      const ranAt = day(20_000) + MAINTENANCE_HOUR_UTC * HOUR_MS;
      const twoDaysLater = day(20_002) + MAINTENANCE_HOUR_UTC * HOUR_MS + 6 * HOUR_MS;
      expect(maintenanceDue(twoDaysLater, ranAt)).toBe(true);
    });
  });

  describe("weekly snapshot interval", () => {
    it("is due when none has ever completed", () => {
      expect(snapshotDue(day(20_000), null)).toBe(true);
    });

    it("refuses every day of the week in between", () => {
      const taken = day(20_000);
      for (let d = 0; d < 7; d++) {
        expect(snapshotDue(taken + day(d) + HOUR_MS, taken)).toBe(false);
      }
      expect(snapshotDue(taken + SNAPSHOT_INTERVAL_MS, taken)).toBe(true);
    });

    it("produces at most one snapshot a week across a simulated month of daily runs", () => {
      let last: number | null = null;
      let taken = 0;
      for (let d = 0; d < 28; d++) {
        const now = day(20_000) + day(d) + MAINTENANCE_HOUR_UTC * HOUR_MS;
        if (snapshotDue(now, last)) {
          taken += 1;
          last = now;
        }
      }
      expect(taken).toBe(4);
    });
  });
});

describe("snapshot retention and unchanged-detection", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM vault_snapshots`).run();
  });

  it("skips a due snapshot when nothing of substance changed, and says why", async () => {
    const first = await takeSnapshot(env, "weekly", { skipIfUnchanged: true });
    expect("skipped" in first && first.skipped).toBeFalsy();

    const second = await takeSnapshot(env, "weekly", { skipIfUnchanged: true });
    expect("skipped" in second && second.skipped).toBe(true);
    expect((second as any).reason).toBe("unchanged");
    expect((second as any).matches).toBe(first.id);

    const stored = await row<{ status: string; r2_key: string | null }>(
      `SELECT status, r2_key FROM vault_snapshots WHERE id = ?`,
      second.id,
    );
    expect(stored?.status).toBe("skipped");
    // The whole point: a skip writes no object.
    expect(stored?.r2_key).toBeNull();
  });

  it("does NOT skip when real state changed — the negative case that makes the check worth having", async () => {
    await takeSnapshot(env, "weekly", { skipIfUnchanged: true });

    await insertMemory({ id: "mem_cadence_probe", title: "cadence probe" });

    const after = await takeSnapshot(env, "weekly", { skipIfUnchanged: true });
    expect("skipped" in after && after.skipped).toBeFalsy();
    expect((after as any).bytes).toBeGreaterThan(0);
  });

  it("treats diagnostic churn as no change — the loop that justified snapshotting forever", async () => {
    await takeSnapshot(env, "weekly", { skipIfUnchanged: true });

    // Exactly what the maintenance run itself writes on every pass.
    await env.DB
      .prepare(
        `INSERT INTO system_events (id, ts, level, scope, event, detail)
         VALUES ('evt_churn_probe', ?, 'info', 'cron', 'probe', '{}')`,
      )
      .bind(Date.now())
      .run();
    await env.DB
      .prepare(`INSERT INTO cron_runs (id, started_at, status) VALUES ('crn_churn_probe', ?, 'complete')`)
      .bind(Date.now())
      .run();

    const after = await takeSnapshot(env, "weekly", { skipIfUnchanged: true });
    expect("skipped" in after && after.skipped).toBe(true);
  });

  it("prunes down to the retention floor and never removes the newest", async () => {
    const made: string[] = [];
    for (let i = 0; i < SNAPSHOT_KEEP + 3; i++) {
      // skipIfUnchanged deliberately off: retention must be tested on real objects.
      const s = await takeSnapshot(env, `retention-${i}`);
      made.push(s.id);
    }

    const result = await pruneSnapshots(env);
    expect(result.deleted).toBe(3);
    expect(result.failures).toEqual([]);

    const live = await all<{ id: string }>(
      `SELECT id FROM vault_snapshots WHERE status = 'complete' ORDER BY ts DESC`,
    );
    expect(live.length).toBe(SNAPSHOT_KEEP);
    expect(live.map((r) => r.id)).toContain(made[made.length - 1]);

    const pruned = await all<{ id: string; r2_key: string | null; pruned_at: number | null }>(
      `SELECT id, r2_key, pruned_at FROM vault_snapshots WHERE status = 'pruned'`,
    );
    expect(pruned.length).toBe(3);
    // The row outlives the object, so vault history stays readable.
    for (const p of pruned) {
      expect(p.r2_key).toBeNull();
      expect(p.pruned_at).toBeGreaterThan(0);
    }
  });

  it("refuses to empty the vault even when asked to keep nothing", async () => {
    await takeSnapshot(env, "floor-a");
    await takeSnapshot(env, "floor-b");

    const result = await pruneSnapshots(env, 0);
    const live = await all<{ id: string }>(`SELECT id FROM vault_snapshots WHERE status = 'complete'`);
    expect(result.kept).toBe(1);
    expect(live.length).toBe(1);
  });
});

describe("runScheduled — end to end on a quarter-hourly tick", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM cron_runs`).run();
    await env.DB.prepare(`DELETE FROM vault_snapshots`).run();
  });

  it("runs once and then refuses for the rest of the day", async () => {
    const base = day(20_100) + MAINTENANCE_HOUR_UTC * HOUR_MS;

    const first = await runScheduled(env as any, base);
    expect(first.ran).toBe(true);

    let refused = 0;
    for (let tick = 1; tick <= 20; tick++) {
      const outcome = await runScheduled(env as any, base + tick * 15 * 60_000);
      if (!outcome.ran) refused += 1;
    }
    expect(refused).toBe(20);

    const runs = await all<{ id: string }>(`SELECT id FROM cron_runs`);
    expect(runs.length).toBe(1);
  });

  it("records the snapshot decision as a step rather than leaving it absent", async () => {
    const base = day(20_200) + MAINTENANCE_HOUR_UTC * HOUR_MS;
    await runScheduled(env as any, base);

    const run = await row<{ steps: string }>(`SELECT steps FROM cron_runs ORDER BY started_at DESC LIMIT 1`);
    const steps = JSON.parse(run!.steps) as { name: string; status: string }[];
    const names = steps.map((s) => s.name);

    expect(names).toContain("snapshot");
    expect(names).toContain("prune_snapshots");
    // "No snapshot because not due" and "no snapshot" are different claims; only the first is
    // trustworthy, so every step is present with a status even when it did nothing.
    expect(steps.every((s) => s.status === "ok")).toBe(true);
  });

  it("takes one snapshot in a simulated fortnight of daily runs, not fourteen", async () => {
    const start = day(20_300) + MAINTENANCE_HOUR_UTC * HOUR_MS;
    for (let d = 0; d < 14; d++) {
      await runScheduled(env as any, start + day(d));
    }

    const runs = await all<{ id: string }>(`SELECT id FROM cron_runs`);
    expect(runs.length).toBe(14);

    const written = await all<{ id: string }>(
      `SELECT id FROM vault_snapshots WHERE status = 'complete'`,
    );
    // Day 0 and day 7 are due; day 7 is then skipped as unchanged if nothing moved, so the
    // honest assertion is "at most two, and far fewer than fourteen".
    expect(written.length).toBeLessThanOrEqual(2);
    expect(written.length).toBeGreaterThanOrEqual(1);
  });
});
