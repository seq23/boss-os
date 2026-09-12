-- Nothing in this system has ever hunted buyers for her live book.
--
-- ─── What was actually true, counted rather than assumed ───────────────────
--
-- `scripts/ops/buyer-hunt.mjs` is 369 lines that read her book, search EDGAR N-PORT for funds that
-- report a position in each name, read the filing for the dollar mark and total net assets, do the
-- capacity arithmetic, and print a citation for every candidate. It was reachable from exactly one
-- place: `npm run capital:buyers`, typed by hand.
--
-- The 14 `standing_duties` rows call `interest-extract.mjs`, `interest-match.mjs`, `mailbox-sweep.sh`,
-- `lp-replies.sh`, `kdp-surface.sh`, `people-worth-a-call.mjs`, `lp-tracker-sync.mjs`,
-- `lp-positive.mjs` and `ahrefs-audit-fix.sh`. `buyer-hunt.mjs` appears in none of them. And
-- `duty_interest_nudge`, the closest thing to it, is MONTHLY and `last_run_at` is NULL — it has
-- never run at all.
--
-- So the one piece of work that starts from what she is actually trying to sell had no schedule, no
-- owner on a calendar, and no row that could ever go red. "Exists but nothing invokes it", with 369
-- lines behind it.
--
-- ─── Weekly, Tuesday 07:00 Central ─────────────────────────────────────────
--
-- WEEKLY because the input changes weekly: she files her book by email and the mailbox sweep runs on
-- Sundays, so Tuesday morning reads a book that is at most two days old against a ledger that was
-- refreshed the night before last. Monthly is what `duty_interest_nudge` is, and it has never fired
-- once — a cadence long enough that nobody notices it missing is not a cadence.
--
-- weekday 2 is Tuesday (0 = Sunday, per `duties/cadence.ts`). 07:00 puts it in front of her before
-- the 07:15 and 07:45 jobs, because it is the one whose output is a list of people to call.
--
-- ─── executor = 'local_job', and the launchd job that carries it ───────────
--
-- The work is SEC full-text search plus eight XML filings per name plus `~/.boss-os/capital`. None
-- of that fits a Worker invocation and none of her ledger exists in one, so this is `local_job` and
-- it runs on her Mac. `scripts/ops/install-agent-launchd.sh` installs
-- `com.seq.boss-capital-buyers`, and the command is wrapped in `duty-run.sh buyer-hunt.mjs` so the
-- run RECORDS ITSELF against THIS row:
--
--   "I DONT CARE IF ITS LAUNCHD OR D1 — THOSE SHOULD BE LINKED ANYWAY."
--
-- The token in `task_input.$.local_job` below and the token in the installer's `duty-run.sh`
-- invocation are the same string, and `validate:launchd-duty-link` proves it in both directions
-- offline: every invocation resolves to a duty that exists, and every local_job duty is named by
-- exactly one invocation. There is no second list to drift.
--
-- ─── COST: $0 ──────────────────────────────────────────────────────────────
--
-- It calls no model. EDGAR is free and public, her ledger is a file on her own disk, and the send is
-- Resend from monique@sequoiataylor.com — never from spry.vc, asserted by `validate:no-spry-sender`.
--
-- ─── AND IT IS ALLOWED TO COME BACK EMPTY ──────────────────────────────────
--
--   "if she comes up empty handed its fine. better than giving me trash."
--
-- The success criterion below says so explicitly, and says what an empty week must still carry: the
-- names searched, the filing counts, and the reason nobody cleared the bar. "Found nobody" and
-- "never ran" are opposite facts and must not render the same.

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_buyer_hunt',
   'Buyers for what you are actually trying to sell, with a filing behind each one',
   'emp_relationship', 'ops',
   7, 0, 'America/Chicago', 'weekly', 2,
   unixepoch() * 1000 + 86400000,
   'local_job', 'ops',
   'Buyers for what you are actually trying to sell, with a filing behind each one',
   json_object(
     'local_job', 'buyer-hunt.mjs',
     -- NO 'model' KEY, DELIBERATELY, AND THAT IS THE HONEST ABSENCE. Every judgement in this job
     -- is arithmetic over a filing she can open herself; no model is reached at any point.
     -- `validate:duty-delivery` fails a duty that NAMES a model its script never calls, and it is
     -- right to: a named model is a spend nobody makes and a capability nobody has.
     'why_local',
     'SEC EDGAR full-text search plus eight N-PORT XML filings per name, and her own interest ledger at ~/.boss-os/capital/ledger.json. Neither the request volume nor the ledger exists inside a Worker.',
     'never',
     'Contacts nobody. It produces a list for her, at her own address, from monique@sequoiataylor.com. She is a registered representative of a FINRA broker-dealer and this job does not draft outreach to a stranger.'
   ),
   'Every candidate carries its evidence — an N-PORT accession number and URL, or the sentence out of the email in her own ledger. A fund that holds the name but cannot write the cheque is excluded rather than listed with a caveat. An EMPTY week is a valid outcome and must still state what was searched: the names, the number of N-PORT filings that mention each, how many were read, and why nobody cleared the bar. "Found nobody" and "never ran" must never render the same.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0230_boss_nothing_hunts_buyers_for_her_book');
