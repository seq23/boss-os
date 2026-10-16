-- 0285 — Simone's two Kindle duties run monthly, on the 1st (owner, 16 Oct 2026: "yes make them monthly").
--
-- Six of seven books are Live and the seventh (The Gift Letter) sits in Amazon's review, so a daily
-- read of the KDP mail and a daily publish pass mostly find nothing. Both stay Simone's; only the
-- schedule columns change. The launchd agents (scripts/ops/install-agent-launchd.sh) carry the same
-- Day 1 so the Mac and D1 agree on when a run is due.

UPDATE standing_duties
   SET cadence = 'monthly',
       weekday = NULL,
       next_due_at = (unixepoch(date('now', 'start of month', '+1 month')) + 14 * 3600 + 30 * 60) * 1000
 WHERE id = 'duty_kdp_surface';

UPDATE standing_duties
   SET cadence = 'monthly',
       weekday = NULL,
       next_due_at = (unixepoch(date('now', 'start of month', '+1 month')) + 14 * 3600 + 45 * 60) * 1000
 WHERE id = 'duty_kdp_publish';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0285_boss_kindle_duties_run_monthly');
