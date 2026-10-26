-- 26 October 2026 — Simone's meeting prep, the evening before each call (owner-approved, "Meeting
-- prep now"), and the warm references it quotes back to her.
--
-- warm_references: the exact warm line an outreach or LP email sent to a person ("loved your episode
-- on …") and its link, stored when the email is recorded as sent (src/worker/boss/lp/references.ts,
-- called from recordProspectEvents and backfillTouches), and backfilled from every prospect email
-- on record since 1 Sep. The meeting prep (scripts/ops/meeting-prep.mjs) checks the link resolves
-- before it ever shows it; a dead link is marked verified = 0 and never quoted.
CREATE TABLE IF NOT EXISTS warm_references (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  line        TEXT NOT NULL,
  url         TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'prospect_email',
  sent_at     INTEGER NOT NULL,
  verified    INTEGER,
  checked_at  INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE (email, url)
);
CREATE INDEX IF NOT EXISTS idx_warm_references_email ON warm_references(email);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('warm_references', 'relationships', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'The warm line and link an email sent to a person carried, for her meeting prep. Carries addresses; read on her own Mac.')
ON CONFLICT(entity) DO NOTHING;

-- Simone's duty: one local_job row, run hourly by launchd com.seq.boss-meeting-prep through
-- duty-run.sh. The script decides by Central time: from 18:00 every meeting tomorrow, any hour a
-- meeting later today that has had no prep.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_meeting_prep',
   'Meeting prep, the evening before each call',
   'emp_chief', 'ops',
   18, 0, 'America/Chicago', 'daily', NULL,
   unixepoch() * 1000 + 3600000, 'local_job', 'ops',
   'Meeting prep: one email per meeting tomorrow, the evening before',
   json_object(
     'local_job', 'meeting-prep.mjs',
     'why_no_model', 'Every line is a row read from her calendars and Boss OS; only the summary of a public episode or article is written by a free model, labelled.',
     'why_local', 'Her calendar keys, the Boss OS passcode and the transcriber live on her Mac.',
     'sends', 'one email per meeting to her from simone@, subject starting "Prep: ", never twice for one event on one day'
   ),
   'Every meeting tomorrow has its prep by 18:30 Central; a meeting added for today has it within the hour; nothing is sent twice; a section with nothing real is left out.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0312_boss_meeting_prep_and_warm_references');
