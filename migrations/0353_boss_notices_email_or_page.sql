-- EMAIL ONLY WHEN SHE MUST ACT (owner, 7 Nov 2026: "either consolidate the emails or make those
-- notifications on some page inside boss os only").
--
-- `needs_her` is set where a notice is written (src/shared/boss/mail/noticeGate.mjs `needsHer`):
-- 1 = the drain on her Mac emails it (a decision, a reply, a key only she holds); 0 = it is a row on
-- the Updates page (☰ More → Updates) and one count line in the morning email, never an email.
-- `read_at` is her tick on that page. Additive only: two columns with safe defaults (every existing
-- row keeps today's behaviour, email); no live record changes.
ALTER TABLE boss_task_notices ADD COLUMN needs_her INTEGER NOT NULL DEFAULT 1;
ALTER TABLE boss_task_notices ADD COLUMN read_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_boss_task_notices_page ON boss_task_notices (needs_her, created_at);
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0353_boss_notices_email_or_page');
