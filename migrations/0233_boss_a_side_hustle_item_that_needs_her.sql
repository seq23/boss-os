-- Work on a side hustle that genuinely cannot proceed without HER, declared rather than guessed at.
--
-- ─── Her instruction ────────────────────────────────────────────────────────
--
--   "should suggest something that requires a human touch from one of the side hustles when
--    appropriate n o more than 1 per day as appropriate"
--
-- ─── The two facts this adds, and why neither could be inferred ──────────────
--
-- `owned_deliverables` already records what is owned, who owns it, whether it is blocked and by
-- what. It records NEITHER of the two things her instruction turns on:
--
--   1. WHICH PROPERTY IT BELONGS TO. The table has `lane` (ops/trading), which is an authority
--      boundary, not a business line. Nothing said whether a row was the YouTube channel or the
--      brokerage.
--   2. WHETHER IT NEEDS HER PERSONALLY. `blocker` is free prose — "waiting on the cover files",
--      "Amazon support has not replied". Reading her out of that text would be matching by
--      RESEMBLANCE, which is the thing this repository refuses everywhere else: the Ahrefs fixer
--      matches repositories by REPO_IDENTITY.md and "never by resemblance", and the contacts sync
--      refuses a batch it cannot source. A guess about whether something needs her, put at the top
--      of her day, is a guess she has to check before she can trust it — and one wrong one teaches
--      her to skim the section.
--
-- So both are DECLARED. Someone filing the deliverable says which property and says, explicitly,
-- that this cannot move without her. Absent the declaration the answer is no, and the section is
-- silent — which is the correct behaviour on most days and is stated as such in her instruction
-- ("when appropriate" is permission to say nothing).
--
-- ─── needs_owner is a narrow claim and the code holds it narrow ─────────────
--
-- It means: this cannot proceed without HER JUDGEMENT, HER NAME, HER SIGNATURE OR HER VOICE. An
-- approval only she can give, a decision with no rule behind it, a message that has to come from
-- her personally. It does NOT mean "important", "stuck", or "somebody should look at it" — work an
-- employee or a script can do is work to DISPATCH, not work to put in front of her, and putting it
-- in front of her is how the contract becomes a list.
--
-- ─── project_key has no second list behind it ──────────────────────────────
--
-- The value is a key from `src/worker/boss/today/projects.ts`, which is already the repository's own
-- register of what she works on and is deliberately CODE rather than a table ("a row anyone can
-- insert is exactly how a fourth active project appears without a decision behind it").
-- `validate:one-human-touch` fails the build if any project_key here is not a key declared there, so
-- this column is a reference to that file and never a copy of it.

ALTER TABLE owned_deliverables ADD COLUMN project_key TEXT;
ALTER TABLE owned_deliverables ADD COLUMN needs_owner INTEGER NOT NULL DEFAULT 0;

-- WHY SHE NEEDS IT, IN HER LANGUAGE, AND WHY IT IS NOT OPTIONAL IN PRACTICE.
--
-- A row that says "this needs you" and does not say what only she can do is a puzzle, not a task —
-- the same rule `counterparty_crossmatches.why` states for itself. It is NULLable at the schema
-- level because ALTER TABLE cannot add a NOT NULL column without a default, and defaulting this to
-- a sentence would be inventing the reason. The CODE refuses to surface a row without one, which is
-- the enforcement that actually matters, and a test proves the refusal.
ALTER TABLE owned_deliverables ADD COLUMN needs_owner_why TEXT;

CREATE INDEX idx_deliverables_needs_owner
  ON owned_deliverables(needs_owner, state, project_key);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0233_boss_a_side_hustle_item_that_needs_her');
