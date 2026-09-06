-- Boss OS v20 — Phase 11: Executive OS Core.
-- Canon §15 Today, §16 cadence, §17 Morning Gate, §16 (15.3) Night Gate.
-- Money stays integer USD micros. Timestamps stay epoch milliseconds.

-- ─── days ──────────────────────────────────────────────────────────────────────
-- One row per calendar day (UTC). The Today screen reads/writes this.
CREATE TABLE days (
  id            TEXT PRIMARY KEY,           -- YYYY-MM-DD in UTC
  date_ts       INTEGER NOT NULL UNIQUE,    -- epoch ms at 00:00 UTC
  created_at    INTEGER NOT NULL,
  -- Morning Gate outputs
  morning_completed_at  INTEGER,
  morning_priorities    TEXT,               -- json: [{text, order}]
  morning_state         TEXT,               -- json: {identity_cue, body_floor, revenue_reality}
  morning_agenda        TEXT,               -- json: the day's computed agenda
  morning_contract      TEXT,               -- json: Today's Contract
  -- Midday Reset outputs
  midday_completed_at   INTEGER,
  midday_checks         TEXT,               -- json: [{text, done, order}]
  midday_adjustments    TEXT,               -- json: what changed
  -- Night Gate outputs
  night_completed_at    INTEGER,
  night_attention       TEXT,               -- json: [{focus_area, pct, note}]
  night_promotions      TEXT,               -- json: memory promotion candidates reviewed
  night_evidence        TEXT,               -- json: evidence captured
  night_tomorrow_seed   TEXT,               -- json: priorities/notes for tomorrow
  -- Derived/rollup
  day_flow_json         TEXT,               -- json: the rendered day flow blocks
  open_loops_count      INTEGER NOT NULL DEFAULT 0,
  gate_entries_count    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_days_date_ts ON days(date_ts);

-- ─── day_flow_blocks ───────────────────────────────────────────────────────────
-- The rendered "Day Flow" — ordered blocks the Chief of Staff briefing shows.
-- Canon §15 lists exactly 13 elements. Each block maps to one.
CREATE TABLE day_flow_blocks (
  id            TEXT PRIMARY KEY,
  day_id        TEXT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  block_key     TEXT NOT NULL,              -- one of the 13 canon keys
  block_order   INTEGER NOT NULL,
  title         TEXT NOT NULL,
  content       TEXT,                       -- json: varies by block type
  source_type   TEXT,                       -- 'tasks' | 'approvals' | 'memory' | 'trading' | 'calendar' | 'manual' | 'coaching' | 'spirit'
  source_id     TEXT,                       -- reference id if applicable
  is_empty      INTEGER NOT NULL DEFAULT 0, -- 1 = block rendered but no data
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_day_flow_unique ON day_flow_blocks(day_id, block_key);
CREATE INDEX idx_day_flow_order ON day_flow_blocks(day_id, block_order);

-- ─── open_loops ────────────────────────────────────────────────────────────────
-- Anything that needs attention but isn't a task/approval. Surfaces in Today.
CREATE TABLE open_loops (
  id            TEXT PRIMARY KEY,
  day_id        TEXT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,              -- 'follow_up' | 'decision_pending' | 'meeting_prep' | 'memory_candidate' | 'relationship' | 'trading' | 'other'
  title         TEXT NOT NULL,
  detail        TEXT,                       -- json
  source_type   TEXT,                       -- 'meeting' | 'approval' | 'task' | 'memory' | 'relationship' | 'trading' | 'manual'
  source_id     TEXT,
  priority      INTEGER NOT NULL DEFAULT 3, -- 1=high, 2=medium, 3=low
  status        TEXT NOT NULL DEFAULT 'open', -- open|resolved|dismissed|deferred
  resolved_at   INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_open_loops_day ON open_loops(day_id, status, priority, created_at);

-- ─── gate_entries ──────────────────────────────────────────────────────────────
-- One row per gate completion. Morning, Midday, Night.
CREATE TABLE gate_entries (
  id            TEXT PRIMARY KEY,
  day_id        TEXT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  gate          TEXT NOT NULL,              -- 'morning' | 'midday' | 'night'
  completed_at  INTEGER NOT NULL,
  payload       TEXT NOT NULL,              -- json: the full gate submission
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_gate_entries_day ON gate_entries(day_id, gate);
CREATE UNIQUE INDEX idx_gate_entries_unique ON gate_entries(day_id, gate);