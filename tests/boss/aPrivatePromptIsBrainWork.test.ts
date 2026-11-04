import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { all, insertTask, row } from "./helpers";

/**
 * A PROMPT THE PRIVACY SCREEN FLAGS IS BRAIN WORK (3 Nov 2026). A ChatGPT plan is a setting, not a
 * no-training contract, so a seat prompt carrying deal material, an LP or investor term, a private
 * name or children's data is never handed to Codex: it runs on Claude's seat only, fail closed.
 * Public prompts still go to Codex first (aiRoles.mjs "agent_queue.default").
 */
const reset = () => env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', exhausted_until = NULL, exhausted_reason = NULL, spent_micros = 0, window_started_at = NULL WHERE id IN ('bk_claude_code','bk_codex')`).run();
beforeEach(reset);
afterEach(reset);

describe("the privacy screen runs before a worker is chosen", () => {
  it("Camille's briefing, whose prompt reads as deal material, goes to the brain (Claude's seat) and never to Codex", async () => {
    await env.DB.prepare(`DELETE FROM tasks WHERE input LIKE '%executive_reports%'`).run();
    const out = await materialiseDueDuties(env as any, Date.now(), "duty_exec_intel");
    expect(out.fired, JSON.stringify(out.skipped)).toHaveLength(1);
    const taskId = out.fired[0]!.task_id!;
    await handleTask(env as any, { taskId, lane: "ops" });
    const runs = await all<any>(`SELECT backend_id, requested FROM backend_runs WHERE task_id = ?`, taskId);
    expect(runs.map((r) => r.backend_id), "the briefing reached Codex").not.toContain("bk_codex");
    expect(runs.filter((r) => r.backend_id === "bk_claude_code")).toHaveLength(1);
    expect(JSON.parse(runs[0].requested).backend_ladder).toEqual(["bk_claude_code"]);
    const step = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'ladder_step'`, taskId);
    expect(JSON.parse(step.detail).refused).toMatch(/privacy screen kept this prompt off Codex/);
  });

  it("with Claude's seat out, flagged work fails closed by name: never Codex, never a cloud rung", async () => {
    await env.DB.prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = 'usage limit' WHERE id = 'bk_claude_code'`).bind(Date.now() + 3600_000).run();
    const taskId = await insertTask({
      status: "queued", title: "Deal memo", intake_kind: "research", sensitivity: "public",
      input: JSON.stringify({ backend_ladder: ["bk_codex", "bk_claude_code"], cloud_fallback: true, prompt: "Summarise the capital commitment, the carried interest and the allocation of the Fund II subscription at a $40M valuation." }),
    });
    await handleTask(env as any, { taskId, lane: "ops" });
    expect(await all<any>(`SELECT 1 FROM backend_runs WHERE task_id = ? AND backend_id = 'bk_codex'`, taskId)).toHaveLength(0);
    expect(await all<any>(`SELECT 1 FROM routing_decisions WHERE task_id = ?`, taskId), "a cloud rung was asked").toHaveLength(0);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("failed");
  });

  it("NEGATIVE: a plain public prompt still goes to Codex first", async () => {
    const taskId = await insertTask({
      status: "queued", title: "Lighthouses", intake_kind: "research", sensitivity: "public",
      input: JSON.stringify({ backend_ladder: ["bk_claude_code", "bk_codex"], prompt: "In two sentences, explain what a lighthouse does." }),
    });
    await handleTask(env as any, { taskId, lane: "ops" });
    const run = await row<any>(`SELECT backend_id FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
    expect(run.backend_id).toBe("bk_codex");
  });
});
