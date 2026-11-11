-- Research is conditional: it runs only below 20 waiting + queued groups.
-- The approved investigation read 0 waiting + 29 queued on 11 Nov 2026;
-- 9-11 Nov runs printed OUTPUT 0 groups researched while correctly skipping research.
-- Measure the pipeline instead, retaining a floor that catches an empty pipeline.
-- Reset the observation window because the old research counts are not this metric.
UPDATE standing_duties SET output_metric = 'groups ready to write to', output_floor = 1, output_runs = 3, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_t2r_groups';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0361_boss_t2r_groups_floor_is_the_pipeline');
