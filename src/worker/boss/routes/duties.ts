/**
 * A launchd job on her Mac, reaching the duty row in D1 that says it is work.
 *
 * ─── The defect, in her words ──────────────────────────────────────────────
 *
 *   "I DONT CARE IF ITS LAUNCHD OR D1 — THOSE SHOULD BE LINKED ANYWAY."
 *
 * Monique's duties ran correctly from launchd — `capital.log` shows the buyer work firing and
 * emailing her — while `standing_duties.last_run_at` read NULL, because the D1 cron is not what
 * executes them. A session read the null and reported that the duties had never run. She caught it.
 *
 * CONFIRMED on production, 11 September 2026: ten duties carry `executor = 'local_job'` and only
 * THREE have ever recorded a run. Those three are exactly the three whose launchd job happens to
 * post to an endpoint that hardcodes their duty id — `routes/kdp.ts` does it twice, `routes/lp.ts`
 * once. The other seven have been running for days and read as never having run.
 *
 * ─── Why this is not a second list ─────────────────────────────────────────
 *
 * The obvious fix is a table of "launchd label → duty id", and it would drift the first time
 * anything was renamed, which is this repository's most-produced defect: two components each
 * keeping their own list with no link.
 *
 * THE DUTY ROW ALREADY NAMES ITS SCRIPT. `task_input.$.local_job` has carried it since 0201, and
 * `validate:duty-delivery` has been checking since then that the named script exists and that the
 * installer names it. So the wrapper reports the script it is running — which it must know anyway,
 * because it is running it — and the resolution happens HERE, against the list that already exists.
 * Nothing new is written down and there is nothing new to keep in step.
 *
 * A script that resolves to no duty, or to more than one, is REFUSED rather than guessed at, and
 * `validate:launchd-duty-link` proves both directions offline so the refusal never has to happen.
 *
 * ─── Three rules about what may be written ─────────────────────────────────
 *
 * 1. `last_run_at` MOVES ONLY ON SUCCESS. The tempting shortcut is to stamp it when the scheduler
 *    fires; that makes every screen green and the number meaningless, and it would have hidden the
 *    exact confusion this endpoint exists to end. A duty that did not run still looks like a duty
 *    that did not run.
 *
 * 2. A FAILURE IS RECORDED, NOT SWALLOWED. Before this, a failed run left the previous success
 *    standing and unqualified. `last_outcome` and `last_failure_reason` are written on both paths,
 *    so a failing duty reads as "last succeeded on the 9th, failing since" — a third sentence,
 *    distinct from both "it ran" and "it never ran".
 *
 * 3. `next_due_at` ADVANCES ONLY ON SUCCESS TOO. A failed run leaves the duty due, because it is.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound } from "../lib/http";
import { materialiseDueDuties } from "../duties/materialise";
import { isDue, nextDueAt } from "../duties/cadence";

export const duties = new Hono<{ Bindings: Env; Variables: Vars }>();

const OUTCOMES = new Set(["ok", "failed"]);
const MAX_REASON = 600;

const text = (v: unknown, max = MAX_REASON): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Advance a duty's clock, or leave it alone and say why.
 *
 * An unschedulable duty keeps its old clock rather than being given an invented one. It reads as
 * overdue, which is the honest render of "nobody can say when this runs next".
 */
export function advance(
  duty: { local_hour: number; local_minute: number; timezone: string; cadence: string; weekday: number | null; weekdays: string | null },
  now: number,
): number | null {
  let weekdays: number[] | null = null;
  try { weekdays = duty.weekdays ? (JSON.parse(duty.weekdays) as number[]) : null; } catch { weekdays = null; }
  try {
    return nextDueAt(
      {
        local_hour: duty.local_hour, local_minute: duty.local_minute, timezone: duty.timezone,
        cadence: duty.cadence as "daily" | "weekly" | "monthly", weekday: duty.weekday, weekdays,
      },
      now,
    );
  } catch {
    return null;
  }
}

/**
 * "This launchd job just finished, and here is how it went."
 *
 * The wrapper posts the SCRIPT NAME, never a duty id. That is the whole of the no-second-list
 * design: the caller knows what it ran, the duty row knows what it wants run, and the join is made
 * here against a column that has existed since 0201.
 */
duties.post("/ran", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const localJob = text(b?.local_job, 120);
  const outcome = String(b?.outcome ?? "").trim();

  if (!localJob) {
    throw badRequest(
      "Say which script ran",
      "A run that cannot name the job it performed cannot be attached to a duty, and an unattached run is one nobody can read.",
    );
  }
  if (!OUTCOMES.has(outcome)) {
    throw badRequest(
      `"${outcome}" is not a run outcome`,
      "One of: ok, failed. There is no third state — a wrapper that cannot say which is itself a failure.",
    );
  }

  /*
   * RESOLVED FROM THE DUTY'S OWN DECLARATION. Not from a mapping table, and not from a duty id the
   * caller carried: a caller that names its own duty can name the wrong one and nothing would know.
   */
  const matches = await c.env.DB
    .prepare(
      `SELECT id, local_hour, local_minute, timezone, cadence, weekday, weekdays, last_run_at, executor
         FROM standing_duties
        WHERE json_extract(task_input, '$.local_job') = ?`,
    )
    .bind(localJob)
    .all<any>();
  const rows = matches.results ?? [];

  if (rows.length === 0) {
    throw badRequest(
      `No standing duty names "${localJob}" as its local job`,
      "Either the script was renamed and the duty row was not, or this job is not duty work at all. " +
        "Refused rather than guessed at: attaching a run to the wrong duty is worse than attaching it to none.",
    );
  }
  if (rows.length > 1) {
    throw badRequest(
      `${rows.length} duties name "${localJob}" as their local job`,
      `They are: ${rows.map((r: any) => r.id).join(", ")}. One script, one duty — otherwise a single run would ` +
        "silently vouch for two pieces of work. validate:launchd-duty-link fails the build on this.",
    );
  }

  const duty = rows[0];
  const now = Date.now();
  const reason = text(b?.reason);
  const exitCode = Number.isFinite(Number(b?.exit_code)) ? Math.trunc(Number(b.exit_code)) : null;
  const startedAt = Number.isFinite(Number(b?.started_at)) ? Math.trunc(Number(b.started_at)) : null;
  const source = b?.source === "manual" ? "manual" : "launchd";

  if (outcome === "failed" && !reason) {
    throw badRequest(
      "A failed run has to say why",
      "A red row with no sentence on it is one nobody can act on, which is the same as not recording the failure at all.",
    );
  }

  const runId = newId("dr");
  await c.env.DB
    .prepare(
      `INSERT INTO duty_runs (id, duty_id, local_job, started_at, finished_at, outcome, exit_code, reason, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(runId, duty.id, localJob, startedAt, now, outcome, exitCode, reason, source, now)
    .run();

  if (outcome === "ok") {
    const next = advance(duty, now);
    await c.env.DB
      .prepare(
        next === null
          ? `UPDATE standing_duties SET last_run_at = ?, last_outcome = 'ok', last_outcome_at = ?, last_failure_reason = NULL WHERE id = ?`
          : `UPDATE standing_duties SET last_run_at = ?, last_outcome = 'ok', last_outcome_at = ?, last_failure_reason = NULL, next_due_at = ? WHERE id = ?`,
      )
      .bind(...(next === null ? [now, now, duty.id] : [now, now, next, duty.id]))
      .run();
  } else {
    /*
     * `last_run_at` IS NOT TOUCHED, AND `next_due_at` IS NOT ADVANCED.
     *
     * The duty last ran when it last WORKED, and it is still due, because the work did not happen.
     * Writing either of them here would turn a failure into the appearance of a run — which is the
     * "stamp it on schedule" shortcut arriving through a side door.
     */
    await c.env.DB
      .prepare(`UPDATE standing_duties SET last_outcome = 'failed', last_outcome_at = ?, last_failure_reason = ? WHERE id = ?`)
      .bind(now, reason, duty.id)
      .run();
  }

  await logEvent(c.env.DB, {
    level: outcome === "failed" ? "warn" : "info",
    scope: "duties", event: "local_run_recorded", entityId: duty.id,
    detail: { local_job: localJob, outcome, exit_code: exitCode },
  }).catch(() => {});

  await audit(c.env.DB, {
    actor: "system", lane: "ops", entityType: "standing_duty", entityId: duty.id,
    action: outcome === "ok" ? "local_run_ok" : "local_run_failed", detail: { local_job: localJob, run_id: runId },
  });

  return ok(c, { run_id: runId, duty_id: duty.id, outcome, last_run_at: outcome === "ok" ? now : duty.last_run_at }, 201);
});

/**
 * IS THIS JOB DUE RIGHT NOW? Read-only, and the answer a launchd job asks before doing any work.
 *
 * ─── Why a scheduled job has to ask ────────────────────────────────────────
 *
 * `com.seq.boss-ahrefs-audit` was installed with a single `StartCalendarInterval` naming Thursday
 * 06:00 and, measured on 13 Sep 2026, had `runs = 0` and "(never exited)" — it had never fired once.
 * The plist was written on 11 Sep at 18:06, which is AFTER that week's Thursday window, so its first
 * occurrence would have been a week later. The calendar entry was not broken; it simply had not
 * come round.
 *
 * That is the benign reading, and it is exactly why the design is wrong. She runs on a laptop that
 * sleeps on battery. A calendar entry that names ONE moment a week — or, now that the cadence is
 * monthly, one moment a MONTH — has one chance to fire, and a machine that is shut down through it
 * loses the whole period. Widening the schedule and hoping is the version of this fix that looks
 * like a fix.
 *
 * ─── The design that survives a sleeping machine ───────────────────────────
 *
 * The calendar entry becomes DAILY and cheap, and the JOB asks whether it is actually due. The
 * duty row's `next_due_at` is the only clock — the one the ingest endpoint already advances — so
 * there is no second schedule to drift. Consequences:
 *
 *   - A missed day costs a day, not a month. The next morning's tick finds the duty still due.
 *   - launchd runs a missed daily calendar entry when the machine wakes, so ordinary sleep is
 *     covered by launchd itself and a full shutdown is covered by tomorrow.
 *   - A day when nothing is due exits 0 having deliberately done nothing AND SAYING SO, which is
 *     the only form of "exit 0 having done nothing" this repository permits.
 *
 * IT RESOLVES BY SCRIPT NAME, like `/ran`, so no second list exists to fall out of step.
 */
duties.get("/due/:local_job", async (c) => {
  const localJob = c.req.param("local_job");
  const matches = await c.env.DB
    .prepare(
      `SELECT id, name, suspended, next_due_at, last_run_at, executor
         FROM standing_duties
        WHERE json_extract(task_input, '$.local_job') = ?`,
    )
    .bind(localJob)
    .all<any>();
  const rows = matches.results ?? [];

  if (rows.length === 0) {
    throw badRequest(
      `No standing duty names "${localJob}" as its local job`,
      "Refused rather than guessed at. A job that cannot find its duty must not decide for itself " +
        "whether it is due — that is a second schedule, which is the thing this design removes.",
    );
  }
  if (rows.length > 1) {
    throw badRequest(
      `${rows.length} duties name "${localJob}" as their local job`,
      `They are: ${rows.map((r: any) => r.id).join(", ")}. validate:launchd-duty-link fails the build on this.`,
    );
  }

  const duty = rows[0];
  const now = Date.now();
  const due = duty.next_due_at !== null && isDue(duty.next_due_at, Boolean(duty.suspended), now);

  return ok(c, {
    duty_id: duty.id,
    local_job: localJob,
    due,
    suspended: Boolean(duty.suspended),
    next_due_at: duty.next_due_at,
    last_run_at: duty.last_run_at,
    // The sentence the job prints when it declines to run, so a skip in a log is self-explaining.
    reason: duty.suspended
      ? "the duty is suspended, which is a decision rather than a gap"
      : duty.next_due_at === null
        ? "the duty has no next_due_at, so nothing can say whether it is due"
        : due
          ? `due since ${new Date(duty.next_due_at).toISOString()}`
          : `not due until ${new Date(duty.next_due_at).toISOString()}`,
  });
});

/**
 * What the OS screen and the Mac should now agree about.
 *
 * Every local_job duty, its real last successful run, its last outcome, and — for a duty that has
 * been failing — the sentence the job wrote. A duty that has never reported reads as exactly that
 * rather than as one that never ran, and the two are told apart by `executor`.
 */
/**
 * RUN THIS DUTY NOW.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 *
 * There was no way to fire a standing duty except waiting for its clock, and that is fine until
 * something about the duty CHANGES. Migration 0237 rewrote the Executive Intelligence Report's
 * prompt to follow §5's eleven sections; the only way to learn whether the run produced them was to
 * wait for 06:30 and look. "It will work tomorrow" is a promise, and a promise is what this
 * repository has a standing rule against handing her in place of evidence.
 *
 * IT BYPASSES THE CLOCK AND NOTHING ELSE. Suspension still refuses, a `local_job` still refuses —
 * its work needs credentials the agent deliberately does not have — intake may still decline, and
 * the budget and backend guards run exactly as they do at 06:30. The one thing skipped is "is it
 * due", which is the one thing she is overriding.
 *
 * THE CLOCK STILL ADVANCES, because a run is a run. Firing the morning report at lunchtime means
 * the next one is tomorrow morning, not lunchtime plus a day — `materialiseDueDuties` computes the
 * next occurrence from the schedule rather than from now, so an on-demand run cannot drag a duty
 * off its own timetable.
 */
/** One settings row per duty serialises presses. It holds for at most this long if the Worker dies mid-press. */
const RUN_NOW_CLAIM_PREFIX = "run_now_claim:";
const RUN_NOW_CLAIM_MS = 30_000;

/** Take the press for this duty with a conditional write: exactly one concurrent caller gets `true`. */
async function takeRunNowClaim(db: D1Database, key: string, now: number): Promise<boolean> {
  await db.prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, '0', ?)`).bind(key, now).run();
  const taken = await db
    .prepare(`UPDATE settings SET value = ?, updated_at = ? WHERE key = ? AND CAST(value AS INTEGER) < ?`)
    .bind(String(now + RUN_NOW_CLAIM_MS), now, key, now)
    .run();
  return (taken.meta.changes ?? 0) > 0;
}

async function releaseRunNowClaim(db: D1Database, key: string): Promise<void> {
  await db.prepare(`UPDATE settings SET value = '0', updated_at = ? WHERE key = ?`).bind(Date.now(), key).run();
}

duties.post("/:id/run-now", async (c) => {
  const id = c.req.param("id");
  const duty = await c.env.DB
    .prepare(`SELECT id, name, suspended, executor FROM standing_duties WHERE id = ?`).bind(id)
    .first<{ id: string; name: string; suspended: number; executor: string | null }>();
  if (!duty) throw notFound("No standing duty with that id");

  /*
   * A PRESS IS RESERVED BEFORE IT IS CHECKED (review of #59). The in-flight read and the task creation are separate operations, so two
   * presses (two tabs) — or a press overlapping another — could both see nothing in flight and both queue a run. One row per duty in
   * `settings` is taken with a conditional write, so only one caller holds it; the other is answered at once. It expires on its own
   * after 30 seconds so a Worker that dies mid-press cannot hold a duty for ever, and it is released as soon as the press is done.
   */
  const claimKey = `${RUN_NOW_CLAIM_PREFIX}${id}`;
  if (!(await takeRunNowClaim(c.env.DB, claimKey, Date.now()))) {
    return ok(c, {
      fired: false,
      duty: duty.id,
      reason: "already_in_flight",
      note: `Another press for "${duty.name}" is being handled right now. Give it a moment, then check Today.`,
    });
  }
  try {
  /*
   * A RUN ALREADY IN FLIGHT IS ANSWERED, NOT DOUBLED (1 Oct 2026). The briefing now has a button, and a second press while the first
   * is queued or running would queue a second run: two spends of her plan, the second overwriting the first's report. ONLY STATUS
   * DECIDES, not age (review of #59): her Mac claims a few times a day, so a task queued at 15:00 legitimately waits until 18:35, and
   * the reaper (`backends/reap.ts`) is what turns a run that never reports into a failed task after `UNCLAIMED_ALLOWED_MS`. A finished
   * or failed run never blocks a retry, which is the whole point of the button.
   */
  const inFlight = await c.env.DB
    .prepare(
      `SELECT t.id, t.status, t.created_at FROM standing_duties d JOIN tasks t ON t.id = d.last_task_id
        WHERE d.id = ? AND t.status IN ('queued','running')`,
    )
    .bind(id)
    .first<{ id: string; status: string; created_at: number }>();
  if (inFlight) {
    await audit(c.env.DB, {
      actor: "boss", lane: "ops", entityType: "standing_duty", entityId: id,
      action: "run_now", detail: { fired: false, reason: "already_in_flight", task_id: inFlight.id },
    });
    return ok(c, {
      fired: false,
      duty: duty.id,
      reason: "already_in_flight",
      task_id: inFlight.id,
      note: `"${duty.name}" already has a run ${inFlight.status === "queued" ? "waiting for your Mac to pick it up" : "in progress"}. Let it finish; if it fails, the Today card says why and you can run it again.`,
    });
  }

  const result = await materialiseDueDuties(c.env, Date.now(), id);
  const fired = result.fired.find((f: { duty: string }) => f.duty === id) ?? null;
  const skipped = result.skipped.find((sk: { duty: string }) => sk.duty === id) ?? null;

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "standing_duty", entityId: id,
    action: "run_now", detail: { fired: Boolean(fired), reason: skipped?.reason ?? null },
  });

  if (!fired) {
    return ok(c, {
      fired: false,
      duty: duty.id,
      reason: skipped?.reason ?? "not_materialised",
      /*
       * A REFUSAL IS A REAL OUTCOME AND SAYS WHY. `local_job` is the one people will hit and it is
       * not a fault: that work runs from launchd on her Mac because it needs credentials the agent
       * strips on purpose.
       */
      note:
        skipped?.reason === "local_job"
          ? `"${duty.name}" runs from a scheduled job on your Mac, not from an agent — it needs logins the agent deliberately does not carry. Run it there.`
          : skipped?.reason === "suspended"
            ? `"${duty.name}" is suspended. Un-suspend it first; running it by hand does not override that.`
            : `"${duty.name}" was not queued: ${skipped?.reason ?? "no reason recorded"}.`,
    });
  }

  return ok(c, {
    fired: true,
    duty: duty.id,
    task_id: fired.task_id,
    next_due_at: fired.next_due_at,
    note: `"${duty.name}" is queued. A runner claims it next; its result lands wherever the duty delivers.`,
  }, 201);
  } finally {
    await releaseRunNowClaim(c.env.DB, claimKey);
  }
});

duties.get("/runs", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT d.id, d.name, d.employee_id, d.executor, d.suspended, d.next_due_at,
              d.last_run_at, d.last_outcome, d.last_outcome_at, d.last_failure_reason,
              json_extract(d.task_input, '$.local_job') AS local_job,
              (SELECT COUNT(*) FROM duty_runs r WHERE r.duty_id = d.id) AS runs_recorded
         FROM standing_duties d
        ORDER BY d.executor, d.id`,
    )
    .all<any>();

  const recent = await c.env.DB
    .prepare(
      `SELECT id, duty_id, local_job, finished_at, outcome, exit_code, reason, source
         FROM duty_runs ORDER BY finished_at DESC LIMIT 40`,
    )
    .all<any>();

  return ok(c, {
    duties: rows.results ?? [],
    recent: recent.results ?? [],
    /*
     * SAID ON THE SCREEN RATHER THAN INFERRED FROM A NULL. The whole confusion was a null being
     * read as "never ran", so the one sentence that would have prevented it is rendered.
     */
    how_to_read:
      "last_run_at is the last time the work actually happened, written by the job itself when it finished. " +
      "A local_job duty with no runs recorded has not reported since this link was built — which is not the " +
      "same as never having run, and the launchd log on her Mac is the other half of the answer.",
  });
});
