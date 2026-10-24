-- Failed tasks, closed by rule (24 Oct 2026: Spirit's "Reality first: 27 failed tasks").
--
-- 24 of the 27 were runs of jobs that have since run cleanly (the Executive Intelligence Report's
-- "stdout was not JSON" until 11 Oct, the Brokerage Sourcing Sweep's until 7 Oct, a Codex flag on
-- 1 Oct, a backlink run on 29 Sep, a repo change blocked by uncommitted work on 21 Sep): the cause
-- was fixed at source and a later run of the same job finished. They are closed as superseded, not
-- deleted, and each says why. The rest (a one-off record of a send already kept elsewhere, and a
-- month-old repo change nobody asked for again) are closed with the reason; asking again reopens
-- the work. From here on a failed task is a fix job and a done line in the morning email the next
-- day (scripts/ops/your-day.mjs `failedTaskLines`). ADDITIVE: rows are updated, never removed.
UPDATE tasks
   SET status = 'cancelled',
       error = COALESCE(error, '') || ' — closed 24 Oct 2026: superseded, a later run of the same job finished.'
 WHERE status = 'failed'
   AND EXISTS (SELECT 1 FROM tasks t2
                WHERE t2.status = 'done' AND t2.employee_id = tasks.employee_id
                  AND substr(t2.title, 1, 30) = substr(tasks.title, 1, 30) AND t2.created_at > tasks.created_at);

UPDATE tasks
   SET status = 'cancelled',
       error = COALESCE(error, '') || ' — closed 24 Oct 2026: more than two weeks old and never retried; ask again and it reopens.'
 WHERE status = 'failed' AND created_at < 1791331200000;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0297_boss_failed_tasks_closed_and_told');
