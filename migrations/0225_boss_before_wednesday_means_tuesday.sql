-- TWO THINGS SCOOTER READS ON A WEDNESDAY, AND NEITHER OF THEM RAN ON ITS OWN.
--
-- ─── Her words, 9 September 2026 ────────────────────────────────────────────
--
--   "i want positive replies to be weekly before wednesday and LP replies can happen daily and she
--    needs to update the google sheet for scooter weekly before wednesday"
--
-- ─── "Before Wednesday" is a meeting, not a preference ──────────────────────
--
-- The Sequoia // Scooter Sync is a real standing series, WEDNESDAYS AT 11:00 CENTRAL. So "before
-- Wednesday" means "in her hands with time to read it before that meeting", and both of these are
-- scheduled for TUESDAY rather than Wednesday morning ON PURPOSE: a job that fires at 07:45 on
-- Wednesday and fails leaves her walking into the 11:00 with nothing and no time to fix it. Tuesday
-- leaves a whole day for a failure to be noticed and the command to be re-run by hand.
--
-- ─── What was actually wrong ───────────────────────────────────────────────
--
-- BOTH JOBS WERE BUILT, COMMITTED, REGISTERED AS npm SCRIPTS, AND SCHEDULED BY NOTHING. They ran
-- only when a human typed the command. That is the defect class this repository names by name —
-- "exists but nothing invokes it" — and it is the exact shape of automation she has been correcting
-- all day. `lp-positive.mjs` had never run except by hand; `lp-tracker-sync.mjs` was run by hand on
-- 7 September and his tab fell 29 rows behind within 48 hours.
--
-- A MANUAL SYNC FAILS SILENTLY. Nobody discovers it until somebody quotes a stale figure in a
-- meeting, which is what happened: he was reading a five-week-old picture and believed otherwise.
--
-- ─── The order inside the sheet job is not arbitrary ───────────────────────
--
-- `lp:sync` appends the new sends to his "AI Outreach" tab; `lp:outcomes` then writes the real
-- Status across both sheets. RUNNING OUTCOMES FIRST WOULD GRADE A SHEET THAT IS MISSING ROWS. Done
-- by hand on 9 September it was 29 rows appended, then 101 Status cells corrected across 571 rows.
-- Both are idempotent — a second run appends 0 and changes 0 — so a Tuesday that runs twice is
-- harmless and a Tuesday that runs once is complete.
--
-- ─── NEITHER DUTY NAMES A MODEL, AND THAT IS STATED RATHER THAN LEFT BLANK ──
--
-- An unnamed model defaults to the most expensive one available; that defect made a single briefing
-- cost $3.88. Neither of these reaches a model at all: classifying a reply as positive is local
-- pattern matching over a properly decoded MIME body, and appending rows to a spreadsheet is
-- arithmetic. An empty model field would leave a future reader to assume one was forgotten, so both
-- rows say plainly that there is none and why. `validate:duty-delivery` reconciles the two
-- directions and would fail if either row claimed a model its script cannot spend.
--
-- ─── 07:15 then 08:15, and the gap between them is deliberate ──────────────
--
-- The daily LP read (`duty_lp_replies`) fires at 07:45. Scooter's sheet goes first at 07:15 because
-- it is the thing with a deadline attached to another person's calendar. The positive-replies note
-- goes at 08:15, AFTER the daily read, so it works on a mailbox whose daily pass has already
-- completed rather than racing it for the same Gmail session.

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_scooter_sheet',
   'Scooter''s LP tracker, current before the Wednesday sync',
   'emp_relationship', 'ops',
   7, 15, 'America/Chicago', 'weekly', 2,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'Scooter''s LP tracker, current before the Wednesday sync',
   json_object(
     'local_job', 'lp-tracker-sync.mjs',
     'then', 'lp-outcomes.mjs',
     'why_no_model', 'Appending rows to a spreadsheet and writing a Status column are arithmetic. A model here would cost money every Tuesday to restate facts the sheets already hold, and could write a status nobody observed.',
     'why_local', 'It authenticates AS THE SERVICE ACCOUNT ITSELF with no sub claim, because both spreadsheets are owned by other accounts and shared directly with it. Impersonating anyone there fails with a 404 that reads like a wrong file id.',
     'sends', 'appends to his AI Outreach tab, corrects Status on both sheets, emails her the address lists and posts an Inbox notice'
   ),
   'His tab is never more than a few days behind when he opens it on Wednesday, the append is append-only by construction, and a Tuesday that runs twice appends 0 rows and changes 0 cells. Outcomes run after the append, never before, so no row is graded while the sheet is still missing rows.',
   0);

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_lp_positive',
   'The LPs who said yes — a running list, in her hands before Wednesday',
   'emp_relationship', 'ops',
   8, 15, 'America/Chicago', 'weekly', 2,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'The LPs who said yes — a running list, in her hands before Wednesday',
   json_object(
     'local_job', 'lp-positive.mjs',
     'why_no_model', 'Whether a reply says "happy to connect" is decided by local pattern matching over a properly decoded MIME body, and a starred message outranks the classifier because she starred it herself. A model would cost money weekly to reach the same answer less predictably.',
     'why_local', 'Reading the West Peek mailbox needs a credential the Claude Code runner strips on purpose. The addresses and the one short quote per positive reply live in a file on her Mac and in an email to her own inbox; Boss OS gets counts.',
     'sends', 'email to sequoia@westpeek.ventures, plus a NOTICE in the Boss OS inbox — a notice, not an approval, because there is nothing to approve'
   ),
   'A yes that arrives on a Thursday is in front of her before the following Wednesday. The list only ever grows, so nobody drops off it because a later scan windowed differently. Recall is checked against the twelve replies she supplied from her own records and fails loudly on a miss that is not already a named coverage gap.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0225_boss_before_wednesday_means_tuesday');
