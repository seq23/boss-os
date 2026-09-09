-- Simone owns KDP itself, not one case inside it. And she can hand work to a colleague.
--
-- ─── Her words ─────────────────────────────────────────────────────────────
--
--   "u need to make sure simone has a dedicated task for handling anything related to KDP so she
--    needs to check for any KDP emails and read them and determine if she needs to take action. if
--    the company sends marketing and promo emails she just notes it and moves on. if there are
--    updates she needs to know about she needs to notate them. if something is wrong w/one of my
--    titles she needs to spring into action and can assign help from another employee as needed. i
--    prefer to be handsoff"
--
-- ─── What changes, and it is a change of shape ─────────────────────────────
--
-- `duty_kdp_publication` chases ONE account block to resolution. It is a good duty and it ends: the
-- day the seven books are Live it has nothing left to do. What she is describing is permanent —
-- Simone owns the KDP surface, and this case is an incident inside that ownership rather than the
-- ownership itself. So the case duty keeps its job and a second, standing duty is added around it.
--
-- ─── Three dispositions, and the distinction is the whole design ───────────
--
-- 1. PROMOTIONAL — noted and dropped. No alert, no Inbox item, no summary line. It is in the log if
--    she ever looks and that is all. GETTING THIS WRONG IN THE NOISY DIRECTION IS HOW SHE STOPS
--    READING THE USEFUL ONES, which is the same failure the escalation ladder was built around.
--
-- 2. AN UPDATE SHE SHOULD KNOW — a policy change, a royalty or term change, anything altering how
--    her titles behave. NOTATED, which is her word and implies a record she can read back rather
--    than a notification that fires once and is gone. It surfaces when it is consequential, not
--    every time.
--
-- 3. SOMETHING WRONG WITH A TITLE — a takedown, a content flag, a review, a quality notice, a title
--    gone unavailable. SIMONE ACTS. Hands-off means she does not wait to be asked.
--
-- ─── Hands-off, stated as a rule the code enforces ─────────────────────────
--
-- She hears from Simone in exactly two situations: something is wrong that needs her judgement or
-- her hands, or something completed. Never "I checked the mail today". A run that found only
-- promotional mail produces SILENCE — the endpoint below refuses to raise anything for it, so that
-- is a property of the mechanism rather than an instruction in a prompt.

CREATE TABLE kdp_mail_log (
  id            TEXT PRIMARY KEY,
  seen_at       INTEGER NOT NULL,
  -- promo    — noted and dropped. Never surfaces anywhere.
  -- update   — notated. Readable on the Publishing screen, surfaced when consequential.
  -- problem  — something is wrong with a title. Simone acts.
  disposition   TEXT NOT NULL CHECK (disposition IN ('promo','update','problem')),
  -- One or two sentences in the run's own words. NEVER a quotation and never an address: the
  -- endpoint refuses anything containing an '@', exactly as the case determination does.
  note          TEXT NOT NULL,
  -- The opaque Amazon reference, when the mail is about one title. No name, no manuscript.
  title_ref     TEXT,
  -- What Simone did about it, in her own words. NULL for promo, which is the point of promo.
  action_taken  TEXT,
  -- Whether this one needs the owner. Only a `problem` may set it, and the endpoint enforces that.
  needs_owner   INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'launchd',
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_kdp_mail_recent ON kdp_mail_log(seen_at DESC);
CREATE INDEX idx_kdp_mail_kind ON kdp_mail_log(disposition, seen_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('kdp_mail_log', 'ops', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'What Amazon sent about her books and what Simone decided about it, in her own words. The mail itself is read inside a local run on her Mac and never posted; what crosses is a disposition, a sentence and an opaque title reference. External processing asks first because a note is prose, and prose is where a quotation would hide if the rule against quoting were broken.')
ON CONFLICT(entity) DO NOTHING;

-- ─── An employee handing work to a colleague ────────────────────────────────
--
-- "she can assign help from another employee as needed."
--
-- THIS IS NEW AND IT IS EASY TO GET WRONG IN ONE SPECIFIC WAY: delegation becoming a way for work
-- to disappear into somebody else's queue. Three rules stop that, and each is enforced rather than
-- described.
--
-- 1. THE DELEGATOR STAYS ACCOUNTABLE. `owner_employee_id` is who she handed it to originally and it
--    never changes; `helper_employee_id` is who is doing this piece. The completion report and any
--    escalation still come from the owner. Handing something over is not handing it off.
--
-- 2. THE DELEGATED PIECE IS OWNED WORK. It carries the rules already agreed — blocks escalate,
--    completions report, nothing is dropped — because `today/deliverables.ts` surfaces an
--    unfinished assignment under the OWNER's name, so a stalled helper makes the owner louder.
--
-- 3. IT CANNOT BE MARKED DONE BY THE HELPER SAYING SO. `completed_at` is set by the owner's run
--    reporting the outcome, and `outcome` has to say what actually happened.
--
-- NO NINTH EMPLOYEE, AND THE SEATS THAT GET USED ARE THE ONES STANDING EMPTY. Zora — Archivist,
-- Records — is the natural home for a cover or content problem and has had no standing duty since
-- the roster was written. Toni has the credentials as of this morning and takes compliance and risk.
-- Camille takes anything touching search or category performance, which is already her lane.
CREATE TABLE work_assignments (
  id             TEXT PRIMARY KEY,
  -- Who owns the outcome. Never reassigned: this is the whole of "delegating is not transferring".
  owner_employee_id  TEXT NOT NULL REFERENCES employees(id),
  helper_employee_id TEXT NOT NULL REFERENCES employees(id),
  -- The owned deliverable this belongs to, so one register escalates and one screen shows it.
  deliverable_id TEXT,
  what           TEXT NOT NULL,
  why            TEXT NOT NULL,
  -- open | done | dropped. `dropped` needs a reason, exactly as a killed deliverable does.
  state          TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','done','dropped')),
  outcome        TEXT,
  assigned_at    INTEGER NOT NULL,
  completed_at   INTEGER,
  -- How long before an unfinished assignment is loud. Shorter than a deliverable's stall window:
  -- a colleague sitting on a piece of somebody else's commitment is the failure mode here.
  stale_after_days INTEGER NOT NULL DEFAULT 3,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_assignment_open ON work_assignments(state, assigned_at);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('work_assignments', 'duties', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'One employee handing a piece of work to another, and who remains accountable for it. Operating machinery: two seat ids, a sentence about the work and a state.')
ON CONFLICT(entity) DO NOTHING;

-- ─── Simone's standing KDP duty ─────────────────────────────────────────────
--
-- DAILY, WHICH IS DIFFERENT FROM THE CASE WATCH'S MON/WED/FRI AND DELIBERATELY SO. The case watch
-- chases a support thread that answers on weekdays; this is triage of anything Amazon sends, and a
-- title taken down on a Saturday should not wait until Monday to be noticed.
--
-- 09:30, seven minutes after the case watch, so on Mon/Wed/Fri the two do not race for the same
-- Gmail session and the case run's determination is already filed when this looks.
--
-- HAIKU, NAMED. Deciding whether a message is promotional, an update or a problem is classification,
-- not judgement. `claude -p` with no --model runs the most expensive one available — the defect that
-- made one briefing cost $3.88 — and `validate:duty-delivery` fails the build if this string and the
-- shell script's ever disagree.
--
-- ~$0.02 a run, daily, ≈ $0.60 a month.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday, weekdays,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria) VALUES
  ('duty_kdp_surface', 'Kindle — read everything Amazon sends and decide what it means', 'emp_chief', 'ops',
   9, 30, 'America/Chicago', 'daily', NULL, NULL,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops', 'Kindle — read everything Amazon sends and decide what it means',
   json_object(
     'local_job', 'kdp-surface.sh',
     'requested', json_object(
       'model', 'claude-haiku-4-5-20251001',
       'max_seconds', 600
     ),
     'why_local',
     'Reading her Amazon mail needs her mailbox, and the Claude Code runner strips every credential from an agent on purpose. This runs from launchd on her Mac; the mail stays there and only a disposition and a sentence are posted back.',
     'prompt_file', 'scripts/ops/kdp-surface-prompt.md'
   ),
   'Anything Amazon sends about her books is read within a day and put in one of three buckets. Promotional mail produces silence. An update is notated where she can read it back. A problem with a title gets acted on without her being asked first, and she hears from Simone only when something needs her judgement or something completed.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0215_boss_simone_owns_the_kdp_surface');
