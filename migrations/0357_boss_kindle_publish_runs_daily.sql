-- 0357 — Simone's Kindle publish duty runs daily, 09:45 Central (owner, 8 Nov 2026: "Yes, publish on her own").
--
-- Monthly left an approved book waiting up to a month, and a book in Amazon's review was not followed
-- to Live until the next 1st. Daily, it acts only when something is approved and not yet Live: with
-- nothing approved it opens nothing and sends nothing. Only the schedule columns change; the launchd
-- agent (scripts/ops/install-agent-launchd.sh) carries the same daily 09:45 so the Mac and D1 agree.

UPDATE standing_duties
   SET cadence = 'daily',
       weekday = NULL
 WHERE id = 'duty_kdp_publish';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0357_boss_kindle_publish_runs_daily');
