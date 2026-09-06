-- Boss OS v20 — Phases 1–5.
-- Phase 0 laid down the six subsystems. This migration adds the tables the
-- canonical plan requires for task intake governance, the model runtime
-- intelligence layer, evidence, restore, and the governed trading lane.
-- Money stays integer USD micros. Timestamps stay epoch milliseconds.

-- ─── Phase 1 · approval execution ────────────────────────────────────────────
-- A decision and its execution are different facts. Recording only the decision
-- is what made Phase 0 a shell, so execution gets its own columns.

ALTER TABLE approvals ADD COLUMN executed_at INTEGER;
ALTER TABLE approvals ADD COLUMN execution_status TEXT;   -- executed|failed|not_applicable|reverted
ALTER TABLE approvals ADD COLUMN execution_detail TEXT;   -- json

-- ─── Phase 2 · task intake + agent governance ────────────────────────────────

CREATE TABLE task_templates (
  id                TEXT PRIMARY KEY,
  lane              TEXT NOT NULL REFERENCES lanes(id),
  name              TEXT NOT NULL,
  intake_kind       TEXT NOT NULL,            -- matches task_intake classification
  owner_employee_id TEXT REFERENCES employees(id),
  inputs            TEXT NOT NULL,            -- json: [{key,label,required}]
  output_contract   TEXT NOT NULL,            -- what a finished run must contain
  approval_rule     TEXT NOT NULL DEFAULT 'always', -- always|never|risk_high
  success_criteria  TEXT NOT NULL,
  prompt            TEXT,                     -- template body, {{key}} placeholders
  enabled           INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_templates_lane ON task_templates(lane, enabled);

-- Every task carries the classification and envelope it was admitted under.
ALTER TABLE tasks ADD COLUMN intake_kind TEXT;             -- one_off|recurring_duty|research|drafting|...
ALTER TABLE tasks ADD COLUMN template_id TEXT REFERENCES task_templates(id);
ALTER TABLE tasks ADD COLUMN envelope_id TEXT;
ALTER TABLE tasks ADD COLUMN execution_assignment TEXT;    -- USER_ONLY|AI_DRAFT|AI_EXECUTE_WITH_APPROVAL|...
ALTER TABLE tasks ADD COLUMN risk TEXT NOT NULL DEFAULT 'low';
ALTER TABLE tasks ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'private'; -- public|internal|private|restricted
ALTER TABLE tasks ADD COLUMN cost_mode TEXT;
ALTER TABLE tasks ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

-- Permission envelope: the authority a single task run is allowed to exercise.
CREATE TABLE permission_envelopes (
  id                        TEXT PRIMARY KEY,
  task_id                   TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  lane                      TEXT NOT NULL REFERENCES lanes(id),
  employee_id               TEXT REFERENCES employees(id),
  execution_assignment      TEXT NOT NULL,
  cost_mode                 TEXT NOT NULL,
  budget_micros             INTEGER NOT NULL DEFAULT 0,
  allowed_models            TEXT,             -- json array of model ids, null = route default
  data_sensitivity          TEXT NOT NULL DEFAULT 'private',
  external_action_allowed   INTEGER NOT NULL DEFAULT 0,
  external_send_allowed     INTEGER NOT NULL DEFAULT 0,
  repo_write_allowed        INTEGER NOT NULL DEFAULT 0,
  provider_mutation_allowed INTEGER NOT NULL DEFAULT 0,
  financial_action_allowed  INTEGER NOT NULL DEFAULT 0,
  approval_required         INTEGER NOT NULL DEFAULT 1,
  evidence_required         INTEGER NOT NULL DEFAULT 1,
  rollback_required         INTEGER NOT NULL DEFAULT 0,
  -- Set only by an approved sensitive-routing card (roadmap MR-4). Lets one
  -- task's restricted content reach a cloud model, once, on the record.
  cloud_for_restricted_allowed INTEGER NOT NULL DEFAULT 0,
  expires_at                INTEGER,
  created_at                INTEGER NOT NULL
);
CREATE INDEX idx_envelope_task ON permission_envelopes(task_id);

-- Evidence packet: what actually happened, in the canonical field order.
CREATE TABLE evidence_packets (
  id                     TEXT PRIMARY KEY,
  task_id                TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  lane                   TEXT NOT NULL,
  ts                     INTEGER NOT NULL,
  execution_assignment   TEXT,
  employee_id            TEXT,
  worker_used            TEXT,                -- 'model_router' | 'system' | 'human'
  model_id               TEXT,
  cost_mode              TEXT,
  estimated_cost_micros  INTEGER NOT NULL DEFAULT 0,
  actual_cost_micros     INTEGER NOT NULL DEFAULT 0,
  inputs_used            TEXT,                -- json
  source_materials       TEXT,                -- json
  actions_taken          TEXT,                -- json
  artifacts_created      TEXT,                -- json
  systems_touched        TEXT,                -- json
  records_changed        TEXT,                -- json
  checks_run             TEXT,                -- json
  risks_remaining        TEXT,                -- json
  unknowns               TEXT,                -- json
  approval_needed        INTEGER NOT NULL DEFAULT 0,
  approval_id            TEXT REFERENCES approvals(id),
  rollback_available     INTEGER NOT NULL DEFAULT 0,
  next_human_action      TEXT,
  final_status           TEXT NOT NULL
);
CREATE INDEX idx_evidence_task ON evidence_packets(task_id, ts DESC);

-- No Agent Sprawl: a new employee needs a recorded assessment that says why an
-- existing employee, template, skill, or duty could not carry the work.
CREATE TABLE agent_need_assessments (
  id                    TEXT PRIMARY KEY,
  ts                    INTEGER NOT NULL,
  request               TEXT NOT NULL,
  lane                  TEXT NOT NULL REFERENCES lanes(id),
  existing_employee_id  TEXT REFERENCES employees(id),
  existing_template_id  TEXT REFERENCES task_templates(id),
  recurring             INTEGER NOT NULL DEFAULT 0,
  distinct_domain       INTEGER NOT NULL DEFAULT 0,
  permission_sensitive  INTEGER NOT NULL DEFAULT 0,
  memory_boundary       INTEGER NOT NULL DEFAULT 0,
  risk_bearing          INTEGER NOT NULL DEFAULT 0,
  outcome               TEXT NOT NULL,        -- use_existing_employee|use_template|new_duty|new_agent_justified
  rationale             TEXT NOT NULL
);
CREATE INDEX idx_need_ts ON agent_need_assessments(ts DESC);

CREATE TABLE agent_proposals (
  id                TEXT PRIMARY KEY,
  ts                INTEGER NOT NULL,
  lane              TEXT NOT NULL REFERENCES lanes(id),
  name              TEXT NOT NULL,
  role              TEXT NOT NULL,
  purpose           TEXT NOT NULL,
  duties            TEXT NOT NULL,            -- json array
  permissions       TEXT NOT NULL,            -- json envelope draft
  memory_boundary   TEXT NOT NULL,
  approval_rules    TEXT NOT NULL,
  model_policy      TEXT NOT NULL,
  cost_limit_micros INTEGER NOT NULL DEFAULT 0,
  success_criteria  TEXT NOT NULL,
  retirement_criteria TEXT NOT NULL,
  assessment_id     TEXT REFERENCES agent_need_assessments(id),
  approval_id       TEXT REFERENCES approvals(id),
  status            TEXT NOT NULL DEFAULT 'proposed', -- proposed|approved|blocked|deferred|withdrawn
  employee_id       TEXT REFERENCES employees(id),
  decided_at        INTEGER,
  block_reason      TEXT
);
CREATE INDEX idx_proposals_status ON agent_proposals(status, ts DESC);

-- Agent lifecycle, per roadmap Phase TI-5.
ALTER TABLE employees ADD COLUMN department TEXT;
ALTER TABLE employees ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active';
  -- proposed|provisional|active|under_review|merged|retired|suspended
ALTER TABLE employees ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE employees ADD COLUMN budget_micros_day INTEGER NOT NULL DEFAULT 0; -- 0 = lane budget only
ALTER TABLE employees ADD COLUMN spent_micros_day INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN spend_window_started_at INTEGER;
ALTER TABLE employees ADD COLUMN review_at INTEGER;
ALTER TABLE employees ADD COLUMN merged_into TEXT REFERENCES employees(id);
ALTER TABLE employees ADD COLUMN proposal_id TEXT REFERENCES agent_proposals(id);

CREATE TABLE employee_reviews (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  ts            INTEGER NOT NULL,
  period_start  INTEGER NOT NULL,
  period_end    INTEGER NOT NULL,
  tasks_run     INTEGER NOT NULL DEFAULT 0,
  tasks_failed  INTEGER NOT NULL DEFAULT 0,
  cost_micros   INTEGER NOT NULL DEFAULT 0,
  approval_rate REAL NOT NULL DEFAULT 0,
  outcome       TEXT NOT NULL,                -- keep|merge|retire|suspend|watch
  note          TEXT
);
CREATE INDEX idx_reviews_employee ON employee_reviews(employee_id, ts DESC);

-- ─── Phase 2 · model runtime intelligence ────────────────────────────────────

ALTER TABLE models ADD COLUMN privacy_class TEXT NOT NULL DEFAULT 'cloud';  -- local|private_cloud|cloud
ALTER TABLE models ADD COLUMN capability_tier TEXT NOT NULL DEFAULT 'general'; -- fast|general|frontier
ALTER TABLE models ADD COLUMN benchmark_status TEXT NOT NULL DEFAULT 'unbenchmarked'; -- unbenchmarked|benchmarked|failed
ALTER TABLE models ADD COLUMN approved_task_kinds TEXT;   -- json array, null = any
ALTER TABLE models ADD COLUMN forbidden_task_kinds TEXT;  -- json array
ALTER TABLE models ADD COLUMN max_risk TEXT NOT NULL DEFAULT 'high'; -- highest task risk this model may carry

-- Workload Placement Matrix: scored workloads produce a routing recommendation.
CREATE TABLE workload_profiles (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  intake_kind       TEXT NOT NULL,
  privacy_score     INTEGER NOT NULL DEFAULT 3, -- 1..5, higher = more private
  cost_score        INTEGER NOT NULL DEFAULT 3, -- higher = more cost sensitive
  latency_score     INTEGER NOT NULL DEFAULT 3, -- higher = more latency sensitive
  offline_score     INTEGER NOT NULL DEFAULT 1,
  capability_score  INTEGER NOT NULL DEFAULT 3, -- higher = needs stronger model
  control_score     INTEGER NOT NULL DEFAULT 3,
  recommendation    TEXT NOT NULL,              -- local|frontier|hybrid|external_backend|human_review|do_not_automate
  note              TEXT
);
CREATE UNIQUE INDEX idx_workload_kind ON workload_profiles(intake_kind);

CREATE TABLE model_benchmarks (
  id              TEXT PRIMARY KEY,
  ts              INTEGER NOT NULL,
  model_id        TEXT NOT NULL REFERENCES models(id),
  workload_id     TEXT NOT NULL REFERENCES workload_profiles(id),
  quality_score   REAL NOT NULL DEFAULT 0,   -- 0..1
  edit_burden     REAL NOT NULL DEFAULT 0,   -- 0..1, share of output the human had to fix
  latency_ms      INTEGER NOT NULL DEFAULT 0,
  cost_micros     INTEGER NOT NULL DEFAULT 0,
  verdict         TEXT NOT NULL,             -- approved|rejected|needs_review
  note            TEXT
);
CREATE INDEX idx_bench_model ON model_benchmarks(model_id, ts DESC);

-- Every routing decision is logged, including the ones that refuse to run.
CREATE TABLE routing_decisions (
  id              TEXT PRIMARY KEY,
  ts              INTEGER NOT NULL,
  lane            TEXT NOT NULL,
  task_id         TEXT,
  employee_id     TEXT,
  intake_kind     TEXT,
  risk            TEXT,
  sensitivity     TEXT,
  cost_mode       TEXT,
  route_id        TEXT,
  chosen_model_id TEXT,
  outcome         TEXT NOT NULL,             -- routed|fallback|blocked_budget|blocked_policy|blocked_no_model|ask_human
  reason          TEXT NOT NULL,
  candidates      TEXT                       -- json: models considered and why each was kept or dropped
);
CREATE INDEX idx_routing_ts ON routing_decisions(ts DESC);
CREATE INDEX idx_routing_task ON routing_decisions(task_id);

-- ─── Phase 3 · memory promotion + continuity ─────────────────────────────────

ALTER TABLE memory_items ADD COLUMN status TEXT NOT NULL DEFAULT 'active'; -- active|archived|rejected
ALTER TABLE memory_items ADD COLUMN rejected_at INTEGER;
ALTER TABLE memory_items ADD COLUMN archived_at INTEGER;
ALTER TABLE memory_items ADD COLUMN last_hit_at INTEGER;

ALTER TABLE promotion_events ADD COLUMN note TEXT;

CREATE TABLE vault_restores (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  source        TEXT NOT NULL,               -- 'upload' | r2 key
  mode          TEXT NOT NULL,               -- verify|merge|replace
  declared_sha  TEXT,
  computed_sha  TEXT,
  snapshot_ts   INTEGER,
  table_counts  TEXT,                        -- json
  applied       TEXT,                        -- json: rows written per table
  status        TEXT NOT NULL,               -- verified|applied|failed
  error         TEXT
);
CREATE INDEX idx_restores_ts ON vault_restores(ts DESC);

-- ─── Phase 4 · trading lane (isolated) ───────────────────────────────────────

CREATE TABLE trading_strategies (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  thesis            TEXT NOT NULL,
  market            TEXT NOT NULL,
  timeframe         TEXT NOT NULL,
  data_sources      TEXT,
  risk_controls     TEXT NOT NULL,
  intake_complete   INTEGER NOT NULL DEFAULT 0,
  backtest_note     TEXT,
  stage             TEXT NOT NULL DEFAULT 'research',
    -- research|backtest|paper|micro_live_1|micro_live_2|small_live|production_candidate|retired
  paper_started_at  INTEGER,
  score             REAL NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active', -- active|retired|cemetery
  retire_reason     TEXT,
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_strategies_stage ON trading_strategies(stage, status);

ALTER TABLE trading_signals ADD COLUMN strategy_id TEXT REFERENCES trading_strategies(id);
ALTER TABLE trading_orders ADD COLUMN strategy_id TEXT REFERENCES trading_strategies(id);
ALTER TABLE trading_orders ADD COLUMN mode TEXT NOT NULL DEFAULT 'paper';   -- paper|live
ALTER TABLE trading_orders ADD COLUMN notional_micros INTEGER NOT NULL DEFAULT 0;
-- Boss OS has no market data feed. A paper fill therefore uses a price the
-- caller supplied and says so, rather than inventing a mark.
ALTER TABLE trading_orders ADD COLUMN ref_price REAL;
ALTER TABLE trading_orders ADD COLUMN cancelled_at INTEGER;
ALTER TABLE trading_orders ADD COLUMN sent_at INTEGER;
ALTER TABLE trading_orders ADD COLUMN filled_at INTEGER;

ALTER TABLE trading_accounts ADD COLUMN capital_micros INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trading_accounts ADD COLUMN cash_micros INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trading_accounts ADD COLUMN stage TEXT NOT NULL DEFAULT 'paper';

CREATE TABLE trading_fills (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  order_id      TEXT NOT NULL REFERENCES trading_orders(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL REFERENCES trading_accounts(id),
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL,
  qty           REAL NOT NULL,
  price         REAL NOT NULL,
  fee_micros    INTEGER NOT NULL DEFAULT 0,
  mode          TEXT NOT NULL,               -- paper|live
  broker_ref    TEXT,
  simulated     INTEGER NOT NULL DEFAULT 1   -- 1 = no real money moved
);
CREATE INDEX idx_fills_order ON trading_fills(order_id);

-- The authority envelope. Live trading cannot switch on without every one of
-- these being explicitly satisfied; the defaults deny.
CREATE TABLE trading_authority (
  id                      TEXT PRIMARY KEY,
  updated_at              INTEGER NOT NULL,
  live_enabled            INTEGER NOT NULL DEFAULT 0,
  max_order_notional_micros INTEGER NOT NULL DEFAULT 0,
  max_daily_loss_micros   INTEGER NOT NULL DEFAULT 0,
  max_open_positions      INTEGER NOT NULL DEFAULT 0,
  allowed_symbols         TEXT,              -- json array, null = none allowed live
  kill_switch             INTEGER NOT NULL DEFAULT 0,
  human_approval_recorded INTEGER NOT NULL DEFAULT 0,
  exchange_security_ok    INTEGER NOT NULL DEFAULT 0,
  withdrawals_disabled    INTEGER NOT NULL DEFAULT 0,
  monitoring_ok           INTEGER NOT NULL DEFAULT 0,
  incident_runbook_ok     INTEGER NOT NULL DEFAULT 0,
  ledger_export_tested    INTEGER NOT NULL DEFAULT 0,
  note                    TEXT
);

CREATE TABLE trading_incidents (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  kind          TEXT NOT NULL,               -- outage|stuck_order|api|risk_breach|flash_move|other
  severity      TEXT NOT NULL DEFAULT 'low', -- low|medium|high|critical
  summary       TEXT NOT NULL,
  detail        TEXT,
  order_id      TEXT REFERENCES trading_orders(id),
  strategy_id   TEXT REFERENCES trading_strategies(id),
  resolved_at   INTEGER,
  resolution    TEXT
);
CREATE INDEX idx_incidents_ts ON trading_incidents(ts DESC);

-- ─── Phase 5 · hardening ─────────────────────────────────────────────────────

-- Queue messages that exhausted their retries land here for triage instead of
-- disappearing. The DLQ consumer writes these rows.
CREATE TABLE dead_letters (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  queue         TEXT NOT NULL,
  task_id       TEXT,
  lane          TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  payload       TEXT,
  error         TEXT,
  status        TEXT NOT NULL DEFAULT 'open', -- open|requeued|dismissed
  resolved_at   INTEGER
);
CREATE INDEX idx_dead_letters ON dead_letters(status, ts DESC);

-- Structured diagnostics that outlive a log tail.
CREATE TABLE system_events (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  level         TEXT NOT NULL,               -- debug|info|warn|error
  scope         TEXT NOT NULL,               -- 'cron' | 'queue' | 'router' | 'http' | ...
  event         TEXT NOT NULL,
  lane          TEXT,
  entity_id     TEXT,
  detail        TEXT,                        -- json
  duration_ms   INTEGER
);
CREATE INDEX idx_system_events ON system_events(ts DESC);
CREATE INDEX idx_system_events_level ON system_events(level, ts DESC);

CREATE TABLE cron_runs (
  id            TEXT PRIMARY KEY,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  status        TEXT NOT NULL DEFAULT 'running', -- running|complete|partial|failed
  steps         TEXT,                        -- json: [{name,status,ms,detail}]
  error         TEXT
);
CREATE INDEX idx_cron_runs ON cron_runs(started_at DESC);


-- The chassis answers "what schema is applied" from this table, and /api/health and the
-- policy suite both read it. A migration that runs without recording itself leaves the
-- system reporting a version older than the one it is actually running, so every ported
-- Boss OS migration registers here exactly as the chassis's own do.
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0154_boss_phase1_5');
