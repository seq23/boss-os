import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { clockRepair, isDue, nextDueAt, pendingSlot, type DutySchedule } from "../../src/worker/boss/duties/cadence";
import { effectiveNextDue } from "../../src/worker/boss/duties/clock";
import { dutyBrief } from "../../src/worker/boss/duties/ownerEdits";
import { apiJson } from "./helpers";

/**
 * THE CLOCK BELONGS TO CODE (22 Nov 2026).
 *
 * Migration 0373 wrote duty_lp_daily's clock as `date('now', '+1 day')` in UTC. Applied when the UTC
 * date already read 22 Nov, it set 23 Nov 05:45 Central while the duty had last run on 21 Nov, so
 * the Mac's `--only-if-due` wrapper refused the LP producer at 05:45 and 06:00 and the morning email
 * said "LP updates: its job did not report in". These are the real numbers from production and each
 * way the repair could break.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CT = "America/Chicago";
const lpDaily: DutySchedule = { cadence: "daily", local_hour: 5, local_minute: 45, timezone: CT, weekday: null, weekdays: null };

describe("clockRepair: a clock ahead of the owed slot is moved back to it", () => {
  it("the real case: duty_lp_daily on 22 Nov is repaired to 22 Nov 05:45 Central and is due", () => {
    const stored = Date.parse("2026-11-23T11:45:00.000Z");
    const lastRun = Date.parse("2026-11-21T12:19:01.369Z");
    const now = Date.parse("2026-11-22T11:45:03.000Z");
    // Today's code: not due, which is the morning she saw.
    expect(isDue(stored, false, now)).toBe(false);
    const r = clockRepair({ ...lpDaily, next_due_at: stored, last_run_at: lastRun }, now);
    expect(r).toEqual({ next_due_at: Date.parse("2026-11-22T11:45:00.000Z"), why: "slot_skipped" });
    expect(isDue(r!.next_due_at, false, now)).toBe(true);
  });

  it("a schedule moved and the clock did not: 06:15 stored under a 05:45 schedule is repaired to 05:45", () => {
    const r = clockRepair({
      ...lpDaily,
      next_due_at: Date.parse("2026-11-22T12:15:00.000Z"), // 06:15 CST
      last_run_at: Date.parse("2026-11-21T12:19:00.000Z"),
    }, Date.parse("2026-11-22T11:00:00.000Z"));
    expect(r).toEqual({ next_due_at: Date.parse("2026-11-22T11:45:00.000Z"), why: "not_a_slot" });
  });

  it("a Mon–Fri duty pushed to next Monday on a Thursday is repaired to Thursday's slot", () => {
    const prospects: DutySchedule = { cadence: "daily", local_hour: 10, local_minute: 40, timezone: CT, weekday: null, weekdays: [1, 2, 3, 4, 5] };
    const r = clockRepair({
      ...prospects,
      next_due_at: Date.parse("2026-11-23T16:40:00.000Z"), // Monday 10:40 CST
      last_run_at: Date.parse("2026-11-18T16:41:00.000Z"), // Wednesday's run
    }, Date.parse("2026-11-19T16:00:00.000Z")); // Thursday 10:00 CST
    expect(r?.next_due_at).toBe(Date.parse("2026-11-19T16:40:00.000Z"));
  });

  it("no double run: a duty that already ran today keeps tomorrow's clock", () => {
    const tomorrow = Date.parse("2026-11-23T11:45:00.000Z");
    expect(clockRepair({ ...lpDaily, next_due_at: tomorrow, last_run_at: Date.parse("2026-11-22T11:46:00.000Z") },
      Date.parse("2026-11-22T15:00:00.000Z"))).toBeNull();
    // A Mac on Eastern fires an hour early; the run recorder credits it to the slot, and so does this.
    expect(clockRepair({ ...lpDaily, next_due_at: tomorrow, last_run_at: Date.parse("2026-11-22T10:45:00.000Z") },
      Date.parse("2026-11-22T13:00:00.000Z"))).toBeNull();
  });

  it("a missed run stays missed: a clock days in the past is never moved forward", () => {
    expect(clockRepair({
      ...lpDaily,
      next_due_at: Date.parse("2026-11-18T11:45:00.000Z"),
      last_run_at: Date.parse("2026-11-17T11:50:00.000Z"),
    }, Date.parse("2026-11-22T15:00:00.000Z"))).toBeNull();
  });

  it("never touches a suspended, removed or clockless duty", () => {
    const base = { ...lpDaily, next_due_at: Date.parse("2026-11-30T11:45:00.000Z"), last_run_at: null };
    const now = Date.parse("2026-11-22T15:00:00.000Z");
    expect(clockRepair({ ...base, suspended: 1 }, now)).toBeNull();
    expect(clockRepair({ ...base, removed_at: now - DAY }, now)).toBeNull();
    expect(clockRepair({ ...base, next_due_at: null }, now)).toBeNull();
  });

  it("is bounded: at most one period back, never before the last run or before the duty existed", () => {
    const now = Date.parse("2026-11-22T15:00:00.000Z");
    // Ten days unrun with a clock a month ahead: owed only the most recent slot, not a backlog.
    const r = clockRepair({ ...lpDaily, next_due_at: now + 30 * DAY, last_run_at: now - 10 * DAY }, now);
    expect(r!.next_due_at).toBe(Date.parse("2026-11-22T11:45:00.000Z"));
    expect(r!.next_due_at).toBeGreaterThanOrEqual(now - DAY);
    // Created after today's slot and never run: tomorrow's seeded clock is right.
    expect(clockRepair({ ...lpDaily, next_due_at: Date.parse("2026-11-23T11:45:00.000Z"), last_run_at: null, created_at: now - HOUR }, now)).toBeNull();
    // A weekly duty is owed at most last week's slot.
    const weekly: DutySchedule = { ...lpDaily, cadence: "weekly", weekday: 1 };
    expect(pendingSlot(weekly, null, now)).toBe(Date.parse("2026-11-16T11:45:00.000Z"));
  });

  it("an unschedulable duty is not guessed at: the rule throws and the caller keeps the clock", () => {
    expect(() => clockRepair({ ...lpDaily, timezone: "Not/AZone", next_due_at: Date.now() + DAY }, Date.now())).toThrow();
  });
});

const PROBE = "duty_clock_probe";
const JOB = "clock-probe.mjs";

async function seed(over: { nextDueAt: number; lastRunAt: number | null; timezone?: string; suspended?: number }) {
  await env.DB.prepare(
    `INSERT INTO standing_duties
       (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
        next_due_at, last_run_at, executor, task_kind, task_title, task_input, success_criteria, suspended, created_at)
     VALUES (?, 'A clock probe', 'emp_repo', 'ops', 5, 45, ?, 'daily', NULL, ?, ?, 'local_job', 'ops', 'A clock probe',
             json_object('local_job', ?), 'x', ?, 0)`,
  ).bind(PROBE, over.timezone ?? CT, over.nextDueAt, over.lastRunAt, JOB, over.suspended ?? 0).run();
}
const stored = async () => (await env.DB.prepare(`SELECT next_due_at FROM standing_duties WHERE id = ?`).bind(PROBE).first<{ next_due_at: number }>())!.next_due_at;
const schedule = (): DutySchedule => ({ ...lpDaily });

describe("the due-answer paths read the clock through the repair", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM standing_duties WHERE id = ?`).bind(PROBE).run();
  });

  it("GET /due answers DUE for a skipped slot, and the row is repaired", async () => {
    const now = Date.now();
    const owed = pendingSlot(schedule(), now - 2 * DAY, now);
    await seed({ nextDueAt: nextDueAt(schedule(), owed), lastRunAt: now - 2 * DAY });
    const { status, body } = await apiJson(`/api/duties/due/${JOB}`);
    expect(status).toBe(200);
    // The owed slot is in the last day or within the next; either way the stored clock comes back to it.
    expect(await stored()).toBe(owed);
    expect(body.data.next_due_at).toBe(owed);
    expect(body.data.due).toBe(owed <= Date.now());
  });

  it("the Mac's brief is told DUE on the real 22 Nov numbers", async () => {
    await seed({ nextDueAt: Date.parse("2026-11-23T11:45:00.000Z"), lastRunAt: Date.parse("2026-11-21T12:19:01.369Z") });
    const b = await dutyBrief(env as any, JOB, Date.parse("2026-11-22T11:45:03.000Z"));
    expect(b.due).toBe(true);
    expect(b.next_due_at).toBe(Date.parse("2026-11-22T11:45:00.000Z"));
    expect(await stored()).toBe(Date.parse("2026-11-22T11:45:00.000Z"));
  });

  it("an unschedulable duty keeps its clock exactly", async () => {
    const at = Date.now() + 3 * DAY;
    await seed({ nextDueAt: at, lastRunAt: null, timezone: "Not/AZone" });
    const row = await env.DB.prepare(`SELECT * FROM standing_duties WHERE id = ?`).bind(PROBE).first<any>();
    expect(await effectiveNextDue(env as any, row, Date.now())).toBe(at);
    expect(await stored()).toBe(at);
  });

  it("a suspended duty's clock is never touched", async () => {
    const at = Date.now() + 9 * DAY;
    await seed({ nextDueAt: at, lastRunAt: null, suspended: 1 });
    const row = await env.DB.prepare(`SELECT * FROM standing_duties WHERE id = ?`).bind(PROBE).first<any>();
    expect(await effectiveNextDue(env as any, row, Date.now())).toBe(at);
    expect(await stored()).toBe(at);
  });
});
