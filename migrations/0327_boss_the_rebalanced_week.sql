-- THE REBALANCED WEEK (owner approved, 1 Nov 2026).
--
-- Monday 07:00-08:00 Central fired 36 jobs at once, 13 of them heavy. She approved one theme a day:
-- Monday deals, Tuesday capital, Wednesday Spry Labs, Thursday backlinks and search fixes, Friday
-- close the week, Sunday plan the week. The Schedule page (☰ More → Schedule,
-- src/shared/boss/schedule/manifest.json) is the record; tests/schedule.test.ts holds these rows to it.
--
-- Mac duties move WITH their launchd entries (scripts/ops/install-agent-launchd.sh, same change).
-- Each weekday change sets next_due_at in the same statement (0197's lesson: otherwise the old
-- schedule gets one more turn): the next such weekday STRICTLY AFTER today, at the Central time in
-- UTC as it stands in winter (0246's form; a summer seed runs an hour early, the safe direction,
-- because a Mac tick asks "am I due?" at its own hour). Times in the comments are America/Chicago.

-- Pre-seed watch: Monday → Tuesday 07:30 (capital day)..
UPDATE standing_duties SET weekday = 2, local_hour = 7, local_minute = 30, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 2')) + 13 * 3600 + 30 * 60) * 1000
 WHERE id = 'duty_preseed_watch';

-- What Search Console saw last week: Monday → Wednesday 07:00 (Spry Labs day)..
UPDATE standing_duties SET weekday = 3, local_hour = 7, local_minute = 0, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 3')) + 13 * 3600) * 1000
 WHERE id = 'duty_property_gsc';

-- Backlink prospecting: Monday → Thursday 07:30 (backlinks day)..
UPDATE standing_duties SET weekday = 4, local_hour = 7, local_minute = 30, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 4')) + 13 * 3600 + 30 * 60) * 1000
 WHERE id = 'duty_link_prospects';

-- Outside locks: Monday → Friday 08:40 (close the week)..
UPDATE standing_duties SET weekday = 5, local_hour = 8, local_minute = 40, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 5')) + 14 * 3600 + 40 * 60) * 1000
 WHERE id = 'duty_outside_locks';

-- Brokerage sourcing (Mon/Wed/Fri): 06:45 → 05:30, so it is off the seat before the 06:00 Executive
-- Intelligence Report starts (its hard timeout is 900 s)..
UPDATE standing_duties SET local_hour = 5, local_minute = 30, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 1')) + 11 * 3600 + 30 * 60) * 1000
 WHERE id = 'duty_brokerage_sourcing';

-- Search Readiness fix: Tuesday 06:30, and the Ahrefs fix: Thursday 05:00 (the approved list). Both
-- plists already fired then, because neither was ever moved to Central; the installer now writes
-- those Central times and the rows say the same.
UPDATE standing_duties SET local_hour = 6, local_minute = 30, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 2')) + 12 * 3600 + 30 * 60) * 1000
 WHERE id = 'duty_search_readiness_repair';
UPDATE standing_duties SET local_hour = 5, local_minute = 0, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 4')) + 11 * 3600) * 1000
 WHERE id = 'duty_site_audit_repair';

-- THE ROW SAYS WHEN THE WORK REALLY RUNS. duty_credentials runs at 06:15 (com.seq.boss-credentials:
-- twenty minutes before the first agent tick, so a dead login shows before the duty that needs it
-- fails); the row said 07:15.
UPDATE standing_duties SET local_hour = 6, local_minute = 15 WHERE id = 'duty_credentials';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0327_boss_the_rebalanced_week');
