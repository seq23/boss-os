-- 0374 · A SLOT GITHUB ACCEPTED BUT NEVER RAN IS SAID OUT LOUD (22 Nov 2026).
--
-- On 22 Nov the 06:40 morning-email slot was accepted on time, then sat in GitHub's queue for 65
-- minutes and sent at 07:46 Central; the 07:30 and 07:50 starts were replaced in the job's one-pending
-- concurrency group. Nobody was told, because the clock only knew GitHub had ACCEPTED each start.
-- The runner now reports each slot's start and end (scripts/ops/cloud-slot.mjs, cloud-job.yml), and
-- the clock's tick writes one Updates notice per job per day when a watched slot did not start within
-- 20 minutes, started late or ended badly (src/worker/boss/cron/dispatch.ts slotCheck).
--   started_at   ms the run's first step reported (NULL: never started, or the report did not reach)
--   finished_at  ms the run's last step reported
--   outcome      ok | failed | cancelled, from the job's own status
--
-- Additive only: three nullable columns.
ALTER TABLE cloud_job_dispatches ADD COLUMN started_at INTEGER;
ALTER TABLE cloud_job_dispatches ADD COLUMN finished_at INTEGER;
ALTER TABLE cloud_job_dispatches ADD COLUMN outcome TEXT;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0374_boss_cloud_clock_slot_runs');
