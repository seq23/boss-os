-- Naming where the Executive Intelligence Report actually runs.
--
-- WHAT WAS BROKEN, IN THREE PLACES, AND WHY THE SCREEN SAID NOTHING. The duty fired every morning
-- at 06:30 Central and had done since it was created. `materialise.ts` wrote a task row and never
-- enqueued it, so `boss_task_queue` stayed empty while tasks sat "queued". Nothing anywhere held an
-- `INSERT INTO executive_reports`, so even a task that ran could not have produced one. And the
-- queue consumer's only move was to ask a cloud model — which, for this report, is not a slower
-- answer but a wrong one.
--
-- THE THIRD IS THE ONE THIS MIGRATION FIXES. A Cloudflare Worker cannot read this morning's news. A
-- model asked to recall it returns something shaped exactly like a report, citing sources it never
-- opened, and the duty's own success criterion is "every figure carries a named source and the time
-- it was read". Only something that can open a page can meet that.
--
-- That something is Claude Code on the owner's Mac, which she confirmed is where this belongs. It
-- reaches this system as `bk_claude_code` — an `agent_executed` backend, registered since 0173,
-- whose allowed_kinds already include `research`. Nothing new is authorised here.
--
-- THE BACKEND IS NAMED IN DATA, NOT INFERRED FROM THE TITLE. The consumer reads `backend_id` off
-- the task's input and dispatches a claimable run instead of a completion. Guessing from the kind
-- would let a task change which machine runs it because its wording changed, and "which machine
-- runs it" is exactly the decision that must not drift.
--
-- `delivers` was already here and was already read by nothing. It now names the contract that
-- `duties/deliverReport.ts` fulfils when the runner reports back.

UPDATE standing_duties
   SET task_input = json_set(
         COALESCE(task_input, '{}'),
         '$.backend_id', 'bk_claude_code',
         '$.delivers', 'executive_reports',
         '$.spec', 'docs/boss/EXECUTIVE_INTELLIGENCE.md'
       )
 WHERE id = 'duty_exec_intel';

-- The two tasks that were materialised into the void on the 6th and 7th. They can never run: they
-- carry no envelope, no intake_kind and no backend, and no queue message exists for them. Closed
-- with the reason rather than left "queued" for ever, because a permanently queued task is exactly
-- the signal that hid this bug in the first place.
UPDATE tasks
   SET status = 'cancelled',
       finished_at = CAST(strftime('%s','now') AS INTEGER) * 1000,
       error = 'Never enqueued: created by a standing duty before duties used the real intake path. Superseded by the next scheduled run.'
 WHERE status = 'queued'
   AND intake_kind IS NULL
   AND envelope_id IS NULL
   AND employee_id = 'emp_research';

-- ─── Claude Code may now take work ───────────────────────────────────────────
--
-- `bk_claude_code` has sat at `registered` since 0173 with the reason "Awaiting Stage 2 - the agent
-- runner that executes it." That reason has been untrue for a while: Stage 2 shipped —
-- `scripts/sync-agent/runner.mjs` claims a run, `backends/claudeCode.mjs` executes it, and
-- `tests/boss/agentRunner.test.ts` covers it. The row was simply never updated, so the guard kept
-- refusing every dispatch with a sentence describing work that was already done.
--
-- That refusal was CORRECT BEHAVIOUR and it is what surfaced this: the consumer dispatched, the
-- boundary declined, and the task failed carrying the reason. A guard that fails loudly for a stale
-- reason is worth far more than one that waves work through.
--
-- ENABLING IS NOT REFUSED HERE, and the code says why: Claude Code's credential is
-- `local:claude-code-session`, which reads as `unverifiable_here` rather than `absent` — it lives
-- on the owner's Mac by design and the private agent verifies it at claim time. `BOSS_PASSCODE` is
-- in the vault, so the agent can authenticate as her.
--
-- WHAT ENABLED MEANS AND DOES NOT MEAN: it means this backend may take work. A run it is given
-- waits, visibly, in `backend_runs` until the local agent claims it. Nothing here starts that agent.
UPDATE execution_backends
   SET status = 'enabled',
       status_reason = 'Stage 2 shipped: the sync agent claims runs and executes them through Claude Code on the owner''s Mac, and BOSS_PASSCODE is in the vault so it can authenticate as her. A dispatched run waits in backend_runs until the local agent claims it.'
 WHERE id = 'bk_claude_code' AND status = 'registered';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0180_boss_report_runs_on_her_mac');
