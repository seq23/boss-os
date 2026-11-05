-- A MODEL LIST FOR EACH JOB (owner approved, 4 Nov 2026) + her current time zone.
--
-- Until now a model was allowed by task KIND only (models.approved_task_kinds / forbidden_task_kinds),
-- so very different jobs shared one pool: a meeting prep and a one-line classify could land on the same
-- weak model. One row per job narrows that pool. The router applies it as ONE MORE FILTER, after
-- privacy and before kind, risk and budget (router/policy.ts evaluateModel): it may only remove a
-- candidate, never promote one, and every refusal is written into routing_decisions.candidates.
--
-- KEYED BY `job_key`, a name the caller gives the job (RouteRequest.jobKey). Not lane, taskId,
-- employeeId or intakeKind: taskId changes every run; lane and intakeKind are the coarse pools this
-- table exists to split; one employee does several jobs (Simone: the morning email and meeting prep;
-- the chief: coaching and episode summaries). A run without a job key, or with one that has no row,
-- routes exactly as before.
--
--   allowed_model_ids    JSON array of model ids; [] = any model that passes the other rules
--   paid_allowed         0 = never a billed route, whatever the spend lever says
--   min_capability_tier  fast | general | frontier (models.capability_tier at least this)
--   on_no_model          stop = a named stop she sees, never a weaker model's output
--                        skip = the job is skipped for this run, quietly
CREATE TABLE IF NOT EXISTS model_job_policies (
  job_key             TEXT PRIMARY KEY,
  label               TEXT NOT NULL,
  allowed_model_ids   TEXT NOT NULL DEFAULT '[]',
  paid_allowed        INTEGER NOT NULL DEFAULT 1 CHECK (paid_allowed IN (0, 1)),
  min_capability_tier TEXT NOT NULL DEFAULT 'fast' CHECK (min_capability_tier IN ('fast', 'general', 'frontier')),
  on_no_model         TEXT NOT NULL DEFAULT 'stop' CHECK (on_no_model IN ('stop', 'skip')),
  set_by              TEXT NOT NULL DEFAULT 'seed',
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- The defaults (the same values as JOB_POLICY_DEFAULTS in src/shared/boss/router/jobPolicy.mjs, which
-- the Settings screen compares against to label a row "Default"; a test pins the two together).
INSERT OR IGNORE INTO model_job_policies (job_key, label, allowed_model_ids, paid_allowed, min_capability_tier, on_no_model) VALUES
  ('meeting_prep', 'Meeting prep',       '[]', 1, 'general', 'stop'),
  ('lp_reply',     'LP replies',         '[]', 1, 'general', 'stop'),
  ('brand_draft',  'Brand drafts',       '[]', 1, 'general', 'stop'),
  ('owner_email',  'Emails to you',      '[]', 1, 'general', 'stop'),
  ('classify',     'Sorting and labels', '[]', 0, 'fast',    'skip'),
  ('summarise',    'Short summaries',    '[]', 0, 'fast',    'skip');

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('model_job_policies', 'router', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Operating machinery: which models each job may use. Holds no personal content.');

-- Her current time zone (meeting prep shows times in it). Central until her Mac says otherwise.
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('owner_timezone', 'America/Chicago', unixepoch() * 1000);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0337_boss_models_for_each_job');
