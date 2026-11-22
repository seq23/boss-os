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
- **GitHub's `schedule` event is not a clock for this account** (21 Nov 2026). It is best effort, and
  from about 2026-11-17 20:40Z it fired every scheduled workflow of the account once every 6-9 hours
  (a ten-minute job ran 11 times in four days); the 21 Nov morning email was never built. Boss OS keeps
  its own clock: the Worker's `*/5` cron (`src/worker/boss/cron/dispatch.ts`) reads every Schedule row
  with `trigger.clock: "worker"` (`src/shared/boss/schedule/clock.mjs`) and starts the job by
  repository_dispatch `trigger.event` on seq23/boss-os, once per slot (`cloud_job_dispatches`, latest
  slot in the last 30 minutes, so an outage costs one catch-up). Those workflows carry no `schedule:`
  (`cronProblems` fails two clocks, or a workflow that does not listen). Needs `GITHUB_SEQ23_PAT` on the
  Worker. The PAT and other credentials acting as the same GitHub user share its primary REST API
  quota. The clock uses GitHub's retry headers to wait for rate limits and retries server and network
  failures. A recorded slot can survive the 30-minute catch-up window, with a 90-minute cap.
  `mail:cloud-clock` opens when retries expire or a terminal refusal occurs, including a missing token,
  and closes on the next accepted dispatch.

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

### The shared ship-ready reviewer (20 Nov 2026, grid row 6f)
Owner, 19 Nov 2026 (personal brain, "VETERAN QUALITY BAR, HANDS-OFF"): the builder never grades its own
work; a fresh reviewer judges the REAL output against `~/.claude/skills/ship-ready/SKILL.md`.
- **One runner**: `npm run vault:run -- node scripts/ops/ship-review.mjs --kind page|email|video|profile|images
  --target <url|file|folder> --builder "<who>" [--subject <key>] [--brand <slug>] [--launch] [--pr owner/repo#N]`.
  It captures what a person meets (Playwright: 390 px + 1280 px, the WHOLE page in at most 8 real-size parts,
  never cut at a height; dark only when the site has a dark scheme or a theme toggle, else the fact says
  "no dark scheme" or "dark: not read", never a finding; with HTTP status,
  sideways scroll, broken images, title and console errors measured; ffmpeg: first frame + a 12-frame
  contact sheet; or the finished images; a YouTube channel through the official Data API with her key
  `HOWWEKNOW_YOUTUBE_API_KEY`: real avatar, banner, title, description and newest thumbnails drawn at 390 px
  and 1280 px, never a disguised browser visit), judges (what no capture showed goes in the reviewer's
  `unseen`, never a finding: with nothing real found it is NAMED STOP [CAPTURE_INCOMPLETE], exit 9; with
  `--pr` a page review also gets the PR's changed lines; `--on-github` takes a public page's capture on
  GitHub Actions, `.github/workflows/ship-review-capture.yml`, and judges it on the Mac: no Chrome on the
  8 GB Mac, never for private work, since the artifacts are public), prints `Ship-ready: PASS — boss-os ship-review sr_… (<route>)
  looked at <what>` or `…: FAIL …` with numbered findings, and with `--pr` appends the PASS line to the
  PR body, where `~/bin/land` reads it. Rules (pure) in `src/shared/boss/shipReview/review.mjs`.
- **Apps: the tap-through** (owner, 22 Nov 2026, "a factory standard that we live by"). Each app repo
  keeps a `tap-through.json` (journeys: first open, the main task, every price screen, restore, settings,
  delete my data, every preview flag for paid and hidden states; the price screen's promises mapped to the
  screen behind each; native-only features named with why). `scripts/ops/tap-through.mjs` drives the web
  preview at 390 px, light and dark, on GitHub only (`.github/workflows/tap-through.yml`: each app's
  preview workflow calls it, so a red run blocks `land`), records a video per journey and a shot per step,
  blocks every write the flow did not mock, and fails by name on DEAD_BUTTON, CONSOLE_ERROR, ERROR_SCREEN,
  STEP_UNREACHABLE and PROMISE_UNBUILT; PREVIEW_DOWN, FLOW_INVALID and FLOW_TAPS_NOTHING are named stops.
  `ship-review --kind tap-through --on-github --flow seq23/<repo>[@ref] --brand <slug> --target <preview>`
  dispatches it and judges the shots, dark sheets and video sheets with `app-review.md`; any measured
  failure is a FAIL finding, a stopped run is CAPTURE_INCOMPLETE. Its proof is `--self-test` (good and
  broken fixture apps in `scripts/ops/fixtures/tap-through/`), run on every PR that touches it.
- **Routes** (`aiRoles.routeOrder`): a subject never passed before is HARD (Claude seat, then Codex);
  a re-review is SHORT (free Gemini vision models from the search-loop roster, then Codex, then Claude);
  emails and Boss OS screens are private (never a free route). **A free route may FAIL a piece but
  never PASS it** (measured 20 Nov 2026: free Gemini passed a P&P reel the Claude seat failed on 7
  findings); its PASS goes on to a seat. Never a paid API.
- **Kept** in `quality_reads` (kind `ship`, migration 0369; the monthly read is kind `monthly`), API
  `POST/GET /api/boss/quality/reviews[?subject=]`; `latestShipReview` in `routes/quality.ts` for Worker code.
- **The request names its surface** (`--surface public-page|operator-doc|email|app-screen|video|social-profile`,
  default from `--kind`) and the job judges by that surface's rules (`SURFACES` in review.mjs): a private
  operator document is judged on whether its one reader can find, follow and trust each step, never on
  brand, SEO or launch items. **Planned placeholders** (`--planned "[Sequoia fills]"`, repeatable) are
  not findings; any other placeholder still is. Both are written into the verdict (20 Nov 2026, #469).
- **A change is judged as a change** (`--brief <file>`, 20 Nov 2026): each finding is marked in the change
  or already there; only the change's findings decide the verdict, the rest are listed apart on the PR
  for their own round (phase 4). `--focus "<changed text>"` adds a shot around that text wherever it
  sits on the page. FAIL findings and the already-there list go on the PR as one comment.
- **A capture failing is never a FAIL on the work**: pages wait up to 25 s for real content, a consent
  wall is declined (privacy first), and an all-blank capture is `NAMED STOP [CAPTURE_BLANK]`, no verdict.
- **Rule 0**: `OUTPUT 1 reviews` only when a verdict was stored; exit 0 PASS, 1 FAIL, 2 NOT_RECORDED,
  3 passcode, 9 NOTHING_CAPTURED / NO_REVIEWER (nothing passes by default).
- **Danielle's repo lane** (`repo-change.mjs` `shipReviewFor`): when a change's checks go green and it
  shows a person something (a preview deployment, else her build's screenshots), the reviewer runs once
  per PR head. PASS → the line goes in the PR body; FAIL → a red check: the findings are the rework
  brief (`MAX_REWORKS`); a reviewer that could not run leaves it pending for the next tick.
- **Phase 3, nothing new goes public without a PASS**: a new Email Map sender or live Social Map row
  carries `ship_ready: { pass: "<the PASS line>", review: "sr_…" }` (Launch-ready for a new channel), or
  `tests/shipReview.test.ts` fails the build. The senders and channels already live on 20 Nov are in
  `src/shared/boss/shipReview/live-before-gate.json` until phase 4 (Sat 21 Nov) scores them; the list
  only shrinks. Boss OS itself posts to no social platform (checked 20 Nov: no posting endpoint in this
  repo, no Social Map row citing boss-os code); its posters live in other repos and pass through `land`.
- **Agent reviews in a shared session go through this job** (20 Nov 2026, PR #469): every agent a
  session spawns carries that session's id, which `land` reads as the builder, so a spawned agent's
  "PASS" is refused. The runner signs as `boss-os ship-review sr_… (<route>)`, its own recorded review
  id, which `land`'s builder check (`builders`/`is_builder`) accepts; checked on #469's real commits.
  Run it with `--pr owner/repo#N` and the line lands in the PR body.
- Not a scheduled job: it runs inside `repo-change` (already on the Schedule and Scorecard) and on demand.
