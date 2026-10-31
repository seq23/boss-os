import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { dutyBrief } from "../../src/worker/boss/duties/ownerEdits";
import { briefDecision } from "../../src/shared/boss/duties/ownerEdits.mjs";
import { dutyStaleness, staleDutyAlertText } from "../../src/worker/boss/duties/staleness";
import { apiJson, insertTask, row } from "./helpers";

/**
 * THE CRITICAL ALERTS OF 31 OCT 2026, each pinned where it was fixed.
 *
 * 1. duty_search_readiness_repair (Tuesday 07:30 Central) missed its first Tuesday: her Mac is on
 *    Eastern, its daily 07:30 tick asked at 06:30 Central and /brief said "not due". The gate now uses
 *    the same early-run grace the run recorder credits, so a tick before the slot runs on its own day.
 * 2. Today said "has never fired" about a duty with seven reported runs. A reported run is evidence
 *    the clock fired; the words now say the runs did not finish, and why.
 * 4. A cancelled failed task now records why.
 */
const SR = "duty_search_readiness_repair";
const TUE_0730_CT = Date.UTC(2026, 9, 27, 12, 30); // Tue 27 Oct 2026 07:30 CDT

describe("a Mac duty whose daily tick falls before its slot runs on its own day", () => {
  it("the Eastern 07:30 tick (06:30 Central) on Tuesday is told the Tuesday 07:30 Central duty is due", async () => {
    await env.DB.prepare(`UPDATE standing_duties SET suspended = 0, removed_at = NULL, owner_schedule_at = NULL, next_due_at = ? WHERE id = ?`).bind(TUE_0730_CT, SR).run();
    const b = await dutyBrief(env as any, "search-readiness-fix.sh", TUE_0730_CT - 3_600_000);
    expect(b.due).toBe(true);
    expect(briefDecision(b as any, { onlyIfDue: true })).toMatchObject({ run: true, code: 0 });
  });

  it("NEGATIVE: the day before (Monday's tick, 23 hours early) is still not due", async () => {
    await env.DB.prepare(`UPDATE standing_duties SET suspended = 0, removed_at = NULL, owner_schedule_at = NULL, next_due_at = ? WHERE id = ?`).bind(TUE_0730_CT, SR).run();
    const b = await dutyBrief(env as any, "search-readiness-fix.sh", TUE_0730_CT - 23 * 3_600_000);
    expect(b.due).toBe(false);
    expect(briefDecision(b as any, { onlyIfDue: true })).toMatchObject({ run: false, code: 10 });
  });
});

describe("Today never says 'never fired' about a duty that reported runs", () => {
  const base = {
    id: SR, name: "Monday's Search Readiness gaps, fixed on Tuesday at source and put live",
    cadence: "weekly", weekday: 2, weekdays: null, local_hour: 7, local_minute: 30, timezone: "America/Chicago",
    suspended: 0, last_run_at: null, created_at: Date.UTC(2026, 9, 25, 18, 0),
  };
  const now = Date.UTC(2026, 9, 31, 12, 0);

  it("runs reported but none finished: says it fires, when, and why the last one did not finish", () => {
    const d = { ...base, last_outcome: "failed", last_outcome_at: Date.UTC(2026, 9, 30, 14, 4), last_failure_reason: "NAMED STOP [SR_QUEUE_STALLED] 12 workable briefs left" };
    const late = dutyStaleness(d, now);
    expect(late.stale).toBe(true);
    const text = staleDutyAlertText(d, late);
    expect(text).not.toMatch(/never fired/);
    expect(text).toMatch(/fires, but no run has finished cleanly/);
    expect(text).toContain("SR_QUEUE_STALLED");
    expect(text).toMatch(/1 scheduled run has gone by\.$/);
  });

  it("NEGATIVE: nothing ever reported is still 'never fired', loud", () => {
    const late = dutyStaleness(base, now);
    expect(staleDutyAlertText(base, late)).toMatch(/has never fired since it was created, and 1 scheduled run has gone by\./);
  });
});

describe("cancelling a failed task records why", () => {
  it("the reason is on the row, the task event and the audit log", async () => {
    const id = await insertTask({ status: "failed" });
    const reason = "Cause fixed at source; the work is no longer wanted.";
    const { status, body } = await apiJson(`/api/tasks/${id}/cancel`, { method: "POST", body: { reason } });
    expect(status).toBe(200);
    expect(body.data ?? body).toMatchObject({ cancelled: true, reason });
    expect((await row<any>(`SELECT status, error FROM tasks WHERE id = ?`, id))).toMatchObject({ status: "cancelled", error: `Cancelled by the Boss: ${reason}` });
    expect(JSON.parse((await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'cancelled'`, id))!.detail).reason).toBe(reason);
    expect(JSON.parse((await row<any>(`SELECT detail FROM audit_log WHERE entity_type = 'task' AND entity_id = ? AND action = 'cancelled'`, id))!.detail).reason).toBe(reason);
  });

  it("NEGATIVE: without a reason it still cancels and says only who did it", async () => {
    const id = await insertTask({ status: "failed" });
    const { status } = await apiJson(`/api/tasks/${id}/cancel`, { method: "POST", body: {} });
    expect(status).toBe(200);
    expect((await row<any>(`SELECT error FROM tasks WHERE id = ?`, id))!.error).toBe("Cancelled by the Boss");
  });
});

describe("deciding a site audit finding records why", () => {
  it("dismissed with a reason: notes, archived, and an audit row", async () => {
    const id = "saf_test_oct31";
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO site_audit_findings (id, project, domain, repo, mapped_by, disposition, headline, because, suggested_action, run_id, found_at, updated_at)
       VALUES (?, 'checklist:example.com', 'example.com', 'dailystory', 'repo_identity', 'surfaced', 'a1: www alias uses 302', 'x', 'y', 'run_t', ?, ?)`,
    ).bind(id, now, now).run();
    const reason = "Hosting limit: no repository change can move the redirect code.";
    const { status } = await apiJson(`/api/engineering/site-audit-findings/${id}/dismissed`, { method: "POST", body: { reason } });
    expect(status).toBe(200);
    const r = await row<any>(`SELECT status, notes, archived_at FROM site_audit_findings WHERE id = ?`, id);
    expect(r).toMatchObject({ status: "dismissed", notes: reason });
    expect(r.archived_at).toBeGreaterThan(0);
    expect(JSON.parse((await row<any>(`SELECT detail FROM audit_log WHERE entity_id = ? AND action = 'finding_dismissed'`, id))!.detail).reason).toBe(reason);
  });
});
