import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { REQUIRED_FORBIDDEN, workOnce } from "../../scripts/sync-agent/runner.mjs";
import { api, row } from "./helpers";
import agentSrc from "../../scripts/sync-agent/agent.mjs?raw";

/**
 * AN UNUSABLE ANSWER STEPS DOWN TO THE NEXT SEAT IN THE SAME RUN (25 Oct 2026).
 *
 * With "OpenAI goes first" on, the briefing parks for Codex. That morning Codex answered with no web
 * search, the run failed — and because its plan was not spent, nothing released it: the briefing
 * failed and "a retry is queued for your Mac's next slot", which walked straight back to Codex.
 * Claude, enabled and idle on the same Mac, was never asked. The briefing must never skip a day
 * because one seat failed.
 */

const NOW = Date.now();
async function seats(openaiFirst: boolean) {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', spent_micros = 0, window_started_at = NULL, monthly_ceiling_micros = 50000000, ceiling_source = 'stored', exhausted_until = NULL, exhausted_reason = NULL WHERE id = 'bk_claude_code'`).run();
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', spent_micros = 0, window_started_at = NULL, monthly_ceiling_micros = 0, exhausted_until = NULL, exhausted_reason = NULL WHERE id = 'bk_codex'`).run();
  await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('seat_order_openai_first',?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(openaiFirst ? "on" : "off", NOW).run();
}
beforeEach(() => seats(true));
afterEach(() => seats(false));

async function fireBriefing() {
  const out = await materialiseDueDuties(env as any, NOW, "duty_exec_intel");
  expect(out.fired, JSON.stringify(out.skipped)).toHaveLength(1);
  const taskId = out.fired[0]!.task_id!;
  await handleTask(env as any, { taskId, lane: "ops" });
  return taskId;
}

const packet = (runId: string, taskId: string, backend: string, status: "failed" | "succeeded", extra: Record<string, unknown> = {}) => ({
  run_id: runId, task_id: taskId, backend_id: backend, status, summary: status === "failed" ? "Changed nothing." : "Wrote the report.",
  files_touched: [], commands: [], checks_run: { run: 0, passed: 0, failed: 0, detail: [] }, remaining_risks: [], violations: [],
  rollback_ref: null, refusal_reason: null,
  error: status === "failed" ? "Codex answered without running a single web search, so what it wrote was not used." : null,
  cost_micros: 0, started_at: NOW, finished_at: NOW + 1000, seat_exhausted: null, ...extra,
});

const claim = (backend_id: string, fallback_from: string[] = []) =>
  api("/api/backends/claim", { method: "POST", body: { device_id: "dev_mac", backend_id, ...(fallback_from.length ? { fallback_from } : {}) } })
    .then(async (r) => ((await r.json()) as any).data);
const report = (evidence: Record<string, unknown>) =>
  api("/api/backends/report", { method: "POST", body: { device_id: "dev_mac", evidence } }).then(async (r) => ({ status: r.status, data: ((await r.json()) as any).data }));

describe("a seat that gives an unusable answer hands the run to the next seat at once", () => {
  it("Codex answers with no searches → released AND re-parked on Claude → Claude claims it with no fallback_from → Claude delivers", async () => {
    const taskId = await fireBriefing();
    const parked = await row<any>(`SELECT id, backend_id FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
    expect(parked.backend_id, "OpenAI-first did not park the briefing on Codex").toBe("bk_codex");

    const first = await claim("bk_codex");
    expect(first.run?.run_id).toBe(parked.id);
    const rep = await report(packet(parked.id, taskId, "bk_codex", "failed"));
    expect(rep.status).toBe(200);
    expect(rep.data.released, "a failed Codex run was not handed down — the briefing would skip the day").toBe(true);
    expect(rep.data.next_seat).toBe("bk_claude_code");

    const run = await row<any>(`SELECT status, backend_id, claimed_at, finished_at, requested FROM backend_runs WHERE id = ?`, parked.id);
    expect(run).toMatchObject({ status: "running", backend_id: "bk_claude_code", claimed_at: null, finished_at: null });
    expect(JSON.parse(run.requested).ladder_released).toEqual(["bk_codex"]);
    // A bad answer is not a spent plan: Codex is NOT stamped out for tomorrow.
    expect((await row<any>(`SELECT exhausted_until FROM execution_backends WHERE id = 'bk_codex'`)).exhausted_until).toBeNull();
    const ev = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'ladder_release'`, taskId);
    expect(JSON.parse(ev.detail).why).toMatch(/unusable answer: Codex answered without running a single web search/);

    // Claude, on the same Mac, asking only for its own work, gets it.
    const second = await claim("bk_claude_code");
    expect(second.run?.run_id, "Claude was not handed the run").toBe(parked.id);
    expect(second.run.backend_id).toBe("bk_claude_code");
    const done = await report(packet(parked.id, taskId, "bk_claude_code", "succeeded"));
    expect(done.status).toBe(200);
    expect((await row<any>(`SELECT status, backend_id FROM backend_runs WHERE id = ?`, parked.id))).toMatchObject({ status: "succeeded", backend_id: "bk_claude_code" });
  });

  it("is BOUNDED: Claude failing too fails the run — it never goes back up to Codex", async () => {
    const taskId = await fireBriefing();
    const runId = (await claim("bk_codex")).run.run_id as string;
    await report(packet(runId, taskId, "bk_codex", "failed"));
    await claim("bk_claude_code");
    const last = await report(packet(runId, taskId, "bk_claude_code", "failed"));
    expect(last.data.released).not.toBe(true);
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, runId)).status).toBe("failed");
  });

  it("never releases a failure that broke a rule", async () => {
    const taskId = await fireBriefing();
    const runId = (await claim("bk_codex")).run.run_id as string;
    const last = await report(packet(runId, taskId, "bk_codex", "failed", { violations: [{ action: "push" }] }));
    expect(last.data.released).not.toBe(true);
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, runId)).status).toBe("failed");
  });
});

describe("the Mac's runner tells the agent a run was released, so it claims again in the same cycle", () => {
  const ENVELOPE = {
    run_id: "run_rel", task_id: "task_rel", backend_id: "bk_codex", envelope_id: "env_rel", approved: true, approval_receipt: "rcpt",
    kind: "research", repo_path: "/tmp/reports", allowed_paths: ["/tmp/reports"], instruction: "Write the report.",
    instruction_origin: "standing_duty", verification: [], forbidden_actions: [...REQUIRED_FORBIDDEN],
    allowed_kinds: ["research"], capabilities: ["research"], credential_ref: "local:codex", max_seconds: 60,
  };
  const CLEAN = { head: "a", branch: "w", upstream: "b", dirty: false, changed_files: [] };
  const failingCodex = async () => ({ summary: "Changed nothing.", exit_code: 0, commands: [], files_touched: [], cost_micros: 0, remaining_risks: [], error: "Codex answered without running a single web search.", search_refused: true });
  const fakeCloud = (reportAnswer: Record<string, unknown>) => (async (url: string) =>
    new Response(JSON.stringify({ ok: true, data: url.endsWith("/claim") ? { run: ENVELOPE } : reportAnswer }))) as unknown as typeof fetch;

  it("workOnce surfaces released + next_seat from the cloud's answer", async () => {
    const out = await workOnce({ origin: "https://boss.test", deviceId: "d", backendId: "bk_codex", fetchImpl: fakeCloud({ released: true, next_seat: "bk_claude_code" }), execute: failingCodex, gitProbe: async () => CLEAN } as any);
    expect(out.claimed).toBe(true);
    expect(out.evidence?.status).toBe("failed");
    expect((out as any).released).toBe(true);
    expect((out as any).next_seat).toBe("bk_claude_code");
  });

  it("and says not-released when the cloud filed the failure", async () => {
    const out = await workOnce({ origin: "https://boss.test", deviceId: "d", backendId: "bk_codex", fetchImpl: fakeCloud({ released: false }), execute: failingCodex, gitProbe: async () => CLEAN } as any);
    expect((out as any).released).toBe(false);
  });

  it("the agent's work-once loops on a released run (read from the shipped agent, bounded by the seat count)", () => {
    expect(agentSrc).toMatch(/for \(let hops = 0; out\.released && hops < seats\.length; hops\+\+\)/);
    expect(agentSrc).toMatch(/out = await runCycle\(\);/);
  });
});
