-- WHAT COUNTS AS PRIVATE (owner ruling, 4 Nov 2026): "private model only" means ONLY the names of LPs
-- who have COMMITTED to a West Peek fund, and deal terms. LP PROSPECTS (outreach, intro emails,
-- replies before a commitment, meeting prep, research on them) are public-model-approved.
--
-- Neither the people who answered (lp_reply_drafts) nor the prospects she writes to (prospects)
-- recorded a commitment, so both gain `committed_at` (epoch ms, NULL = not committed). The router's
-- private-name lexicon (router/modelAccess.ts PRIVATE_SOURCES) reads those two tables only for rows
-- with a commitment; `lps` keeps every row past "prospect"; the chassis LP tables are unchanged.
-- Additive: no row changes, nothing is dropped.
ALTER TABLE lp_reply_drafts ADD COLUMN committed_at INTEGER;
ALTER TABLE prospects ADD COLUMN committed_at INTEGER;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0339_boss_committed_lps_stay_private');
