-- 26 October 2026 — Simone's meeting prep asks when it cannot find what a meeting is for (owner: "she
-- sent me an email about prep for my meeting ... but nothing is inside - this feels lazy she should
-- ask what the meeting is about and offer to help me").
--
-- A new command kind, `meeting_prep`: one row per prep (the event and its day), so her reply in the
-- prep's thread lands on it through the ordinary intake. Her words become the purpose (`queued`), and
-- the Mac sends the finished prep in the same thread (`sent`). The Worker half is
-- src/worker/boss/commands/run.ts (openMeetingPrep, answerMeetingPrep, prepsDue, prepFinished); the
-- Mac half is scripts/ops/meeting-prep.mjs. SQLite cannot widen a CHECK in place, so the table is
-- rebuilt with its rows (as 0314 did).
CREATE TABLE boss_commands_new (
  id           TEXT PRIMARY KEY,
  mail_id      TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('invite','lookup','email','repo','access_code','cant_yet','errand','meeting_prep')),
  state        TEXT NOT NULL,
  spec         TEXT NOT NULL DEFAULT '{}',
  result       TEXT NOT NULL DEFAULT '{}',
  waits_on     TEXT,
  task_id      TEXT,
  change_id    TEXT,
  tap_token    TEXT UNIQUE,
  notice       TEXT,
  notice_state TEXT NOT NULL DEFAULT 'none' CHECK (notice_state IN ('none','due','sent')),
  claimed_at   INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
INSERT INTO boss_commands_new
  (id, mail_id, kind, state, spec, result, waits_on, task_id, change_id, tap_token, notice, notice_state, claimed_at, created_at, updated_at)
  SELECT id, mail_id, kind, state, spec, result, waits_on, task_id, change_id, tap_token, notice, notice_state, claimed_at, created_at, updated_at
    FROM boss_commands;
DROP INDEX IF EXISTS boss_commands_state;
DROP INDEX IF EXISTS boss_commands_mail;
DROP INDEX IF EXISTS boss_commands_notice;
DROP TABLE boss_commands;
ALTER TABLE boss_commands_new RENAME TO boss_commands;
CREATE INDEX IF NOT EXISTS boss_commands_state ON boss_commands (kind, state);
CREATE INDEX IF NOT EXISTS boss_commands_mail ON boss_commands (mail_id);
CREATE INDEX IF NOT EXISTS boss_commands_notice ON boss_commands (notice_state);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0316_boss_meeting_prep_asks');
