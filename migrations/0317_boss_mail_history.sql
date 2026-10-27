-- Mail bodies live in the private R2 vault, never in public source or fixtures.
ALTER TABLE boss_inbound_mail ADD COLUMN thread_id TEXT;
ALTER TABLE boss_inbound_mail ADD COLUMN in_reply_to TEXT;
ALTER TABLE boss_inbound_mail ADD COLUMN command_id TEXT;
CREATE INDEX boss_inbound_mail_thread ON boss_inbound_mail(thread_id, received_at);
CREATE INDEX boss_inbound_mail_command ON boss_inbound_mail(command_id, received_at);
CREATE TABLE boss_sent_mail (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  sent_at INTEGER NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'sent' CHECK (delivery_state IN ('pending','sent','failed')),
  from_addr TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  employee_id TEXT,
  subject TEXT NOT NULL,
  object_key TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  in_reply_to TEXT,
  command_id TEXT REFERENCES boss_commands(id)
);
CREATE INDEX boss_sent_mail_thread ON boss_sent_mail(thread_id, sent_at);
CREATE INDEX boss_sent_mail_employee ON boss_sent_mail(employee_id, sent_at);
CREATE INDEX boss_sent_mail_command ON boss_sent_mail(command_id, sent_at);
CREATE TABLE boss_mail_senders (
  address TEXT PRIMARY KEY,
  admitted_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0317_boss_mail_history');

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason, set_at) VALUES
  ('boss_sent_mail', 'intake', 'CLOUD_SYNC', 'LOCAL_ONLY', 'Exact private sent mail, shown only to the owner.', unixepoch()*1000),
  ('boss_mail_senders', 'intake', 'CLOUD_SYNC', 'LOCAL_ONLY', 'Owner-admitted senders may be read, never execute work.', unixepoch()*1000);
