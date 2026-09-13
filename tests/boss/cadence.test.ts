import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DAY_MS,
  HOUR_MS,
  MAINTENANCE_HOUR_UTC,
  QUARTER_MS,
  SNAPSHOT_HOUR_LOCAL,
  SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_KEEP,
  maintenanceDue,
  maintenanceWindowOpensAt,
  snapshotDue,
  snapshotWindowOpensAt,
} from "../../src/worker/boss/cron/cadence";
import { zonedTime } from "../../src/shared/boss/timezone";
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

  /**
   * THE DAILY END-OF-DAY SNAPSHOT WINDOW — her instruction of 13 Sep 2026.
   *
   * These replace the weekly-interval tests. Every one of them is written against the DEFECT the
   * window shape exists to prevent: a rolling `now - last >= INTERVAL` test drifts earlier every
   * day until the day's backup is taken in the middle of the day it is supposed to be recording.
   */
  describe("daily snapshot window, on her clock", () => {
    /** 20:00 Central on a given civil date, as a UTC instant. */
    const evening = (y: number, m: number, d: number, hour = SNAPSHOT_HOUR_LOCAL) =>
      zonedTime(y, m, d, hour);

    it("is due when none has ever completed, but only once the window has opened", () => {
      // Mid-afternoon on her clock: the day is not over, so there is nothing to record yet.
      expect(snapshotDue(evening(2026, 9, 13, 15), null)).toBe(false);
      expect(snapshotDue(evening(2026, 9, 13), null)).toBe(true);
    });

    it("refuses every remaining tick of the evening once one has completed inside the window", () => {
      const opensAt = evening(2026, 9, 13);
      const taken = opensAt + 4 * 60_000;
      for (let h = 0; h < 4; h++) {
        expect(snapshotDue(opensAt + h * HOUR_MS + 30 * 60_000, taken)).toBe(false);
      }
    });

    it("opens again the next evening rather than drifting later each day", () => {
      const takenLate = evening(2026, 9, 13) + 47 * 60_000;
      const nextOpensAt = evening(2026, 9, 14);
      expect(snapshotDue(nextOpensAt - 1, takenLate)).toBe(false);
      expect(snapshotDue(nextOpensAt, takenLate)).toBe(true);
      // The 47 minutes do not compound. Under the old rolling interval they would have, and after
      // a fortnight the "end of day" snapshot would be firing at lunchtime.
      expect(nextOpensAt - evening(2026, 9, 13)).toBe(DAY_MS);
    });

    it("still runs after a missed evening rather than skipping it in silence", () => {
      const taken = evening(2026, 9, 13);
      expect(snapshotDue(evening(2026, 9, 15) + 2 * HOUR_MS, taken)).toBe(true);
    });

    it("holds 20:00 local across the DST boundary instead of sliding an hour", () => {
      // CDT (UTC-5) in September, CST (UTC-6) in December. The wall clock is the invariant.
      const septOffset = evening(2026, 9, 13) % DAY_MS;
      const decOffset = evening(2026, 12, 13) % DAY_MS;
      expect(decOffset - septOffset).toBe(HOUR_MS);
      expect(snapshotDue(evening(2026, 12, 13, 19), null)).toBe(false);
      expect(snapshotDue(evening(2026, 12, 13), null)).toBe(true);
    });

    /**
     * THE COUPLING THAT COSTS BACKUPS IF SOMEONE MOVES THE HOUR LATER.
     *
     * The snapshot step runs inside `runScheduled`, which is itself gated to one pass a day at
     * 03:00 UTC. If the window opens AFTER that pass, the snapshot waits another 24 hours and the
     * cadence silently halves. The margin must be positive in BOTH offsets, so this fails loudly
     * rather than quietly costing a copy a day.
     */
    it("opens before the maintenance pass that evaluates it, in both DST offsets", () => {
      for (const [y, m, d] of [[2026, 9, 14], [2026, 12, 14]] as const) {
        const maintenanceAt = day(Math.floor(zonedTime(y, m, d, 12) / DAY_MS)) + MAINTENANCE_HOUR_UTC * HOUR_MS;
        const opensAt = snapshotWindowOpensAt(maintenanceAt);
        expect(maintenanceAt - opensAt).toBeGreaterThan(0);
      }
    });

    it("produces exactly one snapshot a day across a simulated month of maintenance passes", () => {
      let last: number | null = null;
      let taken = 0;
      for (let d = 0; d < 28; d++) {
        const now = day(20_000) + day(d) + MAINTENANCE_HOUR_UTC * HOUR_MS;
        if (snapshotDue(now, last)) {
          taken += 1;
          last = now;
        }
      }
      expect(taken).toBe(28);
    });

    it("produces one a day, not one an hour, across every tick of the hourly cron", () => {
      let last: number | null = null;
      let taken = 0;
      for (let h = 0; h < 24 * 7; h++) {
        const now = day(20_000) + h * HOUR_MS;
        if (snapshotDue(now, last)) {
          taken += 1;
          last = now;
        }
      }
      expect(taken).toBe(7);
    });
  });

  /**
   * RETENTION MUST MOVE WITH THE CADENCE. This is the invariant the constants exist to satisfy and
   * it is pinned here as well as in `scripts/validate/retention-outlasts-the-checklist.mjs`: the
   * copies on hand must reach back at least as far as the window RESTORE_CHECKLIST.md asks about.
   * Leaving KEEP at 12 when the cadence went daily would have cut coverage to twelve days.
   */
  describe("retention outlasts the checklist's own question", () => {
    it("keeps at least a quarter of history on hand", () => {
      expect(SNAPSHOT_KEEP * SNAPSHOT_INTERVAL_MS).toBeGreaterThanOrEqual(QUARTER_MS);
    });
  });
});

describe("snapshot retention and unchanged-detection", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM vault_snapshots`).run();
  });

  it("skips a due snapshot when nothing of substance changed, and says why", async () => {
    const first = await takeSnapshot(env, "daily", { skipIfUnchanged: true });
    expect("skipped" in first && first.skipped).toBeFalsy();

    const second = await takeSnapshot(env, "daily", { skipIfUnchanged: true });
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
    await takeSnapshot(env, "daily", { skipIfUnchanged: true });

    await insertMemory({ id: "mem_cadence_probe", title: "cadence probe" });

    const after = await takeSnapshot(env, "daily", { skipIfUnchanged: true });
    expect("skipped" in after && after.skipped).toBeFalsy();
    expect((after as any).bytes).toBeGreaterThan(0);
  });

  it("treats diagnostic churn as no change — the loop that justified snapshotting forever", async () => {
    await takeSnapshot(env, "daily", { skipIfUnchanged: true });

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

    const after = await takeSnapshot(env, "daily", { skipIfUnchanged: true });
    expect("skipped" in after && after.skipped).toBe(true);
  });

  /**
   * A SMALL EXPLICIT `keep` RATHER THAN `SNAPSHOT_KEEP + 3`.
   *
   * Retention is now 90, and writing 93 real snapshots to R2 to prove an ordering rule would turn a
   * fast test into a slow one for nothing — the behaviour under test is "keep the newest N, prune
   * the rest", and N is a parameter. The value of SNAPSHOT_KEEP itself is pinned by the invariant
   * test above and by `validate:retention-outlasts-checklist`, which is where it belongs.
   */
  it("prunes down to the retention floor and never removes the newest", async () => {
    const keep = 3;
    const made: string[] = [];
    for (let i = 0; i < keep + 3; i++) {
      // skipIfUnchanged deliberately off: retention must be tested on real objects.
      const s = await takeSnapshot(env, `retention-${i}`);
      made.push(s.id);
    }

    const result = await pruneSnapshots(env, keep);
    expect(result.deleted).toBe(3);
    expect(result.failures).toEqual([]);

    const live = await all<{ id: string }>(
      `SELECT id FROM vault_snapshots WHERE status = 'complete' ORDER BY ts DESC`,
    );
    expect(live.length).toBe(keep);
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

  /**
   * THE CADENCE END TO END, AND THE CEILING THAT STILL HOLDS.
   *
   * Fourteen daily maintenance passes must reach the snapshot step on all fourteen — that is the
   * daily cadence her 13 Sep instruction asked for, and it is what the window makes true. What must
   * NEVER return is more than one a day: the defect was 62 in fifteen hours, so the ceiling is
   * asserted as well as the floor.
   *
   * `skipIfUnchanged` means an untouched database writes one object and then declines to write
   * thirteen identical ones, so the count of OBJECTS is between 1 and 14 while the count of
   * DECISIONS is exactly 14. Both are checked, because "no snapshot today" and "no snapshot today
   * because nothing changed" are different claims.
   */
  it("reaches the snapshot decision once a day across a simulated fortnight — never twice", async () => {
    const start = day(20_300) + MAINTENANCE_HOUR_UTC * HOUR_MS;
    for (let d = 0; d < 14; d++) {
      await runScheduled(env as any, start + day(d));
    }

    const runs = await all<{ steps: string }>(`SELECT steps FROM cron_runs ORDER BY started_at`);
    expect(runs.length).toBe(14);

    // Every pass recorded a snapshot decision, and none of them was "not_due".
    const decisions = runs.map((r) => {
      const step = (JSON.parse(r.steps) as any[]).find((s) => s.name === "snapshot");
      return step?.detail ?? {};
    });
    expect(decisions.length).toBe(14);
    expect(decisions.filter((d) => d.reason === "not_due").length).toBe(0);

    const written = await all<{ id: string }>(
      `SELECT id FROM vault_snapshots WHERE status = 'complete'`,
    );
    expect(written.length).toBeGreaterThanOrEqual(1);
    expect(written.length).toBeLessThanOrEqual(14);
  });
});
