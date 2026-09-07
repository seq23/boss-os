-- Two columns that stop the agenda becoming fiction.
--
-- ─── 1. Did the first money move actually happen? ───────────────────────────
--
-- The Morning Gate now proposes an anchor every day and NOTHING EVER ASKS WHETHER IT HAPPENED. A
-- system in that state can propose the same first money move for two weeks, watch it go undone
-- every time, and keep proposing it with total confidence. The agenda stops describing her life and
-- starts describing its own intentions — which is worse than no agenda, because it looks like one.
--
-- The Night Gate already scores five floors. It never asked about the anchor, which is the single
-- line the whole morning is built around.
--
-- §14.2 GOVERNS HOW THIS IS ANSWERED: "Ask what was completed before assigning a verdict. DO NOT
-- GUESS COMPLETION." So this comes from her and only from her. A closed Run of Show block is not
-- evidence the touch happened; a logged movement is not evidence of anything else. Unanswered stays
-- `unknown` and is carried forward as an open question rather than rounded to either side.
--
-- WHY IT IS WORTH A COLUMN RATHER THAN A LINE IN THE NIGHT JSON: the value is entirely in the
-- SEQUENCE. One missed anchor is a Tuesday. Four in five days is the thing she asked this system to
-- notice on her behalf, and noticing it means querying across days.

ALTER TABLE days ADD COLUMN anchor_outcome TEXT; -- done | missed | unknown
ALTER TABLE days ADD COLUMN anchor_note TEXT;

-- ─── 2. How long has this deal been sitting here? ──────────────────────────
--
-- Her three symptoms were: nothing closing, thin top of funnel, deals stalling or falling through.
-- The sourcing sweep addresses the second. The first and third are the same instrument — age in
-- stage — and `deals` could not measure it: it has `stage` and `updated_at`, and `updated_at` moves
-- for any edit at all, so a note added to a stalled deal makes it look freshly worked.
--
-- `stage_since` moves only when the stage does. That is the difference between "I touched this
-- record" and "this deal advanced", and it is the only one of the two worth alarming on.
--
-- WHY AGE AND NOT A REMINDER. A reminder is something she sets, on a deal she is already thinking
-- about — which is never the one that quietly dies. Age is computed for every deal whether or not
-- anyone remembered it, which is exactly the coverage a stalling problem needs.

ALTER TABLE deals ADD COLUMN stage_since INTEGER;

-- Existing rows get their opened_at as a floor rather than NULL, so a deal that predates this
-- column reads as "at least this old" instead of "unknown, therefore fine". There are no rows
-- today, but a migration that would silently exempt old data from a new alarm is the wrong shape
-- whether or not it happens to matter this time.
UPDATE deals SET stage_since = COALESCE(stage_since, opened_at) WHERE stage_since IS NULL;

CREATE INDEX idx_deals_stage_age ON deals(stage, stage_since);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0188_boss_anchor_close_and_stage_age');
