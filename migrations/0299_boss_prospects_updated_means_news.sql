-- Reading her Sent mail is not news (24 Oct 2026). The first backfill of the prospects' sent words
-- (0296, POST /lp/prospects/touches) stamped updated_at on all 36 rows, and the morning email reads
-- updated_at as "a reply came in", so an 11 Oct bounce showed as new. The route no longer stamps it
-- (lp/desk.ts backfillTouches); this puts back the time of the last real change on rows that had no
-- reply since. ADDITIVE: one column on existing rows, nothing removed.
UPDATE prospects
   SET updated_at = COALESCE(last_touch_at, created_at)
 WHERE status IN ('new', 'active', 'bounced', 'done')
   AND updated_at > COALESCE(last_touch_at, created_at)
   AND updated_at >= 1792800000000;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0299_boss_prospects_updated_means_news');
