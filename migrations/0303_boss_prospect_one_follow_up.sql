-- 24 October 2026 — owner ruling: prospects get ONE follow-up at most (the first email and one more,
-- never a third). MAX_TOUCHES is 2 (src/shared/boss/lp/plan.mjs). Anyone already at two emails has
-- had their one follow-up: the sequence is complete.
UPDATE prospects SET status = 'done', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
 WHERE status IN ('new','active') AND touches >= 2;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0303_boss_prospect_one_follow_up');
