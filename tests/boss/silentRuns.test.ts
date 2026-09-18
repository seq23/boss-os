import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, insertTask, row, uid } from "./helpers";
import { isSilent, isUnclaimed, reapSilentRuns, silenceAllowedMs, REAP_FLOOR_MS, UNCLAIMED_ALLOWED_MS } from "../../src/worker/boss/backends/reap";

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
    // A never-claimed run is UNCLAIMED, not silent. Treating a null claim as the epoch would reap a
    // run parked five minutes ago, which is the opposite of the fault being fixed.
    expect(isSilent({ claimed_at: null, requested: JSON.stringify({ max_seconds: 900 }) }, now)).toBe(false);
  });
});

/**
 * AND THE RUN NOBODY EVER CLAIMED, 18 SEPTEMBER 2026.
 *
 * `brn_m2t69hnweb7bw9c0` — the Executive Intelligence Report — was parked at 12:01:38 UTC and never
 * claimed, because the claimer on her Mac was exiting 1 before claiming anything. It sat `running`
 * with `claimed_at` null, which the reaper's `claimed_at IS NOT NULL` put beyond its reach entirely:
 * nothing could ever end it and nothing said so. She got no brief and no reason.
 */
describe("the wait a parked run is allowed before anybody claims it", () => {
  it("is a full day, so a quiet night is never a fault", () => {
    const now = Date.now();
    expect(UNCLAIMED_ALLOWED_MS).toBe(24 * HOUR);
    // The overnight gap between the claimer's last evening fire and its first morning one.
    expect(isUnclaimed({ claimed_at: null, started_at: now - 12 * HOUR }, now)).toBe(false);
    expect(isUnclaimed({ claimed_at: null, started_at: now - 25 * HOUR }, now)).toBe(true);
    // A claimed run is never judged by this rule, however old.
    expect(isUnclaimed({ claimed_at: now - 99 * HOUR, started_at: now - 99 * HOUR }, now)).toBe(false);
  });
});

describe("the reaper on the hourly tick", () => {
  it("fails a silent run and its task, audits it, and leaves everything else alone", async () => {
    const task = await insertTask({ status: "running", title: "Executive Intelligence Report" });
    const silent = await claimedRun({ task_id: task, claimed_at: Date.now() - 61 * HOUR });
    const fresh = await claimedRun({ claimed_at: Date.now() - 10 * 60_000 });
    const briefTask = await insertTask({ status: "running", title: "Executive Intelligence Report" });
    const unclaimedId = uid("brn");
    await env.DB
      .prepare(`INSERT INTO backend_runs (id, task_id, backend_id, requested, started_at, finished_at, status) VALUES (?,?,'bk_claude_code','{}',?,NULL,'running')`)
      .bind(unclaimedId, briefTask, Date.now() - 80 * HOUR)
      .run();
    // Parked this morning and still legitimately waiting for the next claimer fire.
    const waitingId = uid("brn");
    await env.DB
      .prepare(`INSERT INTO backend_runs (id, task_id, backend_id, requested, started_at, finished_at, status) VALUES (?,NULL,'bk_claude_code','{}',?,NULL,'running')`)
      .bind(waitingId, Date.now() - 2 * HOUR)
      .run();

    const r = await reapSilentRuns(env as never, Date.now());
    expect([...r.reaped].sort()).toEqual([silent, unclaimedId].sort());

    const run = await row<any>(`SELECT status, error FROM backend_runs WHERE id = ?`, silent);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/dev_mac_seq claimed this run 61 hours ago and never reported/);
    const t = await row<any>(`SELECT status, error, finished_at FROM tasks WHERE id = ?`, task);
    expect(t.status).toBe("failed");
    expect(t.finished_at).toBeTruthy();

    /*
     * THE RUN NOBODY CLAIMED IS FAILED TOO, AND SAYS SOMETHING DIFFERENT. "A device claimed this and
     * went quiet" sends her to a machine that ran; this one sends her to the claimer, which is where
     * the fault actually was on 18 September.
     */
    const never = await row<any>(`SELECT status, error FROM backend_runs WHERE id = ?`, unclaimedId);
    expect(never.status).toBe("failed");
    expect(never.error).toMatch(/No device claimed this run in the 80 hours since it was parked/);
    expect(never.error).toMatch(/com\.seq\.boss-agent/);
    expect(never.error).not.toMatch(/never reported/);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, briefTask)).status).toBe("failed");

    // A recent claim, and a run parked two hours ago that is still legitimately waiting, are untouched.
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, fresh)).status).toBe("running");
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, waitingId)).status).toBe("running");

    const audits = await all<any>(`SELECT action FROM audit_log WHERE entity_id = ? AND action = 'backend_run_reaped'`, silent);
    expect(audits.length).toBe(1);
    const neverAudits = await all<any>(`SELECT action FROM audit_log WHERE entity_id = ? AND action = 'backend_run_never_claimed'`, unclaimedId);
    expect(neverAudits.length).toBe(1);
  });

  it("is idempotent: a reaped run is not reaped twice", async () => {
    const silent = await claimedRun({ claimed_at: Date.now() - 5 * HOUR });
    expect((await reapSilentRuns(env as never)).reaped).toEqual([silent]);
    expect((await reapSilentRuns(env as never)).reaped).toEqual([]);
  });
});
