-- ─── REPAIRS NEVER WAIT ON THE OWNER (owner, 25 Oct 2026) ───
--
-- A repo change Boss OS opened itself to repair something broken (a held email, a failed or refused
-- run, a red check, a self-repair, a rework) is built and landed with no "reply approved" step;
-- work she asked for keeps its approval email. `origin` is the one fact that tells them apart, and
-- `repair_kind` says which repair it is (src/shared/boss/repoChange/lane.mjs REPAIR_KINDS).
ALTER TABLE repo_changes ADD COLUMN origin TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE repo_changes ADD COLUMN repair_kind TEXT;

-- The repairs already open were made by the two repair openers (scripts/ops/notify.mjs holdMail and
-- scripts/ops/your-day.mjs fixJob) before the field existed; their instructions carry the openers'
-- exact titles and no mail of hers opened them.
UPDATE repo_changes SET origin = 'repair', repair_kind = 'held_mail'
 WHERE mail_id IS NULL AND instruction LIKE 'Fix a held email:%' AND phase NOT IN ('done', 'failed');
UPDATE repo_changes SET origin = 'repair', repair_kind = 'failed_task'
 WHERE mail_id IS NULL AND instruction LIKE 'Find why "%" failed%' AND phase NOT IN ('done', 'failed');

-- A PLAN EMAIL OVERTAKEN BY EVENTS IS SUPERSEDED, NOT LEFT WAITING (25 Oct 2026). Two plan emails
-- waited on her while the work they asked about was done another way; `superseded_at` and its reason
-- close the row (phase done), so neither Today nor the morning email counts it as a decision.
ALTER TABLE repo_changes ADD COLUMN superseded_at INTEGER;
ALTER TABLE repo_changes ADD COLUMN superseded_reason TEXT;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0308_boss_repairs_never_wait_on_the_owner');
