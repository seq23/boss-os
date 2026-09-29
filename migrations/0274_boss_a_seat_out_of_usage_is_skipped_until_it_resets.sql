-- 0274 — A seat whose plan is out of usage is skipped until it resets, and the work goes to the next seat.
--
-- WHAT WAS WRONG (found 29 Sep 2026, reading the code against the same defect in west-peek-os).
-- `bk_claude_code` and `bk_codex` run on flat-fee plans (Claude Max, ChatGPT Plus). When a plan's usage
-- window is spent the CLI does not fail like a dead process: it prints a sentence and may exit 0. The
-- runner graded a run by its JSON error flag and exit code, so that sentence could be filed as the
-- answer. And this system's only view of a seat being "capped" is its OWN ledger of plan-equivalent
-- spend (0222/0195), which cannot see usage the owner spends interactively — her Claude Code work
-- draws on the same window — so a plan could be empty while the ledger said there was room.
--
-- WHAT THIS ADDS. Two nullable columns on the row the guard already reads for every dispatch:
--
--   exhausted_until   INTEGER, epoch ms. While it is in the future the guard refuses the backend with
--                     `plan_spent`, so a ladder (briefing, and from 0275 the other seat duties) walks
--                     to the next seat AT DISPATCH, exactly as it does for a spent ceiling.
--   exhausted_reason  The CLI's own sentence, truncated, so "why did the morning skip Claude" is on
--                     the row and on the ladder_step event.
--
-- It is written by the runner's report (`seat_exhausted` on the evidence packet) and cleared by the
-- next run of that backend that succeeds. It EXPIRES BY ITSELF: a timestamp, not a flag, so nobody has
-- to remember to switch a seat back on. A seat still limited when tried again costs one fast failed
-- run and re-arms it.
--
-- Additive; a row with both NULL behaves exactly as before.
ALTER TABLE execution_backends ADD COLUMN exhausted_until INTEGER;
ALTER TABLE execution_backends ADD COLUMN exhausted_reason TEXT;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0274_boss_a_seat_out_of_usage_is_skipped_until_it_resets');
