-- 0259 — One reason, many dockets.
--
-- ─── Her words, 19 September 2026 ────────────────────────────────────────────
--
--   "The inbox needs an overhaul. I need to be able to reject all things at once with an
--    overarching reason why — right now I had 13 messages to reject."
--
-- CONFIRMED ON PRODUCTION THE SAME DAY: thirteen `judgement_call` approvals rejected one at a time
-- between 1789827048305 and 1789827130515 — the first with a real reason, the next with "same as
-- the previous notes", and eleven more with the single word "same". Eleven records now carry a
-- reason that means nothing on its own.
--
-- ─── What a batch is, and what it is not ─────────────────────────────────────
--
-- A batch is ONE act of hers with ONE reason, applied to N dockets. It is NOT one decision row:
-- every docket still gets its own `approvals.status`, its own `approval_events` row and its own
-- audit entry through the same `/approvals/:id/decide` route a single press uses — "AI prepares,
-- humans decide" holds per item, and each record reads as a decision about that item. What this
-- table adds is the shared reason and the count, so the eleven "same"s become eleven records that
-- each say the whole sentence and point at the act that produced them.
--
-- `decision` is REJECTED ONLY, by design. Approving is judging work she has looked at, and thirteen
-- letters approved as one act are thirteen letters she may not have read. Rejecting with a reason
-- sends nothing anywhere and loses nothing but a card, so it is the one verdict that may be given
-- to many at once. If that ever changes it changes here, in the CHECK, with a reason.
CREATE TABLE approval_batches (
  id              TEXT PRIMARY KEY,
  decision        TEXT NOT NULL CHECK (decision IN ('rejected')),
  -- The overarching reason. The route refuses fewer than 12 characters: "same" is the defect.
  reason          TEXT NOT NULL,
  requested_count INTEGER NOT NULL,
  done_count      INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- Each item names the act it belonged to, so a docket's own record shows the shared reason AND
-- that it was one of N.
ALTER TABLE approvals ADD COLUMN batch_id TEXT REFERENCES approval_batches(id);
CREATE INDEX idx_approvals_batch ON approvals(batch_id);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('approval_batches', 'approvals', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'One act of hers with one reason, applied to many dockets. LOCAL_ONLY processing: her verdict and her reason are her own words about her employees'' work and never go to a model.')
ON CONFLICT(entity) DO NOTHING;
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'approval_batches';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0259_boss_one_reason_for_many_dockets');
