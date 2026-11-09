import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

// Each pass reads every live duty (42) and may admit a repair: give the end-to-end runs room.
vi.setConfig({ testTimeout: 60_000 });
import { runKendraChecks, raiseAlarm, herAlarms, runsFor } from "../../src/worker/boss/alarms/kendra";
import { isResearchWork } from "../../src/worker/boss/queue/freeRung";
import { noticeOnce } from "../../src/worker/boss/service/notices";
import { repairOriginOf, planWaitsForOwner } from "../../src/shared/boss/repoChange/lane.mjs";

/**
 * KENDRA'S ALARMS, END TO END OVER THE REAL MIGRATIONS (0350; owner, 5 Nov 2026: stop "green but
 * did nothing"). A duty below its floor two runs in a row, a new duty's first-run check, and a task
 * stuck "running" each become a Systems alarm owned by Kendra (emp_continuity), and clear themselves.
 */

const E = env as any;
const H = 3_600_000;
const sinceOf = async (id: string) =>
  (await E.DB.prepare(`SELECT output_since FROM standing_duties WHERE id = ?`).bind(id).first()).output_since as number;
let n = 0;
const ran = (duty: string, job: string, outcome: "ok" | "failed", count: number | null, at: number) =>
  E.DB.prepare(`INSERT INTO duty_runs (id, duty_id, local_job, finished_at, outcome, reason, source, created_at, output_count) VALUES (?,?,?,?,?,?,'launchd',?,?)`)
    .bind(`dr_test_${++n}`, duty, job, at, outcome, outcome === "failed" ? "stopped" : null, at, count).run();
const alarm = (key: string) => E.DB.prepare(`SELECT * FROM system_alarms WHERE alarm_key = ?`).bind(key).first();

describe("the migration declares a floor on every live duty", () => {
  it("P&P outreach needs 1 email sent, two runs in a row", async () => {
    const d = await E.DB.prepare(`SELECT output_metric, output_floor, output_runs FROM standing_duties WHERE id = 'duty_pnp_corporate_outreach'`).first();
    expect(d).toEqual({ output_metric: "emails sent", output_floor: 1, output_runs: 2 });
    const missing = await E.DB.prepare(`SELECT id FROM standing_duties WHERE removed_at IS NULL AND output_floor IS NULL`).all();
    expect(missing.results).toEqual([]);
  });
});

describe("A: the P&P outreach replay", () => {
  it("raises Kendra's alarm after Tue 3 Nov's second low run and clears it on Fri's 8 sent", async () => {
    const t0 = (await sinceOf("duty_pnp_corporate_outreach")) + 1000;
    await ran("duty_pnp_corporate_outreach", "pnp-corporate-outreach.mjs", "failed", null, t0);        // Mon 2 Nov
    let r = await runKendraChecks(E, t0 + H);
    expect(r.floors.opened).not.toContain("duty_pnp_corporate_outreach");                              // one low run: quiet
    await ran("duty_pnp_corporate_outreach", "pnp-corporate-outreach.mjs", "ok", 0, t0 + 24 * H);      // Tue 3 Nov, 0 sent
    r = await runKendraChecks(E, t0 + 25 * H);
    expect(r.floors.opened).toContain("duty_pnp_corporate_outreach");
    const a = await alarm("output:duty_pnp_corporate_outreach");
    expect(a).toMatchObject({ kind: "output_floor", owner: "emp_continuity", status: "open", hers: 0 });
    expect(a.text).toBe("Office Christmas outreach ran but produced 0 emails sent (needs 1), 2 runs in a row.");
    expect(await herAlarms(E.DB)).toEqual([]);                                                          // Kendra's, not her Today

    await ran("duty_pnp_corporate_outreach", "pnp-corporate-outreach.mjs", "ok", 0, t0 + 72 * H);      // Thu 5 Nov, 0 sent
    r = await runKendraChecks(E, t0 + 73 * H);
    expect(r.floors.kept).toContain("duty_pnp_corporate_outreach");                                     // one row, not two
    await ran("duty_pnp_corporate_outreach", "pnp-corporate-outreach.mjs", "ok", 8, t0 + 96 * H);      // Fri 6 Nov, 8 sent
    r = await runKendraChecks(E, t0 + 97 * H);
    expect(r.floors.cleared).toContain("duty_pnp_corporate_outreach");
    expect((await alarm("output:duty_pnp_corporate_outreach")).status).toBe("closed");
  });

  it("ignores runs from before the floor existed", async () => {
    const since = await sinceOf("duty_grid_watch");
    await ran("duty_grid_watch", "grid-watch.mjs", "ok", 0, since - 2 * H);
    await ran("duty_grid_watch", "grid-watch.mjs", "ok", 0, since - H);
    const r = await runKendraChecks(E, since + H);
    expect(r.floors.opened).not.toContain("duty_grid_watch");
  });
});

describe("B: a new duty gets its first-run check", () => {
  it("opens an Open Loops row for Kendra and closes it on the first above-floor run", async () => {
    const since = await sinceOf("duty_pnp_corporate_outreach");
    const born = since + 10 * H;
    await E.DB.prepare(
      `INSERT INTO standing_duties (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended, created_at, output_metric, output_floor, output_runs, output_since)
       VALUES ('duty_test_new','A brand-new job','emp_continuity','ops',8,0,'America/Chicago','daily',?, 'local_job','ops','A brand-new job', json_object('local_job','test-new.mjs'), 'It sends.', 0, ?, 'emails sent', 1, 2, ?)`,
    ).bind(born + 24 * H, born, since).run();
    let r = await runKendraChecks(E, born + H);
    expect(r.first_run.opened).toContain("duty_test_new");
    const loop = await E.DB.prepare(`SELECT * FROM owner_open_loops WHERE source_key = 'first-run#duty_test_new'`).first();
    expect(loop).toMatchObject({ owner: "emp_continuity", status: "open", section: "not_finished" });
    expect(loop.title).toMatch(/^Check A brand-new job produced emails sent by \d{4}-\d{2}-\d{2}$/);
    r = await runKendraChecks(E, born + 2 * H);
    expect(r.first_run.opened).not.toContain("duty_test_new");                                         // never twice
    await ran("duty_test_new", "test-new.mjs", "ok", 3, born + 20 * H);
    r = await runKendraChecks(E, born + 21 * H);
    expect(r.first_run.closed).toContain("duty_test_new");
    expect((await E.DB.prepare(`SELECT status, closed_reason FROM owner_open_loops WHERE source_key = 'first-run#duty_test_new'`).first()))
      .toEqual({ status: "closed", closed_reason: "first run produced 3 emails sent" });
  });
});

describe("G2: a task that sits running", () => {
  it("names the task and its seat, and clears once it stops running", async () => {
    const now = Date.now();
    await E.DB.prepare(`INSERT INTO tasks (id, lane, employee_id, title, status, created_at, started_at, intake_kind) VALUES ('tsk_test_stuck','ops','emp_research','Deep research: a mobile DNA collection business','running',?,?,'research')`)
      .bind(now - 3 * H, now - 2.5 * H).run();
    await E.DB.prepare(`INSERT INTO backend_runs (id, task_id, backend_id, requested, started_at, status, claimed_at) VALUES ('brn_test_stuck','tsk_test_stuck','bk_codex','{}',?, 'running', ?)`)
      .bind(now - 2.5 * H, now - 2.5 * H).run();
    let r = await runKendraChecks(E, now);
    expect(r.stale.opened).toContain("tsk_test_stuck");
    expect((await alarm("task:tsk_test_stuck")).text).toBe('"Deep research: a mobile DNA collection business" has been running 2 h 30 min on bk_codex, with no recorded progress for 2 h 30 min.');
    await E.DB.prepare(`UPDATE tasks SET status = 'failed' WHERE id = 'tsk_test_stuck'`).run();
    r = await runKendraChecks(E, now + H);
    expect(r.stale.cleared).toContain("tsk_test_stuck");
  });
});

describe("G2: the clock is the work's, and its usual is the job's own (9 Nov 2026, alarm task:tsk_m702ww3013yvqr98)", () => {
  it("a run parked on a switched-off Mac for two hours raises nothing, and is judged from its claim once claimed", async () => {
    const now = Date.now();
    await E.DB.prepare(`INSERT INTO tasks (id, lane, employee_id, title, status, created_at, started_at, intake_kind) VALUES ('tsk_test_parked','ops','emp_research','Parked Sweep','running',?,?,'research')`)
      .bind(now - 2 * H, now - 2 * H).run();
    await E.DB.prepare(`INSERT INTO backend_runs (id, task_id, backend_id, requested, started_at, status) VALUES ('brn_test_parked','tsk_test_parked','bk_claude_code','{}',?, 'running')`)
      .bind(now - 2 * H).run();
    let r = await runKendraChecks(E, now);
    expect(r.stale.opened).not.toContain("tsk_test_parked");
    expect(await alarm("task:tsk_test_parked")).toBeNull();
    // Claimed five minutes ago: five minutes of work is not stale, whatever the two-hour wait was.
    await E.DB.prepare(`UPDATE backend_runs SET claimed_at = ? WHERE id = 'brn_test_parked'`).bind(now - 5 * 60_000).run();
    r = await runKendraChecks(E, now);
    expect(r.stale.opened).not.toContain("tsk_test_parked");
    await E.DB.prepare(`UPDATE tasks SET status = 'done', finished_at = ? WHERE id = 'tsk_test_parked'`).bind(now).run();
  });

  it("reads the title's own work times before the kind's", async () => {
    const now = Date.now();
    const done = async (id: string, title: string, kind: string, workMin: number, waitMin: number, endAgo: number) => {
      const end = now - endAgo;
      const claimed = end - workMin * 60_000;
      await E.DB.prepare(`INSERT INTO tasks (id, lane, employee_id, title, status, created_at, started_at, finished_at, intake_kind) VALUES (?,'ops','emp_research',?,'done',?,?,?,?)`)
        .bind(id, title, claimed - waitMin * 60_000, claimed - waitMin * 60_000, end, kind).run();
      await E.DB.prepare(`INSERT INTO backend_runs (id, task_id, backend_id, requested, started_at, status, claimed_at, finished_at) VALUES (?,?,'bk_claude_code','{}',?,'succeeded',?,?)`)
        .bind(`brn_${id}`, id, claimed - waitMin * 60_000, claimed, end).run();
    };
    // The job's own runs: 5 minutes of work after a 90-minute wait for the seat. The kind's others: an hour of work.
    for (let i = 0; i < 5; i++) await done(`tsk_test_own_${i}`, "Title Sweep", "kind_g2_usual", 5, 90, (i + 1) * 24 * H);
    for (let i = 0; i < 5; i++) await done(`tsk_test_kin_${i}`, `Other job ${i}`, "kind_g2_usual", 60, 0, (i + 1) * 24 * H);
    await E.DB.prepare(`INSERT INTO tasks (id, lane, employee_id, title, status, created_at, started_at, intake_kind) VALUES ('tsk_test_title','ops','emp_research','Title Sweep','running',?,?,'kind_g2_usual')`)
      .bind(now - 40 * 60_000, now - 40 * 60_000).run();
    await E.DB.prepare(`INSERT INTO backend_runs (id, task_id, backend_id, requested, started_at, status, claimed_at) VALUES ('brn_test_title','tsk_test_title','bk_claude_code','{}',?,'running',?)`)
      .bind(now - 40 * 60_000, now - 40 * 60_000).run();
    const r = await runKendraChecks(E, now);
    expect(r.stale.opened).toContain("tsk_test_title");
    expect((await alarm("task:tsk_test_title")).text).toBe('"Title Sweep" has been running 40 min on bk_claude_code, more than twice its usual 5 min.');
  });
});

describe("G2: a stale-task alarm goes to the repair path, never research, and never feeds itself (7 Nov 2026)", () => {
  it("its repair is not research work, opens no research page, and a stale repair raises no alarm of its own", async () => {
    const now = Date.now();
    await E.DB.prepare(`INSERT INTO tasks (id, lane, employee_id, title, status, created_at, started_at, intake_kind) VALUES ('tsk_test_dna','ops','emp_research','Deep research: a mobile DNA collection business for a relative','running',?,?,'research')`)
      .bind(now - 3 * H, now - 2.5 * H).run();
    const r = await runKendraChecks(E, now);
    expect(r.stale.opened).toContain("tsk_test_dna");
    const repairId = (await alarm("task:tsk_test_dna")).task_id as string;
    expect(repairId).toMatch(/^tsk_/);
    const repair = await E.DB.prepare(`SELECT id, title, intake_kind, input, started_at, employee_id, status FROM tasks WHERE id = ?`).bind(repairId).first();
    const input = JSON.parse(repair.input);
    expect(input).toMatchObject({ origin: "repair", repair_kind: "kendra_alarm" });
    // Danielle's repair lane, a repair by kind: no plan approval, never waiting on her.
    expect(repair.employee_id).toBe("emp_repo");
    expect(repair.status).not.toBe("awaiting_approval");
    expect(repairOriginOf(input)).toEqual({ origin: "repair", repair_kind: "kendra_alarm" });
    expect(planWaitsForOwner({ origin: "repair" })).toBe(false);
    // The title says "research", so the classifier may call it research: the queue must still not.
    expect(isResearchWork(repair, input)).toBe(false);
    expect(input.research_page).toBeUndefined();
    expect((await E.DB.prepare(`SELECT COUNT(*) AS n FROM research_pages WHERE task_id = ?`).bind(repairId).first()).n).toBe(0);

    // The repair itself sits running past the stale line: no alarm on it, no repair of the repair.
    await E.DB.prepare(`UPDATE tasks SET status = 'running', started_at = ? WHERE id = ?`).bind(now - 3 * H, repairId).run();
    const before = (await E.DB.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE title LIKE '%Kendra''s alarm:%'`).first()).n;
    const r2 = await runKendraChecks(E, now + 1000);
    expect(r2.stale.opened).not.toContain(repairId);
    expect(await alarm(`task:${repairId}`)).toBeNull();
    expect(r2.stale.repairs).toBeGreaterThanOrEqual(1);
    expect((await E.DB.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE title LIKE '%Kendra''s alarm:%'`).first()).n).toBe(before);
    expect((await E.DB.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE title LIKE '%Kendra''s alarm:%Kendra''s alarm:%'`).first()).n).toBe(0);
    await E.DB.prepare(`UPDATE tasks SET status = 'done' WHERE id IN (?, ?)`).bind("tsk_test_dna", repairId).run();
  });
});

describe("repairs never wait on her (owner, 7 Nov 2026: Kendra's reports \"should not need my constant approval\")", () => {
  it("a repair's proposal, stop or could-not-do never becomes a needs-her notice; a key only she holds still does", async () => {
    await raiseAlarm(E, { key: "output:duty_test_repair_never_waits", kind: "output_floor", text: "A synthetic duty ran but produced 0 rows (needs 1), 2 runs in a row." });
    const repairId = (await alarm("output:duty_test_repair_never_waits")).task_id as string;
    expect(repairId).toMatch(/^tsk_/);
    const task = { id: repairId, lane: "ops", title: "Fix Kendra's alarm: a synthetic duty" };
    for (const kind of ["stopped", "could_not_do", "proposal", "done#0"]) {
      await noticeOnce(E, { task, fromName: "Kendra", kind, subject: `Proposal: clear the lock (${kind})`, lines: ["Reply with \"Reset\" and I will clear the lock."] });
    }
    await noticeOnce(E, { task, fromName: "Kendra", kind: "missing_secret", secretName: "SYNTHETIC_KEY", subject: "Needs a key", lines: ["Needs SYNTHETIC_KEY."] });
    const rows = (await E.DB.prepare(`SELECT kind, needs_her FROM boss_task_notices WHERE task_id = ?`).bind(repairId).all()).results as any[];
    expect(rows.length).toBe(5);
    expect(rows.filter((r) => r.needs_her === 1).map((r) => r.kind)).toEqual(["missing_secret"]);
  });
});

describe("G1: an owner email she alone can fix reaches her Today", () => {
  it("a `hers` alarm is listed for Today and opens no repair task", async () => {
    await raiseAlarm(E, { key: "mail:west-peek-os#test", kind: "owner_mail", text: "West Peek OS: owner emails failed 2 times in a row (auth (HTTP 401)).", hers: true });
    expect((await herAlarms(E.DB)).map((a) => a.alarm_key)).toContain("mail:west-peek-os#test");
    expect((await alarm("mail:west-peek-os#test")).task_id).toBeNull();
  });
});

describe("an agent duty is judged by what it delivered, not by tasks.output (8 Nov 2026, alarm output:duty_exec_intel)", () => {
  // The seat path (/backends/report) closes a task done and never writes tasks.output; the report
  // lands in the table the task declares. Two delivered mornings scored 0 and raised a false alarm.
  const duty = async (id: string) =>
    E.DB.prepare(`SELECT id, name, executor, created_at, output_metric, output_floor, output_runs, output_since FROM standing_duties WHERE id = ?`).bind(id).first();
  const materialised = async (dutyId: string, taskId: string, delivers: string, at: number) => {
    await E.DB.prepare(`INSERT INTO tasks (id, lane, title, input, status, created_at, finished_at) VALUES (?, 'ops', 'Duty run', ?, 'done', ?, ?)`)
      .bind(taskId, JSON.stringify({ delivers }), at, at + 60_000).run();
    await E.DB.prepare(`INSERT INTO audit_log (id, ts, actor, lane, entity_type, entity_id, action, detail) VALUES (?,?, 'system', 'ops', 'standing_duty', ?, 'materialised', ?)`)
      .bind(`aud_${taskId}`, at, dutyId, JSON.stringify({ task_id: taskId })).run();
  };
  const report = (taskId: string, day: string, at: number, status = "partial") =>
    E.DB.prepare(`INSERT INTO executive_reports (id, day_id, generated_at, task_id, status) VALUES (?,?,?,?,?)`).bind(`rep_${taskId}`, day, at, taskId, status).run();

  it("the morning report: two delivered runs with tasks.output NULL raise nothing; two runs that delivered nothing still alarm", async () => {
    const d = await duty("duty_exec_intel");
    expect(d).toMatchObject({ executor: "agent", output_floor: 1, output_runs: 2 });
    const t0 = Number(d.output_since) + 1000;
    await materialised("duty_exec_intel", "tsk_ei_7nov", "executive_reports", t0);
    await report("tsk_ei_7nov", "2099-11-07", t0 + 30_000);
    await materialised("duty_exec_intel", "tsk_ei_8nov", "executive_reports", t0 + 24 * H);
    await report("tsk_ei_8nov", "2099-11-08", t0 + 24 * H + 30_000);
    expect((await runsFor(E, d)).map((r) => r.output_count)).toEqual([1, 1]);
    let r = await runKendraChecks(E, t0 + 25 * H);
    expect(r.floors.opened).not.toContain("duty_exec_intel");
    expect(await alarm("output:duty_exec_intel")).toBeNull();

    // The proof it is not switched off: two done runs that wrote no report row (or only a failed one) alarm.
    await materialised("duty_exec_intel", "tsk_ei_9nov", "executive_reports", t0 + 48 * H);
    await report("tsk_ei_9nov", "2099-11-09", t0 + 48 * H + 30_000, "failed");
    await materialised("duty_exec_intel", "tsk_ei_10nov", "executive_reports", t0 + 72 * H);
    expect((await runsFor(E, d)).map((x) => x.output_count)).toEqual([0, 0, 1, 1]);
    r = await runKendraChecks(E, t0 + 73 * H);
    expect(r.floors.opened).toContain("duty_exec_intel");
    expect((await alarm("output:duty_exec_intel")).text).toMatch(/produced 0 reports delivered \(needs 1\), 2 runs in a row/);

    // And it closes itself once a run delivers again.
    await materialised("duty_exec_intel", "tsk_ei_11nov", "executive_reports", t0 + 96 * H);
    await report("tsk_ei_11nov", "2099-11-11", t0 + 96 * H + 30_000, "complete");
    r = await runKendraChecks(E, t0 + 97 * H);
    expect(r.floors.cleared).toContain("duty_exec_intel");
  });

  it("a run_id table counts the rows each run delivered, through backend_runs", async () => {
    const d = await duty("duty_link_prospects");
    expect(d).toMatchObject({ executor: "agent", output_floor: 1 });
    const t0 = Number(d.output_since) + 1000;
    await materialised("duty_link_prospects", "tsk_lp_a", "link_prospects", t0);
    await materialised("duty_link_prospects", "tsk_lp_b", "link_prospects", t0 + 24 * H);
    await E.DB.prepare(`INSERT INTO backend_runs (id, task_id, backend_id, requested, cost_micros, started_at, status) VALUES ('brn_lp_a','tsk_lp_a','bk_claude_code','{}',0,?,'succeeded')`).bind(t0).run();
    for (const [i, url] of ["https://a.example/", "https://b.example/"].entries()) {
      await E.DB.prepare(`INSERT INTO link_prospects (id, property, url, status, run_id, created_at, updated_at) VALUES (?, 'time2read', ?, 'new', 'brn_lp_a', ?, ?)`)
        .bind(`lnk_t_${i}`, url, t0 + 1000, t0 + 1000).run();
    }
    // Run b found nothing: it is a real 0, newest first.
    expect((await runsFor(E, d)).map((r) => r.output_count)).toEqual([0, 2]);
  });
});
