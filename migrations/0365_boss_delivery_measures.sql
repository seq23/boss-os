-- DRIFT PREVENTION (owner, 13 Nov 2026): every floor check keeps what it measured, so a slow slide
-- shows before a floor is missed. Additive only: two new tables, one new duty row.
--
-- delivery_measures   one row per checked run: what was counted, whether it passed, which route ran it.
-- quality_reads       the monthly read: one real output per deliverable beside its best example,
--                     judged on substance by her Claude seat (Codex as the backup, never a free route).
CREATE TABLE IF NOT EXISTS delivery_measures (
  id          TEXT PRIMARY KEY,
  at          INTEGER NOT NULL,
  deliverable TEXT NOT NULL,
  task_id     TEXT,
  run_id      TEXT,
  -- The route that did the work (a seat or a free tier's backend id): a place, never a model's name.
  route       TEXT,
  pass        INTEGER NOT NULL,
  misses      TEXT NOT NULL DEFAULT '[]',
  measured    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_delivery_measures_kind ON delivery_measures(deliverable, at DESC);

CREATE TABLE IF NOT EXISTS quality_reads (
  id          TEXT PRIMARY KEY,
  at          INTEGER NOT NULL,
  deliverable TEXT NOT NULL,
  -- holds | slipped
  verdict     TEXT NOT NULL,
  why         TEXT NOT NULL,
  task_id     TEXT,
  run_id      TEXT,
  route       TEXT
);
CREATE INDEX IF NOT EXISTS idx_quality_reads_at ON quality_reads(at DESC);

-- The monthly read. Its prompt is composed when the task is made (duties/drift.ts), from the newest
-- real output and the best measured one; the words here are only the fallback the row must carry.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, task_kind, task_title, task_input, success_criteria) VALUES
  ('duty_quality_read', 'Monthly quality read', 'emp_continuity', 'ops',
   9, 0, 'America/Chicago', 'monthly', 1,
   0, 'review', 'Monthly quality read',
   json_object(
     'backend_id', 'bk_claude_code',
     'backend_ladder', json_array('bk_claude_code', 'bk_codex'),
     'delivers', 'quality_reads',
     'spec_module', 'quality_read',
     'requested', json_object(
       'repo_path', '/Users/sequoiataylor/.boss-os/quality',
       'allowed_paths', json_array('/Users/sequoiataylor/.boss-os/quality'),
       'web_tools', json_array(),
       'max_seconds', 1200,
       -- The same seat setting the sourcing sweep carries (0275); Codex's seat uses its own default.
       'model', 'claude-sonnet-5',
       'model_by_backend', json_object('bk_claude_code', 'claude-sonnet-5', 'bk_codex', NULL)
     ),
     'prompt', 'Read one real output of each deliverable beside its best example and judge it on substance.'
   ),
   'One read per deliverable that has output on record: holds or slipped, with the reason in a sentence a person can check.');

-- Its output floor, in the form the Schedule map is checked against (0350).
UPDATE standing_duties SET output_metric = 'reads delivered', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_quality_read';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0365_boss_delivery_measures');
