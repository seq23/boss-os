import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { all, insertTask, row } from "./helpers";

/**
 * A PROMPT THE PRIVACY SCREEN FLAGS IS PRIVATE WORK (3 Nov 2026; routes by ability, 13 Nov 2026). A seat
 * prompt carrying deal material, an LP or investor term, a private name or children's data never
 * reaches a free or cloud route, fail closed. It walks its row of aiRoles.mjs ROUTE_TABLE: Claude's
 * seat first, Codex's as the backup for short and clear-brief work, Claude's seat only for hard work.
 */
const DEAL = "Summarise the capital commitment, the carried interest and the allocation of the Fund II subscription at a $40M valuation.";
const reset = () => env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', exhausted_until = NULL, exhausted_reason = NULL, spent_micros = 0, window_started_at = NULL WHERE id IN ('bk_claude_code','bk_codex')`).run();
beforeEach(reset);
afterEach(reset);

describe("the privacy screen runs before a worker is chosen", () => {
  // 13 Nov 2026: the briefing's own spec text is the repository's, not deal material, so it is not
  // brain work (it failed that morning while Claude's seat was out). Her edited prompt is still
  // scanned in full: tests/boss/theBriefingWalksTheLadder.test.ts.
  it("Camille's briefing, whose spec text only LOOKS like deal material, goes to Codex first with no privacy refusal", async () => {
    await env.DB.prepare(`DELETE FROM tasks WHERE input LIKE '%executive_reports%'`).run();
    const out = await materialiseDueDuties(env as any, Date.now(), "duty_exec_intel");
    expect(out.fired, JSON.stringify(out.skipped)).toHaveLength(1);
    const taskId = out.fired[0]!.task_id!;
    await handleTask(env as any, { taskId, lane: "ops" });
    const runs = await all<any>(`SELECT backend_id, requested FROM backend_runs WHERE task_id = ?`, taskId);
    expect(runs.map((r) => r.backend_id)).toEqual(["bk_codex"]);
    expect(JSON.parse(runs[0].requested).backend_ladder).toEqual(["bk_codex", "bk_claude_code"]);
    expect(await all<any>(`SELECT 1 FROM task_events WHERE task_id = ? AND event = 'ladder_step'`, taskId)).toHaveLength(0);
  });

  /*
   * OWNER, 13 Nov 2026 ("all private stuff can go through codex i need a backup to claude"): flagged
   * work is private work. Short and clear-brief private work has Claude's seat, then Codex's as the
   * backup; hard private work has Claude's seat only and waits for it. No private work ever reaches a
   * free or cloud route (also tests/boss/abilityRouting.test.ts).
   */
  it("with Claude's seat out, flagged short work goes to Codex as the backup: never a cloud rung", async () => {
    await env.DB.prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = 'usage limit' WHERE id = 'bk_claude_code'`).bind(Date.now() + 3600_000).run();
    const taskId = await insertTask({
      status: "queued", title: "Deal memo", intake_kind: "research", sensitivity: "public",
      input: JSON.stringify({ backend_ladder: ["bk_codex", "bk_claude_code"], cloud_fallback: true, prompt: DEAL }),
    });
    await handleTask(env as any, { taskId, lane: "ops" });
    const runs = await all<any>(`SELECT backend_id, requested FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
    expect(runs.map((r) => r.backend_id)).toEqual(["bk_codex"]);
    expect(JSON.parse(runs[0].requested).backend_ladder, "Claude's seat is asked first").toEqual(["bk_claude_code", "bk_codex"]);
    expect(await all<any>(`SELECT 1 FROM routing_decisions WHERE task_id = ?`, taskId), "a cloud rung was asked").toHaveLength(0);
  });

  it("with both seats out, flagged work fails closed by name: never a cloud rung, whatever the task asks for", async () => {
    await env.DB.prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = 'usage limit' WHERE id IN ('bk_claude_code','bk_codex')`).bind(Date.now() + 3600_000).run();
    const taskId = await insertTask({
      status: "queued", title: "Deal memo", intake_kind: "research", sensitivity: "public",
      input: JSON.stringify({ backend_ladder: ["bk_codex", "bk_claude_code"], cloud_fallback: true, prompt: DEAL }),
    });
    await handleTask(env as any, { taskId, lane: "ops" });
    expect(await all<any>(`SELECT 1 FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId)).toHaveLength(0);
    expect(await all<any>(`SELECT 1 FROM routing_decisions WHERE task_id = ?`, taskId), "a cloud rung was asked").toHaveLength(0);
    const t = await row<any>(`SELECT status, error FROM tasks WHERE id = ?`, taskId);
    expect(t.status).toBe("failed");
    expect(t.error).toMatch(/never a free or cloud route/);
  });

  /*
   * THE SHAPE THAT FAILED "Executive Intelligence Report" (tsk_m7acfrx3r2hc788m, 13 Nov 2026 12:00 UTC):
   * a duty's run, flagged by the privacy screen; Claude's plan spent for 57 minutes. It was failed
   * outright although the refusal itself said "tried again in about 57 minutes". HARD private work
   * Boss OS started itself WAITS for that seat's reset (waitForUsage): queued, a USAGE_LIMIT named
   * stop with Claude's reset, never Codex (free and on the ladder here), never a cloud rung, no email.
   */
  it("a duty's flagged hard run with Claude's seat spent waits for that seat's reset: never failed, never Codex", async () => {
    const resetAt = Date.now() + 57 * 60_000;
    await env.DB.prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = 'You have hit your weekly limit' WHERE id = 'bk_claude_code'`).bind(resetAt).run();
    const taskId = await insertTask({
      status: "queued", title: "Duty deal memo", intake_kind: "decision_support", sensitivity: "public",
      input: JSON.stringify({ duty_id: "duty_test_flagged", backend_ladder: ["bk_codex", "bk_claude_code"], cloud_fallback: false, prompt: DEAL }),
    });
    await env.DB.prepare(`UPDATE tasks SET model_access = 'public_model_approved' WHERE id = ?`).bind(taskId).run();
    await handleTask(env as any, { taskId, lane: "ops" });
    expect(await all<any>(`SELECT 1 FROM backend_runs WHERE task_id = ? AND backend_id = 'bk_codex'`, taskId), "flagged hard work reached Codex").toHaveLength(0);
    expect(await all<any>(`SELECT 1 FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId), "a run was parked on a spent seat").toHaveLength(0);
    expect(await all<any>(`SELECT 1 FROM routing_decisions WHERE task_id = ?`, taskId), "a cloud rung was asked").toHaveLength(0);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("queued");
    const stop = JSON.parse((await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'named_stop' ORDER BY ts DESC LIMIT 1`, taskId)).detail);
    expect(stop.code).toBe("USAGE_LIMIT");
    expect(stop.resume_at).toBe(resetAt);
    expect(await all<any>(`SELECT kind, needs_her FROM boss_task_notices WHERE task_id = ?`, taskId)).toEqual([{ kind: "stop:USAGE_LIMIT", needs_her: 0 }]);
  });

  it("NEGATIVE: the same flagged hard work with Claude's seat spent, asked for by her, waits for Claude by name: never Codex, never failed", async () => {
    const resetAt = Date.now() + 57 * 60_000;
    await env.DB.prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = 'You have hit your weekly limit' WHERE id = 'bk_claude_code'`).bind(resetAt).run();
    const taskId = await insertTask({
      status: "queued", title: "Her deal memo", intake_kind: "decision_support", sensitivity: "public",
      input: JSON.stringify({ mail_id: "iml_test_hers", from: "owner@example.test", backend_ladder: ["bk_codex", "bk_claude_code"], cloud_fallback: false, prompt: DEAL }),
    });
    await env.DB.prepare(`UPDATE tasks SET model_access = 'public_model_approved' WHERE id = ?`).bind(taskId).run();
    await handleTask(env as any, { taskId, lane: "ops" });
    expect(await all<any>(`SELECT 1 FROM backend_runs WHERE task_id = ? AND backend_id = 'bk_codex'`, taskId)).toHaveLength(0);
    expect(await all<any>(`SELECT 1 FROM routing_decisions WHERE task_id = ?`, taskId), "a cloud rung was asked").toHaveLength(0);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("queued");
    const stop = JSON.parse((await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'named_stop' ORDER BY ts DESC LIMIT 1`, taskId)).detail);
    expect(stop.code).toBe("WAITING_FOR_CLAUDE");
    expect(stop.resume_at).toBe(resetAt);
    expect(stop.why).toMatch(/bk_claude_code: .*out of usage/);
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
