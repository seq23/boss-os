-- 0379 · NOELLE'S MEASUREMENT LEDGER (24 Nov 2026; brief noelle-v2 item 11).
--
-- One row per thing Noelle did that reaches the world: a Studio post per platform, a bank or cadence PR, a
-- Search Loop change, a pin refill. Each names the scoreboard measure it is judged on and its day-30 and
-- day-60 floors (its new-format scorecard's, else the measure's reading the day she acted). Her weekly run
-- and Monday's email read them back against growth_readings (src/shared/boss/growth/ledger.mjs).
-- Ids, kinds, channels and numbers only: no post text, no customer, LP or client name.
-- Additive only: one table, one index, one data_policy row.

CREATE TABLE IF NOT EXISTS noelle_actions (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL,
  day          TEXT NOT NULL,                -- the Central day she acted (the run's day)
  kind         TEXT NOT NULL,                -- studio-plan | job-target | search-loop | page-new | pin-refill
  business     TEXT NOT NULL,
  channel      TEXT NOT NULL,
  item         TEXT NOT NULL,                -- the piece id, the PR (seq23/repo#n) or the workflow started
  post_at      TEXT,                         -- when it goes out, when known
  measure      TEXT,                         -- the scoreboard measure id (NULL: no measure for this business)
  floor30      REAL,
  floor60      REAL,
  floor_source TEXT NOT NULL CHECK (floor_source IN ('scorecard','baseline','not read')),
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_noelle_actions_once ON noelle_actions(run_id, kind, business, channel, item);
CREATE INDEX IF NOT EXISTS idx_noelle_actions_day ON noelle_actions(day DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('noelle_actions', 'growth', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Noelle''s ledger: what kind of thing she did, for which business and channel, the item id, its measure and floors. No post text, no customer, LP or client names.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0379_boss_noelle_actions');
