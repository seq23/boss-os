-- The record of 0375's pause, and the one fault it left open (chassis retirement, her yes 22 Nov 2026,
-- personal brain Settled decisions: "Yes, retire it").
--
-- CORRECTION TO 0375's HEADER. It says the three jobs ran "every 15 min here". They ran hourly: the
-- Worker cron is `0 * * * *`, and the live job_run table shows 169 runs per job in the 7 days to
-- 22 Nov 2026. 0375 is applied history and is not edited; this line is the correction.
--
-- 1. THE PAUSE GETS THE SAME RECORD THE PAUSE BUTTON WROTE. The chassis's own pause control
--    (services/jobs.ts handlePauseJob, retired with the chassis) wrote one `scheduled_job.paused`
--    row to event_record per job, with the reason in payload_json. 0375 paused by migration, so
--    nothing wrote one. This adds it, one per job, and ONLY for a job 0375 really paused (the row
--    still carries 0375's marker); a job switched back on before this runs gets no false record.
--    The id is fixed per job, so a re-run adds nothing.
--
-- 2. THE OPEN "SCHEDULED WORK" FAULT IS CLOSED. One health_fault row has been open since
--    13 Oct 2026: check_key `scheduled_work`, the sweep's reading of network_sync failing every
--    run. Both jobs are paused now, so no later sweep can ever find it healthy and close it; left
--    open it would read as a live fault forever. It is closed only while network_sync is still
--    paused by 0375, so this never hides a fault for a job that is running.
--
-- NOTHING IS DELETED. Two inserts (new rows) and one UPDATE that sets resolved_at on an open row;
-- every other column stays as it was. To reopen the fault (one line):
--   UPDATE health_fault SET resolved_at = NULL WHERE check_key = 'scheduled_work' AND resolved_at = '2026-11-22T00:00:00.000Z';

INSERT OR IGNORE INTO event_record (id, event_type, actor_type, actor_id, object_type, object_id, firm_scope, payload_json)
SELECT 'evt_0375_paused_' || job_key,
       'scheduled_job.paused',
       'system',
       'migration:0375_chassis_jobs_switched_off',
       'scheduled_job',
       id,
       'west-peek',
       json_object('reason', pause_reason, 'migration', '0375_chassis_jobs_switched_off')
  FROM scheduled_job
 WHERE job_key IN ('diagnostics_sweep', 'deck_reading', 'network_sync')
   AND status = 'PAUSED'
   AND pause_reason = 'chassis-retire 2026-11-22: West Peek OS runs this job itself';

UPDATE health_fault
   SET resolved_at = '2026-11-22T00:00:00.000Z'
 WHERE check_key = 'scheduled_work'
   AND resolved_at IS NULL
   AND EXISTS (SELECT 1 FROM scheduled_job
                WHERE job_key = 'network_sync' AND status = 'PAUSED'
                  AND pause_reason = 'chassis-retire 2026-11-22: West Peek OS runs this job itself');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0376_chassis_pause_recorded');
