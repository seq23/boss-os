import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { all, completionResponse, insertTask, row, stubFetch } from "./helpers";

/**
 * "IF BOTH SEATS ARE GONE THEN WE STAY CHEAPO MODE ($0) UNLESS OTHERWISE ASKED."
 *
 * The whole end of the ladder, proven end to end with the shipped consumer, the shipped guard and the
 * shipped router — nothing stubbed but the network, and the network is asserted UNTOUCHED:
 *
 *   Free only + private work + Claude Code out of usage + Codex out of usage
 *     → the task stops, in words that name the two spent seats and the lever,
 *       no request leaves the Worker, no paid model is chosen, and no free lane sees the text.
 *   The same two spent seats, public-safe work → a `:free` rung answered, at $0 — until 3 Nov 2026.
 *
 * OWNER, 3 Nov 2026 ("default OpenAI and Claude just be the brains"): Codex is the worker for every
 * employee duty and a Codex limit WAITS for its reset — never Claude, never a cloud rung. So with
 * Codex's plan spent the run is parked on Codex's seat (`codex_limit_waits`), unclaimed, the task is
 * not failed, nothing leaves the Worker, and no other seat or rung ever sees it.
 */

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


describe("both seats out of usage: the work waits on Codex's seat (owner, 3 Nov 2026)", () => {
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

  // 13 Nov 2026: an LP draft is private HARD work. It has one route, Claude's seat, and WAITS for it by
  // name where she can see it; it is never failed, never moved to Codex or a cloud route.
  it("NEGATIVE: the same refusal on an LP draft she asked for herself waits for Claude by name and tells her", async () => {
    await setLever("OPEN");
    await bothSeatsSpent();
    const taskId = await insertTask({
      status: "queued", title: "Her own private ask", intake_kind: "research", sensitivity: "private",
      input: JSON.stringify({ from: "owner@example.test", mail_id: "iml_test_hers", backend_ladder: ["bk_claude_code", "bk_codex"], draft_kind: "lp_reply", lp_committed: true, prompt: "Draft the reply." }),
    });
    const hosts: string[] = [];
    restore = stubFetch((req) => { hosts.push(new URL(req.url).hostname); return completionResponse("no"); });
    await handleTask(withKey() as any, { taskId, lane: "ops" });
    expect(hosts).toEqual([]);
    expect(await all<any>(`SELECT 1 FROM backend_runs WHERE task_id = ? AND backend_id = 'bk_codex'`, taskId)).toHaveLength(0);
    expect(await all<any>(`SELECT 1 FROM routing_decisions WHERE task_id = ?`, taskId)).toHaveLength(0);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("queued");
    const stop = JSON.parse((await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'named_stop' ORDER BY ts DESC LIMIT 1`, taskId)).detail);
    expect(stop.code).toBe("WAITING_FOR_CLAUDE");
    expect(stop.resume_at).toBe(NOW + 3 * 3600_000);
    expect((await all<any>(`SELECT kind FROM boss_task_notices WHERE task_id = ?`, taskId)).map((n) => n.kind)).toEqual(["stop:WAITING_FOR_CLAUDE"]);
  });

  it("a duty whose prompt names an LP commitment is brain work too: Claude only, fails closed by name", async () => {
    await setLever("FREE_ONLY");
    await bothSeatsSpent();
    const taskId = await insertTask({
      status: "queued", title: "Private analysis", intake_kind: "research", sensitivity: "private",
      input: JSON.stringify({ backend_ladder: ["bk_claude_code", "bk_codex"], prompt: "Summarise the LP commitment schedule." }),
    });
    const hosts: string[] = [];
    restore = stubFetch((req) => { hosts.push(new URL(req.url).hostname); return completionResponse("no"); });
    await handleTask(withKey() as any, { taskId, lane: "ops" });
    expect(hosts).toEqual([]);
    expect(await all<any>(`SELECT 1 FROM backend_runs WHERE task_id = ? AND backend_id = 'bk_codex'`, taskId)).toHaveLength(0);
    const t = await row<any>(`SELECT status, error FROM tasks WHERE id = ?`, taskId);
    expect(t.status).toBe("failed");
    expect(t.error).toMatch(/bk_claude_code: .*out of usage/);
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

  it("NEGATIVE: an LP draft (Claude seat only) is never parked on Codex; with Claude spent it waits for Claude by name", async () => {
    await setLever("FREE_ONLY");
    await bothSeatsSpent();
    const taskId = await insertTask({
      status: "queued", title: "LP reply", intake_kind: "research", sensitivity: "private",
      input: JSON.stringify({ backend_ladder: ["bk_claude_code", "bk_codex"], draft_kind: "lp_reply", lp_committed: true, prompt: "Draft the reply." }),
    });
    const hosts: string[] = [];
    restore = stubFetch((req) => { hosts.push(new URL(req.url).hostname); return completionResponse("no"); });
    await handleTask(withKey() as any, { taskId, lane: "ops" });
    expect(hosts).toEqual([]);
    expect(await all<any>(`SELECT 1 FROM backend_runs WHERE task_id = ? AND backend_id = 'bk_codex'`, taskId)).toHaveLength(0);
    expect(await all<any>(`SELECT 1 FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId), "a run was parked on a spent seat").toHaveLength(0);
    expect(await all<any>(`SELECT 1 FROM routing_decisions WHERE task_id = ?`, taskId)).toHaveLength(0);
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("queued");
    const stop = JSON.parse((await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'named_stop' ORDER BY ts DESC LIMIT 1`, taskId)).detail);
    expect(stop.code).toBe("WAITING_FOR_CLAUDE");
    expect(stop.why).toMatch(/bk_claude_code: .*out of usage/);
    expect(stop.why).toMatch(/Never Codex, never a free or cloud route/);
  });
});
