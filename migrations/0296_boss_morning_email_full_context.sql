-- The morning email, in full (owner, 24 Oct 2026: "6 decisions" showed 3, Today showed none, and no
-- item said who, what or why). ADDITIVE ONLY: one new table, three nullable columns, and one repair
-- of a digest that a half-finished write left wrong.
--
-- 1. THE MORNING, AS SENT. Simone's email is built on her Mac from the section files every producer
--    writes (~/.boss-os/morning). Those files never reached the Worker, so Today could not show the
--    decisions the email counted. `scripts/ops/your-day.mjs` now posts the whole morning (every
--    Decide item, deal, finding, briefing and done line, each with its full context) here BEFORE the
--    email goes; every link in the email opens its own item from this row, and Today lists the same
--    Decide items from it. Names stay in D1 (the repo is public); nothing here is sent to a model.
CREATE TABLE IF NOT EXISTS morning_digests (
  day         TEXT PRIMARY KEY,                  -- YYYY-MM-DD, America/Chicago
  payload     TEXT NOT NULL,                     -- json { decide: [...], deals, found, briefing, done, ... }
  sent_at     INTEGER,                           -- when the email that carried it went (NULL: built, not sent)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('morning_digests', 'duties', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'The morning email exactly as it went to the owner: her decisions, the people in them (LPs, brokers, prospects) and the drafts in her name. Shown on her screens only; never sent to a model.')
ON CONFLICT(entity) DO NOTHING;

-- 2. AN LP REPLY SHOWS EXACTLY WHAT "SEND AS IS" SENDS. The held draft's full text, what they wrote
--    (their own words, not one sentence), and what they said after her reply.
ALTER TABLE lp_reply_drafts ADD COLUMN draft_body TEXT;       -- the held draft, word for word; NULL once she edits it in Gmail
ALTER TABLE lp_reply_drafts ADD COLUMN said TEXT;             -- their reply in their own words (up to ~800 characters)
ALTER TABLE lp_reply_drafts ADD COLUMN last_reply_text TEXT;  -- their latest message after her reply (They replied again)

-- The words of every prospect email sent (owner, 24 Oct 2026: "keep me abreast of prospect
-- outreach"): her morning email and the Prospects screen show each send. Older sends keep NULL.
ALTER TABLE prospect_touches ADD COLUMN subject TEXT;
ALTER TABLE prospect_touches ADD COLUMN body TEXT;

-- Every current buy↔sell match Monique's deal reader found (owner, 24 Oct 2026: size, price within a
-- tolerance, partial fills, a missing price never hides one, fresher first), for the Matches screen.
-- Replaced whole on each run from her Mac; the screen filters by her price tolerance.
CREATE TABLE IF NOT EXISTS capital_matches (
  key         TEXT PRIMARY KEY,                  -- buyer row id | seller row id
  company     TEXT NOT NULL,
  rank        INTEGER NOT NULL,                  -- 0 = best
  payload     TEXT NOT NULL,                     -- json: both sides, fill, price gap, age, the notes
  updated_at  INTEGER NOT NULL
);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('capital_matches', 'capital', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'Buy and sell orders from her brokerage mail paired by company, size and price, with the brokers'' names and addresses and the notes she may send. Her screens only; never sent to a model.')
ON CONFLICT(entity) DO NOTHING;

-- 3. THE DIGEST THAT SAID 2 AND HELD 1 (21 Oct 2026, 14:05 Central). The sweep handed the same comment
--    twice; the Worker wrote the digest, the task and row 1, then row 2 failed UNIQUE(comment_id) and
--    the run stopped with a 500. Count and title were left saying 2. The route now drops repeats and
--    writes everything in one batch (routes/commentWatch.ts). This repairs the one row it left.
UPDATE comment_watch_digests
   SET item_count = (SELECT COUNT(*) FROM comment_watch_items i WHERE i.digest_id = comment_watch_digests.id)
 WHERE item_count <> (SELECT COUNT(*) FROM comment_watch_items i WHERE i.digest_id = comment_watch_digests.id)
   AND outcome = 'SENT';
UPDATE tasks
   SET title = (SELECT CASE d.item_count WHEN 1 THEN '1 comment on the channel needs your word'
                                         ELSE d.item_count || ' comments on the channel need your word' END
                  FROM comment_watch_digests d WHERE d.task_id = tasks.id)
 WHERE id IN (SELECT task_id FROM comment_watch_digests WHERE task_id IS NOT NULL AND outcome = 'SENT')
   AND status = 'awaiting_approval';

-- Her word on that one comment (owner, 24 Oct 2026, in chat with the main session): leave it alone,
-- no reply. The comment pointed at a pronunciation fault, which is being fixed in the channel's own
-- repo. "ignore" never touches the channel; the Mac's act half records the result and closes the task.
UPDATE comment_watch_items
   SET action = 'ignore', reply_text = NULL, instructed_by = 'the owner (in chat with the main session)', instructed_at = 1792800000000,
       source = 'owner in chat, 24 Oct 2026: ignore it, no reply (the pronunciation fault is being fixed)'
 WHERE id = 'cwi_m5fxns79jfw853cj' AND instructed_at IS NULL;
UPDATE comment_watch_digests
   SET answered_at = 1792800000000, answer_mode = 'per_number', answer_phrase = 'owner in chat, 24 Oct 2026: ignore'
 WHERE id = 'cw_m5fxns0z96mqzwxx' AND answered_at IS NULL;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0296_boss_morning_email_full_context');
