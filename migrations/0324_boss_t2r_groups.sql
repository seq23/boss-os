-- TIME-2-READ GROUPS & INSTITUTIONS (owner, 31 Oct 2026: "Monique should do inst sales and i want to
-- find like home school pods and institutions too"). Additive only: two new tables, three tier rows,
-- one duty. The repo is public: no prospect, contact or code is seeded here. Rows are written at
-- runtime by the Mac job (scripts/ops/t2r-groups.mjs) through /api/boss/t2r-groups, from public pages.
--
--   t2r_group_tiers   the tiers, as data. Tier 3 (schools, districts) is OFF until this row flips:
--                     Phase 8 (teacher dashboard, rosters, privacy agreements, reading-gain proof).
--   t2r_groups        one row per group found: tier, kind, the page its address was published on,
--                     NeverBounce's verdict, its own trial code, and that code's use.
-- Sending is the existing outreach engine (business key time2read_groups, st@time-2-read.com).

CREATE TABLE IF NOT EXISTS t2r_group_tiers (
  tier        INTEGER PRIMARY KEY CHECK (tier BETWEEN 1 AND 3),
  label       TEXT NOT NULL,
  kinds       TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  why_off     TEXT,
  updated_at  INTEGER NOT NULL
);

INSERT OR IGNORE INTO t2r_group_tiers (tier, label, kinds, enabled, why_off, updated_at) VALUES
  (1, 'Homeschool pods, co-ops and microschools', '["homeschool pod","homeschool co-op","microschool"]', 1, NULL, unixepoch()*1000),
  (2, 'Libraries, after-school programs, literacy nonprofits and tutoring centers', '["public library youth services","after-school program","literacy nonprofit","tutoring center"]', 1, NULL, unixepoch()*1000),
  (3, 'Schools and districts', '["school","school district"]', 0,
   'Off until Phase 8: a teacher dashboard, class rosters, student-privacy agreements and proof of reading gains. Flip this row when they exist.', unixepoch()*1000);

CREATE TABLE IF NOT EXISTS t2r_groups (
  id              TEXT PRIMARY KEY,
  tier            INTEGER NOT NULL REFERENCES t2r_group_tiers(tier),
  kind            TEXT NOT NULL,
  org_name        TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email_domain    TEXT NOT NULL,
  region          TEXT,
  -- The public page the address was published on. Never her network, never a guessed address.
  source_url      TEXT NOT NULL,
  -- found → verified → coded → queued (in outreach_prospects) | skipped
  state           TEXT NOT NULL DEFAULT 'found' CHECK (state IN ('found','verified','coded','queued','skipped')),
  skip_reason     TEXT,
  nb_verdict      TEXT,
  nb_checked_at   INTEGER,
  code            TEXT UNIQUE,
  code_state      TEXT NOT NULL DEFAULT 'none' CHECK (code_state IN ('none','live','failed')),
  code_detail     TEXT,
  checkouts_started INTEGER,
  signups         INTEGER,
  usage_read_at   INTEGER,
  prospect_id     TEXT,
  found_at        INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_t2r_groups_state ON t2r_groups (state);
CREATE INDEX IF NOT EXISTS idx_t2r_groups_prospect ON t2r_groups (prospect_id);

INSERT OR IGNORE INTO standing_duties
  (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
   next_due_at, executor, task_kind, task_title, task_input, success_criteria, suspended) VALUES
  ('duty_t2r_groups', 'Time-2-Read groups & institutions', 'emp_relationship', 'ops',
   8, 15, 'America/Chicago', 'daily', NULL, unixepoch()*1000 + 86400000,
   'local_job', 'ops', 'Find homeschool groups, libraries and programs, check each address, make each its own 15-day trial code',
   json_object('local_job', 't2r-groups.mjs',
     'research_seats', 'Codex subscription first, then Claude subscription; never a paid API.',
     'runs', 'Weekdays at 08:15 America/Chicago, before the sending window opens at 09:00',
     'why_local', 'The NeverBounce and time-2-read code keys are in her vault on the Mac.',
     'sends', 'The hourly outreach tick sends from st@time-2-read.com (business time2read_groups).'),
   'Public pages only, each group keeps the page its address was on; NeverBounce valid before the first email; each group its own 15-day code; at most 10 new groups a weekday and one follow-up; no price, no call ask; tier 3 off until Phase 8; price questions go to her with a suggested price.', 0);

-- Weekdays only: groups are written to in working days, like every other outreach.
UPDATE standing_duties SET weekdays = json_array(1, 2, 3, 4, 5) WHERE id = 'duty_t2r_groups' AND weekdays IS NULL;

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('t2r_group_tiers', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Which kinds of group Time-2-Read writes to, and why tier 3 is off.'),
  ('t2r_groups', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Groups and institutions read from public pages: their published address, its source page, the NeverBounce verdict and their trial code. Never her network.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0324_boss_t2r_groups');
