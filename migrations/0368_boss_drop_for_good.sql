-- 0368 · DROP FOR GOOD (owner, 18 Nov 2026: "every item in every block has a one-tap Drop for good, and
-- replying 'drop Ron Brooks' / 'drop 2' does the same").
--
-- decide_dismissed stays the ONE store of what she dismissed (Today's waiting list already reads it);
-- it now keeps what the item was (label) and how she dropped it (via: tap · reply · today).
--
-- morning_drop_taps: one random token per item per morning, minted by the morning run and posted with
-- the kept morning (routes/morning.ts). The tap page acts on POST only (routes/lpTap.ts).
--
-- Additive: two new columns and one new table. Nothing is rewritten.
ALTER TABLE decide_dismissed ADD COLUMN label TEXT;
ALTER TABLE decide_dismissed ADD COLUMN via TEXT;

CREATE TABLE IF NOT EXISTS morning_drop_taps (
  token       TEXT PRIMARY KEY,
  day         TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  label       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_morning_drop_taps_day ON morning_drop_taps(day);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('morning_drop_taps', 'today', 'LOCAL_ONLY', 'LOCAL_ONLY', 'One-tap "Drop for good" tokens from the morning email: a token, the item id and its short label.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0368_boss_drop_for_good');
