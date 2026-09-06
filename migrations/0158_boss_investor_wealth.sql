-- Boss OS v20 — Phase 14: Investor OS and Wealth Command Center.
-- Canon §41 (the investor components, including Deal Energy Protection),
-- §42 (wealth tracks and engines), §12, §13, §9.
--
-- Money is integer USD micros. Probability is basis points (0–10000), so a
-- 65% forecast is 6500 and nothing depends on float equality. Timestamps are
-- epoch milliseconds.
--
-- Lane law: nothing here references a trading table. Trading capital is read
-- across the lane boundary through the Trading Allocation Bridge, read-only,
-- and a foreign key would make that boundary a fiction.

-- ─── entities ──────────────────────────────────────────────────────────────────
-- The legal wrappers capital actually sits inside.
CREATE TABLE entities (
  id            TEXT PRIMARY KEY,
  lane          TEXT NOT NULL REFERENCES lanes(id),
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'other', -- person|llc|corp|trust|fund|foundation|other
  jurisdiction  TEXT,
  role          TEXT,                       -- what this entity is for
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'active', -- active|dormant|dissolved
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_entities_name ON entities(name);

-- ─── portfolio_vehicles ────────────────────────────────────────────────────────
-- A holding inside an entity, carried at a value that is only as good as its
-- `valued_at`. The date is stored with the number so a stale mark is visible
-- rather than implied.
CREATE TABLE portfolio_vehicles (
  id            TEXT PRIMARY KEY,
  entity_id     TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- brokerage|cash|spv|fund|operating_company|real_estate|private_credit|crypto|other
  custodian     TEXT,
  value_micros  INTEGER NOT NULL DEFAULT 0,
  valued_at     INTEGER,
  liquidity     TEXT NOT NULL DEFAULT 'illiquid', -- liquid|semi_liquid|illiquid
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'active', -- active|exited|written_off
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_vehicles_entity ON portfolio_vehicles(entity_id, status);

-- ─── wealth_tracks ─────────────────────────────────────────────────────────────
-- Canon §42 organises wealth into tracks. The track names canon fixes are not
-- reproduced in any authority document available to this build, so this table
-- is populated rather than seeded: inventing ten canonical names would be worse
-- than an empty table that says what it is for.
CREATE TABLE wealth_tracks (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  thesis                TEXT,
  target_allocation_bps INTEGER NOT NULL DEFAULT 0, -- share of the book, 0–10000
  horizon               TEXT,                       -- near|medium|long
  status                TEXT NOT NULL DEFAULT 'active', -- active|paused|closed
  notes                 TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_tracks_name ON wealth_tracks(name);

-- ─── theses ────────────────────────────────────────────────────────────────────
CREATE TABLE theses (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  statement     TEXT NOT NULL,
  domain        TEXT,
  conviction    INTEGER NOT NULL DEFAULT 50, -- 0–100
  status        TEXT NOT NULL DEFAULT 'active', -- draft|active|retired|invalidated
  invalidated_by TEXT,                       -- what would prove it wrong, in advance
  retired_at    INTEGER,
  retired_reason TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- ─── deals ─────────────────────────────────────────────────────────────────────
-- Canon §41's Deal Energy Protection lives on `energy`: the pipeline is the
-- primary object and exactly one deal may hold focus. The constraint is a
-- partial unique index, so two focused deals is not a race the API can lose.
CREATE TABLE deals (
  id                TEXT PRIMARY KEY,
  lane              TEXT NOT NULL REFERENCES lanes(id),
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'venture', -- venture|secondary|acquisition|real_estate|credit|other
  stage             TEXT NOT NULL DEFAULT 'sourced', -- sourced|screening|diligence|committed|closed|passed|dead
  organization_id   TEXT REFERENCES organizations(id),
  person_id         TEXT REFERENCES people(id),
  thesis_id         TEXT REFERENCES theses(id),
  check_size_micros INTEGER NOT NULL DEFAULT 0,
  valuation_micros  INTEGER NOT NULL DEFAULT 0,
  ownership_bps     INTEGER NOT NULL DEFAULT 0,
  energy            TEXT NOT NULL DEFAULT 'pipeline', -- pipeline|focus
  focus_since       INTEGER,
  next_step         TEXT,
  next_step_due_at  INTEGER,
  notes             TEXT,
  opened_at         INTEGER NOT NULL,
  decided_at        INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_deals_stage ON deals(stage, updated_at DESC);
CREATE UNIQUE INDEX idx_deals_single_focus ON deals(energy) WHERE energy = 'focus';

-- ─── lps ───────────────────────────────────────────────────────────────────────
CREATE TABLE lps (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  organization_id     TEXT REFERENCES organizations(id),
  person_id           TEXT REFERENCES people(id),
  status              TEXT NOT NULL DEFAULT 'prospect', -- prospect|soft_circled|committed|closed|passed
  commitment_micros   INTEGER NOT NULL DEFAULT 0,
  called_micros       INTEGER NOT NULL DEFAULT 0,
  distributed_micros  INTEGER NOT NULL DEFAULT 0,
  last_contact_at     INTEGER,
  notes               TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_lps_status ON lps(status, name);

-- ─── opportunities ─────────────────────────────────────────────────────────────
-- Wider than deals: anything with an expected value and a next step.
CREATE TABLE opportunities (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL,
  kind                  TEXT NOT NULL DEFAULT 'other', -- deal|revenue|partnership|hire|other
  source                TEXT,
  deal_id               TEXT REFERENCES deals(id),
  thesis_id             TEXT REFERENCES theses(id),
  expected_value_micros INTEGER NOT NULL DEFAULT 0,
  probability_bps       INTEGER NOT NULL DEFAULT 0,
  effort                TEXT NOT NULL DEFAULT 'medium', -- low|medium|high
  status                TEXT NOT NULL DEFAULT 'open',   -- open|pursuing|won|lost|dropped
  next_step             TEXT,
  next_step_due_at      INTEGER,
  closed_at             INTEGER,
  notes                 TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX idx_opportunities_status ON opportunities(status, probability_bps DESC);

-- ─── decisions ─────────────────────────────────────────────────────────────────
-- The Decision Journal. A decision is challenged before it is committed, and
-- what it predicted is recorded beside it.
CREATE TABLE decisions (
  id                  TEXT PRIMARY KEY,
  lane                TEXT NOT NULL REFERENCES lanes(id),
  title               TEXT NOT NULL,
  context             TEXT NOT NULL,
  options             TEXT NOT NULL,        -- json: [{option, why, why_not}]
  chosen_option       TEXT,
  rationale           TEXT,
  kind                TEXT NOT NULL DEFAULT 'other', -- invest|pass|allocate|hire|strategic|other
  stakes              TEXT NOT NULL DEFAULT 'medium', -- low|medium|high
  reversible          INTEGER NOT NULL DEFAULT 1,
  deal_id             TEXT REFERENCES deals(id),
  thesis_id           TEXT REFERENCES theses(id),
  status              TEXT NOT NULL DEFAULT 'draft', -- draft|committed|resolved|abandoned
  committed_at        INTEGER,
  review_at           INTEGER,
  red_team_override   TEXT,                 -- json: {verdict, reason} when committed over a kill
  outcome             TEXT,                 -- json: {summary, lesson}
  outcome_recorded_at INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_decisions_status ON decisions(status, created_at DESC);

-- ─── predictions ───────────────────────────────────────────────────────────────
-- The Prediction Vault. A prediction that cannot be resolved is an opinion, so
-- resolution criteria and a resolution date are both required at creation, and
-- the Brier contribution is stored on the row when it resolves.
CREATE TABLE predictions (
  id                  TEXT PRIMARY KEY,
  decision_id         TEXT REFERENCES decisions(id) ON DELETE CASCADE,
  statement           TEXT NOT NULL,
  probability_bps     INTEGER NOT NULL,     -- 0–10000
  resolution_criteria TEXT NOT NULL,        -- what would settle it, written before the fact
  resolves_at         INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open', -- open|resolved|cancelled
  outcome             TEXT,                 -- true|false|ambiguous
  resolved_at         INTEGER,
  resolution_note     TEXT,
  brier_bps           INTEGER,              -- (p − outcome)² × 10000; lower is better
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_predictions_open ON predictions(status, resolves_at);
CREATE INDEX idx_predictions_decision ON predictions(decision_id);

-- ─── red_team_reviews ──────────────────────────────────────────────────────────
-- The precommit challenge. Its three fields are the output contract the
-- existing `tpl_deal_red_team` template already names.
CREATE TABLE red_team_reviews (
  id                      TEXT PRIMARY KEY,
  decision_id             TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  template_id             TEXT REFERENCES task_templates(id),
  challenger              TEXT NOT NULL DEFAULT 'boss',
  ts                      INTEGER NOT NULL,
  ways_this_loses         TEXT NOT NULL,    -- json: [text]
  disconfirming_evidence  TEXT NOT NULL,    -- json: [text]
  walk_away_line          TEXT NOT NULL,
  verdict                 TEXT NOT NULL,    -- proceed|proceed_with_changes|kill
  changes_required        TEXT,             -- json: [text]
  prompt                  TEXT,             -- the rendered template prompt
  created_at              INTEGER NOT NULL
);
CREATE INDEX idx_red_team_decision ON red_team_reviews(decision_id, ts DESC);

-- ─── calibrations ──────────────────────────────────────────────────────────────
-- One row per calibration run over resolved predictions. The buckets are kept
-- so the score can be argued with rather than merely displayed.
CREATE TABLE calibrations (
  id                    TEXT PRIMARY KEY,
  ts                    INTEGER NOT NULL,
  window_start          INTEGER NOT NULL,
  window_end            INTEGER NOT NULL,
  predictions_scored    INTEGER NOT NULL DEFAULT 0,
  ambiguous_excluded    INTEGER NOT NULL DEFAULT 0,
  brier_score_bps       INTEGER,            -- mean (p − outcome)² × 10000
  mean_probability_bps  INTEGER,
  hit_rate_bps          INTEGER,
  overconfidence_bps    INTEGER,            -- mean forecast − actual hit rate
  buckets               TEXT NOT NULL,      -- json: [{from_bps, to_bps, n, mean_probability_bps, hit_rate_bps}]
  detail                TEXT,               -- json: per-prediction contributions
  created_at            INTEGER NOT NULL
);
CREATE INDEX idx_calibrations_ts ON calibrations(ts DESC);

-- ─── capital_allocations ───────────────────────────────────────────────────────
-- Capital moving into or out of a track, always against a real vehicle, and
-- traceable to the decision that authorised it.
CREATE TABLE capital_allocations (
  id            TEXT PRIMARY KEY,
  track_id      TEXT NOT NULL REFERENCES wealth_tracks(id) ON DELETE CASCADE,
  vehicle_id    TEXT REFERENCES portfolio_vehicles(id),
  entity_id     TEXT REFERENCES entities(id),
  decision_id   TEXT REFERENCES decisions(id),
  kind          TEXT NOT NULL DEFAULT 'deployed', -- committed|deployed|reserved|returned|written_off
  amount_micros INTEGER NOT NULL,
  as_of         INTEGER NOT NULL,
  note          TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_allocations_track ON capital_allocations(track_id, as_of DESC);
CREATE INDEX idx_allocations_vehicle ON capital_allocations(vehicle_id);
