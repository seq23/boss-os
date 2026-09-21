-- Danielle changes a grid repository on the owner's word — Plan B, approved 20 September 2026.
--
-- ─── What she asked for ─────────────────────────────────────────────────────
--
-- She emails boss@sequoiataylor.com with `#danielle`, a repo name from the grid and/or a Google
-- Drive folder, and instructions. Danielle reads the package and the repo's RUNBOOK.md, writes a
-- plan split into "decided" and "ask", emails the asks, waits, builds on her answers in a worktree,
-- proves it with the repo's own validators plus screenshots and link checks, opens a PR, lands it
-- on green (her decision: no second reply), proves it live, and emails the proof.
--
-- ─── Why a sidecar table and not columns on `tasks` ─────────────────────────
--
-- The task is the card she sees; this row is the lane's own state machine — phase, plan, asks,
-- answers, PR, checks, merge, proof, and the claim that makes "one live run per task" a row-level
-- fact. `ask_scans` (0264) and `outreach_rewrites` (0261) take the same shape for the same reason:
-- a task's `input` is a document, and a state machine written into a document is a state machine
-- nobody can query.
--
-- ─── The phases ─────────────────────────────────────────────────────────────
--
--   plan     → claimable by the Mac; Opus reads the package and writes the plan
--   asking   → the plan and its questions are in her inbox; nothing runs
--   build    → her reply is on the record; claimable; Sonnet builds and opens the PR
--   landing  → the PR is open and its checks are not yet recorded green; the Mac polls
--   land     → checks recorded green; claimable; the cheapest rung runs ~/bin/land and the proof
--   done     → the DONE email went, with the PR, the merge commit and the live proof
--   failed   → a named stop; the reason is on the row and in her inbox
--
-- Her reply is ONE WORD (21 Sep 2026: "the approval step must have zero friction"): "approved"
-- (or approve / yes / go / land it) takes the recommended default for every ask and starts BUILD;
-- a reply starting "no" / "not approved" / "stop" / "changes:" holds; anything else is her answers.
-- `readReply`, `canEnterBuild` and `canLand` in src/shared/boss/repoChange/lane.mjs are the only rules for
-- moving between them; `validate:repo-lane` proves them against fixture rows and against the code
-- that hands out claims.

CREATE TABLE repo_changes (
  id               TEXT PRIMARY KEY,
  task_id          TEXT NOT NULL,
  mail_id          TEXT,                       -- the boss_inbound_mail row that opened it, when mail did
  -- What she named. At least one of the two is present, by intake's rule.
  repo             TEXT,                       -- a grid repo, bare name (e.g. WPP-llm)
  property_key     TEXT,                       -- the grid property it belongs to
  drive_folder     TEXT,                       -- the Drive folder id of the package, if one was linked
  drive_url        TEXT,
  instruction      TEXT NOT NULL,              -- her words, in full
  phase            TEXT NOT NULL CHECK (phase IN ('plan','asking','build','landing','land','done','failed')),
  -- PLAN
  plan_text        TEXT,                       -- the plan as written, markdown
  decided_json     TEXT,                       -- JSON list of decisions Danielle made and recorded
  asks_json        TEXT,                       -- JSON list of questions for her (may be empty)
  planned_at       INTEGER,
  plan_written_by  TEXT,                       -- the model that wrote it
  -- ASK / ANSWER
  asked_at         INTEGER,                    -- when the plan email went
  ask_message_id   TEXT,                       -- the provider's id for that email
  answered_at      INTEGER,                    -- when her reply arrived; THE plan approval
  answers_text     TEXT,                       -- her reply, readable text
  answers_mode     TEXT CHECK (answers_mode IN ('approved','answers')),  -- one word = every default; else her answers
  answer_mail_id   TEXT,                       -- the boss_inbound_mail row of her reply
  -- A reply that starts "no" / "not approved" / "stop" / "changes:" HOLDS the task in `asking`.
  held_at          INTEGER,
  held_text        TEXT,
  -- BUILD
  branch           TEXT,
  pr_url           TEXT,
  pr_number        INTEGER,
  built_at         INTEGER,
  build_written_by TEXT,
  proof_json       TEXT,                       -- validators run, screenshots, links checked
  -- CHECKS / LAND
  checks_state     TEXT,                       -- 'pending' | 'green' | 'red', as last recorded
  checks_detail    TEXT,
  checks_green_at  INTEGER,                    -- set only by the lane, from `gh pr checks`, never assumed
  merge_sha        TEXT,
  landed_at        INTEGER,
  live_proof_json  TEXT,                       -- the curls against production after the deploy
  -- ONE LIVE RUN PER TASK
  claimed_at       INTEGER,
  claimed_by       TEXT,                       -- the device id
  claimed_phase    TEXT,
  run_log          TEXT,                       -- path of the run log on her Mac, for the DONE email
  -- DONE / FAILED
  done_at          INTEGER,
  done_message_id  TEXT,
  failure          TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX idx_repo_changes_phase ON repo_changes(phase, updated_at);
CREATE UNIQUE INDEX idx_repo_changes_task ON repo_changes(task_id);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('repo_changes', 'engineering', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Her instruction for a change to one of her own public sites, the plan, her answers and the PR that resulted. Nothing here names a counterparty or a deal; the code it changes is public on GitHub.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0265_boss_danielle_changes_a_repo_on_her_word');
