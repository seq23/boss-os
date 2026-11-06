-- 0350 — every producing job names its output and a floor (owner, 5 Nov 2026: stop "green but did nothing").
--
-- Why: P&P corporate outreach ran green 2-5 Nov and sent 0 ("LIVE: 0 sent, 0 planned"); Wynn's
-- owner emails failed 236 times 2-6 Nov (Resend HTTP 401) and nobody was told; a task read
-- "running" for hours on a spent seat. Nothing watched results, only whether jobs ran.
--
-- 1. standing_duties gets output_metric (plain words), output_floor (per run), output_runs (low runs
--    in a row before Kendra's alarm, default 2), output_reason (why a check-only job's floor is 0)
--    and output_since (runs before this moment are never judged: they could not print the line).
-- 2. duty_runs gets output_count, read from the job's `OUTPUT <n> <metric>` line by duty-run.sh.
--    NULL = no line = unknown, which counts as below the floor.
-- 3. system_alarms: Kendra's (emp_continuity, Systems) alarms, one open row per alarm_key, closed
--    when the condition clears. `hers` = only the owner can fix it, the one case shown on Today.
-- 4. The floors below are the conservative first values (6 Nov 2026), mirrored by each duty's row
--    in src/shared/boss/schedule/manifest.json (`output`); tests/outputFloors.test.ts pins the two.
-- 5. duty_owner_mail_watch: the Mac reads every app's failed owner-bound email (Kendra).
--
-- Additive only: added columns, one new table, INSERT OR IGNORE, and UPDATEs of the new
-- columns alone.

ALTER TABLE standing_duties ADD COLUMN output_metric TEXT;
ALTER TABLE standing_duties ADD COLUMN output_floor INTEGER;
ALTER TABLE standing_duties ADD COLUMN output_runs INTEGER NOT NULL DEFAULT 2;
ALTER TABLE standing_duties ADD COLUMN output_reason TEXT;
ALTER TABLE standing_duties ADD COLUMN output_since INTEGER;

ALTER TABLE duty_runs ADD COLUMN output_count INTEGER;
ALTER TABLE duty_runs ADD COLUMN output_metric TEXT;

CREATE TABLE IF NOT EXISTS system_alarms (
  id            TEXT PRIMARY KEY,
  -- One open alarm per key: "output:<duty>", "task:<task>", "mail:<app>#<subject kind>".
  alarm_key     TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL CHECK (kind IN ('output_floor','stale_task','owner_mail')),
  owner         TEXT NOT NULL DEFAULT 'emp_continuity',
  subject_id    TEXT,
  text          TEXT NOT NULL,
  -- 1 when only the owner can fix it (a key only she holds): the one case shown on her Today.
  hers          INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  first_at      INTEGER NOT NULL,
  last_at       INTEGER NOT NULL,
  seen          INTEGER NOT NULL DEFAULT 1,
  -- The one repair task Kendra was given when it opened.
  task_id       TEXT,
  closed_at     INTEGER,
  closed_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_system_alarms_open ON system_alarms(status, last_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('system_alarms', 'duties', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Kendra''s alarms about the machinery: a job name, a count, an app, an email subject kind and an error class. Never a body or an address.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_owner_mail_watch',
   'Emails to you that fail, in every app, said out loud',
   'emp_continuity', 'ops',
   7, 50, 'America/Chicago', 'daily', NULL,
   unixepoch() * 1000 + 86400000, 'local_job', 'ops',
   'Emails to you that fail, in every app, said out loud',
   json_object(
     'local_job', 'owner-mail-watch.mjs',
     'why_local', 'Reads West Peek OS''s database through wrangler with the keys on her Mac, which the Boss OS Worker does not hold.',
     'sends', 'no email: it raises Kendra''s alarms through POST /api/boss/alarms'
   ),
   'Twice a day (07:50 and 15:50 Central) it reads every app''s failed owner-bound email events (West Peek OS deliverable.email_not_sent, Boss OS notices and sent mail; p-n-p records none) and raises one Kendra alarm per series that failed twice in a row, naming the app, the subject kind and the error class, never a body. An app it could not read is named, never counted as clean.',
   0);

UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'An audit: a week with nothing stale is the good outcome.', output_since = unixepoch() * 1000 WHERE id = 'duty_archive_audit';
UPDATE standing_duties SET output_metric = 'emails sent', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_buyer_hunt';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Suggests a catch-up only when there is a live reason; most days have none.', output_since = unixepoch() * 1000 WHERE id = 'duty_catchups';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'A check: a dead login is already named on Today with its steps.', output_since = unixepoch() * 1000 WHERE id = 'duty_credentials';
UPDATE standing_duties SET output_metric = 'grid rows', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_deal_grid';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Reads the month''s 8Raise credits; the reading is the whole job.', output_since = unixepoch() * 1000 WHERE id = 'duty_eightraise_budget';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Sends only when a booking is 28 hours away.', output_since = unixepoch() * 1000 WHERE id = 'duty_errand_reminders';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'No holder clearing the bar is a real answer the email already states.', output_since = unixepoch() * 1000 WHERE id = 'duty_filing_research';
UPDATE standing_duties SET output_metric = 'health readings filed', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_grid_watch';
UPDATE standing_duties SET output_metric = 'interests read', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_inbound_supply';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = '"Nobody worth a note this month" is a real answer the email states.', output_since = unixepoch() * 1000 WHERE id = 'duty_interest_nudge';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Publishes only approved covers; stopped on her word since 14 Sep 2026.', output_since = unixepoch() * 1000 WHERE id = 'duty_kdp_publish';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Reads Amazon''s mail; a quiet month is normal.', output_since = unixepoch() * 1000 WHERE id = 'duty_kdp_surface';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Routes only on the days her mail names a side.', output_since = unixepoch() * 1000 WHERE id = 'duty_ledger_hunt';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Holds a reply only when an LP writes.', output_since = unixepoch() * 1000 WHERE id = 'duty_lp_daily';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Housekeeping: freeing nothing on a clean disk is fine.', output_since = unixepoch() * 1000 WHERE id = 'duty_mac_cleanup';
UPDATE standing_duties SET output_metric = 'threads read', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_mailbox_sweep';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Preps only when a call is due.', output_since = unixepoch() * 1000 WHERE id = 'duty_meeting_prep';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'A check: quiet unless someone else locked an account.', output_since = unixepoch() * 1000 WHERE id = 'duty_outside_locks';
UPDATE standing_duties SET output_metric = 'people recommended', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_people_worth_a_call';
UPDATE standing_duties SET output_metric = 'emails sent', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_pnp_corporate_outreach';
UPDATE standing_duties SET output_metric = 'listings checked', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_pnp_marketplace';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'A watch: quiet unless a filing moves.', output_since = unixepoch() * 1000 WHERE id = 'duty_preseed_watch';
UPDATE standing_duties SET output_metric = 'firm leads found', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_prospect_discovery';
UPDATE standing_duties SET output_metric = 'emails sent', output_floor = 1, output_runs = 3, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_prospects';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'A watch: quiet unless money or mail moves.', output_since = unixepoch() * 1000 WHERE id = 'duty_risk_watch';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Appends only the tracker rows that are new; a quiet week appends none.', output_since = unixepoch() * 1000 WHERE id = 'duty_scooter_sheet';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Fixes only the gaps Monday''s audit found; none is the goal.', output_since = unixepoch() * 1000 WHERE id = 'duty_search_readiness_repair';
UPDATE standing_duties SET output_metric = 'emails sent', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_seller_hunt';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Fixes only what the audit flagged; none is the goal.', output_since = unixepoch() * 1000 WHERE id = 'duty_site_audit_repair';
UPDATE standing_duties SET output_metric = 'groups researched', output_floor = 1, output_runs = 3, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_t2r_groups';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'A check: acts only on what is overdue.', output_since = unixepoch() * 1000 WHERE id = 'duty_waiting_on';
UPDATE standing_duties SET output_metric = 'emails sent', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_your_day';
UPDATE standing_duties SET output_metric = NULL, output_floor = 0, output_runs = 2, output_reason = 'Reads comments; acts only on her word.', output_since = unixepoch() * 1000 WHERE id = 'duty_youtube_comment_watch';
UPDATE standing_duties SET output_metric = 'reports delivered', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_brokerage_sourcing';
UPDATE standing_duties SET output_metric = 'reports delivered', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_exec_intel';
UPDATE standing_duties SET output_metric = 'reports delivered', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_link_prospects';
UPDATE standing_duties SET output_metric = 'reports delivered', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_practice_week';
UPDATE standing_duties SET output_metric = 'reports delivered', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_tool_scout';
UPDATE standing_duties SET output_metric = 'readings written', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_property_gsc';
UPDATE standing_duties SET output_metric = 'readings written', output_floor = 1, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_property_uptime';
UPDATE standing_duties SET output_metric = 'apps read', output_floor = 2, output_runs = 2, output_reason = NULL, output_since = unixepoch() * 1000 WHERE id = 'duty_owner_mail_watch';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0350_boss_output_floors');
