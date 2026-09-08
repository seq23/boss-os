-- The run her Mac could never claim, which is why the report never arrived.
--
-- ─── What is actually broken ────────────────────────────────────────────────
--
-- Found by USING the system rather than reading it: materialising `duty_exec_intel` on a local copy
-- of production, running the real Mac agent against it, and watching it answer `{"claimed": false}`
-- with a run sitting right there waiting.
--
-- The lifecycle is three steps and two of them disagree:
--
--   1. `duties/materialise.ts` creates the task as `queued` and sends it to the queue.
--   2. `queue/consumer.ts` picks it up and sets `tasks.status = 'running'` — an event literally
--      named `started` — and THEN dispatches a `backend_runs` row for the Mac to execute.
--   3. `POST /backends/claim` looks for work with:
--
--          WHERE r.status = 'running' AND r.finished_at IS NULL AND t.status = 'queued'
--
-- By step 3 the task is `running`, never `queued`. **The join can never match.** Every duty that
-- routes to `bk_claude_code` dispatches a run that nothing on earth is able to claim.
--
-- ─── Why this was invisible, and what it was mistaken for ───────────────────
--
-- Nothing fails. The duty fires on time, `last_run_at` advances, the task exists, the run exists,
-- and both sit at `running` for ever. The only symptom reaches Today as a Critical Alert reading
-- *"Brokerage Sourcing Sweep fired, but its last task is still running — nothing picked it up"* —
-- which is true, and which reads as "the launchd agent is not running on her Mac." It is not. The
-- agent runs five times a day, asks correctly, and is told there is nothing for it.
--
-- THIS IS WHY THE 06:30 BRIEFING DID NOT ARRIVE. The owner's complaint that Today showed her
-- nothing had two causes stacked: the screen would not show yesterday's report when today's was
-- missing (fixed in 0204), and today's could not be produced at all (fixed here). Fixing only the
-- first would have left a screen that honestly reported a permanent absence.
--
-- The reports that DO exist came in by hand — `POST /backends/dispatch` creates the run without the
-- consumer ever having touched the task, so the task stays `queued` and the claim matches. That is
-- why this looked like it worked: every report she has ever seen came through the one path that
-- bypasses the bug.
--
-- ─── The fix: the lock belongs on the run, not on the task ──────────────────
--
-- The `t.status = 'queued'` clause was doing two jobs. As a FILTER it is wrong — a dispatched task
-- is legitimately `running`. As a LOCK it was the mechanism that stopped two devices, or two ticks
-- of the same agent, taking one run: `UPDATE tasks SET status='running' WHERE status='queued'`
-- changes exactly one row.
--
-- Those two jobs get separated. Exclusivity moves onto `backend_runs`, which is the object actually
-- being claimed — a conditional `UPDATE ... WHERE claimed_at IS NULL` is exclusive by construction
-- and does not care what the task's status happens to be. It is also strictly better than what it
-- replaced: the old lock could not tell "claimed and running" from "dispatched and waiting", so a
-- crashed runner left a run indistinguishable from an unclaimed one.
--
-- WHICH DEVICE HAS IT IS NOW A FACT ON THE RECORD. `claimed_by` names the machine. With one Mac
-- that is documentation; the moment there are two it is the difference between an evidence packet
-- that can be traced and one that cannot.

ALTER TABLE backend_runs ADD COLUMN claimed_at INTEGER;
ALTER TABLE backend_runs ADD COLUMN claimed_by TEXT;

-- Runs already finished were claimed by definition — by the only device that exists. Backfilling
-- them keeps "unclaimed" meaning exactly one thing: waiting for a machine right now.
UPDATE backend_runs
   SET claimed_at = COALESCE(finished_at, started_at),
       claimed_by = 'dev_mac_seq'
 WHERE claimed_at IS NULL
   AND finished_at IS NOT NULL;

-- The index the claim query runs on: unclaimed, unfinished, oldest first, per backend.
CREATE INDEX idx_runs_claimable ON backend_runs(backend_id, claimed_at, finished_at, started_at);

-- ─── The runs stranded by the bug ───────────────────────────────────────────
--
-- Production is carrying dispatched runs that have been unclaimable since they were created. They
-- are left EXACTLY where they are, deliberately: with the claim query fixed they become claimable,
-- and the next agent tick picks up the oldest first. Cancelling them would throw away work the
-- system correctly decided to do, and re-dispatching them here would double up with whatever the
-- duty materialises tomorrow.
--
-- The one thing corrected is the tasks' own record. A task that has been `running` for days with
-- an unclaimed run has not started; saying so is what lets the duty-health alert on Today tell a
-- genuinely stuck run from one that was never reachable.
UPDATE tasks
   SET status = 'queued', started_at = NULL
 WHERE status = 'running'
   AND EXISTS (
     SELECT 1 FROM backend_runs r
      WHERE r.task_id = tasks.id
        AND r.finished_at IS NULL
        AND r.status = 'running'
        AND r.claimed_at IS NULL
   );

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0206_boss_a_dispatched_run_can_be_claimed');
