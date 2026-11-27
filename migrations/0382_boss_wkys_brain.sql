-- THE WKYS BRAIN (owner, 27 Nov 2026: "do what u need to do to mask things or encrypt things"). Additive:
-- one new eight-section brain for We Keep You Spry, her private AI enablement business. Its commercial
-- plan, backlog and security notes move here out of the public seq23/WKYS repo. The repo is public: the
-- row is the bare seed (validate:brains checks it is exactly seedFor(slug, title)); the content is
-- written in Boss OS after deploy, never here.
INSERT OR IGNORE INTO brains (slug, title, body_md, updated_at, updated_by) VALUES
  ('wkys', 'We Keep You Spry (WKYS)', '# We Keep You Spry (WKYS)

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

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0382_boss_wkys_brain');
