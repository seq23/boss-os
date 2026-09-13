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
 * So maintenance is DAILY and the snapshot was WEEKLY. That was exactly what she asked for - the
 * snapshot is the thing she named - without slowing the steps her screens depend on.
 *
 * SUPERSEDED ON 13 SEP 2026: THE SNAPSHOT IS NOW DAILY, AT THE END OF HER DAY. The owner's
 * instruction is "one per day, at the end of the day". Weekly had done its job - the flood stopped -
 * but a week of work is a week of work to lose, and by 13 Sep production held 68 snapshot rows all
 * dated 6 Sep and nothing since. Both halves of that are now closed: the snapshot rides a wall-clock
 * evening window in HER zone, and retention moved with it (see SNAPSHOT_KEEP).
 */

import { dayIdInZone, zonedTime } from "../../../shared/boss/timezone";

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/**
 * The documented hour. BOSS_OS_DEPLOY.md has said 03:00 UTC since the artifact was written; this
 * makes the code agree with the document rather than the document with the code.
 */
export const MAINTENANCE_HOUR_UTC = 3;

/**
 * The nominal gap between snapshots - ONE DAY, per the owner's instruction of 13 Sep 2026.
 *
 * WHAT THIS IS FOR, now that `snapshotDue` runs on a window rather than an elapsed time. It is the
 * cadence half of the retention invariant below: how far back `SNAPSHOT_KEEP` copies actually
 * reach is `KEEP x INTERVAL`, and that product is the number RESTORE_CHECKLIST.md asks about. The
 * two constants are only meaningful together, so they are declared together and checked together
 * by `npm run validate:retention-outlasts-checklist`.
 */
export const SNAPSHOT_INTERVAL_MS = 1 * DAY_MS;

/**
 * A quarter, as RESTORE_CHECKLIST.md means it: ninety days.
 *
 * NINETY RATHER THAN 91.31 (a calendar year over four) because the checklist asks a human question -
 * "is the most recent offsite copy less than a quarter old" - and ninety days is what a quarter means
 * when someone says it out loud. Pinning it here rather than leaving it implicit in a comment is the
 * whole point: it is the number the retention invariant compares against.
 */
export const QUARTER_MS = 90 * DAY_MS;

/**
 * How many snapshots survive: NINETY.
 *
 * THE REASONING IS UNCHANGED AND THE NUMBER MOVED WITH THE CADENCE, which is the part that matters.
 * Retention has never been "twelve" for its own sake - it was sized so that the copies on hand reach
 * back at least as far as the window RESTORE_CHECKLIST.md asks about ("the most recent offsite copy
 * is less than a quarter old"). Retention shorter than the checklist's own question deletes the
 * evidence the checklist exists to look for.
 *
 * Under the WEEKLY cadence that arithmetic was 12 x 7 days = 84 days, which was already six days
 * short of the quarter it claimed to match. Going daily while leaving KEEP at 12 would have cut
 * coverage from twelve weeks to TWELVE DAYS silently, with the comment still saying "a quarter" -
 * exactly the shape this repository names: two components each holding half of one fact, free to
 * drift. So: 90 daily snapshots = 90 days = the quarter, and
 * `scripts/validate/retention-outlasts-the-checklist.mjs` now enforces `KEEP x INTERVAL >= QUARTER`
 * so the pair can never drift apart again.
 *
 * WHAT IT COSTS, stated rather than discovered later: production snapshots run ~800 KB, so ninety of
 * them is ~72 MB in R2. That is the intended price of being able to restore any day of the last
 * quarter, and `skipIfUnchanged` means quiet days cost nothing at all.
 */
export const SNAPSHOT_KEEP = 90;

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
 * The hour that ends her day, on her clock. 20:00 America/Chicago.
 *
 * "END OF DAY" IS A WALL-CLOCK FACT AND A ZONE-DEPENDENT ONE, so it is written as an hour in
 * `OWNER_TIMEZONE` and never as a UTC hour or a fixed offset. Central is UTC-5 in September and
 * UTC-6 in December; an offset written down today is wrong twice a year, and a backup that wanders
 * an hour each equinox is a backup nobody can reason about.
 *
 * WHY 20:00 AND NOT 22:00 OR 23:00, which would read as "later in the evening". The snapshot step
 * lives inside `runScheduled`, and `runScheduled` is itself gated to one pass a day at
 * MAINTENANCE_HOUR_UTC (03:00 UTC). So the snapshot window must ALREADY BE OPEN when that pass
 * happens, or the snapshot silently waits a further 24 hours:
 *
 *   03:00 UTC  ->  22:00 Central the previous evening in CDT (UTC-5)  -> window opened 2h ago
 *   03:00 UTC  ->  21:00 Central the previous evening in CST (UTC-6)  -> window opened 1h ago
 *
 * Both offsets land the maintenance pass on the same Central evening, comfortably after 20:00. At
 * 21:00 the winter margin is exactly zero and a minute of scheduler skew loses a day; at 22:00 it
 * is negative and the cadence quietly halves. `tests/boss/cadence.test.ts` pins that margin in both
 * offsets, so moving this hour later fails loudly instead of costing backups.
 */
export const SNAPSHOT_HOUR_LOCAL = 20;

/**
 * The instant today's snapshot window opens, where "today" is her calendar day, not UTC's.
 */
export function snapshotWindowOpensAt(now: number): number {
  const [year, month, day] = dayIdInZone(now).split("-").map(Number) as [number, number, number];
  return zonedTime(year, month, day, SNAPSHOT_HOUR_LOCAL);
}

/**
 * Is a snapshot due?
 *
 * A WINDOW, NOT A ROLLING INTERVAL, and that is the fix rather than a detail. The old test was
 * `now - lastCompletedAt >= INTERVAL`, which anchors the next snapshot to however late the last one
 * finished. Under a weekly interval that drift was invisible; daily it compounds into a backup that
 * wanders earlier through the day until it is firing mid-afternoon, in the middle of her edits,
 * capturing a half-finished day and calling it the day's copy.
 *
 * So this reads exactly like `maintenanceDue`: the window has opened and no snapshot has COMPLETED
 * inside it. Two properties follow, and both matter.
 *
 *   - It cannot drift. Today's window opens at 20:00 Central whatever happened yesterday.
 *   - A missed tick does not skip a day. Any later pass on the same evening still finds the window
 *     open and unserved, where "at 20:00 exactly" would lose the day in silence.
 *
 * COMPLETED, not attempted: a fortnight of failures must not look like a fortnight of backups. Null
 * means none has ever completed, which is due the moment the window opens.
 */
export function snapshotDue(now: number, lastCompletedAt: number | null): boolean {
  const opensAt = snapshotWindowOpensAt(now);
  if (now < opensAt) return false;
  return lastCompletedAt === null || lastCompletedAt < opensAt;
}

/**
 * IS THE VAULT STALE? ASKED OF THE CADENCE THAT TAKES THE SNAPSHOTS.
 *
 * ─── The defect this exists to end ─────────────────────────────────────────
 *
 * `fpb_vault_stale` had been ACTIVE on the Governance screen continuously, and it was RIGHT — the
 * newest complete snapshot in production was 6 September and it was read on the 13th. But it was
 * right by coincidence, because the rule it used was a number nobody linked to anything:
 *
 *     governance.ts   stale_vault: !snapshot || now - snapshot.ts > 2 * 86_400_000
 *     sentinel.ts     stale_vault: !snapshot || now - snapshot.ts > 2 * DAY_MS
 *
 * TWO COPIES OF ONE RULE, in two files, each free to drift from the other and BOTH free to drift
 * from the cadence that actually takes the snapshots. When the owner asked for a daily snapshot
 * "at end of day" and the window moved, neither of these knew: they would have kept measuring a
 * daily backup against a two-day ruler, and a fortnight later somebody would have changed the
 * cadence again and discovered the alarm still worked by accident.
 *
 * So the question is asked of the schedule. Stale means THE LAST WINDOW CLOSED UNSERVED: a
 * snapshot taken inside last night's window is current all of today, and a night that was missed
 * goes red the next morning. Change `SNAPSHOT_HOUR_LOCAL` or the cadence, and the alarm moves with
 * it, because there is nothing else for it to move independently of.
 *
 * ONE MISSED NIGHT IS RED, DELIBERATELY, and it is the one place in this system where that is the
 * right threshold. Everywhere else a single miss is a closed laptop; here the thing that did not
 * happen is the copy that protects everything else.
 */
export function vaultIsStale(now: number, lastCompletedAt: number | null): boolean {
  if (lastCompletedAt === null) return true;
  return lastCompletedAt < snapshotWindowOpensAt(now - 86_400_000);
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
