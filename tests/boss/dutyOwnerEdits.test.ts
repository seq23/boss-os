import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { materialiseDueDuties } from "../../src/worker/boss/duties/materialise";
import { dutyBrief, editDuty, pauseDuty, removeDuty, undoDuty, versionsOf } from "../../src/worker/boss/duties/ownerEdits";
import { briefDecision } from "../../src/shared/boss/duties/ownerEdits.mjs";
import { all, apiJson, row } from "./helpers";

/**
 * THE OWNER EDITS A DUTY ON THE SITE, AND THE JOB RECEIVES IT (Builder U, 23 Oct 2026, board 8).
 *
 * "A setting no code reads is a defect." So these do not stop at "the row changed": they run the
 * cron's own materialiser and read the task it produced, and they ask /brief the question
 * duty-run.sh asks before every Mac job. The Mac wrapper itself is driven end to end in
 * tests/dutyOwnerEditsMac.test.ts.
 */

const AGENT = "duty_brokerage_sourcing"; // Camille's sweep: a Worker duty with a prompt in its record
const MAC_PROMPT = "duty_mailbox_sweep";  // a Mac duty whose script reads a prompt file
const MAC_FIXED = "duty_lp_daily";        // a Mac duty with fixed steps and no prompt

async function reset() {
  await env.DB.prepare(`DELETE FROM duty_versions`).run();
  await env.DB.prepare(`DELETE FROM tasks WHERE employee_id = 'emp_research'`).run();
  await env.DB.prepare(`UPDATE standing_duties SET suspended = 1 WHERE id != ?`).bind(AGENT).run();
  await env.DB.prepare(`UPDATE standing_duties SET owner_prompt = NULL, owner_schedule_at = NULL, removed_at = NULL WHERE 1`).run();
  await env.DB.prepare(`UPDATE standing_duties SET suspended = 0, next_due_at = 0, last_run_at = NULL WHERE id IN (?, ?, ?)`).bind(AGENT, MAC_PROMPT, MAC_FIXED).run();
}

async function firedPrompt(now: number): Promise<string | null> {
  await env.DB.prepare(`UPDATE standing_duties SET next_due_at = 0 WHERE id = ?`).bind(AGENT).run();
  const r = await materialiseDueDuties(env as any, now, AGENT);
  const fired = r.fired.find((f) => f.duty === AGENT);
  if (!fired?.task_id) return null;
  const t = await row<{ input: string }>(`SELECT input FROM tasks WHERE id = '${fired.task_id}'`);
  return JSON.parse(t!.input).prompt ?? null;
}

describe("an edit changes what the job receives", () => {
  beforeEach(reset);
  const now = Date.parse("2026-10-23T15:00:00Z");

  it("the cron's task carries her instructions, not the repository's, once she saves", async () => {
    const repo = JSON.parse((await row<{ task_input: string }>(`SELECT task_input FROM standing_duties WHERE id = '${AGENT}'`))!.task_input).prompt;
    expect(await firedPrompt(now)).toBe(repo);

    const mine = "Only buyers at $20M and up. Name the source you opened for each one.";
    const saved = await editDuty(env as any, AGENT, { instructions: mine }, now);
    expect(saved.changed).toEqual(["instructions"]);
    expect(await firedPrompt(now + 1000)).toBe(mine);

    // Undo to the last version: back to the repository's words, and the newer version is kept.
    await undoDuty(env as any, AGENT, now + 2000);
    expect(await firedPrompt(now + 3000)).toBe(repo);
    const versions = await versionsOf(env as any, AGENT);
    expect(versions.map((v) => v.action)).toEqual(["undo", "edit", "original"]);
    expect(versions.find((v) => v.action === "edit")!.owner_prompt).toBe(mine);
  });

  it("Pause stops it: the cron makes no task, and resuming does not fire a backlog", async () => {
    await pauseDuty(env as any, AGENT, true, now);
    const r = await materialiseDueDuties(env as any, now);
    expect(r.fired.map((f) => f.duty)).not.toContain(AGENT);
    expect(r.skipped).toContainEqual({ duty: AGENT, reason: "suspended" });
    expect(await all(`SELECT id FROM tasks WHERE employee_id = 'emp_research'`)).toHaveLength(0);

    await pauseDuty(env as any, AGENT, false, now);
    const d = await row<{ suspended: number; next_due_at: number }>(`SELECT suspended, next_due_at FROM standing_duties WHERE id = '${AGENT}'`);
    expect(d!.suspended).toBe(0);
    expect(d!.next_due_at).toBeGreaterThan(now);
  });

  it("a new schedule is what the cron reads next", async () => {
    await editDuty(env as any, AGENT, { schedule: "weekly:3", hour: 9 }, now);
    const d = await row<any>(`SELECT cadence, weekday, local_hour, next_due_at, owner_schedule_at FROM standing_duties WHERE id = '${AGENT}'`);
    expect(d).toMatchObject({ cadence: "weekly", weekday: 3, local_hour: 9 });
    expect(d.owner_schedule_at).toBe(now);
    const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "long", hour: "numeric", hour12: false }).format(new Date(d.next_due_at));
    expect(local).toMatch(/Wednesday/);
    expect(local).toMatch(/\b9\b|09/);
    const r = await materialiseDueDuties(env as any, now + 60_000);
    expect(r.fired.map((f) => f.duty)).not.toContain(AGENT);
  });
});

describe("a Mac duty hears the owner through /brief", () => {
  beforeEach(reset);
  const now = Date.parse("2026-10-23T15:00:00Z");

  it("her instructions reach the brief, and the repo default is untouched when she writes none", async () => {
    expect((await dutyBrief(env as any, "mailbox-sweep.sh", now)).instructions).toBeNull();
    await editDuty(env as any, MAC_PROMPT, { instructions: "Look for cooling buyers only." }, now);
    const b = await dutyBrief(env as any, "mailbox-sweep.sh", now);
    expect(b.instructions).toBe("Look for cooling buyers only.");
    expect(briefDecision(b as any)).toMatchObject({ run: true, instructions: "Look for cooling buyers only." });
  });

  it("Pause and Remove stop the Mac job; Undo brings a removed duty back", async () => {
    await pauseDuty(env as any, MAC_FIXED, true, now);
    expect(briefDecision((await dutyBrief(env as any, "lp-daily.mjs", now)) as any).run).toBe(false);
    await pauseDuty(env as any, MAC_FIXED, false, now);
    expect(briefDecision((await dutyBrief(env as any, "lp-daily.mjs", now)) as any).run).toBe(true);

    await expect(removeDuty(env as any, MAC_FIXED, false, now)).rejects.toThrow(/confirmation/);
    await removeDuty(env as any, MAC_FIXED, true, now);
    const gone = await dutyBrief(env as any, "lp-daily.mjs", now);
    expect(gone.removed).toBe(true);
    expect(briefDecision(gone as any).run).toBe(false);
    await undoDuty(env as any, MAC_FIXED, now);
    expect((await dutyBrief(env as any, "lp-daily.mjs", now)).removed).toBe(false);
  });

  it("a duty with fixed steps refuses an instructions edit rather than storing words nothing reads", async () => {
    await expect(editDuty(env as any, MAC_FIXED, { instructions: "be nicer" }, now)).rejects.toThrow(/no written instructions/);
    expect((await row<any>(`SELECT owner_prompt FROM standing_duties WHERE id = '${MAC_FIXED}'`))!.owner_prompt).toBeNull();
  });

  it("a rescheduled Mac duty is gated by its days; its time stays the Mac's", async () => {
    await expect(editDuty(env as any, MAC_FIXED, { hour: 14 }, now)).rejects.toThrow(/own set time/);
    // Fri 23 Oct → Mondays only: today is not one of her days.
    await editDuty(env as any, MAC_FIXED, { schedule: "weekly:1" }, now);
    const b = await dutyBrief(env as any, "lp-daily.mjs", now);
    expect(b.owner_schedule).toBe(true);
    expect(b.due).toBe(false);
    expect(briefDecision(b as any).run).toBe(false);
    const monday = Date.parse("2026-10-26T11:00:00Z");
    expect((await dutyBrief(env as any, "lp-daily.mjs", monday)).due).toBe(true);
  });
});

describe("the pages read real D1", () => {
  beforeEach(reset);

  it("Your team: a card per employee, handles from her real duties", async () => {
    const { status, body } = await apiJson<any>("/api/duties/team");
    expect(status).toBe(200);
    const monique = body.data.team.find((t: any) => t.name === "Monique");
    const duties = await all<{ name: string }>(`SELECT name FROM standing_duties WHERE employee_id = 'emp_relationship' AND removed_at IS NULL`);
    expect(monique.handles.sort()).toEqual(duties.map((d) => d.name).sort());
    expect(body.data.team.map((t: any) => t.name)).not.toContain("Task Intake");
  });

  it("the employee page: instructions say where they come from, and a removed duty moves to its own list", async () => {
    const { body } = await apiJson<any>("/api/duties/employee/emp_relationship");
    const sweep = body.data.duties.find((d: any) => d.id === MAC_PROMPT);
    expect(sweep.instructions.source).toBe("repo");
    expect(sweep.instructions.text.length).toBeGreaterThan(200);
    expect(body.data.duties.find((d: any) => d.id === MAC_FIXED).instructions.source).toBe("fixed");

    const edit = await apiJson<any>(`/api/duties/${MAC_PROMPT}/edit`, { method: "POST", body: { instructions: "Mine." } });
    expect(edit.status).toBe(200);
    await apiJson<any>(`/api/duties/${MAC_FIXED}/remove`, { method: "POST", body: { confirm: true } });
    const after = (await apiJson<any>("/api/duties/employee/emp_relationship")).body.data;
    expect(after.duties.find((d: any) => d.id === MAC_PROMPT).instructions).toMatchObject({ source: "owner", text: "Mine." });
    expect(after.duties.map((d: any) => d.id)).not.toContain(MAC_FIXED);
    expect(after.removed.map((d: any) => d.id)).toContain(MAC_FIXED);
  });

  it("the Team page's duties grid: every active employee's duties in one list, with owner, cadence, last run and an example", async () => {
    await env.DB.prepare(`DELETE FROM duty_runs WHERE duty_id = ?`).bind(MAC_FIXED).run();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO duty_runs (id, duty_id, local_job, finished_at, created_at, outcome, reason) VALUES ('dr_grid_1', ?, 'x', 1000, 1000, 'ok', 'Older words.')`).bind(MAC_FIXED),
      env.DB.prepare(`INSERT INTO duty_runs (id, duty_id, local_job, finished_at, created_at, outcome, reason) VALUES ('dr_grid_2', ?, 'x', 2000, 2000, 'ok', '  Sent   3 notes.  ')`).bind(MAC_FIXED),
      env.DB.prepare(`INSERT INTO duty_runs (id, duty_id, local_job, finished_at, created_at, outcome, reason) VALUES ('dr_grid_3', ?, 'x', 3000, 3000, 'failed', 'A failure is never the example.')`).bind(MAC_FIXED),
    ]);
    const { status, body } = await apiJson<any>("/api/duties/all");
    expect(status).toBe(200);
    const expected = await all<{ id: string }>(
      `SELECT d.id FROM standing_duties d JOIN employees e ON e.id = d.employee_id WHERE d.removed_at IS NULL AND e.lifecycle NOT IN ('retired','merged')`);
    expect(expected.length).toBeGreaterThan(5);
    expect(body.data.duties.map((d: any) => d.id).sort()).toEqual(expected.map((d) => d.id).sort());
    const fixed = body.data.duties.find((d: any) => d.id === MAC_FIXED);
    expect(fixed.owner.name).toBe("Monique");
    expect(typeof fixed.schedule_words).toBe("string"); expect(fixed.schedule_words.length).toBeGreaterThan(3);
    expect(fixed.what.length).toBeGreaterThan(10);
    expect(fixed.example).toBe('Last time it reported: "Sent 3 notes."');
    expect(fixed.instructions.source).toBe("fixed");
    // Sorted by owner, then duty, so one person's duties sit together.
    const keys = body.data.duties.map((d: any) => `${d.owner.name}\u0000${d.name}`);
    expect(keys).toEqual([...keys].sort((a: string, b: string) => a.localeCompare(b)));
    // The grid edits through the same routes: a change and a removal show on the next read.
    await apiJson<any>(`/api/duties/${MAC_PROMPT}/edit`, { method: "POST", body: { instructions: "Grid words." } });
    await apiJson<any>(`/api/duties/${MAC_FIXED}/remove`, { method: "POST", body: { confirm: true } });
    const after = (await apiJson<any>("/api/duties/all")).body.data.duties;
    expect(after.find((d: any) => d.id === MAC_PROMPT).instructions).toMatchObject({ source: "owner", text: "Grid words." });
    expect(after.find((d: any) => d.id === MAC_PROMPT).changes).toBe(1);
    expect(after.map((d: any) => d.id)).not.toContain(MAC_FIXED);
  });

  it("a remove without confirmation is refused at the route", async () => {
    const r = await apiJson<any>(`/api/duties/${MAC_FIXED}/remove`, { method: "POST", body: {} });
    expect(r.status).toBe(400);
  });
});
