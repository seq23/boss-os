import { describe, expect, it } from "vitest";
import { row } from "./helpers";

/**
 * ONE CLOCK FOR THE SEARCH READINESS REPAIR PASS (owner rulings, 25 Oct 2026): weekly, TUESDAY 07:30
 * Central, working from Monday's 06:00 audit queue; the Thursday Ahrefs pass is unchanged. The duty
 * row is the schedule — launchd only ticks daily and asks it (--only-if-due).
 */
describe("duty_search_readiness_repair", () => {
  it("is weekly on Tuesday at 07:30 Central, Danielle's, run by the queue driver", async () => {
    const d = await row<any>(`SELECT cadence, weekday, local_hour, local_minute, timezone, executor, employee_id, task_input, suspended, next_due_at FROM standing_duties WHERE id = 'duty_search_readiness_repair'`);
    expect(d).toMatchObject({ cadence: "weekly", weekday: 2, local_hour: 7, local_minute: 30, timezone: "America/Chicago", executor: "local_job", employee_id: "emp_repo", suspended: 0 });
    expect(JSON.parse(d.task_input).local_job).toBe("search-readiness-fix.sh");
    // Seeded on a Tuesday 07:30 CDT, in the same statement as the cadence.
    expect(new Date(d.next_due_at).toISOString()).toBe("2026-10-27T12:30:00.000Z");
    expect(new Date(d.next_due_at).getUTCDay()).toBe(2);
  });
  it("leaves the Thursday Ahrefs pass on Thursday", async () => {
    const a = await row<any>(`SELECT cadence, weekday FROM standing_duties WHERE id = 'duty_site_audit_repair'`);
    expect(a.weekday).toBe(4);
  });
});
