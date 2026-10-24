-- 24 October 2026 — a featured name keeps the casing she wrote it in.
--
-- prospect_name_rules keys on the lower-case name (so "openai" and "OpenAI" are one rule), and that
-- lower-case key was also what the prospect email printed: Monique proposed "openai, anduril,
-- databricks". `display` is the name as she wrote it; existing rows take it from her own words.
ALTER TABLE prospect_name_rules ADD COLUMN display TEXT;
UPDATE prospect_name_rules
   SET display = substr(said, instr(lower(said), name), length(name))
 WHERE display IS NULL AND said IS NOT NULL AND instr(lower(said), name) > 0;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0301_boss_prospect_name_display');
