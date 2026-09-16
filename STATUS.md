# Boss OS — what this is, plainly

**Read this first.** It exists because two sessions in a row got confused about what this repo is,
what version it is, and whether it was finished. Everything here is written to be read cold, by
someone — or something — with no memory of the conversation that produced it.

Last verified against the code and against production: **16 September 2026.**

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

**06:30 America/Chicago, daily** — half an hour before the owner looks, because research takes
minutes and she asked for the report to BE there at seven.

**A wall-clock time and a zone, never a UTC hour.** `0 12 * * *` is correct in September and an hour
early from November; nobody files a bug for that, the report is just quietly stale for five months a
year. Duty materialisation runs on EVERY hourly tick rather than inside the 03:00 UTC maintenance
block — that block fires at 21:00 the previous evening in Chicago, so a 06:30 CT duty checked there
would arrive a full day late.

**Nothing runs until two deliberate acts:** commission the `bk_claude_code` backend, and run the Mac
agent so it can claim the task. Until then the duty fires, the task queues, and Today's block says so
plainly.

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
