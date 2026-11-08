-- 0359 — Simone's "Go?" card for every invitation (owner-approved plan, 8 Nov 2026).
--
-- 1. owner_invitations: one row per invitation, deduped by calendar UID or sender + day + title
--    (dedupe_key). Headers only: title, when, who, where, how it came in, and the words a tap would
--    send. No message body is kept; the excerpt the free model read is never stored. When a card is
--    answered or dropped, the outgoing words, the RSVP link and the subject are cleared.
-- 2. duty_invitations: a Simone duty run BY THE WORKER (executor 'worker', worker_job 'invitations')
--    on the existing hourly tick, due 06:00 America/Chicago — before the 06:40 morning email. It reads
--    new mail since the last run in every inbox Boss OS already reads (spry.vc read-only) plus her
--    calendars, and writes the "invitations" morning section. Census: OUTPUT n invitations. A mailbox
--    it cannot read is NAMED STOP [INVITES_MAILBOX_UNREAD]. Floor 0: a morning with no invitation is
--    normal. Kendra opens the first-run Open Loops row (output_since before created_at).
--
-- 3. Model: a free route first (Gemini free, then OpenRouter free) reads a personal email's subject
--    and first 800 characters; Spry Ventures mail and LP names reach only a no-training route; when
--    none answers, the prose rules decide. `requested.model` says so for the roster.
--
-- Additive only: one new table, INSERT OR IGNORE.

CREATE TABLE IF NOT EXISTS owner_invitations (
  id                TEXT PRIMARY KEY,
  dedupe_key        TEXT NOT NULL UNIQUE,
  kind              TEXT NOT NULL CHECK (kind IN ('calendar','platform','personal')),
  source            TEXT NOT NULL CHECK (source IN ('mail','calendar')),
  inbox             TEXT NOT NULL,
  how               TEXT NOT NULL,
  title             TEXT NOT NULL,
  starts_at         INTEGER NOT NULL,
  ends_at           INTEGER,
  all_day           INTEGER NOT NULL DEFAULT 0,
  from_name         TEXT,
  from_address      TEXT,
  location          TEXT,
  platform          TEXT,
  -- The outside RSVP page: shown to her as a button, never fetched by Boss OS.
  rsvp_url          TEXT,
  asks_answer       INTEGER NOT NULL DEFAULT 0,
  ics_uid           TEXT,
  calendar_event_id TEXT,
  gmail_thread_id   TEXT,
  rfc_message_id    TEXT,
  subject           TEXT,
  -- The exact words a Yes (or a No, when an answer is asked for) sends; shown on the card verbatim.
  reply_text        TEXT,
  decline_text      TEXT,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','unsure','yes','no','dropped')),
  asks              INTEGER NOT NULL DEFAULT 0,
  unsure_asks       INTEGER NOT NULL DEFAULT 0,
  last_asked_day    TEXT,
  next_ask_day      TEXT,
  tap_token         TEXT NOT NULL UNIQUE,
  answered_at       INTEGER,
  answered_before_event INTEGER,
  act_result        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_owner_invitations_live ON owner_invitations(status, starts_at);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('owner_invitations', 'duties', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Invitation headers for her Go? card: title, time, who invited her, where, and the short words a tap sends. Never a message body; cleared when the card closes.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_invitations',
   'Invitations: a Go? card for each one',
   'emp_chief', 'ops',
   6, 0, 'America/Chicago', 'daily', NULL,
   (unixepoch(date('now', '+1 day')) + 12 * 3600) * 1000, 'worker', 'ops',
   'Invitations: a Go? card for each one',
   json_object(
     'worker_job', 'invitations',
     'delivers', 'morning_sections',
     'requested', json_object('model', 'free-route'),
     'sends', 'nothing on its own: a Yes, No or decline goes only when she taps it (invitations/tap.ts)'
   ),
   'Every morning (06:00 Central) Simone reads new mail in each inbox Boss OS already reads and her calendars, finds the invitations (calendar invites, Luma/Eventbrite/Partiful/Paperless Post events, personal "would you join us" emails) and puts ONE Go? card per invitation in the morning email and on Today: Yes, go / No / Not sure. An inbox it cannot read is a named stop shown in the email.',
   0);

-- Its floor, mirrored by its Schedule row (tests/outputFloors.test.ts). output_since sits a minute
-- before the row's created_at, so Kendra opens its first-run Open Loops row.
UPDATE standing_duties SET output_metric = 'invitations', output_floor = 0, output_runs = 2, output_reason = 'A morning with no new invitation is normal; an unread inbox is a named stop, never a zero.', output_since = unixepoch() * 1000 - 60000 WHERE id = 'duty_invitations';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0359_boss_simone_invitations');
