-- 0280 — MONIQUE RUNS OUTREACH FOR THE SIDE BUSINESSES, FULLY AUTOMATICALLY (9 Oct 2026).
--
-- The owner, 9 Oct 2026: "u do it all". No template review and no weekly batch. Safety comes from
-- brakes in code, never from a person reading each email:
--   · a per-domain daily cap that starts at 10 and ramps slowly (outreach/brakes.ts);
--   · an automatic pause on a bounce rate over 3% or ANY complaint, shown on Monique's card;
--   · a global kill switch, and a sending flag that starts at 'test_only';
--   · a suppression list every send checks, fed at once by unsubscribes;
--   · an unsubscribe link and the business's postal address in every email (CAN-SPAM). A business
--     with no postal address cannot send to anyone outside the test list.
--
-- The businesses themselves are NOT rows here. `src/worker/boss/outreach/catalog.ts` is the one
-- list; these tables hold only state keyed by its `key`, so the catalog and the database can never
-- disagree about which businesses exist.

-- Global switches. 'kill_switch' = 'on' stops every send on the next tick. 'sending' is the feature
-- flag: 'off' | 'test_only' (only the test recipients) | 'live'.
CREATE TABLE IF NOT EXISTS outreach_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system'
);
INSERT OR IGNORE INTO outreach_settings (key, value, updated_at) VALUES ('kill_switch', 'off', 0);
INSERT OR IGNORE INTO outreach_settings (key, value, updated_at) VALUES ('sending', 'test_only', 0);

-- Per business (catalog key): the route, the pause, the ramp, the footer address.
CREATE TABLE IF NOT EXISTS outreach_domain_state (
  business_key    TEXT PRIMARY KEY,
  -- 'ready' once the sending address is proven to send; 'awaiting_route' until then.
  route_state     TEXT NOT NULL DEFAULT 'awaiting_route' CHECK (route_state IN ('ready','awaiting_route')),
  route_proven_at INTEGER,
  route_detail    TEXT,
  -- CAN-SPAM: the physical postal address printed in every email. NULL = cannot send outside.
  postal_address  TEXT,
  paused_at       INTEGER,
  pause_reason    TEXT,
  ramp_started_at INTEGER,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outreach_prospects (
  id             TEXT PRIMARY KEY,
  business_key   TEXT NOT NULL,
  email          TEXT NOT NULL,
  email_domain   TEXT NOT NULL,
  org_name       TEXT,
  segment        TEXT NOT NULL,
  metro          TEXT,
  website        TEXT,
  -- Where the address was read, publicly. Never her network, never client data.
  source         TEXT NOT NULL,
  source_url     TEXT NOT NULL,
  mx_verified_at INTEGER NOT NULL,
  -- new → in_sequence → done | replied | suppressed | bounced
  state          TEXT NOT NULL DEFAULT 'new'
                   CHECK (state IN ('new','in_sequence','done','replied','suppressed','bounced')),
  step           INTEGER NOT NULL DEFAULT 0,
  next_due_at    INTEGER,
  thread_id      TEXT,
  last_message_id TEXT,
  last_subject   TEXT,
  unsub_token    TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (business_key, email)
);
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_due ON outreach_prospects (business_key, state, next_due_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_prospects_unsub ON outreach_prospects (unsub_token);
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_thread ON outreach_prospects (thread_id);

-- List building, in small slices per tick. A slice is one (business, segment, metro) public-listing
-- read; a candidate is one business website from it, crawled later for a business address.
CREATE TABLE IF NOT EXISTS outreach_slices (
  business_key TEXT NOT NULL,
  segment      TEXT NOT NULL,
  metro        TEXT NOT NULL,
  fetched_at   INTEGER NOT NULL,
  found        INTEGER NOT NULL,
  detail       TEXT,
  PRIMARY KEY (business_key, segment, metro)
);

CREATE TABLE IF NOT EXISTS outreach_candidates (
  id           TEXT PRIMARY KEY,
  business_key TEXT NOT NULL,
  segment      TEXT NOT NULL,
  metro        TEXT NOT NULL,
  org_name     TEXT,
  website      TEXT NOT NULL,
  listed_email TEXT,
  source_url   TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'pending'
                 CHECK (state IN ('pending','ok','no_email','unqualified','failed')),
  detail       TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (business_key, website)
);
CREATE INDEX IF NOT EXISTS idx_outreach_candidates_pending ON outreach_candidates (state, created_at);

-- Do-not-contact. `value` is an address or, with kind 'domain', a whole domain.
CREATE TABLE IF NOT EXISTS outreach_suppression (
  value      TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('email','domain')),
  reason     TEXT NOT NULL,
  source     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outreach_sends (
  id               TEXT PRIMARY KEY,
  business_key     TEXT NOT NULL,
  prospect_id      TEXT,
  to_email         TEXT NOT NULL,
  step             INTEGER NOT NULL,
  is_test          INTEGER NOT NULL DEFAULT 0,
  gmail_message_id TEXT,
  gmail_thread_id  TEXT,
  status           TEXT NOT NULL CHECK (status IN ('sent','failed','bounced','complaint')),
  detail           TEXT,
  sent_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outreach_sends_business ON outreach_sends (business_key, sent_at);

CREATE TABLE IF NOT EXISTS outreach_replies (
  id               TEXT PRIMARY KEY,
  gmail_message_id TEXT NOT NULL UNIQUE,
  business_key     TEXT,
  prospect_id      TEXT,
  from_email       TEXT NOT NULL,
  classification   TEXT NOT NULL
                     CHECK (classification IN ('interested','not_now','unsubscribe','wrong_person','complaint','auto_reply','bounce')),
  excerpt          TEXT,
  approval_id      TEXT,
  received_at      INTEGER NOT NULL
);

-- Affiliate partners (30% of the referred customer's first-year revenue) and direct-sale leads.
CREATE TABLE IF NOT EXISTS referral_partners (
  id           TEXT PRIMARY KEY,
  business_key TEXT NOT NULL,
  prospect_id  TEXT,
  email        TEXT NOT NULL,
  name         TEXT,
  code         TEXT NOT NULL UNIQUE,
  share_bps    INTEGER NOT NULL DEFAULT 3000,
  created_at   INTEGER NOT NULL,
  UNIQUE (business_key, email)
);

-- A sale a product checkout recorded against a code (Stripe `metadata[ref]`).
CREATE TABLE IF NOT EXISTS referral_conversions (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL,
  business_key  TEXT NOT NULL,
  order_ref     TEXT NOT NULL UNIQUE,
  customer_ref  TEXT,
  amount_cents  INTEGER NOT NULL,
  occurred_at   INTEGER NOT NULL,
  recorded_at   INTEGER NOT NULL
);

-- The monthly ledger. Nothing here is ever paid automatically; 'computed' is as far as code goes.
CREATE TABLE IF NOT EXISTS referral_payouts (
  id           TEXT PRIMARY KEY,
  partner_id   TEXT NOT NULL,
  period       TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  conversions  INTEGER NOT NULL,
  state        TEXT NOT NULL DEFAULT 'computed' CHECK (state IN ('computed','surfaced','paid')),
  created_at   INTEGER NOT NULL,
  UNIQUE (partner_id, period)
);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('outreach_settings', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Two switches: the kill switch and the sending flag.'),
  ('outreach_domain_state', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Per-business sending state: route, pause, ramp, the business postal address.'),
  ('outreach_prospects', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Business addresses read from public listings and practice websites. Never her network, never client data.'),
  ('outreach_slices', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Which public listing was read for which business and metro, and how many businesses it named.'),
  ('outreach_candidates', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Business websites from public listings, waiting to be read for a business address.'),
  ('outreach_suppression', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Do-not-contact addresses and domains.'),
  ('outreach_sends', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Which outreach email went to which business address, and what Gmail said.'),
  ('outreach_replies', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'How a reply to outreach was classified, with a short excerpt.'),
  ('referral_partners', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Affiliate partners and their referral codes.'),
  ('referral_conversions', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Sales a product checkout attributed to a referral code.'),
  ('referral_payouts', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'The monthly payout ledger. Never paid automatically.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0280_boss_monique_runs_outreach');
