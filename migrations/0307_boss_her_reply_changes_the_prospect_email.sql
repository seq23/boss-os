-- ─── HER REPLY CHANGES THE PROSPECT EMAIL (owner, 25 Oct 2026) ───
--
-- She answers the prospect-email card from her morning email ("5: drop the follow-up line", "5: try
-- again", "5: approved"). Her words are kept on the template as change notes; a redraft is a new
-- row (variant, parent) that retires the old one; "try again" moves to a structurally different
-- variant. General rules she states become standing template rules, enforced in code
-- (src/shared/boss/lp/plan.mjs PROSPECT_TEMPLATE_RULES / featuredNamesProblems) and recorded here.
ALTER TABLE prospect_templates ADD COLUMN variant INTEGER NOT NULL DEFAULT 0;
ALTER TABLE prospect_templates ADD COLUMN change_notes TEXT;
ALTER TABLE prospect_templates ADD COLUMN parent_id TEXT;

CREATE TABLE IF NOT EXISTS prospect_template_rules (
  key         TEXT PRIMARY KEY,
  rule        TEXT NOT NULL,
  said        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
INSERT OR IGNORE INTO prospect_template_rules (key, rule, said, created_at) VALUES
  ('names_are_examples', 'Featured names read as examples of a wider book ("including …, among others"), never as the full list; the subject does not list them as everything.', 'I don''t like that you make it seem like those are the only 3 companies I''m working on.', 1792958400000),
  ('no_fake_reply_subject', 'A cold subject never starts with Re: or Fwd:.', 'Drop the "Re:" prefix: a fake reply on a cold email.', 1792958400000);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('prospect_template_rules', 'lp', 'CLOUD_SYNC', 'LOCAL_ONLY', 'Her standing rules for every prospect email, in her words. Never sent to a model.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0307_boss_her_reply_changes_the_prospect_email');
