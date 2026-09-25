-- A broker email names a side. Nothing has ever gone and found the other one.
--
-- ─── What was actually missing ──────────────────────────────────────────────
--
-- The daily mailbox duty (0224) reads today's mail and crosses it against everyone who has ever
-- wanted the same name IN HER OWN MAILBOX — the in-house cross, and it is real and it works. But
-- most days there is no cross, because most days only one side of a trade lands in her inbox: "our
-- institutional client wants $7M of Periodic Labs at a $7B valuation, are you direct to firm
-- sellers" names a buyer and nothing else, and when nobody in her own mail is already selling it,
-- the mail simply sits there until she reads it herself and decides what to do.
--
-- The weekly buyer-hunt and filing-research duties (0230, 0236) already go outward — SEC EDGAR
-- N-PORT, Form ADV, her own contacts, a LinkedIn search link — but only for lots in HER OWN BOOK,
-- weekly. Neither has ever read a line out of ledger.json, which is where somebody ELSE's interest
-- lives.
--
-- Her instruction, 25 September 2026: expand the buyer-sourcing family to hunt either side, once a
-- day, against whatever is new since the last run — never re-hunting a message already answered.
--
-- ─── Why this is one new duty, not a change to the other two ───────────────
--
-- The weekly book-driven duties stay exactly as they are. This is additive —
-- `scripts/ops/ledger-hunt.mjs` imports the same functions those two files already run
-- (`assignedSearch`, `researchLot`, `renderFilings`, `reachFor`) rather than holding a second copy
-- of the judgement that decides whether a candidate is real. The only thing new is WHICH lots to
-- hunt (new ledger rows instead of book rows) and WHEN a lot counts as already handled (a
-- per-message state file instead of a weekly re-read of the whole book).
--
-- ─── Chained onto the existing daily mailbox job, not a second wall clock ──
--
-- `local_hour`/`local_minute` on a `local_job` duty are documentation, not a trigger — launchd, not
-- the Worker cron, fires these, exactly as it does for the weekly buyer-hunt and filing-research
-- pair (`install-agent-launchd.sh` chains both of THOSE inside one plist too, ten minutes apart on
-- the clock, seconds apart in practice). This one is appended as a fourth step on the EXISTING
-- daily mailbox plist, right after the match step, so it can only ever run against a ledger the
-- extraction step just finished writing for the day — ordering by chaining, which cannot race,
-- rather than by a second trigger time, which could. 08:00 here documents "runs after the 07:45
-- chain" the same way 06:50/07:00 document the filings/buyers ordering on the weekly pair.
--
-- ─── Press and podcast mentions: the one genuinely new capability ──────────
--
-- Filings, Form ADV, her contacts and a LinkedIn link were all already built. Press releases and
-- podcast mentions were not, and this is where a model is actually reached: `pressPodcastLeads` in
-- `filing-hunt.mjs` runs one scoped Claude Code call per name, with WebSearch/WebFetch, authenticated
-- as the owner's own session — the same `agent_executed`/`bk_claude_code` mechanism every other
-- research duty already uses, called in-process rather than through a Worker round trip, because
-- this whole family already runs entirely on her Mac and nothing here should cross to D1 for the
-- first time. A finding with no working source URL is dropped before it is ever rendered.
--
-- THE STEP THAT SPENDS IS THE ONE NAMED, same reasoning the daily mailbox duty used: `ledger-hunt.mjs`
-- is the `local_job`, and the model constant that reaches the model lives in that file (passed
-- through into `pressPodcastLeads`) even though the call itself happens inside `filing-hunt.mjs` —
-- because the duty-delivery scan checks the SCRIPT THE DUTY NAMES, not whichever file it happens to
-- import.
--
-- ─── COST: one Haiku call per NEW name per day, nothing else ───────────────
--
-- EDGAR, Form ADV and her own ledger and contacts are free and public, exactly as in the weekly
-- buyer hunt. The only spend is `pressPodcastLeads`, once per new ledger row, and a day with no new
-- mail spends nothing at all — an empty ledger is a named stop, never a silent, costly re-hunt of
-- yesterday.
--
-- ─── AND IT IS ALLOWED TO COME BACK EMPTY ──────────────────────────────────
--
--   "if she comes up empty handed its fine. better than giving me trash."
--
-- Every source states what it searched and why nobody cleared the bar when nobody did. "Found
-- nobody" and "never ran" must never render the same.

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_ledger_hunt',
   'Who to route it to, the same day her mail names a side',
   'emp_relationship', 'ops',
   8, 0, 'America/Chicago', 'daily', NULL,
   unixepoch() * 1000 + 86400000,
   'local_job', 'ops',
   'Who to route it to, the same day her mail names a side',
   json_object(
     'local_job', 'ledger-hunt.mjs',
     'model', 'claude-haiku-4-5-20251001',
     'why_local',
     'Reads ~/.boss-os/capital/ledger.json and ~/.boss-os/capital/ledger-hunt-state.json directly, and does SEC EDGAR full-text search plus a scoped local Claude Code run for press/podcast leads, all against named counterparties, assets and sizes that may not reach this database. None of that exists inside a Worker.',
     'sends', 'email from monique@sequoiataylor.com only when there is at least one new message since the last run'
   ),
   'Runs after the daily 07:45 scan/extract/match chain and hunts ONLY ledger rows not already in ledger-hunt-state.json and not struck as wrong — a source_message already answered is never re-hunted, and a row is marked answered only after a confirmed send. Every candidate carries a filing accession, a ledger quote, or a press/podcast URL; a claim with none of the three is not printed. A day with no new mail is a named stop, not a re-run, and an empty day still names which new messages were searched and why nobody cleared the bar. "Found nobody" and "never ran" must never render the same.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0272_boss_a_daily_hunt_for_the_other_side_of_her_mail');
