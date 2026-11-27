-- The employee charter drives the Team and About views. Keep the short role in
-- the editable team brain in sync by changing only Simone's description cell.
UPDATE employees SET charter = 'Chief of Staff: runs your day and is in charge of everything Boss OS runs'
WHERE id = 'emp_chief';

WITH row_start AS (
  SELECT body_md, instr(body_md, char(10) || '| **Simone** | Chief of Staff | ') AS start
  FROM brains WHERE slug = 'team'
),
description AS (
  SELECT body_md, start + length(char(10) || '| **Simone** | Chief of Staff | ') AS first
  FROM row_start WHERE start > 0
),
cell AS (
  SELECT body_md, first, instr(substr(body_md, first), '|') AS delimiter,
    instr(substr(body_md, first), char(10)) AS newline
  FROM description
),
revised AS (
  SELECT substr(body_md, 1, first - 1) || 'Runs your day and is in charge of everything Boss OS runs '
    || substr(body_md, first + delimiter - 1) AS body_md
  FROM cell WHERE delimiter > 0 AND (newline = 0 OR delimiter < newline)
)
UPDATE brains
SET body_md = (SELECT body_md FROM revised),
    updated_at = unixepoch() * 1000,
    updated_by = 'migration 0384'
WHERE slug = 'team' AND body_md <> (SELECT body_md FROM revised);

INSERT OR IGNORE INTO brain_revisions (id, slug, body_md, changed_at, changed_by, note)
SELECT 'brv_simone_mandate_0384', slug, body_md, updated_at, updated_by, 'Updated Simone''s roster description.'
FROM brains WHERE slug = 'team' AND updated_by = 'migration 0384';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0384_boss_simone_mandate');
