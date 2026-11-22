import { describe, expect, it } from "vitest";
import { row } from "./helpers";

/**
 * ONE CLOCK FOR THE SEARCH READINESS REPAIR PASS (owner rulings, 25 Oct 2026): weekly, TUESDAY NIGHT 22:15
 * Central since the Mac's day (21 Nov 2026, migration 0373: heavy work at night; 06:30 from 1 Nov, 07:30 before), working from Monday's 06:00 audit queue; the Thursday Ahrefs pass is unchanged. The duty
 * row is the schedule — launchd only ticks daily and asks it (--only-if-due).
 */
describe("duty_search_readiness_repair", () => {
  it("is weekly on Tuesday at 22:15 Central, Danielle's, run by the queue driver", async () => {
    const d = await row<any>(`SELECT cadence, weekday, local_hour, local_minute, timezone, executor, employee_id, task_input, suspended, next_due_at FROM standing_duties WHERE id = 'duty_search_readiness_repair'`);
    expect(d).toMatchObject({ cadence: "weekly", weekday: 2, local_hour: 22, local_minute: 15, timezone: "America/Chicago", executor: "local_job", employee_id: "emp_repo", suspended: 0 });
    expect(JSON.parse(d.task_input).local_job).toBe("search-readiness-fix.sh");
    // Re-seeded by 0373 in the same statement as the new time: the next Tuesday, 22:15 CST (04:15 UTC Wednesday), within a week.
    expect(new Date(d.next_due_at).getUTCHours() * 60 + new Date(d.next_due_at).getUTCMinutes()).toBe(4 * 60 + 15);
    expect(d.next_due_at).toBeGreaterThan(Date.now());
    expect(d.next_due_at - Date.now()).toBeLessThan(8 * 24 * 3_600_000);
    expect(new Date(d.next_due_at).getUTCDay()).toBe(3);
  });
  it("leaves the Thursday Ahrefs pass on Thursday", async () => {
    const a = await row<any>(`SELECT cadence, weekday, local_hour, local_minute, next_due_at FROM standing_duties WHERE id = 'duty_site_audit_repair'`);
    expect(a).toMatchObject({ weekday: 4, local_hour: 22, local_minute: 15 }); // Thursday night (the Mac's day)
    expect(new Date(a.next_due_at).getUTCHours()).toBe(4);
    expect(new Date(a.next_due_at).getUTCDay()).toBe(5);
  });
});
