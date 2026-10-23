-- 23 October 2026 — the deal grid, her two lists, and the holders Monique found (Boss fix D,
-- contract rules 5–9 and 15; owner-approved with mock-up board 5).
--
-- capital_deal_rows: every buy and sell in her inbox from the last ~6 months as one row — company,
--   side (buy / sell / yours), size, price or valuation, structure and fees, who it came from, when,
--   and the Gmail link. Written by `npm run capital:grid` on her Mac; read by the Deals page. She
--   decided on 23 Oct 2026 that the full grid lives on the Deals page, so these rows cross to D1; the
--   interest ledger they are built from stays on her Mac. `parties` holds the lowercased names and
--   addresses on the row so her do-not-suggest list is honoured at read time too.
-- capital_party_lists: the Rainmaker (same-firm) list and the do-not-suggest list. Entries are
--   runtime data — seeded from a file outside the repo and edited by her plain-words replies — and
--   never written into this public repository.
-- capital_holders: the N-PORT holders (and Form D vehicles) Danielle's filings read named, per
--   company, for the "Holders Monique found" tab.

CREATE TABLE IF NOT EXISTS capital_deal_rows (
  id              TEXT PRIMARY KEY,
  company         TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('buy','sell','yours')),
  direction       TEXT NOT NULL CHECK (direction IN ('buy','sell')),
  size_usd        REAL,
  size_text       TEXT NOT NULL DEFAULT '—',
  price_text      TEXT NOT NULL DEFAULT '—',
  structure_text  TEXT NOT NULL DEFAULT '—',
  from_text       TEXT NOT NULL DEFAULT '—',
  rainmaker       INTEGER NOT NULL DEFAULT 0 CHECK (rainmaker IN (0,1)),
  received_on     TEXT NOT NULL,
  email_url       TEXT,
  parties         TEXT NOT NULL DEFAULT '',
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_capital_deal_rows_received ON capital_deal_rows (received_on DESC);
CREATE INDEX IF NOT EXISTS idx_capital_deal_rows_company ON capital_deal_rows (company);

CREATE TABLE IF NOT EXISTS capital_party_lists (
  id          TEXT PRIMARY KEY,
  list        TEXT NOT NULL CHECK (list IN ('same_firm','do_not_suggest')),
  kind        TEXT NOT NULL CHECK (kind IN ('email','domain','name')),
  value       TEXT NOT NULL,
  label       TEXT,
  source      TEXT NOT NULL CHECK (source IN ('seed','reply','screen')),
  created_at  INTEGER NOT NULL,
  removed_at  INTEGER,
  UNIQUE (list, kind, value)
);

-- The two names Builder L reads them by (catch-ups, prospects, drafts): active entries only, a
-- `value` column each. Views over the one table, so there is one list and never two to keep in step.
CREATE VIEW IF NOT EXISTS same_firm_list AS
  SELECT id, kind, value, label, created_at FROM capital_party_lists WHERE list = 'same_firm' AND removed_at IS NULL;
CREATE VIEW IF NOT EXISTS do_not_suggest AS
  SELECT id, kind, value, label, created_at FROM capital_party_lists WHERE list = 'do_not_suggest' AND removed_at IS NULL;

CREATE TABLE IF NOT EXISTS capital_holders (
  id           TEXT PRIMARY KEY,
  company      TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('nport','form_d')),
  fund         TEXT NOT NULL,
  manager      TEXT,
  value_usd    REAL,
  as_of        TEXT,
  filing_url   TEXT NOT NULL,
  contact      TEXT,
  found_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_capital_holders_company ON capital_holders (company, value_usd DESC);

-- Named counterparties and her private lists: never in a cloud snapshot, never to an outside model.
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('capital_deal_rows', 'capital', 'LOCAL_ONLY', 'LOCAL_ONLY', 'The deal grid names brokers and counterparties at a FINRA-registered broker-dealer. She decided on 23 Oct 2026 that it shows on the Deals page; it never leaves for a cloud snapshot or an outside model.'),
  ('capital_party_lists', 'capital', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Her Rainmaker list and the people she has ruled out. Names she gave in confidence; never in the repo, a snapshot or a model.'),
  ('capital_holders', 'capital', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Fund holders from public filings, kept beside her deals; LOCAL_ONLY because which holder she is looking at for which deal is hers.')
ON CONFLICT(entity) DO NOTHING;

-- No more standalone deal email from Monique (owner, 23 Oct 2026, rule 1). The daily chain now runs
-- at 05:30 Central so its sections are ready for Simone's 06:40 morning email; the hunt follows it
-- in the same launchd job. What each duty "sends" is said plainly.
UPDATE standing_duties SET local_hour = 5, local_minute = 30,
  task_input = json_set(task_input, '$.sends', 'no email: the New deals and Monique found sections of Simone''s 06:40 morning email, and the Deals page grid')
  WHERE id = 'duty_inbound_supply';
UPDATE standing_duties SET local_hour = 5, local_minute = 45,
  task_input = json_set(task_input, '$.sends', 'no email: what it finds is kept for the Monique found section of the morning email and the Holders tab')
  WHERE id = 'duty_ledger_hunt';
UPDATE standing_duties
  SET task_input = json_set(task_input, '$.sends', 'no email: what it finds is kept for the Monique found section of the morning email and the Holders tab')
  WHERE id IN ('duty_buyer_hunt', 'duty_filing_research');
UPDATE standing_duties
  SET task_input = json_set(task_input, '$.sends', 'no email: the monthly note stopped on 23 Oct 2026; catch-up suggestions come from the morning email''s Catch up with section')
  WHERE id = 'duty_interest_nudge';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0293_boss_deal_grid_and_her_lists');
