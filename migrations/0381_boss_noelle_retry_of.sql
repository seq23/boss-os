-- 0381 · A NOELLE RETRY NAMES THE RUN IT RETRIES (24 Nov 2026; brief noelle-v2, "a retry is a new row (retry_of)").
--
-- A stopped run is retried as a new slot (a new row), so /done is never refused for it. retry_of links the
-- new row to the stopped run of the same day it follows, so the Growth page and the 3-days-stopped alarm
-- can tell "stopped, then recovered" from two separate runs. Additive: one nullable column.

ALTER TABLE noelle_runs ADD COLUMN retry_of TEXT;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0381_boss_noelle_retry_of');
