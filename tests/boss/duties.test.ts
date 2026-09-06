import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { nextDueAt, utcForLocalTime, dayOfWeekIn, isDue } from "../../src/worker/boss/duties/cadence";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { all, row } from "./helpers";

/**
 * THE TESTS THAT MATTER HERE ARE THE TWO DAYS A YEAR NOBODY IS LOOKING.
 *
 * The owner asked for her report at 7am Central. Written as a cron expression that is `0 12 * * *`
 * — correct in September, an hour early from November. Nobody files a bug for that; the report is
 * just quietly already stale when she opens it, for five months, every year.
 *
 * So the load-bearing assertions below are the ones that pin a wall-clock time across a daylight
 * saving transition, and the one that proves a duty which slept through several occurrences fires
 * ONCE rather than catching up.
 */

const CHICAGO = "America/Chicago";
const schedule = { local_hour: 6, local_minute: 30, timezone: CHICAGO, cadence: "daily" as const };

describe("duty cadence — wall-clock time in a zone that changes twice a year", () => {
  it("holds 06:30 Chicago across the spring transition, when the UTC hour moves", () => {
    // 8 March 2026 is CST (UTC-6); 9 March is CDT (UTC-5). The wall clock must not move.
    const beforeDst = nextDueAt(schedule, Date.parse("2026-03-07T00:00:00Z"));
    const afterDst = nextDueAt(schedule, Date.parse("2026-03-09T00:00:00Z"));

    const localOf = (t: number) =>
      new Intl.DateTimeFormat("en-US", { timeZone: CHICAGO, hour: "2-digit", minute: "2-digit", hour12: false })
        .format(new Date(t));

    expect(localOf(beforeDst)).toBe("06:30");
    expect(localOf(afterDst)).toBe("06:30");

    // And the UTC hour genuinely differs — which is the whole point. If these were equal, the zone
    // was being ignored and the test would be passing for the wrong reason.
    expect(new Date(beforeDst).getUTCHours()).not.toBe(new Date(afterDst).getUTCHours());
  });

  it("holds 06:30 Chicago across the autumn transition too", () => {
    const beforeFall = nextDueAt(schedule, Date.parse("2026-10-31T00:00:00Z"));
    const afterFall = nextDueAt(schedule, Date.parse("2026-11-03T00:00:00Z"));
    const localOf = (t: number) =>
      new Intl.DateTimeFormat("en-US", { timeZone: CHICAGO, hour: "2-digit", minute: "2-digit", hour12: false })
        .format(new Date(t));
    expect(localOf(beforeFall)).toBe("06:30");
    expect(localOf(afterFall)).toBe("06:30");
  });

  it("is STRICTLY after the moment it is given — or a duty that just ran is instantly due again", () => {
    const due = nextDueAt(schedule, Date.parse("2026-06-01T00:00:00Z"));
    // Asking again from exactly that instant must move forward a day, not return the same answer.
    const next = nextDueAt(schedule, due);
    expect(next).toBeGreaterThan(due);
    expect(next - due).toBeGreaterThan(23 * 3_600_000);
  });

  it("resolves a local wall-clock time to the correct UTC instant in both offsets", () => {
    // 15 Jan 2026 06:30 CST = 12:30 UTC. 15 Jul 2026 06:30 CDT = 11:30 UTC.
    expect(new Date(utcForLocalTime(CHICAGO, 2026, 1, 15, 6, 30)).toISOString()).toBe("2026-01-15T12:30:00.000Z");
    expect(new Date(utcForLocalTime(CHICAGO, 2026, 7, 15, 6, 30)).toISOString()).toBe("2026-07-15T11:30:00.000Z");
  });

  it("reads the weekday in the duty's zone, not UTC", () => {
    // 23:30 Chicago on a Sunday is already Monday in UTC. A weekly duty must use the local answer.
    const sundayNight = Date.parse("2026-06-08T04:00:00Z");
    expect(dayOfWeekIn(CHICAGO, sundayNight)).toBe(0);
    expect(new Date(sundayNight).getUTCDay()).toBe(1);
  });

  it("refuses to fire a suspended duty", () => {
    expect(isDue(0, true, Date.now())).toBe(false);
    expect(isDue(0, false, Date.now())).toBe(true);
  });
});

describe("materialising due duties", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM tasks WHERE employee_id = 'emp_research'`).run();
    await env.DB.prepare(`UPDATE standing_duties SET next_due_at = 0, suspended = 0, last_run_at = NULL WHERE id = 'duty_exec_intel'`).run();
  });

  it("turns a due duty into ONE queued task owned by its employee", async () => {
    const now = Date.parse("2026-06-15T13:00:00Z");
    const result = await materialiseDueDuties(env as any, now);

    expect(result.fired.map((f) => f.duty)).toContain("duty_exec_intel");
    const tasks = await all<{ id: string; status: string; employee_id: string }>(
      `SELECT id, status, employee_id FROM tasks WHERE employee_id = 'emp_research'`,
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe("queued");
  });

  it("does NOT fire again on the next tick — the loop this shape exists to prevent", async () => {
    const now = Date.parse("2026-06-15T13:00:00Z");
    await materialiseDueDuties(env as any, now);
    const second = await materialiseDueDuties(env as any, now + 3_600_000);

    expect(second.fired).toEqual([]);
    expect(second.skipped.find((s) => s.duty === "duty_exec_intel")?.reason).toBe("not_due");
    const tasks = await all(`SELECT id FROM tasks WHERE employee_id = 'emp_research'`);
    expect(tasks).toHaveLength(1);
  });

  it("fires ONCE after sleeping through several occurrences, rather than catching up", async () => {
    // A week of downtime must not hand her seven copies of the report. Her own Core Law 3:
    // "Yesterday is closed. The system moves forward only."
    const weekLater = Date.parse("2026-06-22T13:00:00Z");
    await materialiseDueDuties(env as any, weekLater);
    const tasks = await all(`SELECT id FROM tasks WHERE employee_id = 'emp_research'`);
    expect(tasks).toHaveLength(1);

    const duty = await row<{ next_due_at: number }>(
      `SELECT next_due_at FROM standing_duties WHERE id = 'duty_exec_intel'`,
    );
    // And the clock is advanced past NOW, not to the missed time — otherwise it stays due for ever.
    expect(duty!.next_due_at).toBeGreaterThan(weekLater);
  });

  it("advances the clock even though the work has not run yet", async () => {
    // The task is queued, not done. If materialisation waited for completion to advance the clock,
    // a task that failed would re-fire the duty on every tick until someone noticed.
    const now = Date.parse("2026-06-15T13:00:00Z");
    await materialiseDueDuties(env as any, now);
    const duty = await row<{ next_due_at: number; last_task_id: string }>(
      `SELECT next_due_at, last_task_id FROM standing_duties WHERE id = 'duty_exec_intel'`,
    );
    expect(duty!.next_due_at).toBeGreaterThan(now);
    expect(duty!.last_task_id).toBeTruthy();
  });

  it("skips a suspended duty without touching its clock", async () => {
    await env.DB.prepare(`UPDATE standing_duties SET suspended = 1 WHERE id = 'duty_exec_intel'`).run();
    const before = await row<{ next_due_at: number }>(`SELECT next_due_at FROM standing_duties WHERE id = 'duty_exec_intel'`);

    const result = await materialiseDueDuties(env as any, Date.parse("2026-06-15T13:00:00Z"));
    expect(result.fired).toEqual([]);
    expect(result.skipped.find((s) => s.duty === "duty_exec_intel")?.reason).toBe("suspended");

    const after = await row<{ next_due_at: number }>(`SELECT next_due_at FROM standing_duties WHERE id = 'duty_exec_intel'`);
    expect(after!.next_due_at).toBe(before!.next_due_at);
  });
});
