-- 23 October 2026 — the email fix (owner-approved mock-up), Builder E.
--
-- 1. THE BOUNCE AGENT (rule 4). One row per bounced outreach address: the search for a working
--    replacement at the same organisation (someone there who wrote to us, or an address on its own
--    website; never a guessed pattern), checked by MX and recorded with its source; plus one row per
--    business per day when a bounce pause lifted itself (the 14-day bounce rate back under 3%).
--    src/worker/boss/outreach/bounceFix.ts; GET /api/boss/outreach/bounce-fixes feeds the one "done"
--    line in Simone's morning email.
CREATE TABLE IF NOT EXISTS outreach_bounce_fixes (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('replace','restart')),
  business_key      TEXT NOT NULL,
  prospect_id       TEXT,
  -- For 'restart' rows: "<business_key>:<YYYY-MM-DD>", so a business restarts once per day here.
  bounced_email     TEXT NOT NULL,
  bounced_domain    TEXT,
  state             TEXT NOT NULL CHECK (state IN ('pending','replaced','dropped','restarted')),
  replacement_email TEXT,
  source            TEXT,
  source_url        TEXT,
  detail            TEXT,
  created_at        INTEGER NOT NULL,
  done_at           INTEGER,
  UNIQUE (kind, bounced_email)
);
CREATE INDEX IF NOT EXISTS idx_outreach_bounce_fixes_state ON outreach_bounce_fixes (kind, state, created_at);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('outreach_bounce_fixes', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Bounced outreach addresses and the published or proven replacement found for each, with its source.')
ON CONFLICT(entity) DO NOTHING;

-- 2. SIMONE'S ONE MORNING EMAIL (rule 1). The duty now sends ONE email (no separate Monday email) and
--    waits for Camille's briefing (lands about 07:10 Central), sending the moment it lands and at
--    07:45 at the latest.
UPDATE standing_duties SET
  name = 'Your one morning email',
  task_title = 'Your morning: Decide, new deals, Camille''s briefing, Done for you, Valerie''s to-do',
  task_input = json_set(task_input, '$.sends',
    'one email to her from simone@ every morning, sent once Camille''s briefing lands (from 06:40, 07:45 at the latest); her reply becomes a task for Simone carrying the email it answers'),
  success_criteria = 'One email a day, in the order Decide (three at most, one-tap buttons), New deals since yesterday and Monique found, Camille''s briefing in five lines, Done for you (three lines), Catch up with, Porch & Party: To do for Valerie, then the 8Raise line. Every line comes from data or a section file; a source that did not load is one plain line and a fix job.'
WHERE id = 'duty_your_day';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0292_boss_outreach_bounce_fixes');
