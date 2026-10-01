import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { apiJson, insertTask } from "./helpers";
import { briefingRunLine } from "../../src/worker/boss/routes/today";

/**
 * THE BRIEFING CARD SAYS WHERE THE RUN IS (1 Oct 2026). "i cant tell if its done or not." The card had a Run-now button and a report and
 * nothing between them: the only sign a run was still going was the button refusing a second press. `run_status` is one sentence read from
 * the duty's last task and its run record: queued and not yet picked up, picked up and being worked, finished, or failed and why.
 *
 * WHAT THIS PROVES: each of the states reads as the right sentence, a task dispatched to a seat is told apart (waiting vs being worked)
 * by the run's own claimed_at, and the Today block carries it from the real tables. WHAT IT DOES NOT: the line in a browser, or that her
 * Mac's real runs reach these states (that is the agent's side).
 */
const NOW = Date.parse("2026-10-01T19:30:00Z"); // 2:30 PM Central
const AT = (iso: string) => Date.parse(iso);

describe("briefingRunLine, every state", () => {
  const base = { task_error: null, task_created_at: AT("2026-10-01T19:05:00Z"), task_finished_at: null, run_claimed_at: null };

  it("says nothing for a duty that has never had a task", () => {
    expect(briefingRunLine(null, NOW)).toBeNull();
    expect(briefingRunLine({ ...base, task_status: null }, NOW)).toBeNull();
  });

  it("queued: says when, that the Mac has not picked it up, and when it next checks", () => {
    const line = briefingRunLine({ ...base, task_status: "queued" }, NOW)!;
    expect(line).toMatch(/^Queued at 2:05 PM\./);
    expect(line).toMatch(/has not picked it up yet/);
    expect(line).toMatch(/next check is \d\d:\d\d Central/);
  });

  it("running but NOT claimed reads as waiting for the Mac, not as work in progress", () => {
    const line = briefingRunLine({ ...base, task_status: "running", run_claimed_at: null }, NOW)!;
    expect(line).toMatch(/has not picked it up yet/);
    expect(line).not.toMatch(/working on it/);
  });

  it("running and claimed: says the Mac picked it up, when, and that it has not reported", () => {
    const line = briefingRunLine({ ...base, task_status: "running", run_claimed_at: AT("2026-10-01T19:20:00Z") }, NOW)!;
    expect(line).toBe("Your Mac picked it up at 2:20 PM and is working on it. It has not reported back yet.");
  });

  it("done: says it finished, and when", () => {
    expect(briefingRunLine({ ...base, task_status: "done", task_finished_at: AT("2026-10-01T19:25:00Z") }, NOW)).toBe("The last run finished at 2:25 PM.");
  });

  it("failed: carries the reason and says it can be run again", () => {
    const line = briefingRunLine({ ...base, task_status: "failed", task_finished_at: AT("2026-10-01T19:25:00Z"), task_error: "Codex answered without running a single web search" }, NOW)!;
    expect(line).toBe("The last run failed at 2:25 PM: Codex answered without running a single web search. You can run it again.");
  });

  it("failed with no recorded reason says so rather than inventing one", () => {
    expect(briefingRunLine({ ...base, task_status: "failed" }, NOW)).toMatch(/no reason was recorded/);
  });
});

describe("the Today block carries it from the real tables", () => {
  const blockContent = async () => {
    const { body } = await apiJson(`/api/today?blocks=executive_briefing`);
    return body.data.blocks.find((b: any) => b.key === "executive_briefing").content;
  };
  const point = async (taskId: string) => env.DB.prepare(`UPDATE standing_duties SET last_task_id = ? WHERE id = 'duty_exec_intel'`).bind(taskId).run();

  it("a queued task with no run record reads as queued, and the same task once its run is claimed reads as being worked", async () => {
    const taskId = await insertTask({ status: "running", title: "Executive Intelligence Report", input: JSON.stringify({ delivers: "executive_reports" }), intake_kind: "research" });
    await point(taskId);
    expect((await blockContent()).run_status).toMatch(/has not picked it up yet/);

    const started = Date.now() - 20 * 60_000;
    await env.DB.prepare(`INSERT INTO backend_runs (id, task_id, backend_id, envelope_id, requested, started_at, claimed_at, status) VALUES (?,?,?,?,?,?,?,'running')`)
      .bind(`brn_${taskId}`, taskId, "bk_codex", `env_${taskId}`, "{}", started, started + 60_000).run();
    expect((await blockContent()).run_status).toMatch(/Your Mac picked it up at .* and is working on it/);
  });

  it("a failed task carries its error into the sentence", async () => {
    const taskId = await insertTask({ status: "failed", title: "Executive Intelligence Report", input: JSON.stringify({ delivers: "executive_reports" }), intake_kind: "research" });
    await env.DB.prepare(`UPDATE tasks SET error = ?, finished_at = ? WHERE id = ?`).bind("Codex answered without running a single web search", Date.now(), taskId).run();
    await point(taskId);
    expect((await blockContent()).run_status).toMatch(/failed at .*: Codex answered without running a single web search\. You can run it again\./);
  });
});
