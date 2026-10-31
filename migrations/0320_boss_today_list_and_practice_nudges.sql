-- The new Today (owner approved the mock-up, 31 Oct 2026) and the tough-love consistency emails
-- (owner, 31 Oct 2026: "when i go on long streaks of not opening the boss os app and not doing
-- coaching and not hitting my gates u should email me"). Additive only: five new tables, no
-- existing row or column is touched.

-- Her own gates. One row per gate she has saved "as my default"; no row means Boss OS's default
-- checklist (src/worker/boss/today/list.ts, GATE_DEFAULTS). `items` is the ordered JSON list of
-- item keys and her own added lines.
CREATE TABLE IF NOT EXISTS gate_templates (
  gate        TEXT PRIMARY KEY CHECK (gate IN ('morning','midday','night')),
  items       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- "Just for today" edits, and the gates she creates herself. A row in `gate_days` overrides the
-- template for that one day only.
CREATE TABLE IF NOT EXISTS gate_days (
  day_id      TEXT NOT NULL,
  gate        TEXT NOT NULL,                 -- morning | midday | night | custom:<id>
  items       TEXT NOT NULL,
  name        TEXT,                          -- custom gates only
  at_minute   INTEGER,                       -- custom gates only: minutes after midnight, Central
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (day_id, gate)
);

-- One tick per list item per day: a gate step, a Wealth sub-item, "Read it aloud ✓". Rows never
-- move on the screen; a tick only stamps the time.
CREATE TABLE IF NOT EXISTS today_ticks (
  day_id      TEXT NOT NULL,
  item_key    TEXT NOT NULL,
  done_at     INTEGER NOT NULL,
  PRIMARY KEY (day_id, item_key)
);

-- THAT she engaged, never WHAT she said. Kinds: app_open, coach_morning, coach_evening. Coaching is
-- LOCAL_ONLY (0177): this table records only that a talk happened, so it holds no words at all.
CREATE TABLE IF NOT EXISTS practice_engagement (
  day_id      TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('app_open','coach_morning','coach_evening')),
  first_at    INTEGER NOT NULL,
  last_at     INTEGER NOT NULL,
  PRIMARY KEY (day_id, kind)
);

-- Every practice email claimed for a Central day: the lapse ladder, the midday push, and the
-- ancestral hour's last-day 6pm warning. The PRIMARY KEY is (day, kind), so none can go twice.
CREATE TABLE IF NOT EXISTS practice_nudges (
  day         TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('lapse','midday','ancestral_urgent')),
  tier        TEXT,                          -- lapse only: firm | tough | hard
  streak_days INTEGER,                       -- lapse only
  claimed_at  INTEGER NOT NULL,
  sent_at     INTEGER,
  PRIMARY KEY (day, kind)
);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('gate_templates', 'today', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Her saved gate checklists. Her own practice; no model reads it.'),
  ('gate_days', 'today', 'LOCAL_ONLY', 'LOCAL_ONLY', 'A gate edited for one day, or one she created. Her own practice; no model reads it.'),
  ('today_ticks', 'today', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Which list items she ticked, and when. Times only.'),
  ('practice_engagement', 'today', 'LOCAL_ONLY', 'LOCAL_ONLY', 'That she opened the app or talked to the coach on a day. Never what was said: coaching is LOCAL_ONLY.'),
  ('practice_nudges', 'today', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Which days a practice email was claimed and sent, so none goes twice.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0320_boss_today_list_and_practice_nudges');
