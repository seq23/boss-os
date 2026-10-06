-- 0279 — THE SERVICE RULES EVERY BOSS OS EMPLOYEE KEEPS (6 Oct 2026).
--
-- The owner, 6 Oct 2026: "i need to make sure all of these things we just did for porter and west
-- peek OS agents — we need to apply it to boss os repo for all the boss os agents — same
-- capabilities and friction reduction (do not set up a tail)."
--
-- West Peek OS landed these in its own 0253/0254. Boss OS COPIES the shapes and diverges where the
-- two businesses do; docs/SERVICE_RULES.md names every rule, its code anchor and every divergence,
-- and `npm run validate:service-rules` reads that document against the code.

-- R3: a key she emails as `SECRET NAME=value`, encrypted (AES-256-GCM under the Worker secret
-- BOSS_OS_SECRET_HANDOFF_KEY) until her Mac moves it into the vault. Never the plaintext, never a
-- copy in any other table; a row her Mac collected is DELETED, and an uncollected one expires.
CREATE TABLE IF NOT EXISTS boss_secret_handoff (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  repo         TEXT,
  ciphertext   TEXT NOT NULL,
  iv           TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  mail_id      TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_boss_secret_handoff_created ON boss_secret_handoff (created_at);

-- R4: work that is waiting for a key, by NAME. The key's arrival resumes every row here — the task
-- requeued, the repo change returned to its phase — with no second ask and no new task.
CREATE TABLE IF NOT EXISTS boss_secret_wait (
  id          TEXT PRIMARY KEY,
  secret_name TEXT NOT NULL,
  task_id     TEXT,
  change_id   TEXT,
  created_at  INTEGER NOT NULL,
  resumed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_boss_secret_wait_open ON boss_secret_wait (secret_name, resumed_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_boss_secret_wait_once ON boss_secret_wait (secret_name, COALESCE(task_id, ''), COALESCE(change_id, ''));

-- R6/R16: a notice that names a missing key carries the NAME, so her Mac can look the vault up
-- first (R5) and say it once per task; one notice per (task, kind, key) — `noticeOnce` checks it.
ALTER TABLE boss_task_notices ADD COLUMN secret_name TEXT;

-- R19: her standing constraints — lines she marks `Always:` / `Never:` / `Standing rule:` /
-- `Constraint:` — injected into every employee's prompt. `body_key` is the normalised text, so the
-- same rule said twice is one row (a real uniqueness rule, and the second insert says it joined).
CREATE TABLE IF NOT EXISTS boss_operator_constraint (
  id         TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  body_key   TEXT NOT NULL UNIQUE,
  source     TEXT NOT NULL,
  mail_id    TEXT,
  created_at INTEGER NOT NULL
);

-- R24: a repository she named by its GitHub address that is not on the grid. Recorded BESIDE the
-- grid, never added to it: the grid is her twelve properties and its validator pins it.
CREATE TABLE IF NOT EXISTS boss_repo_registry (
  name          TEXT PRIMARY KEY,
  github_repo   TEXT NOT NULL,
  mail_id       TEXT,
  registered_at INTEGER NOT NULL
);

-- R24/R25: the repo change knows which GitHub repository to clone when the Mac has no checkout.
ALTER TABLE repo_changes ADD COLUMN github_repo TEXT;

-- R27: a DNS record she has to add at a registrar Cloudflare cannot edit. The record is the one the
-- lane READ BACK, never a guess; her Mac re-checks it until it resolves or seven days pass.
CREATE TABLE IF NOT EXISTS boss_dns_wait (
  id            TEXT PRIMARY KEY,
  change_id     TEXT,
  repo          TEXT NOT NULL,
  host          TEXT NOT NULL,
  record_type   TEXT NOT NULL,
  record_name   TEXT NOT NULL,
  record_target TEXT NOT NULL,
  live_at       TEXT,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  checked_at    INTEGER,
  live_seen_at  INTEGER,
  told_at       INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_boss_dns_wait_once ON boss_dns_wait (host, record_type, record_name);

-- R21: a Drive folder named in an ask. Her Mac looks at it on its pass; files that arrive are loaded
-- into the waiting task with no new email, and "still empty" is said ONCE (empty_told_at).
CREATE TABLE IF NOT EXISTS boss_drive_watch (
  id            TEXT PRIMARY KEY,
  task_id       TEXT,
  change_id     TEXT,
  folder_id     TEXT NOT NULL,
  url           TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','loaded','expired')),
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  checked_at    INTEGER,
  empty_told_at INTEGER,
  loaded_at     INTEGER,
  files         INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_boss_drive_watch_once ON boss_drive_watch (folder_id, COALESCE(task_id, ''), COALESCE(change_id, ''));

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('boss_secret_handoff', 'intake', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'An encrypted key she emailed, held only until her Mac moves it into the vault. Ciphertext only; no model ever reads it.'),
  ('boss_secret_wait', 'intake', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'Which work waits for which key, by NAME only. Machinery; never model input.'),
  ('boss_operator_constraint', 'intake', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Her standing constraints, written by her to be read by every employee run; model input is the whole point.'),
  ('boss_repo_registry', 'repo_change', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'A GitHub repository name she gave for Danielle to work in. Public names only.'),
  ('boss_dns_wait', 'repo_change', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'A DNS record read back from Cloudflare for a host she owns, re-checked by her Mac. Machinery; never model input.'),
  ('boss_drive_watch', 'intake', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'A Drive folder id named in an ask, watched by her Mac. Machinery; the files themselves go onto the task, not here.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0279_boss_service_rules_for_every_employee');
