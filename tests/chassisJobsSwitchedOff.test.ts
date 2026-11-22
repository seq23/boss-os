import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTestDb, disposeTestDb, makeTestEnv, splitSqlStatements, type TestDb } from "./helpers/db";

/**
 * Migration 0375 switches off the three copied West Peek fund jobs that still ran hourly here
 * (her yes, 22 Nov 2026: "Yes, retire it"). West Peek OS runs all three itself, so nothing stops.
 * The promise is "paused, not removed": every row stays, and the one switch-back line in the
 * migration's own comment puts them back exactly as they were. 0376 adds the pause's record and
 * closes the one fault the pause made permanent.
 *
 * The chassis dispatcher that ran these rows is gone (same retirement), so no tick can run them;
 * what is left to prove here is the data.
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
const RECORD = splitSqlStatements(
  readFileSync(fileURLToPath(new URL("../migrations/0376_chassis_pause_recorded.sql", import.meta.url)), "utf8"),
).filter((s) => !/schema_version/i.test(s));

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

  it("pauses the three jobs that ran hourly, with the retirement marker", async () => {
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

describe("0376: the pause is on record, and the fault it froze is closed", () => {
  async function pausedEvents(): Promise<Array<{ object_id: string; actor_id: string; payload_json: string }>> {
    const r = await t.db.prepare(
      "SELECT object_id, actor_id, payload_json FROM event_record WHERE event_type = 'scheduled_job.paused' ORDER BY object_id",
    ).all<{ object_id: string; actor_id: string; payload_json: string }>();
    return r.results ?? [];
  }
  async function openFault(id: string): Promise<void> {
    await exec(`DELETE FROM health_fault WHERE id = '${id}' OR (check_key = 'scheduled_work' AND resolved_at IS NULL)`);
    await exec(`INSERT INTO health_fault (id, check_key, label, first_seen_at) VALUES ('${id}', 'scheduled_work', 'Scheduled work', '2026-10-13T16:00:38.838Z')`);
  }
  async function resolvedAt(id: string): Promise<string | null> {
    return (await t.db.prepare("SELECT resolved_at FROM health_fault WHERE id = ?1").bind(id).first<{ resolved_at: string | null }>())!.resolved_at;
  }
  async function pauseAll(): Promise<void> { for (const stmt of PAUSE_STATEMENTS) await exec(stmt); }

  /** The rows 0376's insert would write right now: its own SELECT, read off the migration. */
  async function wouldRecord(): Promise<number> {
    const select = RECORD[0]!.slice(RECORD[0]!.search(/\bSELECT\b/));
    return (await t.db.prepare(`SELECT COUNT(*) AS n FROM (${select})`).first<{ n: number }>())!.n;
  }

  it("one scheduled_job.paused record per job 0375 paused, carrying its reason, the shape the pause button wrote", async () => {
    // The test database ran every migration, 0376 included (event_record is append-only).
    const events = await pausedEvents();
    expect(events.map((e) => e.object_id)).toEqual(["sjob_deck_reading", "sjob_diagnostics_sweep", "sjob_network_sync"]);
    for (const e of events) {
      expect(e.actor_id).toBe("migration:0375_chassis_jobs_switched_off");
      expect(JSON.parse(e.payload_json).reason).toMatch(/^chassis-retire 2026-11-22: /);
    }
    // A re-run adds nothing.
    for (const stmt of RECORD) await exec(stmt);
    expect(await pausedEvents()).toHaveLength(3);
  });

  it("a job switched back on before 0376 gets no false pause record, and its fault stays open", async () => {
    await openFault("hf_test_running");
    expect(await wouldRecord()).toBe(3);
    await exec(SWITCH_BACK);
    expect(await wouldRecord()).toBe(0);
    for (const stmt of RECORD.slice(1)) await exec(stmt);
    expect(await resolvedAt("hf_test_running")).toBeNull();
    await pauseAll();
  });

  it("closes the open scheduled_work fault while network_sync is paused, and touches nothing else", async () => {
    await openFault("hf_test_frozen");
    await exec("DELETE FROM health_fault WHERE id = 'hf_test_other'");
    await exec("INSERT INTO health_fault (id, check_key, label, first_seen_at) VALUES ('hf_test_other', 'brain_reader', 'Brains', '2026-11-01T00:00:00.000Z')");
    const before = (await t.db.prepare("SELECT COUNT(*) AS n FROM health_fault").first<{ n: number }>())!.n;
    for (const stmt of RECORD) await exec(stmt);
    expect(await resolvedAt("hf_test_frozen")).toBe("2026-11-22T00:00:00.000Z");
    expect(await resolvedAt("hf_test_other")).toBeNull();
    expect((await t.db.prepare("SELECT COUNT(*) AS n FROM health_fault").first<{ n: number }>())!.n).toBe(before);
  });
});
