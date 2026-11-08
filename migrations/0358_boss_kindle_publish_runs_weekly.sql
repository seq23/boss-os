-- 0358 — Simone's Kindle publish duty runs weekly, Monday 09:45 Central (owner, 8 Nov 2026:
-- "simone kdp needs to be weekly or less"). Daily signed in to Amazon about 30 times a month for a
-- line with no sales; each sign-in risks a picture check that lands on her. Only the schedule
-- columns change; the launchd agent (scripts/ops/install-agent-launchd.sh) carries the same
-- Monday 09:45 so the Mac and D1 agree.

UPDATE standing_duties
   SET cadence = 'weekly',
       weekday = 1,
       next_due_at = (unixepoch(date('now', '+1 day', 'weekday 1')) + 15 * 3600 + 45 * 60) * 1000
 WHERE id = 'duty_kdp_publish';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0358_boss_kindle_publish_runs_weekly');
