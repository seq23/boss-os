import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTestDb, disposeTestDb, makeTestEnv, splitSqlStatements, type TestDb } from "./helpers/db";
import { runDueJobs } from "../src/worker/services/jobs";

/**
 * Migration 0375 switches off the three copied West Peek fund jobs that still ran every 15 minutes
 * here (her yes, 22 Nov 2026: "Yes, retire it"). West Peek OS runs all three itself, so nothing
 * stops. The promise is "paused, not removed": every row stays, and the one switch-back line in the
 * migration's own comment puts them back exactly as they were.
 */

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../migrations/0375_chassis_jobs_switched_off.sql", import.meta.url)),
  "utf8",
);
const SWITCHED_OFF = ["deck_reading", "diagnostics_sweep", "network_sync"];
const ALREADY_PAUSED = ["daily_intelligence", "monthly_room_proposal", "weekly_mp_review"];

/** The switch-back line exactly as the migration's comment prints it, so the two cannot drift. */
const SWITCH_BACK = (() => {
  const line = MIGRATION.split("\n").find((l) => /^--\s+UPDATE scheduled_job SET status = 'ACTIVE'/.test(l));
  return line ? line.replace(/^--\s+/, "") : "";
})();
/** The migration's own statements, comments stripped, minus the schema_version stamp. */
const PAUSE_STATEMENTS = splitSqlStatements(MIGRATION).filter((s) => /UPDATE\s+scheduled_job/i.test(s));

type Row = Record<string, unknown> & { job_key: string; status: string; pause_reason: string | null };

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await disposeTestDb(t); });

async function rows(): Promise<Row[]> {
  const r = await t.db.prepare("SELECT * FROM scheduled_job ORDER BY job_key").all<Row>();
  return r.results ?? [];
}
async function exec(sql: string): Promise<void> {
  await t.db.prepare(sql).run();
}

describe("0375: the copied fund jobs are paused, not removed", () => {
  it("reads the switch-back line and the pause statement out of the migration", () => {
    expect(SWITCH_BACK).toMatch(/^UPDATE scheduled_job SET status = 'ACTIVE'.* WHERE .+;$/);
    expect(PAUSE_STATEMENTS).toHaveLength(1);
  });

  it("pauses the three jobs that ran every 15 minutes, with the retirement marker", async () => {
    const all = await rows();
    for (const key of SWITCHED_OFF) {
      const row = all.find((r) => r.job_key === key);
      expect(row, `${key} must still exist`).toBeTruthy();
      expect(row!.status, key).toBe("PAUSED");
      expect(row!.pause_reason, key).toMatch(/^chassis-retire 2026-11-22: /);
    }
  });

  it("keeps every seeded row and leaves the already-paused jobs exactly as they were", async () => {
    const all = await rows();
    const keys = all.map((r) => r.job_key);
    for (const key of [...SWITCHED_OFF, ...ALREADY_PAUSED]) expect(keys, key).toContain(key);
    for (const key of ALREADY_PAUSED) {
      const row = all.find((r) => r.job_key === key)!;
      expect(row.status, key).toBe("PAUSED");
      expect(String(row.pause_reason ?? ""), key).not.toMatch(/chassis-retire/);
    }
  });

  it("the hourly tick runs none of them", async () => {
    const env = makeTestEnv(t.db);
    const before = await t.db.prepare(
      `SELECT COUNT(*) AS n FROM job_run WHERE job_id IN (SELECT id FROM scheduled_job WHERE job_key IN ('deck_reading','diagnostics_sweep','network_sync'))`,
    ).first<{ n: number }>();
    const results = await runDueJobs(env, new Date("2030-01-01T12:00:00.000Z"));
    expect(results.map((r) => r.job_key).filter((k) => SWITCHED_OFF.includes(k))).toEqual([]);
    const after = await t.db.prepare(
      `SELECT COUNT(*) AS n FROM job_run WHERE job_id IN (SELECT id FROM scheduled_job WHERE job_key IN ('deck_reading','diagnostics_sweep','network_sync'))`,
    ).first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });

  it("the switch-back line restores the rows exactly, and only the rows 0375 closed", async () => {
    // Production's rows carry real clock values; a fresh test database leaves them empty, which
    // would hide a switch-back line that wiped them. Give them production-shaped values first.
    await exec(
      `UPDATE scheduled_job SET next_run_at = '2026-11-22T18:15:00.000Z', last_run_at = '2026-11-22T18:00:00.000Z'
        WHERE job_key IN ('deck_reading','diagnostics_sweep','network_sync')`,
    );
    const paused = await rows();
    await exec(SWITCH_BACK);
    const restored = await rows();
    expect(restored).toHaveLength(paused.length);
    for (const row of restored) {
      const was = paused.find((r) => r.job_key === row.job_key)!;
      if (SWITCHED_OFF.includes(row.job_key)) {
        // Back to what production held before 0375: ACTIVE with no pause reason; every other
        // column (schedule, next_run_at, last_run_at, capability…) untouched.
        expect(row).toEqual({ ...was, status: "ACTIVE", pause_reason: null });
      } else {
        expect(row, row.job_key).toEqual(was);
      }
    }
    // And the round trip: pausing again gives back the very same rows.
    for (const stmt of PAUSE_STATEMENTS) await exec(stmt);
    expect(await rows()).toEqual(paused);
  });
});
