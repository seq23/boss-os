-- Danielle finds, Monique relates.
--
-- ─── The seam, which is not workload ────────────────────────────────────────
--
-- Monique (`emp_relationship`) carried EIGHT of fourteen duties. Danielle (`emp_repo`) carried ONE.
-- That looks like a load-balancing problem and it is not one: rebalancing by count would move
-- whichever duties happened to be movable and leave the roster no more legible than before.
--
-- The real line is this:
--
--   FINDING A PERSON IS RESEARCH. KNOWING A PERSON IS A RELATIONSHIP.
--
-- Reading eight N-PORT XML filings per name, doing the capacity arithmetic, pulling Schedule A off
-- Form ADV, working out whether a domain has an address convention, and hunting resource pages that
-- might link to her sites — all of that is Technical Program Management. Knowing which broker in her
-- own ledger is already working a name, whether a firm she is mid-conversation with as an LP can be
-- approached on the buy side, which LP replied and what they meant, and who is worth a call — that
-- is Relationships.
--
-- ─── What moves, and what deliberately does not ─────────────────────────────
--
-- TO DANIELLE:
--   · `duty_filing_research` — NEW. The filings half of the buyer hunt, plus the contact discovery
--     built on it: "which funds hold this, and who there could write the cheque."
--   · `duty_link_prospects` — backlink prospecting. Technical outreach research that has been
--     sitting on Relationships since 0193 because it produces a list of people, which is a
--     resemblance to relationship work rather than the thing itself. It reads the open web for
--     resource pages and unlinked mentions; nobody is spoken to.
--   · `duty_grid_watch` — already hers as of 0235.
--
-- STAYING WITH MONIQUE:
--   · `duty_buyer_hunt` — the MAILBOX half. "Which brokers in her own ledger are working this."
--   · `duty_lp_replies`, `duty_mailbox_sweep`, `duty_people_worth_a_call`, `duty_interest_nudge`,
--     `duty_inbound_supply`, `duty_scooter_sheet`, `duty_lp_positive`.
--
-- ─── A SINGLE REQUEST STILL PRODUCES BOTH HALVES ───────────────────────────
--
-- This is the part that would be easy to get wrong, because splitting an owner is usually splitting
-- a deliverable. It is not here. `scripts/ops/buyer-hunt.mjs` IMPORTS `researchLot` and
-- `renderFilings` from `scripts/ops/filing-hunt.mjs` and renders both halves into ONE email, each
-- under its own byline. She asks once and gets one answer carrying two people's work.
--
-- The two duty rows exist because each half must be able to go red on its own: if EDGAR is
-- unreachable for a week that is Danielle's row failing, and it should not be hidden behind a
-- mailbox half that worked fine. `validate:launchd-duty-link` requires exactly one launchd
-- invocation per local-job duty and exactly one duty per script token, so the two scripts and the
-- two rows line up in both directions with no second list to drift.

-- ─── Backlink prospecting moves seats ───────────────────────────────────────
--
-- An UPDATE rather than a delete and re-insert: `duty_link_prospects` has run history on it, and
-- `duty_runs` rows point at this id. Recreating it would orphan every one of them and reset
-- `last_run_at` to NULL — which reads as "this has never run", the exact confusion 0228 exists to
-- end. The seat changes; the record of the work does not.
UPDATE standing_duties SET employee_id = 'emp_repo' WHERE id = 'duty_link_prospects';

-- ─── Monique's hunt narrows to the half she owns ────────────────────────────
--
-- The name and the success criteria are rewritten because they described BOTH halves, and a duty
-- whose success criteria describe somebody else's work cannot be evaluated. The schedule, the
-- executor and the `local_job` token are untouched: `buyer-hunt.mjs` is still what runs, it still
-- renders the combined email, and the launchd link is unchanged.
UPDATE standing_duties
   SET name = 'Which brokers in your own ledger are already working what you are selling',
       task_title = 'Which brokers in your own ledger are already working what you are selling',
       success_criteria =
         'Every name carries the sentence out of the email in her own ledger that produced it, and the ' ||
         'broker on a row is labelled AS the broker and never as the principal — sending a counterparty''s ' ||
         'intermediary a message meant for the counterparty is a compliance problem, not a cosmetic one. ' ||
         'A Rainmaker-to-Rainmaker pairing is excluded and the run says how many it dropped. An EMPTY week ' ||
         'is a valid outcome and must still state what was searched: the names, and how many ledger rows ' ||
         'touch each one. "Found nobody" and "never ran" must never render the same. The filings half of ' ||
         'the same email is Danielle''s work and is evaluated on duty_filing_research.'
 WHERE id = 'duty_buyer_hunt';

-- ─── Danielle's filings research ────────────────────────────────────────────
--
-- WEEKLY, TUESDAY 06:50, ten minutes before Monique's 07:00. The order is the argument: the combined
-- email is rendered by the buyer hunt, so the research it reports has to have been attempted first.
-- Running them the other way round would put last week's filings in this week's email and nothing
-- would say so.
--
-- Same weekday as the hunt, because the two halves answer one question and a research pass on a
-- Thursday would describe a book that moved on Sunday.
--
-- COST: $0. EDGAR and Form ADV are free and public, her correspondence record is a file on her own
-- disk, and nothing here calls a model — which is why there is no 'model' key, and
-- `validate:duty-delivery` would fail the build if one were named and never called.
--
-- IT CONTACTS NOBODY. It composes a LinkedIn search URL she clicks herself; it never logs in, never
-- fetches it, and no credential is requested or accepted. She is a registered representative of a
-- FINRA broker-dealer and this job does not draft outreach to a stranger.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_filing_research',
   'Which funds hold what you are selling, and who there could write the cheque',
   'emp_repo', 'ops',
   6, 50, 'America/Chicago', 'weekly', 2,
   unixepoch() * 1000 + 86400000,
   'local_job', 'ops',
   'Which funds hold what you are selling, and who there could write the cheque',
   json_object(
     'local_job', 'filing-hunt.mjs',
     'why_local',
     'SEC EDGAR full-text search plus eight N-PORT XML filings per name, Form ADV firm and individual lookups per holder, and her own correspondence record at ~/.boss-os/sourcing/CONTACTS.json. Neither the request volume nor that file exists inside a Worker.',
     'never',
     'Contacts nobody. It composes a LinkedIn SEARCH URL for her to click; it never logs in, never fetches it, never automates a browser against it, and no credential is requested, accepted or stored.'
   ),
   -- ─── THE SUCCESS CRITERIA ARE MOSTLY ABOUT WHAT IT MAY NOT DO ────────────
   --
   -- Because that is where this job fails. Adding addresses is easy and adding WRONG addresses is
   -- easier still, and every one of them reads exactly like a real one on the page — she would find
   -- out by sending it. And attaching names to every hunt puts direct pressure on the rule that
   -- empty-handed is fine: a system that learns to pad is one she stops reading, and then the
   -- filings are worth nothing either.
   'Every line states its CONFIDENCE and its SOURCE, and the two are not interchangeable: "pattern from 9 known addresses at this domain" is evidence, "the most common format for US managers" is a guess, and conflating them is how she emails a stranger by the wrong name. No contact line is printed without a file and a row behind it. A predicted address appears ONLY where her own correspondence shows a single unambiguous convention at that exact domain, and says how many addresses it rests on. HOLDER CONFIRMED, NO PERSON IDENTIFIED IS A SUCCESS and must render as one — a fund with a real filing and no findable person is a complete answer, and padding it is the failure. An empty week still states the names searched, the N-PORT filing counts, and why nobody cleared the bar.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0236_boss_danielle_finds_monique_relates');
