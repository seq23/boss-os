-- 0370 · BOSS OS'S OWN CLOCK FOR ITS GITHUB JOBS (21 Nov 2026, Kendra's alarm mail:morning-email).
--
-- GitHub's `schedule` event fired this account's workflows once every 6-9 hours from about
-- 2026-11-17 20:40Z, and the 21 Nov morning email was never built. The Worker's five-minute cron is
-- now the clock (src/worker/boss/cron/dispatch.ts); each due slot of a worker-clocked Schedule row is
-- claimed here before its repository_dispatch, so two ticks fire it once and a refusal is retried.
--
-- key: "<schedule row id>:<YYYY-MM-DD>:<HH:MM>" (Central). status: claimed | accepted | refused |
-- no_token | error. detail: what GitHub said, or why nothing was sent.
--
-- Additive only: one new table and its data_policy row.
CREATE TABLE IF NOT EXISTS cloud_job_dispatches (
  key           TEXT PRIMARY KEY,
  job           TEXT NOT NULL,
  event         TEXT NOT NULL,
  due_at        INTEGER NOT NULL,
  claimed_at    INTEGER NOT NULL,
  dispatched_at INTEGER,
  status        TEXT NOT NULL CHECK (status IN ('claimed','accepted','refused','no_token','error')),
  attempts      INTEGER NOT NULL DEFAULT 1,
  detail        TEXT
);
CREATE INDEX IF NOT EXISTS idx_cloud_job_dispatches_job ON cloud_job_dispatches(job, due_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('cloud_job_dispatches', 'duties', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Boss OS''s own clock: which slot of which boss-os GitHub job was started, and GitHub''s status. A job id, a time and a status line; no names, no text from the work.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0370_boss_cloud_clock');
