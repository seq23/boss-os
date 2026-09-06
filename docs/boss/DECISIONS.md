# Boss OS — decisions about what NOT to build

Boss OS v20's build plan covers Phases 6 through 23. Six of them — 6, 7, 8, 9, 10 and 12 — were
never in the artifact that was ported into this repository. This file records what the owner decided
about each, and why, so that nobody re-derives the question from the build plan and starts building
something she has already declined.

**A decision not to build is a finished decision.** None of the entries below is an open item, a
backlog entry, or a gap. Do not report them as one.

Decided 6 September 2026.

---

## BD-001 · Phase 6 — Validation and deployment proof · **NOT A BUILD TASK**

Phase 6 is a checklist, not a feature: compile, test, apply migrations to real remote D1, prove the
bindings live, make one real inference call and reconcile it against the provider's invoice, and
replace the placeholder token prices from the seed.

**It is substantially already satisfied**, verified against production on 6 Sep 2026:

| Phase 6 asks for | State |
|---|---|
| `npm run validate` exits 0 | Typecheck clean, 1,731 + 487 tests, ten validators pass |
| Migrations applied to real remote D1 | Production schema is `0171_boss_merge_policy`, matching HEAD |
| A cron firing and writing `cron_runs` | 60 runs recorded, all `complete` |
| An R2 snapshot written and re-read | Written, hash-verified, and a restore drill passed |
| Every binding proven live | D1, R2, KV and ASSETS all reachable from `/api/health` |

**Two items remain, and both are the owner's, not an engineer's:**

1. **One real Fireworks inference reconciled against a real invoice line.** Needs
   `FIREWORKS_API_KEY` and costs money. Until then the model ledger's arithmetic is proven and its
   *prices* are not.
2. **The placeholder token prices in `0002_seed.sql`** — carried into this repo — must be replaced
   with the current rate card, via a new migration. The ledger is only as honest as those numbers,
   and correcting them is a fact-checking task against a provider's public pricing, not a build.

**These are NAMED STOPS.** The cost ledger reports what it computed from the prices it was given; it
does not claim those prices are current.

---

## BD-002 · Phase 7 — Notifications, mobile surface, cost guardrails · **HALF BUILT, HALF DECLINED**

Phase 7 bundles two unrelated things.

### The notification half — declined

The spec asks for `push_subscriptions`, `notification_channels`, `notifications` and a dispatcher.

**This repository already contains a working, tested one.** The West Peek chassis ships `notification`,
`notification_preference` and `notification_delivery` tables and 481 lines of service code, in the
same Worker, against the same D1. Building a second set would be the "two components each keeping
their own list, with no link between them" pattern — the exact defect class the owner's working
rules name, and which the build plan's own Part 2 warns against: *"Do not rebuild any of this.
Extend it."*

It is also a thin benefit for a single-user system whose owner opens the app herself.

**If notifications are ever wanted, the work is to wire Boss's events to the existing dispatcher —
not to build a parallel one.**

### The screens half — built

*"About a third of the existing API has no screen"* is real, and understated. Measured on 6 Sep 2026:
**104 of 237 methods in `src/client/boss/api.ts` are not called by any page or component.** Backends
that work and cannot be reached are indistinguishable from backends that do not work.

Built as drill-downs rather than new primary tabs, per canon §5's Cognitive Load Budget, and guarded
by a **ratcheted** validator: the orphan count may only fall. A single pass cannot honestly produce
a hundred screens worth having, and a validator demanding zero would be deleted the first week.

---

## BD-003 · Phase 8 — Model runtime completion · **DEFERRED, AND NOT BLOCKING**

The spec asks for `benchmark_tasks`, `benchmark_runs` and `model_promotions`, and for a harness that
runs a golden task set across registered models and records real results — explicitly *"Not a
simulation."*

**Nothing is blocked by its absence.** The substrate already exists: `model_benchmarks` and
`workload_profiles` shipped in Phase 1.5, the router already screens on benchmark status, and
`/api/models/benchmarks` already reads the table.

**What is missing is honest evidence to put in it, and that costs money.** Benchmarking means paying
for real inference across Workers AI, Fireworks and a frontier model, repeatedly. That is a spending
decision the owner makes when she actually cares which model runs which workload — not a decision an
implementation should make on her behalf by starting to spend.

**The failure mode this avoids is worse than the gap.** A harness run against stubs would write
numbers that look like benchmarks into the table the router trusts. An empty bench refuses honestly;
a fabricated one routes work on fiction.

---

## BD-004 · Phase 9 — Execution backends and the repo lane · **DECLINED. DO NOT BUILD.**

The spec asks for `execution_backends`, `repo_targets` and `repo_runs` — a lane in which Boss OS
writes code, opens pull requests, runs test suites through GitHub Actions, and returns evidence
packets.

**Declined for four reasons, in order of weight:**

1. **It already exists, and it is better.** The owner has Claude Code. A repo lane inside Boss OS
   would be a weaker second implementation of the thing she already uses to work on this very
   repository — including to write this file.
2. **Two components each keeping their own list.** A second place that tracks repository state, test
   results and merge readiness, with no link to the first, is the defect pattern the owner's working
   rules single out.
3. **It needs credentials and spend that buy nothing new** — GitHub Actions minutes and an Anthropic
   API key, to reproduce capability already on the machine.
4. **Its own spec forbids the obvious first use.** §1.4's hardcoded rules say the first repo target
   may not be Boss OS itself, so the feature could not be pointed at the repository that motivated
   it without violating its own design.

**If this is ever revisited**, the honest shape is an *integration* — Boss OS records and approves
work that Claude Code performs — not an execution backend of its own.

---

## BD-005 · Phases 10 and 12 · **WANTED. SCOPE PENDING FROM THE OWNER.**

- **Phase 10** — assignments, standing duties, skill packs. Recurring work as a first-class object.
  `tasks` has no cadence today, and nothing recurs on its own.
- **Phase 12** — the agenda engine and coaching faculty. This is the one with a hole visible in the
  product: Today's blocks 08 and 09 read *"No coaching faculty exists yet. The daily panel lands in
  Phase 12."*

**The owner has her own materials for both and knows what she wants.** Do not build either from the
build plan alone — ask her.

One thing to settle when scoping Phase 10: the chassis already ships `scheduled_job` / `job_run` and
1,020 lines of service code in this same Worker. Reusing that substrate avoids a second scheduler,
but couples Boss to a chassis that is being removed. That trade is the owner's call. (Removing the
chassis means removing its *UI and services*, not necessarily its tables — which is why reuse is
arguable rather than obviously wrong.)
