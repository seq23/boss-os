-- THE MORNING SECTIONS, IN BOSS OS (owner-approved Mac→cloud move, 1 Nov 2026). ADDITIVE ONLY: one new
-- table. Every producer of Simone's morning email wrote ~/.boss-os/morning/<section>.json on her Mac,
-- which a job on a cloud runner cannot reach. Each writer (src/shared/boss/mail/morning.mjs) now also
-- posts its section here (POST /api/boss/morning/sections); scripts/ops/your-day.mjs reads them back,
-- falling back to the Mac files during the cutover. One row per section, as the file was: a "replace"
-- write overwrites it, an "append" write adds lines server-side; `told_at` is set once the email that
-- carried it went (the file's rename to .<section>.told.json).
CREATE TABLE IF NOT EXISTS morning_sections (
  section     TEXT PRIMARY KEY,                  -- one of MORNING_SECTIONS (src/shared/boss/mail/morningSections.mjs)
  job         TEXT NOT NULL,                     -- the job that wrote it last (e.g. waiting-on, lp-daily)
  day         TEXT NOT NULL,                     -- YYYY-MM-DD, America/Chicago, of the last write
  body        TEXT NOT NULL,                     -- json: the section object exactly as the file held it
  status      TEXT NOT NULL DEFAULT 'fresh',     -- fresh | told
  told_at     INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('morning_sections', 'duties', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'The parts of the owner''s next morning email as each job wrote them: decisions, LP and prospect names, drafts. Read by the morning email and her screens only; never sent to a model.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0330_boss_morning_sections');
