-- The ancestral hour, urgent at the end of the month (owner, 31 Oct 2026: "on the last day of the
-- month and 3 days before u should make the ancestral hour urgent and noticeable and maybe email a
-- reminder").
--
-- One row per Central day a reminder email was claimed for. The PRIMARY KEY is the day, so the
-- reminder can never go twice for the same day; `sent_at` is final. `tap_token` is the one-tap
-- "Done ✓" in the email (/tap/<token>?do=done), the same door as Simone's taps. Done itself is not
-- stored here: it is the month's ancestor_entries reaching the hour, as it always was
-- (src/worker/boss/spirit/ancestralHour.ts). Additive only.
CREATE TABLE IF NOT EXISTS ancestral_hour_reminders (
  day         TEXT PRIMARY KEY,              -- YYYY-MM-DD, Central
  month       TEXT NOT NULL,                 -- YYYY-MM, Central
  kind        TEXT NOT NULL CHECK (kind IN ('first','last')),
  tap_token   TEXT NOT NULL UNIQUE,
  claimed_at  INTEGER,
  sent_at     INTEGER,
  created_at  INTEGER NOT NULL
);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('ancestral_hour_reminders', 'spirit', 'LOCAL_ONLY', 'LOCAL_ONLY',
   'Which days the ancestral-hour reminder went to the owner. Spirit is sovereign (0169), so it stays local like ancestor_entries.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0319_boss_ancestral_hour_reminders');
