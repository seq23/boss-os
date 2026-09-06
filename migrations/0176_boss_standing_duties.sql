-- Standing duties, and the Executive Intelligence Report's home.
--
-- PLAN_v21 Stage 5, and the half of Stage 6 the owner asked for first. Until now `tasks` had no
-- cadence and nothing recurred on its own - which is also why the monthly capability scan rides the
-- daily cron as a deliberate no-op on thirty days out of thirty-one.
--
-- TWO TABLES, NOT FOUR. Phase 10's spec lists `assignments`, `standing_duties`, `skill_packs` and
-- `skill_admissions`. The owner's instruction was "dont overengineer this", and a duty needs none of
-- the other three to run: an assignment is the duty's owner column, and skill packs are a capability
-- question nothing here asks yet. They can arrive when something needs them.

CREATE TABLE standing_duties (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  -- The employee who owns it. A duty with no owner is work nobody is accountable for.
  employee_id       TEXT NOT NULL REFERENCES employees(id),
  lane              TEXT NOT NULL REFERENCES lanes(id),

  -- WALL-CLOCK TIME PLUS A ZONE, NEVER A UTC HOUR.
  --
  -- The owner asked for 7am CT. That is 12:00 UTC in summer and 13:00 in winter, so a fixed UTC
  -- hour would silently deliver at 6am for five months of the year and nobody would file a bug -
  -- they would just find the report already stale when they opened it. The zone is stored and the
  -- next occurrence is computed from it, so daylight saving is arithmetic rather than a surprise.
  local_hour        INTEGER NOT NULL CHECK (local_hour BETWEEN 0 AND 23),
  local_minute      INTEGER NOT NULL DEFAULT 0 CHECK (local_minute BETWEEN 0 AND 59),
  timezone          TEXT NOT NULL,
  cadence           TEXT NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily','weekly','monthly')),
  -- 0=Sunday. Only read for weekly.
  weekday           INTEGER CHECK (weekday BETWEEN 0 AND 6),

  -- The next moment this is due, in epoch ms UTC. Recomputed after every materialisation, so the
  -- cron's question is a comparison rather than a calendar calculation on every tick.
  next_due_at       INTEGER NOT NULL,
  last_run_at       INTEGER,
  -- The task the last materialisation produced, so a duty that fired can be traced to what it made.
  last_task_id      TEXT,

  -- What the duty hands its employee. A kind the intake classifier already knows, plus the brief.
  task_kind         TEXT NOT NULL,
  task_title        TEXT NOT NULL,
  task_input        TEXT,

  -- What "it worked" means for this duty, in words. A recurring job with no success criterion is one
  -- nobody can tell has been quietly failing.
  success_criteria  TEXT NOT NULL,

  -- Suspended is not deleted. A duty the owner turns off keeps its history and its next_due_at.
  suspended         INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_duties_due ON standing_duties(suspended, next_due_at);

-- ─── The report ──────────────────────────────────────────────────────────────
--
-- WHY A TABLE AND NOT A JSON BLOB ON THE TASK. Today's Executive Briefing block renders this on
-- every page load, and the owner's own rule is that a report which cannot verify something must
-- "say so and name the gap". Gaps that must be counted, rendered and compared against yesterday are
-- structure, not prose. Digging them out of an evidence blob on every read would also mean the
-- block's honesty depended on a JSON shape nothing validates.

CREATE TABLE executive_reports (
  id                TEXT PRIMARY KEY,
  -- The day it is FOR, not the day it was written. A report generated at 06:30 for the 6th belongs
  -- to the 6th even if a retry writes it at 09:00.
  day_id            TEXT NOT NULL,
  generated_at      INTEGER NOT NULL,
  -- The run that produced it, so every figure traces to the research that found it.
  task_id           TEXT,
  backend_run_id    TEXT,

  -- complete  - every section produced.
  -- partial   - shipped with named gaps. THE OWNER'S EXPLICIT INSTRUCTION: "on failure just say so
  --             and name the gaps". A report that refuses to appear teaches her to stop looking at
  --             7am; one that names what is missing keeps the habit and is honest.
  -- failed    - nothing usable was produced. Still a row, so the block can say when the last good
  --             one was rather than rendering an unexplained blank.
  status            TEXT NOT NULL CHECK (status IN ('complete','partial','failed')),

  summary           TEXT,
  sections          TEXT NOT NULL DEFAULT '[]',
  -- Every fact that could not be verified, with what was wanted and why it is missing.
  gaps              TEXT NOT NULL DEFAULT '[]',
  -- Named sources with retrieval times. "Current data must be current" is only checkable if the
  -- report says when it read each thing.
  sources           TEXT NOT NULL DEFAULT '[]',
  -- Where today's reading contradicts yesterday's report. Her spec requires prior misinformation be
  -- corrected automatically, which means the reports are a chain rather than disposable documents.
  corrections       TEXT NOT NULL DEFAULT '[]'
);

CREATE UNIQUE INDEX idx_report_day ON executive_reports(day_id);
CREATE INDEX idx_report_generated ON executive_reports(generated_at DESC);

-- ─── Camille's duty ──────────────────────────────────────────────────────────
--
-- 06:30 America/Chicago, not 07:00: research takes minutes, and the owner asked for the report to
-- BE THERE at 7am rather than to start then. Opening Today and watching it think is the failure
-- this half-hour prevents.
--
-- next_due_at is seeded to 0 so the first cron tick after deploy materialises it immediately rather
-- than waiting for tomorrow. The duty's own recompute takes over from there.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence,
   next_due_at, task_kind, task_title, task_input, success_criteria) VALUES
  ('duty_exec_intel', 'Executive Intelligence Report', 'emp_research', 'ops',
   6, 30, 'America/Chicago', 'daily',
   0, 'research', 'Executive Intelligence Report',
   '{"spec":"docs/boss/EXECUTIVE_INTELLIGENCE.md","delivers":"executive_reports"}',
   'A report exists for today by 07:00 America/Chicago, every figure carries a named source and the time it was read, and anything unverified is listed as a gap rather than omitted.');

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('standing_duties', 'duties', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Recurring work: what runs, who owns it, when. Operating machinery holding no personal content.'),
  ('executive_reports', 'duties', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'Public market and news intelligence, not personal life. External processing asks first because a report quotes sources and can carry whatever the day''s research picked up.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0176_boss_standing_duties');
