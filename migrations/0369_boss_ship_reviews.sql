-- 0369 · THE SHARED SHIP-READY REVIEWER (owner, 19 Nov 2026, personal brain "VETERAN QUALITY BAR,
-- HANDS-OFF"; the Friday grid row 6f).
--
-- quality_reads stays the ONE store of a fresh reader's verdict on real output. Until now it held only
-- the monthly read (holds | slipped). It now also holds the shared reviewer's verdicts (kind 'ship':
-- PASS | FAIL on a page, email, video or profile), with who built it, exactly what was looked at and
-- the numbered findings. `deliverable` is the review's subject key. drift.ts reads kind 'monthly' only.
--
-- Additive: four new columns; existing rows read as kind 'monthly'. Nothing is rewritten.
ALTER TABLE quality_reads ADD COLUMN kind TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE quality_reads ADD COLUMN builder TEXT;
ALTER TABLE quality_reads ADD COLUMN looked_at TEXT;
ALTER TABLE quality_reads ADD COLUMN findings TEXT;
CREATE INDEX IF NOT EXISTS idx_quality_reads_subject ON quality_reads(kind, deliverable, at DESC);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0369_boss_ship_reviews');
