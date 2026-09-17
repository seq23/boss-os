-- FOUR TABLES THAT LOOK LIKE THIS SYSTEM'S SPEND GOVERNANCE AND ARE NOT.
--
-- Boss OS has TWO parallel sets of model-and-money tables, and only one is live:
--
--   LIVE — Boss OS's own, from 0152. `providers`, `models`, `budgets`, `usage_ledger`, and every
--          route carries a `route_id`. This is what `src/worker/boss/router/` reads and writes.
--   INHERITED — the West Peek chassis's, from 0004 and 0015. `provider_registry`, `provider_model`,
--          `budget_policy`, `ai_run`. Boss OS was built by cloning West Peek OS, and these came
--          with the clone.
--
-- Anyone opening the wrong one draws the wrong conclusion, and the numbers make that easy to do:
-- `budget_policy` has been sitting on **$25 a day and $2 a run** since the clone, while the lane
-- budgets the router actually enforces are $1.75 a day and $52.50 a month for ops. A reader
-- checking "what is this allowed to spend" against the inherited row is out by more than an order
-- of magnitude, and `ai_run` — the chassis's run log — has **zero rows**, so it also reads as
-- though nothing has ever run.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- THE DECISION: FENCED, NOT REMOVED. Here is why, because "we chose not to delete" is the answer
-- that needs the reasoning and the other one does not.
--
-- 1 · `ai_run` IS DELIBERATELY READ, AND BY BOSS OS. `src/worker/boss/spend/reconcile.ts` exists
--     precisely because money was recorded in three places and nothing added them up. It reads
--     `ai_run` and `vendor_spend` through the chassis's own `firmSpend`, and says so in its own
--     header: "a budget that hard-stops at $2 while a second ledger accrues elsewhere is not a
--     budget". Dropping `ai_run` would delete the second half of the only honest total this system
--     produces. Its zero rows are not a reason to remove it; they are the finding it reports.
--
-- 2 · THE CHASSIS IS BEING REMOVED AS A UNIT, and its 129 E2E journeys are the regression suite for
--     that removal (STATUS.md). Pulling three of its tables out ahead of the removal breaks the
--     suite's ability to prove the removal was clean — you would be dismantling the scaffolding
--     while still standing on it. `provider_registry`, `provider_model` and `budget_policy` are
--     read by `src/worker/services/aiGovernance.ts` and `src/worker/ai/runAi.ts`, which are chassis
--     files with chassis tests.
--
-- 3 · A DROP IS NOT REVERSIBLE AND A FENCE IS. If the fence is wrong, it is one migration to undo.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- WHAT THE FENCE ACTUALLY IS, because "marked dead" in a comment is not a fence.
--
-- A · THE NUMBERS STOP READING AS PERMISSION. A new policy row supersedes the stale one at the
--     most restrictive posture the chassis's own enum allows, with both caps at zero. The table is
--     append-only by trigger, so superseding is the mechanism it was built for — and the $25 row
--     stays visible beneath the row that retired it, which an edit would have destroyed.
--
--     Zero is the honest posture for a code path nothing reaches: production serves only
--     boss.sequoiataylor.com (`BOSS_HOSTS` in `src/client/main.tsx`), so the chassis AI lane is
--     unreachable there, and a dead lane that would refuse is strictly better than a dead lane
--     advertising $25.
--
--     IT CHANGES NO TEST. Every chassis suite that exercises budget policy inserts its OWN row
--     (`tests/aiSpend.test.ts`, `tests/intelligence.test.ts`, `tests/notifications.test.ts` and
--     others all do) rather than relying on the seed, which is how they were able to test the
--     modes at all.
--
-- B · `set_by` SAYS WHAT THE ROW IS. It is an informational column — nothing branches on it — and
--     it is the field a human reads beside the numbers. The superseding row states its status in
--     words there, so somebody querying this table directly is told before they act on it.
--
-- C · AND A REGISTERED VALIDATOR KEEPS BOSS OS OUT. `scripts/validate/a-dead-table-is-not-an-authority.mjs`
--     hard-fails if anything under `src/worker/boss/` or `src/client/boss/` touches
--     `provider_registry`, `provider_model` or `budget_policy`, and allows `ai_run` in exactly one
--     file — the reconciler — while REQUIRING that file to keep reading it, so the join between the
--     two ledgers cannot be lost silently either. That is the part with teeth: a comment saying
--     "dead" stops a careful reader, and a scan in the gate stops the rest.
--
-- The vocabulary note from 0174 still stands, and is the reason this is a fence rather than a
-- rename: `pricing_state` deliberately reuses the chassis's four words so the two halves of this
-- Worker describe price confidence in one language. Renaming these tables would break that and
-- every `§`-citation pointing at them.

-- A NEW ROW, NOT AN EDIT, BECAUSE THE TABLE REFUSES EDITS — and it is right to.
--
-- `budget_policy` carries a trigger enforcing policy versioning: "budget_policy is immutable:
-- UPDATE rejected". A governance record that could be quietly rewritten would make its own history
-- worthless, so the chassis made it append-only and the readers take the LATEST row
-- (`getLatestBudgetPolicy`: ORDER BY created_at DESC, rowid DESC LIMIT 1).
--
-- Superseding it is therefore the mechanism the table was designed for, and it is better than an
-- edit anyway: the $25/day row stays visible as the thing it was, dated, beneath the row that
-- retired it. The fence is a decision with a timestamp rather than a value nobody can account for.
--
-- `created_at` TAKES THE COLUMN DEFAULT — the moment of application — AND THAT IS NOT THE 0174
-- EXCEPTION. 0174 forbids `now` for a price check, because that column records when a HUMAN READ A
-- VENDOR'S PAGE and restamping it on every environment would relabel an old check as fresh. This
-- column records something else entirely: when a governance decision TOOK EFFECT in this database.
-- A decision takes effect when it is applied, so `now` is the true answer here and a literal would
-- be the false one. It also has to be: the seed row was itself written with `now` at clone time, so
-- any fixed timestamp would sort BEFORE it and the retirement would never become the latest row —
-- which is exactly what a first attempt at this migration did, and the readers went on returning
-- $25.
INSERT OR IGNORE INTO budget_policy
  (id, firm_scope, cost_mode, privacy_mode, daily_cap_usd, per_run_cap_usd, set_by, created_at)
VALUES
  ('bp_west_peek_lane_retired', 'west-peek', 'CRITICAL_ONLY', 'LOCKDOWN', 0, 0,
   'DEAD LANE — West Peek chassis policy, not Boss OS governance. Boss OS spends against `budgets`, '
   || '`models` and `usage_ledger`; this table governs the inherited chassis lane, which production '
   || 'cannot reach (BOSS_HOSTS in src/client/main.tsx serves only boss.sequoiataylor.com). The '
   || 'superseded row read $25/day and $2/run from clone time while the live ops lane was $1.75/day, '
   || 'which is the misreading this retires. Set to the most restrictive posture the enum allows so '
   || 'a dead lane refuses rather than advertising money. See migration 0252.',
   strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- The airlock classifies every table and refuses an unclassified one (v20.1 §11). These four have
-- no `data_policy` row, so they already fail closed — which is correct and is left alone. Recording
-- them as LOCAL_ONLY/LOCAL_ONLY would be a lie in the other direction: they are ordinary cloud rows
-- that nothing should be reading, and "do not sync this" is a different statement from "this is
-- dead".

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0252_boss_the_dead_chassis_tables_stop_reading_like_authority');
