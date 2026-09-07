# Boss OS v20

> **Running it day to day: [`OPERATIONS.md`](OPERATIONS.md).** Who owns what, what runs
> when, what it costs, where your data lives, and what is deliberately not built.
> The plan it was built against, and what actually landed, is [`PLAN_v21.md`](PLAN_v21.md).

A private, single-user executive OS that installs to your phone's home screen.
No app store, no second user, no shared state between lanes.

The principle the whole thing is built around: **the system holds complexity,
the human executes.** Boss OS proposes; you approve; approved things actually
happen; everything that happened leaves evidence.

## The command loop

1. Work enters through **task intake** and is classified — kind, risk,
   sensitivity, and an execution assignment.
2. Intake picks the **existing** employee, template, or duty that fits. It does
   not invent a new employee when one already covers the ground.
3. A **permission envelope** is written for that one run: cost mode, budget
   ceiling, and a set of outward capabilities that all default to denied.
4. The **model router** decides where it runs, honouring lane, privacy class,
   benchmark status, risk ceiling, cost mode, and budget. Every decision is
   logged, including the refusals.
5. Work executes **in a queue consumer**, never in an HTTP handler.
6. Anything sensitive or irreversible lands in the **Approval Inbox** with an
   evidence packet attached.
7. Approving **executes the origin action**. Rejecting **terminates** it. Neither
   leaves the origin orphaned.
8. Durable knowledge only moves tier through the **memory promotion gate**.
9. The **continuity vault** snapshots every table to R2, and the restore path is
   real and drillable.
10. Trading is a **separately governed lane** with no live authority.

## What is in this build

| Subsystem | State |
|---|---|
| Today | The default screen: canon's thirteen elements assembled from live subsystem state, Morning Gate, Midday Reset and Night Gate, open loops that carry forward, and a tomorrow seed that lands on tomorrow's screen |
| Approval inbox | Decisions execute their payload; symmetric rejection; truthful expiry sweep; full docket with event trail, evidence, and a decision note |
| Task intake | Deterministic classifier, 16 canonical kinds, execution assignments, permission envelopes, template library |
| AI employees | Lifecycle states, departments, per-employee daily budgets, performance reviews, merge/retire, sprawl report |
| Agent Creation Gate | Need assessment required; No Agent Sprawl blocks proposals an existing employee could carry |
| Model router | Cost-mode tiers, privacy class, risk ceilings, benchmark gating, per-lane and per-employee hard stops, bounded fallback, full decision log |
| Model registry | Workload placement matrix, benchmark bench, local-model default gate |
| Relationship capital | People, organizations and one scored tie each — strategic importance, trust, recency, opportunity value and a derived relationship health with its arithmetic kept; meetings with a brief before and a capture after; commitments that surface onto Today the day they come due |
| Investor OS | Deal pipeline with Deal Energy Protection — one deal may hold focus and a thin pipeline behind it is reported as a risk; theses, LPs and a probability-weighted opportunity pipeline; a Decision Journal that will not commit a decision the red team has never seen, and a Prediction Vault whose resolutions move a real Brier calibration score |
| Wealth Command Center | Entities, vehicles carried with the date they were marked, tracks whose targets divide one book, allocations traceable to the decision that authorised them, and trading capital read across the lane boundary read-only |
| Memory | Capture-only entry, promotion rules, approval-gated tier changes, archive path, retirement that hides without deleting, promotion history |
| AI Quant Fund | The Capital Deployment Ladder with no skipping, promotion scorecards that carry evidence, a scale ladder where no rung opens without an approval and a proven kill switch, a kill-switch proof that requires an acknowledgement from a running engine rather than a local flag, the risk constitution recording which nevers are enforced in code and which are only procedural, and a validation status that refuses to round anything up |
| Firm OS bridge | One narrow, audited crossing between the personal system and the firm: a hardcoded forbidden list that refuses twelve categories in both directions, an allowlist that falls closed on anything unrecognised, references and summaries rather than objects, classification overriding category for memory, every refusal recorded with its reason, and every allowed crossing approved in this system's own inbox |
| Runtimes | Document Compiler Mode — assembles a document from named live sources and supplied text into a hashed R2 artifact with a per-section manifest, recording any source that had nothing to say as absent — and an SEO/GEO runtime that returns per-check evidence and answerability probes, never a ranking claim, with everything needing a network reported as deferred; both run as classified tasks with envelopes and evidence packets |
| Operating governance | Decision rights the approvals layer consults before a decision is recorded; an emotional-state classification that holds the protected actions — orders, envelope changes, decision commitments, capital allocations, restricted exports — and says so kindly, on the record; a Compliance Sentinel over eleven watch items tied to real tables; an anti-dependency check that asks what would survive this system; failure playbooks that surface when their condition is true; and a mode card assembled from live state |
| Capability Intelligence | A Capability Package per mechanism this build actually has, one active default per job type enforced by the primary key, alternatives benched and never falling back into runtime, trigger-based search that refuses tool-chasing, after-action review over real task traces, and core capabilities that cannot be patched without an approved review |
| Prompt Intelligence | A bench of eighteen mastery lenses, each a method with an origin discipline and a lens that argues with it — never a person's name; a compiler that turns a rough request into a packet with a lens stack, a counter-lens, points of view, an output contract and a structural score; canon's eleven trigger categories escalating to the full treatment whatever tier was asked for; and a library nothing enters without review in the approval inbox |
| Spirit OS | Moon phase, illumination and sign computed in TypeScript with no network call and a stated method; a rolling twenty-four-month almanac; manifestations that close on what was done and what happened, never on signs; contribution and ancestor practice in canon's tone — one a month, no streaks, no guilt; and everything needing a real ephemeris reported as deferred rather than estimated |
| Knowledge OS | Canon's twelve surfaces typed over the memory substrate — no parallel store, and the Decision and Prediction Vaults read Phase 14 rather than copying it; a Personal Operating Manual generated from promoted memory and versioned by content hash; portable export with a SHA manifest that verifies, and restricted knowledge that only leaves on an explicit allowlist |
| Continuity vault | Snapshot, verify, download, restore (verify / merge / replace), restore drill |
| Emergency Sovereignty Package | One portable file carrying the operating manual, the offline library, the approved prompts and the recovery documents, each hashed; a disaster recovery runbook, restore checklist and initialization prompt that travel inside it; and an offline drill that verifies every hash and walks the checklist from the package alone — proven with the network stubbed to throw |
| Trading lane | Strategy registry with stage gates, paper broker, real fills and position maths, authority envelope, kill switch, incident ledger, CSV ledger export |
| Hardening | Structured diagnostics, deep health check, cost dashboard, dead-letter triage, per-step cron records, budget window rolling |

## Architecture

- **Cloudflare Workers** — one Worker serves the API and the built SPA
- **D1** — SQLite. All state. Money stored as integer USD micros
- **R2** — the continuity vault: full JSON snapshots of every table
- **KV** — sessions only
- **Queues** — employee tasks run here, never inside a request handler; a
  dead-letter consumer triages what gives up
- **Cron** — 03:00 UTC nightly: roll budgets, roll the day, surface follow-ups
  that have come due, extend the computed almanac, expire approvals, sweep
  promotions, snapshot
- **Hono** on the server, **React + Vite** on the client, no ORM

## Lane isolation

Trading has its own tables, its own budget rows, its own authority envelope, and
its own approval path. No query joins across lanes, and employees cannot be
merged across them. The Wealth Command Center reads trading capital through the
Trading Allocation Bridge — every statement in it a SELECT — and refuses to hold
that capital as a vehicle or move it as an allocation. The coloured rail down the left edge is brass in Operations
and teal in Trading, so you always know which book you are looking at.

## Trading: what this build will and will not do

It **will** run the whole paper lifecycle: register a strategy, draft an order,
approve it, fill it, move the position and the cash, realise P&L on close,
cancel on rejection or expiry, and export the fills as CSV.

The quant fund's ladder, gates, scorecards and kill-switch proof are all here,
and `GET /api/quant/validation` reports what is proven and what is not. The
kill-switch round trip is exercised against a stubbed transport; no server,
exchange account or key exists in this build, so the proof against a real engine
stays open and the status says so.

It **will not** trade live. There is no live broker adapter in this repository.
The authority envelope tracks all six micro-live gates, and even with every gate
recorded, enabling live execution returns `501` — because the code that would
place a real order does not exist. That is deliberate: shipping it would put
real-money execution one config flag away.

Paper fills use a reference price **you** supply. Boss OS has no market data
feed, and a simulator that invents a mark is a simulator that lies.

## Cost governor

Six modes, from `SHUTDOWN_MANUAL` (nothing spends) to `FRONTIER_BURST`. The mode
decides which model capability tiers are eligible, how many fallback hops a run
may take, and what share of the remaining lane budget one task may consume.
Budgets are hard stops, not warnings, and their windows roll on UTC calendar
boundaries.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # then set BOSS_PASSCODE
npm run db:local
npm run seed:local
npm run dev
```

## Validation

```bash
npm run validate     # typecheck, then tests, then build
```

Tests run inside `workerd` against real D1, R2, and KV — the same runtime the
Worker deploys to — with the actual migration files applied. They cover approval
execution and rejection symmetry, expiry, intake classification and envelopes,
the No Agent Sprawl gate, router policy and budget stops, queue execution and
evidence, memory promotion and retirement, vault restore and drill, the trading
paper lifecycle, the authority envelope, dead-letter triage, and every later
phase's acceptance sentence — the meeting brief and capture, the decision and
prediction pair with its calibration, the Manual and the restricted-class
allowlist, the computed sky and the anti-delusion rules, the lens bench and its
library gate, capability defaults and core-patch approval, the emotional-state
gate and the compliance sentinel, both runtimes, the firm boundary in both
directions, the quant ladder and kill-switch proof, and the offline sovereignty
drill.

Two of them are worth knowing about: a populated database with every table from
every phase is snapshotted and replaced from the snapshot, and every row comes
back; and the sovereignty drill runs with the network stubbed to throw, so
"works offline" is proven rather than asserted.

See `DEPLOY.md` for going live and for the operator runbook.
