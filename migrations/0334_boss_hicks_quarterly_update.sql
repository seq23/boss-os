-- 0334 — The Hicks quarterly website update (owner, 3 Nov 2026: "one of my boss OS people should send
-- me a draft email for approval to send to monika quarterly"). Camille owns it; code in
-- src/worker/boss/clients/hicksUpdate.ts and src/shared/boss/clients/hicksUpdate.mjs.
--
-- Additive only. No name or address of the client is stored here: the recipient is runtime config
-- (setting `hicks_update_recipient`), because the repo is public.
--
-- client_update_drafts: one row per quarter (UNIQUE client+quarter is the claim). status drafting →
--   pending (waiting for her) → approved (handed to her Gmail, ready to send) or skipped. The newest
--   approved row's clicks_now is "the figure in the last email"; its fix_keys are what was already told.
-- client_update_carryover: lines placed FIRST in the fixes section of the next draft, marked used
--   when she approves that draft.
-- client_update_subjects: every subject ever sent to the client, so a subject is never reused.

CREATE TABLE IF NOT EXISTS client_update_drafts (
  id               TEXT PRIMARY KEY,
  client           TEXT NOT NULL,
  quarter          TEXT NOT NULL,
  status           TEXT NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1,
  subject          TEXT,
  body             TEXT,
  verdict          TEXT,
  clicks_now       INTEGER,
  clicks_prev      INTEGER,
  clicks_last_sent INTEGER,
  data_json        TEXT,
  fix_keys         TEXT,
  carry_ids        TEXT,
  tap_token        TEXT,
  claimed_at       INTEGER,
  created_at       INTEGER NOT NULL,
  emailed_at       INTEGER,
  decided_at       INTEGER,
  sent_at          INTEGER,
  UNIQUE (client, quarter)
);
CREATE INDEX IF NOT EXISTS idx_client_update_drafts_token ON client_update_drafts (tap_token);

CREATE TABLE IF NOT EXISTS client_update_carryover (
  id         TEXT PRIMARY KEY,
  client     TEXT NOT NULL,
  line       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  used_at    INTEGER,
  used_in    TEXT
);

CREATE TABLE IF NOT EXISTS client_update_subjects (
  client  TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (client, subject)
);

-- The email she sent on 3 Nov 2026 (12:55 UTC): 34 Google visits in the last four weeks; it told the
-- byline, question-heading, placeholder and AI-visits fixes. The next draft compares against it.
INSERT OR IGNORE INTO client_update_drafts
  (id, client, quarter, status, version, subject, verdict, clicks_now, clicks_prev, clicks_last_sent, fix_keys, carry_ids, created_at, decided_at, sent_at)
VALUES
  ('cud_hicks_20261103', 'hicks', '2026-11-sent-by-hand', 'approved', 1,
   'Good news on hicksconsulting.org: more people are visiting from Google', 'win', 34, 23, 25,
   '["author","question-headings","placeholder","ai-visits"]', '[]', 1793710557000, 1793710557000, 1793710557000);

INSERT OR IGNORE INTO client_update_carryover (id, client, line, position, created_at)
VALUES ('cuc_hicks_ai_memphis', 'hicks',
        'We''re finding low-competition ways for you to stand out when people in Memphis ask ChatGPT and other AI tools for a therapist.',
        0, 1793710557000);

INSERT OR IGNORE INTO client_update_subjects (client, subject, sent_at) VALUES
  ('hicks', 'Q3 update on Hicks consulting website', 1790000000000),
  ('hicks', 'Your website update: more people are finding Hicks Consulting on Google', 1791740911000),
  ('hicks', 'Good news on hicksconsulting.org: more people are visiting from Google', 1793710557000),
  ('hicks', 'A new way we''re tracking how people find you', 1793710600000);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0334_boss_hicks_quarterly_update');
