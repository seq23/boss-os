-- 0335 — the deal grid finally has a duty row (3 Nov 2026 repair).
--
-- `interest-grid.mjs` (`npm run capital:grid`) is the only producer of the morning sections
-- `deals` and `monique_found`, and it ran bare inside com.seq.boss-capital's five-step chain — no
-- duty-run.sh, no duty row, so a failed or never-started run was invisible on Team -> Duties and in
-- D1. A kernel panic (watchdog timeout) rebooted the Mac mid-chain on 3 Nov 2026 and the step never
-- started; nothing retried it, and "read the producer's log" (the repair prompt) was unanswerable
-- because no log existed to read. install-agent-launchd.sh now wraps capital:grid in
-- `duty-run.sh interest-grid.mjs`, so this is the row that run reports against; the chain's own
-- recoverability is chainMark.mjs / capital-chain.mjs / com.seq.boss-capital-resume, which name no
-- duty of their own (validate:launchd-duty-link counts this one). Built on the 0224 tuple shape.
--
-- interest-match.mjs stays unclaimed by this row: it already belongs to the monthly-note duty, and
-- one script, one duty.
--
-- NO MODEL NAMED: interest-grid.mjs is plain node over an already-extracted ledger, arithmetic and
-- string formatting, no provider call anywhere — naming one here would be a line the roster repeats
-- as though a cost were measured when none was spent.

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_deal_grid',
   'The deal grid and Monique found',
   'emp_relationship', 'ops',
   5, 30, 'America/Chicago', 'daily', NULL,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'The deal grid and Monique found',
   json_object(
     'local_job', 'interest-grid.mjs',
     'why_local',
     'Reads ~/.boss-os/capital/ledger.json directly and writes the Deals and Monique found morning sections from named counterparties, assets and sizes at a FINRA-registered broker-dealer, which may not reach this database code-named or counted.',
     'sends', 'no email: it writes the deals and monique_found morning sections and the Deals page grid through POST /api/boss/capital/deals'
   ),
   'Runs as the fourth step of the daily 05:30 capital chain, after the ledger hunt. Every buy and sell in the ~6-month window becomes one row (company, side, size, price, from, when); a day with nothing new still writes both sections so "nothing found" and "never ran" never render the same. A run that does not complete is retried within 15 minutes by com.seq.boss-capital-resume, at most twice a day.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0335_boss_deal_grid_duty');
