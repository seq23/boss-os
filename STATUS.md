# Boss OS — what this is, plainly

**Read this first.** It exists because two sessions in a row got confused about what this repo is,
what version it is, and whether it was finished. Everything here is written to be read cold, by
someone — or something — with no memory of the conversation that produced it.

Last verified against the code and against production: **20 September 2026.**

---

## The one-paragraph version

Boss OS is Sequoia Taylor's private, single-user executive operating system. It runs as one
Cloudflare Worker serving a React app over a D1 database, live at **boss.sequoiataylor.com**, behind
a passcode. It is **v21**. It is deployed, it works, and it is in use. Some of it is deliberately
unbuilt, and this file says exactly which parts and why.

---

## Naming — the thing that keeps causing confusion

There are three different things with a "v20" or "v21" on them. They are not the same thing.

| Name | What it is | Where |
|---|---|---|
| **Boss OS v21** | **The live product. This repo.** | `~/GitHub/boss-os` → boss.sequoiataylor.com |
| **Boss OS v20 canon** | The specification v21 implements. Frozen. Historical. | `docs/boss/` |
| **Boss OS v20 build** | A deprecated earlier build. Not live. Do not work in it. | `REPO_OPERATOR_ARCHIVE/deprecated-repos/` |

**The `docs/boss/BOSS_OS_v20_*.md` filenames stay v20 on purpose.** They are the authority this
product implements, not the product. Renaming them would break every `§`-citation in the code, and
the v20.1 plan's §1 explicitly forbids renumbering them. So: **v21 is what runs, v20 is what it was
told to be.**

Owner's decision, 6 Sep 2026. Before it, `BOSS_OS_VERSION` was never set in `wrangler.toml` and the
fallback in `bossMount.ts` reported the literal string `"v20"` — so the live build identified itself
as the deprecated one in `/api/system/health` and in every snapshot payload.

### There are also two *numbering* systems, and they are unrelated

| System | Range | What it counts |
|---|---|---|
| **v20 Phases** | 0 – 23 | The original build of the product |
| **v20.1 Batches** | 1 – 10 | A later extension: Sovereign Sync + Private Compute Airlock |

So "Phase 2" and "Batch 2" are different things. **Phase 2** is AI employees and the model router,
built long ago. **Batch 2** is the local model runtime, which is not built — see below. When the
owner says "phase 2, where I download a local model", she means **Batch 2**.

---

## Batch 2 — the local model. NOT DONE, AND THAT IS FINE.

**Status: deferred by the owner, indefinitely, with no due date.**

She will do it when she feels like it. It is **not a blocker, not a TODO, and not an outstanding
item**. Nothing else waits on it. Do not plan around it, do not schedule it, and do not raise it as
a gap in a status report.

**Why it is legitimately deferred:** the v20 build plan's own locked decision D2 says *"No local
model. The cheap tier is Workers AI, benchmarked not assumed. True sovereign inference is deferred
to the Phase 22 server."* The laptop this runs on is an M2 with 8 GB. The addendum requires that a
sovereign runtime be a *tested* path, not an aspiration, and an untested one would be worse than a
named absence.

**What the product does about it, correctly:**

- `localModelStatus()` returns `DEFERRED — NO LOCAL HOST` — never a status that reads like readiness
- Systems → Airlock shows that string verbatim, with the reason: *"Canon §106 asks for at least one
  local model registered. No local runtime and no host exists in this build, so the criterion is
  recorded as deferred rather than marked met."*
- The local adapter **interface** exists and is unimplemented and labelled, so a future runtime drops
  into a defined slot rather than forcing a refactor
- The airlock's `LOCAL_ONLY` AI-processing rules are enforced **now**, in advance of the data — which
  is the right order, and should not be mistaken for the feature being complete

**This is a NAMED STOP, not an omission.** The distinction matters: a named stop is green and
self-explaining. Reporting it as an open item is the error.

---

## What is built, and what is not

### v20.1 — complete

Batches 1, 3, 4, 5, 6, 7, 8, 9, 10 are all implemented: data classification and the airlock, the
sync substrate, the cloud sync API, the Mac agent, conflict resolution and merge policy, offline
PWA capture, private-compute UX, the adversarial leakage suite, and the security review. Batch 2 is
the named stop above.

`docs/boss/V20_1_SECURITY_REVIEW.md` records nine findings, all fixed, including a critical one: the
continuity vault was copying all eighteen sovereign `LOCAL_ONLY` tables into cloud R2 nightly.

### v20 Phases — six of them never arrived

**Phases 6–10 and Phase 12 are not in this repository, and never were.** This is not a regression
and nobody broke anything. The Boss OS v20 artifact that was ported into this repo was already
missing them — its migrations run 0001–0004 and then jump to 0009.

`docs/boss/PHASES.md` says so in its own seventh line. Their absences are recorded at the point of
use rather than papered over, which is why you will see:

- **Today blocks 8 and 9** (Coaching Focus, Daily Thinking Lens) permanently reading *"No coaching
  faculty exists yet. The daily panel lands in Phase 12."*
- **The monthly capability scan** riding the daily cron as a no-op, because Phase 10's
  `standing_duties` table does not exist

Both of those are Phase 10 and Phase 12, which the owner does want — see below.

**The specifications for all six DO exist**, in `docs/boss/BOSS_OS_v20_BUILD_PLAN_v2_CONSOLIDATED.md`
Part 3, with migrations, tables, acceptance sentences and required tests named.

**The owner has decided what happens to each of them. See `docs/boss/DECISIONS.md`.** In short:

| Phase | Decision |
|---|---|
| **6** · Validation & deployment proof | **Not a build task.** Substantially already satisfied; two items left, both the owner's — a real inference call reconciled to an invoice, and correcting the seed's placeholder token prices |
| **7** · Notifications, screens, cost guardrails | **Half built.** The screens half is done; the notification half is **declined** — the chassis already ships one in this same Worker |
| **8** · Model runtime completion | **Deferred, not blocking.** Honest benchmarking costs real money; the table already exists and an empty bench refuses honestly |
| **9** · Execution backends and the repo lane | **Declined. Do not build.** It duplicates Claude Code, needs credentials that buy nothing new, and its own spec forbids pointing it at this repo first |
| **10** · Standing duties | **Wanted.** Scope pending — the owner has materials |
| **12** · Agenda engine and coaching | **Wanted.** Scope pending — the owner has materials |

**None of these is an open item.** A decision not to build is a finished decision.

### v21 stages — in progress, 6 September 2026

The owner approved `docs/boss/PLAN_v21.md` on 6 Sep 2026. It supersedes the "not built" half of
`DECISIONS.md`: she wants all of it, and reframed Phase 9 in a way that answers the objection
recorded there. **Read the plan, not the old decisions, for anything about Stages 1–8.**

| Stage | State |
|---|---|
| **1 · Execution backend registry** | Schema **applied to production** (`0173`). Server half in progress |
| **2 · Claude Code as a backend** | In progress |
| **3 · Dispatch UI + notifications wired** | In progress |
| **4 · Continuity: fallback and cost** | In progress |
| **5 · Standing duties** *(Phase 10)* | **Built and live.** `standing_duties` + Camille's daily report duty. Skill packs and assignments deliberately not built — nothing asks for them yet |
| **6 · Agenda engine + coaching** *(Phase 12)* | **Half built.** Today's block 02 is Camille's report. Blocks 08 and 09 still empty — they need the A-Player contract's agenda, and one decision from the owner (below) |
| **7 · The model bench** *(Phase 8)* | In progress. Reframed — see the $0 rule below |
| **8 · Ledger truth** *(Phase 6)* | **First half done** (`0174`). Second half needs her key and money |

### The roster — seven people, and where appearance lives

Migration 0175. Eight seats became seven and one capability appeared, because the owner read her own
roster and said what was wrong with it: *"Task Intake, Repository, Knowledge, Relationship… are not
real roles someone can have when they work for a Boss."*

| | Role | |
|---|---|---|
| **Simone** | Chief of Staff | absorbed Task Intake |
| **Camille** | Director of Research | new — the morning report |
| **Danielle** | Technical Program Manager | |
| **Zora** | Archivist | |
| **Monique** | Director of Relationships | |
| **Kendra** | Systems Manager | absorbed Model Router |
| **Toni** | Chief Risk Officer | trading lane, isolated by design |

**Merged, not deleted** — `lifecycle = 'merged'` with `merged_into` pointing at the survivor.

**APPEARANCE LIVES IN `src/client/public/employees-boss/CASTING.json` AND NOWHERE ELSE.** The owner
directed that her employees are Black women. There is no race, appearance or demographic column in
`employees`, in the registry, or in the worker, and none may be added. A face is a rendering
concern; a charter is what the system reasons about. Every portrait's alt text and the manifest
beside the files state that these are AI-generated images of people who do not exist — not a
disclaimer, the thing that stops a face being taken later for a colleague.

**Names avoid P and W**, the initials West Peek's entire roster uses, so an employee of one business
can never be read as the other's. That is the whole of the constraint (ADR-026).

### Camille's standing duty

**06:00 America/Chicago, daily** (was 06:30 until 19 September 2026) — an hour before the owner
looks, because a Sonnet run at the file's depth takes 20–25 minutes and she asked for the report to
BE there at seven.

**Why the half-hour moved.** The cron is hourly on the hour, so a 06:30 duty was not due at the
06:00 tick and fired at 07:00; the Mac's next launchd slot was 07:10; the report landed at
07:18–07:25 — measured across fourteen days of `backend_runs`, never once by seven. 06:00 is on the
tick every day of the year; the Mac now has a 06:05 slot.

**The specification is code (19 September 2026).** Her brief: *"the executive briefing [in my OpenAI
app] is far superior ... fix Boss OS's daily executive briefing to be just like the one in my txt
file."* `src/worker/boss/duties/briefingSpec.ts` is the file's production prompt ported (astrology
removed), plus the source tiers, the market watchlist, the section shapes and the grader.
`materialise.ts` composes the prompt from it every morning; `$.prompt` is no longer in the duty row.
The dashboard is **built by the system** from `MARKETS.json`, which `scripts/ops/market-snapshot.mjs`
writes on the Mac before the claim (Yahoo Finance chart API + the Treasury's par-yield CSV; free,
keyless, probed) — on 19 Sep the model-typed dashboard had three of three index figures wrong, each
cited. SPCX is on the watchlist, so the feed answers SpaceX's listing status daily instead of the
prompt asserting it. The runner removes a stale `delivers.json` before every run (15 Sep's report was
14 Sep's, refiled). Model rung: **Sonnet 4.5** on her Claude Code session — $0.00 API dollars against
the $2.50/day posture; the CLI's notional figure accrues to `bk_claude_code`'s $50/month Claude Max
proxy. Guard: `validate:briefing-on-par`, which runs the shipped code over the live fixture in
`tests/fixtures/briefing/`.

**The ladder (0258).** Her question: *"the Boss OS briefing is run using my two $0 lanes first,
right — Claude and OpenAI?"* It was not — one seat, a refusal failed the task, `/claim` handed a run
only to the seat it was parked for. Now `backend_ladder = [bk_claude_code, bk_codex]` on the duty:
the consumer walks it (`ladder_step` events), a seat may claim a run parked for a seat above it
that failed preflight (`fallback_from`, `ladder_handoff`), each seat gets its own model, and when
both refuse the walk continues into the cloud router. **The `:free` OpenRouter rungs are refused for
this content by the router's LP/deal-terms scan** (they train on prompts; the briefing's wording
reads as deal material; nothing a caller declares lowers that) — so below the seats the first rung
that can take it is the cheapest non-training one. `written_by` on the row and on Today says who
wrote each morning. `node scripts/ops/briefing-ladder.mjs` prints the ladder as the migrations
leave it.

### Her five jobs (19 September 2026, ~13:00 CT)

**1 · A letter sent back with a note is rewritten to answer it, in minutes, and she can watch.**
CONFIRMED on production: her second batch (`approval_batches` apb_m2x9y0t8yq0tfpe0, 13 of 13) was
answered thirteen times with "No new letter … word-for-word" — the composer is deterministic and
cannot read a note. Now `wealth/rewrite.ts` (0261 `outreach_rewrites`): a send-back with a note
queues a rewrite on the Worker's own queue (never the Mac's launchd slot), `private_model_only`, so
it lands on the first non-training rung (Workers AI, $0); the reply is checked against the letter's
rules in code (name, Spry VC + LinkedIn, never "broker", no address, no figure she did not state,
different from every rejected letter) with one retry; attempt N+1 is raised with her note beside it
and "rewritten by <rung>" on the card. The Capital desk and the Inbox print ONE sentence from rows —
"13 sent back with your note · rewriting now · 4 of 13 ready" — and polling it drains the queue.
"Rewrite the N with my notes" retries failures. The 13 on production start the moment the deployed
Worker's first poll or tick runs (`materialiseRewrites`). Live proof:
`tests/fixtures/rewrite/live-run-2026-09-19.json` (2.6 s, cost 0). The green button's Gmail draft was
proven end to end the same day: draft `r-1259884589917502769` / message `1a0bad962e5938bf` created
by the real approve path in staylor@spry.vc, read back under gmail.readonly, deleted, 404 after.

**2 · The Capital tab tracks nothing of West Peek's raise.** The `west_peek` lane is excluded from
the return ledger at its one enumeration (`RETURN_LINES`), the contribute door refuses the line, the
Mac contributor no longer reads the LP tracker. Monique's personal LP-search duties (`duty_lp_replies`,
`duty_lp_positive`) are kept and pinned. Guard: `validate:no-west-peek-totals`. Kept on purpose:
`duty_scooter_sheet` (she asked for the Wednesday copy by name on 8 Sep; it carries replies, not
money) and Today's Wednesday cadence (§5.4, her diary).

**3 · The grid has readers.** `src/shared/boss/propertyReaders.mjs` names, per property, uptime /
GSC / GitHub / Cloudflare as WIRED or CANNOT with the reason; 0263 `property_health_readings` and the
new `executor = 'worker'` duty kind (uptime daily, GSC weekly from the Worker; GitHub and Cloudflare
posted by `grid-watch.mjs` from her Mac, where the tokens live). Systems → Properties shows the card.
Guard: `validate:property-readers`.

**5 · "Find me a list of firms that did X, and draft an email to ask Y."** One shape of work on
every door (`admitTask` runs the grammar in `research/firmScan.ts`): Camille owns it; public news
RSS is read from the Worker, each page fetched; a finding is kept only if its sentence is on the
page it cites; each verified firm gets a letter through the letters' own door — Inbox card, Gmail
draft on the green button, rewrite on a send-back. `ask_scans` / `ask_scan_findings` (0264) carry
the counts the desk prints. Run for real once against the live web on 19 Sep (Anthropic IPO):
`tests/fixtures/firm-scan/live-run-2026-09-19.json` — 5 sources read, 6 of 8 firms verified, 6
letters in 63 s, cost 0, with the gaps stated in the file.

**How the live proofs were run.** `wrangler dev` without `--local` proxies only the `AI` binding to
the real Workers AI (D1, KV, R2 stay local); the Google key came from the vault into `.dev.vars` for
the session and was deleted after. `wrangler.toml` is unchanged; `npm run e2e` stays hermetic and
proves the NAMED STOPS instead.

**A wall-clock time and a zone, never a UTC hour.** `0 12 * * *` is correct in September and an hour
early from November; nobody files a bug for that, the report is just quietly stale for five months a
year. Duty materialisation runs on EVERY hourly tick rather than inside the 03:00 UTC maintenance
block — that block fires at 21:00 the previous evening in Chicago, so a 06:30 CT duty checked there
would arrive a full day late.

**Nothing runs until two deliberate acts:** commission the `bk_claude_code` backend, and run the Mac
agent so it can claim the task. Until then the duty fires, the task queues, and Today's block says so
plainly.

### A duty on her word (21 September 2026)

**"is there a lane for me to ask for a new duty to my Boss OS agents?"** `duties/author.ts` had
drafted a proper duty from a phrase for weeks and `POST /employees/duties/draft` filed it as a
`duty_created` card — and nothing invoked either. Now: `#<seat> new duty <her words>` to
boss@sequoiataylor.com (or `#simone new duty <seat> …`) comes back as the full draft with every
refusal; `approved` on the thread decides the same judgement call the Inbox button decides
(`approvals/decide.ts`, extracted from the route so the mail door takes the identical path);
`changes: …` redrafts; `your call` in the request creates at once with the phrase on the record.
**Team → Duties** lists every duty per seat (cadence, executor, last run, next run, outcome) and has
the same door with a preview. `duties/create.ts` is the ONE writer of `standing_duties` at runtime;
`validate:duty-birth` pins that, the two roads to it, the check above the write, the mail calls
below the sender refusal, and `INSTALLED_LOCAL_JOBS` equal to the installer. A local-job duty whose
script is not installed is a `NAMED STOP [NO_SUCH_SCRIPT]`, never a row. Operator steps:
`docs/boss/OPERATIONS.md` → "How to give an employee a duty". Migration `0267`.

### Monique's outreach — fully automatic, braked in code (9 October 2026)

**Owner: "u do it all".** Monique writes to businesses for ten side businesses (five local guides,
five consumer products; how-we-know has none until ~1,000 subscribers) with **no human review**.
`src/worker/boss/outreach/catalog.ts` is the one list: sender, offer, segments, the three emails.
The hourly tick (`runOutreach`) reads replies first, then the brakes, then sends, then builds lists.

| Brake | Where | Test |
|---|---|---|
| 10/day per domain, ramping to a hard 40 | `brakes.ts` `dailyCap` | `moniqueOutreach.test.ts` |
| Pause on bounce > 3% or any complaint, reason on Monique's card | `pauseReason`, `engine.ts` | same |
| Kill switch, sending flag (`off`/`test_only`/`live`) | `outreach_settings`, `refusal` | same |
| No postal address → no business email (CAN-SPAM) | `refusal`, `composeEmail` | same |
| Unsubscribe link + one-click header; suppression global, at once | `compose.ts`, `routes/outreach.ts` `/u/:token` | same |
| Stop on any reply; unsubscribes honoured even with the kill switch on | `processReplies` | same |
| Sends only as st@time-2-read.com aliases, never spry.vc/West Peek | `gmail.ts`, `validate:no-spry-sender` | self-test |

**The route.** The Workspace that owns st@time-2-read.com is reachable by the existing service
account with `gmail.compose`, which permits `messages.send` (proven 9 Oct 2026, message
`1a11f4e4ed7306ac` to the test inbox). Each other business sends as `hello@<domain>`, an alias of
that one user on a free secondary domain. `npm run outreach:domains` adds the domains, aliases,
send-as entries and SPF, and counts Workspace users before and after so it can never add a licence;
until the delegation scopes it needs are granted it prints **NAMED STOP [OUTREACH_DOMAINS_SCOPES]**
with the click path. A business sends only after the Worker sees its alias in the send-as list and
proves it with one email to the test inbox.

**Lists** come from OpenStreetMap (public Overpass) and each business's own website, qualified by
what the site says, business addresses only, MX-verified. **Interested** replies become an Inbox
card whose green button drafts the suggested reply in st@time-2-read.com. **Affiliates** get a code
(`T2R-…`, `AP-…`); sales arrive at `POST /api/boss/outreach/referrals/conversions` as Stripe
`metadata[ref]`; payouts are computed monthly and never paid by code. **Etsy** listing files:
`docs/boss/etsy/listings.json`.

### Danielle's repo-change lane — Plan B (20 September 2026)

**What she does now.** She emails `boss@sequoiataylor.com` with `#danielle`, a grid repo name and/or
a Google Drive folder link, and what she wants. Danielle, on her Mac, reads the package
(`scripts/ops/drive-pull.mjs`, service account from the vault) and the repo's **`RUNBOOK.md`**
(BLOCKS if there is none — `join-west-peek-main/RUNBOOK.md` is the model), writes a plan whose
decisions are split into *decided* (structure, CSS, validators, redirects, assets, build wiring) and
*ask* (brand/colourway, copy meaning, legal wording, removing a public claim, image rights, money),
emails the plan and the asks, waits, builds on her reply in a worktree, proves it with the repo's own
validators plus screenshots at desktop and 390px and a curl of every new link, opens a PR, **lands
it on green through `~/bin/land`** (her decision: no second reply), proves it live, and emails the
PR, the merge commit and the proof.

**Where each piece lives.**

| | |
|---|---|
| The one record: kind, executor, phases, **model per phase**, turn caps, timeouts, the parse, the two guards | `src/shared/boss/repoChange/lane.mjs` |
| Intake — every door, Danielle's desk only | `tasks/admit.ts` → `input.repo_change` + a `repo_changes` row (0265), `intake_kind = repository` |
| The queue parks it for the Mac (`parked_for_mac`), never a cloud rung | `queue/consumer.ts` |
| Her reply = the plan approval; matched on `[rc_…]` in the subject, below the sender refusal | `intake/inboundMail.ts` → `repoChange/answer.ts` |
| The claim (one live run per task) and the phase reports | `routes/repoChanges.ts` at `/api/repo-changes` |
| The Mac: lock, caffeinate, hard timeout, vault, one fresh `claude -p` per phase | `scripts/ops/repo-change.sh` → `repo-change.mjs` → `repo-change-prompt.md` |
| Installed by | `install-agent-launchd.sh` (`com.seq.boss-repo-change`, every 20 min 06:00–22:00 CT) |
| The screen | Systems → Properties → **Repo changes** |

**Her reply is one word (21 Sep 2026: "the approval step must have zero friction").** The plan
email carries the whole plan and every ask as a numbered question with Danielle's recommended
default beside it. `approved` (also approve / yes / go / land it / ok) takes every default and starts
BUILD; a reply starting `no` / `not approved` / `stop` / `changes:` holds the task in `asking` with
her note on the row; anything else is her answers. `readReply` in `lane.mjs` is the one reader.

**Not publish-ready ships as a preview (21 Sep 2026).** Every plan says `publish_ready`; false
whenever a placeholder or TODO would ship, with the placeholders named. The plan email says so at
the top; her `approved` then means build → PR → **preview email** (the Pages branch URL, or "no
preview deployment" for a Workers repo — PR + screenshots + validators instead) → a task that holds
until her **second `approved`**, recorded after the preview email. `preview` on a ready plan forces
the same. **The named force**: `approved to production` (also `force production`, `ship it anyway`,
`land anyway`) on a not-ready plan or on the preview skips the gate and lands on green — who, when
and which placeholders on the row, a `warn` finding, the DONE email leads with it, the screen shows
the badge. Plain `approved` never forces. Pinned by `validate:repo-lane` (48 guard cases) and
proven by `tests/boss/repoChange.test.ts` (four paths, the force, a stranger's force).

**A post-land step is a recorded command; the lane builds in its own worktree; a retry resumes
where it stopped (21 Sep 2026).** `rc_m32h8ze2a4hk37pc` landed how-we-know #102 and then failed on
"`undefined` exited undefined": the plan named the About push in prose and nothing recorded a
command. Now the PLAN phase files `post_land_step: {command, proof}` (stored as
`post_land_command` / `post_land_proof`); a plan whose text names a step and resolves no command is
refused BEFORE the build (`POST_LAND_STEP_UNRESOLVED`); the LAND phase runs exactly the recorded
command and the runner refuses a `post_land` that differs or has no integer `rc`; a row that already
merged resumes on the step alone (`ALREADY_LANDED`). `rc_m32h946mv0eybxhj` stopped on
`REPO_HAS_UNCOMMITTED_CHANGES` because how-we-know's main checkout carries loop state the repo's own
lanes rewrite — that stop is retired: BUILD runs in `~/.boss-os/repo-change/wt-<id>`, a worktree the
runner makes off `origin/main` with `node_modules` symlinked (Porter's shape), removed at DONE.
`retryRow()` resumes at `resumePhase(row)` — land / landing / build / plan by what the row holds — so
a failed build keeps the plan and her approval. Pinned by `validate:repo-lane` (140 guard cases,
counted from the source now rather than a literal) and two tests in `repoChange.test.ts`.

**Seeing it produces something — the Kindle surface (21 Sep 2026).** Amazon flagged The Gift
Letter's title on 12 and 14 Sep (repetitive terms, five days to fix); Simone's daily scan SAW it
three times and nothing followed: the needs_owner row sent no email (the prompt told a vault-less
model to send), "assigned to Zora" was a sentence with no `work_assignments` row, and four "quiet"
runs never re-raised an open problem. On 21 Sep Amazon said it will not make the book available.
The scan happened daily; what failed is that seeing it produced nothing. Now: the model writes
`surface.json` and nothing else; `kdp-surface.sh` is the one poster (through the vault) and derives
the sentinel from the file; `scripts/ops/kdp-register.json` is the standing truth (seven titles,
all `target: LIVE` — her words: every book published and working; the covers and case #51496198
settled, never re-raised) and the report script refuses a file that contradicts it; `assigned`
requires an `assign` block and the endpoint creates the row in the same request; a problem carries
`due_at`, `needs_owner` needs `owner_ask` and earns exactly one email from Simone (`#simone
[kml_…]`, Resend id on the row, a NAMED STOP if it did not go), and every daily run chases any open
problem within two days of its deadline or past it until `resolved_at`; her "approved" on the thread
lands as `owner_answer` and the next run executes it with `npm run kdp:retitle` (subtitle only,
state read from the bookshelf; `reauth_required` is a one-line ask in the same email). Pinned by
`validate:kdp-seeing-produces-something` (11 fixtures) and `tests/boss/kdpSeeingProducesSomething.test.ts`.

**Every employee address delivers (21 Sep 2026).** Her "approved" to `danielle@` bounced 550 —
employees wrote from `<name>@sequoiataylor.com` and only `boss@` had an Email Routing rule. Now:
one literal rule per name → worker `boss-os` (a catch-all cannot target a Worker); an untagged
message routes by its To: local part (`seatByAddress`), a typed tag still wins, `boss@` still
defaults to the Chief of Staff; every employee email is built by `employeeMail()` in
`scripts/ops/notify.mjs` — `reply_to` = her own address, subject led by her `#tag`.
`validate:employee-addresses-receive` (offline in CI against `scripts/validate/fixtures/
email-routing-rules.json`, live through the vault with `npm run employee:addresses:live`) proves an
enabled rule per roster local part and that the sender ROSTER equals the active D1 roster; a ninth
hire fails the build until `npm run employee:address -- <name>` has made her rule. **A retry is a
resume**: "try again" on a failed change's thread — token or References — keeps the row with her
instruction, repo, folder, pre-approval and force phrase; nothing new opens. **The CLI runs on her
seat**: every vault-run `claude` spawn passes `seatEnv()`, which strips `ANTHROPIC_*` / `CLAUDE_*`
auth (both of her first jobs died on an API key with no credit).

**Pre-approval in the request (21 Sep 2026).** `your call` / `you decide` / `no need to ask` /
`just do it` / `pick everything` / `no options` in HER request: the plan decides everything (a
pre-approved plan that asks is refused), is filed as approved — `plan_approved_by = <her address>
(pre-approved in the request: "<phrase>")` — with a finding naming the phrase, the FYI email goes
("you pre-approved this; no reply needed. Reply `stop` within the build to hold it"), and BUILD
parks at once. Not publish-ready still stops at the preview unless the request also carries a
force phrase. `stop` / `no` / `changes:` at build withdraws the approval; at landing it parks the PR
until her `approved`. Written once, at intake, below the sender refusal; never from a later message.

**The grid gained `creator-network` (21 Sep 2026)** — one list, `src/shared/boss/grid.mjs`, with
the validator's fixture copy in step; a `#danielle` mail naming it is admitted (`how-we-know` was
already on it under `youtube`). **A post-land step she names** ("after landing, run bin/<script>
and attach the proof") runs in LAND after `~/bin/land`, bounded to what she or the plan named,
and its proof rides the DONE email; a failed step is `POST_LAND_STEP_FAILED`. A runbook rule that
forbids the instruction is `RUNBOOK_FORBIDS`, quoting the sentence.

**Phases.** `plan` (Opus) → `asking` (her inbox) → `build` (Sonnet) → [`preview` (the Mac finds the
URL and emails it) → `previewing` (her second word)] → `landing` (the Mac records what `gh pr
checks` says) → `land` (Haiku runs `~/bin/land` and the live curls) → `done`; `failed` is a NAMED
STOP she was emailed. The plan ALWAYS goes to her, even with zero questions — her reply
is the recorded approval, and a task with an unanswered ask cannot enter BUILD.

**Guards.** `validate:repo-lane` RUNS `canEnterBuild`/`canLand` over fixtures, pins that the claim
route calls them, that `checks_green_at` has exactly one writer (the `/checks` route on a green),
that `answerFromMail()` sits below `if (!authorised)` in the mailbox, that the lane's code carries no
`gh pr merge` / `gh workflow run` / `wrangler deploy`, that the Ahrefs fixer's "acquires no merge"
pin is untouched, that a quiet tick exits 7 with `NAMED STOP [NOTHING_CLAIMABLE]`, that every
`claude -p` carries `--max-turns`, and that no model id is typed outside `PHASE_MODELS`.
`validate:duty-delivery` walks the on-demand lane's chain (kind ↔ script ↔ installer ↔ runner ↔
route ↔ consumer). `tests/boss/repoChange.test.ts` runs the whole arc through the real handler and
routes, including Scooter's identical mail being refused with no row.

**Not a standing duty, on purpose.** It has work only when she sends some; a duty row would read
"overdue" every quiet week. Runs are recorded on the task and the row it claimed.

**Named stops the first real run can hit:** a grid repo with no `RUNBOOK.md` (add one); a repo
`~/bin/land` has no deploy route for (add the case to `~/bin/land`); a PR with no CI and no recorded
validator pass (no green to land on). Each is emailed with its tag.

### The spend lever, and the $0 rule

**Owner's standing instruction: "we always try to keep everything as close to $0 as possible."**
It is a design constraint, not a preference.

Every backend in `execution_backends` is seeded with `monthly_ceiling_micros = 0`, and **0 means
"free tiers only" — not unlimited, and not "nothing may run".** Work that costs literally nothing
still runs: Workers AI inside its included daily allowance (a binding, so no key, no egress, and no
credential that could leak) and OpenRouter models priced at zero.

The lever she chose, on 6 Sep 2026, has three positions:

| Position | Number | What happens at it |
|---|---|---|
| **Free only** — the default | $0 | only zero-cost routes are eligible |
| **Moderate** | **hers, changeable at any time** | work stops at the number |
| **Open** | none | nothing stops |

**The difference between Moderate at $1,000 and Open is not the amount — it is whether anything
stops.** I argued for bounding the top position; she decided against it, and that decision is
implemented faithfully rather than half-implemented. Three things make it a choice rather than an
accident, and none of them is a cap:

- **Open is reachable only by choosing it.** A missing row, an unparseable value or an unrecognised
  position resolves to **Free only**. The most permissive state is never a fallback.
- **Moving the lever is audited** — who, when, from what to what.
- **Spend still accrues and stays visible under Open.** Nothing checks it; she can still read it.

**Three spend controls already existed and were not merged into one, deliberately.** `budgets` is the
dollar authority per lane and period, with a hard stop. `cost_mode` — the six modes on the Settings
screen — governs which model *tiers* are eligible, which is quality, not money. A backend ceiling is
a **sub-cap within** the lane budget, never a second authority: the effective allowance is
`min(lane remaining, backend remaining)`. Two numbers that must agree with no link between them is
the defect pattern this repository is written against.

### Other deliberate limits

| | |
|---|---|
| **Trading cannot go live** | `PATCH /api/trading/authority {live_enabled:true}` returns **501**. There is no broker adapter in this repository. All six micro-live gates are tracked and unmet. Recording them is necessary and not sufficient — the refusal is deliberate, so live execution is never one config flag away |
| **Paper fills use a price you supply** | There is no market data feed. A simulator that invents a mark is a simulator that lies |
| **Offline means capture, not operation** | The addendum forbids promising mobile access during an outage. The app captures offline and flushes on reconnect. It does not run offline |
| **One passcode is the whole perimeter** | No second factor. Cloudflare Access is not in front of it (`access_client_id_configured: false`). A residual risk the owner holds knowingly |
| **`validate:value-shapes`** | Needs live production credentials and data. The database is nearly empty, so it has little to check |

---

## The chassis underneath

Boss OS was built by **cloning West Peek OS and porting the Boss OS v20 artifact into it** — the
owner's decision. That means this repo contains two applications:

| | Boss OS | West Peek chassis |
|---|---|---|
| Server | `src/worker/boss/` | `src/worker/services/`, `src/worker/index.ts` |
| Client | `src/client/boss/` | `src/client/pages/`, `src/client/App.tsx` |
| Migrations | `0152` onward | `0001`–`0151` |
| Tests | `tests/boss/` (workerd pool) | `tests/` (node pool) |

**Which app you see is decided by hostname**, in `src/client/main.tsx`:

```
const BOSS_HOSTS = new Set(["boss.sequoiataylor.com"]);
```

This exists because boss.sequoiataylor.com once served West Peek Ventures' entire fund interface —
one business's UI on another's domain. It is an allowlist rather than a pattern, because "does this
look like a Boss host" is a question with a wrong answer.

**The chassis is being removed, not kept.** Its 129 E2E journeys are the regression suite for that
removal and go when it does.

### Documents at the repo root belong to the chassis, not to Boss OS

`README.md`, `AGENTS.md`, `BACKLOG.md`, `REPO_VALIDATION_MATRIX.md`, `ARTIFACT_MANIFEST.md` and
`IMPLEMENTATION_LEDGER.md` are West Peek's, inherited by the clone. They use **P0–P25** numbering and
talk about LPs, dealflow and Managing Partners.

**Boss OS's own authority is `docs/boss/`.** It uses **Phase 0–23** numbering. If a document
mentions West Peek, it is not describing this product.

---

## How to work on it

```bash
npm install
npm run migrate:local        # apply migrations to the local D1 store
npm run dev                  # wrangler dev; open /boss
npm run validate             # typecheck + BOTH test suites
npm run e2e                  # Playwright, resets the local D1 first
```

The local passcode is `local-dev-passcode`, a fixture published in `wrangler.toml`. It is not the
real one and cannot reach production.

### The gate

`npm run validate` plus ten static validators, all of which run in CI:

`classification` · `lists-speak` · `css-classes` · `css-variables` · `brand` · `design-tokens` ·
`sql` · `authority` · `ai-boundary` · `network-boundary`

Each has its own self-test. A validator that cannot demonstrate it still catches what it exists to
catch does not belong in the gate.

**`npm test` runs both suites.** Until 6 Sep 2026 it ran only the chassis one: `vitest.config.ts`
excludes `tests/boss/**` because those suites need the workers pool, and no script or CI step ran the
other config — so 25 files and 461 tests covering approvals, the airlock, the router, sync, leakage
and the vault never ran in any gate, while `vitest.boss.config.ts` claimed they did.

### Deploying

```bash
npm run deploy:production
```

**This is the only thing that changes production.** It applies migrations, refuses to continue if any
are pending, builds, deploys, then probes the Worker. Bare `wrangler deploy` bundles the Worker but
does **not** run `vite build`, so it ships today's backend with whatever client was last built, and
reports success either way.

Cloudflare is not connected to this repository. Pushing is saving work, never deploying.

---

## The Free plan's 10 ms — the budget every request lives inside

**Boss OS runs on the Cloudflare Workers Free plan, by the owner's decision (13 September 2026:
"i'm not paying cloudflare"), and that plan allows 10 ms of CPU per request.** Cloudflare tolerates
a request that runs over now and then; a route that is over *consistently* gets terminated with
`outcome: exceededCpu` — which the browser shows as a 403 on Today and a blank Spirit. That is what
happened on 13 September when `/today` reached ~18 ms, and it is why the code is shaped the way it
is now. Storage and request counts are nowhere near their limits; CPU per request is the only one
that bites.

**What the measurements established** (production, Cloudflare's own `cpuTime` via `wrangler tail`):

- A D1 statement costs ~0.7 ms of CPU as its own await, ~0.4 ms inside `Promise.all`, and next to
  nothing inside one `db.batch` — 24 statements in a batch cost 1–2 ms. **The round trip is the
  cost, not the SQL.** `src/worker/boss/lib/batchReads.ts` exists for this and says so.
- `new Intl.DateTimeFormat` and `formatToParts` are tens of microseconds each on this runtime — not
  the nanoseconds a warm Node process shows — so anything that formats dates in a loop is CPU.
  `dateTimeFormat()` memoises formatters and `zoneOffsetMs()` caches the zone offset per
  quarter-hour; the duty calendar (`duties/cadence.ts`) is arithmetic now.
- The same request reads 2–3× higher on a slow or busy machine. Medians on a normal machine are
  what to compare, never one number.

**How Today and Spirit are served now:**

- **Today is seven requests, not one.** `GET /today?blocks=a,b` builds only those blocks;
  `TODAY_GROUPS` in `routes/today.ts` is the grouping, mirrored in `pages/Today.tsx` and pinned equal
  by `tests/boss/todayFitsTheBudget.test.ts`. The client fires all seven in parallel and stitches them
  in canon order. Nothing was cut: same thirteen blocks, same content. A screen must never call
  `/today` bare — that is the request that gets killed. The cron still builds all thirteen in one
  pass (cron invocations have their own budget).
- **The month's important dates are computed in the browser.** `/spirit/month` sends
  `highlights_inputs` (her birth data and the instant); `pages/Spirit.tsx` runs `monthAhead` from
  the same module and — for the first time — renders them.
- **Every route's plain reads go out as one batch per stage.** When you add a read to Today, Spirit,
  the alert producers or the pillars, put it in the stage's `batchReads` rather than awaiting it.

**How to check a route before shipping it:** `npx wrangler tail --env production --format json`
in one terminal, hit the route a few times through `npm run vault:run` with the passcode, and read
`cpuTime` and `outcome` off the events. Under ~8 ms median on a normal machine is the bar; the
groups sat at 3–8 ms on 13 September after the work above, from 18 ms killed.

## The maintenance cron — how it actually behaves

The Cloudflare cron fires **hourly** (`0 * * * *`) — 24 wake-ups a day. It was `*/15 * * * *`, the
West Peek chassis job runner's inherited cadence, which woke the Worker 96 times a day; the owner
asked for that to stop on 6 Sep 2026.

The only thing that needed a frequent tick was draining `boss_task_queue`, so submitting work felt
prompt. **A request that may have queued something now drains it itself**, after the response, via
`waitUntil` — so the tick is a safety net for work nothing was watching (a delayed retry, a task
enqueued mid-deploy) rather than the only thing that moves the queue.

Boss OS's maintenance is guarded inside `runScheduled`, independently of the trigger:

- **Daily**, at or after 03:00 UTC, once — which with an hourly tick is exactly 03:00: budgets roll, the day rolls, follow-ups surface, the
  almanac extends, the capability cadence runs, the sentinel runs, approvals expire, promotions sweep
- **Weekly**: the snapshot — and it is skipped even then if nothing of substance changed
- **After every snapshot**: retention prunes to the newest 12
- **Every tick, beside the duties**: the reaper (`backends/reap.ts`) fails a backend run a machine
  claimed and never reported once it has been silent for twice what it asked for — never under an
  hour. Before 16 September a run whose Mac closed its lid read `running` for ever.

**The jobs on her Mac are installed by `scripts/ops/install-agent-launchd.sh`, and editing the
installer installs nothing.** Three changes on 13 September (the grid job, the wrapped credential
check, the filing hunt) were never installed until the 16th, and Today said so. After changing the
installer, run it; it lints every plist and lists what launchd holds.

**Owner's instruction, 6 Sep 2026:** *"the cron job should be only 1x per week right now. i dont do
enough on this system to snapshot more than that."* The split honours that. Applying weekly to the
whole run would have broken two daily promises the product makes on screen — People says
"Commitments appear here the day they come due", and Settings shows a `$/day` ops budget.

The guard stays even though the trigger is now hourly: it is what makes the cadence a property of
Boss OS rather than of whatever cron expression happens to be configured.

**Before this was fixed**, `runScheduled` ran on every one of the 96 daily ticks. Production reached
**62 snapshots and 30.4 MB in R2 in under fifteen hours**, each larger than the last, on a database
holding 0 tasks, 0 approvals and 0 people — because `audit_log`, `system_events` and `cron_runs` are
all inside `SNAPSHOT_TABLES` and the run writes to all three.

---

## Known and accepted

- **The repository exists in one place.** No git remote, deliberately — commit `407a894`, "Point this
  clone at nothing, so it cannot reach West Peek." The consequence is that the D1 data is snapshotted
  and hash-verified while the source code has no second copy anywhere.
- **Boss's stylesheet has no token-scale validator.** `design-tokens.mjs` scans only
  `src/client/styles.css`. Boss's stylesheet uses raw px throughout by design; imposing the chassis's
  scale on a ported design would be a large cosmetic refactor with real regression risk, on a
  stylesheet whose sibling is being deleted. `brand`, `css-classes` and `css-variables` do cover it.
- **No ADRs were written for the Boss port.** ADRs stop at 019, all the chassis's.
