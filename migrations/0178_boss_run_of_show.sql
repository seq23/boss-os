-- Her Run of Show, her verdicts, and a Body contract that does not repeat itself.
--
-- FOUR DOCUMENTS ARRIVED AND ONLY ONE HAD BEEN BUILT. The A-Player Mode OS Contract is the agenda
-- engine, the Coach manual is the coaching layer, the Executive Intelligence Report is one Today
-- block, and the Morning Movement / Somatic brain is the Body contract. Camille's report shipped;
-- these three did not, and Today has been rendering a five-stage "Day Flow" that is not in any of
-- them.
--
-- THE CONFLICT THAT MADE THIS A SCHEMA CHANGE. Day Flow's five stages are Morning Gate, Agenda
-- Calculation, Today's Contract, Midday Reset, Night Gate — which are THIS SYSTEM'S plumbing, not
-- her day. Her §15.2 requires a seven-block Run of Show: Morning Launch, First Wealth Block, Midday
-- Stabilizer, Afternoon Wealth / Admin, Food Guardrail Check, Evening Close, Night Reset. Those are
-- two different things wearing one name, and the screen was showing her the wrong one — "0 of 5
-- stages complete" is a progress bar for the machine, not for the day.
--
-- The gates do not disappear. They become EVIDENCE: completing a gate marks the Run of Show block
-- it corresponds to, so her day advances by living it rather than by ticking a second list.

-- ─── The Run of Show ─────────────────────────────────────────────────────────
--
-- §15.5: it is a RENDERING AID. It shows the whole day, translates the pillar contracts into
-- sequence, reduces "what now?", preserves flexibility, and avoids rigid timestamps unless she asks.
-- And the conflict rule is explicit: IF RUN OF SHOW CONFLICTS WITH PILLAR CONTRACTS, PILLAR
-- CONTRACTS WIN. That is why `instruction` is a rendering of the contract and never a second place
-- the day is decided.
CREATE TABLE run_of_show (
  day_id      TEXT NOT NULL,
  block_key   TEXT NOT NULL,
  position    INTEGER NOT NULL,
  -- What this block IS today, drawn from the pillar contracts. Null means the contract has not been
  -- written yet, which is stated rather than filled in with an encouraging guess.
  instruction TEXT,
  done_at     INTEGER,
  -- 'gate' when a gate completed it, 'boss' when she marked it herself. A block completed as a side
  -- effect and one she deliberately closed are different claims about the day.
  done_source TEXT CHECK (done_source IS NULL OR done_source IN ('gate','boss')),
  PRIMARY KEY (day_id, block_key)
);
CREATE INDEX idx_run_of_show_day ON run_of_show(day_id, position);

-- ─── The Night Gate verdict ──────────────────────────────────────────────────
--
-- §14.1 gives three: Full Day, MVD / Partial, Miss. §14.2 gives the rule that shapes the column:
-- "Ask what was completed before assigning a verdict. DO NOT GUESS COMPLETION." So the verdict is
-- DERIVED from her five floors as she reports them, and `verdict_floors` keeps that report — a
-- verdict with no floor record behind it would be exactly the guess the rule forbids.
--
-- The five critical pillars are §13.1: Manifestation, Meaningful Work, Movement, Hydration, Diet
-- Adherence. §13.3's flexible items — BP medicine, supplements, skincare, tea — may be recorded and
-- CANNOT create a Miss on their own.
ALTER TABLE days ADD COLUMN verdict TEXT
  CHECK (verdict IS NULL OR verdict IN ('full','mvd','miss'));
ALTER TABLE days ADD COLUMN verdict_floors TEXT;  -- json: {manifestation, meaningful_work, movement, hydration, diet}
ALTER TABLE days ADD COLUMN verdict_at INTEGER;

-- ─── The movement novelty engine ─────────────────────────────────────────────
--
-- The Somatic brain's §10: "Do NOT generate essentially the same routine every morning. Track recent
-- movement selections whenever history is available. Avoid using the exact same major movement on
-- consecutive days unless there is a deliberate reason."
--
-- A NOVELTY ENGINE WITH NO MEMORY IS A RANDOM NUMBER GENERATOR, and would have repeated as often as
-- it varied. This table is the history that instruction assumes exists.
CREATE TABLE movement_log (
  id         TEXT PRIMARY KEY,
  day_id     TEXT NOT NULL,
  -- The rotation lanes the brain names: pelvis_lumbar, hips, pilates, upper_body, neck.
  lane       TEXT NOT NULL,
  movement   TEXT NOT NULL,
  chosen_at  INTEGER NOT NULL
);
CREATE INDEX idx_movement_log_lane ON movement_log(lane, chosen_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('run_of_show', 'today', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'The day''s sequence, rendered from the pillar contracts. It holds the same class of material as `days` and `day_flow_blocks`, which are classified this way already.'),
  ('movement_log', 'body', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'Which stretch was chosen on which day, and nothing else - no symptoms, no measurements, no medication. Processing is LOCAL_ONLY because the novelty engine is deterministic: it picks the least recently used movement in each lane, so no model ever needs to read this and none should.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0178_boss_run_of_show');
