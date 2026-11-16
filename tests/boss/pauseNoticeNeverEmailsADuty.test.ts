import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { namedStop } from "../../src/worker/boss/queue/freeRung";

/**
 * A DUTY'S PAUSE IS A NOTE ON KENDRA'S LIST, NEVER AN EMAIL (owner's inbox, 16 Nov 2026: "Paused until
 * Mon, Nov 16, 8:40 AM: Monthly quality read" from Kendra; the duty's run waits for a seat and retries
 * by itself). Over the real migrations: the same `namedStop(..., tell: true)` the consumer calls writes
 * needs_her = 0 for a run Boss OS started itself and 1 for work she asked for by email, and neither
 * body asks for a reply it has no use for.
 */
const E = env as any;
const task = (id: string, input: Record<string, unknown>) =>
  E.DB.prepare(`INSERT INTO tasks (id, lane, title, input, status, created_at) VALUES (?, 'ops', ?, ?, 'running', ?)`)
    .bind(id, `Synthetic ${id}`, JSON.stringify(input), Date.now()).run();
const notice = (id: string) =>
  E.DB.prepare(`SELECT needs_her, body FROM boss_task_notices WHERE task_id = ? AND kind = 'stop:WAITING_FOR_CLAUDE'`).bind(id).first();

describe("a pause notice follows who started the work", () => {
  it("a duty's run (stamped, or the duty's last run) is a page row; her emailed ask is still emailed; no body asks for a reply", async () => {
    await task("tsk_pauseduty01", { duty_id: "duty_synthetic_read" });
    await task("tsk_pauseduty02", {});
    // A run from before the duty stamp: only the duty's last_task_id says whose it is.
    const seeded = await E.DB.prepare(`UPDATE standing_duties SET last_task_id = 'tsk_pauseduty02' WHERE id = (SELECT id FROM standing_duties ORDER BY id LIMIT 1)`).run();
    expect(seeded.meta.changes).toBe(1);
    await task("tsk_pausehers01", { mail_id: "msg_synthetic", from: "owner@example.com" });
    const stop = { code: "WAITING_FOR_CLAUDE", why: "NAMED STOP [WAITING_FOR_CLAUDE] synthetic", resumeAt: Date.now() + 3_600_000, tell: true, requeue: false };
    for (const id of ["tsk_pauseduty01", "tsk_pauseduty02", "tsk_pausehers01"]) {
      await namedStop(E, { id, lane: "ops", title: `Synthetic ${id}` }, stop);
    }
    expect((await notice("tsk_pauseduty01")).needs_her).toBe(0);
    expect((await notice("tsk_pauseduty02")).needs_her).toBe(0);
    const hers = await notice("tsk_pausehers01");
    expect(hers.needs_her).toBe(1);
    for (const id of ["tsk_pauseduty01", "tsk_pauseduty02", "tsk_pausehers01"]) {
      expect((await notice(id)).body).not.toMatch(/Reply to this email/i);
    }
  });

  it("a resume time already past writes no pause notice at all: it is a retry now", async () => {
    await task("tsk_pausepast01", { mail_id: "msg_synthetic2", from: "owner@example.com" });
    await namedStop(E, { id: "tsk_pausepast01", lane: "ops", title: "Synthetic past" },
      { code: "WAITING_FOR_CLAUDE", why: "synthetic", resumeAt: Date.now() - 60_000, tell: true, requeue: false });
    expect(await notice("tsk_pausepast01")).toBeNull();
  });
});
