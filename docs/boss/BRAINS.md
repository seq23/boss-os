# Brains

One markdown document per business — the single source of truth every Boss OS employee reads first.
Owner, 31 Oct 2026. The rules are in code (`src/shared/boss/brains/brain.mjs`) and pinned by the tests
named in CLAUDE.md "Brains"; this page says how to use and operate it.

## The nine brains

| Slug | Title | Shape |
|---|---|---|
| `brokerage` | Spry Ventures (spry.vc) — the brokerage | eight sections |
| `west-peek-ventures` | West Peek Ventures — the fund | eight sections |
| `west-peek` | West Peek — the community | eight sections |
| `porch-and-party` | Porch & Party 901 | eight sections |
| `time-2-read` | Time-2-Read — a Spry Labs company | eight sections |
| `spry` | Spry Labs — the umbrella for every side business | eight sections |
| `friends` | Friends' businesses | eight sections |
| `personal` | Personal (Boss OS itself, Spirit, gates, coaching, her schedule) | eight sections, not on the scoreboard |
| `team` | Who's who — your AI teams | one plain document, not on the scoreboard |

The scoreboard lists the brokerage first, then the fund, then the community, then the rest.

**Restructure (owner, 1 Nov 2026; migration 0326).** The fund (`west-peek-ventures`) and the community
(`west-peek`) are separate: each links to the other and neither repeats the other's facts. Spry Labs
(`spry`) took in everything from the Industry Guides brain. **Retired slugs** (`RETIRED_BRAINS` in
brain.mjs): `industry-guides` → `spry`. The old row and its revisions stay in D1 as history (spry's
history shows them); `GET`/`PUT /api/boss/brains/industry-guides` answer as `spry`; the screen, the
scoreboard, the employees and the local copy never see it. `npm run brains:pull` moves the old local file
into `~/Brains/_retired/` (never deletes it).

Sections, in order: Company, Numbers, Priorities, People, Voice, Settled decisions, Open questions,
Who does what. Gaps are `[MISSING]` (one line = one gap). Numbers is a table
`| Metric | Definition | Source | Value | Last updated |`. Settled decisions read
`- YYYY-MM-DD — decision — why`. Private spans: `<!-- confidential -->…<!-- /confidential -->`.

## Who reads what

`EMPLOYEE_BRAINS` in brain.mjs. Camille → Porch & Party. Monique → the brokerage, the fund, the community, time-2-read and Spry Labs. Simone → every business and Personal, summarised. Danielle and Zora →
every business, summarised. Kendra, Toni, Imani → none. Everyone → the who's-who excerpt from `team`.
(Wynn and Parker are West Peek OS employees, not on the Boss OS roster; TLC & Rooms work lives in the community brain, `west-peek`, read by Monique and Simone.)

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
- Mondays, on the hourly tick (`runDuties` → `runBrainsCohesion`), the brains check is kept in `settings`
  (`brains_cohesion`, `brains_line`: "Brains: all fresh" or what is stale and how many gaps).
- The Mac's Monday cohesion check (`npm run brains:cohesion`, launchd `com.seq.boss-cohesion`, Monday
  06:05 Central) checks memory strays (moved to `~/.claude/memory-archive/<date>/`), the memory index,
  repo brain pointers, skills against `~/.claude/CLAUDE.md`, and the local copy's age (restarting
  `com.seq.boss-brains-pull`), then posts to `POST /api/boss/brains/cohesion/mac` (`brains_cohesion_mac`,
  week stamped on arrival). `GET /cohesion` returns ONE `line` for the Monday email ("Cohesion: all
  clear", or what was fixed and what was not); with no Mac record this week it says the check did not
  run, never "all clear". Never red.

## Local copy

`BOSS_PASSCODE=… npm run brains:pull` writes `~/Brains/<slug>.md`, each headed
`Source: Boss OS · pulled <timestamp> · edit in Boss OS, not here`, private spans kept. `--out <dir>` and
`BOSS_ORIGIN` override. Exits non-zero with a named stop when nothing was written. The launchd job
(`com.seq.boss-brains-pull`, hourly at :23) is written by `scripts/ops/install-agent-launchd.sh`; the
passcode is injected by the caller. A file whose brain Boss OS no longer lists (and that the pull wrote:
headed `Source: Boss OS`) is moved into `<out>/_retired/`, timestamped if a copy is already there;
nothing is deleted, other files are left alone.
