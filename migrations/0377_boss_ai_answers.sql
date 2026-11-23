-- 0377 · THE AI ANSWERS LOOP (her ask, 22 Nov 2026: "build the ai visibility loop"; weekly by her yes).
--
-- Once a week the Mac duty `ai-visibility` (scripts/ops/ai-visibility.sh) reads OpenSEO's weekly run
-- for each of the six selling sites through the openseo Claude plugin (read-only tools only:
-- scripts/ops/ai-visibility-permissions.json) and posts it to POST /api/boss/growth/ai-week. Code
-- recomputes every count from the observations; the Growth scoreboard's `answers` measure per site
-- (manifest `scoreboard`, reader d1) reads `ai_answer_reads`.
--
--   ai_answer_obs    one row per site × OpenSEO week × prompt × engine: mentioned, cited, the rival
--                    and cited-source DOMAINS. Never the AI answer's text, never a person's name.
--   ai_answer_reads  one row per site × week: read, or not read with its NAMED STOP (never 0).
--   ai_misses        one row per site × prompt not cited: its lane (own / claim / earn / contest),
--                    the fix attempts counted, and when it was fixed. search-loop reads the "own"
--                    ones through GET /api/boss/growth/ai-misses (CONTRACT in docs/OPERATIONS.md).
--
-- Additive only: three new tables, their data_policy rows and one duty.
CREATE TABLE IF NOT EXISTS ai_answer_obs (
  site       TEXT NOT NULL,
  week       TEXT NOT NULL,             -- ISO week of OpenSEO's own run date, e.g. 2026-W48
  prompt_id  TEXT NOT NULL,
  engine     TEXT NOT NULL,             -- chatgpt | gemini | google_ai_overview
  prompt     TEXT NOT NULL,
  obs_id     TEXT NOT NULL,             -- OpenSEO's observation id
  run_id     TEXT NOT NULL,
  status     TEXT NOT NULL,             -- answered | no_answer | failed
  mentioned  INTEGER,                   -- NULL unless answered
  cited      INTEGER,
  rivals     TEXT NOT NULL DEFAULT '[]',  -- rival domains mentioned (JSON list)
  sources    TEXT NOT NULL DEFAULT '[]',  -- cited source domains (JSON list)
  at         INTEGER NOT NULL,
  PRIMARY KEY (site, week, prompt_id, engine)
);

CREATE TABLE IF NOT EXISTS ai_answer_reads (
  site        TEXT NOT NULL,
  week        TEXT NOT NULL,
  run_id      TEXT,
  run_at      INTEGER,                  -- OpenSEO's run date (ms); NULL on a not-read week
  status      TEXT NOT NULL,            -- read | not_read
  stop        TEXT,                     -- the NAMED STOP when not read
  loop        INTEGER NOT NULL DEFAULT 0, -- 1 when the site runs the search loop (it reads "own" misses)
  prompts     INTEGER,
  answered    INTEGER,                  -- prompts at least one engine answered
  cited       INTEGER,                  -- prompts where an answer cited our site
  mentioned   INTEGER,                  -- prompts where an answer named us
  engines     TEXT NOT NULL DEFAULT '{}', -- { engine: { answered, mentioned, cited } }
  read_at     INTEGER NOT NULL,
  PRIMARY KEY (site, week)
);
CREATE INDEX IF NOT EXISTS idx_ai_answer_reads_site ON ai_answer_reads(site, run_at DESC);

CREATE TABLE IF NOT EXISTS ai_misses (
  id                TEXT PRIMARY KEY,   -- sha1(host + prompt text): stable across weeks
  site              TEXT NOT NULL,
  prompt_id         TEXT NOT NULL,
  prompt            TEXT NOT NULL,
  lane              TEXT NOT NULL,      -- own | claim | earn | contest
  page_url          TEXT,               -- own: one of this site's engine pages, or NULL (no page fits)
  fit_url           TEXT,               -- own: the best fit when it is NOT an engine page (a Director to-do)
  source_domain     TEXT,               -- claim / earn / contest: the cited source the to-do is about
  channel           TEXT,               -- claim: the roster channel the listing belongs to, or NULL
  engines_missed    TEXT NOT NULL DEFAULT '[]',
  rivals            TEXT NOT NULL DEFAULT '[]',
  cited_sources     TEXT NOT NULL DEFAULT '[]',
  why               TEXT,
  first_missed_week TEXT NOT NULL,
  last_missed_week  TEXT NOT NULL,
  fixed_week        TEXT,               -- the week an answer cited us again (then it is not served)
  fix_attempts      INTEGER NOT NULL DEFAULT 0,
  counted           TEXT NOT NULL DEFAULT '[]', -- the fixes already counted (so a re-read adds none)
  lanes_tried       TEXT NOT NULL DEFAULT '[]',
  todo_key          TEXT,               -- the Open Loops source_key of its Director to-do
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_misses_site ON ai_misses(site, lane, fixed_week);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('ai_answer_obs', 'growth', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'OpenSEO''s weekly public AI answers for her own sites: per prompt and engine, whether we were named or cited, and the rival and source domains. No answer text, no names, no visitor data.'),
  ('ai_answer_reads', 'growth', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'One weekly AI-answers count per site (prompts cited, mentioned, per engine), or not read with its named stop. Numbers only.'),
  ('ai_misses', 'growth', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Her own sites'' buyer questions that AI answers do not cite us for, with the fix lane, our page or the cited source domain. No answer text, no names.')
ON CONFLICT(entity) DO NOTHING;

-- Tuesday 12:00 Central: OpenSEO's six weekly runs start Tuesday 04:00 UTC (22:00 Monday Central)
-- and take minutes; 12:00 is 14 hours later and inside the Mac's LIGHT window (10:00-21:59).
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_ai_visibility', 'AI answers: read the week''s OpenSEO answers for every selling site', 'emp_growth', 'ops',
   12, 0, 'America/Chicago', 'weekly', 2, unixepoch()*1000 + 86400000, 'local_job', 'ops',
   'AI answers: read OpenSEO''s weekly run per site and record it',
   json_object('local_job', 'ai-visibility.sh', 'model', 'claude-opus-5',
     'why_model', 'The OpenSEO plugin exists only on Claude (AI_ROLES ai_visibility.read); the model reads and picks each miss''s lane, code recomputes every count.',
     'why_mac', 'ai-run on her Mac (her ruling 22 Nov 2026: ai-run jobs stay on the Mac).'),
   'Each selling site''s week is recorded as read (counts recomputed by code) or not read with its named stop; no site read at all is a named stop.', 0);
UPDATE standing_duties SET output_metric = 'sites_read', output_floor = 1, output_runs = 2, output_reason = 'At least one site''s OpenSEO week must be read each week; nothing read is a named stop, never a zero.', output_since = unixepoch() * 1000 - 60000 WHERE id = 'duty_ai_visibility';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0377_boss_ai_answers');
