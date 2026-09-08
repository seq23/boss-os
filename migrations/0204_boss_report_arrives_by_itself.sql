-- The briefing arrives by itself, and the Inbox is given a job it can actually hold.
--
-- ─── Her words, 8 September 2026 ────────────────────────────────────────────
--
-- "when i click on inbox i have all these executive intelligence reports to 'approve' then they
--  disappear after hitting the button. then in the 'today' screen i dont see any hting WTF? they
--  are to be delivered to the today screen automatically. i shouldnt have to fucking approve it.
--  the old ones should auto archive u need to figure out what the inbox is really for and why
--  there is an approve button and why the today screen has nothing"
--
-- Every clause of that is a real defect and all four are fixed here and in the code this migration
-- accompanies. The most damning part is that the system agreed with her IN WRITING:
-- `approvals/execute.ts` carried the comment "APPROVING APPLIES NOTHING, AND THAT IS THE DESIGN
-- RATHER THAN AN OMISSION." It was right that nothing is applied and wrong to conclude that this
-- should therefore be an approval. A control whose two outcomes differ only in whether the card is
-- still on screen is not a decision. It is a chore, dressed as governance, on the one screen whose
-- entire purpose is to remove chores — her own sentence for what Boss OS is for is "to take away
-- the cognitive load of figuring out what i should do each day."
--
-- ─── What the Inbox is FOR, decided here rather than left implicit ──────────
--
-- AN APPROVAL EXISTS WHEN HER ANSWER CHANGES WHAT HAPPENS NEXT.
--
-- That is the whole rule. If approving and rejecting lead to the same world, there was no question,
-- and putting it on a list teaches her to clear the list without reading it — which is how the one
-- item that DID need her gets cleared too. An inbox that cries wolf is worse than no inbox.
--
-- Under that rule the Inbox keeps: a proposed change to files on her machine, a run that tripped a
-- forbidden action, a run that asked for her decision, work she dispatched by hand that delivers
-- into no table, and every other approval kind that already existed (memory promotion, capability
-- admission, prompt library, trading, intake, model routing) — all of which apply something real
-- when approved.
--
-- It loses exactly one thing: her own briefing, and the four other DELIVERED outputs like it. Those
-- are written to their tables and shown on their screens before the approval was ever raised. See
-- `src/worker/boss/backends/needsDecision.ts`, which is where the rule lives and is tested.
--
-- ─── Three schema changes, and why each one is the smallest possible ────────

-- 1. ARCHIVING, so she never prunes anything.
--
-- "the old ones should auto archive". `archived_at` rather than a DELETE: the report format carries
-- `corrections` — where today's reading contradicts yesterday's — so the reports are a chain and
-- deleting the previous link would break the one feature that depends on it.
--
-- WHAT ARCHIVING ACTUALLY CONTROLS is whether Today may fall back to a report. Today now shows the
-- most recent briefing when the 06:30 run has not landed, rather than the blank she described; that
-- fallback is only honest for yesterday, and a fortnight-old briefing quietly standing in for this
-- morning would be the same defect with a longer fuse. So delivering a report archives every older
-- one in the same statement.
ALTER TABLE executive_reports ADD COLUMN archived_at INTEGER;

-- The backfill states the rule for rows that already exist: everything but the newest is archived.
-- Written as "not the max day_id" rather than by timestamp because a report is keyed to the day it
-- is FOR, and a retry can write an older day later.
UPDATE executive_reports
   SET archived_at = strftime('%s','now') * 1000
 WHERE archived_at IS NULL
   AND day_id < (SELECT MAX(day_id) FROM executive_reports);

CREATE INDEX idx_report_live ON executive_reports(archived_at, generated_at DESC);

-- 2. THE CEREMONIAL APPROVALS ALREADY SITTING THERE.
--
-- She has been clearing these by hand every morning. Leaving the backlog would mean the fix arrives
-- and her Inbox still opens on a stack of briefings to acknowledge — the defect outliving its own
-- repair, which is the ordinary way a fix fails to be felt.
--
-- WHAT IS RETIRED, AND WHY THE LINE IS DRAWN HERE RATHER THAN AT THE NEW RULE.
--
-- The first draft of this statement retired only approvals whose task declared a handled `delivers`
-- key. Running it and then OPENING THE INBOX — which is the only way any of this was ever going to
-- be checked — left two cards reading "Executive Intelligence Report", because both came from runs
-- dispatched by hand before the duty carried that key. The defect would have outlived its own
-- repair by exactly the amount she would notice.
--
-- So the backfill is drawn at the thing that is true of every one of them: **approving it applies
-- nothing.** `approvals/execute.ts` marks the task done and changes nothing else, for every
-- `backend_run` approval that has ever existed. A card whose two outcomes differ only in whether it
-- is still on screen, for work that finished days ago, is not a decision she has been putting off.
--
-- The conditions are still real. A run that FAILED or was REFUSED keeps its card, because those
-- close with a reason she may want. A run that touched a file under `/GitHub/` keeps its card,
-- because that is a change to her machine — the one thing in this lane that genuinely is a
-- proposal. Everything else is history being acknowledged.
--
-- GOING FORWARD IS DECIDED BY CODE, NOT BY THIS STATEMENT. `backends/needsDecision.ts` is narrower:
-- it keeps ad-hoc dispatched work in the Inbox, because a task with no delivery contract has
-- nowhere else for its output to land and the docket IS the result. This backfill is a one-time
-- clearing of a list she has been hand-clearing every morning.
--
-- Resolved as `approved` with `decided_by = 'system'` and a reason, rather than deleted. The audit
-- trail must be able to say that a decision was retired and why; a row that vanishes says nothing.
UPDATE approvals
   SET status = 'approved',
       decided_at = strftime('%s','now') * 1000,
       decided_by = 'system',
       decision_note = 'Retired by 0204: a delivered briefing is not a decision. Accepting it applied nothing, and the work had already landed on Today.'
 WHERE status = 'pending'
   AND kind = 'backend_run'
   AND EXISTS (
     SELECT 1 FROM backend_runs r
      WHERE r.id = approvals.origin_id
        AND r.status = 'succeeded'
        AND r.error IS NULL
        -- A DELIVERY RUN WRITES ITS OWN WORKSPACE, AND THAT IS NOT A PROPOSAL.
        --
        -- Found by opening the Inbox after the first version of this migration: a briefing approval
        -- was still there, because the way a run delivers is by writing
        -- `~/.boss-os/reports/delivers.json`. The delivery mechanism was being read as a change to
        -- her machine, so the fix for "I should not have to approve my own briefing" would have
        -- shipped and left the briefing in the Inbox.
        --
        -- `/GitHub/` is the conservative test for this one-time backfill: no run has ever touched a
        -- file of hers outside her repositories and its own workspace, and a false negative here
        -- costs one card she clears by hand. The precise per-file rule lives in
        -- `src/worker/boss/backends/needsDecision.ts` and governs everything from now on.
        AND (
          COALESCE(r.files_touched, '[]') IN ('[]', 'null', '')
          OR r.files_touched NOT LIKE '%/GitHub/%'
        )
   );

-- The tasks those approvals were holding open. `awaiting_approval` on work that has been delivered
-- and accepted is a lie the Today screen reads: "work in flight" counts it, and the duty-health
-- query treats a task that never left `awaiting_approval` as a duty nothing picked up.
UPDATE tasks
   SET status = 'done',
       finished_at = COALESCE(finished_at, strftime('%s','now') * 1000)
 WHERE status = 'awaiting_approval'
   AND approval_id IN (
     SELECT id FROM approvals
      WHERE decided_by = 'system'
        AND decision_note LIKE 'Retired by 0204:%'
   );

-- 3. THE MAILBOX FINDINGS TABLE — Job 3, and the "missed connections" feature that has been the
--    first outstanding item in OPERATIONS.md since it was written.
--
-- ─── Her words ──────────────────────────────────────────────────────────────
--
-- "the people tab is stupid, i just want one of the employees to peruse the mailbox and find
--  connections and find people that could be buyers that i havent talked to in a while etc.... and
--  find deals im missing between a buyer and seller in my inbox"
--
-- WHY IT IS A TABLE OF FINDINGS AND NOT A LIST OF PEOPLE. `relationships` already holds 200 rows
-- and she called that screen stupid, correctly: every row reads "importance 100 · trust 100 ·
-- recency 0 · opportunity 0" because those numbers were seeded uniformly and nothing has ever
-- computed them. A list of 200 identical scores is not knowledge about anyone. What she asked for
-- is not a directory — it is an employee who has READ something and has something to tell her.
--
-- So a finding is an assertion with a subject, a reason, a suggested next action and evidence, and
-- it is worthless without all four. The columns are NOT NULL for that reason.
--
-- ─── The privacy shape, which is the whole design constraint ────────────────
--
-- This is the first thing in Boss OS that reads the CONTENTS of her mail on a schedule. Two
-- properties keep that safe and both are structural rather than promised:
--
--   · IT CANNOT RUN IN THE CLOUD. The Claude Code runner strips every credential matching
--     KEY|TOKEN|SECRET|PASSCODE, so an agent cannot reach her mailbox even if instructed to. This
--     runs as a launchd job on her Mac, like Monique's network refresh and Simone's KDP watch.
--   · CONTENT NEVER LEAVES THE MACHINE. Subjects and bodies stay under ~/.boss-os/. What reaches
--     this table is code names and prose the job composed — and the endpoint refuses any batch
--     containing an "@", the same guard that caught a real leak on the contacts sync's first run.
--
-- `data_policy` below records that residency rather than leaving it to a comment.
CREATE TABLE mailbox_findings (
  id                TEXT PRIMARY KEY,

  -- missed_deal      — someone asked about a company; someone else later had access to it.
  --                    THE ONE SHE ASKED FOR FIRST, and the reason this needs bodies at all.
  -- cooling_buyer    — a counterparty who used to talk about buying and has gone quiet.
  -- unworked_intro   — an introduction that was made and never followed up.
  -- connector        — someone who keeps introducing people, whose value is invisible in a list.
  kind              TEXT NOT NULL CHECK (kind IN ('missed_deal','cooling_buyer','unworked_intro','connector')),

  -- Code names only, resolved on her Mac. Two because half of these findings are about a PAIR.
  subject_code      TEXT NOT NULL,
  counterpart_code  TEXT,

  -- What the finding actually says, in a sentence she can act on without opening anything else.
  headline          TEXT NOT NULL,
  -- Why the job believes it. Dates, counts, what was said — never the text that was read.
  because           TEXT NOT NULL,
  -- The next action, named. A finding with no suggested move is an observation, and she has enough.
  suggested_action  TEXT NOT NULL,

  -- Message ids and dates on her Mac, so she can find the actual thread in Gmail in one click.
  -- Ids, never contents.
  evidence          TEXT NOT NULL DEFAULT '[]',

  -- The company or topic the two sides have in common, when there is one. Free text, hers.
  subject_matter    TEXT,

  -- high   — a live pairing, both sides recent.
  -- medium — plausible and worth a look.
  -- low    — a pattern rather than an opportunity.
  confidence        TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),

  -- new | acted | dismissed. Nothing is promoted anywhere automatically: a finding becoming a
  -- "relationship" on its own would put a stranger into her touch list and make the system lie
  -- about who she knows. Same rule the sourcing candidates follow.
  status            TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acted','dismissed')),
  notes             TEXT,

  -- Which run found it, so every finding traces to the job that produced it.
  run_id            TEXT,
  found_at          INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,

  -- Superseded when a later sweep finds the same thing again. Same archiving rule as the report:
  -- she prunes nothing, and a finding she has seen every morning for a month is noise.
  archived_at       INTEGER
);

-- One live finding per subject, counterpart and kind. A weekly sweep that re-derives the same
-- missed deal must UPDATE it rather than stack a fourth copy on her screen.
CREATE UNIQUE INDEX idx_finding_unique ON mailbox_findings(kind, subject_code, COALESCE(counterpart_code, ''), COALESCE(subject_matter, ''));
CREATE INDEX idx_finding_live ON mailbox_findings(archived_at, status, confidence, found_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('mailbox_findings', 'relationships', 'CLOUD_SYNC', 'LOCAL_ONLY',
   'Structured conclusions drawn from her mailbox on her own Mac. Code names and composed prose only — never a subject, never a body, and the ingest endpoint refuses any batch containing an "@". LOCAL_ONLY for AI processing because the reasoning that produced these ran on her machine and the result must never be handed back to an external model as context.')
ON CONFLICT(entity) DO NOTHING;

-- ─── Monique's mailbox sweep ────────────────────────────────────────────────
--
-- SUNDAY 18:30, half an hour after the network refresh she already owns, and on purpose: the
-- refresh rebuilds the touch list from mail metadata, and this sweep reads the same mailbox for
-- meaning. Running the meaning pass on a stale touch list would produce "X has gone quiet" findings
-- about people who wrote on Friday.
--
-- `local_job` because a Worker cannot read her mail and never will. Monique owns the work; launchd
-- is the only thing that can perform it. Her `last_run_at` advances when the job REPORTS BACK —
-- which is what makes this a duty row at all, and is exactly why OPERATIONS.md says the network
-- refresh and the property read are NOT duty rows yet: neither reports.
--
-- next_due_at is set in the same statement as the cadence. 0197 exists because it was not, once,
-- and a Mon/Wed/Fri duty was left due on a Tuesday.
INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria) VALUES
  ('duty_mailbox_sweep', 'Mailbox sweep — missed deals, cooling buyers, connectors',
   'emp_relationship', 'ops',
   18, 30, 'America/Chicago', 'weekly', 0,
   -- Set in the same statement as the cadence, per 0197. Sunday 18:30 America/Chicago is Monday
   -- 00:30 UTC in summer; the duty's own recompute takes over after the first materialisation, and
   -- seeding it a day out rather than at 0 stops the first cron tick after deploy firing a mailbox
   -- read the moment this lands.
   unixepoch() * 1000 + 86400000,
   'local_job', 'research', 'Mailbox sweep',
   json_object(
     'delivers', 'mailbox_findings',
     'local_job', 'mailbox-sweep.sh',
     'why_local',
     'Reading the contents of her mail needs her mailbox, and the Claude Code runner strips every credential from its environment on purpose. This runs from launchd on her Mac; subjects and bodies stay under ~/.boss-os/ and only code-named findings are posted back.'
   ),
   'Every finding names a person by code name, says why in dates and counts rather than quotes, and proposes one next action. A sweep that read mail and found nothing reports zero findings rather than staying silent.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0204_boss_report_arrives_by_itself');
