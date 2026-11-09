-- 0360 — Partner campaigns from her email (owner, 8 Nov 2026: "if i emailed this to boss@ i need them
-- to take this and do it end 2 end").
--
-- 1. outreach_campaigns: one row per campaign a business runs at ONE company, built from her email
--    (or from the research of the next organisation on the list). The people, their titles, her notes
--    and the held/skipped addresses live in `spec` (private D1, never the repo). `page_token` opens the
--    one-pager at /api/boss/outreach/p/<token>. `notice` is the email Monique owes her on her thread.
-- 2. outreach_partner_orgs: the organisations a business targets next, in order, no contacts yet.
--    When the active campaign ends (any reply, or 14 days after the last email), the next one is
--    researched (public pages, NeverBounce) and its campaign built by the same builder.
-- 3. outreach_prospects gains the partner columns: first name, title, angle, campaign, page token.
--
-- Additive only: two new tables, their data_policy rows, five new nullable columns.

CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id            TEXT PRIMARY KEY,
  business_key  TEXT NOT NULL,
  org_name      TEXT NOT NULL,
  org_domain    TEXT,
  mail_id       TEXT,
  source        TEXT NOT NULL CHECK (source IN ('owner_email','research')),
  state         TEXT NOT NULL CHECK (state IN ('verifying','live','ended')),
  spec          TEXT NOT NULL DEFAULT '{}',
  page_token    TEXT NOT NULL UNIQUE,
  notice        TEXT,
  notice_state  TEXT NOT NULL DEFAULT 'none' CHECK (notice_state IN ('none','due','sent')),
  ended_reason  TEXT,
  ended_at      INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outreach_campaigns_state ON outreach_campaigns (business_key, state);

CREATE TABLE IF NOT EXISTS outreach_partner_orgs (
  id            TEXT PRIMARY KEY,
  business_key  TEXT NOT NULL,
  org_name      TEXT NOT NULL,
  position      INTEGER NOT NULL,
  state         TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','researching','active','done','skipped')),
  campaign_id   TEXT,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (business_key, org_name)
);

ALTER TABLE outreach_prospects ADD COLUMN contact_first TEXT;
ALTER TABLE outreach_prospects ADD COLUMN contact_title TEXT;
ALTER TABLE outreach_prospects ADD COLUMN angle TEXT;
ALTER TABLE outreach_prospects ADD COLUMN campaign_id TEXT;
ALTER TABLE outreach_prospects ADD COLUMN page_token TEXT;
CREATE INDEX IF NOT EXISTS outreach_prospects_campaign ON outreach_prospects (campaign_id);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('outreach_campaigns', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL', 'Partner campaigns from her email or public research: named people at one company, their titles, her notes, NeverBounce verdicts. Not sent to a model by this lane.'),
  ('outreach_partner_orgs', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'The organisations a business targets next, in order: company names only, no people.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0360_boss_partner_campaigns');
