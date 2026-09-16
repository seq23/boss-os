-- 0245 — A question typed here can be answered here.
--
-- ─── What was on Today, 15 September 2026 ────────────────────────────────────
--
--   "2 questions from your employees are waiting on you — the oldest is 4 days old, from Monique
--    about "#monique". Nothing was started on it and nothing was invented: reply to that email and
--    it goes straight into work."
--
-- There was no email. `iml_m297nsjanp50ygzr` was typed into Boss OS from her own session on
-- 11 September, and a console message carried no Message-ID — so the one mechanism that closes a
-- question (her reply's `In-Reply-To` naming the question's `Message-ID`) could never fire for it.
-- The alert told her to answer by a door that did not exist, at HIGH, for four days.
--
-- The code now mints `<iml_…@boss-os-console>` for a console message on arrival, and
-- `POST /intake/questions/:id/answer` replies to a question by the same path an emailed reply
-- takes. This backfills the id onto every console row already in the table, so the two questions
-- that were open on the 15th can be answered rather than dismissed.
--
-- `answer_note` records HOW a question was closed when it was withdrawn rather than answered —
-- "already done on 12 September" is a fact worth keeping beside the question it answers.

-- THE PATTERN IS SHORT ON PURPOSE. D1 refused the first version of this line with "LIKE or GLOB
-- pattern too complex" — its SQLite caps a LIKE pattern at 50 bytes, and the full sentence the
-- intake writes is 66. Nothing was applied; this is the same statement with a pattern D1 takes.
UPDATE boss_inbound_mail
   SET message_id = '<' || id || '@boss-os-console>'
 WHERE message_id IS NULL
   AND why LIKE '%Typed into Boss OS from her own%';

ALTER TABLE boss_inbound_mail ADD COLUMN answer_note TEXT;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0245_boss_a_question_typed_here_can_be_answered_here');
