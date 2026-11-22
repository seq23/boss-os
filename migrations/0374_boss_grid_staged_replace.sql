-- 22 Nov 2026 — THE DEALS GRID AND THE MATCHES ARE REPLACED WHOLE OR NOT AT ALL (eng sweep row 10).
--
-- A replace used to delete every row, then insert the new ones in separate 100-statement batches
-- and separate 500-row HTTP pushes, so a failure part-way left her a half-written grid. Now each
-- push is staged here under one push id, and the LAST part swaps it in with one D1 batch (one SQL
-- transaction): delete the live rows and copy the staged ones, both guarded on the staged count
-- equalling the total the Mac declared. A part that never arrives leaves the old grid whole; a
-- staged push older than a day is swept by the next commit. Additive only.

CREATE TABLE IF NOT EXISTS capital_deal_rows_staging (
  push_id         TEXT NOT NULL,
  id              TEXT NOT NULL,
  company         TEXT NOT NULL,
  side            TEXT NOT NULL,
  direction       TEXT NOT NULL,
  size_usd        REAL,
  size_text       TEXT NOT NULL,
  price_text      TEXT NOT NULL,
  structure_text  TEXT NOT NULL,
  from_text       TEXT NOT NULL,
  rainmaker       INTEGER NOT NULL,
  received_on     TEXT NOT NULL,
  email_url       TEXT,
  parties         TEXT NOT NULL,
  staged_at       INTEGER NOT NULL,
  PRIMARY KEY (push_id, id)
);

CREATE TABLE IF NOT EXISTS capital_matches_staging (
  push_id    TEXT NOT NULL,
  key        TEXT NOT NULL,
  company    TEXT NOT NULL,
  rank       INTEGER NOT NULL,
  payload    TEXT NOT NULL,
  staged_at  INTEGER NOT NULL,
  PRIMARY KEY (push_id, key)
);
CREATE INDEX IF NOT EXISTS idx_capital_deal_rows_staging_at ON capital_deal_rows_staging (staged_at);
CREATE INDEX IF NOT EXISTS idx_capital_matches_staging_at ON capital_matches_staging (staged_at);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('capital_deal_rows_staging', 'capital', 'LOCAL_ONLY', 'LOCAL_ONLY', 'A deal-grid push on its way in: the same rows as capital_deal_rows, held until the last part swaps them in whole.'),
  ('capital_matches_staging', 'capital', 'CLOUD_SYNC', 'LOCAL_ONLY', 'A matches push on its way in: the same rows as capital_matches, held until the last part swaps them in whole.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0374_boss_grid_staged_replace');
