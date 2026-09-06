-- Boss OS v20 — Phase 23: continuity hardening.
-- Canon §19, §46, §45.2, §45.3.
--
-- The vault, snapshot, verify, restore and drill already exist and are the
-- strongest part of the baseline. This phase completes the Emergency
-- Sovereignty Package: one file that can be read on a laptop with no network,
-- no account and no repository, carrying the operating manual, the offline
-- library, the approved prompts and the recovery documents, each hashed.
--
-- The drill is the point. A package nobody has restored from is a hope.

-- ─── sovereignty_packages ──────────────────────────────────────────────────────
CREATE TABLE sovereignty_packages (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  r2_key        TEXT,
  bytes         INTEGER NOT NULL DEFAULT 0,
  sha256        TEXT,
  manifest      TEXT,                       -- json: per-item hashes and counts
  item_counts   TEXT,                       -- json: {manual, offline_library, prompt_library, documents}
  status        TEXT NOT NULL DEFAULT 'building', -- building|complete|failed
  verified_at   INTEGER,
  error         TEXT,
  note          TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_packages_ts ON sovereignty_packages(ts DESC);

-- ─── sovereignty_drills ────────────────────────────────────────────────────────
-- A drill that reads only the package. If any step needed the network, the drill
-- would not be a proof of sovereignty — so the drill records that too.
CREATE TABLE sovereignty_drills (
  id            TEXT PRIMARY KEY,
  package_id    TEXT NOT NULL REFERENCES sovereignty_packages(id) ON DELETE CASCADE,
  ts            INTEGER NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'offline_only',
  steps         TEXT NOT NULL,              -- json: [{key, label, passed, evidence}]
  passed        INTEGER NOT NULL DEFAULT 0,
  failed_steps  TEXT,                       -- json
  note          TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_drills_package ON sovereignty_drills(package_id, ts DESC);

-- ─── The continuity maintenance items ──────────────────────────────────────────
-- Phase 19 already carries maintenance with cadences and flags overdue items;
-- the sovereignty workflows join it rather than starting a second reminder
-- system.
INSERT INTO maintenance_items (id, key, title, kind, cadence_days, due_at, note, created_at, updated_at) VALUES
  ('mnt_sovereignty_package', 'build_sovereignty_package', 'Build and verify a sovereignty package', 'continuity', 30,
   unixepoch() * 1000 + 30 * 86400000,
   'Monthly. Verify it before copying it anywhere.', unixepoch() * 1000, unixepoch() * 1000),
  ('mnt_ssd_copy', 'copy_package_to_ssd', 'Copy the newest verified package to the external SSD', 'continuity', 30,
   unixepoch() * 1000 + 30 * 86400000,
   'An SSD in the same bag as the laptop is not a backup.', unixepoch() * 1000, unixepoch() * 1000),
  ('mnt_offsite_copy', 'offsite_copy', 'Take an offsite copy', 'continuity', 90,
   unixepoch() * 1000 + 90 * 86400000,
   'Second physical location. The passphrase lives with a person, not with the copy.', unixepoch() * 1000, unixepoch() * 1000),
  ('mnt_offline_drill', 'offline_restore_drill', 'Run the offline restore drill', 'continuity', 90,
   unixepoch() * 1000 + 90 * 86400000,
   'From the package alone. A package nobody has restored from is a hope.', unixepoch() * 1000, unixepoch() * 1000);


-- The chassis answers "what schema is applied" from this table, and /api/health and the
-- policy suite both read it. A migration that runs without recording itself leaves the
-- system reporting a version older than the one it is actually running, so every ported
-- Boss OS migration registers here exactly as the chassis's own do.
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0167_boss_continuity');
