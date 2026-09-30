-- 0277 — No employee carries a daily cap; the lane's daily and monthly budgets are the only ones.
--
-- THE OWNER, 30 Sep 2026: "i dont want any of my employees to have a cap — i just need a daily and monthly
-- cap — i dont want my work to suffer b/c of stupid employee caps."
--
-- FOUND BECAUSE IT BLOCKED THE BRIEFING'S RESEARCH RUNG. A task's budget is the smaller of a share of the
-- lane's remaining budget and the employee's remaining daily allowance (intake/envelope.ts). The briefing's
-- employee held a few tenths of a dollar a day, below what one cited briefing costs, so the allowance — a
-- number nobody had looked at since the roster was seeded (0155: $0.80, 0175: $0.50) — would have refused it.
--
-- `employees.budget_micros_day = 0` IS THE SYSTEM'S OWN WORDING FOR "LANE BUDGET ONLY" (0154: "0 = lane
-- budget only"), and both readers already honour it: `envelope.ts` applies no employee cap, and
-- `employeeBudgetState` never blocks. So this is data, not a code change, and it is reversible per row.
-- The lane budgets (budgets: day and month), the spend lever, each backend's ceiling and the per-run cap
-- are untouched and are now the only limits.
--
-- A NEW HIRE ALREADY DEFAULTS TO 0 through the Team screen (routes/employees.ts). One hired through an
-- approved proposal may still carry a figure its proposal states; that is an explicit choice and is left.

UPDATE employees SET budget_micros_day = 0 WHERE budget_micros_day <> 0;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0277_boss_no_employee_has_a_daily_cap');
