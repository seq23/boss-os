-- 24 October 2026 — her NeverBounce verdict on every prospect address, kept where the plan reads it.
--
-- The bounce brake (14-day rate over 3%) paused every prospect email, so the email waiting for her
-- Approve would have sent nothing. Now, while the brake is on, only addresses NeverBounce called
-- "valid" go; catch-all, unknown and never-checked addresses wait until the rate recovers. Every
-- touch (first email and follow-ups) needs a verdict on record. The Mac checks the addresses that are
-- due (lp-prospects.mjs → POST /lp/prospects/verdicts) within a per-run credit cap.
ALTER TABLE prospects ADD COLUMN nb_result TEXT;      -- valid | catchall | unknown | invalid | disposable
ALTER TABLE prospects ADD COLUMN nb_checked_at INTEGER;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0302_boss_prospect_neverbounce');
