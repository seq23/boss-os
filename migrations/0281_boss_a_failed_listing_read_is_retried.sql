-- 0281 — A FAILED PUBLIC-LISTING READ IS RETRIED, NOT PARKED FOR A MONTH (9 Oct 2026).
--
-- 0280's first production ticks found every Overpass instance busy (504/500) and recorded those
-- slices as read with found = 0, which the 30-day refresh treated as done. `lists.ts` now records a
-- failed read as found = -1 and retries it after two hours; this marks the slices already recorded
-- that way so they are retried too.
UPDATE outreach_slices SET found = -1 WHERE found = 0 AND detail LIKE 'every Overpass instance failed%';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0281_boss_a_failed_listing_read_is_retried');
