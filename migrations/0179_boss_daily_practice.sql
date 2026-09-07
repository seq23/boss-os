-- The morning practice, and the one part of it that stops at a decision only the owner can make.
--
-- WHAT THE SPIRIT SCREEN WAS. Moon phase, illumination percentage, a contribution counter, an
-- almanac. All correct, all computed, and none of it anything to DO. Her §8.1 says Spirit is an
-- active operating pillar that "must be rendered explicitly in the daily agenda", and the daily
-- agenda was rendering the sky instead.
--
-- Most of the fix needs no schema at all: §8.3's seven-step sequence and §8.4's floor are fixed in
-- her contract and belong in code, and §6.9's movement contract was already being computed and
-- simply never shown. This migration exists for the one piece that ran into a wall.
--
-- ─── The gratitude sentence, and why there is still no table for it ─────────
--
-- THE CONFLICT THAT LOOKED REAL AND WAS NOT. She asked for an LLM to write the daily sentence; she
-- also classified `spirit` as a SOVEREIGN SUBSYSTEM, LOCAL_ONLY on both axes. Those appeared to be
-- irreconcilable, and this migration first shipped as a named stop asking her to choose.
--
-- She asked which was actually best, and the answer was neither: the airlock would only ever have
-- shown a cloud model the SHAPE of her day - the anchor, a count of open loops, the day mode -
-- because every fact that makes a gratitude sentence specific is sovereign. Her arcs, her vehicles,
-- what she is holding, what she actually did. The model version was going to be THINNER than one
-- composed here, not richer, and the sovereignty rule was protecting her from a worse sentence
-- rather than costing her a better one.
--
-- SO IT IS COMPOSED IN THE WORKER, FROM HER OWN RECORD. No model, so LOCAL_ONLY processing holds
-- literally. No table, so LOCAL_ONLY residency holds literally - the sentence is deterministic for
-- a given day and is recomputed rather than stored, which also makes it the same mantra all day.
-- §8.5's 90-day no-repeat is met by construction: the theme rotates every six days and the form
-- rotates within it, so a pair does not recur for months without anything being written down.
--
-- The classification below is therefore not a stop and not a compromise. It is what the subsystem
-- already was, with a feature built to fit it instead of around it.

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('gratitude_sentences', 'spirit', 'LOCAL_ONLY', 'LOCAL_ONLY',
   'One sentence a day, to be spoken out loud, drawn from her real life - which makes it spirit material, and spirit is sovereign on both axes. It is composed inside the Worker from her own record: no cloud model reads any of it, and no row is written, so both axes are honoured literally rather than by permission. It is deterministic for a given day, which is what a mantra needs.')
ON CONFLICT(entity) DO NOTHING;

-- The reasoning, in the log kept for exactly this, so a reader a year from now finds the decision
-- rather than inferring it from an absence.
INSERT INTO policy_change_log (id, entity, from_residency, to_residency, from_ai, to_ai, reason, changed_by)
VALUES ('pcl_gratitude_0179', 'gratitude_sentences', NULL, 'LOCAL_ONLY', NULL, 'LOCAL_ONLY',
  'Classified sovereign because `spirit` is a sovereign subsystem and this is spirit material. The apparent conflict - she asked for an LLM to write it daily, and spirit may not be reasoned about by a cloud model - dissolved on inspection: the airlock would only ever have shown a model the shape of her day, so the generated sentence would have been thinner than one composed in the Worker from her arcs, her vehicles and what she is actually holding. Composed locally, stored nowhere, sent nowhere. No exception was added and none is needed.',
  'boss');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0179_boss_daily_practice');
