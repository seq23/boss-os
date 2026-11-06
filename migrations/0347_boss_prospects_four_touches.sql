-- 6 November 2026 — owner ruling (risk brain R-EML-04, replaces "one follow-up at most" of 24 Oct,
-- 0303): a prospect gets the first email and up to THREE follow-ups, on day 3, 7 and 14 from the first
-- send, then never again. MAX_TOUCHES is 4 (src/shared/boss/outreach/cadence.mjs, read by
-- src/shared/boss/lp/plan.mjs).
--
-- 1. Emails 3 and 4 go only in words she approved on the prospect email card: two new columns on the
--    template she approves. A template approved before today has neither, so it sends emails 1 and 2
--    exactly as before and stops there until she approves a version with emails 3 and 4.
ALTER TABLE prospect_templates ADD COLUMN follow_up_2 TEXT;
ALTER TABLE prospect_templates ADD COLUMN follow_up_3 TEXT;

-- 2. prospect_touches allowed touch_no 1 to 3; email 4 must be recorded with its words. SQLite cannot
--    widen a CHECK in place, so the table is rebuilt with every row and every column (as 0316 did).
--    No live record changes: people already marked done after two emails stay done.
CREATE TABLE prospect_touches_new (
  id           TEXT PRIMARY KEY,
  prospect_id  TEXT NOT NULL REFERENCES prospects(id),
  touch_no     INTEGER NOT NULL CHECK (touch_no BETWEEN 1 AND 4),
  gmail_id     TEXT,
  template_id  TEXT,
  sent_at      INTEGER NOT NULL,
  subject      TEXT,
  body         TEXT,
  sent_from    TEXT,
  UNIQUE (prospect_id, touch_no)
);
INSERT INTO prospect_touches_new (id, prospect_id, touch_no, gmail_id, template_id, sent_at, subject, body, sent_from)
  SELECT id, prospect_id, touch_no, gmail_id, template_id, sent_at, subject, body, sent_from FROM prospect_touches;
DROP TABLE prospect_touches;
ALTER TABLE prospect_touches_new RENAME TO prospect_touches;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0347_boss_prospects_four_touches');
