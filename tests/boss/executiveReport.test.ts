import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { deliverExecutiveReport } from "../../src/worker/boss/duties/deliverReport";
import { row, uid } from "./helpers";

/**
 * THE REPORT NOBODY WROTE.
 *
 * `executive_reports` has existed since migration 0176. `today.ts` reads it on every page load. The
 * duty that produces it fired at 06:30 Central every morning. And nothing anywhere in the worker
 * held an `INSERT INTO executive_reports` — so the Executive Briefing block rendered its "no report
 * yet" state, correctly, for ever.
 *
 * A missing writer is invisible to every test that checks the reader. These check the writer.
 */

const TASK = "tsk_report_test";

async function seedTask(input: Record<string, unknown>) {
  await env.DB.prepare(`DELETE FROM tasks WHERE id = ?`).bind(TASK).run();
  await env.DB.prepare(
    `INSERT INTO tasks (id, lane, title, input, status, created_at) VALUES (?, 'ops', 'Executive Intelligence Report', ?, 'running', ?)`,
  ).bind(TASK, JSON.stringify(input), Date.now()).run();
}

describe("delivering the executive intelligence report", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM executive_reports`).run();
  });

  it("writes the day's report when the task was contracted to deliver one", async () => {
    await seedTask({ delivers: "executive_reports", backend_id: "bk_claude_code" });
    const id = await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      report: {
        status: "complete",
        summary: "Two things moved.",
        sections: [{ heading: "Secondaries", body: "..." }],
        sources: [{ name: "example", read_at: 1 }],
      },
    });
    expect(id).toBeTruthy();

    const report = await row<any>(`SELECT * FROM executive_reports WHERE task_id = ?`, TASK);
    expect(report).not.toBeNull();
    expect(report.status).toBe("complete");
    expect(JSON.parse(report.sections)).toHaveLength(1);
  });

  it("delivers nothing for a task that was not contracted to — the ordinary case", async () => {
    // Every other backend run reaches this function too. Treating "no contract" as an error would
    // make repo work fail on a report path it has nothing to do with.
    await seedTask({ backend_id: "bk_claude_code" });
    const id = await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded", report: { status: "complete" },
    });
    expect(id).toBeNull();
    expect(await row(`SELECT id FROM executive_reports`)).toBeNull();
  });

  it("refuses to call a report complete when it lists gaps", async () => {
    /*
     * The spec's criterion is that anything unverified is listed as a gap rather than omitted. A
     * report that lists gaps and calls itself complete has quietly redefined the word, and it is the
     * runner — not this side — that would be making the claim.
     */
    await seedTask({ delivers: "executive_reports" });
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      report: { status: "complete", summary: "Mostly.", gaps: [{ wanted: "LP flows", why: "source down" }] },
    });
    const report = await row<any>(`SELECT status, gaps FROM executive_reports WHERE task_id = ?`, TASK);
    expect(report.status).toBe("partial");
    expect(JSON.parse(report.gaps)).toHaveLength(1);
  });

  it("still writes a row when the run failed, so the block can say when the last good one was", async () => {
    await seedTask({ delivers: "executive_reports" });
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "failed", report: null,
    });
    const report = await row<any>(`SELECT status, summary FROM executive_reports WHERE task_id = ?`, TASK);
    expect(report.status).toBe("failed");
    // An unexplained blank looks identical to "nothing ran". This says which.
    expect(report.summary).toBeTruthy();
  });

  it("calls an unlabelled success partial rather than complete", async () => {
    await seedTask({ delivers: "executive_reports" });
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded", report: { summary: "Something." },
    });
    const report = await row<any>(`SELECT status FROM executive_reports WHERE task_id = ?`, TASK);
    expect(report.status).toBe("partial");
  });

  it("keeps one row per day, replacing a partial morning with a better retry", async () => {
    await seedTask({ delivers: "executive_reports" });
    const day = "2026-09-07";
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      report: { day_id: day, status: "partial", summary: "Half of it.", gaps: [{ wanted: "x" }] },
    });
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      report: { day_id: day, status: "complete", summary: "All of it." },
    });

    const rows = await env.DB.prepare(`SELECT status, summary FROM executive_reports WHERE day_id = ?`).bind(day).all();
    expect(rows.results).toHaveLength(1);
    expect((rows.results![0] as any).status).toBe("complete");
    expect((rows.results![0] as any).summary).toBe("All of it.");
  });

  it("files the report under the Central day, not the UTC one", async () => {
    /*
     * 06:30 Central is already the next day in UTC for half the year — which is exactly how a
     * report generated at her breakfast files itself under tomorrow and the block shows nothing.
     */
    await seedTask({ delivers: "executive_reports" });
    const at = Date.parse("2026-09-07T06:30:00-05:00");
    expect(new Date(at).toISOString().slice(0, 10)).toBe("2026-09-07");
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded", report: { status: "complete" }, now: at,
    });
    const report = await row<any>(`SELECT day_id FROM executive_reports WHERE task_id = ?`, TASK);
    expect(report.day_id).toBe("2026-09-07");

    // And the case that actually bites: late evening Central is already tomorrow in UTC.
    await env.DB.prepare(`DELETE FROM executive_reports`).run();
    const evening = Date.parse("2026-09-07T20:00:00-05:00");
    expect(new Date(evening).toISOString().slice(0, 10)).toBe("2026-09-08");
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded", report: { status: "complete" }, now: evening,
    });
    const late = await row<any>(`SELECT day_id FROM executive_reports WHERE task_id = ?`, TASK);
    expect(late.day_id).toBe("2026-09-07");
  });
});

/**
 * THE HOP THAT WAS NOT THERE: a queued task reaching her Mac instead of a cloud model.
 *
 * The consumer's only move was `routeCompletion`. For the report that is not a slower answer but a
 * wrong one — a Worker cannot read this morning's news, and a model asked to recall it returns
 * something shaped exactly like a report, citing sources it never opened.
 */
describe("the delivery contract survives the dispatch endpoint", () => {
  it("carries `delivers` onto the task, or a hand-dispatched report is silently dropped", async () => {
    /*
     * FOUND BY DISPATCHING THE REAL REPORT, NOT BY READING THE CODE. The run researched for ten
     * minutes, wrote a good `delivers.json`, reported it — and the Executive Briefing block still
     * said no report had ever been produced, because the endpoint wrote a task input of
     * { prompt, backend_id, kind } and `deliverExecutiveReport` reads `input.delivers` to decide
     * whether a run's output is a report at all. The duty carried the contract; a hand dispatch did
     * not, which is exactly the path anyone re-running a failed morning would take.
     */
    const { apiJson } = await import("./helpers");
    const { status, body } = await apiJson("/api/backends/dispatch", {
      method: "POST",
      body: {
        title: "Executive Intelligence Report",
        prompt: "Produce the report.",
        kind: "research",
        backend_id: "bk_claude_code",
        lane: "ops",
        delivers: "executive_reports",
      },
    });
    expect(status).toBe(201);
    const task = await row<any>(`SELECT input FROM tasks WHERE id = ?`, body.data.run.task_id);
    expect(JSON.parse(task.input).delivers).toBe("executive_reports");
  });

  it("writes no contract when none was asked for", async () => {
    const { apiJson } = await import("./helpers");
    const { body } = await apiJson("/api/backends/dispatch", {
      method: "POST",
      body: { title: "Repo work", prompt: "Do the thing.", kind: "repo_work", backend_id: "bk_claude_code", lane: "ops" },
    });
    const task = await row<any>(`SELECT input FROM tasks WHERE id = ?`, body.data.run.task_id);
    expect(JSON.parse(task.input).delivers).toBeUndefined();
  });
});

describe("a task that names a backend leaves the cloud", () => {
  it("dispatches a claimable run instead of asking a model, and never calls out", async () => {
    const { handleTask } = await import("../../src/worker/boss/queue/consumer");
    const { insertTask, stubFetch } = await import("./helpers");

    // Any egress at all is the failure this test exists to catch: if the consumer fell through to
    // the router, a provider call would be attempted here.
    let calls = 0;
    const restore = stubFetch(() => { calls++; return new Response("{}", { status: 200 }); });
    try {
      const taskId = await insertTask({
        status: "queued",
        title: "Executive Intelligence Report",
        input: JSON.stringify({ backend_id: "bk_claude_code", delivers: "executive_reports" }),
        intake_kind: "research",
      });

      await handleTask(env as any, { taskId, lane: "ops" });

      const run = await row<any>(`SELECT id, backend_id, status FROM backend_runs WHERE task_id = ?`, taskId);
      expect(run, "no backend run was created — the task fell through to the cloud router").not.toBeNull();
      expect(run.backend_id).toBe("bk_claude_code");
      expect(run.status).toBe("running");
      expect(calls, "the consumer called a provider for work that belongs on her machine").toBe(0);

      // The task stays running: it is not done, and it is not awaiting HER — it is awaiting a claim.
      const task = await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId);
      expect(task.status).toBe("running");

      const event = await row(`SELECT id FROM task_events WHERE task_id = ? AND event = 'dispatched'`, taskId);
      expect(event).not.toBeNull();
    } finally {
      restore();
    }
  });
});
