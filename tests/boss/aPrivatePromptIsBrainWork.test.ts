import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { all, insertTask, row } from "./helpers";

const reset = () => env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', exhausted_until = NULL, exhausted_reason = NULL, spent_micros = 0, window_started_at = NULL WHERE id IN ('bk_claude_code','bk_codex')`).run();
beforeEach(reset);
afterEach(reset);

describe("subscription seats route by the work they can do", () => {
  it("keeps Claude and Codex in order for an unchecked executive briefing", async () => {
    await env.DB.prepare(`DELETE FROM tasks WHERE input LIKE '%executive_reports%'`).run();
    const out = await materialiseDueDuties(env as any, Date.now(), "duty_exec_intel");
    expect(out.fired, JSON.stringify(out.skipped)).toHaveLength(1);
    const taskId = out.fired[0]!.task_id!;
    await handleTask(env as any, { taskId, lane: "ops" });
    const runs = await all<any>(`SELECT backend_id, requested FROM backend_runs WHERE task_id = ?`, taskId);
    expect(runs.map((r) => r.backend_id)).toEqual(["bk_claude_code"]);
    expect(JSON.parse(runs[0].requested).backend_ladder).toEqual(["bk_claude_code", "bk_codex"]);
    expect(await all<any>(`SELECT 1 FROM task_events WHERE task_id = ? AND event = 'ladder_step'`, taskId)).toHaveLength(0);
  });

  it("a short research request with two subscription seats starts on Codex", async () => {
    const taskId = await insertTask({
      status: "queued", title: "Lighthouses", intake_kind: "research", sensitivity: "public",
      input: JSON.stringify({ backend_ladder: ["bk_claude_code", "bk_codex"], prompt: "In two sentences, explain what a lighthouse does." }),
    });
    await handleTask(env as any, { taskId, lane: "ops" });
    const run = await row<any>(`SELECT backend_id FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
    expect(run.backend_id).toBe("bk_codex");
  });
});
