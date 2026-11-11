-- A finite cadence can have nobody due; due-but-held sends remain a named stop.
-- Preserve the existing observation window so Kendra can clear the false alarm.
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Sends only the touches the cadence makes due; a day with nobody due sends none, and a due-but-held day is its own named stop.', output_since = COALESCE(output_since, unixepoch() * 1000) WHERE id = 'duty_prospects';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0361_boss_prospects_floor');
