-- The morning coaching conversation, without loosening anything sovereign.
--
-- THE PROBLEM. Her §15.6 requires Mandatory Morning Coaching: "1-5 short exchanges, one question at
-- a time" about readiness, resistance, emotional state and launch friction. That content is exactly
-- what `emotional_states` holds, and `emotional_states` is LOCAL_ONLY on BOTH axes - so under §3.3
-- it may not enter cloud D1 and may not reach Claude, OpenAI, OpenRouter, Fireworks or Workers AI.
-- The only eligible backend is the local runtime, which is Batch 2, which she has deferred.
--
-- She asked the right question: can a conversation be locked down without a local model? The answer
-- is that "locked down" is TWO questions, which is why the airlock has two axes. Where it is STORED
-- she can control absolutely. What the model READS she cannot - a model must see a sentence to
-- answer it, and no contract turns that into a mechanism.
--
-- WHAT THIS DOES NOT DO: loosen `emotional_states`. That table also backs the decision vault, the
-- prediction vault, manifestations and promoted memory. Reclassifying it to get one feature would
-- open all of them, and none of those needed opening.
--
-- WHAT IT DOES INSTEAD, and the shape is the point:
--
--   THE CONVERSATION IS NEVER STORED SERVER-SIDE AT ALL. There is no coaching_turns table here and
--   there deliberately never will be one in the cloud domain. Turns live in the browser, on her
--   device, and the endpoint that reaches a model stores nothing. That is LOCAL_ONLY residency
--   honoured literally rather than by a classification on a row that sits in Cloudflare's database.
--
--   ONLY TWO THINGS PERSIST, and neither is her interior life:
--     - her CONSENT for the day, which is a governance record, not content;
--     - the day's MODE, which is an operating fact. "Today is a Recovery Day" is a decision about
--       how the system should behave; it is not a disclosure of how she feels, and the whole system
--       already needs it to apply her floors.

-- ─── Consent, per day, per backend ───────────────────────────────────────────
--
-- ONCE A DAY, NOT ONCE A TURN. Her spec says the coaching is mandatory and brief; a permission
-- dialog before each of five exchanges would make the thing she must do every morning the thing she
-- avoids. One deliberate act, scoped to one day and one backend, recorded.
--
-- Consent is NOT an override of the kind §3.3 forbids. That clause bans a runtime button that
-- converts a sovereign request into external inference - and `airlock.ts` has no loosen() at all,
-- only tightening, with the tightest of the two settings always winning. This is the
-- EXTERNAL_WITH_APPROVAL path the second axis exists to express, exercised deliberately and left in
-- a record anyone can read.
CREATE TABLE coaching_consent (
  day_id        TEXT PRIMARY KEY,
  granted_at    INTEGER NOT NULL,
  granted_by    TEXT NOT NULL DEFAULT 'boss',
  -- Which backend she agreed to. Consent to Claude Code on her own Mac is not consent to OpenRouter,
  -- and a system that treated them as one would be deciding something she did not.
  backend_id    TEXT NOT NULL,
  -- Withdrawn stays a row. A consent that vanishes leaves no evidence it was ever given, and no
  -- evidence of when she took it back.
  revoked_at    INTEGER
);

-- ─── The day's mode ──────────────────────────────────────────────────────────
--
-- Canon §14's three verdicts are for the NIGHT gate, scoring what happened. This is the morning
-- counterpart: how the day should be run, which her Core Law 6 (Minimum Viable Day) and §17
-- (Recovery Protocol) both turn on. A Recovery Day rewrites all four pillar contracts to floors, so
-- the system has to know before it renders the agenda, not after.
ALTER TABLE days ADD COLUMN day_mode TEXT
  CHECK (day_mode IS NULL OR day_mode IN ('full','mvd','recovery'));
ALTER TABLE days ADD COLUMN day_mode_set_at INTEGER;
-- How the mode was arrived at: 'coaching' when the conversation produced it, 'declared' when she
-- said so outright. An inferred mode and a stated one are different claims and the day plan should
-- not pretend otherwise.
ALTER TABLE days ADD COLUMN day_mode_source TEXT;

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('coaching_consent', 'coaching', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'A governance record: that she consented, when, and to which backend. Holds no coaching content, so there is nothing here to protect beyond the fact of the decision.')
ON CONFLICT(entity) DO NOTHING;

-- The reasoning, in the log the airlock keeps for exactly this, so a reader a year from now finds
-- the decision rather than inferring it from a table that exists.
INSERT INTO policy_change_log (id, entity, from_residency, to_residency, from_ai, to_ai, reason, changed_by)
VALUES ('pcl_coaching_0177', 'coaching_turns', NULL, 'LOCAL_ONLY', NULL, 'EXTERNAL_WITH_APPROVAL',
  'Morning coaching content is classified LOCAL_ONLY residency and EXTERNAL_WITH_APPROVAL processing, and is therefore NEVER STORED in the cloud domain: there is no coaching_turns table here and there must never be one. Turns live in the browser on the owner''s device; the endpoint that reaches a model persists nothing. `emotional_states` was deliberately NOT loosened - it backs the decision and prediction vaults, manifestations and promoted memory, and reclassifying it to enable one feature would have opened all of them. Owner''s decision, 6 Sep 2026, after asking whether a conversation can be locked down without a local model.',
  'boss');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0177_boss_morning_coaching');

-- ─── The classification the airlock actually reads ───────────────────────────
--
-- CAUGHT BY THE AIRLOCK ITSELF, in the browser, before this shipped: the policy_change_log entry
-- above records the DECISION, but `classify()` reads `data_policy`, and with no row there the
-- entity fell closed to LOCAL_ONLY on both axes and refused every turn even with consent granted.
-- Which is correct behaviour — an unclassified entity is refused rather than trusted — and it is
-- why the guard exists.
--
-- A POLICY ROW WITHOUT A TABLE, DELIBERATELY. `coaching_turns` is classified so the airlock can
-- govern whether a model may READ the conversation; it has no table because LOCAL_ONLY residency is
-- honoured literally rather than by writing rows into Cloudflare's database. Those are the two axes
-- doing two different jobs, which is the whole reason there are two.
--
-- scripts/validate/data-classification.mjs declares this exception by name with its reason, and
-- checks it in BOTH directions: a classified entity with no table is normally stale and flagged,
-- and this one is flagged if a table ever appears for it.
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('coaching_turns', 'coaching', 'LOCAL_ONLY', 'EXTERNAL_WITH_APPROVAL',
   'The morning coaching conversation. Never stored in the cloud domain at all - no table exists for it and none may be added; the turns live in the owner''s browser. Classified so the airlock governs whether a model may read them, which she approves once a day, per backend.')
ON CONFLICT(entity) DO NOTHING;
