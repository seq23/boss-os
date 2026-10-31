-- Today v4 (owner approved the mock-up, 31 Oct 2026). Additive only: three new tables, no existing
-- row or column is touched.
--
--   decide_dismissed     "Still waiting on you" carries every unanswered Decide item across mornings
--                        until it is answered or dismissed. This is the dismissal. (today/waiting.ts)
--   side_business_days   the one side business Boss OS picks for the day's Wealth block, and why. The
--                        day is the PRIMARY KEY, so a reload can never pick a second one. (today/sideBusiness.ts)
--   food_orders          every keto order shown on the 15:00 food row, so none repeats inside 60 days.
--                        (today/food.ts)

CREATE TABLE IF NOT EXISTS decide_dismissed (
  item_id       TEXT PRIMARY KEY,               -- the morning item id (decide-…), stable across mornings
  dismissed_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS side_business_days (
  day           TEXT PRIMARY KEY,               -- Central YYYY-MM-DD
  business_key  TEXT NOT NULL,                  -- a key in today/sideBusiness.ts SIDE_BUSINESSES
  line          TEXT NOT NULL,                  -- what to do, one line
  why           TEXT NOT NULL,                  -- the one-line "Why"
  signal        TEXT NOT NULL CHECK (signal IN ('leads','broken','revenue','untouched','none')),
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS food_orders (
  day           TEXT NOT NULL,                  -- Central YYYY-MM-DD
  place_key     TEXT NOT NULL,                  -- lower-case place (+ city for a local place)
  place         TEXT NOT NULL,
  city          TEXT,                           -- NULL for a national chain
  order_text    TEXT NOT NULL,                  -- what to order, swap and leave off
  net_carbs     INTEGER NOT NULL,
  why           TEXT,
  source        TEXT NOT NULL CHECK (source IN ('list','free_lane')),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (day, place_key)
);
CREATE INDEX IF NOT EXISTS idx_food_orders_place ON food_orders(place_key, day);

-- Local places a $0 lane wrote for a city, kept so the same city is not asked twice.
CREATE TABLE IF NOT EXISTS food_places (
  place_key     TEXT PRIMARY KEY,
  place         TEXT NOT NULL,
  city          TEXT NOT NULL,
  order_text    TEXT NOT NULL,
  net_carbs     INTEGER NOT NULL,
  why           TEXT,
  created_at    INTEGER NOT NULL
);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('decide_dismissed', 'today', 'LOCAL_ONLY', 'LOCAL_ONLY', 'Which morning items she dismissed, and when. Ids and times only.'),
  ('side_business_days', 'today', 'LOCAL_ONLY', 'LOCAL_ONLY', 'The side business picked for each day and why. Counts and business names only.'),
  ('food_orders', 'today', 'LOCAL_ONLY', 'LOCAL_ONLY', 'The restaurant order shown each day, so none repeats inside 60 days.'),
  ('food_places', 'today', 'CLOUD_SYNC', 'EXTERNAL_OK', 'Public restaurants and menu orders for a city. No personal data.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0321_boss_today_v4');
