import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { runNeedsHerDecision } from "../../src/worker/boss/backends/needsDecision";
import { deliverExecutiveReport } from "../../src/worker/boss/duties/deliverReport";
import { reportStaleness } from "../../src/worker/boss/routes/today";
import { apiJson, row, uid, all } from "./helpers";

/**
 * THE INBOX IS FOR DECISIONS. THE BRIEFING IS NOT ONE.
 *
 * Her report, 8 September 2026: "when i click on inbox i have all these executive intelligence
 * reports to 'approve' then they disappear after hitting the button. then in the 'today' screen i
 * dont see any hting WTF?"
 *
 * All three halves of that were true and each has its own tests here:
 *
 *   1. Every succeeded backend run raised a `backend_run` approval unconditionally, including the
 *      daily briefing — and `approvals/execute.ts` applied literally nothing on approve.
 *   2. Today rendered only TODAY'S report, so a day-old briefing that existed and was readable was
 *      replaced by "No report for today yet."
 *   3. When there was nothing to show, the block said so without saying why, in a sentence that was
 *      identical whether the duty was suspended, unclaimed, failed or not yet due.
 */

const REPORT_TASK = "tsk_inbox_report";
const REPO_TASK = "tsk_inbox_repo";

async function seedTask(id: string, input: Record<string, unknown> | null) {
  await env.DB.prepare(`DELETE FROM tasks WHERE id = ?`).bind(id).run();
  await env.DB.prepare(
    `INSERT INTO tasks (id, lane, title, input, status, created_at) VALUES (?, 'ops', 'A run', ?, 'running', ?)`,
  ).bind(id, input === null ? null : JSON.stringify(input), Date.now()).run();
}

async function seedRun(taskId: string) {
  const runId = uid("brn");
  await env.DB.prepare(
    `INSERT INTO backend_runs (id, task_id, backend_id, envelope_id, requested, cost_micros, started_at, status)
     VALUES (?,?,'bk_claude_code',NULL,'{}',0,?, 'running')`,
  ).bind(runId, taskId, Date.now()).run();
  return runId;
}

describe("an approval exists when her answer changes what happens next", () => {
  it("does not raise one for a briefing that has already been delivered", () => {
    const verdict = runNeedsHerDecision(
      JSON.stringify({ delivers: "executive_reports" }),
      { summary: "Two things moved.", files_touched: [] },
      [],
    );
    expect(verdict.needed).toBe(false);
    expect(verdict.delivers).toBe("executive_reports");
  });

  it("raises one when the run wrote files on her machine", () => {
    const verdict = runNeedsHerDecision(
      JSON.stringify({ delivers: "executive_reports" }),
      { files_touched: ["src/worker/boss/index.ts"] },
      [],
    );
    expect(verdict.needed).toBe(true);
    expect(verdict.reason).toContain("file");
  });

  it("raises one when a forbidden action was detected", () => {
    const verdict = runNeedsHerDecision(
      JSON.stringify({ delivers: "sourcing_candidates" }),
      { files_touched: [] },
      [{ action: "git commit" }],
    );
    expect(verdict.needed).toBe(true);
    expect(verdict.reason).toContain("forbidden");
  });

  it("raises one when the run itself asked for her decision", () => {
    const verdict = runNeedsHerDecision(
      JSON.stringify({ delivers: "tool_suggestions" }),
      { files_touched: [], approval_needed: true },
      [],
    );
    expect(verdict.needed).toBe(true);
  });

  it("raises one for work she dispatched by hand, because the docket is the only delivery it has", () => {
    const verdict = runNeedsHerDecision(JSON.stringify({ backend_id: "bk_claude_code" }), { files_touched: [] }, []);
    expect(verdict.needed).toBe(true);
    expect(verdict.delivers).toBeNull();
  });

  /*
   * THE `practice_week` SHAPE, WHICH RAN INTO NOTHING FOR ELEVEN WEEKS. A duty that names a
   * delivery key nothing handles produced its output, dropped it, and reported success. That must
   * be loud, not quietly accepted — it is the exact class of defect this repository keeps producing.
   */
  it("raises one, loudly, when a run delivered into a key nothing handles", () => {
    const verdict = runNeedsHerDecision(JSON.stringify({ delivers: "invented_key" }), { files_touched: [] }, []);
    expect(verdict.needed).toBe(true);
    expect(verdict.reason).toContain("landed nowhere");
  });
});

describe("the reporting endpoint applies that rule", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM approvals WHERE kind = 'backend_run'`).run();
  });

  it("closes a delivered briefing as done, with no approval and an audited acceptance", async () => {
    await seedTask(REPORT_TASK, { delivers: "executive_reports" });
    const runId = await seedRun(REPORT_TASK);

    const { status, body } = await apiJson("/api/backends/report", {
      method: "POST",
      body: {
        device_id: "dev_test",
        evidence: { run_id: runId, status: "succeeded", summary: "Delivered.", files_touched: [], cost_micros: 1000 },
      },
    });
    expect(status).toBe(200);
    expect(body.data.approval_id ?? null).toBeNull();

    const task = await row<any>(`SELECT status FROM tasks WHERE id = ?`, REPORT_TASK);
    expect(task.status).toBe("done");

    const pending = await all<any>(`SELECT id FROM approvals WHERE kind = 'backend_run' AND status = 'pending'`);
    expect(pending).toHaveLength(0);

    // Accepted, and the acceptance is on the record. Silence would be the wrong kind of quiet.
    const accepted = await row<any>(
      `SELECT action, detail FROM audit_log WHERE entity_id = ? AND action = 'backend_run_auto_accepted'`,
      runId,
    );
    expect(accepted).not.toBeNull();
  });

  it("still raises one when the same run touched a file", async () => {
    await seedTask(REPO_TASK, { delivers: "executive_reports" });
    const runId = await seedRun(REPO_TASK);

    const { status, body } = await apiJson("/api/backends/report", {
      method: "POST",
      body: {
        device_id: "dev_test",
        evidence: {
          run_id: runId, status: "succeeded", summary: "Edited a module.",
          files_touched: ["src/worker/boss/index.ts"], cost_micros: 1000,
        },
      },
    });
    expect(status).toBe(200);
    expect(body.data.approval_id).toBeTruthy();

    const approval = await row<any>(`SELECT summary, status FROM approvals WHERE id = ?`, body.data.approval_id);
    expect(approval.status).toBe("pending");
    // The reason it needs her leads the card, so the docket is readable without opening it.
    expect(approval.summary).toContain("file");
  });
});

describe("the briefing lands on Today by itself, and never as a blank", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM executive_reports`).run();
  });

  it("archives every earlier report when a new one is delivered, so she never prunes anything", async () => {
    await seedTask(REPORT_TASK, { delivers: "executive_reports" });

    await deliverExecutiveReport(env as any, {
      taskId: REPORT_TASK, runId: uid("brn"), runStatus: "succeeded",
      report: { status: "complete", summary: "Monday.", day_id: "2026-09-07" },
    });
    await deliverExecutiveReport(env as any, {
      taskId: REPORT_TASK, runId: uid("brn"), runStatus: "succeeded",
      report: { status: "complete", summary: "Tuesday.", day_id: "2026-09-08" },
    });

    const monday = await row<any>(`SELECT archived_at FROM executive_reports WHERE day_id = '2026-09-07'`);
    const tuesday = await row<any>(`SELECT archived_at FROM executive_reports WHERE day_id = '2026-09-08'`);
    expect(monday.archived_at).not.toBeNull();
    expect(tuesday.archived_at).toBeNull();
    // Archived, never deleted: `corrections` chains one report to the one before it.
    expect(await row(`SELECT id FROM executive_reports WHERE day_id = '2026-09-07'`)).not.toBeNull();
  });

  it("shows yesterday's briefing rather than an empty block when today's has not arrived", async () => {
    await seedTask(REPORT_TASK, { delivers: "executive_reports" });
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    await deliverExecutiveReport(env as any, {
      taskId: REPORT_TASK, runId: uid("brn"), runStatus: "succeeded",
      report: { status: "complete", summary: "Yesterday's briefing.", day_id: yesterday },
    });

    const { body } = await apiJson(`/api/today?date=${today}`);
    const block = (body.data.blocks as any[]).find((b) => b.key === "executive_briefing");
    expect(block.is_empty).toBe(false);
    expect(block.content.summary).toBe("Yesterday's briefing.");
    expect(block.content.carried_over).toBe(true);
    expect(block.content.for_day).toBe(yesterday);
    expect(block.content.staleness).toBeTruthy();
  });
});

describe("a missing briefing names its reason, and the reasons differ", () => {
  const NOW = 1_788_900_000_000;
  const base = { suspended: 0, last_run_at: NOW - 3_600_000, next_due_at: NOW + 3_600_000, task_status: null, task_error: null };

  it("says nothing is wrong when it is simply not due yet", () => {
    expect(reportStaleness({ ...base, last_run_at: null, next_due_at: NOW + 600_000 }, null, "2026-09-08", NOW))
      .toContain("never fired");
    expect(reportStaleness({ ...base, task_status: "done" }, null, "2026-09-08", NOW)).toContain("not due for another");
  });

  it("names an unclaimed task as the agent not running, which is the actionable half", () => {
    const text = reportStaleness({ ...base, task_status: "queued" }, null, "2026-09-08", NOW);
    expect(text).toContain("queued");
    expect(text).toContain("agent job is not running");
  });

  it("carries the failure's own error rather than a generic absence", () => {
    const text = reportStaleness({ ...base, task_status: "failed", task_error: "rate limited" }, null, "2026-09-08", NOW);
    expect(text).toContain("rate limited");
  });

  it("says a suspended duty is suspended, so silence is never mistaken for a fault", () => {
    expect(reportStaleness({ ...base, suspended: 1 }, null, "2026-09-08", NOW)).toContain("suspended");
  });

  it("labels a carried-over briefing with the day it is actually for", () => {
    expect(reportStaleness(base, "2026-09-07", "2026-09-08", NOW)).toContain("2026-09-07");
    expect(reportStaleness(base, "2026-09-07", "2026-09-08", NOW)).toContain("carried over");
  });

  /*
   * RULE 0: THIS FUNCTION MAY NOT RETURN NOTHING. Every branch above exists because a blank was
   * what she saw. A path that fell through to an empty string would reproduce the original defect
   * with more code in front of it.
   */
  it("always says something, on every combination of duty state", () => {
    const states = [null, "queued", "running", "done", "failed", "cancelled"];
    let checked = 0;
    for (const suspended of [0, 1]) {
      for (const lastRun of [null, NOW - 7_200_000]) {
        for (const task of states) {
          const text = reportStaleness(
            { suspended, last_run_at: lastRun, next_due_at: NOW + 60_000, task_status: task, task_error: null },
            null, "2026-09-08", NOW,
          );
          expect(text.length).toBeGreaterThan(20);
          checked++;
        }
      }
    }
    expect(checked).toBe(24);
  });
});

describe("the day plan is there before she presses anything", () => {
  it("derives today's contract on read when the Morning Gate has not run", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(`UPDATE days SET morning_contract = NULL, morning_completed_at = NULL WHERE id = ?`)
      .bind(day).run();

    const { body } = await apiJson(`/api/today?date=${day}`);
    const block = (body.data.blocks as any[]).find((b) => b.key === "todays_contract");

    expect(block.is_empty).toBe(false);
    expect(block.content.state).toBe("proposed");
    expect(block.content.agreed_at).toBeNull();
    // The four pillars, each an exact act, with nobody having typed anything.
    expect(block.content.agenda.pillars.wealth.action).toBeTruthy();
    expect(block.content.agenda.pillars.execution.action).toBeTruthy();
    expect(block.content.agenda.pillars.spirit).toBeTruthy();
    expect(block.content.agenda.pillars.body).toBeTruthy();
    expect(block.content.contract.commitment).toBe(block.content.agenda.pillars.wealth.action);
  });

  it("deriving it writes nothing, so opening Today twice cannot change the day", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(`UPDATE days SET morning_contract = NULL, morning_completed_at = NULL WHERE id = ?`)
      .bind(day).run();
    await env.DB.prepare(`DELETE FROM movement_log WHERE day_id = ?`).bind(day).run();

    await apiJson(`/api/today?date=${day}`);
    await apiJson(`/api/today?date=${day}`);

    // `logSomatic` belongs to the gate — recording which movement was chosen is part of agreeing to
    // the day, not part of being shown it.
    const logged = await all<any>(`SELECT id FROM movement_log WHERE day_id = ?`, day);
    expect(logged).toHaveLength(0);

    const stored = await row<any>(`SELECT morning_contract FROM days WHERE id = ?`, day);
    expect(stored.morning_contract).toBeNull();
  });

  it("lets her agreed contract win once the gate has run, rather than showing two answers", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await apiJson("/api/today/gates/morning", { method: "POST", body: { day_id: day, commitment: "Call the buyer." } });

    const { body } = await apiJson(`/api/today?date=${day}`);
    const block = (body.data.blocks as any[]).find((b) => b.key === "todays_contract");
    expect(block.content.state).toBe("agreed");
    expect(block.content.contract.commitment).toBe("Call the buyer.");
    expect(block.content).not.toHaveProperty("agenda");
  });
});
