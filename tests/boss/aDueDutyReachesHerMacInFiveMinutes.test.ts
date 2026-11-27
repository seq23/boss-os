import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/index";
import { runDuties } from "../../src/worker/boss/index";
import { row, stubFetch } from "./helpers";

/**
 * A DUTY THAT COMES DUE IS A RUN PARKED FOR HER MAC WITHIN ONE FIVE-MINUTE TICK (27 Nov 2026).
 *
 * Camille's briefing was late for Simone's morning email: today's executive report had not landed by
 * 07:45 Central. The briefing duty is due at 04:00 (migration 0373), but the duty clock and the queue
 * drain rode the HOURLY tick while the five-minute tick returned before them. So the 04:05 claim slot
 * found nothing parked, the poll that should have caught the next slot could not run before 10:00
 * (its Schedule class was LIGHT), and one bad slot pushed the report to mid-morning.
 *
 * This drives the Worker's REAL `scheduled()` export on the five-minute cron against the migrated D1,
 * with the chassis bindings `bossMount.ts` reads, and nothing stubbed but outbound fetch.
 */

const H = 3_600_000;
const chassisEnv = () => ({ ...(env as any), WP_OS_DB: env.DB, WP_OS_DOCUMENTS: (env as any).VAULT, WP_OS_KV: (env as any).SESSIONS });

async function tick(cron: string) {
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); }, passThroughOnException: () => {} } as unknown as ExecutionContext;
  await worker.scheduled!({ cron, scheduledTime: Date.now(), noRetry: () => {} } as unknown as ScheduledController, chassisEnv() as any, ctx);
  await Promise.allSettled(waits);
}

const dueNow = () => env.DB.prepare(`UPDATE standing_duties SET next_due_at = ?, suspended = 0 WHERE id = 'duty_exec_intel'`).bind(Date.now() - 60_000).run();

let restore: (() => void) | null = null;
beforeEach(async () => {
  restore = stubFetch(() => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', spent_micros = 0, window_started_at = NULL, exhausted_until = NULL, exhausted_reason = NULL WHERE id IN ('bk_codex','bk_claude_code')`).run();
});
afterEach(() => { restore?.(); restore = null; });

describe("the briefing duty, due now", () => {
  it("THE DEFECT, AS A FACT: the hourly chores alone no longer touch the duty clock", async () => {
    await dueNow();
    const before = await row<any>(`SELECT next_due_at FROM standing_duties WHERE id = 'duty_exec_intel'`);
    await runDuties(env as any, Date.now());
    const after = await row<any>(`SELECT next_due_at FROM standing_duties WHERE id = 'duty_exec_intel'`);
    // Still due: had this been the only tick that moved work, the 04:05 slot would have found nothing.
    expect(after.next_due_at).toBe(before.next_due_at);
  });

  it("one five-minute tick advances its clock and parks its run on a seat, ready for the Mac's next ask", async () => {
    await dueNow();
    const t0 = Date.now();
    await tick("*/5 * * * *");
    const duty = await row<any>(`SELECT next_due_at, last_run_at, local_hour, local_minute FROM standing_duties WHERE id = 'duty_exec_intel'`);
    expect(duty.last_run_at, "the five-minute tick did not materialise the due duty").toBeGreaterThanOrEqual(t0 - 1000);
    // Its clock moved to its NEXT slot: after now, within a day, at its own Central time. (Was "more than 12 hours
    // on", which is false every afternoon from 16:00 Central, when the next 04:00 slot is under 12 hours away.)
    expect(duty.next_due_at).toBeGreaterThan(t0);
    expect(duty.next_due_at).toBeLessThanOrEqual(t0 + 24 * H);
    const central = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(duty.next_due_at);
    expect(central).toBe(`${String(duty.local_hour).padStart(2, "0")}:${String(duty.local_minute).padStart(2, "0")}`);

    const run = await row<any>(
      `SELECT r.backend_id, r.status, r.claimed_at, r.task_id FROM backend_runs r JOIN tasks t ON t.id = r.task_id
        WHERE t.created_at >= ? AND r.backend_id IN ('bk_codex','bk_claude_code') ORDER BY r.started_at DESC LIMIT 1`, t0 - 1000);
    expect(run, "the due duty's task was not drained to a seat on the same tick").toBeTruthy();
    expect(run.status).toBe("running");
    expect(run.claimed_at).toBeNull(); // parked: the Mac's claim is what starts it
    const pending = await row<any>(`SELECT COUNT(*) AS n FROM boss_task_queue WHERE task_id = ? AND state = 'pending'`, run.task_id);
    expect(pending.n).toBe(0);
  });
});
