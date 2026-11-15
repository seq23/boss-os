-- 0367 · A BIG EMAIL IS READ WHOLE, AND A STOPPED READ IS NEVER SILENT (15 Nov 2026, the West Peek OS 0308 rule).
--
-- attempt: which delivery of one message this row is (1 = the first). A run stopped before it finished leaves its
-- row at RECEIVED; Email Routing delivers the message again and the next row is attempt 2. After two stopped reads
-- the third delivery is not read inline again (NAMED STOP [MAIL_READ_KILLED], src/worker/boss/intake/inboundMail.ts).
-- DEFAULT 1, so every existing row stays what it was.
--
-- reply_text: the reply as built, kept while it is `due`. A run stopped after the work was filed but before the
-- reply went used to make the redelivery a silent DUPLICATE; the redelivery now sends this text.
--
-- Additive: two new columns. Nothing is rewritten.
ALTER TABLE boss_inbound_mail ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE boss_inbound_mail ADD COLUMN reply_text TEXT;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0367_boss_a_killed_read_lets_the_redelivery_in');
