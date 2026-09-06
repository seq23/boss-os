-- The nightly cron ran ninety-six times a day.
--
-- `runScheduled` is documented as nightly in BOSS_OS_DEPLOY.md, labels its own snapshots
-- "nightly", and is reported as "the last nightly run" on the Settings screen. It was called from
-- the Worker's scheduled() handler on every tick of `crons = ["*/15 * * * *"]` - the chassis job
-- runner's cadence, which Boss maintenance was hung off without a guard.
--
-- Measured in production before the fix, on a database holding 0 tasks, 0 approvals, 0 people and
-- 1 audit row: 62 snapshots in 14h45m, 30,377,113 bytes in R2, growing 235 KB -> 726 KB in a
-- single day. The growth was not data the owner entered. `audit_log`, `system_events` and
-- `cron_runs` are all inside SNAPSHOT_TABLES and the run writes to all three, so every snapshot
-- re-serialised the record of every snapshot before it. Nothing pruned, ever.
--
-- The cadence fix lives in src/worker/boss/cron/cadence.ts. This migration adds the two columns
-- that make the new behaviour honest in the data rather than only in the code.

-- The hash of everything EXCEPT the diagnostic spine, so "has anything actually changed?" has an
-- answer that does not include the row written by the run asking the question. Nullable: every
-- snapshot taken before this migration has no substance hash and must not be mistaken for one
-- that matched.
ALTER TABLE vault_snapshots ADD COLUMN substance_sha TEXT;

-- When retention deleted the R2 object. The row survives its object deliberately: a pruned
-- snapshot keeps its id, timestamp, hash and table counts, so vault history stays readable and a
-- restore against it fails saying "pruned" rather than with a missing-key error that reads like
-- corruption.
ALTER TABLE vault_snapshots ADD COLUMN pruned_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_snapshots_substance ON vault_snapshots(substance_sha);

-- `status` carries no CHECK constraint (0152), so the two new values it can now hold are recorded
-- here rather than enforced: 'skipped' - due, taken, and identical to the last one, so no object
-- was written; and 'pruned' - written, kept for its retention window, then deleted by retention.
-- Both are complete descriptions of a deliberate non-event. Neither is a failure, and Diagnostics
-- must not colour them as one.
