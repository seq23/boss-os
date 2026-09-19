-- 0261 — A letter she sends back with a note is REWRITTEN to answer the note, in minutes, and she
--        can watch it happen.
--
-- ─── Her words, 19 September 2026, ~13:00 CT ─────────────────────────────────
--
--   "I just rejected the 13 again and gave it my notes and I don't see it working on re-writing
--    them."
--
-- ─── What production shows (read-only, the same afternoon) ───────────────────
--
-- Two batches in `approval_batches`. The second, apb_m2x9y0t8yq0tfpe0 at 1789837378376, carried a
-- real note: name the companies she is currently working on (Anthropic, ByteDance, OpenAI,
-- Polymarket, Higgsfield, Moonshot, Sandbox, Neuralink) and hyperlink her LinkedIn where the
-- letter says Spry VC. All thirteen decisions executed, and every one of the thirteen
-- `approval_events.executed` rows says the same thing: "Sent back and your reason is on the
-- record. No new letter to <firm>: it would be word-for-word the one you sent back."
--
-- Nothing ran, nothing queued, nothing failed. The redraft path was `composeOutreach`, which is a
-- deterministic composition from the candidate row — it cannot read a note, so the only letter it
-- could produce was the one she had just rejected, and the twin guard from 0259/#27 correctly
-- refused to raise it. Her note was recorded on `buyer_outreach_drafts.her_note` (attempt 3, all
-- thirteen, state try_again) and answered by nobody. That is the whole finding: the rewrite was a
-- template, and a template cannot answer a note.
--
-- ─── What this migration is for ──────────────────────────────────────────────
--
-- One row per rewrite the system owes her. It is created the moment she sends a letter back with
-- a note (or presses "Rewrite the N with my notes" on the desk), it names the note it answers, and
-- it moves through states she can read on the Capital desk and above the letters in her Inbox:
--
--   queued   — the rewrite task is on the Worker's own queue (boss_task_queue). No Mac slot, no
--              hour-long wait: the request that queued it drains it after the response, and the
--              progress poll drains it too.
--   running  — the model call is in flight on the ladder. The letter is `private_model_only` (it
--              goes out under her name to a counterparty and names the companies she is working),
--              so it lands on the first non-training rung — Workers AI, $0 inside the allowance.
--   ready    — a DIFFERENT letter, answering the note, is in her Inbox as attempt N+1;
--              `result_draft_id` names it.
--   failed   — the model's letter broke a rule (an address, the word "broker", a claim about her
--              book she did not state, identical to a rejected one) twice, or the route refused;
--              `failure` says which, on the card, and the note stays on the record.
--
-- `notes_all` is every note she has written on this firm, oldest first: each is a standing
-- instruction, and a rewrite that honours the second note and forgets the first is the boomerang
-- with better manners.
CREATE TABLE outreach_rewrites (
  id               TEXT PRIMARY KEY,
  candidate_id     TEXT NOT NULL REFERENCES sourcing_candidates(id) ON DELETE CASCADE,
  -- The attempt she sent back — the letter being rewritten.
  source_draft_id  TEXT NOT NULL REFERENCES buyer_outreach_drafts(id) ON DELETE CASCADE,
  -- The note this rewrite answers (the latest), and every note on the firm in order (JSON list).
  her_note         TEXT NOT NULL,
  notes_all        TEXT NOT NULL,
  -- The bulk rejection this came from, when it came from one.
  batch_id         TEXT REFERENCES approval_batches(id),
  task_id          TEXT,
  state            TEXT NOT NULL CHECK (state IN ('queued','running','ready','failed')),
  result_draft_id  TEXT,
  written_by       TEXT,
  cost_micros      INTEGER NOT NULL DEFAULT 0,
  failure          TEXT,
  requested_at     INTEGER NOT NULL,
  started_at       INTEGER,
  finished_at      INTEGER,
  updated_at       INTEGER NOT NULL
);
-- One open rewrite per sent-back letter: pressing the desk button twice cannot queue two.
CREATE UNIQUE INDEX idx_outreach_rewrites_source ON outreach_rewrites(source_draft_id);
CREATE INDEX idx_outreach_rewrites_state ON outreach_rewrites(state, requested_at);

-- The note and the letter are her words about her own outreach; the model sees them on a
-- non-training rung only (router: private_model_only), which is the routing rule rather than the
-- storage rule. Storage: CLOUD_SYNC like the drafts it points at.
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('outreach_rewrites', 'wealth', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'A rewrite the system owes her: which sent-back letter, which note it answers, where it is. The letter text lives in buyer_outreach_drafts; the router confines the rewrite itself to non-training rungs.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0261_boss_the_rewrite_answers_her_note');
