-- The three copied West Peek fund jobs that still ran here are switched off (her yes, 22 Nov 2026,
-- personal brain Settled decisions: "Yes, retire it").
--
-- WHY THESE THREE, AND WHY NOTHING STOPS. Read live before this was written (22 Nov 2026, read-only
-- D1 queries on both databases):
--   diagnostics_sweep  every 15 min here; 1,889 runs, every one "14 checked · 1 down · nothing new":
--                      the one fault is network_sync below, and its notices go to fund partners in a
--                      table no Boss OS screen reads. West Peek OS runs its own (ACTIVE, 639 runs in
--                      7 days, "16 checked · 0 down").
--   deck_reading       every 15 min here; 1,885 runs, never once a deck ("no decks waiting"): no
--                      mail reaches this Worker's fund intake. West Peek OS runs its own (ACTIVE,
--                      daily 11:15 UTC, reads the decks that arrive there).
--   network_sync       every 15 min here; failed every run for 7 days ("WP_OS_NETWORK_OS_BASE_URL is
--                      not set"). West Peek OS runs its own (ACTIVE, succeeding: "contact: 1 applied").
-- The other three seeded jobs (daily_intelligence, weekly_mp_review, monthly_room_proposal) were
-- already PAUSED and are not touched.
--
-- NOTHING IS DELETED. The rows stay, with every column as it was except status and pause_reason;
-- job_run history stays. The marker below is what the switch-back line keys on, so it can only
-- ever reopen the rows this file closed.
--
-- SWITCH BACK ON (one line, restores the rows exactly):
--   UPDATE scheduled_job SET status = 'ACTIVE', pause_reason = NULL WHERE pause_reason = 'chassis-retire 2026-11-22: West Peek OS runs this job itself';

UPDATE scheduled_job
   SET status = 'PAUSED',
       pause_reason = 'chassis-retire 2026-11-22: West Peek OS runs this job itself'
 WHERE job_key IN ('diagnostics_sweep', 'deck_reading', 'network_sync')
   AND status = 'ACTIVE'
   AND pause_reason IS NULL;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0375_chassis_jobs_switched_off');
