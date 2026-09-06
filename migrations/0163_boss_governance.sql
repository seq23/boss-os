-- Boss OS v20 — Phase 19: the Operating Governance Layer.
-- Canon v10.10 — §2, §3, §4, §5, §6, §7, §8, §11, §14, §15, §16, §17, §18.
--
-- This phase is enforcement, not display. Every table here is read by a code
-- path that can refuse something:
--
--   decision_rights   — consulted when an approval is decided
--   emotional_states  — gates canon §18's protected actions
--   compliance_flags  — written by the sentinel and by every refusal
--   failure_playbooks — surfaced when the condition they describe is true
--   maintenance_items — overdue items become compliance flags
--   ip_assets         — a renewal that has passed becomes a flag
--   brand_profiles    — the voice and the forbidden list outbound work is held to
--   learning_entries  — what an incident taught, linked to the memory it became

-- ─── decision_rights ───────────────────────────────────────────────────────────
-- Who may decide what. In a single-user system the answer is usually "the
-- Boss", and saying so explicitly is what makes the exceptions visible.
CREATE TABLE decision_rights (
  id                TEXT PRIMARY KEY,
  action_class      TEXT NOT NULL UNIQUE,   -- an approval kind, or a protected action key
  label             TEXT NOT NULL,
  decider           TEXT NOT NULL DEFAULT 'boss', -- boss|system|employee|external
  protected         INTEGER NOT NULL DEFAULT 0,   -- gated by emotional state, canon §18
  requires_approval INTEGER NOT NULL DEFAULT 1,
  max_autonomous_micros INTEGER NOT NULL DEFAULT 0, -- what may move without the Boss
  rationale         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- ─── emotional_states ──────────────────────────────────────────────────────────
-- Canon §18. A self-report with a risk classification and an expiry, because a
-- state recorded on Tuesday should not still be gating anything on Friday.
CREATE TABLE emotional_states (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  state         TEXT NOT NULL,              -- steady|stretched|activated|depleted|grieving|elated
  risk_class    TEXT NOT NULL,              -- low|elevated|high
  note          TEXT,
  source        TEXT NOT NULL DEFAULT 'self_report',
  valid_until   INTEGER,
  cleared_at    INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_states_ts ON emotional_states(ts DESC);

-- ─── compliance_flags ──────────────────────────────────────────────────────────
-- The sentinel's output, and the record of every refusal this layer made.
CREATE TABLE compliance_flags (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  watch_key     TEXT NOT NULL,              -- which watch item fired
  severity      TEXT NOT NULL DEFAULT 'medium', -- low|medium|high
  subject_type  TEXT,
  subject_id    TEXT,
  summary       TEXT NOT NULL,
  detail        TEXT,                       -- json
  status        TEXT NOT NULL DEFAULT 'open', -- open|cleared|accepted
  cleared_at    INTEGER,
  note          TEXT
);
CREATE INDEX idx_flags_open ON compliance_flags(status, ts DESC);
CREATE INDEX idx_flags_watch ON compliance_flags(watch_key, status);

-- ─── failure_playbooks ─────────────────────────────────────────────────────────
-- What to do when the thing goes wrong, written before it goes wrong.
CREATE TABLE failure_playbooks (
  id                TEXT PRIMARY KEY,
  key               TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  condition_text    TEXT NOT NULL,          -- when this playbook applies
  condition_key     TEXT,                   -- machine check that surfaces it
  steps             TEXT NOT NULL,          -- json: ordered steps
  owner             TEXT NOT NULL DEFAULT 'boss',
  last_reviewed_at  INTEGER,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        INTEGER NOT NULL
);

-- ─── maintenance_items ─────────────────────────────────────────────────────────
CREATE TABLE maintenance_items (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- security|continuity|dependency|data|doc
  cadence_days  INTEGER NOT NULL,
  last_done_at  INTEGER,
  due_at        INTEGER,
  status        TEXT NOT NULL DEFAULT 'active', -- active|paused
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_maintenance_due ON maintenance_items(status, due_at);

-- ─── ip_assets ─────────────────────────────────────────────────────────────────
CREATE TABLE ip_assets (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- trademark|domain|copyright|trade_secret|patent|other
  entity_id     TEXT REFERENCES entities(id),
  identifier    TEXT,                       -- registration number, domain name
  registered_at INTEGER,
  renewal_at    INTEGER,
  status        TEXT NOT NULL DEFAULT 'active', -- active|lapsed|abandoned
  notes         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_ip_renewal ON ip_assets(status, renewal_at);

-- ─── brand_profiles ────────────────────────────────────────────────────────────
-- Canon §14. Outbound work is held to a voice and a forbidden list.
CREATE TABLE brand_profiles (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  voice         TEXT NOT NULL,              -- json: the traits
  forbidden     TEXT NOT NULL,              -- json: what it never does
  audiences     TEXT NOT NULL,              -- json
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- ─── learning_entries ──────────────────────────────────────────────────────────
CREATE TABLE learning_entries (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  source_type   TEXT NOT NULL,              -- incident|review|decision|meeting|flag
  source_id     TEXT,
  title         TEXT NOT NULL,
  lesson        TEXT NOT NULL,
  applies_to    TEXT,                       -- json: where it applies
  memory_id     TEXT REFERENCES memory_items(id),
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_learning_ts ON learning_entries(ts DESC);

-- ─── Decision rights, seeded from the actions this build actually has ──────────
INSERT INTO decision_rights
  (id, action_class, label, decider, protected, requires_approval, max_autonomous_micros, rationale, created_at, updated_at)
VALUES
  ('dr_trade', 'trade', 'Placing an order', 'boss', 1, 1, 0,
   'Money moves only on a decision the Boss made, and not while a high-risk state is recorded.', unixepoch() * 1000, unixepoch() * 1000),
  ('dr_trading_authority', 'trading_authority_change', 'Changing the trading authority envelope', 'boss', 1, 1, 0,
   'The envelope is the thing that stops the lane. Loosening it is a protected action.', unixepoch() * 1000, unixepoch() * 1000),
  ('dr_decision_commit', 'decision_commit', 'Committing a decision in the journal', 'boss', 1, 0, 0,
   'A committed decision is the record of judgement. It waits for a steady moment.', unixepoch() * 1000, unixepoch() * 1000),
  ('dr_capital_allocation', 'capital_allocation', 'Allocating capital to a track', 'boss', 1, 0, 0,
   'Deploying capital is irreversible in practice even when it is reversible on paper.', unixepoch() * 1000, unixepoch() * 1000),
  ('dr_restricted_export', 'restricted_export', 'Exporting restricted knowledge', 'boss', 1, 0, 0,
   'Restricted content leaving the system cannot be recalled.', unixepoch() * 1000, unixepoch() * 1000),
  ('dr_spend', 'spend', 'Approving spend', 'boss', 0, 1, 0,
   'Spend is approved, not assumed; the budget is a hard stop either way.', unixepoch() * 1000, unixepoch() * 1000),
  ('dr_memory_promotion', 'memory_promotion', 'Promoting memory', 'boss', 0, 1, 0,
   'Durability is a judgement; the gate is the only path up.', unixepoch() * 1000, unixepoch() * 1000),
  ('dr_agent_creation', 'agent_creation', 'Creating an AI employee', 'boss', 1, 1, 0,
   'A new employee is a standing commitment, and No Agent Sprawl is the default answer.', unixepoch() * 1000, unixepoch() * 1000),
  ('dr_model_route', 'model_route', 'Granting a sensitive routing card', 'boss', 1, 1, 0,
   'Sending restricted content to a cloud model is a one-way disclosure.', unixepoch() * 1000, unixepoch() * 1000),
  ('dr_task_output', 'task_output', 'Releasing a task output', 'boss', 0, 1, 0,
   'The Boss sees the work before it counts as done.', unixepoch() * 1000, unixepoch() * 1000),
  ('dr_capability_patch', 'capability_patch', 'Patching a core capability', 'boss', 0, 1, 0,
   'A critical capability does not change on somebody''s say-so.', unixepoch() * 1000, unixepoch() * 1000),
  ('dr_prompt_library', 'prompt_library_promotion', 'Admitting a prompt to the library', 'boss', 0, 1, 0,
   'The library holds reviewed prompts only.', unixepoch() * 1000, unixepoch() * 1000);

-- ─── Failure playbooks for this system's real failure modes ────────────────────
INSERT INTO failure_playbooks (id, key, title, condition_text, condition_key, steps, owner, status, created_at) VALUES
  ('fpb_dead_letters', 'dead_letter_storm', 'Tasks are giving up',
   'Open dead letters are accumulating faster than they are being triaged.', 'open_dead_letters',
   '["Read the evidence packet on the newest dead letter","Decide whether the cause is the task, the model or the envelope","Requeue what is safe to retry and dismiss what is not","If the cause is systemic, lower the cost mode before requeueing"]',
   'boss', 'active', unixepoch() * 1000),
  ('fpb_kill_switch', 'kill_switch_engaged', 'The trading kill switch is engaged',
   'The trading lane is stopped and open orders were cancelled.', 'kill_switch',
   '["Read the incident that engaged it","Confirm no open positions are unattended","Write the incident''s lesson into the learning log","Disengage only after the cause is named — it is a protected action"]',
   'boss', 'active', unixepoch() * 1000),
  ('fpb_vault_stale', 'vault_stale', 'The vault is stale or broken',
   'No verified snapshot in more than two days.', 'stale_vault',
   '["Take a snapshot and verify it","If verification fails, do not overwrite the last good snapshot","Run the restore drill against the last verified snapshot","Record what broke in the learning log"]',
   'boss', 'active', unixepoch() * 1000),
  ('fpb_restricted_leak', 'restricted_disclosure', 'Restricted content left the system',
   'A restricted-class item was exported or routed outward.', 'restricted_export',
   '["Identify exactly what left and when, from the export manifest or the routing decision","Decide whether disclosure was intended","If not, record the flag as an incident and write the lesson","Review the allowlist that permitted it"]',
   'boss', 'active', unixepoch() * 1000),
  ('fpb_provider_out', 'provider_unavailable', 'The model provider is unavailable',
   'Routing cannot place work with any eligible model.', NULL,
   '["Check the cost mode and the budget window first — a hard stop looks like an outage","Confirm the key is present","Lower the tier requirement rather than raising the budget","If the outage is real, queue the work rather than downgrading privacy class"]',
   'boss', 'active', unixepoch() * 1000),
  ('fpb_budget_out', 'budget_exhausted', 'A lane budget is exhausted',
   'Work is blocked because the lane has spent its window.', NULL,
   '["Confirm the window is real and not a stuck roll","Decide whether the work is worth a mode change","Approve spend explicitly rather than raising the ceiling by habit"]',
   'boss', 'active', unixepoch() * 1000);

-- ─── Maintenance, on real cadences ─────────────────────────────────────────────
INSERT INTO maintenance_items (id, key, title, kind, cadence_days, due_at, note, created_at, updated_at) VALUES
  ('mnt_restore_drill', 'restore_drill', 'Run the vault restore drill', 'continuity', 90,
   unixepoch() * 1000 + 90 * 86400000, 'A backup nobody has restored is a hope.', unixepoch() * 1000, unixepoch() * 1000),
  ('mnt_passcode', 'rotate_passcode', 'Rotate the passcode', 'security', 180,
   unixepoch() * 1000 + 180 * 86400000, 'One passcode is the whole front door.', unixepoch() * 1000, unixepoch() * 1000),
  ('mnt_decision_rights', 'review_decision_rights', 'Review the decision rights table', 'doc', 180,
   unixepoch() * 1000 + 180 * 86400000, 'Rights that nobody reviews stop matching how the system is actually used.', unixepoch() * 1000, unixepoch() * 1000),
  ('mnt_dependencies', 'review_dependencies', 'Review dependency versions', 'dependency', 90,
   unixepoch() * 1000 + 90 * 86400000, 'Pinned dependencies age quietly.', unixepoch() * 1000, unixepoch() * 1000),
  ('mnt_capability_defaults', 'review_capability_defaults', 'Review the capability defaults', 'doc', 30,
   unixepoch() * 1000 + 30 * 86400000, 'The monthly scan raises it; this is the item it lands on.', unixepoch() * 1000, unixepoch() * 1000);

-- ─── Brand ─────────────────────────────────────────────────────────────────────
INSERT INTO brand_profiles (id, key, name, voice, forbidden, audiences, notes, created_at, updated_at) VALUES
  ('brand_boss', 'boss_default', 'Boss OS default voice',
   '["Plain","Specific","Unhurried","Says the number or says it does not have it"]',
   '["Hype","Manufactured urgency","Claims without provenance","Apologising for existing","Emoji in outbound work"]',
   '["Investors","Operators","Collaborators"]',
   'Canon §14. Outbound work is checked against this before it goes.', unixepoch() * 1000, unixepoch() * 1000);
