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
  /*
   * ONE DUTY UNDER TEST AT A TIME, and the rest suspended rather than assumed absent.
   *
   * These assertions counted rows for `emp_research` and expected exactly one, which held while the
   * report was the only duty that employee owned. Adding the Brokerage Sourcing Sweep made four of
   * them fail — correctly: they were reading "how many tasks did this employee get" as a proxy for
   * "did this duty fire once". Those are different questions, and the second is the one that
   * matters. Suspending the others keeps the test measuring the thing it names.
   */
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM tasks WHERE employee_id = 'emp_research'`).run();
    await env.DB.prepare(`UPDATE standing_duties SET suspended = 1 WHERE id != 'duty_exec_intel'`).run();
    await env.DB.prepare(`UPDATE standing_duties SET next_due_at = 0, suspended = 0, last_run_at = NULL WHERE id = 'duty_exec_intel'`).run();
  });

  it("turns a due duty into ONE queued task owned by its employee", async () => {
    const now = Date.parse("2026-06-15T13:00:00Z");
    const result = await materialiseDueDuties(env as any, now);

    expect(result.fired.map((f) => f.duty)).toContain("duty_exec_intel");
    // Exactly once, which is the claim — not "this employee received exactly one task ever".
    expect(result.fired.filter((f) => f.duty === "duty_exec_intel")).toHaveLength(1);
    const tasks = await all<{ id: string; status: string; employee_id: string }>(
      `SELECT id, status, employee_id FROM tasks WHERE employee_id = 'emp_research'`,
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe("queued");
  });

  /**
   * THE ASSERTION THAT WAS MISSING, AND THE REASON THE BUG SURVIVED.
   *
   * The test above passed against the broken code. It checked that a row appeared with status
   * 'queued' — and a row did appear, with status 'queued', for months, while nothing ever ran. The
   * word "queued" in that column is a claim the old code had no right to make: it wrote the string
   * and never sent the message.
   *
   * So these check the things a bare INSERT cannot fake. Classification, an execution assignment, a
   * permission envelope and an intake event are all written by `admitTask` and by nothing else, and
   * every one of them was null or absent on the tasks the duty actually created.
   */
  it("admits the task through real intake — classified, enveloped, and given its kind", async () => {
    const now = Date.parse("2026-06-15T13:00:00Z");
    await materialiseDueDuties(env as any, now);

    const task = await row<{ id: string; intake_kind: string | null; envelope_id: string | null; execution_assignment: string | null; cost_mode: string | null }>(
      `SELECT id, intake_kind, envelope_id, execution_assignment, cost_mode FROM tasks WHERE employee_id = 'emp_research'`,
    );
    expect(task).not.toBeNull();

    // `intake_kind` was null on every duty-created task. The spend report groups by it, the
    // capability metrics filter on it, and the router reads it to decide which backend may take the
    // work — so a task without one is invisible to all three at once.
    expect(task!.intake_kind).toBeTruthy();
    expect(task!.execution_assignment).toBeTruthy();
    expect(task!.cost_mode).toBeTruthy();

    // A permission envelope is what bounds the spend. No envelope means the task either cannot run
    // or runs unbounded, and neither is a thing to discover afterwards.
    expect(task!.envelope_id).toBeTruthy();
    const envelope = await row(`SELECT id FROM permission_envelopes WHERE task_id = ?`, task!.id);
    expect(envelope).not.toBeNull();

    const intakeEvent = await row(`SELECT id FROM task_events WHERE task_id = ? AND event = 'intake'`, task!.id);
    expect(intakeEvent).not.toBeNull();
  });

  it("actually sends the queue message, which is the whole difference between queued and running", async () => {
    /*
     * THE BUG, ASSERTED DIRECTLY. `boss_task_queue` was empty while tasks sat 'queued' since the
     * 6th, because materialise never called `TASKS.send()`. Nothing else in this suite would notice
     * — a status column is a string, and the string was right.
     */
    const sent: unknown[] = [];
    const real = (env as any).TASKS.send.bind((env as any).TASKS);
    (env as any).TASKS.send = async (msg: unknown) => { sent.push(msg); return real(msg); };
    try {
      const now = Date.parse("2026-06-15T13:00:00Z");
      const result = await materialiseDueDuties(env as any, now);
      const fired = result.fired.find((f) => f.duty === "duty_exec_intel");
      expect(fired).toBeDefined();
      expect(sent).toContainEqual(expect.objectContaining({ taskId: fired!.task_id }));
    } finally {
      (env as any).TASKS.send = real;
    }
  });

  it("does NOT fire again on the next tick — the loop this shape exists to prevent", async () => {
    const now = Date.parse("2026-06-15T13:00:00Z");
    await materialiseDueDuties(env as any, now);
    const second = await materialiseDueDuties(env as any, now + 3_600_000);

    expect(second.fired.filter((f) => f.duty === "duty_exec_intel")).toEqual([]);
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
