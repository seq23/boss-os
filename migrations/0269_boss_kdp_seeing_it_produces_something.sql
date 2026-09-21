-- ─── SEEING IT PRODUCES SOMETHING ─────────────────────────────────────────────
--
-- 21 Sep 2026. Amazon's content review flagged The Gift Letter's TITLE on 12 Sep ("gift letter"
-- repeated across title and subtitle) and again on 14 Sep, with five days to fix it. Simone's daily
-- scan SAW it — three kdp_mail_log rows, 12/15/16 Sep. The 12 Sep row set needs_owner = 1 and no
-- email reached her (the prompt was told to send through the vault it does not have). The 15 and 16
-- Sep rows said "Assigned to Zora" and work_assignments is EMPTY: the assignment was a sentence,
-- never a row, so Zora never had it. The 17–20 Sep runs said quiet or blocked and never re-raised an
-- open problem with a deadline. At 20:46Z today Amazon wrote that the book will not be made
-- available. The scan happened daily; what failed is that seeing it produced nothing.
--
-- What a problem row now carries, so that seeing produces something and stays loud until it ends:
--
--   due_at                — the sender's deadline, when it gave one ("within 5 days"). An open problem
--                           within two days of due_at, or past it, is re-raised by EVERY daily run.
--   delivered_message_id  — the Resend id of the ONE email a needs_owner row sent her. A needs_owner
--                           row with no id is a row that woke nobody; the wrapper stops on it.
--   nagged_at             — the last time an open problem was chased with her, under Simone's name.
--   assignment_id         — the work_assignments row an `assigned` outcome created IN THE SAME
--                           REQUEST. The endpoint refuses `assigned` without one.
--   owner_ask / owner_answer / answered_at / answer_mail_id
--                         — the one decision she was asked for, her reply on the `[kml_…]` thread,
--                           and the mail that carried it. The next run executes on it.
--   resolved_at / resolution
--                         — when the problem ended and how. Open means resolved_at IS NULL.
--   matter                — title | subtitle | cover | content | rights | case | account | other,
--                           so the register's settled matters (the covers, case #51496198) can be
--                           told from a new one without reading prose.

ALTER TABLE kdp_mail_log ADD COLUMN due_at INTEGER;
ALTER TABLE kdp_mail_log ADD COLUMN delivered_message_id TEXT;
ALTER TABLE kdp_mail_log ADD COLUMN nagged_at INTEGER;
ALTER TABLE kdp_mail_log ADD COLUMN assignment_id TEXT;
ALTER TABLE kdp_mail_log ADD COLUMN owner_ask TEXT;
ALTER TABLE kdp_mail_log ADD COLUMN owner_answer TEXT;
ALTER TABLE kdp_mail_log ADD COLUMN answered_at INTEGER;
ALTER TABLE kdp_mail_log ADD COLUMN answer_mail_id TEXT;
ALTER TABLE kdp_mail_log ADD COLUMN resolved_at INTEGER;
ALTER TABLE kdp_mail_log ADD COLUMN resolution TEXT;
ALTER TABLE kdp_mail_log ADD COLUMN matter TEXT;

CREATE INDEX IF NOT EXISTS idx_kdp_mail_open_problems ON kdp_mail_log(disposition, resolved_at, due_at);

-- THE THREE ROWS THAT SAW IT AND PRODUCED NOTHING are closed as what they were, so the first run
-- under this rule chases the 21 Sep alert once rather than four times. The facts stay on the rows.
UPDATE kdp_mail_log
   SET resolved_at = 1790023560000,
       resolution = 'Superseded 21 Sep 2026: seen on this day and nothing followed — the needs_owner email never went (no vault in the run) and the assignment to Zora was a sentence, not a work_assignments row. Amazon''s 21 Sep alert opens the problem again under the rule that a problem stays loud until it ends.',
       matter = 'title'
 WHERE disposition = 'problem' AND resolved_at IS NULL AND seen_at < 1790023560000
   AND (title_ref LIKE '%Gift Letter%' OR title_ref = 'A1EYXUFGFV7CN6' OR note LIKE '%Gift Letter%');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0269_boss_kdp_seeing_it_produces_something');
