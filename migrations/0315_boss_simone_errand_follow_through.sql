-- 26 October 2026 — Simone follows an errand through (owner, after the club's first answer was told
-- to her as "Nothing. It's booked." when it offered three times, a fee per show and asked for her
-- number). The errand row's states grow (follow_up, booked, cancel_sent) with no schema change: the
-- state column is free text and the reader is src/shared/boss/commands/parse.mjs (readErrandReply,
-- errandAnswerIn). This migration registers the one new standing duty, so it is visible on
-- Team → Duties and every run reaches its row (scripts/ops/duty-run.sh errand-reminders.mjs):
--
-- "Do you still want to go?": 28 hours before every booking Simone made (New York time), one email
-- to her with what, where, when, the venue's rules and cancellation terms, and two taps, "Yes, keep it"
-- / "Cancel it". Example: the 11:00 pm DJ set on Thursday, October 29 → the email goes Wednesday,
-- October 28 at 7:00 pm. "Cancel it" (or a reply "cancel") has Simone cancel with them in their thread.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_errand_reminders', 'Ask "do you still want to go?" 28 hours before a booking', 'emp_chief', 'ops',
   0, 0, 'America/New_York', 'daily', NULL, unixepoch()*1000 + 86400000, 'local_job', 'ops',
   'Before a booking: "Do you still want to go?" (e.g. the 11:00 pm DJ set Thursday, October 29 → asked Wednesday, October 28 at 7:00 pm)',
   json_object('local_job', 'errand-reminders.mjs',
     'runs', 'every 10 minutes (launchd com.seq.boss-errand-reminders)',
     'why_no_model', 'The booking time is on the errand row; the reminder is arithmetic and a fixed letter.',
     'why_local', 'Simone''s emails to her go from the Mac with the Boss OS mail key from the vault.'),
   'Every booking with a time gets exactly one email 28 hours before it (within ten minutes), saying whether they have confirmed; a cancel from her reaches the business in their thread the same tick.', 0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0315_boss_simone_errand_follow_through');
