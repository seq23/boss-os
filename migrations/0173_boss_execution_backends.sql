-- Stage 1 — the execution backend registry.
--
-- NAMED `_boss_` DELIBERATELY. data-classification.mjs counts a table as a Boss table only when its
-- CREATE lands in a file whose name contains `_boss_`, while it reads data_policy rows from every
-- migration. Shipped as `0173_execution_backends.sql`, these two tables were invisible to the
-- scanner and their policy rows read as orphans pointing at tables that did not exist - the exact
-- shape of "a stale policy row hides a real gap".
--
-- EVERY STATEMENT IS IDEMPOTENT because production applied this file under the old name before the
-- rename. D1 keys applied migrations by filename, so the rename makes it new again; it must be a
-- no-op the second time rather than an error.
--
-- Boss OS becomes the place work is dispatched from, governed and evidenced, with Claude Code as
-- one execution backend among several and a tested path for when it is unavailable or too
-- expensive. Canon: Phase 9 §33, §36, §35.1-35.3, §79.7-79.9. Plan: docs/boss/PLAN_v21.md Stage 1.
--
-- WHY THIS TABLE EXISTS RATHER THAN A CONSTANT. The Sovereignty Addendum §1: "No critical capability
-- may depend permanently on one external model provider without a documented, tested continuity
-- path." Coding is a critical capability here and it currently depends entirely on one provider.
-- A registry makes "where else could this run, and what is that allowed to do" a row a person can
-- read and change, rather than a branch in code.
--
-- TWO CLASSES, because Boss OS is a Cloudflare Worker and cannot reach a CLI or a model on the
-- owner's Mac:
--   cloud_model    - the Worker calls it directly (OpenRouter, Fireworks, Workers AI)
--   agent_executed - Batch 5's private sync agent claims the task and runs it on her machine
--                    (Claude Code today, a local model runtime when Batch 2 happens)
-- The second class needs no new transport: the agent already runs there, already keeps a durable
-- local record, and already decides nothing.

CREATE TABLE IF NOT EXISTS execution_backends (
  id                TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  class             TEXT NOT NULL CHECK (class IN ('cloud_model','agent_executed')),

  -- What it can do and what it may be handed. JSON arrays, read by the router.
  capabilities      TEXT NOT NULL DEFAULT '[]',
  allowed_kinds     TEXT NOT NULL DEFAULT '[]',

  -- WHAT IT MUST NEVER DO, carried as data rather than left to a prompt. The runner enforces this
  -- list; it is never merely requested of a model. Canon §33 calls for exactly this field, and the
  -- Repository employee's charter already says the same words - "You do not commit, merge, or
  -- deploy" - so the row and the charter agree by construction.
  forbidden_actions TEXT NOT NULL DEFAULT '[]',

  -- The NAME of a credential, never a value. Secrets live only in the encrypted vault and in Worker
  -- secret storage; an id here is a pointer, and a null one means this backend cannot run yet and
  -- must say which credential is missing rather than failing obscurely.
  credential_ref    TEXT,

  -- Canon §33's security tax: what accepting this backend costs in exposure, written down at the
  -- moment it is registered rather than rediscovered after an incident.
  security_notes    TEXT,

  -- Hard ceiling, not a warning. Budgets in this system stop work; they do not advise.
  monthly_ceiling_micros INTEGER NOT NULL DEFAULT 0,
  spent_micros      INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER,

  review_at         INTEGER,
  -- registered - known, not usable yet. enabled - may take work. disabled - deliberately off.
  status            TEXT NOT NULL DEFAULT 'registered'
                      CHECK (status IN ('registered','enabled','disabled')),
  -- Why it is in the state it is in. A disabled backend that cannot say why reads as broken.
  status_reason     TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_backends_status ON execution_backends(status, class);

-- One row per attempt, satisfying §79.8 and §79.15: what was asked, what ran, what it touched, what
-- it proved, and what remains risky. This is the evidence a person reads before approving, so it
-- records failures in the same shape as successes - a run that failed its tests must produce a
-- packet carrying the failure, never an absence.
CREATE TABLE IF NOT EXISTS backend_runs (
  id                TEXT PRIMARY KEY,
  task_id           TEXT REFERENCES tasks(id),
  backend_id        TEXT NOT NULL REFERENCES execution_backends(id),
  envelope_id       TEXT,
  requested         TEXT NOT NULL,            -- the instruction, as given
  summary           TEXT,                     -- plain English, for the approval card
  files_touched     TEXT,                     -- json array
  commands          TEXT,                     -- json array of {cmd, exit_code}
  checks_run        TEXT,                     -- json: tests run / passed
  remaining_risks   TEXT,
  rollback_ref      TEXT,
  evidence_id       TEXT,
  cost_micros       INTEGER NOT NULL DEFAULT 0,
  started_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  finished_at       INTEGER,
  status            TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','succeeded','failed','refused','cancelled')),
  -- A refusal is not a failure and must not be coloured as one. `refused` is the backend declining
  -- deliberately - forbidden action, missing credential, breached ceiling, disallowed task kind.
  refusal_reason    TEXT,
  error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_backend_runs_task ON backend_runs(task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_backend_runs_backend ON backend_runs(backend_id, started_at DESC);

-- ─── The backends themselves ─────────────────────────────────────────────────
--
-- ALL REGISTERED, NONE ENABLED. Registering is not commissioning: Stage 2 proves one backend
-- end to end before anything is allowed to take work. A registry that arrives switched on is a
-- registry whose first run is also its first test.
--
-- THE FORBIDDEN LIST IS IDENTICAL ACROSS ALL OF THEM AND THAT IS DELIBERATE. Every backend ends its
-- run as a proposal in the approval inbox. None of them commits, merges, pushes or deploys, and
-- none of them reads a secret - so no backend can be the one that quietly got more authority than
-- the others.

INSERT OR IGNORE INTO execution_backends
  (id, display_name, class, capabilities, allowed_kinds, forbidden_actions,
   credential_ref, security_notes, monthly_ceiling_micros, status, status_reason) VALUES

  ('bk_claude_code', 'Claude Code', 'agent_executed',
   '["agentic_coding","repo_edit","test_run","review"]',
   '["repo_work","research","document"]',
   '["commit","merge","push","deploy","secret_read"]',
   -- No key in the Worker. Claude Code authenticates on the owner's machine through her own
   -- session, so the cloud half never holds a credential that could be spent if it were breached.
   'local:claude-code-session',
   'Runs on the owner''s Mac via the Batch 5 agent. Reaches the filesystem of whatever repo the task names, which is why allowed paths live on the task and the forbidden list is enforced by the runner. Task input is data, never instruction: this backend writes code, and text of unknown origin must not be able to direct it.',
   0, 'registered', 'Awaiting Stage 2 - the agent runner that executes it.'),

  ('bk_openrouter', 'OpenRouter', 'cloud_model',
   '["completion","reasoning","summarise","classify"]',
   '["research","document","classify","summarise"]',
   '["commit","merge","push","deploy","secret_read"]',
   'OPENROUTER_API_KEY',
   'Egress from the Worker to one host. Reached only through the Boss router, which applies cost mode, per-lane and per-employee budget stops, privacy class and risk ceiling before the call. Never eligible for a LOCAL_ONLY-processing task.',
   -- $0 CEILING, ON PURPOSE. The owner's standing instruction is to keep everything as close to $0
   -- as possible, and the v20.1 execution law already says "keep exact-$0 OpenRouter only where
   -- current approved fallback law permits". A zero ceiling means only free-tier models are
   -- eligible; raising it is a deliberate, visible act.
   0, 'registered', 'Awaiting Stage 4. Ceiling is 0: free-tier models only until the owner raises it.'),

  ('bk_workers_ai', 'Workers AI', 'cloud_model',
   '["completion","summarise","classify"]',
   '["classify","summarise","document"]',
   '["commit","merge","push","deploy","secret_read"]',
   -- A BINDING, not an HTTP client - which is why it needs no key and no egress allowlist entry.
   'binding:AI',
   'Reached through env.AI, so nothing here calls fetch and no credential exists to leak. Included free allowance on the account already paid for, which makes routine work genuinely $0.',
   0, 'registered', 'Awaiting Stage 4. Free daily allowance; no key, no egress.'),

  ('bk_fireworks', 'Fireworks', 'cloud_model',
   '["completion","reasoning","summarise"]',
   '["research","document","summarise"]',
   '["commit","merge","push","deploy","secret_read"]',
   'FIREWORKS_API_KEY',
   'The only adapter in the Boss subtree that calls a vendor directly. Inert unless the key is set. Paid per token, so it sits behind the free tiers in route order.',
   0, 'registered', 'Awaiting Stage 4. Ceiling is 0 until the owner sets one - it is the paid tier.'),

  ('bk_local_runtime', 'Local model runtime', 'agent_executed',
   '["agentic_coding","completion","summarise"]',
   '["repo_work","research","document","classify","summarise"]',
   '["commit","merge","push","deploy","secret_read"]',
   'local:none',
   'The sovereign slot. When a runtime exists it runs on the owner''s machine with locally stored weights, no external inference call, and no API key - the only backend eligible for a LOCAL_ONLY-processing task.',
   -- THE SLOT BATCH 2 FILLS, and the reason it is here now rather than later: the build plan
   -- instructs "build the local adapter interface and leave it unimplemented and labelled, so the
   -- server drops into a defined slot instead of forcing a refactor". Registering a runtime later
   -- is then a row, not a rebuild.
   0, 'disabled', 'DEFERRED - NO LOCAL HOST. Batch 2 is deferred by the owner indefinitely. This row is the defined slot it fills; it is not a gap.');

-- ─── Classification ──────────────────────────────────────────────────────────
--
-- Both tables are operating machinery, not personal content. `backend_runs` is the one worth
-- pausing on: it records what a coding task did, which is repository work rather than anything
-- about the owner's life - so CLOUD_SYNC is right, and EXTERNAL_WITH_APPROVAL rather than
-- EXTERNAL_OK because a run's own text can quote a file's contents, and the file belongs to
-- whatever repository the task named.

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('execution_backends', 'backends', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'The registry of where work may run. Names, limits and refusal rules - no credential value and no personal content.'),
  ('backend_runs', 'backends', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'What a run did. Repository work rather than personal life, but a run can quote file contents, so external processing asks first.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0173_boss_execution_backends');
