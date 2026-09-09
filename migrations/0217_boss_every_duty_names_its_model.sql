-- One duty in nine names no model, and the new roster screen is what found it.
--
-- ─── The defect, and how it surfaced ───────────────────────────────────────
--
-- She asked for "an area where i can see all employees pre-set duties". The first thing that screen
-- rendered, live, was this:
--
--     Monique — Director of Relationships
--        never fired  weekly  NO MODEL NAMED  $0.22/mo  Mailbox sweep — missed deals, cooling buyers
--
-- `duty_mailbox_sweep`'s `task_input` carries `delivers`, `local_job` and `why_local` and NO
-- `$.requested.model`. `mailbox-sweep.sh` names Sonnet in its own `MODEL` variable, so the job runs
-- correctly today — the row is what is silent, and the row is what anything reading the schedule
-- believes.
--
-- WHY THAT MATTERS RATHER THAN BEING COSMETIC. A duty with no model in its row is the exact shape of
-- the defect that made a single executive briefing cost $3.88: the envelope supported a model flag
-- the whole time and nothing was setting it. Every other duty was fixed in 0196 and this one was
-- written afterwards, in 0204, without one — which is how a fixed defect comes back.
--
-- It also made the cost estimate wrong in the direction that matters least and lies most: with no
-- model named, the roster priced it as the cheap one, so a duty that actually runs the expensive
-- model was reported at Haiku's price.
--
-- ─── The number is the script's, not a new decision ────────────────────────
--
-- `mailbox-sweep.sh` has run on Sonnet since 0204 and the reasoning is in its header: matching a
-- past enquiry against present supply across eighteen months of mail is judgement rather than
-- summarising, and it is the same reason buyer sourcing keeps the better model deliberately. This
-- writes down what is already true rather than changing it, and `validate:duty-delivery` asserts the
-- two agree from here on.
UPDATE standing_duties
   SET task_input = json_set(
         task_input,
         '$.requested', json_object('model', 'claude-sonnet-4-5-20250929', 'max_seconds', 900)
       )
 WHERE id = 'duty_mailbox_sweep'
   AND json_extract(task_input, '$.requested.model') IS NULL;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0217_boss_every_duty_names_its_model');
