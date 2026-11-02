-- OPEN LOOPS (owner ruling, 1 Nov 2026: "Open Loops is the one list of everything approved but not
-- finished"). ADDITIVE ONLY: one new table. Was a claude.ai artifact edited by hand; now rows here,
-- (table owner_open_loops: `open_loops` is the older Today day-loops table, 0156) read by ☰ More → Open Loops (src/client/boss/pages/OpenLoops.tsx), written through
-- src/worker/boss/routes/openLoops.ts, chased in Simone's morning email (section "open_loops") and,
-- for rows the team owns, by one repair task per overdue date (src/shared/boss/openLoops/openLoops.mjs).
CREATE TABLE IF NOT EXISTS owner_open_loops (
  id             TEXT PRIMARY KEY,                   -- olp_…
  title          TEXT NOT NULL,
  finish_line    TEXT NOT NULL,                      -- the real outcome in plain words ("live in both stores, selling")
  next_step      TEXT,
  owner          TEXT NOT NULL,                      -- an employee id (emp_…), "claude", "codex" or "sequoia"
  next_date      TEXT,                               -- YYYY-MM-DD, Central; never set on a parked row
  business       TEXT NOT NULL,                      -- a brain slug (src/shared/boss/brains/brain.mjs BRAIN_SLUGS)
  section        TEXT NOT NULL DEFAULT 'not_finished', -- not_finished | parked
  status         TEXT NOT NULL DEFAULT 'open',       -- open | closed
  closed_reason  TEXT,                               -- the real outcome when closed
  closed_at      INTEGER,
  source         TEXT NOT NULL DEFAULT 'manual',     -- manual | named_stop | agent_report
  source_key     TEXT,                               -- repo + named stop, for the intake's upsert
  blocked_by     TEXT,                               -- another loop's id; her row shows only once that one is closed
  repair_for     TEXT,                               -- the next_date a repair task was opened for (one per date)
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_open_loops_source_key ON owner_open_loops (source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owner_open_loops_status ON owner_open_loops (status, section);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('owner_open_loops', 'duties', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'The owner''s list of approved work not yet finished: titles, next steps and dates across her businesses. Read by her screens, the morning email and repair tasks; never sent to a model as a list.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0331_boss_open_loops');
