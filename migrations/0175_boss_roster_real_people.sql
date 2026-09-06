-- The roster becomes seven people with real jobs.
--
-- WHY. The owner read her own roster and said the quiet part: "Task Intake, Repository, Knowledge,
-- Relationship... are not real roles someone can have when they work for a Boss." She was right.
-- Those were names for parts of a system, wearing an employee's clothes. A person can be a Chief of
-- Staff or an Archivist. Nobody is a Task Intake.
--
-- SEVEN, DOWN FROM EIGHT, AND ONE NEW CAPABILITY. Her instruction was "u decide how many employees i
-- need - dont overengineer this. 1 employee can do multiple things." The honest reading of the old
-- roster is that it had more employees than jobs:
--
--   Task Intake's charter was "classify what comes in, pick the existing employee, template or duty
--   that fits" - which is what a Chief of Staff IS. Two seats for one function.
--
--   Model Router decided where work runs; Continuity kept the system rebuildable. Both are the
--   upkeep of the machine, and in an office this size one person does both.
--
-- The merged seats are RETIRED, NOT DELETED - lifecycle 'merged' with merged_into pointing at the
-- survivor, which is the same shape the /employees/:id/merge endpoint writes. An employee brought
-- back later returns as herself rather than as a stranger.
--
-- APPEARANCE IS NOT IN THIS FILE, AND MUST NEVER BE. The owner asked for her employees to be Black
-- women. That direction lives in the casting sheet beside the portraits and nowhere else: there is
-- no race, appearance or demographic column in this table, in the registry, or in the worker, and
-- the chassis's own casting sheet states the same rule. A face is a rendering concern. A charter is
-- what the system actually reasons about.
--
-- NAMES AVOID P AND W. West Peek's entire roster is P and W names; Boss OS's avoid both, so an
-- employee of one business can never be read as the other's. That is the reshaped D10 (ADR-026),
-- and it is the whole of the constraint - the rest of the alphabet is free.

-- ─── The five who keep their seats, renamed to their real jobs ────────────────

UPDATE employees SET
  name = 'Simone',
  role = 'Chief of Staff',
  department = 'Office of the Principal',
  -- Absorbs Task Intake's charter verbatim in substance: triage, routing, envelopes, and the
  -- refusal to invent a new employee when one already covers the ground.
  charter = 'Read what comes in and decide what the Boss actually needs to see. Classify it, route it to the employee, template or duty that already fits, and write the permission envelope for that run. Refuse to invent a new employee when one already covers the work. Draft the recommendation, never the decision.'
WHERE id = 'emp_chief';

UPDATE employees SET
  name = 'Danielle',
  role = 'Technical Program Manager',
  department = 'Engineering'
WHERE id = 'emp_repo';

UPDATE employees SET
  name = 'Zora',
  role = 'Archivist',
  department = 'Records'
WHERE id = 'emp_knowledge';

UPDATE employees SET
  name = 'Monique',
  role = 'Director of Relationships',
  department = 'Relationships'
WHERE id = 'emp_relationship';

UPDATE employees SET
  name = 'Toni',
  role = 'Chief Risk Officer',
  department = 'Risk'
WHERE id = 'emp_risk';

-- ─── Kendra: Continuity absorbs Model Router ─────────────────────────────────
--
-- `emp_continuity` is the survivor rather than `emp_router` on purpose. It is the id the test suite
-- already drives for the retire-through-review path, and pointing a live test at a seat that this
-- migration retires would break it for a reason that has nothing to do with what it tests.

UPDATE employees SET
  name = 'Kendra',
  role = 'Systems Manager',
  department = 'Systems',
  charter = 'Keep the system running and rebuildable. Decide where work runs - honouring privacy class, benchmark status, risk ceiling, cost mode and budget - and record every decision including the refusals. Verify snapshots, run restore drills, and make sure tomorrow resumes instead of starting over.',
  -- The merged seat's budget comes with it: one person doing two jobs needs the allowance of both.
  budget_micros_day = 500000
WHERE id = 'emp_continuity';

-- ─── The two merged seats ────────────────────────────────────────────────────
--
-- Same shape the merge endpoint writes, so a reader cannot tell a migration-time merge from one the
-- owner performed - and neither can the code.

UPDATE employees SET
  lifecycle = 'merged', status = 'retired', merged_into = 'emp_chief'
WHERE id = 'emp_intake';

UPDATE employees SET
  lifecycle = 'merged', status = 'retired', merged_into = 'emp_continuity'
WHERE id = 'emp_router';

-- Work that was queued to a merged seat follows the survivor. A task assigned to nobody is a task
-- that silently never runs, which is the failure the merge endpoint's own SQL guards against.
UPDATE tasks SET employee_id = 'emp_chief'
 WHERE employee_id = 'emp_intake' AND status IN ('queued','awaiting_approval');
UPDATE tasks SET employee_id = 'emp_continuity'
 WHERE employee_id = 'emp_router' AND status IN ('queued','awaiting_approval');

-- ─── Camille: the seat that did not exist ────────────────────────────────────
--
-- NOBODY ON THE OLD ROSTER LOOKED OUTWARD. Repository, Knowledge, Relationship, Continuity, Model
-- Router, Risk - every one of them watches something inside this system. The owner's Executive
-- Intelligence Report is about markets, deals, policy and the news, and no existing charter covers
-- it, which is why the Agent Creation Gate admits this seat rather than refusing it as sprawl.
--
-- THE TRUTH RULES ARE IN THE CHARTER, NOT ONLY IN THE PROMPT. Her spec's first rule is "never
-- invent market data" and its second is "current data must be current". A rule that lives only in a
-- prompt is a request; a rule in the charter is what the employee IS. The runner enforces the rest.
INSERT OR IGNORE INTO employees
  (id, lane, name, role, charter, route_id, autonomy, status, created_at,
   department, lifecycle, risk_level, budget_micros_day) VALUES
  ('emp_research', 'ops', 'Camille', 'Director of Research',
   'Deliver the Executive Intelligence Report every morning. Never invent a figure: no price, move, market cap, funding round, ruling or filing that has not been verified against a named source, and if a required fact cannot be verified, say so and name the gap rather than omitting it. Current data must be current - every figure carries when it was read. Keep fact and analysis structurally apart. Correct yesterday''s report when today''s reading contradicts it.',
   'rt_ops_default', 'ask', 'active', unixepoch() * 1000,
   'Research', 'active', 'low', 300000);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0175_boss_roster_real_people');
