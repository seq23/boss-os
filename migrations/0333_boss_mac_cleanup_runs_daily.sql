-- 0333 — Kendra's Mac clean-up runs daily, 09:00 Central (3 Nov 2026).
--
-- On 3 Nov 2026 the Mac hit a kernel watchdog panic with low swap and 15 GB free; 11 GB of it was How We
-- Know render working folders a week of nightly renders had left behind. Weekly was too slow. Only the
-- schedule columns change; the launchd agent (scripts/ops/install-agent-launchd.sh) carries the same
-- daily 09:00 so the Mac and D1 agree on when a run is due.

UPDATE standing_duties
   SET cadence = 'daily',
       weekday = NULL,
       task_title = 'Daily clean-up: old worktrees, caches, published renders, render working folders, old browsers'
 WHERE id = 'duty_mac_cleanup';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0333_boss_mac_cleanup_runs_daily');
