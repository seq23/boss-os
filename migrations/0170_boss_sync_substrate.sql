-- Batch 3 of Boss OS v20.1 — the synchronization substrate.
--
-- WHAT THIS IS FOR. One logical operating system runs in two execution domains: the Cloudflare
-- runtime that is deployed, and a private runtime on a machine the owner controls. §2.3 is blunt
-- about the risk: "There must be no assumption that two independently edited databases will merge
-- safely without this protocol."
--
-- NOTHING BINDS TO A PARTICULAR MACHINE. The private side is a REGISTERED DEVICE, not "the Mac".
-- The laptop this is being written on is a proving ground with 8 GB of memory; the one it will
-- actually run on does not exist yet. Making the future machine a row in `sync_device` rather than
-- an assumption in the code is what makes the addendum's drill step 6 - recovery onto a
-- replacement machine - a test rather than a rewrite.
--
-- VERSIONS, NOT CLOCKS. §10: "Do not use naive timestamp-only last-write-wins for critical mutable
-- records", and "clocks can disagree". Every synced record carries a monotonic integer version.
-- A mutation declares the version it was based on; if that is not the version the record holds,
-- it is a CONFLICT and is recorded as one, never silently applied over the other edit. Wall-clock
-- time is kept for humans and for audit, and is never the arbiter.
--
-- LOCAL_ONLY NEVER REACHES THIS TABLE. The ledger is a cloud-domain structure, so a sovereign
-- record must be refused BEFORE serialization (§2.3), not filtered on the way out. The guard in
-- sync/ledger.ts enforces that against data_policy, and the pull path checks again - two
-- independent refusals, because the one that matters is the one that still works after somebody
-- edits the other.

-- ── Devices ──────────────────────────────────────────────────────────────────
-- A device is an identity that may sync, and one that may be revoked. Revocation is a state on
-- the row rather than a deletion, because "which device pushed this mutation" must stay answerable
-- after the device is gone (§10: "a device may later be revoked").
CREATE TABLE sync_device (
  device_id      TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('cloud','private')),
  label          TEXT NOT NULL,
  registered_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  last_seen_at   INTEGER,
  revoked_at     INTEGER,
  revoked_reason TEXT
);

-- ── Authoritative version per record ─────────────────────────────────────────
-- The number a mutation is checked against. Separate from the record's own table so the substrate
-- works for every entity without adding a column to each of them.
CREATE TABLE record_version (
  entity     TEXT NOT NULL,
  record_id  TEXT NOT NULL,
  version    INTEGER NOT NULL,
  tombstone  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (entity, record_id)
);

-- ── The change ledger ────────────────────────────────────────────────────────
-- `seq` is the cloud's authoritative order and the thing a cursor points at. `mutation_id` is
-- UNIQUE, which is what makes replay idempotent: a client that never saw our response can send the
-- same mutation again and get the same answer instead of a second write (§10: "the same mutation
-- may be delivered more than once", "network requests can fail after the server commits").
CREATE TABLE sync_ledger (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  mutation_id    TEXT NOT NULL UNIQUE,
  entity         TEXT NOT NULL,
  record_id      TEXT NOT NULL,
  base_version   INTEGER,
  result_version INTEGER NOT NULL,
  device_id      TEXT NOT NULL,
  tombstone      INTEGER NOT NULL DEFAULT 0,
  payload_hash   TEXT,
  wall_ms        INTEGER NOT NULL,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ── Per-device cursor ────────────────────────────────────────────────────────
CREATE TABLE sync_cursor (
  device_id  TEXT PRIMARY KEY,
  last_seq   INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ── Conflicts ────────────────────────────────────────────────────────────────
-- §11 requires explicit conflict handling rather than silent data loss. A conflict is a row a
-- person can be shown, not an exception that disappears into a log.
CREATE TABLE sync_conflict (
  id              TEXT PRIMARY KEY,
  entity          TEXT NOT NULL,
  record_id       TEXT NOT NULL,
  mutation_id     TEXT NOT NULL,
  base_version    INTEGER,
  current_version INTEGER NOT NULL,
  device_id       TEXT NOT NULL,
  detected_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  resolution      TEXT NOT NULL DEFAULT 'OPEN' CHECK (resolution IN ('OPEN','KEPT_CURRENT','APPLIED_INCOMING','MERGED_BY_HAND')),
  resolved_at     INTEGER,
  resolved_by     TEXT,
  note            TEXT
);

CREATE INDEX idx_sync_ledger_entity ON sync_ledger (entity, record_id, seq);
CREATE INDEX idx_sync_ledger_device ON sync_ledger (device_id, seq);
CREATE INDEX idx_sync_conflict_open ON sync_conflict (resolution, detected_at);

-- The substrate classifies itself. The gate would fail the build otherwise, which is the point.
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('sync_device', 'sync', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Device registry. Both sides must agree on who may sync, so it cannot be private to one of them.'),
  ('record_version', 'sync', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Version numbers only. It names entities and ids, never content.'),
  ('sync_ledger', 'sync', 'CLOUD_SYNC', 'EXTERNAL_OK', 'The change ledger. It carries identity, versions and a hash - never the record - and by construction never holds a LOCAL_ONLY entity at all.'),
  ('sync_cursor', 'sync', 'CLOUD_SYNC', 'EXTERNAL_OK', 'How far each device has read.'),
  ('sync_conflict', 'sync', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Conflicts a person has to resolve. Holds the versions that disagreed, not the values.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0170_boss_sync_substrate');
