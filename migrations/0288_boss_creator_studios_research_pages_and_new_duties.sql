-- 22 October 2026 — owner-approved, one batch:
--
--   1. Danielle works in seq23/creator-studios on a bare name (REGISTERED_REPOS in
--      src/shared/boss/repoChange/lane.mjs); the same row the R24 door would write is seeded here.
--   2. Camille's research pages: `research_pages` (one row per question, filed by
--      deliverResearchPage) and `delivered_work` (the ONE list of everything delivered — research
--      pages on delivery, mock-ups, playbooks and other pages filed by Zora on Fridays).
--   3. Three standing duties for the two seats that held the least work, each a local job on her Mac
--      wrapped in duty-run.sh (so every run reaches its row), each with a script behind it:
--        duty_archive_audit  Zora  Fri 08:40  archive-audit.mjs
--        duty_risk_watch     Toni  daily 08:20  risk-watch.mjs
--        duty_outside_locks  Toni  Mon 08:40  outside-locks.mjs
--
-- TONI'S TRADING LANE IS UNTOUCHED. Her employee row stays in the `trading` lane, isolated by design;
-- both her new duties are in the `ops` lane like `duty_credentials` (0241), and both are `local_job`
-- duties, which the materialiser never admits as tasks — so nothing here creates a trading-lane task,
-- touches `trading_authority`, the kill switch or `rt_trading_default`, or gives her execution
-- authority. They read balances and mail health; they never spend (R32) and never trade.

INSERT OR IGNORE INTO boss_repo_registry (name, github_repo, mail_id, registered_at)
  VALUES ('creator-studios', 'seq23/creator-studios', NULL, unixepoch() * 1000);

CREATE TABLE IF NOT EXISTS research_pages (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL,
  question       TEXT NOT NULL,
  state          TEXT NOT NULL DEFAULT 'queued',   -- queued | delivered | failed
  title          TEXT,
  summary        TEXT,
  markdown       TEXT,
  sources        TEXT,                              -- JSON [{title,url}]
  gaps           TEXT,                              -- JSON [string]
  status         TEXT,                              -- complete | partial
  run_id         TEXT,
  failure_reason TEXT,
  requested_at   INTEGER NOT NULL,
  delivered_at   INTEGER,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_pages_task ON research_pages (task_id);

CREATE TABLE IF NOT EXISTS delivered_work (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,                       -- research_page | mockup | playbook | page | report | plan
  title        TEXT NOT NULL,
  location     TEXT NOT NULL UNIQUE,                -- an https link; one row per piece
  owner_seat   TEXT,
  delivered_at INTEGER,
  filed_at     INTEGER NOT NULL,
  filed_by     TEXT NOT NULL
);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('research_pages', 'research', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'A research page Camille wrote from public sources at her request; the question is hers and the page is meant to be read.'),
  ('delivered_work', 'research', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Titles and links of pieces the team delivered. No bodies, no customer or LP names (the filing route refuses an @).')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_archive_audit',
   'Nothing goes stale quietly, and everything delivered can be found',
   'emp_knowledge', 'ops',
   8, 40, 'America/Chicago', 'weekly', 5,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'Archive audit: the living documents checked against the code, and every delivered piece filed',
   json_object(
     'local_job', 'archive-audit.mjs',
     'why_local', 'The Outbound Email Map and Side Business Review copies, ~/HANDOFF.md and the artifact gallery are on her Mac (the gallery and the Open Loops page through her Claude session); the Worker cannot read any of them.',
     'checks', json_array('docs/OUTBOUND_EMAIL_MAP.md', 'docs/SIDE_BUSINESS_REVIEW.md', '~/HANDOFF.md', 'Open Loops page'),
     'stale_after_days', 14,
     'requested', json_object('model', 'claude-haiku-4-5-20251001', 'max_seconds', 600),
     'sends', 'one email to her from zora@ only when something is stale or newly filed; filings POST /api/boss/research/delivered'
   ),
   'Every living document is compared with the code or live data it describes; anything 14+ days stale is fixed when the fix is mechanical, otherwise named with its owner seat. Every delivered piece is on the one list. A source that cannot be read is a NAMED STOP line, never a silent pass.',
   0),
  ('duty_risk_watch',
   'Money and mail, watched daily, quiet unless something moves',
   'emp_risk', 'ops',
   8, 20, 'America/Chicago', 'daily', NULL,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'Risk watch: OpenRouter balance and spend, bills, domain renewals, sender health',
   json_object(
     'local_job', 'risk-watch.mjs',
     'why_model', 'Balances, renewal dates, bounce rates and DNS records are read with no model. The one model call is a short Haiku run on her Claude seat that searches her personal Gmail for charge notices through the connector (headers only), because that mailbox has no other door.',
     'requested', json_object('model', 'claude-haiku-4-5-20251001', 'max_seconds', 600),
     'why_local', 'The OpenRouter and Cloudflare keys and the Google service account live in the vault on her Mac.',
     'thresholds', json_object('openrouter_balance_floor_usd', 0, 'renewal_warn_days', 30, 'complaints', 0, 'bounce_rate', 0.03, 'unsubscribe_rate', 0.02),
     'sends', 'one email to her from toni@ only when a reading changes state; a sender over threshold is paused through PUT /api/boss/outreach/business/:key first'
   ),
   'OpenRouter never below $0 and any new spend said the day it appears; every domain renewal inside 30 days named; every sender over a complaint, bounce or unsubscribe threshold paused and named; DKIM for every sender domain checked. A source it cannot read is named once as a stop, never read as fine.',
   0),
  ('duty_outside_locks',
   'Locks someone else put on her accounts, checked weekly',
   'emp_risk', 'ops',
   8, 40, 'America/Chicago', 'weekly', 1,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'Outside locks: LinkedIn restrictions, KDP reviews, account suspensions',
   json_object(
     'local_job', 'outside-locks.mjs',
     'why_local', 'The notices land in her own mailboxes: the spry.vc mailbox through the service account, her personal Gmail only through her Claude session on the Mac.',
     'requested', json_object('model', 'claude-haiku-4-5-20251001', 'max_seconds', 600),
     'sends', 'one email to her from toni@ only when a lock appears or clears'
   ),
   'Every restriction, review hold or suspension notice from LinkedIn, Amazon KDP, Google, YouTube, Pinterest, Etsy or Meta in the last 8 days is named with its date and what it locks; a mailbox it cannot read is named as a stop.',
   0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0288_boss_creator_studios_research_pages_and_new_duties');
