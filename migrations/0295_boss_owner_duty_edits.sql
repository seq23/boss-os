-- Builder U (23 Oct 2026, mock-up boards 7 + 8): the owner edits her employees' duties on the site.
--
-- "i should be able to use the UI to make any needed changes." Each employee page lists her duties;
-- each duty shows the instructions it follows, when it runs, and Save / Undo to the last version /
-- Pause / Remove. ADDITIVE ONLY: three nullable columns on standing_duties and one new table. No
-- existing row is rewritten except `mac_tick`, which copies each Mac duty's own cadence so the page
-- knows which days her Mac can actually honour.
--
-- THE REPO STAYS THE DEFAULT. `owner_prompt` is NULL until she saves an edit; while it is NULL every
-- job reads the prompt written in the repository exactly as before. The repo is public, so her
-- edits live here in D1 and never in a git file.

-- Her edited instructions. NULL = the repository's prompt. Read by materialiseDueDuties (Worker
-- duties, as the task's prompt) and by /api/duties/brief/:local_job (Mac duties, through duty-run.sh).
ALTER TABLE standing_duties ADD COLUMN owner_prompt TEXT;

-- When she last changed WHEN it runs. NULL = the schedule it was set up with. A Mac duty whose
-- schedule she changed is gated by the duty row (duty-run.sh asks /brief), not by the launchd
-- calendar alone.
ALTER TABLE standing_duties ADD COLUMN owner_schedule_at INTEGER;

-- Removed is not deleted: the row, its runs and every version stay. A removed duty is also
-- suspended, so every path that already refuses a suspended duty refuses it too.
ALTER TABLE standing_duties ADD COLUMN removed_at INTEGER;

-- The cadence the Mac's launchd entry fires on (daily / weekly / monthly). The page only offers a Mac
-- duty the days that tick can reach: a weekly tick cannot be made daily from a web page.
ALTER TABLE standing_duties ADD COLUMN mac_tick TEXT;
UPDATE standing_duties SET mac_tick = cadence WHERE executor = 'local_job' AND mac_tick IS NULL;

-- Every version of every change she makes, kept. Each row is the duty's state AFTER that change, so
-- "Undo to the last version" restores the row before the newest and writes a new 'undo' row on top:
-- nothing is ever overwritten. Version 0 ('original') is the state before her first change.
CREATE TABLE IF NOT EXISTS duty_versions (
  id            TEXT PRIMARY KEY,
  duty_id       TEXT NOT NULL REFERENCES standing_duties(id),
  version       INTEGER NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('original','edit','undo','pause','resume','remove')),
  owner_prompt  TEXT,
  cadence       TEXT NOT NULL,
  weekday       INTEGER,
  weekdays      TEXT,
  local_hour    INTEGER NOT NULL,
  local_minute  INTEGER NOT NULL,
  suspended     INTEGER NOT NULL DEFAULT 0,
  removed       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  UNIQUE (duty_id, version)
);
CREATE INDEX IF NOT EXISTS idx_duty_versions_duty ON duty_versions (duty_id, version DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('duty_versions', 'duties', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Every version of the instructions and schedule she set for a duty. The instructions are sent to the model that does the duty, so they are already model-bound by her choice.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0295_boss_owner_duty_edits');
