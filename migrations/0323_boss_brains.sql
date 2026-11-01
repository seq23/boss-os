-- BRAINS (owner, 31 Oct 2026: "time to work"). Additive only: two new tables, eight skeleton rows.
--
-- One markdown document per business, the single source of truth every employee reads first
-- (src/shared/boss/brains/brain.mjs holds the definition). The repo is public, so the seeds are the
-- SKELETON only: every section present, every gap written [MISSING]. Real content is written in
-- Boss OS (the Brains screen, or her email) and lives only in D1 and her private local copy.
-- Nine brains: seven businesses (the brokerage first; West Peek Ventures holds the fund, TLC & Rooms
-- and westpeek.live), "personal" (Boss OS itself, Spirit, gates, coaching, her schedule) and "team"
-- (who's who across her AI teams), a plain document seeded with one placeholder line.
--
--   brains            one row per business; body_md is the whole document
--   brain_revisions   every change, the whole document as it became, who and how ("by email")

CREATE TABLE IF NOT EXISTS brains (
  slug        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body_md     TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS brain_revisions (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL REFERENCES brains(slug),
  body_md     TEXT NOT NULL,
  changed_at  INTEGER NOT NULL,
  changed_by  TEXT NOT NULL,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_brain_revisions_slug ON brain_revisions (slug, changed_at DESC);

INSERT OR IGNORE INTO brains (slug, title, body_md, updated_at, updated_by) VALUES
  ('brokerage', 'Brokerage (secondaries)', '# Brokerage (secondaries)

## Company
[MISSING]

## Numbers
| Metric | Definition | Source | Value | Last updated |
|---|---|---|---|---|
| [MISSING] | | | [MISSING] | |

## Priorities
[MISSING]

## People
[MISSING]

## Voice
[MISSING]

## Settled decisions
[MISSING]

## Open questions
[MISSING]

## Who does what
[MISSING]
', CAST(unixepoch() AS INTEGER) * 1000, 'seed'),
  ('west-peek-ventures', 'West Peek Ventures (fund, TLC & Rooms, westpeek.live)', '# West Peek Ventures (fund, TLC & Rooms, westpeek.live)

## Company
[MISSING]

## Numbers
| Metric | Definition | Source | Value | Last updated |
|---|---|---|---|---|
| [MISSING] | | | [MISSING] | |

## Priorities
[MISSING]

## People
[MISSING]

## Voice
[MISSING]

## Settled decisions
[MISSING]

## Open questions
[MISSING]

## Who does what
[MISSING]
', CAST(unixepoch() AS INTEGER) * 1000, 'seed'),
  ('porch-and-party', 'Porch & Party 901', '# Porch & Party 901

## Company
[MISSING]

## Numbers
| Metric | Definition | Source | Value | Last updated |
|---|---|---|---|---|
| [MISSING] | | | [MISSING] | |

## Priorities
[MISSING]

## People
[MISSING]

## Voice
[MISSING]

## Settled decisions
[MISSING]

## Open questions
[MISSING]

## Who does what
[MISSING]
', CAST(unixepoch() AS INTEGER) * 1000, 'seed'),
  ('time-2-read', 'Time-2-Read', '# Time-2-Read

## Company
[MISSING]

## Numbers
| Metric | Definition | Source | Value | Last updated |
|---|---|---|---|---|
| [MISSING] | | | [MISSING] | |

## Priorities
[MISSING]

## People
[MISSING]

## Voice
[MISSING]

## Settled decisions
[MISSING]

## Open questions
[MISSING]

## Who does what
[MISSING]
', CAST(unixepoch() AS INTEGER) * 1000, 'seed'),
  ('industry-guides', 'Industry Guides', '# Industry Guides

## Company
[MISSING]

## Numbers
| Metric | Definition | Source | Value | Last updated |
|---|---|---|---|---|
| [MISSING] | | | [MISSING] | |

## Priorities
[MISSING]

## People
[MISSING]

## Voice
[MISSING]

## Settled decisions
[MISSING]

## Open questions
[MISSING]

## Who does what
[MISSING]
', CAST(unixepoch() AS INTEGER) * 1000, 'seed'),
  ('spry', 'Spry', '# Spry

## Company
[MISSING]

## Numbers
| Metric | Definition | Source | Value | Last updated |
|---|---|---|---|---|
| [MISSING] | | | [MISSING] | |

## Priorities
[MISSING]

## People
[MISSING]

## Voice
[MISSING]

## Settled decisions
[MISSING]

## Open questions
[MISSING]

## Who does what
[MISSING]
', CAST(unixepoch() AS INTEGER) * 1000, 'seed'),
  ('friends', 'Friends'' businesses', '# Friends'' businesses

## Company
[MISSING]

## Numbers
| Metric | Definition | Source | Value | Last updated |
|---|---|---|---|---|
| [MISSING] | | | [MISSING] | |

## Priorities
[MISSING]

## People
[MISSING]

## Voice
[MISSING]

## Settled decisions
[MISSING]

## Open questions
[MISSING]

## Who does what
[MISSING]
', CAST(unixepoch() AS INTEGER) * 1000, 'seed'),
  ('personal', 'Personal', '# Personal

## Company
[MISSING]

## Numbers
| Metric | Definition | Source | Value | Last updated |
|---|---|---|---|---|
| [MISSING] | | | [MISSING] | |

## Priorities
[MISSING]

## People
[MISSING]

## Voice
[MISSING]

## Settled decisions
[MISSING]

## Open questions
[MISSING]

## Who does what
[MISSING]
', CAST(unixepoch() AS INTEGER) * 1000, 'seed'),
  ('team', 'Who''s who — your AI teams', '# Who''s who — your AI teams

Write the roster here in Boss OS: each West Peek OS and Boss OS employee, what they own, and who to send what to.
', CAST(unixepoch() AS INTEGER) * 1000, 'seed');

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('brains', 'brains', 'CLOUD_SYNC', 'EXTERNAL_OK', 'One document per business that every employee reads first. Private spans (LP names, fund and deal terms, investor names) are cut out before any route but her Claude seat sees it.'),
  ('brain_revisions', 'brains', 'CLOUD_SYNC', 'LOCAL_ONLY', 'Every past version of a brain, for the history on its screen. Never sent to a model.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0323_boss_brains');
