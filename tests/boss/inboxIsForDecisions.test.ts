import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { runNeedsHerDecision } from "../../src/worker/boss/backends/needsDecision";
import { deliverExecutiveReport } from "../../src/worker/boss/duties/deliverReport";
import { reportStaleness } from "../../src/worker/boss/routes/today";
import { api, apiJson, row, uid, all } from "./helpers";

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

  it("raises one when the run wrote files outside its own workspace", () => {
    const verdict = runNeedsHerDecision(
      JSON.stringify({ delivers: "executive_reports" }),
      { files_touched: ["/Users/x/GitHub/boss-os/src/worker/boss/index.ts"] },
      [],
    );
    expect(verdict.needed).toBe(true);
    expect(verdict.reason).toContain("outside its own workspace");
  });

  /*
   * THE ONE THIS FIX ALMOST SHIPPED WITHOUT. A run delivers BY writing
   * `~/.boss-os/reports/delivers.json`. Counting that as a proposal to change her machine put the
   * briefing straight back in the Inbox — verified by opening it, not by reading the code.
   */
  it("does not raise one for the workspace file that IS the delivery", () => {
    const verdict = runNeedsHerDecision(
      JSON.stringify({ delivers: "executive_reports" }),
      { files_touched: ["/Users/sequoiataylor/.boss-os/reports/delivers.json"] },
      [],
    );
    expect(verdict.needed).toBe(false);
  });

  it("still raises one when a delivery run also touched something of hers", () => {
    const verdict = runNeedsHerDecision(
      JSON.stringify({ delivers: "executive_reports" }),
      { files_touched: ["/Users/sequoiataylor/.boss-os/reports/delivers.json", "/Users/sequoiataylor/GitHub/boss-os/README.md"] },
      [],
    );
    expect(verdict.needed).toBe(true);
    expect(verdict.reason).toContain("README.md");
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
          files_touched: ["/Users/x/GitHub/boss-os/src/worker/boss/index.ts"], cost_micros: 1000,
        },
      },
    });
    expect(status).toBe(200);
    expect(body.data.approval_id).toBeTruthy();

    const approval = await row<any>(`SELECT summary, status FROM approvals WHERE id = ?`, body.data.approval_id);
    expect(approval.status).toBe("pending");
    // The reason it needs her leads the card, so the docket is readable without opening it.
    expect(approval.summary).toContain("outside its own workspace");
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

/**
 * THE RUN HER MAC COULD NEVER CLAIM.
 *
 * Found by using the system: materialising the report duty on a copy of production, running the
 * real Mac agent against it, and watching it answer `{"claimed": false}` with a dispatched run
 * sitting right there. `queue/consumer.ts` sets the task to `running` (its event is named
 * `started`) and THEN dispatches; the claim query required `t.status = 'queued'`, so the join could
 * never match. Every duty routed to `bk_claude_code` produced a run nothing could take.
 *
 * It is why the 06:30 briefing did not arrive, and it reached Today as "fired, but its last task is
 * still running — nothing picked it up", which reads as a broken launchd agent and is not.
 */
describe("a dispatched run can actually be claimed", () => {
  async function dispatched(taskStatus: string) {
    const taskId = uid("tsk");
    const runId = uid("brn");
    // The authorisation receipt a real dispatch writes. Without one the claim refuses the envelope,
    // correctly — nothing here is allowed to hand over unapproved work.
    const receipt = uid("aud");
    await env.DB.prepare(
      `INSERT INTO audit_log (id, ts, actor, lane, entity_type, entity_id, action, detail)
       VALUES (?,?, 'boss', 'ops', 'task', ?, 'dispatched', '{}')`,
    ).bind(receipt, Date.now(), taskId).run();
    await env.DB.prepare(
      `INSERT INTO tasks (id, lane, title, input, status, created_at) VALUES (?, 'ops', 'Executive Intelligence Report', ?, ?, ?)`,
    ).bind(taskId, JSON.stringify({ delivers: "executive_reports" }), taskStatus, Date.now()).run();
    await env.DB.prepare(
      `INSERT INTO backend_runs (id, task_id, backend_id, envelope_id, requested, cost_micros, started_at, status)
       VALUES (?,?,'bk_claude_code',NULL,?,0,?,'running')`,
    ).bind(runId, taskId, JSON.stringify({ receipt, instruction: "brief" }), Date.now()).run();
    return { taskId, runId };
  }

  beforeEach(async () => {
    await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_claude_code'`).run();
    await env.DB.prepare(`UPDATE backend_runs SET claimed_at = COALESCE(claimed_at, ?) WHERE claimed_at IS NULL`)
      .bind(Date.now()).run();
  });

  it("claims a run whose task the queue consumer already marked running — the bug", async () => {
    const { taskId, runId } = await dispatched("running");
    await env.DB.prepare(`UPDATE backend_runs SET claimed_at = NULL WHERE id = ?`).bind(runId).run();

    const { status, body } = await apiJson("/api/backends/claim", {
      method: "POST",
      body: { device_id: "dev_test_mac", backend_id: "bk_claude_code" },
    });
    expect(status).toBe(200);
    expect(body.data.run?.run_id).toBe(runId);
    expect(body.data.run?.task_id).toBe(taskId);
  });

  it("still claims one whose task is queued — a hand dispatch, the path that always worked", async () => {
    const { runId } = await dispatched("queued");
    await env.DB.prepare(`UPDATE backend_runs SET claimed_at = NULL WHERE id = ?`).bind(runId).run();
    const { body } = await apiJson("/api/backends/claim", {
      method: "POST", body: { device_id: "dev_test_mac", backend_id: "bk_claude_code" },
    });
    expect(body.data.run?.run_id).toBe(runId);
  });

  /*
   * EXCLUSIVITY MOVED ONTO THE RUN, which is the object being claimed. The old lock was a
   * conditional UPDATE on the TASK's status, which is why it could not survive the task legitimately
   * being `running`. Two devices, or two ticks of one agent, must still never take the same run.
   */
  it("hands one run to exactly one device, however many ask", async () => {
    const { runId } = await dispatched("running");
    await env.DB.prepare(`UPDATE backend_runs SET claimed_at = NULL WHERE id = ?`).bind(runId).run();

    const first = await apiJson("/api/backends/claim", {
      method: "POST", body: { device_id: "dev_a", backend_id: "bk_claude_code" },
    });
    const second = await apiJson("/api/backends/claim", {
      method: "POST", body: { device_id: "dev_b", backend_id: "bk_claude_code" },
    });
    expect(first.body.data.run?.run_id).toBe(runId);
    expect(second.body.data.run ?? null).toBeNull();

    const row_ = await row<any>(`SELECT claimed_by FROM backend_runs WHERE id = ?`, runId);
    expect(row_.claimed_by).toBe("dev_a");
  });
});

describe("the briefing is written for her eyes", () => {
  const TASK = "tsk_format_test";

  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM executive_reports`).run();
    await seedTask(TASK, { delivers: "executive_reports" });
  });

  it("stores the headline the run wrote, which is what the collapsed block shows", async () => {
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      report: {
        status: "complete",
        headline: "Oil and Fed rate-hike fears repriced equities lower.",
        summary: "Markets fell on inflation fears.",
        sections: [{ heading: "Rates", so_what: "Watch the Sept 16 FOMC.", bullets: ["**Three dissenters** now push a hike."] }],
      },
    });
    const r = await row<any>(`SELECT headline, sections FROM executive_reports WHERE task_id = ?`, TASK);
    expect(r.headline).toContain("Oil and Fed");
    expect(JSON.parse(r.sections)[0].bullets[0]).toContain("**Three dissenters**");
    expect(JSON.parse(r.sections)[0].so_what).toContain("FOMC");
  });

  /*
   * Reports written before 0205 have no headline, and a block reading "—" for every historical day
   * would make the fix look like a regression. A sentence is a worse headline than a headline and a
   * far better one than nothing.
   */
  it("falls back to the first sentence for a report written before the column existed", async () => {
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      report: { status: "complete", summary: "Two things moved. Then a lot of other detail followed." },
    });
    const r = await row<any>(`SELECT headline FROM executive_reports WHERE task_id = ?`, TASK);
    expect(r.headline).toBe("Two things moved.");
  });

  it("says so plainly when the run failed, rather than leaving the line blank", async () => {
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "failed", report: null,
    });
    const r = await row<any>(`SELECT headline, status FROM executive_reports WHERE task_id = ?`, TASK);
    expect(r.status).toBe("failed");
    expect(r.headline).toContain("failed");
  });

  it("carries the headline through to Today, alongside the gaps it must not hide", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      report: {
        status: "partial", day_id: today,
        headline: "One thing changed.",
        summary: "A short synthesis.",
        sections: [{ heading: "A", so_what: "Do this.", bullets: ["**Bold** thing."] }],
        gaps: [{ wanted: "a figure", why: "the page 403'd" }],
        sources: [{ name: "somewhere", url: "https://example.com", read_at: "2026-09-08T12:00:00Z" }],
      },
    });
    const { body } = await apiJson(`/api/today?date=${today}`);
    const block = (body.data.blocks as any[]).find((b) => b.key === "executive_briefing");
    expect(block.content.headline).toBe("One thing changed.");
    expect(block.content.gaps).toHaveLength(1);
    expect(block.content.sources).toHaveLength(1);
  });
});

/**
 * A NEW DUTY IS NOT A BROKEN ONE.
 *
 * The stale-duty query measured a duty that had never run against the EPOCH, so
 * `0 < now − 14 days` was true for every brand-new weekly duty and Today raised a HIGH alert the
 * moment one was created. Seen immediately on deploying `duty_mailbox_sweep`, whose first run is
 * the following Sunday: the screen called it a fault before it was due.
 *
 * OPERATIONS names this exact failure as the reason two local jobs are deliberately NOT duty rows —
 * "a false alarm, which is worse than the gap, because a screen that cries wolf is one you stop
 * reading."
 */
describe("a duty that has not fired yet is measured from when it was created", () => {
  const DUTY = "duty_alert_test";

  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM standing_duties WHERE id = ?`).bind(DUTY).run();
  });

  async function seedDuty(createdAt: number) {
    await env.DB.prepare(
      `INSERT INTO standing_duties
         (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
          next_due_at, task_kind, task_title, task_input, success_criteria, created_at)
       VALUES (?, 'A brand new weekly duty', 'emp_relationship', 'ops', 18, 30, 'America/Chicago',
               'weekly', 0, ?, 'research', 'X', '{}', 'It ran.', ?)`,
    ).bind(DUTY, Date.now() + 86_400_000, createdAt).run();
  }

  async function alertsMentioning(text: string) {
    const day = new Date().toISOString().slice(0, 10);
    const { body } = await apiJson(`/api/today?date=${day}`);
    const block = (body.data.blocks as any[]).find((b) => b.key === "critical_alerts");
    return (block.content.alerts ?? []).filter((a: any) => String(a.text).includes(text));
  }

  it("says nothing about a duty created today whose first run is this weekend", async () => {
    await seedDuty(Date.now());
    expect(await alertsMentioning("A brand new weekly duty")).toHaveLength(0);
  });

  it("still goes loud once a weekly duty has been silent for longer than its cadence allows", async () => {
    await seedDuty(Date.now() - 30 * 86_400_000);
    const alerts = await alertsMentioning("A brand new weekly duty");
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].severity).toBe("high");
  });
});

/**
 * A NOTICE IS NOT AN APPROVAL, AND THE COUNT MUST NOT PRETEND IT IS.
 *
 * ─── Confirmed on production, 9 September 2026 ─────────────────────────────
 *
 *   SELECT kind, status, COUNT(*) FROM approvals GROUP BY kind, status
 *     notice | approved | 8
 *
 * Eight times, an employee told her something and the Inbox rendered it with Approve / Reject /
 * Later. There was nothing to approve. She pressed Approve eight times to make a sentence go away,
 * and the table recorded eight approvals she never gave.
 *
 * The damage is to the REAL approvals beside it: a screen that asks for a verdict on things with no
 * verdict teaches the reader that the green button is a dismiss button, and the next card is a
 * letter going to a firm.
 */
describe("a notice is told apart from a decision, at the source", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM approvals`).run();
  });

  const raise = (kind: string, title: string) =>
    apiJson<any>("/api/approvals", { method: "POST", body: { title, kind, lane: "ops", risk: "low" } });

  it("keeps notices out of the number every surface reads, and returns them beside it", async () => {
    await raise("notice", "Monique emailed you the LP outcomes");
    await raise("notice", "Monique emailed you 5 people worth a conversation");
    await raise("manual", "Send this to Saints Capital?");

    const list = await apiJson<any>("/api/approvals?status=pending");
    const raw = await api("/api/approvals?status=pending");
    // Rule 0: the assertions below would all pass over an empty inbox.
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].kind).toBe("manual");
    // THE HEADER THE BADGE READS. Two notices and one decision is ONE thing waiting on her.
    expect(raw.headers.get("X-Pending-Total")).toBe("1");

    const told = await apiJson<any>("/api/approvals/notices");
    expect(told.body.data).toHaveLength(2);
    expect(told.body.data.every((n: any) => n.kind === "notice")).toBe(true);

    // AND THE SYSTEM COUNT AGREES, because it reads the same function rather than its own SQL.
    const status = await apiJson<any>("/api/system/status");
    expect(status.body.data.counts.pending_approvals).toBe(1);
  });

  it("still lets a notice be cleared, because it has to leave the screen somehow", async () => {
    const { body } = await raise("notice", "Monique emailed you the LP outcomes");
    await apiJson<any>(`/api/approvals/${body.data.id}/decide`, {
      method: "POST", body: { decision: "approved" },
    });
    const told = await apiJson<any>("/api/approvals/notices");
    expect(told.body.data).toHaveLength(0);
  });
});
