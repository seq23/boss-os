-- 22 October 2026 — plain emails (owner: "confusing hard to read hard to understand. Lots of jargon").
--
-- The job codes ([rc_…], [dd_…], [tsk_…], [cw_…], [kml_…]) leave the subject and body of every Boss OS
-- email. Her reply still has to land on its job, so the code is recorded here against the Message-ID
-- of the email that carried it: the Mac records the Message-ID Resend gave its send, and the Worker
-- records her own message's Message-ID when its reply named a job. Her client quotes those ids back in
-- References / In-Reply-To, and the inbound handler reads the codes from this table
-- (src/worker/boss/intake/mailRefs.ts refsForChain). `context` is the plain text she was sent, so a
-- reply like "move the KDP item to Monday" reaches the employee with the list it is about.
CREATE TABLE IF NOT EXISTS boss_mail_refs (
  message_id TEXT PRIMARY KEY,
  refs       TEXT NOT NULL,
  subject    TEXT,
  sender     TEXT,
  context    TEXT,
  created_at INTEGER NOT NULL
);

-- The email text she was sent can name people, so it never goes to an outside model: LOCAL_ONLY for AI.
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('boss_mail_refs', 'intake', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'Which job an email to her was about, keyed by its Message-ID, with the plain text she was sent. Read only to route her reply; never sent to a model.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0290_boss_mail_refs');
