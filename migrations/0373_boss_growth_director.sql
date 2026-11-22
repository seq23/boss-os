-- 0373 · THE GROWTH DIRECTOR IS SEATED (21 Nov 2026; her words: "why canat u build the director or
-- appoint the director tonight? i dont see why u cant just build it all and collect data").
--
-- Noelle, Director of Growth (the name and look follow the roster's casting sheet; she does not pick
-- names). She counts what each growth business earns (the scoreboard, 0372), decides each week what to
-- do more or less of, queues work only through tools that already exist (Open Loops rows for approved
-- pipelines, worked by the agent sessions; judgement calls in Decide for anything new), and reports with her evidence. She never posts, sends,
-- spends, creates an account or deletes anything (src/shared/boss/growth/roster.mjs mayAct).
--
-- 1. The seat (emp_growth).
-- 2. growth_decisions: one row per business per weekly cycle, with its evidence and actions. Counts,
--    roster words and drafts only; no customer, LP or client name exists in any input.
-- 3. duty_growth_director: a Worker job on the hourly tick, Mondays 06:00 Central (after the 05:20
--    scoreboard read). OUTPUT n decisions; every business held is NAMED STOP [HELD_ALL]. Its
--    output_since sits before created_at, so Kendra opens the first-run Open Loops row.
-- 4. The scoreboard duty moves from Kendra to the Director it serves.
--
-- Additive only: one seat, one table, one duty, and the scoreboard duty's owner.

INSERT OR IGNORE INTO employees (id, lane, name, role, charter, autonomy, status, created_at) VALUES
  ('emp_growth', 'ops', 'Noelle', 'Director of Growth',
   'You make money for her growth businesses (Porch & Party, KeepMyProof, ApprovalPrep, Dream Wedding, ' ||
   'A Player Mode, Peace Be Still) on a $0 budget, hands-off for her. Each week: count what each business ' ||
   'earns, decide what to do more or less of, queue the work in each brand''s style, and say what you ' ||
   'decided and why. Own numbers beat internet advice; no tests on noise; never a decision on zeros. You ' ||
   'act only through pipelines she already approved; anything new goes to her as a decision. You never ' ||
   'spend, create an account, post, send or delete.',
   'notify', 'active', unixepoch() * 1000);
UPDATE employees SET department = 'Growth' WHERE id = 'emp_growth' AND (department IS NULL OR department = '');

CREATE TABLE IF NOT EXISTS growth_decisions (
  id          TEXT PRIMARY KEY,
  cycle       TEXT NOT NULL,             -- the Central day the cycle ran (YYYY-MM-DD)
  business    TEXT NOT NULL,             -- the roster key
  label       TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('decided','paused','held: no data','held: no model','held: roster','held: error')),
  decision    TEXT NOT NULL,
  evidence    TEXT NOT NULL DEFAULT '[]', -- JSON list of plain lines
  test        TEXT,                      -- JSON { channel, format, what, number, stop } or NULL
  actions     TEXT NOT NULL DEFAULT '[]', -- JSON: queued / proposal / held / blocked / refused, each with why
  next_check  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_growth_decisions_cycle ON growth_decisions(cycle DESC, business);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('growth_decisions', 'growth', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'The Growth Director''s weekly decisions: per business, the decision, its evidence (counts and roster facts), and what was queued or proposed. No customer, LP or client names.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_growth_director',
   'Growth: decide the week for every business',
   'emp_growth', 'ops',
   6, 0, 'America/Chicago', 'weekly', 1,
   (unixepoch(date('now', 'weekday 1')) + 12 * 3600) * 1000, 'worker', 'ops',
   'Growth: decide the week for every business',
   json_object(
     'worker_job', 'growth',
     'delivers', 'growth_decisions',
     'requested', json_object('model', 'free-route'),
     'sends', 'nothing: Open Loops rows for approved pipelines and at most three Decide cards'
   ),
   'Every active business has a decision written with its evidence, or an honest hold (no data, no model); paused businesses get nothing; every queued draft passed the claims check against its brand''s risk rules.',
   0);

UPDATE standing_duties SET output_metric = 'growth decisions', output_floor = 1, output_runs = 1, output_reason = 'A cycle that decides nothing for any business ends with the named stop HELD_ALL and its counts, never a quiet green.', output_since = unixepoch() * 1000 - 60000 WHERE id = 'duty_growth_director';

UPDATE standing_duties SET employee_id = 'emp_growth' WHERE id = 'duty_growth_scoreboard' AND employee_id = 'emp_continuity';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0373_boss_growth_director');
