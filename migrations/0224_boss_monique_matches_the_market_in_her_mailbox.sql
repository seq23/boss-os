-- MONIQUE BECOMES A MATCHING ENGINE OVER A MARKET THAT ALREADY EXISTS IN HER MAILBOX.
--
-- ─── The thing that was invisible ───────────────────────────────────────────
--
-- She brokers late-stage private secondaries at Rainmaker Securities. Both sides of a market sit in
-- `staylor@spry.vc` right now: somebody wanted SpaceX in March, somebody is selling it this week,
-- and 104,241 messages sit between them. Nothing has ever connected the two, because prose cannot
-- be matched — only a structured ledger can.
--
-- THE MONITORING IS INCIDENTAL. THE MATCHING IS THE PRODUCT. So the work was the extraction:
-- principal, side, asset, size, date, confidence, the co-broker who surfaced it, and the message it
-- came from. That produces no visible feature at all, which is exactly why it was the whole job.
--
-- ─── Two duties, and why they are two ───────────────────────────────────────
--
-- DAILY, INBOUND SUPPLY. New supply is perishable in a way nothing else here is: a block offered on
-- Tuesday is often gone by Friday, and a weekly sweep would meet half of it after it filled. The
-- daily run scans only since the last scan, so it costs a few cents, and it matches whatever it
-- finds against everything the ledger has ever known.
--
-- MONTHLY, THE NUDGE. Her instruction: "cadence is fine - if its few and far between and not
-- intrusive and its someone meaningful. not everyone." Monthly is the "few and far between"; the
-- other three constraints are enforced in the script — a rhythm must ACTUALLY have existed (both
-- sides writing, at least eight messages, across at least ninety days), the person must appear in
-- the ledger on a name, and it is capped at three. It says WHY rather than how long: "you exchanged
-- 129 messages through last November, then it stopped" is an observation; "61 days since contact" is
-- a timer she ignores.
--
-- ─── BOTH ARE LOCAL JOBS, AND THAT IS THE WHOLE ARCHITECTURE ────────────────
--
-- Named counterparties, assets and sizes NEVER reach this database — not code-named, not counted.
-- This is live transaction data at a FINRA-registered broker-dealer and it is materially more
-- sensitive than anything else in this system. The ledger lives in `~/.boss-os/capital/` on her Mac
-- and the matches go to her own inbox from monique@sequoiataylor.com. The sync endpoint refuses any
-- payload containing an `@` and that guard is not bent — it is simply not in this path. Neither duty
-- declares a `delivers` key, for the same reason `duty_people_worth_a_call` does not: the delivery
-- is an email carrying names, and the cloud is told nothing.
--
-- ─── SHE CAN READ spry.vc AND CAN NEVER SEND FROM IT ────────────────────────
--
--   "monique can read spry.vc she just cant send from it"
--
-- Already true three ways — no send scope was granted, spry.vc is verified in neither Resend
-- account, and notify.mjs maps every employee onto sequoiataylor.com. None of those was written
-- down anywhere a person changing the code would look, which is a rule with a six-month expiry.
-- `validate:no-spry-sender` now fails the build on an outbound identity, a sender envelope, or an
-- impersonating script that acquires a Gmail write scope.
--
-- ─── HAIKU, NAMED, ON BOTH ───────────────────────────────────────────────────
--
-- Deciding whether a message contains an asset, a side and a size is CLASSIFICATION. The judgement
-- is in the matching, and only an assigned buyer search — "who is actually credible at $250M" —
-- earns a better model, because a wrong name there costs a phone call. An unnamed model runs the
-- most expensive one available; that defect made a single briefing cost $3.88.

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_inbound_supply',
   'New supply in the mailbox, matched against everyone who ever wanted it',
   'emp_relationship', 'ops',
   7, 45, 'America/Chicago', 'daily', NULL,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'New supply in the mailbox, matched against everyone who ever wanted it',
   json_object(
     -- THE STEP THAT SPENDS IS THE ONE NAMED. The launchd job runs three scripts in order — scan,
     -- extract, match — and only `interest-extract.mjs` reaches a model. Naming the scanner here
     -- would have put Haiku beside a script that cannot spend a token, which `validate:duty-delivery`
     -- caught on the first run of this migration and was right to.
     'local_job', 'interest-extract.mjs',
     'model', 'claude-haiku-4-5',
     'why_local',
     'The interest ledger holds named counterparties, the companies they trade and the sizes they trade them in, at a FINRA-registered broker-dealer. None of it may reach this database, code-named or counted, so the reading, the extraction and the matching all happen where the names are and only an email leaves the machine.',
     'sends', 'email from monique@sequoiataylor.com when there is a cross worth a call'
   ),
   'A daily scan that reads only what arrived since the last one, accounts for every message it discarded by named reason, and refuses to exit 0 having kept nothing from a non-empty mailbox. At most five crosses, each showing both sides, their evidence and their age. A day with no cross still says so, because "found nothing" and "never ran" are opposite facts.',
   0);

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_interest_nudge',
   'Three people worth a note, anchored on the company rather than the calendar',
   'emp_relationship', 'ops',
   7, 30, 'America/Chicago', 'monthly', NULL,
   unixepoch() * 1000 + 2592000000, 'local_job', 'ops',
   'Three people worth a note, anchored on the company rather than the calendar',
   json_object(
     -- NO MODEL, AND THAT IS DELIBERATE — the same call `duty_people_worth_a_call` made. Whether a
     -- rhythm existed, how many messages two people exchanged, and how long ago it stopped are
     -- arithmetic over her own mailbox. A model would restate those facts in different words every
     -- month, cost money every time, and could invent a reason to write to somebody.
     'local_job', 'interest-match.mjs',
     'why_local',
     'It reasons over the interest ledger and the correspondence record, both of which hold real names and neither of which leaves her Mac.',
     'sends', 'email from monique@sequoiataylor.com, at most three people'
   ),
   'At most three people a month, each raised because a rhythm ACTUALLY existed — both sides writing, at least eight messages, across at least ninety days — and because they appear in the ledger on a named company. The reason given is what happened, never how many days it has been. A month with nobody in it says so rather than filling the space.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0224_boss_monique_matches_the_market_in_her_mailbox');
