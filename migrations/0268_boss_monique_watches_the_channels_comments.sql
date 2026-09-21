-- ─── MONIQUE WATCHES THE CHANNEL'S COMMENTS; SEQUOIA DECIDES; MONIQUE ACTS ─────────────────
--
-- Owner, 21 Sep 2026. A weekly duty: read every new comment on the YouTube channel, propose what
-- to do about the negative ones and the questions, email her the digest, and act ONLY on her
-- reply. The reading and the acting happen on her Mac in the channel's own repo
-- (~/GitHub/how-we-know, `loop/comments.py`) with the channel's own credentials; this repo holds
-- the duty, the digest rows, her instructions, and the results.
--
-- WHY ONE ROW PER COMMENT. Her reply is "1 delete / 2 reply as drafted / 3 reply: <words> /
-- 4 ignore", or "your call". Each of those is a fact about one comment: what she said, when, and
-- through which mail. The Mac's `act` half asks for rows that are INSTRUCTED and NOT APPLIED and
-- nothing else, and how-we-know's `act` refuses any instruction without who / when / via on it —
-- so the instruction record is the only path from her word to the channel, and it is auditable
-- row by row.
--
-- WHY WEDNESDAY 14:00. Her correction the same day: NOT daily at 08:00, "too much already fires at
-- 08:00". The schedule inventory has the Mac busy 06:00–09:45, 10:07, 11:11, 12:35, 18:07–18:35
-- and 23:00; Wednesday's only Mac job is the 07:00 packet reminder; nothing fires 12:35–18:00 on
-- any weekday. 14:00 is on the hourly tick, the Mac claims at 14:05. See
-- src/shared/boss/commentWatch/lane.mjs for the same note beside the code that reads it.

CREATE TABLE comment_watch_digests (
  id            TEXT PRIMARY KEY,               -- cw_… — the token in the email subject
  duty_id       TEXT NOT NULL REFERENCES standing_duties(id),
  task_id       TEXT REFERENCES tasks(id),
  outcome       TEXT NOT NULL CHECK (outcome IN ('SENT','NOTHING_TO_REPORT')),
  new_comments  INTEGER NOT NULL DEFAULT 0,
  by_class      TEXT,                            -- json {praise: n, ...}
  item_count    INTEGER NOT NULL DEFAULT 0,
  mail_id       TEXT,                            -- Resend id of the digest email
  answered_at   INTEGER,
  answer_mail_id TEXT,
  answer_mode   TEXT,                            -- your_call | per_number | none
  answer_phrase TEXT,                            -- the pre-approval words, when your_call
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_comment_watch_digests_recent ON comment_watch_digests(created_at DESC);

CREATE TABLE comment_watch_items (
  id              TEXT PRIMARY KEY,
  digest_id       TEXT NOT NULL REFERENCES comment_watch_digests(id),
  n               INTEGER NOT NULL,              -- the number she replies with
  comment_id      TEXT NOT NULL,
  video_id        TEXT NOT NULL,
  video_title     TEXT,
  author          TEXT,
  text            TEXT NOT NULL,
  published_at    TEXT,
  class           TEXT NOT NULL,                  -- negative | question
  proposed_action TEXT NOT NULL CHECK (proposed_action IN ('hide','reply','ignore')),
  proposed_reply  TEXT,
  product_note    TEXT,
  -- Her word. Written ONLY by the mailbox, below the verified-sender refusal.
  action          TEXT CHECK (action IN ('hide','reply','ignore')),
  reply_text      TEXT,
  instructed_by   TEXT,                           -- her verified address
  instructed_at   INTEGER,
  source          TEXT,                           -- 'email reply [cw_…] mail <id>' | 'pre-approved by her reply: "your call"'
  -- The Mac's report after how-we-know's `act` ran.
  applied_at      INTEGER,
  result          TEXT,
  created_at      INTEGER NOT NULL,
  UNIQUE (digest_id, n),
  UNIQUE (comment_id)
);
CREATE INDEX idx_comment_watch_items_pending ON comment_watch_items(instructed_at, applied_at);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('comment_watch_digests', 'duties', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'When Monique read the channel''s comments, how many she found, and how the owner answered. Operating record of a public-comment moderation duty.'),
  ('comment_watch_items', 'duties', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Public YouTube comments on the channel, the proposed and instructed action for each, and the result. The comments are already public; the instruction is the owner''s and is the audit trail for every hide and reply.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_youtube_comment_watch',
   'The channel''s comments, read weekly; acted on only on her word',
   'emp_relationship', 'ops',
   14, 0, 'America/Chicago', 'weekly', 3,
   -- First due: the next Wednesday 14:00 CT after this migration applies. Seeded as the
   -- scheduler would compute it rather than "tomorrow", so the row never reads overdue before
   -- its first run (the 0232 lesson). 2026-09-23 14:00 CDT = 2026-09-23T19:00:00Z.
   1790190000000, 'local_job', 'youtube_comment_watch',
   'The channel''s comments, read weekly; acted on only on her word',
   json_object(
     'delivers', 'comment_watch_items',
     'local_job', 'youtube-comment-watch.sh',
     'cadence_note', 'Wednesday 14:00 America/Chicago — owner: NOT 08:00, too much fires then. The Mac is idle 12:35–18:00 every weekday and Wednesday carries only the 07:00 packet reminder; 14:00 is on the hourly tick. The act half runs on its own daily Mac slots (14:05 and 19:05) so her reply is applied the same day, never a week later.',
     'why_local', 'The sweep and the act run in ~/GitHub/how-we-know with that channel''s own Google credential, which lives only in that repo''s .secrets/ on her Mac. Nothing in this repo holds it and nothing here names that channel''s business.',
     'why_no_model', 'Classification is done by how-we-know''s own routed model in one call per batch; this repo sees only the digest. No model runs here.',
     'sends', 'a digest from monique@ when there is something to decide, one line per action once her reply is applied; nothing at all on an empty week (NOTHING_TO_REPORT is recorded on the digest table by name)'
   ),
   'Every negative comment and every question on the channel reaches her within a week of being posted, numbered, with a proposed action; nothing is hidden or posted without an instruction row carrying her verified address; every applied action has a result on its row.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0268_boss_monique_watches_the_channels_comments');
