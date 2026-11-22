-- 0372 · THE GROWTH SCOREBOARD'S READINGS (Growth Director, 21 Nov 2026).
--
-- One row per measure per Central day: the 28-day number a Scorecard reader returned for one of her
-- six growth businesses (src/shared/boss/scorecard/manifest.json `scoreboard`), written by the
-- daily cloud read (scripts/ops/growth-scoreboard.mjs → POST /api/boss/growth/readings).
-- `value` NULL with `unread` "not read: <reason>" when the source failed: never 0.
-- Counts and sums only: no name, address, customer or row of anyone's data.
--
-- Additive only: one new table and its data_policy row.
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

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0372_boss_growth_readings');
