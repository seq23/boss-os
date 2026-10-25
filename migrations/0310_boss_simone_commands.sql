-- 25 October 2026 — Simone does it by email (owner: she had to ask a Claude session for two things
-- she should have been able to email Simone about: a calendar invite, and "find my cousin's email,
-- have Danielle make a trial code, and email her the code").
--
-- One row per thing Simone does for her straight from an email: a calendar invite, a contact lookup,
-- an email to a third party on her behalf (shown word for word, sent only on her Send), a
-- time-2-read access code (a row in its Supabase table, made on her Mac, no rebuild), a repo job
-- handed to Danielle, or a "can't yet" opened as a Danielle job. The code that reads and writes this
-- is src/worker/boss/commands/*.ts; the grammar is src/shared/boss/commands/parse.mjs; the Mac half
-- (lookups through her own Drive and Gmail, drafts, bounce checks, follow-up notices) is
-- scripts/ops/simone-commands.mjs.
--
--   spec       what she asked, parsed (JSON): the guest, the slot, the person to find, the purpose
--   result     what happened (JSON): the event id and Meet link, the candidates and their evidence,
--              the draft word for word, the Gmail message id it went out as
--   waits_on   the command ids this one cannot start without (an email waits on the lookup that
--              finds its recipient and on the repo job that makes what it talks about)
--   tap_token  the one-tap Send / Change / Try again token (served at /tap/<token>)
--   notice     the plain email the Mac owes her next, laid out by the Worker; notice_state says
--              whether it is still owed. The Worker can only reply to her mail, so anything said
--              later (a lookup's answer, a bounce, a draft to approve) goes out from the Mac.
CREATE TABLE IF NOT EXISTS boss_commands (
  id           TEXT PRIMARY KEY,
  mail_id      TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('invite','lookup','email','repo','access_code','cant_yet')),
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
CREATE INDEX IF NOT EXISTS boss_commands_state ON boss_commands (kind, state);
CREATE INDEX IF NOT EXISTS boss_commands_mail ON boss_commands (mail_id);
CREATE INDEX IF NOT EXISTS boss_commands_notice ON boss_commands (notice_state);

-- Names and addresses of the people she deals with: never to an outside model from the Worker.
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('boss_commands', 'intake', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'What Simone did from her email: invites, contact lookups, emails sent on her word, repo jobs handed on. Carries names and addresses; the drafting runs on her own Mac seat, never a Worker model.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0310_boss_simone_commands');
