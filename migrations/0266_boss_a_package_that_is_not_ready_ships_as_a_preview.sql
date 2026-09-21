-- A package that is not publish-ready lands only after she has seen the preview.
--
-- Owner, 21 September 2026. Some packages are not ready to publish: a placeholder or a TODO would
-- ship, or the honest default for an ask is "placeholder until supplied". For those, land-on-green
-- is the wrong rule — the PR goes up, she gets the preview, and the landing waits for a SECOND
-- "approved". She can also force the preview on a ready plan by replying "preview".
--
--   publish_ready     the PLAN phase's verdict, required on every plan report (0/1)
--   placeholders_json what would ship as a placeholder, by name
--   preview_forced    she replied "preview" / "preview only" / "preview first" to the plan
--   preview_*         the preview email: the URL (Pages) or null (a Workers repo has none), when, its id
--   land_approved_*   her second "approved", AFTER the preview email — one of exactly two things
--                     that let a not-ready change reach LAND. "preview" never sets it.
--   forced_*          the other: her explicit "approved to production" (force production / ship it
--                     anyway / land anyway), from her verified address only. Who, when, and the
--                     placeholders she chose to ship. A finding names it; the DONE email leads with it.
--
-- Two new phases: `preview` (PR open; the Mac sends the preview email) and `previewing` (waiting on
-- her second word). `needsPreview` / `canLand` in src/shared/boss/repoChange/lane.mjs are the rule.

-- SQLite cannot widen a CHECK in place. The table is rebuilt with the two new phases and the new
-- columns; every existing column and index is carried across, and the classification row is unchanged.
CREATE TABLE repo_changes_new (
  id               TEXT PRIMARY KEY,
  task_id          TEXT NOT NULL,
  mail_id          TEXT,
  repo             TEXT,
  property_key     TEXT,
  drive_folder     TEXT,
  drive_url        TEXT,
  instruction      TEXT NOT NULL,
  phase            TEXT NOT NULL CHECK (phase IN ('plan','asking','build','preview','previewing','landing','land','done','failed')),
  plan_text        TEXT,
  decided_json     TEXT,
  asks_json        TEXT,
  planned_at       INTEGER,
  plan_written_by  TEXT,
  asked_at         INTEGER,
  ask_message_id   TEXT,
  answered_at      INTEGER,
  answers_text     TEXT,
  answers_mode     TEXT CHECK (answers_mode IN ('approved','answers','preview','forced')),
  answer_mail_id   TEXT,
  held_at          INTEGER,
  held_text        TEXT,
  branch           TEXT,
  pr_url           TEXT,
  pr_number        INTEGER,
  built_at         INTEGER,
  build_written_by TEXT,
  proof_json       TEXT,
  checks_state     TEXT,
  checks_detail    TEXT,
  checks_green_at  INTEGER,
  merge_sha        TEXT,
  landed_at        INTEGER,
  live_proof_json  TEXT,
  claimed_at       INTEGER,
  claimed_by       TEXT,
  claimed_phase    TEXT,
  run_log          TEXT,
  done_at          INTEGER,
  done_message_id  TEXT,
  failure          TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  publish_ready    INTEGER,
  placeholders_json TEXT,
  preview_forced   INTEGER NOT NULL DEFAULT 0,
  preview_url      TEXT,
  preview_sent_at  INTEGER,
  preview_message_id TEXT,
  land_approved_at INTEGER,
  land_approval_text TEXT,
  land_approval_mail_id TEXT,
  forced_by        TEXT,
  forced_at        INTEGER,
  forced_placeholders TEXT,
  forced_mail_id   TEXT
);
INSERT INTO repo_changes_new (
  id, task_id, mail_id, repo, property_key, drive_folder, drive_url, instruction, phase,
  plan_text, decided_json, asks_json, planned_at, plan_written_by, asked_at, ask_message_id,
  answered_at, answers_text, answers_mode, answer_mail_id, held_at, held_text,
  branch, pr_url, pr_number, built_at, build_written_by, proof_json, checks_state, checks_detail, checks_green_at,
  merge_sha, landed_at, live_proof_json, claimed_at, claimed_by, claimed_phase, run_log,
  done_at, done_message_id, failure, created_at, updated_at)
SELECT
  id, task_id, mail_id, repo, property_key, drive_folder, drive_url, instruction, phase,
  plan_text, decided_json, asks_json, planned_at, plan_written_by, asked_at, ask_message_id,
  answered_at, answers_text, answers_mode, answer_mail_id, held_at, held_text,
  branch, pr_url, pr_number, built_at, build_written_by, proof_json, checks_state, checks_detail, checks_green_at,
  merge_sha, landed_at, live_proof_json, claimed_at, claimed_by, claimed_phase, run_log,
  done_at, done_message_id, failure, created_at, updated_at
FROM repo_changes;
DROP TABLE repo_changes;
ALTER TABLE repo_changes_new RENAME TO repo_changes;
CREATE INDEX idx_repo_changes_phase ON repo_changes(phase, updated_at);
CREATE UNIQUE INDEX idx_repo_changes_task ON repo_changes(task_id);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0266_boss_a_package_that_is_not_ready_ships_as_a_preview');
