import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, insertTask, row, uid } from "./helpers";
import { isSilent, reapSilentRuns, silenceAllowedMs, REAP_FLOOR_MS } from "../../src/worker/boss/backends/reap";

/**
 * A RUN THE MACHINE CLAIMED AND NEVER REPORTED IS FAILED, NOT LEFT `running`.
 *
 * `brn_m2ecxghymfgwg7xf` in production: claimed by `dev_mac_seq` on 13 September at 22:10, never
 * reported, its task `running` for two and a half days with nothing able to end it. The runner
 * had asked for 900 seconds.
 */
const HOUR = 3_600_000;

async function claimedRun(over: { task_id?: string | null; claimed_at?: number; requested?: string; claimed_by?: string | null } = {}) {
  const id = uid("brn");
  await env.DB
    .prepare(
      `INSERT INTO backend_runs (id, task_id, backend_id, requested, started_at, finished_at, status, claimed_at, claimed_by)
       VALUES (?,?,?,?,?,NULL,'running',?,?)`,
    )
    .bind(
      id, over.task_id ?? null, "bk_claude_code",
      over.requested ?? JSON.stringify({ max_seconds: 900 }),
      over.claimed_at ?? Date.now() - 3 * HOUR, over.claimed_at ?? Date.now() - 3 * HOUR,
      over.claimed_by === undefined ? "dev_mac_seq" : over.claimed_by,
    )
    .run();
  return id;
}

describe("the silence a run is allowed", () => {
  it("is twice what it asked for, and never under an hour", () => {
    expect(silenceAllowedMs(JSON.stringify({ max_seconds: 900 }))).toBe(REAP_FLOOR_MS);
    expect(silenceAllowedMs(JSON.stringify({ max_seconds: 3600 }))).toBe(2 * HOUR);
    expect(silenceAllowedMs(null)).toBe(REAP_FLOOR_MS);
    expect(silenceAllowedMs("not json")).toBe(REAP_FLOOR_MS);
  });
  it("judges the production row silent and a fresh claim not", () => {
    const now = Date.parse("2026-09-16T04:16:00Z");
    const production = { claimed_at: Date.parse("2026-09-13T22:10:27.887Z"), requested: JSON.stringify({ max_seconds: 900 }) };
    expect(isSilent(production, now)).toBe(true);
    expect(isSilent({ claimed_at: now - 20 * 60_000, requested: JSON.stringify({ max_seconds: 900 }) }, now)).toBe(false);
  });
});

describe("the reaper on the hourly tick", () => {
  it("fails a silent run and its task, audits it, and leaves everything else alone", async () => {
    const task = await insertTask({ status: "running", title: "Executive Intelligence Report" });
    const silent = await claimedRun({ task_id: task, claimed_at: Date.now() - 61 * HOUR });
    const fresh = await claimedRun({ claimed_at: Date.now() - 10 * 60_000 });
    const unclaimedId = uid("brn");
    await env.DB
      .prepare(`INSERT INTO backend_runs (id, task_id, backend_id, requested, started_at, finished_at, status) VALUES (?,NULL,'bk_claude_code','{}',?,NULL,'running')`)
      .bind(unclaimedId, Date.now() - 80 * HOUR)
      .run();

    const r = await reapSilentRuns(env as never, Date.now());
    expect(r.reaped).toEqual([silent]);

    const run = await row<any>(`SELECT status, error FROM backend_runs WHERE id = ?`, silent);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/dev_mac_seq claimed this run 61 hours ago and never reported/);
    const t = await row<any>(`SELECT status, error, finished_at FROM tasks WHERE id = ?`, task);
    expect(t.status).toBe("failed");
    expect(t.finished_at).toBeTruthy();

    // A recent claim and an unclaimed run (still waiting for a machine) are untouched.
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, fresh)).status).toBe("running");
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, unclaimedId)).status).toBe("running");

    const audits = await all<any>(`SELECT action FROM audit_log WHERE entity_id = ? AND action = 'backend_run_reaped'`, silent);
    expect(audits.length).toBe(1);
  });

  it("is idempotent: a reaped run is not reaped twice", async () => {
    const silent = await claimedRun({ claimed_at: Date.now() - 5 * HOUR });
    expect((await reapSilentRuns(env as never)).reaped).toEqual([silent]);
    expect((await reapSilentRuns(env as never)).reaped).toEqual([]);
  });
});
