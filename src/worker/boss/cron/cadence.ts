/**
 * WHAT CADENCE THE MAINTENANCE RUN ACTUALLY HAS.
 *
 * THE DEFECT THIS CLOSES. `runScheduled` is documented everywhere as nightly - "03:00 UTC,
 * four steps" in BOSS_OS_DEPLOY.md, "the nightly cron" in Diagnostics, `takeSnapshot(env,
 * "nightly")` in the code - and it was called from the Worker's `scheduled()` handler on every
 * tick of `crons = ["*\/15 * * * *"]`. That cron belongs to the West Peek chassis job runner,
 * which genuinely wants a quarter-hourly tick; the Boss maintenance was hung off the same wire
 * without a guard, so it ran 96 times a day.
 *
 * Measured in production on 6 Sep 2026, before this fix: 62 snapshots in 14 hours 45 minutes,
 * 30,377,113 bytes in R2, each snapshot larger than the last - 235 KB at 01:45, 726 KB at 16:30,
 * 3.1x in one day - on a database holding 0 tasks, 0 approvals, 0 people and 1 audit row. The
 * growth was not the owner's data. `audit_log`, `system_events` and `cron_runs` are all inside
 * SNAPSHOT_TABLES and the run writes to all three, so every snapshot re-serialised the record of
 * every snapshot before it. Nothing pruned, in R2 or in `vault_snapshots`.
 *
 * TWO CADENCES, NOT ONE, and the split is deliberate. The owner's instruction was "the cron job
 * should be only 1x per week right now, i dont do enough on this system to snapshot more than
 * that". Taken literally against the whole run it would have broken two daily promises the
 * product makes on screen: People says "Commitments appear here the day they come due", which is
 * `surface_follow_ups`, and Settings shows a `$/day` ops budget, which is `roll_budgets`. A
 * follow-up due Tuesday surfacing on Sunday is a worse defect than the one being fixed.
 *
 * So maintenance is DAILY and the snapshot is WEEKLY. That is exactly what she asked for - the
 * snapshot is the thing she named - without slowing the steps her screens depend on.
 */

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/**
 * The documented hour. BOSS_OS_DEPLOY.md has said 03:00 UTC since the artifact was written; this
 * makes the code agree with the document rather than the document with the code.
 */
export const MAINTENANCE_HOUR_UTC = 3;

/** One week, per the owner's instruction of 6 Sep 2026. */
export const SNAPSHOT_INTERVAL_MS = 7 * DAY_MS;

/**
 * How many snapshots survive. Twelve weekly snapshots is roughly a quarter, which is the window
 * RESTORE_CHECKLIST.md already asks about ("the most recent offsite copy is less than a quarter
 * old"). Retention that is shorter than the checklist's own question would delete the evidence
 * the checklist exists to look for.
 */
export const SNAPSHOT_KEEP = 12;

/**
 * The instant today's maintenance window opens. A window rather than a match on the hour: the
 * tick is quarter-hourly and a Worker can miss a beat, so "03:00 or later, once" survives a
 * missed tick where "at 03:00" would silently skip a day.
 */
export function maintenanceWindowOpensAt(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS + MAINTENANCE_HOUR_UTC * HOUR_MS;
}

/**
 * Is the daily maintenance run due?
 *
 * `lastStartedAt` is the newest `cron_runs.started_at`, or null if the system has never run one.
 * Due when the window has opened and no run has started inside it. Comparing against the window
 * rather than "the last 24 hours" keeps the run anchored to a wall-clock hour instead of drifting
 * later every day by however long the previous run took.
 */
export function maintenanceDue(now: number, lastStartedAt: number | null): boolean {
  const opensAt = maintenanceWindowOpensAt(now);
  if (now < opensAt) return false;
  return lastStartedAt === null || lastStartedAt < opensAt;
}

/**
 * Is a snapshot due?
 *
 * Elapsed time since the last COMPLETED snapshot, not since the last attempt: a week of failures
 * must not look like a week of backups. Null means none has ever completed, which is due.
 */
export function snapshotDue(now: number, lastCompletedAt: number | null): boolean {
  return lastCompletedAt === null || now - lastCompletedAt >= SNAPSHOT_INTERVAL_MS;
}

/**
 * Tables whose churn is not a reason to write a new copy of everything else.
 *
 * These three are the diagnostic spine - they grow on every run by definition, including the run
 * that is deciding whether anything changed. Hashing them would make "has anything changed?"
 * answer yes forever, which is precisely how the old behaviour justified itself.
 *
 * `audit_log` is deliberately NOT here. It records what was actually done to the system, so a new
 * audit row IS a change worth preserving, and treating history as noise is how you discover the
 * backup skipped the week that mattered.
 */
export const CHURN_TABLES = new Set(["system_events", "cron_runs"]);
