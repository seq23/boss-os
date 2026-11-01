# Boss OS — operating facts

Facts anyone driving or changing Boss OS needs, moved here from session notes on 31 Oct 2026 so
they live in the repo, not only in someone's memory. Non-confidential. `STATUS.md` and
`docs/boss/OPERATIONS.md` stay the authority for what runs; this page is the short list of traps.

## Routing and API
- Boss OS is mounted at **`/api/boss/*`** (`isBossRoute()` in `src/worker/bossMount.ts` strips the
  prefix). A probe at `/api/*` reaches the inherited West Peek chassis and answers
  `{"error":"unauthenticated"}`, a shape Boss OS never produces (its errors are `{ok:false,error,hint}`).
  `/api/health` is the chassis health route, so a green deploy check says nothing about Boss OS itself.
- Driving production from a terminal: `npm run vault:run -- node <script>` with `BOSS_PASSCODE`
  (in the vault since 6 Sep 2026) → POST `/api/boss/auth/unlock`. Having the passcode is not having
  her judgement: anything needing a promotion card or a benchmark verdict stops for her. A state change
  made with `wrangler d1 execute --remote` also writes the `audit_log` and `system_events` rows the
  endpoint would have written.

## Inherited West Peek chassis code
- The repo carries West Peek's email intake (`src/shared/intake/emailTriggers.ts`,
  `src/worker/effects/inboundEmail.ts`). Treat it as foreign: copy and diverge, never import it or
  share a routing table or constant with West Peek OS.
- **Superseded 31 Oct 2026:** Boss OS docs and UI used to never list West Peek sending paths. Her
  ruling ("Boss OS may handle anything she wants") put every business, the fund included, on the
  Email Map page (`src/shared/boss/emailMap/manifest.json`). What still holds: no LP, investor,
  prospect or customer name and no personal inbox in any git file (the manifest test refuses any
  address off a business domain), and `docs/OUTBOUND_EMAIL_MAP.md`'s audit table and Team → Duties
  stay Boss OS and side businesses only (`tests/helpers/fundCrossings.ts`).
- `RESEND_API_KEY` stays the West Peek team key, only for the named chassis-copy scripts.

## Mail
- Primary sender: Boss OS's own Resend team (`BOSS_OS_MAIL_KEY`; sequoiataylor.com,
  mail.spryexecutiveos.com, mail.aplayermode.com). Employees send as `<name>@sequoiataylor.com`;
  Cloudflare Email Routing on sequoiataylor.com routes the seat addresses into the Worker.
- Fallback: `BOSS_OS_FALLBACK_MAIL_KEY` (The Industry Guides' Resend team), From
  `Boss OS <hello@theindustryguides.com>`. Never a westpeek/joinwestpeek From outside the chassis-copy list.
- A new or changed sender anywhere goes on the Email Map manifest in the same PR (see CLAUDE.md,
  "The Email Map").

## Cadence
- Trigger hourly; maintenance once a day at 03:00 UTC; snapshot weekly (skipped if nothing changed);
  retention 12. The cadence guard lives in code, not only `wrangler.toml` (once it ran 96 times a day:
  62 snapshots, 30 MB of R2 in 15 hours).
- Every duty names its model and cap; the budget stops scheduled duties only, never dispatched ones.
- The Mac runs on Eastern time; launchd schedules are written in the Mac's clock, so a 07:40 plist is
  06:40 Central. Jobs that care about the hour decide it in Central themselves.

## Mac-side runs
- The Executive Intelligence Report is researched by Claude Code on the Mac: launchd
  `com.seq.boss-agent` runs `agent.mjs work-once` at the claim times; the run works in
  `~/.boss-os/reports` (not a repo, deliberately). A dispatch by hand needs
  `delivers: "executive_reports"` or the result is silently dropped. Never widen `allowed_paths` to the
  repo; add a `materials` entry.
- Search readiness: `src/shared/boss/searchReadiness/checklist.json` + `sites.json`; weekly launchd
  `com.seq.boss-sites-audit` (Mondays, `npm run sites:audit`), fix briefs to
  `~/.boss-os/search-readiness/fix-queue.json`.

## Lanes
- A failed post-land step on an employee's own change is that employee's rework: the runner posts
  `/:id/rework` (fresh branch `work/rc-<id>-fix<n>`), bounded by `MAX_REWORKS = 2` in `lane.mjs`; only
  the third failure emails her. Check every shape the model can write for a failure (a block-shaped
  result once bypassed the rework branch, #46).
- Owned deliverables have a named owner and a terminal condition, escalate blocks at once and again,
  report completion, and survive their own machinery failing; a check over zero items hard-fails.

## Performance (Workers Paid since 16 Sep 2026)
- The 10 ms Free-plan cliff no longer binds, but the measurements hold: one D1 round trip is the cost
  (use `db.batch`, `src/worker/boss/lib/batchReads.ts`); `Intl.DateTimeFormat` construction costs tens
  of µs on workerd (memoise). Local `wrangler dev` does not reproduce production `cpuTime`; measure with
  `wrangler tail --env production --format json`.
- Today is fetched as parallel `GET /today?blocks=…` groups (`TODAY_GROUPS`); never a bare `/today`.

## Roster data rule
- Employee appearance lives only in `src/client/public/employees-boss/CASTING.json`; no appearance or
  demographic column anywhere else. Boss OS names avoid the initials P and W (West Peek's).

## Version naming
- It is v21. v20 Phases 0–23 and v20.1 Batches 1–10 are two numbering systems ("phase 2, the local
  model" is Batch 2, deferred indefinitely, never raised). Read `STATUS.md` first.
