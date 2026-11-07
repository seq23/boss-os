-- THE ONE LAYOUT FOR EMAILS TO HER (owner, 7 Nov 2026, personal brain: one required minimum on every
-- email; layouts A approve · D delivered · B digest · C alarm · Note, never a gate; "a weekly count
-- of Notes shows when a new layout is needed").
--
-- boss_sent_mail.layout: the layout each email went out in (X-Boss-Layout), read by the Updates
-- page's one "plain notes this week" line. boss_mail_refs.ref_code: the BOS-XXXXXX code her
-- subject showed, so a reply that lost its thread still reaches its job. Additive only: two nullable
-- columns and two indexes; no live record changes.
ALTER TABLE boss_sent_mail ADD COLUMN layout TEXT;
CREATE INDEX IF NOT EXISTS idx_boss_sent_mail_layout ON boss_sent_mail (layout, sent_at);
ALTER TABLE boss_mail_refs ADD COLUMN ref_code TEXT;
CREATE INDEX IF NOT EXISTS idx_boss_mail_refs_code ON boss_mail_refs (ref_code);
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0355_boss_owner_email_layout');
