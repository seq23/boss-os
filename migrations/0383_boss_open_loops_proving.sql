-- OPEN LOOPS: "LANDED, WAITING ON PROOF" (owner, 27 Nov 2026: "we need a new section on open loops for
-- the not yet proven stuff and move it off the main list"). ADDITIVE ONLY: one nullable column.
-- owner_open_loops.section has no CHECK constraint (0331), so the new value `proving` needs no schema
-- change; the rule lives in src/shared/boss/openLoops/openLoops.mjs (SECTIONS, proofPrProblem).
-- `proof_pr` is the PR whose next-day live check decides the row ("owner/repo#123"): ~/bin/post-land-check
-- closes the row on PASS and returns it to the main list marked NOT WORKING on FAIL.
ALTER TABLE owner_open_loops ADD COLUMN proof_pr TEXT;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0383_boss_open_loops_proving');
