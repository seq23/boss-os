# Brains

One markdown document per business — the single source of truth every Boss OS employee reads first.
Owner, 31 Oct 2026. The rules are in code (`src/shared/boss/brains/brain.mjs`) and pinned by the tests
named in CLAUDE.md "Brains"; this page says how to use and operate it.

## The nine brains

| Slug | Title | Shape |
|---|---|---|
| `brokerage` | Brokerage (secondaries) | eight sections |
| `west-peek-ventures` | West Peek Ventures (fund, TLC & Rooms, westpeek.live) | eight sections |
| `porch-and-party` | Porch & Party 901 | eight sections |
| `time-2-read` | Time-2-Read | eight sections |
| `industry-guides` | Industry Guides | eight sections |
| `spry` | Spry | eight sections |
| `friends` | Friends' businesses | eight sections |
| `personal` | Personal (Boss OS itself, Spirit, gates, coaching, her schedule) | eight sections, not on the scoreboard |
| `team` | Who's who — your AI teams | one plain document, not on the scoreboard |

The scoreboard lists the brokerage first, then West Peek Ventures, then the rest.

Sections, in order: Company, Numbers, Priorities, People, Voice, Settled decisions, Open questions,
Who does what. Gaps are `[MISSING]` (one line = one gap). Numbers is a table
`| Metric | Definition | Source | Value | Last updated |`. Settled decisions read
`- YYYY-MM-DD — decision — why`. Private spans: `<!-- confidential -->…<!-- /confidential -->`.

## Who reads what

`EMPLOYEE_BRAINS` in brain.mjs. Camille → Porch & Party. Monique → the brokerage and West Peek Ventures. Simone → every business and Personal, summarised. Danielle and Zora →
every business, summarised. Kendra, Toni, Imani → none. Everyone → the who's-who excerpt from `team`.
(Wynn is a West Peek OS employee, not on the Boss OS roster; TLC & Rooms work lives in the West Peek Ventures brain, read by Monique and Simone.)

Private spans reach `bk_claude_code` only. They are cut, fail closed, in `routeCompletion` (every cloud
route), `dispatchRunForTask` (any other seat's run row) and `/backends/claim` (a run handed down).

## Editing

- **Screen:** ☰ More → Brains → a card → "Edit this section" or "Fill this in". Each save is a revision.
- **Email to Simone**, from her own addresses: `P&P brain: add settled decision X because Y`,
  `time-2-read priorities: 1 … 2 …`, `spry brain: set Sales to 3`, `spry voice: …` (replaces the section).
  The reply confirms; the revision is noted "by email". The team doc is edited on its screen only.

## Scoreboard and the weekly check

- `GET /api/boss/brains/scoreboard`: one row per metric; "not tracked yet" when the Value is `[MISSING]`.
  On the 1st, Simone's morning email carries one grid (business × first three metrics) linking to
  `/?tab=brains&view=scoreboard`.
- Mondays, on the hourly tick (`runDuties` → `runBrainsCohesion`), the check is kept in `settings`
  (`brains_cohesion`); the Monday email shows its one line ("Brains: all fresh" or what is stale and how
  many gaps). Never red.

## Local copy

`BOSS_PASSCODE=… npm run brains:pull` writes `~/Brains/<slug>.md`, each headed
`Source: Boss OS · pulled <timestamp> · edit in Boss OS, not here`, private spans kept. `--out <dir>` and
`BOSS_ORIGIN` override. Exits non-zero with a named stop when nothing was written. The launchd job is
installed by the coordinator, outside this repo; the passcode is injected by the caller.
