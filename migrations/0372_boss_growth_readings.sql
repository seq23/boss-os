-- 0372 · THE GROWTH SCOREBOARD'S READINGS (Growth Director, 21 Nov 2026).
--
-- One row per measure per Central day: the 28-day number a Scorecard reader returned for one of her
-- six growth businesses (src/shared/boss/scorecard/manifest.json `scoreboard`), written by the
-- daily cloud read (scripts/ops/growth-scoreboard.mjs → POST /api/boss/growth/readings).
-- `value` NULL with `unread` "not read: <reason>" when the source failed: never 0.
-- Counts and sums only: no name, address, customer or row of anyone's data.
--
-- Its duty (Kendra's until the Growth Director is seated): the cloud run reports through
-- scripts/ops/duty-run.sh, so a failed or empty run is a failed duty Kendra sees, and output_since
-- before created_at opens its first-run Open Loops row.
--
-- Additive only: one new table, its data_policy row and one duty.
CREATE TABLE IF NOT EXISTS growth_readings (
  day       TEXT NOT NULL,
  measure   TEXT NOT NULL,
  business  TEXT NOT NULL,
  kind      TEXT NOT NULL,
  channel   TEXT NOT NULL,
  language  TEXT NOT NULL,
  value     REAL,
  unread    TEXT,
  at        INTEGER NOT NULL,
  PRIMARY KEY (day, measure)
);
CREATE INDEX IF NOT EXISTS idx_growth_readings_business ON growth_readings(business, day DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('growth_readings', 'growth', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'The growth scoreboard: one 28-day count or dollar total per measure per day for her own businesses (requests, sales, installs, visits). Numbers only; no names, addresses or customer rows.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_growth_scoreboard', 'Growth scoreboard: count every growth business', 'emp_continuity', 'ops',
   5, 20, 'America/Chicago', 'daily', NULL, unixepoch()*1000 + 86400000, 'local_job', 'ops',
   'Growth scoreboard: read every measure and record it',
   json_object('local_job', 'growth-scoreboard.mjs',
     'why_no_model', 'Every measure is a count or a sum from a Scorecard reader; no judgement.',
     'why_cloud', 'GitHub Actions on Boss OS''s own clock (job-growth-scoreboard.yml); the keys are repo secrets.'),
   'Every measure of every growth business recorded for today, each a number or "not read: <reason>"; nothing read at all is a named stop.', 0);
UPDATE standing_duties SET output_metric = 'growth readings', output_floor = 1, output_runs = 2, output_reason = 'At least one growth measure must be read each day; every source failing is a named stop, never a zero.', output_since = unixepoch() * 1000 - 60000 WHERE id = 'duty_growth_scoreboard';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0372_boss_growth_readings');
