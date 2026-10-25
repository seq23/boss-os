-- The Search Readiness repair pass gets its own duty row: ONE clock (owner ruling, 25 Oct 2026).
--
-- The fix queue the Monday 06:00 audit writes (~/.boss-os/search-readiness/fix-queue.json) was only
-- read inside Danielle's Thursday Ahrefs pass. She asked "why can't all 242 be fixed now?", the
-- whole queue was worked to empty on 25 Oct, and her ruling for after that: the repair pass runs
-- WEEKLY, on TUESDAY at 07:30 Central (Monday is crowded), working from Monday's 06:00 audit queue.
-- The audit itself stays on Monday. The Ahrefs pass stays on Thursday (duty_site_audit_repair, unchanged).
--
-- This row IS the schedule. launchd only ticks daily at 07:30 and asks this row through
-- `duty-run.sh search-readiness-fix.sh --only-if-due`; weekday 2 is Tuesday (0 = Sunday, per
-- duties/cadence.ts). next_due_at is seeded in the same statement as the cadence (per 0197):
-- Tuesday 27 Oct 2026, 07:30 CDT = 12:30 UTC.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_search_readiness_repair',
   'Monday''s Search Readiness gaps, fixed on Tuesday at source and put live',
   'emp_repo', 'ops',
   7, 30, 'America/Chicago', 'weekly', 2,
   CAST(strftime('%s', '2026-10-27 12:30:00') AS INTEGER) * 1000,
   'local_job', 'ops',
   'Monday''s Search Readiness gaps, fixed on Tuesday at source and put live',
   json_object(
     'local_job', 'search-readiness-fix.sh',
     'why_local', 'It needs working copies of her repositories, git, gh and each repo''s own validators, none of which exist inside a Worker.',
     'never', 'A protected page (the Spry Labs download page) is never touched by this pass; it is fixed only on its own. Client repos off the auto-fix lane are never branched. Nothing merges except through ~/bin/land.'
   ),
   'Every workable brief in Monday''s fix queue is fixed, one repo at a time, round after round, until none is left or a round fixes nothing. Protected and no_repo briefs are left and named. The run writes how many it fixed and how many are left, which the next Monday email says in words ("Danielle fixes these every Tuesday: N fixed last week, M left").',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0305_boss_search_readiness_repair_weekly');
