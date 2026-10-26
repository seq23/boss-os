-- 26 October 2026 — Simone runs her errands by email (owner: "make sure going forward i can email
-- simone to do this kind of thing", after asking for a table at a club through a Claude session).
--
-- A new command kind, `errand`: a booking or request to a business whose address she gave in the same
-- email (a table, an appointment, a hold). Her email IS the approval, so Simone sends the request as
-- her assistant without a second Send, from simone@sequoiataylor.com with Reply-To simone@ (no copy to
-- her by default, owner 26 Oct 2026: "she doesnt have to cc me next time"), watches for the business's
-- answer, and tells her what they said. A card or deposit request is never filled: it comes to her.
-- The grammar is src/shared/boss/commands/parse.mjs (errandIn); the Worker half is
-- src/worker/boss/commands/run.ts; the send is scripts/ops/simone-commands.mjs → notify.mjs
-- (postErrandMail). SQLite cannot widen a CHECK in place, so the table is rebuilt with its rows.
CREATE TABLE boss_commands_new (
  id           TEXT PRIMARY KEY,
  mail_id      TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('invite','lookup','email','repo','access_code','cant_yet','errand')),
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

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0314_boss_simone_errands');
