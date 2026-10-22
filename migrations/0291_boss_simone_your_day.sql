-- 22 October 2026 — Simone's "Your day" every morning and "Your week" on Mondays (owner-approved
-- in the Review Pack, "Simone's daily and Monday emails").
--
-- One local_job duty, run by launchd com.seq.boss-your-day at 06:40 Central through duty-run.sh so
-- every run reaches this row. scripts/ops/your-day.mjs reads Boss OS (Today, the diary, tasks, the
-- Inbox, repo changes, the roster) and the Porch & Party owner feed, and
-- sends one email (two on Mondays, "Your week" first). No model is called.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_your_day',
   'Your day every morning, and your week on Mondays',
   'emp_chief', 'ops',
   6, 40, 'America/Chicago', 'daily', NULL,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'Your day: what needs you, Valerie''s to-do, the team, loose ends (and Your week on Mondays)',
   json_object(
     'local_job', 'your-day.mjs',
     'why_no_model', 'Every line is a row read from Boss OS or the Porch & Party owner feed; nothing is written by a model.',
     'why_local', 'The Boss OS passcode and the Porch & Party feed key live in the vault on her Mac.',
     'sends', 'one email to her from simone@ every morning at 06:40 (two on Mondays: Your week, then Your day); her reply becomes a task for Simone carrying the email it answers'
   ),
   'One email a day, in the order Yours today, Porch & Party for Valerie, the team, loose ends; on Mondays also deadlines, her calendar, replies waiting, Valerie''s week and each teammate. Every line comes from data; an empty section says so in one line; a source that cannot be read says so.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0291_boss_simone_your_day');
