-- 0371 · THE CLOCK WAITS OUT GITHUB'S RATE LIMIT (21 Nov 2026, Kendra's alarm mail:cloud-clock).
--
-- GitHub refused errand-reminders' 01:10Z dispatch with a 403 rate limit (the PAT's user shares one
-- 5,000/hour REST quota with every gh call on her Mac); the retry rode it out ten minutes later, but
-- the first refusal woke a repair. A rate limit, a 5xx or a network failure is now a wait:
--   retry_after  the earliest ms the slot may be tried again (GitHub's retry-after / x-ratelimit-reset);
--                NULL once the slot is accepted, terminal or expired.
--   retry_until  the last ms the slot is retryable: the later of the 30-minute catch-up end and the
--                quota freeing, never past 90 minutes after the slot (src/worker/boss/cron/dispatch.ts).
-- The status vocabulary (and its CHECK) is unchanged.
--
-- Additive only: two nullable columns and a partial index.
ALTER TABLE cloud_job_dispatches ADD COLUMN retry_until INTEGER;
ALTER TABLE cloud_job_dispatches ADD COLUMN retry_after INTEGER;
CREATE INDEX IF NOT EXISTS idx_cloud_job_dispatches_pending ON cloud_job_dispatches(due_at)
  WHERE retry_after IS NOT NULL;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0371_boss_cloud_clock_retry');
