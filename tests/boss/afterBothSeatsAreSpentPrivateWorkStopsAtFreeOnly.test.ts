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

async function expectParkedOnCodex(taskId: string, hosts: string[]) {
  expect(hosts, "a request left the Worker while Codex's limit was being waited out").toEqual([]);
  const runs = await all<any>(`SELECT backend_id, claimed_at, status, requested FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
  expect(runs, "the run was not parked on Codex's seat").toHaveLength(1);
  expect(runs[0].backend_id).toBe("bk_codex");
  expect(runs[0].claimed_at).toBeNull();
  expect(JSON.parse(runs[0].requested).codex_limit_waits).toBe(true);
  const steps = await all<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'ladder_step'`, taskId);
  expect(steps.map((x) => JSON.parse(x.detail).backend_id), "a seat after Codex was tried").not.toContain("bk_claude_code");
  const t = await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId);
  expect(t.status, "a Codex limit failed the task instead of waiting").not.toBe("failed");
  expect(await all<any>(`SELECT 1 FROM routing_decisions WHERE task_id = ?`, taskId), "a cloud rung was asked").toHaveLength(0);
  expect(await row(`SELECT 1 FROM approvals WHERE origin_id = ?`, taskId), "a spend card was raised").toBeNull();
}

describe("both seats out of usage: the work waits on Codex's seat (owner, 3 Nov 2026)", () => {
  it("the executive briefing is parked on Codex, never Claude, never the cloud, and no network call is made", async () => {
    await setLever("FREE_ONLY");
    await bothSeatsSpent();
    await env.DB.prepare(`DELETE FROM tasks WHERE input LIKE '%executive_reports%'`).run();
    const out = await materialiseDueDuties(env as any, NOW, "duty_exec_intel");
    expect(out.fired, JSON.stringify(out.skipped)).toHaveLength(1);
    const taskId = out.fired[0]!.task_id!;
    const hosts: string[] = [];
    restore = stubFetch((req) => { hosts.push(new URL(req.url).hostname); return completionResponse("must not be reached"); });
    await handleTask(withKey() as any, { taskId, lane: "ops" });
    await expectParkedOnCodex(taskId, hosts);
    expect(await row(`SELECT 1 FROM executive_reports WHERE task_id = ?`, taskId), "a report was written by nothing").toBeNull();
  });

  it("a private duty whose own ladder names Claude first still goes to Codex first and waits there", async () => {
    await setLever("FREE_ONLY");
    await bothSeatsSpent();
    const taskId = await insertTask({
      status: "queued", title: "Private analysis", intake_kind: "research", sensitivity: "private",
      input: JSON.stringify({ backend_ladder: ["bk_claude_code", "bk_codex"], prompt: "Summarise the LP commitment schedule." }),
    });
    const hosts: string[] = [];
    restore = stubFetch((req) => { hosts.push(new URL(req.url).hostname); return completionResponse("no"); });
    await handleTask(withKey() as any, { taskId, lane: "ops" });
    await expectParkedOnCodex(taskId, hosts);
  });

  it("public-safe work with cloud_fallback waits on Codex too: no free rung, no model called", async () => {
    await setLever("FREE_ONLY");
    await bothSeatsSpent();
    const taskId = await insertTask({
      status: "queued", title: "Explain a public concept", intake_kind: "research", sensitivity: "public",
      input: JSON.stringify({
        backend_ladder: ["bk_claude_code", "bk_codex"], cloud_fallback: true,
        prompt: "In two sentences, explain what a lighthouse does.",
      }),
    });
    const hosts: string[] = [];
    restore = stubFetch((req) => { hosts.push(new URL(req.url).hostname); return completionResponse("no"); });
    await handleTask(withKey() as any, { taskId, lane: "ops" });
    await expectParkedOnCodex(taskId, hosts);
  });

  it("NEGATIVE: an LP draft (Claude seat only) is never parked on Codex; with Claude spent it stops by name", async () => {
    await setLever("FREE_ONLY");
    await bothSeatsSpent();
    const taskId = await insertTask({
      status: "queued", title: "LP reply", intake_kind: "research", sensitivity: "private",
      input: JSON.stringify({ backend_ladder: ["bk_claude_code", "bk_codex"], draft_kind: "lp_reply", prompt: "Draft the reply." }),
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
});
