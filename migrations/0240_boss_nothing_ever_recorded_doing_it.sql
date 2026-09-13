-- Nothing in this system has ever recorded that she DID a movement.
--
-- ─── What she was shown, live, on 13 September 2026 ─────────────────────────
--
--   neck          "tiny chin nod"    because: "Not done before."
--   pelvis_lumbar "knee sway"        because: "Not done before."
--   hips          "knee opener"      because: "Not done before."
--   pilates       "heel slide"       because: "Not done before."
--   upper_body    "shoulder press"   because: "Not done before."
--
-- Five lanes, one sentence, five times. The instinct is to write five different sentences. That
-- would be papering over the finding.
--
-- ─── The sentence was a claim the database could not support ────────────────
--
-- `movement_log` records which movement was CHOSEN on which day. Its own data_policy row, written
-- in 0178, says exactly that: "Which stretch was chosen on which day, and nothing else." There has
-- never been a column, an endpoint or a control anywhere in this system that records her DOING one.
--
-- So `chosen.last === 0` means "this movement has never been offered", and `body.ts` rendered it as
-- "Not done before." — telling her something about her own body that it had no way to know. It
-- would also have stayed true for weeks by construction: LRU offers an unchosen movement first and
-- the lanes hold five to ten each, so every morning's five read "never done" until a lane ran out.
-- A true report of a missing completion path, repeated until it looked like a rendering bug.
--
-- ─── A second defect, found while fixing the first ──────────────────────────
--
-- `logSomatic` ran on every read of `/spirit/day` and DELETED the day's rows before rewriting them
-- with a fresh `chosen_at`. The movement it had just logged therefore became the most recently used
-- one, so the next read ranked it last and picked something else — rewriting the day again.
-- Measured against production inside ten minutes:
--
--   first read   hips=hip circles  neck=neck isometric → release  pelvis_lumbar=heel drag
--   later read   hips=knee opener  neck=tiny chin nod             pelvis_lumbar=knee sway
--
-- Today and Spirit disagreed about today's sequence and both changed under her while she read them.
-- A contract she cannot finish because it is a different contract each time she looks.
--
-- ─── What this column changes ───────────────────────────────────────────────
--
-- `done_at` is the first record of DOING in Boss OS. With it:
--
--   · the rotation ranks by least-recently-DONE, which is what the Somatic brain's §10 actually
--     says — "avoid the exact same major movement on consecutive days" is about the movement she
--     did, not the one a screen offered her and she never got to;
--   · the reason line distinguishes three states the record can genuinely tell apart — done, came
--     up and nothing was recorded, never offered — so the five lines differentiate themselves;
--   · `logSomatic` becomes insert-if-absent, because a delete-and-rewrite would now also throw away
--     the one thing in this table that is about HER.
--
-- NO COUNT, NO STREAK, NO PROGRESS BAR, and the control undoes. The standing rule against guilt
-- binds here as it does on the contribution practice: this exists so the rotation can vary honestly,
-- not so she can fail at it. An unmarked day stays UNKNOWN and the wording says so — "nothing was
-- recorded either way" is not "you skipped it".
--
-- RESIDENCY IS UNCHANGED. LOCAL_ONLY processing still holds: the engine is deterministic and no
-- model reads this table. A completion timestamp is the same class of fact as a choice timestamp.

ALTER TABLE movement_log ADD COLUMN done_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_movement_log_done ON movement_log(lane, done_at DESC);

UPDATE data_policy
   SET reason = 'Which stretch was chosen on which day, and whether she marked the rotation done. Nothing else - no symptoms, no measurements, no medication. Processing is LOCAL_ONLY because the novelty engine is deterministic: it picks the least recently DONE movement in each lane, so no model ever needs to read this and none should.'
 WHERE entity = 'movement_log';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0240_boss_nothing_ever_recorded_doing_it');
