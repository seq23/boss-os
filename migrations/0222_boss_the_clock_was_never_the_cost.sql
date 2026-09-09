-- The briefing did not fail. It finished, and was thrown away by a stopwatch.
--
-- ─── What actually happened, read from ~/Library/Logs/boss-agent/agent.log ──
--
-- TWO runs are on that log. BOTH exited 124, which is a timeout kill.
--
--   duty_exec_intel        haiku-4-5     started 1788955318355  finished 1788955631947  = 313.6s
--   duty_brokerage_sourcing sonnet-5     started 1788957143326  finished 1788957443573  = 300.2s
--
-- Both were leashed to 300s by 0196. The first needed 313. The second was cut off at 300.2 with the
-- executioner's precision of a `kill` that fires exactly on the number.
--
-- AND THE FIRST RUN'S WORK WAS COMPLETE WHEN IT WAS KILLED. The same log entry carries a fully
-- formed `delivers.json` — sections, sources with read_at timestamps, three named gaps, and a
-- genuine correction about a company's listing status. Its own honesty field reads
-- `"status": "complete"`. She was shown: "Today's research run failed. Nothing below is a finding."
--
-- The code half of that is fixed in `scripts/sync-agent/` — the deliverable is the FILE, and a
-- process that was killed after writing a complete file did not fail. This migration fixes the
-- other half: the leash that killed it.
--
-- ─── THE MODEL IS THE COST LEVER HERE. THE CLOCK IS NOT. ────────────────────
--
-- Write this down, because the next cost sweep will otherwise cut these numbers again for exactly
-- the reason 0196 did, and 0196's reasoning was sound in general and wrong in this particular.
--
-- 0196 did two things: it named cheap models, and it shortened leashes. THE FIRST ONE PRODUCED ALL
-- OF THE SAVING. The $3.88 briefing was expensive because the duty named no model and defaulted to
-- the dearest one available; naming haiku fixed precisely that, and the log confirms the briefing
-- has been running `claude-haiku-4-5` ever since. The second was belt-and-braces on a problem
-- already solved, and it is the half that kills a finished report.
--
-- The measured evidence, from GET /api/boss/system/cost over thirty days: total cost 0, five calls,
-- and the only model with any recorded usage at all is Llama 3.1 8B on Workers AI, also at 0. The
-- Claude Code backend runs through the owner's own subscription and records `cost_micros: 0` for
-- every run, which `claudeCode.mjs` says out loud. So the 300s cut bought nothing measurable. What
-- a shorter leash conserves is her plan's capacity, which is real — and is not what the ceiling
-- below is denominated in.
--
-- ─── 900 seconds, and why that number ──────────────────────────────────────
--
-- Not 1200, which is what 0181 had before the cut, because restoring a number without a reason is
-- how it gets cut again. 900 is chosen against the observation: the run that completed took 313.6s,
-- so 900 is nearly three times the demonstrated requirement — enough headroom for a slow source or
-- a retry, and still a quarter shorter than the leash 0196 replaced. A run that cannot finish
-- research in fifteen minutes has a different problem, and the timeout should find it.
--
-- THE THREE WEEKLIES KEEP THEIR 600s. Nothing on the log shows them timing out, and raising a limit
-- that has never bound anything would be exactly the unevidenced change this file argues against.

UPDATE standing_duties
   SET task_input = json_set(COALESCE(task_input, '{}'), '$.requested.max_seconds', 900)
 WHERE id = 'duty_exec_intel';

-- SOURCING IS THE SAME DEFECT AND IT HAS BEEN INVISIBLE. The Capital tab shows 28 candidates, every
-- one already reviewed, and nothing new — which reads as a sweep with nothing left to find. It is a
-- sweep that has been killed at 300.2s. The tab was not stale because the list was exhausted.
UPDATE standing_duties
   SET task_input = json_set(COALESCE(task_input, '{}'), '$.requested.max_seconds', 900)
 WHERE id = 'duty_brokerage_sourcing';

-- ─── The ceiling she authorised ──────────────────────────────────────────────
--
-- $50 a month, her instruction on 2026-09-09: "ok u can raise my budget to $50 for the month for
-- boss os".
--
-- JUSTIFIED AS HEADROOM SHE ASKED FOR, AND NOT AS ANYTHING ELSE. It would be easy and wrong to
-- write that this is what makes the longer timeouts affordable: nothing has ever spent against this
-- ceiling, so it was not the constraint, and a migration comment claiming a saving or a cost that
-- cannot be evidenced is the kind of authoritative-looking number that has misled her repeatedly.
UPDATE execution_backends
   SET monthly_ceiling_micros = 50000000,
       status_reason = status_reason ||
         ' Ceiling raised to $50/month on 2026-09-09 at the owner''s explicit instruction. It is headroom, not a response to observed spend: measured spend against it over the preceding thirty days was $0, because this backend runs on her own subscription and attributes no per-run charge.'
 WHERE id = 'bk_claude_code';

-- ─── Two limits that could not both be true ──────────────────────────────────
--
-- The Inbox reads "Today · $0.00 of $2.00". That $2 daily cap times thirty days is $60, against a
-- monthly ceiling of $50 — the two cannot both be honoured, and nothing anywhere reconciled them.
-- It is the same defect class as a count that disagrees with its own list, and it survived because
-- neither number has ever been approached.
--
-- THE MONTHLY FIGURE IS AUTHORITATIVE AND THE DAILY ONE IS DERIVED FROM IT. A month is the period
-- she actually authorises, and a day is a pace within it. 50000000 / 31 = 1612903 micros, using the
-- longest month so the derived figure can never exceed the ceiling in any month of the year.
UPDATE budgets
   SET limit_micros = 1612903
 WHERE id = 'bdg_ops_day';

UPDATE budgets
   SET limit_micros = 50000000
 WHERE id = 'bdg_ops_month';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0222_boss_the_clock_was_never_the_cost');
