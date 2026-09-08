-- Work that is OWNED, and therefore cannot be quietly dropped.
--
-- ─── Her rule, verbatim ─────────────────────────────────────────────────────
--
-- "she owns this deliverable so she needs to make sure its done and if there is any block she needs
-- to tell me immediately and keep reminding me until its done. she canot drop it. that goes for all
-- employees when i give them something to own."
--
-- That last sentence is what makes this a table rather than a column on the KDP duty. It is a rule
-- about every employee and everything she ever hands one, so it is built once, generally, and the
-- publishing block is instance number one.
--
-- ─── Why a duty was never going to be enough ────────────────────────────────
--
-- A `standing_duty` is a thing that FIRES. It has a cadence, it makes a task, and when the task
-- closes the duty has done its job — whatever happened to the work. That is the right shape for
-- "produce a briefing every morning" and completely the wrong shape for "make sure the books get
-- published", because the second one is not finished until an outcome in the world is true.
--
-- The proof that this distinction is real is `duty_practice_week`, which 0200 fixes. It declared
-- `delivers: 'practice_week'`, no handler existed, no table existed, and it ran every Sunday for
-- eleven weeks spending real money on output that was dropped on the floor. Every signal said it
-- worked: last_run_at advanced, the task closed, an approval was raised. A duty cannot tell you it
-- is achieving nothing, because a duty's success criterion is that it fired.
--
-- AN OWNED DELIVERABLE IS THE OPPOSITE CONSTRUCTION. It is defined by its terminal condition, it
-- is evaluated against the actual records rather than against whether a job ran, and it stays on
-- her screen until that condition is met or she personally kills it. If the mechanism in this file
-- had existed in August, "practice week" would have been a deliverable with a terminal condition of
-- "the week's practice is readable on the Spirit screen", and it would have been shouting on Today
-- since the day it was created.
--
-- ─── The three things that make "cannot be dropped" structural ──────────────
--
-- 1. THE TERMINAL CHECK RUNS IN THE WORKER, AGAINST HER RECORDS. It does not ask the owner, the
--    duty, or the job whether the work is done. `kdp_all_live` counts titles that are not Live.
--    Nothing an employee, a run, or a launchd job says can close a deliverable — only the world
--    changing can.
--
-- 2. SO A BROKEN EXECUTOR MAKES IT LOUDER, NOT QUIETER. This is the failure mode being designed
--    against specifically: if the only thing keeping a commitment alive is the job that is broken,
--    the commitment dies with the job and nobody notices, because a dead thing and a finished thing
--    look the same. Here, a watcher that stops reporting stops advancing `last_activity_at`, which
--    IS the stall condition, which escalates. Silence is evidence.
--
-- 3. THE ESCALATION IS COMPUTED ON READ, ON HER DAILY SURFACE. Not written by a cron that could
--    itself fail, and not filed on a page she has to remember to open. `routes/today.ts` evaluates
--    every open deliverable on every load of Today. An escalation she has to go and find is not an
--    escalation.
--
-- ─── Louder over time, because a two-week block is not a one-day block ──────
--
-- Her instruction is "keep reminding me until its done", and a reminder that says the same thing on
-- day one and day twenty is one she learns to skim. The ladder lives in `today/deliverables.ts` so
-- it is testable arithmetic rather than prose spread through a handler, and it escalates on days
-- blocked: raised today is medium, three days is high, a fortnight is critical and says out loud
-- that the current route is not working.
--
-- ─── What she can do, and what nobody else can ─────────────────────────────
--
-- Only the owner kills a deliverable, and killing one requires a reason. There is deliberately no
-- path by which an employee, a run, or a validator can decide her commitment is no longer worth
-- keeping — that is the whole of "she cannot drop it", enforced by there being no code that does
-- it. A killed row keeps its history and its reason, exactly as a merged employee does.

CREATE TABLE owned_deliverables (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  -- THE PERSON ON THE HOOK. Every escalation names them, because she is handing work to somebody
  -- rather than filing a ticket, and "the KDP thing is stuck" is a worse sentence than "Simone's
  -- publication chase is stuck".
  employee_id         TEXT NOT NULL REFERENCES employees(id),
  lane                TEXT NOT NULL REFERENCES lanes(id),

  -- What DONE means, in language she would recognise as her own instruction. Prose, because the
  -- point is that she can read it and agree with it.
  terminal_condition  TEXT NOT NULL,
  -- The name of the check that evaluates that condition against real records. Every value here must
  -- exist in TERMINAL_CHECKS in `src/worker/boss/today/deliverables.ts`, and
  -- `validate:owned-deliverables` fails the build when one does not — a deliverable whose terminal
  -- check is a typo can never complete and would nag her for ever with no way to satisfy it.
  terminal_check      TEXT NOT NULL,

  -- open    — being worked, nothing in the way.
  -- blocked — something external is stopping it. This is the state that escalates.
  -- done    — the terminal check passed. Written by the Worker, never by a person or a job.
  -- killed  — she stopped it, with a reason. The only way out that is not completion.
  state               TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','blocked','done','killed')),

  -- The duty or job that moves it forward, if there is one. NULLABLE ON PURPOSE: a deliverable with
  -- no executor is a real and honest state — it means she has handed someone something and nothing
  -- automated is helping — and it escalates on the stall rule like anything else.
  duty_id             TEXT,
  -- How she finds out, in words, so the row itself says whether an escalation path exists.
  escalation_path     TEXT NOT NULL,

  blocker             TEXT,
  blocked_since       INTEGER,
  -- The last time anything at all happened. THE STALL DETECTOR READS THIS AND NOTHING ELSE, which
  -- is what makes a dead executor visible rather than restful.
  last_activity_at    INTEGER,
  -- How many days of silence before silence is itself the alarm.
  stall_after_days    INTEGER NOT NULL DEFAULT 7,

  done_at             INTEGER,
  killed_at           INTEGER,
  killed_reason       TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_deliverables_open ON owned_deliverables(state, blocked_since);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('owned_deliverables', 'duties', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Commitments and who owns them: a name, a terminal condition and a blocker in one sentence. Operating machinery, holding no personal content and nothing about a counterparty.')
ON CONFLICT(entity) DO NOTHING;

-- ─── Instance one: the publishing block ──────────────────────────────────────
--
-- BLOCKED FROM BIRTH, WITH THE REAL DATE. `blocked_since` is 1788307200000, which is
-- 2026-09-02T00:00:00Z — when Publish first refused — not today. The first version of this line
-- carried 1756771200000, which is the same date in 2025, and the first thing the ladder ever said
-- was that Simone had been blocked for 371 days. 0203 repaired the live row; the epoch here is
-- correct so a rebuild from migrations does not reintroduce it. Starting the clock at deploy time would reset a block that is already five
-- days old and hand her a fresh-looking medium alert for something that has been stuck since the
-- start of the month. The escalation ladder is only honest if it counts from when the world stopped.
--
-- `last_activity_at` is the 7 September watcher run, which is the last thing that actually happened.
INSERT OR IGNORE INTO owned_deliverables
  (id, name, employee_id, lane, terminal_condition, terminal_check, state, duty_id,
   escalation_path, blocker, blocked_since, last_activity_at, stall_after_days, created_at, updated_at)
VALUES
  ('del_kdp_publication', 'Every authored book published', 'emp_chief', 'ops',
   'Every authored title is Live on Amazon. Not "support replied", not "the flag was cleared" — Live. A support agent saying a block is removed and the Publish button working are different claims, and this case has already produced one confident answer that changed nothing.',
   'kdp_all_live', 'blocked', 'duty_kdp_publication',
   'Named on Today under Critical Alerts every time she opens it, louder the longer it sits, and it does not stop until every title is Live or she kills it with a reason.',
   'A server-side flag on the KDP account. Publish returns "fix the highlighted errors" with nothing highlighted and a hidden alert reading "Account Information Incomplete". All four account sections read complete and three titles published from the same account on 1-2 September. Amazon case #51496198 is the only route to it.',
   1788307200000, 1788790980000, 7, unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0202_boss_owned_deliverables');
