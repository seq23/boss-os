-- An employee that cannot understand an instruction ASKS, and the question is findable afterwards.
--
-- Owner, 11 September 2026: "can u make it so that if simone doesnt understand something she emails
-- back for clarity".
--
-- ─── WHAT ACTUALLY WENT WRONG ───────────────────────────────────────────────
--
-- The message that caused this did not error. It was routed correctly, taken by the right employee,
-- handed to a language model, and came back CONFIDENT AND WRONG: "#Monique - Please add searching
-- for buyers of Databricks to the weekly list" became "It appears that you're referring to a set of
-- instructions or a to-do list related to managing a meeting or interaction with a superior,
-- possibly a 'Boss'", and sat in her approval queue as though it were considered work.
--
-- Silence and a wrong answer are both worse than a question. So the check happens BEFORE the model
-- task is created, never after: a clarification sent alongside a hallucination is worse than either
-- alone, because she then has to decide which of her own employees to believe.
--
-- ─── WHY TWO COLUMNS AND NOT A TABLE ────────────────────────────────────────
--
-- A question is a property of an arrival, not a thing in its own right. `boss_inbound_mail` already
-- holds every arrival, its outcome and its reply — a separate `questions` table would be a second
-- list of the same events with no link, which is this system's most-repeated defect. The outcome
-- column already carries NEEDS_CLARITY; these two columns are what make an UNANSWERED question
-- findable a week later rather than merely recorded.
--
--   message_id  — the RFC 5322 Message-ID of HER message, so her reply can be matched to it by the
--                 References/In-Reply-To chain her mail client writes. Without it "did she answer"
--                 is unanswerable and the alert would nag at a question she already replied to.
--   answered_at — set when a later message from her references it. Read by the Today alert, which
--                 is EVALUATED ON READ for the same reason the live-book nag is: a question fired
--                 into the void and never checked is the "runs but inert" defect with a nice face.

ALTER TABLE boss_inbound_mail ADD COLUMN message_id TEXT;
ALTER TABLE boss_inbound_mail ADD COLUMN answered_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_boss_inbound_mail_unanswered
  ON boss_inbound_mail(outcome, answered_at, received_at DESC);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0228_boss_an_employee_who_does_not_understand_asks');
