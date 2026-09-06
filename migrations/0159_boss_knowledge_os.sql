-- Boss OS v20 — Phase 15: Knowledge OS surfaces.
-- Canon §45 (twelve surfaces), the memory tiers, §46, §64. Decision §1.6.
--
-- These are typed surfaces over the existing `memory_items` substrate, not a
-- parallel store. `knowledge_items` files a memory onto a surface; it never
-- copies one. Two of the twelve surfaces are views over Phase 14's tables —
-- the Decision Vault and the Prediction Vault already exist and are not
-- duplicated here.

-- ─── memory substrate: retirement and sensitivity ──────────────────────────────
-- Canon requires memory retirement and the implementation lacked it. Retirement
-- is not deletion and not archival: the record stays, its history stays, and it
-- stops surfacing. `sensitivity` gives a memory the same privacy class the
-- router already understands, so restricted knowledge can be held without
-- becoming exportable by default.
ALTER TABLE memory_items ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'private'; -- public|internal|private|restricted
ALTER TABLE memory_items ADD COLUMN retired_at INTEGER;
ALTER TABLE memory_items ADD COLUMN retired_reason TEXT;

-- ─── knowledge_surfaces ────────────────────────────────────────────────────────
-- The twelve canon §45 names. Seeded, because canon fixes them.
CREATE TABLE knowledge_surfaces (
  key           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  backing       TEXT NOT NULL DEFAULT 'memory', -- memory|decisions|predictions
  tier_floor    TEXT NOT NULL DEFAULT 'capture', -- lowest memory tier this surface accepts
  surface_order INTEGER NOT NULL,
  in_manual     INTEGER NOT NULL DEFAULT 0,     -- feeds the Personal Operating Manual
  offline       INTEGER NOT NULL DEFAULT 0,     -- part of the Emergency Offline Library
  created_at    INTEGER NOT NULL
);

-- ─── knowledge_items ───────────────────────────────────────────────────────────
-- The filing, and only the filing. The knowledge itself stays in memory_items.
CREATE TABLE knowledge_items (
  id            TEXT PRIMARY KEY,
  surface_key   TEXT NOT NULL REFERENCES knowledge_surfaces(key) ON DELETE CASCADE,
  item_id       TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  note          TEXT,
  filed_by      TEXT NOT NULL DEFAULT 'boss',
  filed_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_knowledge_filing ON knowledge_items(surface_key, item_id);
CREATE INDEX idx_knowledge_item ON knowledge_items(item_id);

-- ─── manual_versions ───────────────────────────────────────────────────────────
-- The Personal Operating Manual is generated, never typed. Each generation is a
-- version with the hash of what it contained, so "it regenerated" and "it
-- changed" stay distinguishable.
CREATE TABLE manual_versions (
  id              TEXT PRIMARY KEY,
  version         INTEGER NOT NULL,
  generated_at    INTEGER NOT NULL,
  sections        TEXT NOT NULL,          -- json: [{surface, title, entries:[…]}]
  source_item_ids TEXT NOT NULL,          -- json: the memory ids it was built from
  item_count      INTEGER NOT NULL DEFAULT 0,
  sha256          TEXT NOT NULL,
  supersedes_id   TEXT REFERENCES manual_versions(id),
  note            TEXT,
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_manual_version ON manual_versions(version);

-- ─── knowledge_retirements ─────────────────────────────────────────────────────
-- Every retirement and every restoration, with its reason. A memory that
-- stopped being true is a fact about the memory, and worth keeping.
CREATE TABLE knowledge_retirements (
  id            TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,            -- retired|restored
  ts            INTEGER NOT NULL,
  reason        TEXT,
  actor         TEXT NOT NULL DEFAULT 'boss'
);
CREATE INDEX idx_retirements_item ON knowledge_retirements(item_id, ts DESC);

-- ─── knowledge_exports ─────────────────────────────────────────────────────────
-- Portable export through the existing vault path, with a SHA manifest. What
-- was left out is recorded beside what went in.
CREATE TABLE knowledge_exports (
  id                  TEXT PRIMARY KEY,
  ts                  INTEGER NOT NULL,
  scope               TEXT NOT NULL,      -- all|surface key
  r2_key              TEXT,
  bytes               INTEGER NOT NULL DEFAULT 0,
  sha256              TEXT,
  manifest            TEXT,               -- json: per-item hashes and what was excluded
  item_count          INTEGER NOT NULL DEFAULT 0,
  restricted_included INTEGER NOT NULL DEFAULT 0,
  restricted_excluded INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'running', -- running|complete|failed
  error               TEXT
);
CREATE INDEX idx_knowledge_exports_ts ON knowledge_exports(ts DESC);

-- ─── the twelve surfaces ───────────────────────────────────────────────────────
INSERT INTO knowledge_surfaces (key, name, description, backing, tier_floor, surface_order, in_manual, offline, created_at) VALUES
  ('life_wiki', 'Life Wiki',
   'The standing facts of the life: people, places, accounts, arrangements, how things actually work.',
   'memory', 'capture', 1, 0, 1, unixepoch() * 1000),
  ('operating_manual', 'Personal Operating Manual',
   'How the Boss operates: rules, defaults, refusals. Generated from promoted memory, never typed.',
   'memory', 'working', 2, 1, 1, unixepoch() * 1000),
  ('decision_vault', 'Decision Vault',
   'Every decision with its options, its challenge and its outcome. Backed by the Phase 14 journal, not a second copy.',
   'decisions', 'capture', 3, 0, 0, unixepoch() * 1000),
  ('prediction_vault', 'Prediction Vault',
   'Every forecast with its resolution criteria and its Brier contribution. Backed by the Phase 14 vault, not a second copy.',
   'predictions', 'capture', 4, 0, 0, unixepoch() * 1000),
  ('lessons_learned', 'Lessons Learned',
   'What experience actually taught, stated so it can be applied again.',
   'memory', 'working', 5, 1, 1, unixepoch() * 1000),
  ('failed_experiments', 'Memory of Failed Experiments',
   'What was tried and did not work, kept so it is not tried twice by accident.',
   'memory', 'capture', 6, 1, 1, unixepoch() * 1000),
  ('breakthrough_library', 'Breakthrough Library',
   'The moments something changed, and what made them possible.',
   'memory', 'working', 7, 0, 0, unixepoch() * 1000),
  ('operating_patterns', 'Operating Pattern Library',
   'Patterns that repeat: what reliably works, what reliably fails, and the conditions for each.',
   'memory', 'working', 8, 1, 1, unixepoch() * 1000),
  ('archive_of_self', 'Archive of Self',
   'Who the Boss has been. Kept for continuity of identity, not for performance.',
   'memory', 'capture', 9, 0, 0, unixepoch() * 1000),
  ('legacy_vault', 'Legacy Vault',
   'What should outlive the system: what matters, to whom, and why.',
   'memory', 'working', 10, 0, 1, unixepoch() * 1000),
  ('wisdom_canon', 'Wisdom Canon',
   'The few things held as settled. Canon tier only, because a principle that moves is not one.',
   'memory', 'canon', 11, 1, 1, unixepoch() * 1000),
  ('offline_library', 'Emergency Offline Library',
   'What must remain readable with no network, no provider and no account.',
   'memory', 'capture', 12, 0, 1, unixepoch() * 1000);


-- The chassis answers "what schema is applied" from this table, and /api/health and the
-- policy suite both read it. A migration that runs without recording itself leaves the
-- system reporting a version older than the one it is actually running, so every ported
-- Boss OS migration registers here exactly as the chassis's own do.
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0159_boss_knowledge_os');
