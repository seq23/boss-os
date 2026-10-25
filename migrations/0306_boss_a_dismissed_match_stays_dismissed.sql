-- ─── A DISMISSED MATCH STAYS DISMISSED (owner, 25 Oct 2026) ───
--
-- She could not dismiss a match or a Monique-found item anywhere. Now every match carries a short
-- code and a one-tap link, minted when her Mac pushes the matches; the card in Boss OS, the tap and
-- a reply "dismiss <code>" all write one row here, and the Matches screen, Today and the morning
-- email all read this one table. A dismissed pair comes back only on a NEW order from either side:
-- `sig` is both orders (id and price), so a new size or price is a new order and a new match.
CREATE TABLE IF NOT EXISTS capital_match_taps (
  code        TEXT PRIMARY KEY,                  -- five letters she can type in a reply
  token       TEXT NOT NULL UNIQUE,              -- the one-tap link's authority (144-bit random)
  pair        TEXT NOT NULL,                     -- company | buyer party | seller party
  sig         TEXT NOT NULL,                     -- buyer order:price | seller order:price
  company     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (pair, sig)
);

CREATE TABLE IF NOT EXISTS capital_dismissed (
  pair          TEXT NOT NULL,
  sig           TEXT NOT NULL,
  company       TEXT NOT NULL,
  code          TEXT,
  via           TEXT NOT NULL CHECK (via IN ('screen', 'tap', 'reply', 'owner_session')),
  dismissed_at  INTEGER NOT NULL,
  PRIMARY KEY (pair, sig)
);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('capital_match_taps', 'capital', 'CLOUD_SYNC', 'LOCAL_ONLY', 'The short code and one-tap link for each buy-sell match on her screens. Never sent to a model.'),
  ('capital_dismissed', 'capital', 'CLOUD_SYNC', 'LOCAL_ONLY', 'The matches she dismissed, so they never come back until either side posts a new order. Never sent to a model.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0306_boss_a_dismissed_match_stays_dismissed');
