import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson } from "./helpers";

/**
 * "AM I DUE?" — the question a daily launchd tick asks before doing monthly work.
 *
 * ─── What was measured, 13 September 2026 ──────────────────────────────────
 *
 *   com.seq.boss-ahrefs-audit   LOADED, runs = 0, last exit code "(never exited)"
 *   ~/Library/Logs/ahrefs-audit-fix/   empty
 *   site_audit_findings         0 rows, ever
 *
 * The plist is dated 11 Sep 18:06, AFTER that week's Thursday 06:00 window, so its first occurrence
 * had not come round. Nothing was broken — and that is the point. A `StartCalendarInterval` naming
 * ONE moment looks identical whether it is waiting or dead, and she runs a laptop that sleeps. A
 * machine shut down through the one moment loses the whole period, which at a monthly cadence is a
 * month.
 *
 * So the calendar entry became DAILY and cheap, and the job asks the duty row. These tests are about
 * the three answers that gate has to be able to give, and about the one it must NEVER give.
 */

const HOUR = 3_600_000;

/** A local-job duty with a schedule under this test's control. */
async function seedDuty(over: { nextDueAt: number | null; suspended?: number; localJob?: string }) {
  const localJob = over.localJob ?? "test-tick.sh";
  await env.DB
    .prepare(
      `INSERT INTO standing_duties
         (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
          next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended)
       VALUES ('duty_due_probe', 'A probe duty', 'emp_repo', 'ops', 6, 0, 'America/Chicago',
               'monthly', NULL, ?, 'local_job', 'ops', 'A probe duty',
               json_object('local_job', ?), 'x', ?)`,
    )
    .bind(over.nextDueAt, localJob, over.suspended ?? 0)
    .run();
  return localJob;
}

describe("a scheduled job asks whether it is due", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM standing_duties WHERE id = 'duty_due_probe'`).run();
  });

  it("says DUE when the clock has passed, and names since when", async () => {
    const job = await seedDuty({ nextDueAt: Date.now() - 2 * HOUR });
    const { status, body } = await apiJson(`/api/duties/due/${job}`);
    expect(status).toBe(200);
    expect(body.data.due).toBe(true);
    expect(body.data.duty_id).toBe("duty_due_probe");
    expect(body.data.reason).toMatch(/due since/i);
  });

  it("says NOT DUE on the twenty-nine days out of thirty, and names when it next is", async () => {
    const job = await seedDuty({ nextDueAt: Date.now() + 5 * 24 * HOUR });
    const { body } = await apiJson(`/api/duties/due/${job}`);
    expect(body.data.due).toBe(false);
    expect(body.data.reason).toMatch(/not due until/i);
  });

  /**
   * A SUSPENDED DUTY IS A DECISION, NOT A GAP. She turned it off; a tick that ran it anyway would be
   * the system overruling her, and one that reported it as a fault would be crying wolf.
   */
  it("refuses to run a suspended duty and says it is a decision", async () => {
    const job = await seedDuty({ nextDueAt: Date.now() - 5 * 24 * HOUR, suspended: 1 });
    const { body } = await apiJson(`/api/duties/due/${job}`);
    expect(body.data.due).toBe(false);
    expect(body.data.suspended).toBe(true);
    expect(body.data.reason).toMatch(/decision rather than a gap/i);
  });

  it("refuses when it cannot tell, rather than answering 'not due'", async () => {
    const { status } = await apiJson("/api/duties/due/nothing-names-this.sh");
    // 400, NOT a 200 with due:false. An unknown job answered "not due" would retire itself in
    // silence, which is the exact defect class this whole mechanism closes.
    expect(status).toBe(400);
  });

  it("refuses a job named by more than one duty rather than picking", async () => {
    const job = await seedDuty({ nextDueAt: Date.now() - HOUR, localJob: "shared-tick.sh" });
    await env.DB
      .prepare(
        `INSERT INTO standing_duties
           (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
            next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended)
         VALUES ('duty_due_probe_two', 'Another', 'emp_repo', 'ops', 6, 0, 'America/Chicago',
                 'monthly', NULL, ?, 'local_job', 'ops', 'Another',
                 json_object('local_job', ?), 'x', 0)`,
      )
      .bind(Date.now() - HOUR, job)
      .run();

    const { status } = await apiJson(`/api/duties/due/${job}`);
    expect(status).toBe(400);
    await env.DB.prepare(`DELETE FROM standing_duties WHERE id = 'duty_due_probe_two'`).run();
  });

  it("reads only — asking must never advance the clock", async () => {
    const dueAt = Date.now() - 3 * HOUR;
    const job = await seedDuty({ nextDueAt: dueAt });
    await apiJson(`/api/duties/due/${job}`);
    await apiJson(`/api/duties/due/${job}`);

    const after = await env.DB
      .prepare(`SELECT next_due_at, last_run_at FROM standing_duties WHERE id = 'duty_due_probe'`)
      .first<{ next_due_at: number; last_run_at: number | null }>();
    expect(after?.next_due_at).toBe(dueAt);
    // Asking is not running. Stamping on the question is the shortcut that would hide every gap.
    expect(after?.last_run_at).toBeNull();
  });
});

/**
 * THE AHREFS DUTY SPECIFICALLY — weekly on Thursday, and its seed agrees with that cadence.
 *
 * ─── The rule this has always guarded, through two cadence changes ──────────
 *
 * Migration 0227 seeded `next_due_at` as `unixepoch() * 1000 + 86400000` — TOMORROW — on a WEEKLY
 * Thursday duty, while its own comment stated the rule it broke: "a duty whose cadence and seed
 * disagree is left due on the wrong day and nothing says so." That contradiction is what composed
 * the line the owner found in Today's contract. **The invariant under test is that agreement**, and
 * it outlives whichever cadence is current.
 *
 * ─── 0246: back to weekly, and the stale-weekday hazard INVERTS ─────────────
 *
 * 0232 made the pass monthly on her instruction, and this block then asserted `weekday IS NULL` —
 * correctly, because `nextDueAt` ignores weekday for a monthly cadence, so a leftover Thursday
 * would have been a fact governing nothing.
 *
 * 0246 makes it weekly again, on the evidence of the first run ever to complete: 48 Site Audit
 * mails across 23 projects in 14 days, delivered overnight into four consecutive Thursdays UTC.
 * **So the direction of the weekday rule reverses.** Under a weekly cadence, a NULL weekday is now
 * the defect: `nextDueAt` falls back to its own default day, and the duty quietly fires on a
 * weekday nobody chose — which is the same class of silent drift, wearing the opposite value.
 *
 * Both halves are asserted here, which is why this is strictly tighter than what it replaces: the
 * old test pinned the cadence, one weekday value, the hour, the job and the seed's day-of-month.
 * This pins the cadence, the weekday POSITIVELY (a value, not an absence), the hour, the job, and
 * the seed's day-of-WEEK, its hour, and that it is inside one cadence period rather than merely in
 * the future — a monthly-shaped seed left on a weekly duty would pass the old "not in the past"
 * check and fail this one.
 */
describe("duty_site_audit_repair after 0246", () => {
  it("is weekly on Thursday, names its weekday, and is seeded in agreement with that cadence", async () => {
    const duty = await env.DB
      .prepare(
        `SELECT cadence, weekday, local_hour, next_due_at,
                json_extract(task_input, '$.local_job') AS local_job
           FROM standing_duties WHERE id = 'duty_site_audit_repair'`,
      )
      .first<any>();

    expect(duty?.cadence).toBe("weekly");
    /*
     * 4 rather than NULL, and asserted as a VALUE. `nextDueAt` honours weekday for a weekly cadence
     * and defaults when it is absent, so an unnamed day is a duty firing whenever the scheduler
     * happens to choose. `validate:audit-fixer` holds the same line from outside the database.
     */
    expect(duty?.weekday).toBe(4);
    expect(duty?.local_hour).toBe(6);
    expect(duty?.local_job).toBe("ahrefs-audit-fix.sh");

    // ── THE 0197 RULE: the seed agrees with the cadence, which is the original defect. ──
    expect(duty.next_due_at).toBeGreaterThan(Date.now());
    // A Thursday, because that is the day the cadence names. 4 = Thursday, 0 = Sunday.
    expect(new Date(duty.next_due_at).getUTCDay()).toBe(4);
    /*
     * 11:00 UTC is 06:00 America/Chicago in summer and one hour EARLY in winter — deliberately the
     * safe direction, because the daily tick asks "am I due?" at 06:00 local and must already find
     * yes. Seeding late would settle the run permanently on Friday.
     */
    expect(new Date(duty.next_due_at).getUTCHours()).toBe(11);
    /*
     * AND INSIDE ONE WEEK, which is the assertion that actually catches a cadence change whose seed
     * was not updated with it. A next_due_at three weeks out is a monthly seed wearing a weekly
     * cadence: it is in the future, it is even on a Thursday, and it is still wrong.
     */
    expect(duty.next_due_at - Date.now()).toBeLessThan(8 * 24 * HOUR);
  });

  /**
   * THE STANDING CONSTRAINT, ASSERTED RATHER THAN TRUSTED TO A MIGRATION'S GOOD MANNERS.
   *
   * The repair lane may never auto-fix `local-guides-citation-velocity`. A migration that rebuilt
   * `task_input` to change a cadence is the obvious way to drop that exclusion without anyone
   * noticing, so the test checks the exclusion SURVIVED rather than checking that any particular
   * migration was careful.
   *
   * TWO cadence changes have now passed through this row — 0232 and 0246 — and both touched only
   * the schedule columns and said so in their own text. That is exactly the claim this test refuses
   * to take on trust, and it gets stronger with each migration that leaves it standing: the risk is
   * not one careless author, it is the third or fourth edit by someone who has stopped reading.
   */
  it("still forbids the fixer from touching local-guides-citation-velocity", async () => {
    const duty = await env.DB
      .prepare(
        `SELECT json_extract(task_input, '$.never') AS never, success_criteria
           FROM standing_duties WHERE id = 'duty_site_audit_repair'`,
      )
      .first<{ never: string; success_criteria: string }>();

    expect(duty?.never).toMatch(/local-guides-citation-velocity is off limits/i);
    expect(duty?.success_criteria).toMatch(/local-guides-citation-velocity is surfaced and never touched/i);
  });
});
