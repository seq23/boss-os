-- Boss OS v20 — Phase 0 foundation schema.
-- Single user. Money is stored as integer micros of USD (1 USD = 1_000_000).
-- Timestamps are integer epoch milliseconds.

-- ─── Core ────────────────────────────────────────────────────────────────────

CREATE TABLE lanes (
  id            TEXT PRIMARY KEY,           -- 'ops' | 'trading'
  name          TEXT NOT NULL,
  accent        TEXT NOT NULL,              -- css token name, e.g. 'lane-ops'
  isolated      INTEGER NOT NULL DEFAULT 0, -- 1 = no cross-lane reads or budget sharing
  created_at    INTEGER NOT NULL
);

CREATE TABLE settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  actor         TEXT NOT NULL,              -- 'boss' | 'system' | employee id
  lane          TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  action        TEXT NOT NULL,
  detail        TEXT                        -- json
);
CREATE INDEX idx_audit_ts ON audit_log(ts DESC);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

-- ─── 1. Approval inbox ───────────────────────────────────────────────────────

CREATE TABLE approvals (
  id            TEXT PRIMARY KEY,
  lane          TEXT NOT NULL REFERENCES lanes(id),
  title         TEXT NOT NULL,
  summary       TEXT,
  kind          TEXT NOT NULL,              -- 'task_output' | 'spend' | 'memory_promotion' | 'trade' | 'manual'
  origin_type   TEXT,                       -- table that raised it
  origin_id     TEXT,
  risk          TEXT NOT NULL DEFAULT 'low',-- 'low' | 'medium' | 'high'
  payload       TEXT,                       -- json: what exactly gets executed on approve
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|deferred|expired
  requested_at  INTEGER NOT NULL,
  expires_at    INTEGER,
  decided_at    INTEGER,
  decided_by    TEXT,
  decision_note TEXT
);
CREATE INDEX idx_approvals_queue ON approvals(status, lane, requested_at DESC);

CREATE TABLE approval_events (
  id            TEXT PRIMARY KEY,
  approval_id   TEXT NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  ts            INTEGER NOT NULL,
  event         TEXT NOT NULL,
  detail        TEXT
);
CREATE INDEX idx_approval_events ON approval_events(approval_id, ts);

-- ─── 2. AI employees ─────────────────────────────────────────────────────────

CREATE TABLE employees (
  id            TEXT PRIMARY KEY,
  lane          TEXT NOT NULL REFERENCES lanes(id),
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  charter       TEXT,                       -- system prompt / standing orders
  route_id      TEXT REFERENCES routes(id),
  autonomy      TEXT NOT NULL DEFAULT 'ask',-- 'ask' | 'notify' | 'auto'
  status        TEXT NOT NULL DEFAULT 'active', -- active|paused|retired
  created_at    INTEGER NOT NULL
);

CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,
  lane          TEXT NOT NULL REFERENCES lanes(id),
  employee_id   TEXT REFERENCES employees(id),
  title         TEXT NOT NULL,
  input         TEXT,                       -- json
  output        TEXT,                       -- json
  status        TEXT NOT NULL DEFAULT 'queued', -- queued|running|awaiting_approval|done|failed|cancelled
  approval_id   TEXT REFERENCES approvals(id),
  cost_micros   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  finished_at   INTEGER,
  error         TEXT
);
CREATE INDEX idx_tasks_board ON tasks(status, lane, created_at DESC);
CREATE INDEX idx_tasks_employee ON tasks(employee_id, created_at DESC);

CREATE TABLE task_events (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  ts            INTEGER NOT NULL,
  event         TEXT NOT NULL,
  detail        TEXT
);
CREATE INDEX idx_task_events ON task_events(task_id, ts);

-- ─── 3. Model router ─────────────────────────────────────────────────────────

CREATE TABLE providers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  base_url      TEXT NOT NULL,
  api_key_var   TEXT NOT NULL,              -- name of the secret, never the secret
  enabled       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE models (
  id            TEXT PRIMARY KEY,
  provider_id   TEXT NOT NULL REFERENCES providers(id),
  slug          TEXT NOT NULL,              -- provider's own model string
  display_name  TEXT NOT NULL,
  in_micros_1k  INTEGER NOT NULL DEFAULT 0, -- USD micros per 1k input tokens
  out_micros_1k INTEGER NOT NULL DEFAULT 0,
  context_tokens INTEGER,
  enabled       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX idx_models_slug ON models(provider_id, slug);

CREATE TABLE routes (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  lane              TEXT NOT NULL REFERENCES lanes(id),
  primary_model_id  TEXT NOT NULL REFERENCES models(id),
  fallback_model_id TEXT REFERENCES models(id),
  max_output_tokens INTEGER NOT NULL DEFAULT 2048,
  temperature       REAL NOT NULL DEFAULT 0.3
);

CREATE TABLE budgets (
  id                TEXT PRIMARY KEY,
  lane              TEXT NOT NULL REFERENCES lanes(id),
  period            TEXT NOT NULL,          -- 'day' | 'month'
  limit_micros      INTEGER NOT NULL,
  spent_micros      INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  hard_stop         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX idx_budget_lane_period ON budgets(lane, period);

CREATE TABLE usage_ledger (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  lane          TEXT NOT NULL,
  route_id      TEXT,
  model_id      TEXT,
  employee_id   TEXT,
  task_id       TEXT,
  in_tokens     INTEGER NOT NULL DEFAULT 0,
  out_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_micros   INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'ok', -- ok|error|blocked_by_budget
  detail        TEXT
);
CREATE INDEX idx_usage_ts ON usage_ledger(ts DESC);
CREATE INDEX idx_usage_lane ON usage_ledger(lane, ts DESC);

-- ─── 4. Memory promotion ─────────────────────────────────────────────────────

CREATE TABLE memory_items (
  id            TEXT PRIMARY KEY,
  lane          TEXT NOT NULL REFERENCES lanes(id),
  tier          TEXT NOT NULL DEFAULT 'capture', -- capture|working|canon
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  source_type   TEXT,
  source_id     TEXT,
  confidence    REAL NOT NULL DEFAULT 0.5,
  hits          INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  promoted_at   INTEGER,
  expires_at    INTEGER
);
CREATE INDEX idx_memory_tier ON memory_items(lane, tier, created_at DESC);

CREATE TABLE promotion_rules (
  id                TEXT PRIMARY KEY,
  lane              TEXT NOT NULL REFERENCES lanes(id),
  name              TEXT NOT NULL,
  from_tier         TEXT NOT NULL,
  to_tier           TEXT NOT NULL,
  condition         TEXT NOT NULL,          -- json: {min_hits, min_confidence, min_age_ms}
  requires_approval INTEGER NOT NULL DEFAULT 1,
  enabled           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE promotion_events (
  id            TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  rule_id       TEXT REFERENCES promotion_rules(id),
  ts            INTEGER NOT NULL,
  from_tier     TEXT NOT NULL,
  to_tier       TEXT NOT NULL,
  approval_id   TEXT REFERENCES approvals(id),
  outcome       TEXT NOT NULL DEFAULT 'proposed' -- proposed|applied|rejected
);

-- ─── 5. Continuity vault ─────────────────────────────────────────────────────

CREATE TABLE vault_entries (
  id            TEXT PRIMARY KEY,
  lane          TEXT NOT NULL REFERENCES lanes(id),
  key           TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- 'canon_doc' | 'export' | 'attachment'
  r2_key        TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  note          TEXT,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_vault_key ON vault_entries(lane, key, created_at);

CREATE TABLE vault_snapshots (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  label         TEXT NOT NULL,
  r2_key        TEXT,
  bytes         INTEGER NOT NULL DEFAULT 0,
  sha256        TEXT,
  table_counts  TEXT,                       -- json
  status        TEXT NOT NULL DEFAULT 'pending' -- pending|complete|failed
);
CREATE INDEX idx_snapshots_ts ON vault_snapshots(ts DESC);

-- ─── 6. Trading lane (isolated) ──────────────────────────────────────────────

CREATE TABLE trading_accounts (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  broker        TEXT NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'paper', -- paper|live
  enabled       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE trading_signals (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  source        TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  direction     TEXT NOT NULL,              -- long|short|flat
  conviction    REAL NOT NULL DEFAULT 0.5,
  rationale     TEXT,
  raw           TEXT,
  status        TEXT NOT NULL DEFAULT 'new' -- new|actioned|ignored|expired
);
CREATE INDEX idx_signals_ts ON trading_signals(ts DESC);

CREATE TABLE trading_orders (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  account_id    TEXT NOT NULL REFERENCES trading_accounts(id),
  signal_id     TEXT REFERENCES trading_signals(id),
  approval_id   TEXT REFERENCES approvals(id),
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL,              -- buy|sell
  qty           REAL NOT NULL,
  order_type    TEXT NOT NULL DEFAULT 'market',
  limit_price   REAL,
  status        TEXT NOT NULL DEFAULT 'draft', -- draft|awaiting_approval|sent|filled|rejected|cancelled
  broker_ref    TEXT,
  filled_qty    REAL NOT NULL DEFAULT 0,
  avg_price     REAL,
  error         TEXT
);
CREATE INDEX idx_orders_status ON trading_orders(status, ts DESC);

CREATE TABLE trading_positions (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL REFERENCES trading_accounts(id),
  symbol            TEXT NOT NULL,
  qty               REAL NOT NULL DEFAULT 0,
  avg_cost          REAL NOT NULL DEFAULT 0,
  realized_micros   INTEGER NOT NULL DEFAULT 0,
  opened_at         INTEGER,
  closed_at         INTEGER
);
CREATE UNIQUE INDEX idx_positions ON trading_positions(account_id, symbol);


-- The chassis answers "what schema is applied" from this table, and /api/health and the
-- policy suite both read it. A migration that runs without recording itself leaves the
-- system reporting a version older than the one it is actually running, so every ported
-- Boss OS migration registers here exactly as the chassis's own do.
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0152_boss_init');
