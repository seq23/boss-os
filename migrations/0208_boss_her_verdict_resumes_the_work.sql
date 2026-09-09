-- Approving something has to be the thing that makes it happen.
--
-- ─── Her words, across three messages on 9 September ────────────────────────
--
--   "simone should deliver them in my inbox in the Boss OS system!!!!? right?"
--
--   "everything should be delivered like this for my approval? and i should have an easy way
--    to say approved or try again and if i say apprpved she should continue to finish"
--
--   "i dont care about this happening right away id rather see them in my inbox for approval
--    and then approve them and have simone publish them"
--
-- The last one is the one that makes this real rather than a demonstration. Seven finished book
-- covers existed and could have been uploaded by hand in ten minutes; she chose to WAIT for this
-- mechanism instead. So the seven blocked titles publish through this loop or they do not publish.
--
-- ─── Why this is not the Inbox that was emptied yesterday ───────────────────
--
-- 0205 emptied the approval inbox on a rule that still stands: AN APPROVAL EXISTS WHEN YOUR ANSWER
-- CHANGES WHAT HAPPENS NEXT. Her briefing, the buyer list, the backlink prospects — approving and
-- rejecting those led to the same world, so they were not questions and putting them on a list
-- taught her to clear the list without reading it.
--
-- "Do these seven covers look right" is the opposite case. It is taste, it is outward-facing, and
-- no amount of computation settles it. It is exactly the residue her decide-and-fix rule leaves
-- behind: the one legitimate stop is a judgement only she can make.
--
-- AND THE MECHANISM ONLY WORKS IF HER ANSWER IS A TRIGGER. The defect 0205 found was an inbox where
-- approving applied nothing and the item vanished. Putting judgement calls into an inbox that still
-- behaved that way would rebuild the same defect one level up, which is why `resume_kind` is NOT
-- NULL, why the endpoint refuses a kind with no handler, and why a resume that fails leaves the
-- item ON HER SCREEN rather than recording a decision over a thing that never happened.
--
-- ─── One list, not two ─────────────────────────────────────────────────────
--
-- `deliverable_id` is the link back to `owned_deliverables`. Her CLAUDE.md names "two components
-- each keeping their own list with no link between them" as a defect class, and a second register
-- of things-needing-her, escalating separately from the first, would be a textbook instance. The
-- escalation for an unanswered judgement is computed in `today/deliverables.ts` alongside every
-- other piece of owned work, on the same ladder.
--
-- ─── What it does NOT do ───────────────────────────────────────────────────
--
-- It does not become the queue everything routes through. Only taste, money and outward-facing
-- actions belong here. If something the system could decide for itself ends up on this list, that
-- is the bug, and it is the same bug 0205 removed.
--
-- An unanswered judgement is also NOT a stop on the rest of the employee's work: Simone keeps
-- chasing the KDP case on her Mon/Wed/Fri cadence while the covers wait for a verdict.

CREATE TABLE judgement_calls (
  id             TEXT PRIMARY KEY,
  -- THE INBOX ITEM ITSELF. Reused rather than reinvented: `approvals` already carries the decision,
  -- the audit trail, the risk ordering and `approval_events`, and a parallel decision table would
  -- be the second-list defect this file exists to avoid.
  approval_id    TEXT NOT NULL,
  employee_id    TEXT NOT NULL REFERENCES employees(id),
  -- The owned work this belongs to, so one register escalates and one screen shows it.
  deliverable_id TEXT,

  title          TEXT NOT NULL,
  -- What she is actually being asked. Not "review the covers": the specific judgement, in words she
  -- would use, because a question she has to reconstruct is one she defers.
  question       TEXT NOT NULL,

  -- WHAT HAPPENS WHEN SHE SAYS YES. Every value here must exist in RESUME_HANDLERS in
  -- `src/worker/boss/approvals/resume.ts`; the creating endpoint refuses one that does not, so a
  -- judgement call cannot be born unable to resume anything. Same construction as `terminal_check`
  -- on an owned deliverable, and for the same reason: the failure it prevents is an item that looks
  -- actionable and is inert.
  resume_kind    TEXT NOT NULL,

  -- awaiting   — on her screen, escalating.
  -- approved   — she said yes AND the resume ran. Both, never one without the other.
  -- try_again  — she said no, with a reason, and the work went back to the employee.
  -- superseded — a later attempt replaced this one.
  state          TEXT NOT NULL DEFAULT 'awaiting'
                 CHECK (state IN ('awaiting','approved','try_again','superseded')),
  -- "Try again" with no reason makes the second attempt a coin flip.
  her_note       TEXT,
  attempt        INTEGER NOT NULL DEFAULT 1,

  decided_at     INTEGER,
  -- WHEN THE WORK ACTUALLY RESTARTED, which is a different fact from when she decided. A decision
  -- with no resume behind it is the exact thing this table exists to make impossible, and leaving
  -- the two in one column would hide it.
  resumed_at     INTEGER,
  resume_detail  TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_judgement_awaiting ON judgement_calls(state, created_at);

-- ─── The work itself, visible in the item ───────────────────────────────────
--
-- "with the work itself visible, not a description of it". For covers that means seeing the covers.
-- The alternative — a file path, or a link to a page published somewhere else — is precisely the
-- hands-off failure she objected to: she should not have to leave the screen to judge.
--
-- BYTES LIVE IN R2, NOT IN D1. A 1600x2560 JPEG is a few hundred kilobytes and D1 rows are not
-- where that belongs; `r2_key` points at the object and the Worker streams it back through the same
-- session cookie the screen already holds.
--
-- `missing_reason` IS THE HONEST-DEGRADATION COLUMN. An asset row whose upload never completed
-- renders as a named absence — "this cover was not uploaded" — rather than an empty frame she has
-- to interpret. A blank space in an approval is a lie about what she is approving.
CREATE TABLE judgement_assets (
  id             TEXT PRIMARY KEY,
  judgement_id   TEXT NOT NULL REFERENCES judgement_calls(id) ON DELETE CASCADE,
  ord            INTEGER NOT NULL,
  label          TEXT NOT NULL,
  media_type     TEXT NOT NULL,
  r2_key         TEXT,
  bytes          INTEGER,
  missing_reason TEXT,
  created_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_judgement_asset_ord ON judgement_assets(judgement_id, ord);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('judgement_calls', 'approvals', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'A question put to the owner, what happens when she answers it, and what she answered. Operating machinery: it holds no personal content and nothing about a counterparty.'),
  ('judgement_assets', 'approvals', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'Pointers to the work she is being shown — for the first instance, finished book covers she owns and is about to publish publicly. External processing asks first because an asset row is a general-purpose carrier and the next thing put through it may not be public.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0208_boss_her_verdict_resumes_the_work');
