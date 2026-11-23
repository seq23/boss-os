-- 0378 · NOELLE RUNS ON HER MAC (23 Nov 2026; plan artifact 8LfYgMaHj7XLVB1fJ1vYxM, gap review G16).
--
-- Noelle is now a scheduled Claude session (scripts/ops/noelle.sh, launchd com.seq.boss-noelle, one slot a
-- day between 10:00 and 21:59 Central, never on the hour; Thursday after 14:00 the weekly run). Boss OS
-- re-checks her plan and keeps the record (src/worker/boss/growth/noelle.ts). The free-model weekly cycle
-- this duty ran (worker_job 'growth') is removed in the same PR.
--
-- 1. noelle_runs: one row per run (planned → done, or stopped with its NAMED STOP codes). Counts, stop
--    codes and one plain line; no customer, LP or client name.
-- 2. duty_growth_director becomes her heartbeat: daily 22:05 Central, worker_job 'growth' (her module, src/worker/boss/growth/noelle.ts noelleWatch). No run row
--    today → "Noelle did not run" in tomorrow's morning email and NAMED STOP [NOELLE_DID_NOT_RUN]; the same
--    stop three days running → one line to Sequoia.
--
-- Additive only: one table, the duty's schedule, title, input and floor.

CREATE TABLE IF NOT EXISTS noelle_runs (
  id          TEXT PRIMARY KEY,
  day         TEXT NOT NULL,                -- the Central day of the slot (YYYY-MM-DD)
  slot        TEXT,                         -- HH:MM Central
  kind        TEXT NOT NULL CHECK (kind IN ('daily','weekly')),
  state       TEXT NOT NULL CHECK (state IN ('planned','done','stopped')),
  stops       TEXT NOT NULL DEFAULT '[]',   -- JSON list of NAMED STOP codes
  calls       INTEGER NOT NULL DEFAULT 0,   -- Claude calls this run used
  line        TEXT,
  reads       TEXT NOT NULL DEFAULT '{}',   -- JSON { sources: {id: {at, sha, error}}, queues: {"biz:channel": n}, unread: {"biz:channel": why} }
  notices     TEXT NOT NULL DEFAULT '[]',   -- JSON list of the notice keys the gate passed for this run; done may announce only these
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_noelle_runs_day ON noelle_runs(day DESC, created_at DESC);
-- One plan per slot: a plan posted twice for the same day, slot and kind is a replay, never a second run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_noelle_runs_slot ON noelle_runs(day, slot, kind) WHERE state IN ('planned','done');

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('noelle_runs', 'growth', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Noelle''s runs: the day, the slot, how many Claude calls, the NAMED STOP codes and one plain line of counts. No customer, LP or client names.')
ON CONFLICT(entity) DO NOTHING;

UPDATE standing_duties
   SET name = 'Growth: check Noelle ran today',
       task_title = 'Growth: check Noelle ran today',
       cadence = 'daily', weekday = NULL, local_hour = 22, local_minute = 5,
       task_input = json_object(
         'worker_job', 'growth',
         'delivers', 'noelle_runs',
         'sends', 'nothing: one morning line when she did not run, one Notices line to Sequoia when the same stop repeats three days'
       ),
       success_criteria = 'A run row exists for today, planned, done or stopped with its named stop; none is NAMED STOP [NOELLE_DID_NOT_RUN] and a line in the morning email.'
 WHERE id = 'duty_growth_director';

UPDATE standing_duties SET output_metric = 'runs recorded', output_floor = 1, output_runs = 1, output_reason = 'A day with no Noelle run row ends with the named stop NOELLE_DID_NOT_RUN and the morning line, never a quiet green.', output_since = unixepoch() * 1000 - 60000 WHERE id = 'duty_growth_director';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0378_boss_noelle_runs');
