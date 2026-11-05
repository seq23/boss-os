-- Runtime-only addresses. No business records are seeded or changed.
CREATE TABLE IF NOT EXISTS person_reminders (
  address TEXT PRIMARY KEY COLLATE NOCASE,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  acted_at INTEGER NOT NULL DEFAULT 0,
  last_day TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rainmaker_addresses (
  address TEXT PRIMARY KEY COLLATE NOCASE,
  name TEXT,
  updated_at INTEGER NOT NULL
);
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
 ('person_reminders', 'lp', 'CLOUD_SYNC', 'LOCAL_ONLY', 'Per-person unanswered owner reminders; never sent to a model.'),
 ('rainmaker_addresses', 'capital', 'CLOUD_SYNC', 'LOCAL_ONLY', 'Private RR-list repliers; never sent to a model.')
ON CONFLICT(entity) DO NOTHING;
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0351_boss_reminders_and_rainmaker');
