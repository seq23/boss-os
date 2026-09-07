-- The buyer hunt would have fired on a Tuesday, which is not one of its days.
--
-- FOUND BY READING THE LIVE SCHEDULE RATHER THAN THE INTENT. 0196 set the duty to Monday, Wednesday
-- and Friday via the new `weekdays` column, and told her so. Its stored `next_due_at` still said
-- Tuesday 06:45, because that value was computed by an earlier tick — before the column existed —
-- and nothing recomputes a due time in place when a schedule changes.
--
-- So it would have fired tomorrow, once, on a day I had just told her it would not. `nextDueAt`
-- would then have honoured the weekdays and settled onto Wednesday, so this is one wrong run rather
-- than a permanent fault — which is exactly the kind of small discrepancy that gets waved through
-- and then quietly teaches her that the schedule on the screen is not the schedule that runs.
--
-- THE GENERAL LESSON, worth more than the fix: changing a cadence does not change a duty's next
-- occurrence. Any future migration that edits `cadence`, `weekday` or `weekdays` has to set
-- `next_due_at` in the same statement, or the old schedule gets one more turn.

UPDATE standing_duties
   SET next_due_at = 1788954300000  -- Wednesday 9 September 2026, 06:45 America/Chicago
 WHERE id = 'duty_brokerage_sourcing'
   AND next_due_at < 1788954300000;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0197_boss_sourcing_next_due');
