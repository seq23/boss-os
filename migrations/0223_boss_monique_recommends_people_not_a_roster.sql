-- MONIQUE RECOMMENDS PEOPLE TO SPEAK TO, AND THE PEOPLE TAB IS GONE.
--
-- ─── Her words, 9 September 2026 ────────────────────────────────────────────
--
--   "i dont like this people tab at all id rather just scrap it. id rather monique just send me
--    deliverables she suggests about people to speak to (no codenames needed)"
--
-- ─── What the tab was ───────────────────────────────────────────────────────
--
-- Two hundred and sixty-seven rows of code names — SANDPIPER, HERON, ROOK — sorted by how late each
-- one was, twenty-five of them reading "469d late". Boss OS deliberately never learns who anybody
-- is, so the screen could only ever show birds. A directory, in a private language, in an order
-- nobody asked for. Browsing was the wrong answer to the question, and no amount of better rendering
-- was going to fix that.
--
-- ─── What replaces it, and where the names live ─────────────────────────────
--
-- `scripts/ops/people-worth-a-call.mjs`, weekly, on her Mac. It reads the same correspondence from
-- ~/.boss-os/sourcing/CONTACTS.json — where the REAL names are and always have been — picks three to
-- five people it can actually argue for, and emails them to her with why each one and what to say.
--
-- THE DATA IS UNTOUCHED. `relationships`, `people`, `follow_ups` and `mailbox_findings` all keep
-- every row; `contacts-sync.mjs` still writes to them and the sync endpoint still refuses an '@' or
-- a '.' in a code name. What was scrapped is the tab, not the record — Monique needs the record to
-- make the recommendation.
--
-- ─── Weekly, and the reason is not a preference ─────────────────────────────
--
-- A daily list of people to ring is exactly the thing she just deleted, and relationship decay is
-- measured in weeks: a day apart, the answer is the same list. Monday 07:15 Central, thirteen hours
-- after Sunday's contact extraction refreshes the file it reads, and early enough in the week that a
-- conversation it recommends can still happen inside that week.
--
-- ─── NO MODEL, AND THAT IS DELIBERATE ───────────────────────────────────────
--
-- There is no `requested.model` on this duty because there is no model in it. Who wrote last, how
-- often two people exchange mail, and how long it has been are arithmetic over her own mailbox. A
-- model would restate those facts in different words each week, cost money every Monday, and could
-- invent a reason to call somebody. `validate:duty-delivery` therefore has nothing to reconcile
-- between this row and the script, and `validate:says-why` has nothing to say about it either — the
-- reasons are asserted by scripts/validate/a-recommendation-earns-its-place.mjs instead.

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_people_worth_a_call',
   'People worth a conversation — a handful, by name, with the reason for each',
   'emp_relationship', 'ops',
   7, 15, 'America/Chicago', 'weekly', 1,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'People worth a conversation — a handful, by name, with the reason for each',
   json_object(
     'local_job', 'people-worth-a-call.mjs',
     'why_local',
     'The real names exist only in ~/.boss-os/sourcing/CONTACTS.json on her Mac. Boss OS holds code names and must go on holding them, so the reasoning runs where the names are and only counts are posted back.',
     'sends', 'email from monique@sequoiataylor.com, plus a notice in the Boss OS inbox'
   ),
   'Three to five people a week, each with a reason in dates and counts and one line on what to say; nobody raised twice inside eight weeks; and a week with nobody in it still posts the notice, because "ran and found nobody" and "never ran" are opposite facts.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0223_boss_monique_recommends_people_not_a_roster');
