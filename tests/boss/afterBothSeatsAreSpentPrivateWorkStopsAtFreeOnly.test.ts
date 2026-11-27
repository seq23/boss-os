import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { all, completionResponse, insertTask, row, stubFetch } from "./helpers";

/** Exercises the queue and router with both subscription seats exhausted. */
let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const NOW = Date.now();

async function setLever(value: string) {
  await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('spend_lever',?,?)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(value, Date.now()).run();
}
/** Both seats report "out of usage", the way a real report stamps them (routes/backends.ts). */
async function bothSeatsSpent() {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', exhausted_until = ?, exhausted_reason = 'You have hit your usage limit' WHERE id IN ('bk_claude_code','bk_codex')`)
    .bind(NOW + 3 * 3600_000).run();
}
async function seatsReset() {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', exhausted_until = NULL, exhausted_reason = NULL, spent_micros = 0, window_started_at = NULL WHERE id IN ('bk_claude_code','bk_codex')`).run();
  await env.DB.prepare(`DELETE FROM settings WHERE key = 'spend_lever'`).run();
}
function withKey() {
  const e = Object.create(env) as typeof env;
  (e as any).OPENROUTER_API_KEY = "test-key";
  (e as any).ANTHROPIC_API_KEY = "test-key";
  (e as any).OPENAI_API_KEY = "test-key";
  return e;
}

beforeEach(async () => { await seatsReset(); });
afterEach(async () => { await seatsReset(); });


describe("both subscription seats are out of usage", () => {
  it("the executive briefing walks her two seats only: with both out of usage it WAITS for the earliest reset — no run parked on a spent seat, never a cloud rung, no network call, no email to her (13 Nov 2026)", async () => {
    await setLever("OPEN");
    await bothSeatsSpent();
    await env.DB.prepare(`DELETE FROM tasks WHERE input LIKE '%executive_reports%'`).run();
    const out = await materialiseDueDuties(env as any, NOW, "duty_exec_intel");
    expect(out.fired, JSON.stringify(out.skipped)).toHaveLength(1);
    const taskId = out.fired[0]!.task_id!;
    const hosts: string[] = [];
    restore = stubFetch((req) => { hosts.push(new URL(req.url).hostname); return completionResponse("must not be reached"); });
    await handleTask(withKey() as any, { taskId, lane: "ops" });
    expect(hosts).toEqual([]);
    expect(await all<any>(`SELECT 1 FROM backend_runs WHERE task_id = ? AND backend_id = 'bk_codex'`, taskId), "the briefing reached Codex").toHaveLength(0);
    expect(await all<any>(`SELECT 1 FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId), "a run was parked on a spent seat").toHaveLength(0);
    expect(await all<any>(`SELECT 1 FROM routing_decisions WHERE task_id = ?`, taskId), "a cloud rung was asked").toHaveLength(0);
    // Boss OS started it, so out of usage is a wait: back in the queue for the reset, not failed.
    const t = await row<any>(`SELECT status, error, input FROM tasks WHERE id = ?`, taskId);
    expect(t.status).toBe("queued");
    expect(JSON.parse(t.input).duty_id, "the run does not say which duty started it").toBe("duty_exec_intel");
    const stop = JSON.parse((await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'named_stop' ORDER BY ts DESC LIMIT 1`, taskId)).detail);
    expect(stop.code).toBe("USAGE_LIMIT");
    expect(stop.resume_at).toBe(NOW + 3 * 3600_000);
    expect(stop.why).toMatch(/bk_claude_code: .*out of usage/);
    // She is not emailed and is not asked to restart it: one row on the Updates page, nothing else.
    const notices = await all<any>(`SELECT kind, needs_her FROM boss_task_notices WHERE task_id = ?`, taskId);
    expect(notices).toEqual([{ kind: "stop:USAGE_LIMIT", needs_her: 0 }]);
    // A second attempt while the seats are still out waits again and writes no second row.
    await handleTask(withKey() as any, { taskId, lane: "ops" });
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("queued");
    expect(await all<any>(`SELECT 1 FROM boss_task_notices WHERE task_id = ?`, taskId)).toHaveLength(1);
    expect(await all<any>(`SELECT 1 FROM boss_task_notices WHERE kind = 'duty_not_running' AND task_id = 'duty_exec_intel'`), "an alarm on day one").toHaveLength(0);
  });

  it("only after 2 days running without a run does ONE alarm reach her for the duty, not one per attempt; a finished run ends it", async () => {
    await setLever("OPEN");
    await bothSeatsSpent();
    await env.DB.prepare(`DELETE FROM tasks WHERE input LIKE '%executive_reports%'`).run();
    await env.DB.prepare(`DELETE FROM boss_task_notices WHERE task_id = 'duty_exec_intel'`).run();
    const out = await materialiseDueDuties(env as any, NOW, "duty_exec_intel");
    const taskId = out.fired[0]!.task_id!;
    restore = stubFetch(() => completionResponse("must not be reached"));
    // The same run, first made a day ago and still waiting: the duty has missed two days running.
    await env.DB.prepare(`UPDATE tasks SET created_at = ? WHERE id = ?`).bind(Date.now() - 25 * 3600_000, taskId).run();
    await handleTask(withKey() as any, { taskId, lane: "ops" });
    await handleTask(withKey() as any, { taskId, lane: "ops" });
    const alarms = await all<any>(`SELECT from_name, needs_her, subject, body FROM boss_task_notices WHERE kind = 'duty_not_running' AND task_id = 'duty_exec_intel'`);
    expect(alarms, "one per duty, not one per attempt").toHaveLength(1);
    expect(alarms[0].needs_her).toBe(1);
    expect(alarms[0].from_name).toBe("Kendra");
    expect(alarms[0].body).toMatch(/^What broke: .*has not run for 2 days/);
    expect(alarms[0].body).toMatch(/^What is being done: .*by itself/m);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("queued");
    // No "stopped" email asking her to restart it, on any attempt.
    expect(await all<any>(`SELECT 1 FROM boss_task_notices WHERE task_id = ? AND needs_her = 1`, taskId)).toHaveLength(0);
  });

  it("public-safe work is answered by a :free rung at $0 — never Claude, never paid", async () => {
    await setLever("FREE_ONLY");
    await bothSeatsSpent();
    const taskId = await insertTask({
      status: "queued", title: "Explain a public concept", intake_kind: "research", sensitivity: "public",
      input: JSON.stringify({ backend_ladder: ["bk_claude_code", "bk_codex"], cloud_fallback: true, prompt: "In two sentences, explain what a lighthouse does." }),
    });
    const models: string[] = [];
    restore = stubFetch(async (req) => {
      const body = await req.clone().json().catch(() => ({} as any));
      models.push(String((body as any).model ?? ""));
      return completionResponse("A lighthouse warns ships of hazards. It also marks a safe harbour.", 20, 15);
    });
    await handleTask(withKey() as any, { taskId, lane: "ops" });
    expect(models.length, "no cloud lane answered public work").toBeGreaterThan(0);
    for (const m of models) expect(m, `a paid model answered: ${m}`).toMatch(/:free$/);
    expect(await all<any>(`SELECT 1 FROM backend_runs WHERE task_id = ? AND backend_id = 'bk_claude_code'`, taskId)).toHaveLength(0);
    const d = await row<any>(`SELECT chosen_model_id FROM routing_decisions WHERE task_id = ? ORDER BY ts DESC LIMIT 1`, taskId);
    const chosen = await row<any>(`SELECT slug, in_micros_1k, out_micros_1k FROM models WHERE id = ?`, d.chosen_model_id);
    expect(chosen.in_micros_1k + chosen.out_micros_1k).toBe(0);
  });

  it.each(["FREE_ONLY", "OPEN"])("a short deal summary uses a zero-cost fallback at %s", async (lever) => {
    await setLever(lever);
    await bothSeatsSpent();
    const prompt = "Summarise the commitment and quoted price in the fictional deal email.";
    const taskId = await insertTask({
      title: "Deal summary", status: "queued", intake_kind: "drafting", sensitivity: "private",
      input: JSON.stringify({ backend_ladder: ["bk_claude_code", "bk_codex"], cloud_fallback: true, prompt }),
    });
    const calls: { model: string; messages: unknown }[] = [];
    restore = stubFetch(async (req) => {
      calls.push(await req.json() as (typeof calls)[number]);
      return completionResponse("Here is the summary.", 20, 15);
    });
    await handleTask(withKey(), { taskId, lane: "ops" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.model).toMatch(/:free$/);
    expect(JSON.stringify(calls[0]!.messages)).toContain(prompt);
    expect(await row(`SELECT id FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId)).toBeNull();
    const decision = await row<{ chosen_model_id: string }>(
      `SELECT chosen_model_id FROM routing_decisions WHERE task_id = ? ORDER BY ts DESC LIMIT 1`, taskId,
    );
    expect(await row(`SELECT in_micros_1k + out_micros_1k AS price FROM models WHERE id = ?`, decision!.chosen_model_id))
      .toEqual({ price: 0 });
  });
});
