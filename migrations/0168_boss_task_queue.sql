-- Boss OS ran employee work on Cloudflare Queues. This chassis does not use them
-- (ADR-017: Cron Triggers are the only scheduling primitive), and Queues need the
-- Workers Paid plan besides. So the queue becomes a table and the cron drains it.
--
-- The contract Boss OS's consumer already expects is preserved exactly: a message
-- is a { taskId, lane, attempt }, a failure retries, and a message that gives up
-- goes to the dead letter path rather than vanishing. What changes is only where
-- the message waits.
CREATE TABLE boss_task_queue (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL,
  lane         TEXT NOT NULL,
  attempt      INTEGER NOT NULL DEFAULT 0,
  -- pending | running | done | dead
  state        TEXT NOT NULL DEFAULT 'pending',
  -- unix ms; a retry is not eligible until its backoff has passed
  visible_at   INTEGER NOT NULL,
  enqueued_at  INTEGER NOT NULL,
  finished_at  INTEGER,
  last_error   TEXT
);

-- The drain query: eligible work, oldest first.
CREATE INDEX idx_boss_task_queue_ready ON boss_task_queue (state, visible_at);


-- The chassis answers "what schema is applied" from this table, and /api/health and the
-- policy suite both read it. A migration that runs without recording itself leaves the
-- system reporting a version older than the one it is actually running, so every ported
-- Boss OS migration registers here exactly as the chassis's own do.
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0168_boss_task_queue');
