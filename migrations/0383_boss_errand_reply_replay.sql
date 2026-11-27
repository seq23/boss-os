ALTER TABLE boss_inbound_mail ADD COLUMN errand_reply TEXT;
CREATE INDEX IF NOT EXISTS boss_errand_reply_pending ON boss_inbound_mail(received_at, id)
  WHERE errand_reply IS NOT NULL;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0383_boss_errand_reply_replay');
