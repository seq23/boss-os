-- THE ONE-LIST LP EMAILS (owner, 15 Nov 2026). One duty, additive only. The list and its state are
-- private runtime files on her Mac (~/.boss-os/lp/8fund/), never in this public repo.

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_lp8_drip',
   'One-list LP emails: four per person, one thread, weekdays',
   'emp_relationship', 'ops',
   9, 30, 'America/Chicago', 'daily', NULL,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'Send the due emails to the people on the private LP list',
   json_object(
     'local_job', 'lp8-drip.mjs',
     'why_no_model', 'The four approved emails are filled with a first name and a one-line reason; nothing else.',
     'why_local', 'The West Peek delegation key and NeverBounce key live in the vault on her Mac.',
     'sends', 'from sequoia@westpeek.ventures only while the private plan is approved: at most 6 new a weekday, 4 emails per person on day 0, 3, 7 and 14'
   ),
   'Only while the plan is approved; NeverBounce before email 1; a message from their domain, a Reply Queue, Reply Log or Blocked row, or a hard bounce stops everyone at that domain; every send is on the Sent Log.',
   0);

UPDATE standing_duties SET weekdays = json_array(1, 2, 3, 4, 5) WHERE id = 'duty_lp8_drip' AND weekdays IS NULL;

UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Sends only the emails the cadence makes due; a day with nobody due sends none, and a due-but-unsent day is its own named stop.', output_since = unixepoch() * 1000 WHERE id = 'duty_lp8_drip';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0366_boss_lp8_drip');
