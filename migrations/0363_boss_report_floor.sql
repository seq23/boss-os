-- THE BRIEFING'S FLOOR VERDICT RIDES ON ITS ROW (owner, 13 Nov 2026).
--
-- "figure out how ot make sure my briefs get wrriten to the impeccable standard we have had". The
-- delivery now grades each report against the standard (briefingSpec.ts `briefingFloor`) and keeps
-- the day's best attempt. `floor` is that verdict as JSON: { pass, misses[], measured{} }. Today and
-- the morning email read it to say "below the standard today" by name, and a second attempt reads
-- it to decide whether it is better than the one already filed. NULL on rows from before this
-- migration and on a failed run, which has nothing to grade. Additive: no row is changed.
ALTER TABLE executive_reports ADD COLUMN floor TEXT;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0363_boss_report_floor');
