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

  it("leaves the briefing's ladder, and every duty that is not a seat duty, exactly as it was", async () => {
    const briefing = JSON.parse((await row<any>(`SELECT task_input FROM standing_duties WHERE id = 'duty_exec_intel'`)).task_input);
    expect(briefing.backend_ladder).toEqual(["bk_claude_code", "bk_codex"]);
    expect(briefing.cloud_fallback).toBe(true);
    const others = await all<any>(`SELECT id, task_input FROM standing_duties WHERE id NOT IN (${["duty_exec_intel", ...FOUR].map(() => "?").join(",")})`, "duty_exec_intel", ...FOUR);
    expect(others.length).toBeGreaterThan(10);
    for (const d of others) expect(JSON.parse(d.task_input ?? "{}").backend_ladder, d.id).toBeUndefined();
  });

  it("parks a fired duty for Claude Code with the ladder and Claude's model on the run", async () => {
    const { taskId } = await fire("duty_tool_scout");
    const run = await row<any>(`SELECT backend_id, requested FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
    expect(run.backend_id).toBe("bk_claude_code");
    const requested = JSON.parse(run.requested);
    expect(requested.backend_ladder).toEqual(["bk_claude_code", "bk_codex"]);
    expect(requested.model).toBe("claude-haiku-4-5-20251001");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("a plan that runs out UNDER a run hands the run on, once", () => {
  it("Claude Code claims, reports its plan spent → the run goes back in the queue → Codex takes it with its own model and a hand-off event", async () => {
    const { taskId } = await fire("duty_tool_scout");
    const first = await claim("bk_claude_code");
    const runId = first.data.run.run_id as string;

    const rep = await api("/api/backends/report", { method: "POST", body: spentPacket(runId, taskId, "bk_claude_code") });
    expect(rep.status, await rep.clone().text()).toBe(200);
    const released = (await rep.json() as any).data;
    expect(released.released).toBe(true);
    expect(released.next_seat).toBe("bk_codex");

    // Not failed, not finished: back in the queue, unclaimed, remembering who has had it.
    const run = await row<any>(`SELECT status, claimed_at, claimed_by, finished_at, requested FROM backend_runs WHERE id = ?`, runId);
    expect(run.status).toBe("running");
    expect(run.claimed_at).toBeNull();
    expect(run.finished_at).toBeNull();
    expect(JSON.parse(run.requested).ladder_released).toEqual(["bk_claude_code"]);
    const ev = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'ladder_release'`, taskId);
    expect(JSON.parse(ev.detail)).toMatchObject({ from: "bk_claude_code", next: "bk_codex" });

    // The spent seat is stamped, so the guard skips it at dispatch until it resets.
    const stamped = await row<any>(`SELECT exhausted_until FROM execution_backends WHERE id = 'bk_claude_code'`);
    expect(stamped.exhausted_until).toBeGreaterThan(Date.now());

    // Codex alone does not take it; Codex with Claude reported out does — with its own model.
    expect((await claim("bk_codex")).data.run).toBeNull();
    const second = await claim("bk_codex", ["bk_claude_code"]);
    expect(second.data.run, "Codex was not handed the released run").not.toBeNull();
    expect(second.data.run.run_id).toBe(runId);
    expect(second.data.run.backend_id).toBe("bk_codex");
    expect(second.data.run.model, "a Claude model id reached Codex").toBeUndefined();
    const handoff = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'ladder_handoff'`, taskId);
    expect(JSON.parse(handoff.detail)).toMatchObject({ from: "bk_claude_code", to: "bk_codex" });
  });

  it("and Codex finishing the job succeeds normally — the released run is not marked failed anywhere", async () => {
    const { taskId } = await fire("duty_practice_week");
    const runId = (await claim("bk_claude_code")).data.run.run_id as string;
    await api("/api/backends/report", { method: "POST", body: spentPacket(runId, taskId, "bk_claude_code") });
    await claim("bk_codex", ["bk_claude_code"]);
    const done = await api("/api/backends/report", {
      method: "POST",
      body: {
        device_id: "dev_test",
        evidence: {
          run_id: runId, task_id: taskId, backend_id: "bk_codex", status: "succeeded", summary: "Codex wrote the week.",
          files_touched: [], commands: [], checks_run: { run: 0, passed: 0, failed: 0, detail: [] }, remaining_risks: [], violations: [],
          rollback_ref: null, refusal_reason: null, error: null, cost_micros: 0, started_at: NOW, finished_at: NOW + 1000, seat_exhausted: null,
        },
      },
    });
    expect(done.status, await done.clone().text()).toBe(200);
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, runId)).status).toBe("succeeded");
  });

  it("is BOUNDED: when the last seat is spent too, the run fails with the sentence — it does not go round again", async () => {
    const { taskId } = await fire("duty_link_prospects");
    const runId = (await claim("bk_claude_code")).data.run.run_id as string;
    await api("/api/backends/report", { method: "POST", body: spentPacket(runId, taskId, "bk_claude_code") });
    await claim("bk_codex", ["bk_claude_code"]);

    const last = await api("/api/backends/report", { method: "POST", body: spentPacket(runId, taskId, "bk_codex") });
    expect(last.status).toBe(200);
    const body = (await last.json() as any).data;
    expect(body.released, "the run was released again — that is a loop").not.toBe(true);

    const run = await row<any>(`SELECT status, error FROM backend_runs WHERE id = ?`, runId);
    expect(run.status).toBe("failed");
    expect(run.error).toContain("out of usage");
    // And now BOTH seats are stamped, so tomorrow's firing is refused at the door for both, not parked.
    const spent = await all<any>(`SELECT id FROM execution_backends WHERE id IN ('bk_claude_code','bk_codex') AND exhausted_until > ?`, Date.now());
    expect(spent.map((r) => r.id).sort()).toEqual(["bk_claude_code", "bk_codex"]);
  });

  it("never releases a run whose ladder does not name a later seat — a laddered-less run fails as it always did", async () => {
    const taskId = await insertTask({ status: "queued", title: "No ladder", input: JSON.stringify({ backend_id: "bk_claude_code", delivers: "tool_suggestions" }), intake_kind: "research" });
    await handleTask(env as any, { taskId, lane: "ops" });
    const runId = (await claim("bk_claude_code")).data.run.run_id as string;
    const rep = await api("/api/backends/report", { method: "POST", body: spentPacket(runId, taskId, "bk_claude_code") });
    expect(rep.status).toBe(200);
    expect(((await rep.json() as any).data).released).not.toBe(true);
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, runId)).status).toBe("failed");
  });

  it("never releases a run that also broke a rule: a violation is a person's problem, not a queue's", async () => {
    const { taskId } = await fire("duty_tool_scout");
    const runId = (await claim("bk_claude_code")).data.run.run_id as string;
    const packet = spentPacket(runId, taskId, "bk_claude_code");
    (packet.evidence as any).violations = [{ action: "git push" }];
    const rep = await api("/api/backends/report", { method: "POST", body: packet });
    expect(rep.status).toBe(200);
    expect(((await rep.json() as any).data).released).not.toBe(true);
    expect((await row<any>(`SELECT status FROM backend_runs WHERE id = ?`, runId)).status).toBe("failed");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("the next firing does not park on a seat that is known to be out", () => {
  it("dispatch walks past a spent Claude seat to Codex, and records the step with the seat's own sentence", async () => {
    await env.DB.prepare(`UPDATE execution_backends SET exhausted_until = ?, exhausted_reason = 'usage limit reached' WHERE id = 'bk_claude_code'`).bind(Date.now() + 3600_000).run();
    const { taskId } = await fire("duty_brokerage_sourcing");
    const parked = await row<any>(`SELECT backend_id, requested FROM backend_runs WHERE task_id = ? AND status = 'running'`, taskId);
    expect(parked.backend_id).toBe("bk_codex");
    expect(JSON.parse(parked.requested).model, "brokerage's Claude model reached Codex").toBeUndefined();
    const step = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'ladder_step'`, taskId);
    expect(JSON.parse(step.detail)).toMatchObject({ backend_id: "bk_claude_code", next: "bk_codex" });
    expect(JSON.parse(step.detail).refused).toMatch(/out of usage/);
  });
});
