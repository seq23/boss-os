-- ─── A FAILED POST-LAND STEP IS HER EMPLOYEE'S REWORK, NOT HER EMAIL ───────
--
-- 21 Sep 2026, rc_m32h8ze2a4hk37pc: the post-land step (Danielle's own loop/channel_about.py, from
-- her own PR #102) failed with HTTP 400 — a 2,192-character About text against YouTube's 1,000 —
-- and the lane emailed the owner a named stop. Her ruling: things Danielle can fix herself never
-- reach her. So a failed post-land step now sends the row back to `build` as a REWORK: the failure
-- output is the brief, a fix PR is opened and landed, the step runs again. `MAX_REWORKS` (shared
-- lane.mjs) bounds it; only a spent budget becomes her email, listing every attempt.
--
--   rework_count         — how many reworks this row has been through (the Worker refuses past the cap).
--   rework_note          — the last failure output, the brief for the current build.
--   reworked_merge_shas  — JSON list of the merge commits whose post-land step failed, oldest first.

ALTER TABLE repo_changes ADD COLUMN rework_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE repo_changes ADD COLUMN rework_note TEXT;
ALTER TABLE repo_changes ADD COLUMN reworked_merge_shas TEXT;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0271_boss_a_failed_post_land_step_is_her_employees_rework');
