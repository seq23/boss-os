import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { all, insertTask, row } from "./helpers";

/**
 * A TASK SHE ALREADY SAID YES TO NEVER COMES BACK AS A SECOND CARD (13 Nov 2026). Her yes of 4 Nov on
 * a duty change was carried out by the sweep; one second later the router refused the run ("holds
 * restricted content and no private model is available") and a new `model_route` approval was raised,
 * which the next morning's email would have shown her as a fresh Decide card. A route refused on
 * released work is the team's: the task ends under a named stop, ONE fix job is opened, no card, no
 * notice to her. Driven through `handleTask`, where the behaviour lives.
 */
const restricted = (title: string) => insertTask({
  status: "queued", title, intake_kind: "one_off", sensitivity: "restricted", execution_assignment: "AI_DRAFT",
  input: JSON.stringify({ prompt: "Renew the listings and keep them true to the site.", source: "employee_page" }),
});
const cards = (taskId: string) => all<any>(`SELECT id, kind, status FROM approvals WHERE origin_type = 'tasks' AND origin_id = ? ORDER BY requested_at`, taskId);

describe("a routing block on a task she already approved", () => {
  it("is never a second approval: it ends by name and the team gets one fix job", async () => {
    const taskId = await restricted("Change how a duty works (released)");
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, decided_at) VALUES ('apr_w4yes', 'ops', 'Yes?', 'Her card', 'manual', 'tasks', ?, 'medium', '{}', 'approved', ?, ?)`).bind(taskId, now - 1000, now - 500).run();
    await handleTask(env as any, { taskId, lane: "ops" });
    const after = await cards(taskId);
    expect(after.filter((a) => a.status === "pending"), "a second card was raised for her").toEqual([]);
    expect(after.some((a) => a.kind === "model_route")).toBe(false);
    const task = await row<any>(`SELECT status, error FROM tasks WHERE id = ?`, taskId);
    expect(task.status).toBe("failed");
    expect(task.error).toMatch(/^NAMED STOP \[ROUTE_BLOCKED_AFTER_HER_YES\]/);
    const jobs = await all<any>(`SELECT id, input FROM tasks WHERE title LIKE 'Route a task she already approved:%'`);
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0].input).origin).toBe("repair");
    // Nothing is written for her inbox about it.
    expect(await all<any>(`SELECT 1 FROM boss_task_notices WHERE task_id = ? AND needs_her = 1`, taskId)).toEqual([]);
    // A second refusal of the same task opens no second fix job.
    await env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL WHERE id = ?`).bind(taskId).run();
    await handleTask(env as any, { taskId, lane: "ops" });
    expect(await all<any>(`SELECT id FROM tasks WHERE title LIKE 'Route a task she already approved:%'`)).toHaveLength(1);
  });

  it("negative: the same block on a task she has NOT answered still asks her once", async () => {
    const taskId = await restricted("Change how a duty works (never asked)");
    await handleTask(env as any, { taskId, lane: "ops" });
    const after = await cards(taskId);
    expect(after.filter((a) => a.kind === "model_route" && a.status === "pending")).toHaveLength(1);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("awaiting_approval");
  });
});
