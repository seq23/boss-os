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

- **Models for each job** (4 Nov 2026, migration 0337): `model_job_policies`, one row per job
  (`RouteRequest.jobKey`), edited on Settings → Models for each job (`/api/boss/models/job-policies`).
  The router applies it right after privacy and it only removes candidates; a `stop` job with no
  model ends in `NAMED STOP [NO_MODEL_FOR_JOB]`, never a weaker model's output.
- **Gemini direct, free tier** (4 Nov 2026, migration 0338): `bk_gemini` / `prv_gemini`, host
  `GEMINI_HOST`, secret `GEMINI_API_KEY`. Free ids are `GEMINI_FREE_MODELS` (backends.ts) and guard.ts
  `FREE_ROUTES`; every row is `TRAINS_ON_PROMPTS`. Google Search grounding is free only on
  `gemini-2.5-flash`, which retires **1 Dec 2026**: after that `POST /api/boss/research/person` falls
  back to Brave Search, then the guest's fetched pages, then to "Couldn't research <name>: <reason>".
  The writer for those pages (`meeting_prep_write`, migration 0354) walks the next free Gemini models,
  then OpenRouter's free models (`MEETING_PREP_WRITERS` in jobPolicy.mjs); never a paid one.
- **Brave Search, the second research route** (5 Nov 2026, migration 0340): `effects/braveSearchClient.ts`,
  secret `BRAVE_SEARCH_API_KEY` (vault → Worker through `vault:sync`). Capped at 20 searches a day
  (Central), stated once in guard.ts `FREE_ROUTES.svc_brave_search` and claimed in
  `free_search_quota_days` before each call; the 21st is skipped and research moves on. A free Gemini 3
  Flash writes only from the result pages; a fact citing any other link is dropped.
  Also held to **900 searches a calendar month** (`FREE_ROUTES.svc_brave_search.monthlyCap`; the
  plan is "Free credits only", about 1,000 a month, and cannot charge): past it NAMED STOP
  [BRAVE_MONTHLY_CAP]. A Brave 402/429 is a capped rung, not a failure.
- **The research chain** (owner, 6 Nov 2026: "it started with all free tiers and if they were all out
  then it uses an allowance on the paid models i have subscriptions to"): Gemini free with Google
  Search → OpenRouter `:free` writing only from Brave results → Codex's seat if not spent → the Claude
  seat → NAMED STOP with the reset. A seat is used only when her Mac was seen in the last 30 minutes
  (`sync_device.last_seen_at`, stamped by the agent's poll and `/claim`). Code: `queue/freeRung.ts`,
  `queue/consumer.ts`, `aiRoles.mjs afterCodexLimit`. OpenRouter `:free` calls carry `max_price` 0 and
  stop on any reported cost (`router/openrouter.ts`); its web plugin is never used.
- **Routes by ability, no model named** (owner, 13 Nov 2026: "all private stuff can go through codex i
  need a backup to claude", "its more about model ability too", "there needs to be no standing rule
  about any … model"). ONE table, `src/shared/boss/aiRoles.mjs` `ROUTE_TABLE`: a job has a class, a
  route has a tier (free = Gemini free then OpenRouter free; Codex = the `codex` CLI on her ChatGPT
  plan, never an API key; Claude = her Claude seat), and the order per class is that data:

  | Class | What it is | Not private | Private |
  |---|---|---|---|
  | hard | writes code that lands, decides, merges, reviews, repairs, money, interprets a brain, reaches her or a customer unchecked; and any job with no class | Claude → Codex → named stop | Claude only; waits for Claude by name (`WAITING_FOR_CLAUDE`), never Codex |
  | clear_brief | housekeeping, docs, test lists, bulk edits with a clear brief | Codex → Claude → named stop | Claude → Codex → named stop |
  | short | sorting, summaries, first drafts, routine searches, read-only lists something else checks, recording her words or a number into a brain | free → Codex → Claude → named stop | Claude → Codex → named stop |

  The class comes from what the queue already knows (`jobClassOf`: a repair, a repo change, a
  confidential draft, a Chrome job and an interpreting brain edit are hard; then the intake kind;
  anything else is hard). Private = what the privacy screen marks (committed LP names, deal terms,
  private brain parts, an unreadable lexicon): the free tier is on no private row, and that is the
  data-use rule (`router/policy.ts` stage 1: unknown data use = training, not approvable), not an
  ability rule. Private brain parts are still cut for every seat but Claude's.
  **Self-correcting, from the run logs, nothing new stored:** a seat that fails a class twice in a row
  stops getting it for a week or until one good run, and the job moves up a rung
  (`duties/seatOrder.ts` `seatFailedTwice`, reading `backend_runs` and `ladder_release` events; out of
  usage is not a failure). Inside the free tier a job tries each free candidate in turn, the one that
  last completed that kind of job first; a free answer that is empty or fails the job's own check
  fails that model for that kind, and two in a row pass it over (`router/experience.ts` `freeMemory`,
  reading `model_job_outcome`); a spent free allowance is a note, never a failure. On the 1st the
  Systems list gets one line, per route: completed, failed, redone (`router/routeCounts.ts`, event
  `route_month`). Pinned by `tests/boss/abilityRouting.test.ts`.
- **Private model only** means a COMMITTED LP's name and deal terms (owner, 4 Nov 2026): prospects
  are public. `committed_at` on `prospects` and `lp_reply_drafts` (migration 0339) puts a name back
  in the router's private lexicon.
- **Her time zone**: setting `owner_timezone` (default `America/Chicago`), `GET/PUT
  /api/boss/system/owner-timezone` `{ tz }`. Meeting prep shows times in it, the meeting's own zone
  in brackets only when different.

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
- **Every launchd job runs from `~/.boss-os/runtime`, never from `~/GitHub/boss-os`** (1 Nov 2026).
  `com.seq.boss-runtime-sync` (`scripts/ops/runtime-sync.sh`, every 10 min) holds that clone at
  origin/main: anything found on another branch or edited there is saved to
  `~/.boss-os/runtime-salvage/<stamp>/` and reset, and any plist still pointing at the working checkout
  is named in the log and the morning email. `bash scripts/ops/install-runtime.sh` (idempotent) clones
  it and repoints the plists. Nobody works in the runtime: code changes go in a worktree from
  origin/main (the mail tail's agent is told to cut one, `.wt-danielle-boss-os-<stamp>`).
  Pinned by `tests/runtimeCheckout.test.ts`.
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


### Per-person no notices (4 Nov 2026)
`quiet_people.address` is the case-insensitive private runtime list. Migration 0336 seeds it by
looking up the owner-named LP in D1, without copying an address into source. `listLpRows` projects
`quiet` into the API; waiting carry-over, LP Decide/nudges, the LP morning producer and the final
morning assembly honour it, including stale section files. Records and manual reply authority stay.

### Google sign-in timeout (4 Nov 2026)
`mintComposeToken` previously let its ten-second AbortError escape into a 500 on Today sends.
It now retries sign-in once (before any Gmail send), then returns a structured failure that the
held-reply path records. The send itself is never blindly retried. This reproduces the reported
error in a test; production traces for the two reported requests were not available locally.

### Output floors and Kendra's alarms (6 Nov 2026)
Owner, 5 Nov 2026: stop "green but did nothing" (P&P outreach ran green 2-5 Nov and sent 0; Wynn's
owner emails failed 236 times 2-6 Nov; a task read "running" for hours on a spent seat).
- **Every scheduled job names its output**: `output` on each row of
  `src/shared/boss/schedule/manifest.json` (metric, floor, runs; or floor 0 with a reason), and the
  same floor on its duty (`standing_duties.output_*`, migration 0350). `npm run validate:output-floors`
  fails CI otherwise, and when a producing duty's script prints no `OUTPUT <n> <metric>` line
  (`outputLine` in `src/shared/boss/alarms/rules.mjs`; `PENDING` in the validator names the three
  scripts still to add one).
- **`duty-run.sh` reads the line** into `duty_runs.output_count` (no line = unknown = below floor).
- **Kendra's alarms** (`system_alarms`, `src/worker/boss/alarms/kendra.ts`, hourly tick; API
  `/api/boss/alarms`): a duty below its floor `output_runs` runs in a row; a task "running" over twice
  its usual duration or 2 h with no progress (title and seat); an owner-bound email failing twice in a
  row in any app (`scripts/ops/owner-mail-watch.mjs`, launchd `com.seq.boss-owner-mail-watch`, 07:50 and
  15:50 Central; her addresses in `~/.boss-os/owner-mail/addresses.txt`, never the repo). Each opens one
  repair task for Kendra and closes itself when the condition clears. Only an alarm she alone can fix
  (`hers`: a sending key refused) shows on Today.
- **A new duty gets a first-run check**: an Open Loops row "Check <job> produced <metric> by
  <created + 2 days>", owner Kendra, closed by its first above-floor run.

### Delivery floors: the finished work is checked where it lands (13 Nov 2026)
Owner, 13 Nov 2026: "figure out how ot make sure my briefs get wrriten to the impeccable standard we
have had". A review found that nothing checked the finished work (a half-depth briefing read
"partial" like every good day; backlink prospecting "succeeded" weekly with zero rows ever).
- **One floor per deliverable, run on the real output at `/api/backends/report`**
  (`src/worker/boss/duties/floors.ts`; the briefing's is `briefingFloor` in `briefingSpec.ts`:
  11 sections to depth, 5 headlines, 20 sources, 1,000 characters of reasoning per headline, at most
  3 unverified gaps, no headline repeated word for word, 15 cited sources answering a plain GET).
  Lists (sourcing, backlinks, tools) need new rows whose links open; a research page needs a source.
- **A miss is a failed run of that route**: handed up to a stronger seat through `ladder_release`
  when the ladder has one, counted by the two-failures rule (`seatFailedTwice`), never auto-accepted.
  No readable `delivers.json`, "blocked on missing input" and zero rows are misses.
- **The briefing's best attempt of the day stands** (`executive_reports.floor`, migration 0363):
  status `complete` means at the standard, `partial` means below it, and its first shortfall says
  what fell short on Today and in the morning email. A late briefing says "arriving by HH:MM".
- **The briefing starts on Claude's seat** (`HARD_DELIVERS` in `aiRoles.mjs`), Codex as the backup.
- **The standards are on file**: `tests/fixtures/briefing/standard-2026-10-22` (must pass) and
  `below-2026-10-27` (must fail), graded by `npm run validate:briefing-on-par`; other deliverables in
  `tests/fixtures/floors/` (private ones masked to their shape), proven in `tests/boss/floors.test.ts`.

### Four repairs behind the floors (13 Nov 2026)
- **Backlink prospecting had no site list.** Its prompt named `PROPERTIES.json`; nothing wrote it, so
  every run was blocked and delivered zero rows. `scripts/ops/properties-snapshot.mjs` writes it
  before the Mac claims work (`scripts/ops/agent-claim.sh`): her own sites from
  `searchReadiness/sites.json` (a friend's or client's site is left out), most Search Console clicks
  first, `not read: <reason>` when clicks cannot be read.
- **A delivers.json that does not parse** gets one syntax-only repair pass on the same seat
  (`scripts/sync-agent/runner.mjs`); still unreadable is `NAMED STOP [DELIVERS_INVALID]` and a failed
  run, never "succeeded".
- **Row-delivering runs are told how they are checked** (`deliveryRules`, `duties/floors.ts`, appended
  when the task is made). Sourcing may file an honest "nothing new" only with its searches and the
  firms it turned down on record.
- **Free Google-grounded search walks every free model** (`router/experience.ts`): a 404 "no longer
  available" disables the model for good, a 429 on grounding passes it over until the daily reset;
  then Brave with a free writer, then a seat. Never a paid route.

### Drift prevention: a slow slide shows before a floor is missed (13 Nov 2026)
- **Every floor check keeps what it measured** (`delivery_measures`, migration 0365): the counts, pass
  or miss, and the route that ran it. Written by the report route and the free research rung
  (`duties/drift.ts` `recordMeasures`).
- **Mondays, the morning email carries "Quality check"**: one line per deliverable, this week beside
  its best earlier week and the last four weeks (`driftReport`, `GET /api/quality/drift`,
  `your-day.mjs qualitySectionFor`). A line is flagged only when a measure sits more than 25% under
  its best week two weeks running, or a floor was missed. Nothing checked reads "not measured".
- **Golden replay**: each deliverable's best example goes through the real report route in CI
  (`tests/boss/floors.test.ts`), so a change that would turn the best work away fails before it is
  live. CI replays the best output; it cannot run a model.
- **The monthly read** (`duty_quality_read`, the 1st, 9:00 am Central): her Claude seat, Codex's as
  the backup, never a free route (`HARD_DELIVERS`). It reads the newest real output of each
  deliverable beside the best on record and files `holds` or `slipped` with a reason
  (`quality_reads`); the email shows it for the week after it lands.
