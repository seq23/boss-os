import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

// Each pass reads every live duty (42) and may admit a repair: give the end-to-end runs room.
vi.setConfig({ testTimeout: 60_000 });
import { runKendraChecks, raiseAlarm, herAlarms } from "../../src/worker/boss/alarms/kendra";

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

describe("G1: an owner email she alone can fix reaches her Today", () => {
  it("a `hers` alarm is listed for Today and opens no repair task", async () => {
    await raiseAlarm(E, { key: "mail:west-peek-os#test", kind: "owner_mail", text: "West Peek OS: owner emails failed 2 times in a row (auth (HTTP 401)).", hers: true });
    expect((await herAlarms(E.DB)).map((a) => a.alarm_key)).toContain("mail:west-peek-os#test");
    expect((await alarm("mail:west-peek-os#test")).task_id).toBeNull();
  });
});
