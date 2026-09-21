-- ─── A POST-LAND STEP IS A RECORDED COMMAND, AND A RETRY RESUMES WHERE IT STOPPED ───
--
-- 21 Sep 2026, rc_m32h8ze2a4hk37pc: how-we-know PR #102 landed as 4a4de65 and the row failed with
-- "the post-land step you asked for failed: `undefined` exited undefined". The plan had named the
-- step in prose ("After land: loop/channel_about.py pushed from the Mac") and nothing recorded it as
-- a command; the LAND phase wrote `post_land: {status: "not_invoked"}` and the runner read a missing
-- exit code as a failure. So:
--
--   post_land_command  — the exact command the PLAN phase resolved from her instruction or its own
--                        plan, recorded when the plan is filed. A plan whose text names a post-land
--                        step and resolves no command is refused at PLAN time — a named stop before
--                        anything is built, never after the merge.
--   post_land_proof    — what the step must produce to count as done, in the plan's words.
--
-- The row that hit this is put back to `land` with its command recorded; the runner sees the
-- landed-post-land-failed.json on the Mac, skips the merge it already made, runs only the step and
-- sends the DONE email with the About-text proof.

ALTER TABLE repo_changes ADD COLUMN post_land_command TEXT;
ALTER TABLE repo_changes ADD COLUMN post_land_proof TEXT;

UPDATE repo_changes
   SET phase = 'land', failure = NULL, claimed_at = NULL, claimed_by = NULL, claimed_phase = NULL,
       post_land_command = '.venv/bin/python loop/channel_about.py',
       post_land_proof = 'a fresh channels.list read showing the widened About text, plus a public fetch of youtube.com/@howweknowdeep containing "materials"',
       updated_at = 1790025600000
 WHERE id = 'rc_m32h8ze2a4hk37pc' AND phase = 'failed';
UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL
 WHERE id = (SELECT task_id FROM repo_changes WHERE id = 'rc_m32h8ze2a4hk37pc' AND phase = 'land');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0270_boss_a_post_land_step_is_a_recorded_command');
