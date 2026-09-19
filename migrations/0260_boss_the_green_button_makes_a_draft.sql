-- 0260 — The green button makes a Gmail draft. Nothing here sends.
--
-- ─── Her words, 19 September 2026 ────────────────────────────────────────────
--
--   "it should never send — the green button should be to create the draft."
--
-- The primary action on a letter in her Inbox is now "Create the draft in my Gmail". The Worker
-- impersonates staylor@spry.vc with the gsc-bot service account under the `gmail.compose` scope
-- the owner granted the same day, calls `users.drafts.create`, and records the draft id here. She
-- reads it once more in Gmail and presses Send there, herself. There is no send transport on this
-- path, the effect module names none, and `scripts/validate/the-inbox-draft-never-sends.mjs` fails
-- the build if one appears.
--
-- ─── States ──────────────────────────────────────────────────────────────────
--
--   requested — her press was recorded; the call to Gmail has not returned yet.
--   created   — the draft exists in her mailbox; `gmail_draft_id` names it.
--   blocked   — a NAMED STOP: the Worker has no Google key, or the grant is missing (a 403 is a
--               grant that has not propagated, not a bug). `failure_code` names which.
--   failed    — Gmail refused for another reason; `failure_detail` carries the status and text.
CREATE TABLE gmail_drafts (
  id                TEXT PRIMARY KEY,
  outreach_draft_id TEXT NOT NULL REFERENCES buyer_outreach_drafts(id) ON DELETE CASCADE,
  candidate_id      TEXT NOT NULL,
  mailbox           TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN ('requested','created','blocked','failed')),
  gmail_draft_id    TEXT,
  gmail_message_id  TEXT,
  failure_code      TEXT,
  failure_detail    TEXT,
  requested_at      INTEGER NOT NULL,
  created_at        INTEGER,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_gmail_drafts_outreach ON gmail_drafts(outreach_draft_id, updated_at);

-- LOCAL_ONLY? No: it holds no letter and no address — the letter is in buyer_outreach_drafts and
-- the recipient is a hint, never an address. What it holds is a Gmail draft id and a state, which
-- is a fact about her own mailbox. LOCAL_ONLY processing: there is nothing here a model could use.
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('gmail_drafts', 'wealth', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'The id and state of a draft the Worker created in her own Gmail mailbox on her press. No letter text, no address; the letter lives in buyer_outreach_drafts.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0260_boss_the_green_button_makes_a_draft');
