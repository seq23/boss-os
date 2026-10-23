-- 23 October 2026 — Boss fix L: LP replies, prospects, the 8Raise budget, catch-ups (owner rulings
-- 10, 11, 12, 14 of the email + deals fix; mock-up boards 3 and 6 approved the same day).
--
-- NOTHING IN THIS FILE NAMES A PERSON. The repo is public. Every row below is filled at runtime on
-- her Mac (from her mailbox and from ~/8raise-tools, outside the repo) or by her one-tap decisions.
--
-- What it replaces:
--   · duty_lp_replies (lp-replies.sh) read "sequoia@westpeek.ventures" through the claude.ai Gmail
--     connector, which is bound to her PERSONAL mailbox. Its search A returned 0 every morning while
--     the delegated API saw 50+ inbound messages in the same seven days (read-only probe, 23 Oct).
--     The credential gate in front of it was not stale; the lane behind it was blind. Retired.
--   · duty_lp_positive (Tuesday 08:15 reminder email, lp-positive.mjs --email --followups). Her
--     ruling 10: "the weekly Tuesday reminder email goes away". Retired.
-- Both become duty_lp_daily: every morning, read the mailbox through the delegation, hold one draft
-- per positive LP reply in the LP's own thread, and put Send as is / Edit, then send / Skip in the
-- morning email.

DELETE FROM standing_duties WHERE id IN ('duty_lp_replies', 'duty_lp_positive');

-- One held reply per LP who answered warmly. `status` is the tracker word she sees.
CREATE TABLE IF NOT EXISTS lp_reply_drafts (
  id              TEXT PRIMARY KEY,
  address         TEXT NOT NULL UNIQUE,          -- the LP's address (lower case)
  name            TEXT,                          -- display name from their mail; private (router lexicon)
  firm            TEXT,                          -- their domain's organisation, when known; private
  bucket          TEXT NOT NULL CHECK (bucket IN ('call', 'warm')),
  quote           TEXT,                          -- one sentence of what they said
  reply_from      TEXT NOT NULL,                 -- the address the LP wrote TO; the reply goes from it
  thread_id       TEXT,                          -- Gmail thread the reply joins
  in_reply_to     TEXT,                          -- their Message-ID
  subject         TEXT,
  draft_id        TEXT,                          -- Gmail draft id in that mailbox
  draft_message_id TEXT,
  body_hash       TEXT,
  status          TEXT NOT NULL DEFAULT 'drafted'
                  CHECK (status IN ('drafted', 'sent', 'scheduled', 'skipped', 'not_answered', 'replied_again')),
  tap_token       TEXT UNIQUE,                   -- 144 random bits; the one-tap links carry it
  decision        TEXT CHECK (decision IN ('send', 'edit', 'skip')),
  decided_at      INTEGER,
  send_error      TEXT,
  first_seen      TEXT NOT NULL,                 -- YYYY-MM-DD of their positive reply
  drafted_at      INTEGER,
  sent_at         INTEGER,
  last_reply_at   INTEGER,                       -- their latest message; > sent_at means "They replied again"
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lp_reply_drafts_status ON lp_reply_drafts(status, first_seen);

-- Buyer prospects (rule 11). The 11 Oct send is imported at runtime from ~/8raise-tools; new ones
-- come from $0 sources each week, each with its source recorded.
CREATE TABLE IF NOT EXISTS prospects (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  firm            TEXT,
  kind            TEXT NOT NULL DEFAULT 'other'
                  CHECK (kind IN ('family_office', 'sovereign_wealth', 'fund_of_funds', 'pension_endowment_foundation',
                                  'secondary_fund', 'crossover_growth', 'spv_manager', 'inbox_buyer', 'other')),
  source          TEXT NOT NULL,                 -- e.g. '8raise_2026_10_11', 'sec_form_d', 'sec_13f', 'iapd', 'firm_website', 'inbox'
  source_ref      TEXT,                          -- the filing / page / batch it came from
  status          TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'active', 'interested', 'replied', 'opted_out', 'bounced', 'done')),
  touches         INTEGER NOT NULL DEFAULT 0,    -- emails sent so far; 3 is the most there will ever be
  first_sent_at   INTEGER,
  last_touch_at   INTEGER,
  thread_id       TEXT,
  last_message_id TEXT,                          -- RFC Message-ID of our last touch, for In-Reply-To
  subject         TEXT,
  template_id     TEXT,
  side            TEXT NOT NULL DEFAULT 'unknown' CHECK (side IN ('buyer', 'seller', 'both', 'unknown')),
  reply_note      TEXT,                          -- one line of their reply (interested / not now / ooo)
  draft_tap_token TEXT UNIQUE,                   -- an interested reply's held draft (Send / Edit / Skip)
  draft_id        TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status, last_touch_at);
CREATE INDEX IF NOT EXISTS idx_prospects_created ON prospects(created_at);

CREATE TABLE IF NOT EXISTS prospect_touches (
  id           TEXT PRIMARY KEY,
  prospect_id  TEXT NOT NULL REFERENCES prospects(id),
  touch_no     INTEGER NOT NULL CHECK (touch_no BETWEEN 1 AND 3),
  gmail_id     TEXT,
  template_id  TEXT,
  sent_at      INTEGER NOT NULL,
  UNIQUE (prospect_id, touch_no)
);

-- The prospect email she approves before it ever goes out. A changed body or a changed name list is
-- a new row with a new hash, and a new row is 'pending' until she taps Approve.
CREATE TABLE IF NOT EXISTS prospect_templates (
  id           TEXT PRIMARY KEY,
  hash         TEXT NOT NULL UNIQUE,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,                    -- with {first} and {names} placeholders
  follow_up    TEXT NOT NULL,                    -- touches 2 and 3
  names_json   TEXT NOT NULL,                    -- the approved featured names, [{name, why}]
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'retired')),
  tap_token    TEXT UNIQUE,
  approved_at  INTEGER,
  created_at   INTEGER NOT NULL
);

-- Names she has ruled out of the prospect email for good ("never feature Z").
CREATE TABLE IF NOT EXISTS prospect_name_rules (
  name        TEXT PRIMARY KEY,                  -- lower case company name
  rule        TEXT NOT NULL CHECK (rule IN ('never', 'add', 'drop')),
  said        TEXT,                              -- her words
  created_at  INTEGER NOT NULL
);

-- Every 8Raise credit, logged (rule 12). Month = calendar month, America/Chicago.
CREATE TABLE IF NOT EXISTS eightraise_ledger (
  id            TEXT PRIMARY KEY,
  month         TEXT NOT NULL,                   -- YYYY-MM
  purpose       TEXT NOT NULL CHECK (purpose IN ('prospecting', 'buyers_for_supply', 'balance_read')),
  tool          TEXT NOT NULL,
  company       TEXT,                            -- the company searched for (one search per company per month)
  credits       REAL NOT NULL,
  balance_after REAL,
  at            INTEGER NOT NULL,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_eightraise_month ON eightraise_ledger(month, purpose);

-- Catch-ups (rule 14, revised): NOT a tracker and never shown to her. The suppression record only,
-- so nobody is suggested more than twice ever (unless they write to her again), never twice a week.
CREATE TABLE IF NOT EXISTS catchup_suggestions (
  id            TEXT PRIMARY KEY,
  person_key    TEXT NOT NULL,                   -- lower-case address
  reason_type   TEXT NOT NULL,
  suggested_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catchup_person ON catchup_suggestions(person_key, suggested_at);

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_lp_daily',
   'LP replies: a held reply for every warm LP, one tap to send',
   'emp_relationship', 'ops',
   6, 15, 'America/Chicago', 'daily', NULL,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'Read the West Peek mailbox, hold a reply in each warm LP''s thread, update the tracker',
   json_object(
     'local_job', 'lp-daily.mjs',
     'why_no_model', 'LP names never leave her Mac or Boss OS: the reply is a fixed template in her voice.',
     'why_local', 'The West Peek delegation key lives in the vault on her Mac.',
     'sends', 'nothing; it writes ~/.boss-os/morning/lp.json, which Simone''s morning email renders'
   ),
   'Every positive LP reply has a held draft in its own thread or a recorded status; sent and scheduled mail is checked first so no duplicate is drafted.',
   0),
  ('duty_prospects',
   'Prospects: the approved soft note and its two follow-ups, under the brakes',
   'emp_relationship', 'ops',
   9, 30, 'America/Chicago', 'daily', NULL,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'Send due prospect touches with the approved template; read replies; hold drafts for interested ones',
   json_object(
     'local_job', 'lp-prospects.mjs',
     'why_no_model', 'The approved template is filled with a first name and the approved names; nothing else.',
     'why_local', 'The West Peek delegation key lives in the vault on her Mac.',
     'sends', 'prospect emails from the West Peek mailbox only with an approved template, at most 20 new a day, 3 touches ever'
   ),
   'Only an approved template is sent; a bounce rate over 3% or any complaint stops sending; replies and opt-outs are never emailed again.',
   0),
  ('duty_prospect_discovery',
   'Prospects: new names each week from free sources',
   'emp_relationship', 'ops',
   7, 0, 'America/Chicago', 'weekly', 1,
   unixepoch() * 1000 + 604800000, 'local_job', 'ops',
   'Find new buyer prospects from free public sources, published addresses only',
   json_object(
     'local_job', 'lp-prospect-discovery.mjs',
     'why_no_model', 'Sources are structured public filings and published firm pages; addresses are taken as published.',
     'why_local', 'SEC fair-access limits and the 8Raise key are handled on her Mac.',
     'sends', 'nothing'
   ),
   'Every new prospect carries its source; no guessed address; 8Raise only within the month''s prospecting budget.',
   0),
  ('duty_catchups',
   'Catch up with: only when there is a live reason',
   'emp_relationship', 'ops',
   6, 20, 'America/Chicago', 'daily', NULL,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'Suggest 0 to 3 people to catch up with, each with a live reason and a drafted note',
   json_object(
     'local_job', 'lp-catchups.mjs',
     'why_no_model', 'The note is a fixed template; the reason is a row from her deals.',
     'why_local', 'Her mailbox is read on her Mac.',
     'sends', 'nothing; it writes ~/.boss-os/morning/catchups.json'
   ),
   'Nobody suggested more than twice ever unless they wrote again, never twice in a week, never Rainmaker, never on the do-not-suggest list.',
   0),
  ('duty_eightraise_budget',
   '8Raise: the month''s credits, read and logged',
   'emp_relationship', 'ops',
   6, 25, 'America/Chicago', 'daily', NULL,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'Read the 8Raise balance (free) and write the morning footer line',
   json_object(
     'local_job', 'lp-eightraise.mjs',
     'why_no_model', 'A balance read and arithmetic.',
     'why_local', 'The 8Raise key lives in the vault on her Mac.',
     'sends', 'nothing; it writes ~/.boss-os/morning/eightraise.json'
   ),
   'Never buys or upgrades; stops when the balance would fall below 30; every credit is in the ledger.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0294_boss_lps_and_prospects');
