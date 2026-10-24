-- 24 October 2026 — the mailbox each prospect email really went from, shown on the Prospects screen.
--
-- The owner remembered the 11 October prospect send going from her Spry address. Read off the stored
-- messages' own From headers on 24 Oct 2026: all 36 first-touch threads were sent from
-- sequoia@westpeek.ventures (none exist in the Spry mailbox). The owner ruled that correct. From now
-- on the Mac records each touch's From header (`sentWordsTo` → POST /lp/prospects/touches), and a
-- fresh read replaces this backfill.
ALTER TABLE prospect_touches ADD COLUMN sent_from TEXT;
UPDATE prospect_touches SET sent_from = 'sequoia@westpeek.ventures' WHERE sent_from IS NULL;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0300_boss_prospect_sent_from');
