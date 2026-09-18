-- TWO LABELS ON EVERY WORK CARD, BECAUSE ONE SCALE WAS ANSWERING TWO QUESTIONS.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT WENT WRONG, IN THE SIBLING REPO AND ONE STEP AWAY FROM GOING WRONG HERE.
--
-- `tasks.sensitivity` is a single four-point line — public, internal, private, restricted — and two
-- different questions were being read off it:
--
--     WHO MAY RECEIVE THE OUTPUT      `public` and `internal` answer this
--     WHICH MODELS MAY SEE THE INPUT  `private` and `restricted` answer this
--
-- In `west-peek-os` those two collapsed into one and "internal" — which only ever meant the
-- recipient is a partner — was read as "too sensitive to train on". Hiring searches, event kits,
-- room packets and workshop material were barred from every free lane and every run landed on the
-- most expensive model on the account, at roughly $0.60 a day, for work that is not private at all.
--
-- The owner, seeing it: "ITS NOT DEAL TERMS OR LP INFORMATION SO IT DOESNT MATTER IF ITS USING THIS
-- DATA TO TRAIN. WHO CARES ABOUT HIRING SEARCH AND EVENT KITS AND ROOM KITS. THEY ARE NOT PRIVATE
-- INFO." And then, locking it in: "WE NEED TO CLASSIFY ON EACH WORK CARD GOING FORWARD ... SO THERE
-- IS NO CONFUSION. MOST WORK IS INTERNAL AND NOT-CONFIDENTIAL SO CAN USE FREE TRAINING MODELS WITH
-- REASONING AND CLOSE TO $0."
--
-- BOSS OS HAD NOT MADE THAT MISTAKE AT THE ROUTER — `router/policy.ts` keyed on the scanned content
-- and on `restricted`, never on `internal`, and that is verified rather than assumed. What Boss OS
-- did not have was the LABEL. The distinction lived only in the heads of the people reading
-- `policy.ts`, one enum away from the sibling's failure, and nothing on a work card said which
-- question a value was answering. This writes the two questions down as two columns.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HER WORDING, AND THE REASON IT IS BETTER THAN "CONFIDENTIAL".
--
--   "I'D ALSO LIKE TO CHANGE THE TERMINOLOGY FROM CONFIDENTIAL / NOT — MAYBE JUST LABEL IT
--    PUBLIC MODEL APPROVED / PRIVATE MODEL ONLY"
--
-- "Confidential" asks a reader how secret something FEELS. That has no falsifiable answer, and
-- under uncertainty it pulls every reader toward the cautious-looking box — which is precisely the
-- mechanism that produced the sibling's bill. `public_model_approved` names the CONSEQUENCE, so the
-- question being answered is "where may this go", which is about routes and has a right answer.
--
-- THE STORED VALUE IS THE DISPLAYED WORDING. `public_model_approved` renders as "Public model
-- approved" and that is the whole of the transformation. Storing `confidential` and rendering
-- "Private model only" would put the removed vocabulary back into the database for the next reader
-- to find, which is how two names for one idea survive a rename.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HOW THIS RECONCILES WITH THE VOCABULARY THAT ALREADY EXISTS HERE. Three names, three subjects,
-- no overlap — stated because the alternative is three teams each quietly meaning a fourth thing.
--
--   models.data_use            A FACT ABOUT A ROUTE, with a citation behind it (0249).
--                              NO_TRAINING_CONTRACTUAL / TRAINS_ON_PROMPTS / UNKNOWN.
--                              It is evidence, not a label, and it keeps its name.
--   tasks.model_access         THE OWNER'S LABEL ON THE WORK. New here. The only axis that decides
--                              which models are eligible.
--   data_policy.ai_processing  WHERE A TABLE MAY BE PROCESSED (LOCAL_ONLY / EXTERNAL_OK). About
--                              storage residency, a different question, untouched.
--
-- The single join between the first two is `isPrivateModelRoute()` in `router/modelAccess.ts`:
-- private-model-only work may run only on a route whose `data_use` is NO_TRAINING_CONTRACTUAL.
-- Nothing else needs to know both vocabularies exist.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- AND `sensitivity` IS NOT DROPPED. It still carries risk and envelope behaviour that has nothing
-- to do with training terms, and dropping a column used in a dozen queries to make a point is a
-- migration that breaks things for tidiness. What changes is that it no longer DECIDES model
-- access; `model_access` does, and `sensitivity` may only ever tighten it.

-- ─────────────────────────────────────────────────────────────────────────────
-- AXIS ONE · WHICH MODELS MAY SEE THE INPUT.
--
-- THE DEFAULT IS `public_model_approved` AND THAT IS DELIBERATE, against this database's usual
-- habit of defaulting closed. Defaulting closed is right where an omission could leak something;
-- here the omission cannot, because `router/modelAccess.ts` reads the OUTGOING PROMPT on every run
-- regardless of what the card says and raises the run on its own. So the column is a declaration
-- that can only ever be corroborated, never relied on alone — and defaulting it closed would
-- reproduce, as a schema default, the exact over-restriction this migration exists to remove.
ALTER TABLE tasks ADD COLUMN model_access TEXT NOT NULL DEFAULT 'public_model_approved'
  CHECK (model_access IN ('public_model_approved','private_model_only'));

-- ─────────────────────────────────────────────────────────────────────────────
-- AXIS TWO · WHO MAY RECEIVE THE OUTPUT.
--
-- Internal is Sequoia or Scooter. External is anyone else. It governs approval and it reaches
-- NOTHING in the router — there is no `audience` field on `PolicyContext` and
-- `scripts/validate/two-axes-are-independent.mjs` fails the build if one appears.
ALTER TABLE tasks ADD COLUMN audience TEXT NOT NULL DEFAULT 'internal'
  CHECK (audience IN ('internal','external'));

-- ─────────────────────────────────────────────────────────────────────────────
-- THE BACKFILL, AND WHAT IT POINTEDLY DOES NOT DO.
--
-- `restricted` on the old scale really did mean "do not train on this", so those rows are raised.
-- `internal` is NOT raised, `private` is NOT raised, and `public` is NOT raised. That is the whole
-- correction, written as three rows that are absent rather than as a comment: if a future reader
-- adds `OR sensitivity = 'internal'` here, they have reintroduced the sibling's bug and the
-- validator's fixture will say so.
UPDATE tasks SET model_access = 'private_model_only' WHERE sensitivity = 'restricted';

-- The audience of a historical row is not recoverable from any column it holds, and guessing would
-- manufacture a fact. They stay at the default, which is also the honest reading: the overwhelming
-- majority of work in this system was drafted for a partner.

-- ─────────────────────────────────────────────────────────────────────────────
-- AND THE DECISION LOG RECORDS WHICH LABEL WAS IN FORCE.
--
-- `routing_decisions` already stores `sensitivity` next to every routing outcome. Without the label
-- beside it, a decision that refused four of six candidates cannot be read back to say WHY without
-- re-deriving the scan — and the last time this went wrong (a firm notice containing the word
-- "commitment" taking every run off the training-permitting routes) it was found only because
-- somebody happened to be looking at a candidate count.
ALTER TABLE routing_decisions ADD COLUMN model_access TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- THE NOTICE, AND WHY IT REPLACES NOTICE 4 RATHER THAN SITTING NEXT TO IT.
--
-- 0254 seeded `fnt_lp_names_never_train`: "LP names and deal terms never reach a model or route
-- whose terms permit training on prompts." That is still true and it now has a label and a
-- mechanism behind it. Posting a second notice about the same rule would leave an employee reading
-- two overlapping instructions and deciding which is current, which is the failure mode notices
-- exist to prevent. So this REWRITES the existing row in place — same id, so it keeps its position
-- in the reading order, and there is exactly one statement of the rule.
--
-- ─── THE TRAP, WHICH IS IN THIS REPO'S OWN HISTORY ──────────────────────────
--
-- Notice 8's first draft here contained the words "a commitment made". The router reads the
-- outgoing prompt for deal-term shapes, `\bcommitment\b` was on that list, and because notices ride
-- in front of EVERY prompt, every employee run firm-wide scanned as LP material and every
-- training-permitting route was refused. It was caught only because a router test happened to
-- report "2 of 6 refused".
--
-- A NOTICE ABOUT LP NAMES AND DEAL TERMS IS THE SINGLE MOST LIKELY TEXT IN THIS REPO TO TRIP THAT
-- DETECTOR, so the body below was written against the pattern list and then run through the real
-- exported patterns rather than eyeballed. It names the subject without using the vocabulary: "the
-- material we gather while checking out an investment" rather than the word that is on the list.
-- `scripts/validate/a-notice-reaches-the-employee.mjs` holds the whole seed to the UNION of both
-- pattern tiers — stricter than routing itself, because routing judges one run and a notice is
-- prepended to every run for ever.
UPDATE boss_notices SET
  title = 'Two labels on every work card: public model approved / private model only, and internal / external',
  body =
     'Every work card now holds two labels. They are separate questions and neither one is read off '
  || 'the other.'
  || char(10) || char(10)
  || 'PUBLIC MODEL APPROVED or PRIVATE MODEL ONLY decides which models may see the work. Public '
  || 'model approved is the default and it covers most of what we do — hiring searches, event kits, '
  || 'room packets, workshop material, market research, tool scouting, backlink prospecting, site '
  || 'audits, Kindle work, community material, Productions, and the public inputs to the executive '
  || 'brief. That work may go to any capable model, including the free reasoning lanes, and it '
  || 'should: a cheaper route is not a worse answer, and refusing one for work that is not private '
  || 'costs us money and speed for nothing. Private model only is the fund''s own side — LP names, '
  || 'deal terms, fund figures, and the material we gather while checking out an investment. That '
  || 'work stays on a route whose terms forbid training on what it is sent, and no approval lifts '
  || 'it: what would be approved is not one run but a permanent place in somebody else''s corpus.'
  || char(10) || char(10)
  || 'INTERNAL or EXTERNAL decides approval and who may receive the output. Internal is Sequoia or '
  || 'Scooter. External is anyone else — a candidate, a founder, a guest, a journalist, an LP. It '
  || 'says nothing whatsoever about which model may do the work.'
  || char(10) || char(10)
  || 'NEITHER LABEL IS READ OFF THE OTHER, and both off-diagonal corners are real. A memo about an '
  || 'LP written for Sequoia is internal AND private model only. An event kit going to a guest is '
  || 'external AND public model approved. Work being for a partner is not a reason to keep it off '
  || 'the free models, and work being public model approved is not permission to send it to '
  || 'anybody. If you are unsure which label a card should hold, say so and ask — the router reads '
  || 'the content itself and will refuse a training-permitting route on its own if it finds LP '
  || 'material, so a wrong label is caught, but a label nobody can trust is a label nobody reads.',
  author = 'Sequoia Taylor'
WHERE id = 'fnt_lp_names_never_train';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0255_boss_two_labels_on_every_work_card');
