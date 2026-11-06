import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { all, api, insertTask, row } from "./helpers";

/**
 * A SEAT WHOSE PLAN RUNS OUT MID-RUN HANDS THE RUN TO THE OTHER SEAT — AND THE OTHER FOUR DUTIES
 * HAVE AN OTHER SEAT TO HAND IT TO (29 Sep 2026, migrations 0274 and 0275).
 *
 * Before: five duties run on the Claude seat; only the briefing named Codex. So on a day her Claude
 * plan was spent, four of them failed with `bk_codex` enabled, priced and idle beside them, and even
 * the briefing only walked to Codex at DISPATCH (a spent ceiling in this system's own ledger) — never
 * when the plan ran out UNDER a run, because the runner had no idea and the report route had no way
 * to say "put this back".
 *
 * Every step below runs the shipped materialiser, consumer, claim route and report route against the
 * real migrated database. Nothing here starts a CLI or spends anything.
 */

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const NOW = Date.now();
const FOUR = ["duty_brokerage_sourcing", "duty_link_prospects", "duty_practice_week", "duty_tool_scout"];

async function seatsReset() {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', spent_micros = 0, window_started_at = NULL, monthly_ceiling_micros = 50000000, ceiling_source = 'stored', exhausted_until = NULL, exhausted_reason = NULL WHERE id = 'bk_claude_code'`).run();
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled', spent_micros = 0, window_started_at = NULL, monthly_ceiling_micros = 0, exhausted_until = NULL, exhausted_reason = NULL WHERE id = 'bk_codex'`).run();
}
beforeEach(seatsReset);
afterEach(seatsReset);

async function fire(dutyId: string): Promise<{ taskId: string }> {
  const out = await materialiseDueDuties(env as any, NOW, dutyId);
  expect(out.fired, `${dutyId} did not fire: ${JSON.stringify(out.skipped)}`).toHaveLength(1);
  const taskId = out.fired[0]!.task_id;
  expect(taskId).toBeTypeOf("string");
  await handleTask(env as any, { taskId: taskId!, lane: "ops" });
  return { taskId: taskId! };
}

const claim = (backend_id: string, fallback_from: string[] = []) =>
  api("/api/backends/claim", { method: "POST", body: { device_id: "dev_test", backend_id, ...(fallback_from.length ? { fallback_from } : {}) } }).then(async (r) => ({ status: r.status, data: (await r.json() as any).data }));

const spentPacket = (runId: string, taskId: string, backend: string) => ({
  device_id: "dev_test",
  evidence: {
    run_id: runId, task_id: taskId, backend_id: backend, status: "failed", summary: "usage limit reached",
    files_touched: [], commands: [], checks_run: { run: 0, passed: 0, failed: 0, detail: [] }, remaining_risks: [], violations: [],
    rollback_ref: null, refusal_reason: null, error: `${backend} has run out of usage and said: usage limit reached`, cost_micros: 0,
    started_at: NOW, finished_at: NOW + 1000,
    seat_exhausted: { notice: "usage limit reached", retry_after_seconds: 3600 },
  },
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("0275 — the four other seat duties walk Claude Code, then Codex", () => {
  it("carries the ladder on each, with each duty's own Claude model kept and Codex left on its default", async () => {
    for (const id of FOUR) {
      const d = await row<any>(`SELECT task_input FROM standing_duties WHERE id = ?`, id);
      const input = JSON.parse(d.task_input);
      expect(input.backend_ladder, id).toEqual(["bk_claude_code", "bk_codex"]);
      expect(input.requested.model_by_backend, id).toEqual({ bk_claude_code: input.requested.model, bk_codex: null });
      expect(input.requested.model, `${id} lost its model`).toBeTruthy();
      // These read the live web and a cloud completion cannot: no cloud rungs beneath the seats.
      expect(input.cloud_fallback, `${id} must not fall to a model that cannot open a page`).toBeUndefined();
    }
  });

  it("leaves every duty that is not a seat duty as it was; the briefing is OpenAI first and never falls to the cloud (0298)", async () => {
    const briefing = JSON.parse((await row<any>(`SELECT task_input FROM standing_duties WHERE id = 'duty_exec_intel'`)).task_input);
    expect(briefing.backend_ladder).toEqual(["bk_codex", "bk_claude_code"]);
    expect(briefing.cloud_fallback).toBe(false);
    const others = await all<any>(`SELECT id, task_input FROM standing_duties WHERE id NOT IN (${["duty_exec_intel", ...FOUR].map(() => "?").join(",")})`, "duty_exec_intel", ...FOUR);
    expect(others.length).toBeGreaterThan(10);
    for (const d of others) expect(JSON.parse(d.task_input ?? "{}").backend_ladder, d.id).toBeUndefined();
  });

  it("owner, 3 Nov 2026: a fired seat duty parks for Codex first, on Codex's own default, marked to wait out a Codex limit", async () => {
    const { taskId } = await fire("duty_tool_scout");
    const run = await row<any>(`SELECT backend_id, requested FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
    expect(run.backend_id).toBe("bk_codex");
    const requested = JSON.parse(run.requested);
    expect(requested.backend_ladder).toEqual(["bk_codex", "bk_claude_code"]);
    expect(requested.model, "a Claude model id reached the Codex seat").toBeUndefined();
    expect(requested.codex_limit_waits).toBe(true);
  });

  it("the old \"OpenAI first\" switch no longer reorders: OFF, the duty is still Codex first", async () => {
    await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('seat_order_openai_first','off',?) ON CONFLICT(key) DO UPDATE SET value = 'off'`).bind(Date.now()).run();
    const { taskId } = await fire("duty_tool_scout");
    const run = await row<any>(`SELECT backend_id, requested FROM backend_runs WHERE task_id = ? AND status = 'running' ORDER BY started_at DESC`, taskId);
    expect(run.backend_id).toBe("bk_codex");
    expect(JSON.parse(run.requested).backend_ladder).toEqual(["bk_codex", "bk_claude_code"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("a Codex limit UNDER a run waits for the reset — never Claude (owner, 3 Nov 2026)", () => {
  it("Codex claims, reports its plan spent → the run waits on Codex, unclaimed; Claude may not take it; Codex takes it after the reset and succeeds", async () => {
    const { taskId } = await fire("duty_tool_scout");
    const first = await claim("bk_codex");
    const runId = first.data.run.run_id as string;

    const rep = await api("/api/backends/report", { method: "POST", body: spentPacket(runId, taskId, "bk_codex") });
    expect(rep.status, await rep.clone().text()).toBe(200);

    // Not failed, not finished, still Codex's: back in the queue, unclaimed.
    const run = await row<any>(`SELECT status, claimed_at, finished_at, backend_id FROM backend_runs WHERE id = ?`, runId);
    expect(run.status).toBe("running");
    expect(run.claimed_at).toBeNull();
    expect(run.finished_at).toBeNull();
    expect(run.backend_id).toBe("bk_codex");
    expect((await rep.clone().json() as any).data.outcome_class).toBe("waiting_for_reset");
    expect(await row(`SELECT 1 FROM task_events WHERE task_id = ? AND event = 'codex_limit_wait'`, taskId)).not.toBeNull();
    const stamped = await row<any>(`SELECT exhausted_until FROM execution_backends WHERE id = 'bk_codex'`);
    expect(stamped.exhausted_until).toBeGreaterThan(Date.now());

    // Claude, even told Codex is out, is not handed it.
    expect((await claim("bk_claude_code", ["bk_codex"])).data.run, "a Codex-limited run went to Claude").toBeNull();
    expect(await row(`SELECT 1 FROM task_events WHERE task_id = ? AND event = 'ladder_handoff'`, taskId)).toBeNull();

    // The reset: Codex takes it and finishes it.
    await env.DB.prepare(`UPDATE execution_backends SET exhausted_until = NULL, exhausted_reason = NULL WHERE id = 'bk_codex'`).run();
    const second = await claim("bk_codex");
    expect(second.data.run?.run_id).toBe(runId);
    const done = await api("/api/backends/report", {
      method: "POST",
      body: {
        device_id: "dev_test",
        evidence: {
          run_id: runId, task_id: taskId, backend_id: "bk_codex", status: "succeeded", summary: "Codex wrote it.",
          files_touched: [], commands: [], checks_run: { run: 0, passed: 0, failed: 0, detail: [] }, remaining_risks: [], violations: [],
          rollback_ref: null, refusal_reason: null, error: null, cost_micros: 0, started_at: NOW, finished_at: NOW + 1000, seat_exhausted: null,
        },
      },
    });
    expect(done.status, await done.clone().text()).toBe(200);
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, runId)).status).toBe("succeeded");
  });

  it("never releases a run whose ladder does not name a later seat — a laddered-less run fails as it always did", async () => {
    // A Claude-only task (an LP draft) is the one ladder with no seat after Claude's.
    const taskId = await insertTask({ status: "queued", title: "No ladder", input: JSON.stringify({ backend_id: "bk_claude_code", delivers: "tool_suggestions", draft_kind: "lp_reply", lp_committed: true }), intake_kind: "research" });
    await handleTask(env as any, { taskId, lane: "ops" });
    const runId = (await claim("bk_claude_code")).data.run.run_id as string;
    const rep = await api("/api/backends/report", { method: "POST", body: spentPacket(runId, taskId, "bk_claude_code") });
    expect(rep.status).toBe(200);
    expect(((await rep.json() as any).data).released).not.toBe(true);
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, runId)).status).toBe("failed");
  });

  it("never releases a run that also broke a rule: a violation is a person's problem, not a queue's", async () => {
    const { taskId } = await fire("duty_tool_scout");
    const runId = (await claim("bk_codex")).data.run.run_id as string;
    const packet = spentPacket(runId, taskId, "bk_codex");
    (packet.evidence as any).violations = [{ action: "git push" }];
    const rep = await api("/api/backends/report", { method: "POST", body: packet });
    expect(rep.status).toBe(200);
    expect(((await rep.json() as any).data).released).not.toBe(true);
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, runId)).status).toBe("failed");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("the next firing with Codex known to be out", () => {
  it("parks on Codex anyway and waits for the reset — no step to Claude", async () => {
    await env.DB.prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = 'usage limit reached' WHERE id = 'bk_codex'`).bind(Date.now() + 3600_000).run();
    const { taskId } = await fire("duty_tool_scout");
    const parked = await row<any>(`SELECT backend_id, requested, claimed_at FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
    expect(parked.backend_id).toBe("bk_codex");
    expect(parked.claimed_at).toBeNull();
    expect(JSON.parse(parked.requested).codex_limit_waits).toBe(true);
    expect(await row(`SELECT 1 FROM task_events WHERE task_id = ? AND event = 'ladder_step'`, taskId)).toBeNull();
  });

  it("owner, 6 Nov 2026: with her Mac seen, a Codex limit hands the duty to the Claude seat — it never waits for the reset", async () => {
    await env.DB.prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = 'usage limit reached' WHERE id = 'bk_codex'`).bind(Date.now() + 3600_000).run();
    await env.DB.prepare(`INSERT OR REPLACE INTO sync_device (device_id, kind, label, last_seen_at) VALUES ('dev_test_mac', 'private', 'test mac', ?)`).bind(Date.now()).run();
    try {
      const { taskId } = await fire("duty_tool_scout");
      const runs = await all<any>(`SELECT backend_id, requested FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
      expect(runs.map((r) => r.backend_id), "parked on a spent Codex while the Claude seat could run").toEqual(["bk_claude_code"]);
      expect(JSON.parse(runs[0].requested).codex_limit_waits).toBeUndefined();
    } finally {
      await env.DB.prepare(`DELETE FROM sync_device WHERE device_id = 'dev_test_mac'`).run();
    }
  });

  it("a spent Claude seat is not in the way: the duty parks on Codex as usual", async () => {
    await env.DB.prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = 'usage limit reached' WHERE id = 'bk_claude_code'`).bind(Date.now() + 3600_000).run();
    const { taskId } = await fire("duty_tool_scout");
    const parked = await row<any>(`SELECT backend_id, requested FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
    expect(parked.backend_id).toBe("bk_codex");
    expect(JSON.parse(parked.requested).model, "the duty's Claude model reached Codex").toBeUndefined();
  });
});
