-- Owner ruling, 4 Nov 2026: per-person no notices; records and manual replies remain.
CREATE TABLE IF NOT EXISTS quiet_people (
  address TEXT PRIMARY KEY COLLATE NOCASE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
INSERT OR IGNORE INTO quiet_people (address)
SELECT lower(trim(address)) FROM lp_reply_drafts WHERE name = 'Kenneth Goodwin';
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('quiet_people', 'lp', 'CLOUD_SYNC', 'LOCAL_ONLY', 'Private no-notices addresses, read by owner screens and morning producers; never sent to a model.');
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0336_boss_quiet_people');
