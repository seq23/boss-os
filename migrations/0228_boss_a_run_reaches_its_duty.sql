-- A launchd run reaches its duty row, an approved cover gets published, and no message is dropped.
--
-- Three defects, one shape: work happens and the system does not learn it.
--
-- ─── 1. TWO SCHEDULERS, TWO RECORDS, NO LINK ────────────────────────────────
--
--   "I DONT CARE IF ITS LAUNCHD OR D1 - THOSE SHOULD BE LINKED ANYWAY."
--
-- Monique's duties ran correctly from launchd on her Mac - capital.log shows the buyer work firing
-- and emailing her - while `standing_duties.last_run_at` read NULL, because the D1 cron is not what
-- executes them. A session read the null and told her the duties had never run. She caught it.
--
-- CONFIRMED against production on 11 September 2026: of ten duties with `executor = 'local_job'`,
-- only THREE carry a `last_run_at`. Those three are the only ones whose launchd job happens to post
-- to an endpoint that hardcodes their duty id - `routes/kdp.ts` does it twice, `routes/lp.ts` once.
-- The other seven have run for days and read as never having run:
--
--   duty_inbound_supply  duty_interest_nudge  duty_lp_positive  duty_mailbox_sweep
--   duty_people_worth_a_call  duty_scooter_sheet  duty_site_audit_repair
--
-- The fix is a GENERIC report, and the thing that makes it generic rather than a second list is
-- that the duty row ALREADY NAMES ITS SCRIPT: `task_input.$.local_job`. So the launchd job says
-- which script it is running - which it must know anyway, because it is running it - and the server
-- resolves that to a duty. One list, the one that was already there, read from both ends.
--
-- ─── A RUN THAT DID NOT HAPPEN MUST STILL LOOK LIKE IT DID NOT HAPPEN ───────
--
-- The tempting shortcut is to stamp `last_run_at` when the scheduler fires. That makes every screen
-- green and makes the number meaningless - it would have hidden the very confusion this fixes. So:
--
--   `last_run_at`     is set ONLY on a completed, successful run. It is the last time the work
--                     actually happened, and nothing else may write it.
--   `last_outcome`    'ok' or 'failed'. Written on BOTH, which is the half that was missing:
--                     a failed run used to leave the previous success standing and unqualified.
--   `last_failure_reason` what the job said when it failed, in its own words.
--
-- A duty whose last outcome is 'failed' therefore reads as "it last succeeded on the 9th and has
-- failed since", which is a different sentence from both "it ran" and "it never ran".

ALTER TABLE standing_duties ADD COLUMN last_outcome TEXT;
ALTER TABLE standing_duties ADD COLUMN last_outcome_at INTEGER;
ALTER TABLE standing_duties ADD COLUMN last_failure_reason TEXT;

-- Every launchd run, kept, because one timestamp cannot answer "has this been failing quietly".
CREATE TABLE duty_runs (
  id            TEXT PRIMARY KEY,
  duty_id       TEXT NOT NULL REFERENCES standing_duties(id),
  -- The script the wrapper was asked to run. This is the join key, and it is the SAME string the
  -- duty row already carries in task_input.$.local_job - not a new identifier that could drift.
  local_job     TEXT NOT NULL,
  started_at    INTEGER,
  finished_at   INTEGER NOT NULL,
  -- ok | failed. There is no third state: a wrapper that cannot say which is itself a failure.
  outcome       TEXT NOT NULL CHECK (outcome IN ('ok','failed')),
  exit_code     INTEGER,
  -- What the job said. For a failure this is the last thing it printed, which is what makes a red
  -- row actionable rather than merely red.
  reason        TEXT,
  -- 'launchd' normally; 'manual' when she runs it herself.
  source        TEXT NOT NULL DEFAULT 'launchd',
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_duty_runs_recent ON duty_runs(duty_id, finished_at DESC);
CREATE INDEX idx_duty_runs_failed ON duty_runs(outcome, finished_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('duty_runs', 'duties', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'When a scheduled job on her Mac ran, which duty it was doing, and whether it worked. Operating machinery: a duty id, a script name, a timestamp and an exit code.')
ON CONFLICT(entity) DO NOTHING;

-- ─── 2. EVERY KDP MESSAGE ENDS SOMEWHERE NAMED ──────────────────────────────
--
--   "EVERYTIME I GET A KDP EMAIL SHE SHOULD READ IT AND DETERMINE IF THERE IS A TASK FOR HER"
--
-- `kdp_mail_log` already records a disposition and a note. What it permits is the defect: an item
-- may carry `action_taken = NULL` and the row is accepted. That is a message read and silently
-- dropped - the same shape as an audit email that carries counts and no URLs, and the same shape as
-- the approval that was marked executed having done nothing.
--
-- THREE OUTCOMES, AND ONE OF THEM IS "NOTHING, HERE IS WHY". That last one is not a loophole, it is
-- the point: promotional mail SHOULD end in nothing, and the difference between deciding that and
-- forgetting is whether a reason was written down. `noted_no_action` with an empty reason is
-- refused by the endpoint exactly as a missing note is.
--
--   acted     - Simone did something about it. `action_taken` says what.
--   assigned  - she opened work: a colleague via work_assignments, or something in her own queue.
--   noted     - nothing to do, and `action_taken` says why not. The only outcome promo may carry.
ALTER TABLE kdp_mail_log ADD COLUMN outcome_kind TEXT;

-- Existing rows are backfilled honestly rather than flattered. A promo row that was dropped with no
-- action WAS a correct 'noted' outcome; anything else that recorded no action is marked so plainly,
-- because rewriting history to satisfy a new constraint is how a guard ends up guarding nothing.
UPDATE kdp_mail_log SET outcome_kind = 'noted',
  action_taken = COALESCE(action_taken, 'Promotional. Noted and dropped, which is what promotional mail is for.')
  WHERE outcome_kind IS NULL AND disposition = 'promo';
UPDATE kdp_mail_log SET outcome_kind = 'noted',
  action_taken = COALESCE(action_taken, 'Recorded before outcomes were required, so what was decided about it was never written down.')
  WHERE outcome_kind IS NULL AND action_taken IS NULL;
UPDATE kdp_mail_log SET outcome_kind = 'acted' WHERE outcome_kind IS NULL;

-- ─── 3. THE APPROVAL SHE GAVE, AND THE RUN THAT NEVER CAME ──────────────────
--
-- On 9 September at 14:00 seven replacement covers were raised in her Inbox. At 14:30 she approved
-- them. `approvals.executed_at` was stamped, `execution_status` reads 'executed', and the entire
-- effect was a sentence written onto the deliverable:
--
--   "Covers approved by you on 2026-09-09. Simone uploads them, publishes ONE title first ..."
--
-- NO RUN DOES THAT. `kdp-surface.sh` and `kdp-watch.sh` only read Amazon and report; no launchd job
-- has ever invoked `kdp:covers`, and `kdp-browser.mjs` had no command that could click anything -
-- its bookshelf reader says so itself: "READ, NEVER WRITE... It clicks nothing." So this was not an
-- approval with no consumer. It was worse and more specific: a consumer that recorded an intention,
-- stamped a receipt, and handed off to a scheduled run that was never scheduled. Two more days.
--
-- `duty_kdp_publish` is that run, and `kdp_publish_attempts` is what makes its claims checkable.

CREATE TABLE kdp_publish_attempts (
  id               TEXT PRIMARY KEY,
  attempted_at     INTEGER NOT NULL,
  -- The approval this acted on. NOT NULL by intent: a publish attempt that cannot name her verdict
  -- is one nobody authorised, and the endpoint refuses it.
  judgement_id     TEXT,
  title_ref        TEXT,
  cover_uploaded   INTEGER NOT NULL DEFAULT 0,
  publish_attempted INTEGER NOT NULL DEFAULT 0,
  -- What the BOOKSHELF said afterwards, which is the only answer that counts. "Publish was clicked"
  -- and "the book is published" are different facts and this column holds the second one.
  resulting_state  TEXT,
  -- Amazon's own words for a refusal. Never our paraphrase: a paraphrased refusal is how a
  -- server-side flag spent a week being described as an account-information problem.
  amazon_message   TEXT,
  -- 'attempted' or 'could-not-run'. A run that could not start is not a run that found nothing.
  run_outcome      TEXT NOT NULL DEFAULT 'attempted',
  stop_code        TEXT,
  source           TEXT NOT NULL DEFAULT 'launchd',
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_kdp_publish_recent ON kdp_publish_attempts(attempted_at DESC);
CREATE INDEX idx_kdp_publish_title ON kdp_publish_attempts(title_ref, attempted_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('kdp_publish_attempts', 'ops', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'What was uploaded and published for each blocked title, and what Amazon said back. Opaque references, flags and a refusal message; nothing about a person and no manuscript.')
ON CONFLICT(entity) DO NOTHING;

-- ─── Simone's third KDP duty: the one that ACTS ─────────────────────────────
--
--   "I WANT YOU TO MAKE IT A DUTY FOR SIMONE TO CONTROL EVERYTHING RELATED TO MY BOOKS ON KDP.
--    SHE NEEDS TO GET THE 7 TITLES THAT ARE NOT PUBLISHED TO PUBLISHED STATUS. THAT MEANS CHANGING
--    THE COVERS AND PUBLISHING THEM."
--
-- WHY A THIRD DUTY RATHER THAN A FLAG ON AN EXISTING ONE. Simone already reads (duty_kdp_surface)
-- and chases (duty_kdp_publication). Neither can act: both are `claude -p` runs, and a scheduled
-- `claude -p` process has NO browser tools at all - proven 9 September, and it is a property of the
-- sandbox rather than a bug to be fixed. The acting duty runs Playwright directly against Simone's
-- own persistent Chrome profile, which is a different executable with different requirements. Three
-- verbs, three duties, one owner, and the lane is hers end to end.
--
-- NO MODEL, AND THAT IS DELIBERATE. This duty runs no language model at all: it reads her recorded
-- verdict, fetches the exact bytes she approved, drives a browser and reports what Amazon said.
-- There is no classification to do and nothing to reason about, so there is nothing to spend.
--
-- DAILY AT 09:45, after the case watch (09:23) and the surface triage (09:30), so the three never
-- race for a browser or a session and this one runs with the day's determination already filed.
--
-- IT ENDS. The day the last title is Live this duty has nothing to do and says so; it is not
-- suspended automatically, because a duty that turns itself off is one nobody notices has stopped.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday, weekdays,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria) VALUES
  ('duty_kdp_publish', 'Kindle - put the approved covers up and publish', 'emp_chief', 'ops',
   9, 45, 'America/Chicago', 'daily', NULL, NULL,
   unixepoch() * 1000, 'local_job', 'ops', 'Kindle - put the approved covers up and publish',
   json_object(
     'local_job', 'kdp-publish.sh',
     'why_local',
     'Uploading a cover and pressing Publish needs a real browser holding her Amazon session. A scheduled claude -p run has no browser tools at all, so this drives Playwright directly against Simone''s own persistent Chrome profile from launchd on her Mac. No password passes through it and none can.',
     'consumes_approval', 'kdp_cover_upload',
     'cover_map', 'scripts/ops/kdp-cover-map.json'
   ),
   'The covers the owner approved are on the books she approved them for, one title is published first and confirmed Live on the bookshelf before any other is touched, and every title that does not reach Live is reported with Amazon''s own message rather than a paraphrase. Nothing is ever reported done because Publish was clicked.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0228_boss_a_run_reaches_its_duty');
