-- BRAINS RESTRUCTURE (owner, 1 Nov 2026, approved in chat). Additive: one new skeleton row and
-- retitles. No row and no revision is deleted.
--
--   brokerage           -> "Spry Ventures (spry.vc) — the brokerage" (priority 1)
--   west-peek-ventures  -> "West Peek Ventures — the fund" (the fund ONLY)
--   west-peek           NEW: "West Peek — the community" (Rooms, TLC, westpeek.live, the join site)
--   time-2-read         -> "Time-2-Read — a Spry Labs company"
--   spry                -> "Spry Labs — the umbrella for every side business"
--   industry-guides     RETIRED into spry (RETIRED_BRAINS in brain.mjs): its row and revisions stay
--                       as history; GET/PUT on the slug resolve to spry; nothing lists it.
--
-- The repo is public: the new row is the bare skeleton (validate:brains checks it is exactly
-- seedFor(slug, title)). Real content is written in Boss OS after deploy, never here.
INSERT OR IGNORE INTO brains (slug, title, body_md, updated_at, updated_by) VALUES
  ('west-peek', 'West Peek — the community', '# West Peek — the community

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
', CAST(unixepoch() AS INTEGER) * 1000, 'seed');
UPDATE brains SET title = 'Spry Ventures (spry.vc) — the brokerage' WHERE slug = 'brokerage';
UPDATE brains SET title = 'West Peek Ventures — the fund' WHERE slug = 'west-peek-ventures';
UPDATE brains SET title = 'Time-2-Read — a Spry Labs company' WHERE slug = 'time-2-read';
UPDATE brains SET title = 'Spry Labs — the umbrella for every side business' WHERE slug = 'spry';
UPDATE brains SET title = 'Industry Guides (retired 1 Nov 2026: now in Spry Labs)' WHERE slug = 'industry-guides';
