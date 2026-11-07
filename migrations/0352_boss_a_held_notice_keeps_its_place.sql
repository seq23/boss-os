-- A HELD NOTICE KEEPS ITS PLACE (repair, 6 Nov 2026).
--
-- A notice the plain-email gate holds on her Mac is the same words every run until the code that
-- wrote them changes, so counting it as a failed send burned the five attempts that decide whether
-- she is ever told (the DNA research report for Valerie was held this way). Holds are counted on
-- their own, with their own ceiling (MAX_HOLDS in src/worker/boss/routes/taskNotices.ts).
-- Additive only: one column with a default; no live record changes.
ALTER TABLE boss_task_notices ADD COLUMN holds INTEGER NOT NULL DEFAULT 0;
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0352_boss_a_held_notice_keeps_its_place');
