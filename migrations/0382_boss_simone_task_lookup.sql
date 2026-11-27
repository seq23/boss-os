CREATE INDEX IF NOT EXISTS boss_simone_task_lookup ON tasks(employee_id, status, created_at, id)
  WHERE CASE WHEN json_valid(input) THEN json_extract(input, '$.agent') END = 'simone';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0382_boss_simone_task_lookup');
