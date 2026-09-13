-- The side-hustle slot stops waiting for her to flag something, and goes and looks instead.
--
-- ─── What was broken ────────────────────────────────────────────────────────
--
-- 0233 added `owned_deliverables.needs_owner`, DECLARED and never inferred, and the reasoning was
-- sound: reading "does this need her" out of a free-text blocker is matching by resemblance, and one
-- wrong guess at the top of her day teaches her to skim. What that reasoning missed is that NOTHING
-- EVER SETS THE FLAG. The slot has been silent since it shipped, and a slot that only echoes her own
-- flags is not a suggestion — it is a to-do list she has to write first.
--
--   "should suggest something that requires a human touch from one of the side hustles"
--   "the agent needs to examine what is going on with those businesses and give me stuff to do"
--
-- ─── The fix is not inference. It is EXAMINATION. ──────────────────────────
--
-- Guessing from prose is still refused. What is added is a job that GOES AND LOOKS at the grid
-- properties — CI still red and for how long, an open PR ageing, nothing shipped in weeks, a
-- scheduled lane that stopped firing — and writes down what it found, with the evidence. The flag is
-- still declared; what changed is that something other than her hand now declares it, on the
-- strength of a fact it can show her.
--
-- ─── AND THE SPLIT IS THE WHOLE FEATURE ────────────────────────────────────
--
-- Anything an employee or a script can do is DISPATCHED, not shown to her. A red workflow is work to
-- fix. Her slot gets only what needs HER — her judgement, her name, her signature, her voice.
--
--   "A slot that lists five red builds is a dashboard she will scroll past; a slot that says
--    'hicksconsulting has been waiting nine days on your copy approval' is the one thing she could
--    not delegate."
--
-- So `disposition` is on every observation, it is a CHECK-constrained two-value column, and the
-- contract reads only one of the two values.

-- ─── One row per run of the examination ─────────────────────────────────────
--
-- RULE 0, AS A RECORD RATHER THAN AS A COMMENT. `properties_expected` is how many the grid says
-- there are and `properties_examined` is how many were actually reached. A run that examined zero
-- and found nothing is not a quiet day — it is a broken job, and without both numbers those two are
-- the same empty screen. `today/routes.ts` raises the staleness alert from `last_run_at` on the duty
-- row; this is what makes "it ran and saw nothing" distinguishable from "it ran and saw nothing
-- because it could see nothing".
CREATE TABLE grid_examinations (
  id                  TEXT PRIMARY KEY,
  started_at          INTEGER NOT NULL,
  finished_at         INTEGER,
  properties_expected INTEGER NOT NULL,
  properties_examined INTEGER NOT NULL,
  observations        INTEGER NOT NULL DEFAULT 0,
  dispatched          INTEGER NOT NULL DEFAULT 0,
  needs_her           INTEGER NOT NULL DEFAULT 0,
  -- ok      — every non-excluded property was reached.
  -- partial — some repo could not be read. NOT a success: a repo that cannot be read is how a
  --           property drops off a watchlist without anybody deciding it should.
  -- failed  — the run could not do its job at all.
  outcome             TEXT NOT NULL CHECK (outcome IN ('ok','partial','failed')),
  note                TEXT,
  created_at          INTEGER NOT NULL
);
CREATE INDEX idx_grid_exam_recent ON grid_examinations(started_at DESC);

-- ─── What it found ──────────────────────────────────────────────────────────
CREATE TABLE grid_observations (
  id             TEXT PRIMARY KEY,
  examination_id TEXT NOT NULL REFERENCES grid_examinations(id) ON DELETE CASCADE,

  -- The grid property, by its key in `src/shared/boss/grid.mjs`. THE ENDPOINT REFUSES A KEY THAT
  -- FILE DOES NOT DECLARE, so this column is a reference to the grid and never a second copy of it
  -- — the same construction `owned_deliverables.project_key` uses against `projects.ts`.
  property_key   TEXT NOT NULL,
  repo           TEXT NOT NULL,

  -- What was seen. A closed list, because an open one becomes a free-text field with extra steps.
  kind           TEXT NOT NULL CHECK (kind IN
                   ('ci_red','pr_stale','no_release','schedule_stopped','unreachable','audit_unactioned')),

  -- ─── THE FIELD THIS WHOLE MIGRATION IS ABOUT ─────────────────────────────
  -- dispatch  — an employee or a script can do it. It never reaches her contract.
  -- needs_her — her judgement, her name, her signature or her voice, and nothing else qualifies.
  disposition    TEXT NOT NULL CHECK (disposition IN ('dispatch','needs_her')),

  -- WHY ONLY SHE CAN DO IT. Required in practice for a `needs_her` row: the endpoint refuses one
  -- without it and the contract refuses to render one. Nullable only because a `dispatch` row has
  -- no such reason and inventing a default would be inventing the reason — the same argument
  -- `needs_owner_why` makes for itself in 0233.
  needs_her_why  TEXT,

  headline       TEXT NOT NULL,
  -- THE THING SHE CAN OPEN. A run URL, a PR URL, a commit. An observation she cannot check is an
  -- assertion, and `a-contact-line-has-a-source` already settles what this repository does with
  -- assertions that cannot name where they came from.
  evidence       TEXT NOT NULL,
  observed_at    INTEGER NOT NULL,

  -- open       — found, not yet acted on.
  -- dispatched — a task exists for it. Only a `dispatch` row reaches this.
  -- shown      — it was today's one human touch.
  -- resolved   — a later examination did not find it again.
  state          TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','dispatched','shown','resolved')),
  task_id        TEXT REFERENCES tasks(id),
  shown_at       INTEGER,
  resolved_at    INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_grid_obs_open ON grid_observations(disposition, state, observed_at);
CREATE INDEX idx_grid_obs_property ON grid_observations(property_key, kind, state);

-- ─── THE CAP, AS A PRIMARY KEY ──────────────────────────────────────────────
--
--   "no more than 1 per day"
--
-- 0233 made the cap `LIMIT 1`, which caps a QUERY and not a DAY. Reload the page and the query runs
-- again; with more than one candidate open it would hand her a different item each time, and "one
-- per day" would be true of no day at all.
--
-- SO THE DAY IS THE PRIMARY KEY. SQLite cannot hold two rows for one day, so two concurrent renders
-- converge on whichever inserted first and every later render reads the same one back. The cap is
-- not enforced by the query, by the caller or by a comment — it is the shape of the table, which is
-- the only kind of cap that survives a refactor.
--
-- THE DAY IS IN HER TIMEZONE, as text, `YYYY-MM-DD` America/Chicago. A UTC day would roll over at
-- seven in the evening and give her a second touch before dinner.
CREATE TABLE human_touch_days (
  day        TEXT PRIMARY KEY,
  -- Where the day's item came from, so the record says which mechanism spoke.
  -- declared  — `owned_deliverables.needs_owner`, set by hand. Still supported, still first.
  -- examined  — a `needs_her` observation from the grid examination.
  -- asked     — an employee's judgement call that has been waiting for her.
  source     TEXT NOT NULL CHECK (source IN ('declared','examined','asked')),
  ref_id     TEXT NOT NULL,
  chosen_at  INTEGER NOT NULL
);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('grid_examinations', 'ops', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'A record that the grid examination ran: when, how many properties it expected, how many it reached, and what it found. Counts and a timestamp. Nothing personal and nothing about a counterparty.'),
  ('grid_observations', 'ops', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'What the read-only examination saw in her own public repositories: a red workflow, an ageing pull request, a lane that stopped shipping, with the URL it was read from. Her own properties and her own GitHub account.'),
  ('human_touch_days', 'ops', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Which single item was put in front of her on a given day, by id. One row per day, which is how the one-a-day cap is enforced. Two ids and a timestamp.')
ON CONFLICT(entity) DO NOTHING;

-- ─── Danielle's daily examination ───────────────────────────────────────────
--
-- DANIELLE, NOT MONIQUE, and the seam is the one 0236 draws across the whole roster: looking at
-- repositories, workflows and pull requests is Technical Program Management. Monique knows people.
--
-- DAILY AT 06:20, ahead of the 06:45 sourcing sweep and well ahead of anything she reads. The slot
-- reads what the examination found; an examination that ran after the contract was built would put
-- yesterday's news in front of her every morning.
--
-- `local_job`, because it shells out to `gh` against a dozen repositories. None of that fits a
-- Worker invocation. Wrapped in `duty-run.sh grid-watch.mjs` so the run RECORDS ITSELF against this
-- row — "I DONT CARE IF ITS LAUNCHD OR D1 — THOSE SHOULD BE LINKED ANYWAY" — and
-- `validate:launchd-duty-link` proves the token here and the token in the installer are the same
-- string, in both directions, offline.
--
-- COST: $0. It calls no model. `gh` carries her own auth and no token is read, stored or passed.
--
-- AND IT IS READ-ONLY. It opens no branch, no PR and no commit in any grid repo. Her standing rule
-- is one agent per repo; a job that reached into twelve repositories and edited them would violate
-- it twelve times at once. It observes, and fixes are dispatched as work through Boss OS.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_grid_watch',
   'What is actually going on across the grid, and which single thing needs you',
   'emp_repo', 'ops',
   6, 20, 'America/Chicago', 'daily', NULL,
   0,
   'local_job', 'ops',
   'What is actually going on across the grid, and which single thing needs you',
   json_object(
     'local_job', 'grid-watch.mjs',
     -- NO 'model' KEY, AND THAT IS THE HONEST ABSENCE. Every judgement here is a comparison of
     -- timestamps and workflow conclusions read from the GitHub API. `validate:duty-delivery` fails
     -- a duty that NAMES a model its script never calls, and it is right to: a named model is a
     -- spend nobody makes and a capability nobody has.
     'why_local',
     'Reads the GitHub Actions, pull request and release history of every non-excluded grid repository through `gh`, which carries her own authentication on her own Mac. Neither the request volume nor her gh credential exists inside a Worker.',
     'never',
     'Opens no branch, no pull request and no commit in any grid repository, and never touches a west-peek repo. It observes; fixes are dispatched as work through Boss OS and picked up by whoever owns that repo.'
   ),
   'Every non-excluded grid property is reached, and the run says how many it expected against how many it read — a run that examined zero properties is a FAILURE, never a quiet day. Everything a script or an employee could do is dispatched and never shown to her. At most one item is marked `needs_her`, it names what only she can do, and it carries the URL she can open to check it. Most days that count is zero, and zero is the correct and common answer.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0235_boss_the_side_hustle_slot_goes_and_looks');
