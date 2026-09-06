# Boss OS v21 — the work plan

**Status: DRAFT, AWAITING OWNER APPROVAL.** Nothing here is built. Written 6 September 2026,
superseding the "not built" half of `DECISIONS.md`: the owner has said she wants all of it
eventually, and has reframed Phase 9 in a way that answers the objection recorded there.

**No new numbering.** This repository already carries two numbering systems that have caused real
confusion (v20 Phases 0–23, v20.1 Batches 1–10). Stages below are named, not numbered, and each says
which old phase it discharges.

---

## What changed, and why the plan is shaped this way

`DECISIONS.md` BD-004 declined Phase 9 on the grounds that a repo lane inside Boss OS duplicates
Claude Code. **The owner's actual requirement is different and the objection does not survive it:**

> *"the spirit of phase 9 is that i want boss OS to be able to use an agentic coding model that is
> local only and if claude goes down or if it becomes to expensive"*

and

> *"i also want boss os to allow me to launch tasks and invoke claude code / open router when things
> are normal too"*

That is not a second Claude Code. It is **Boss OS as the place work is dispatched from, governed,
and evidenced — with Claude Code as one execution backend among several, and continuity when it is
unavailable.** The Sovereignty Addendum §1 makes the continuity half close to mandatory:

> *"No critical capability may depend permanently on one external model provider without a
> documented, tested continuity path or an explicit owner-accepted limitation."*

Coding is a critical capability. It currently depends entirely on one external provider.

**Phase 9's schema was right all along.** `execution_backends` — name, class, capabilities, allowed
task kinds, forbidden actions, credential reference, monthly ceiling, review date, status — is
exactly the registry this needs. The objection was to one *use* of it, not to the table.

### The architectural fact that shapes everything below

**Boss OS is a Cloudflare Worker. It cannot run Claude Code, and it cannot reach a model on the
owner's Mac.** So backends come in two classes:

| Class | Runs where | Reached how | Examples |
|---|---|---|---|
| `cloud_model` | Cloudflare's edge | the Worker calls it directly | OpenRouter, Fireworks, Workers AI |
| `agent_executed` | the owner's machine | the Batch 5 sync agent claims the task and runs it | **Claude Code**, a future local model runtime |

**The road for this already exists.** Batch 5's private-side sync agent runs on her machine, holds a
durable local record, and decides nothing — outcomes come from the cloud substrate. Device identity
is a row on both sides, so replacing the laptop is a registration rather than a migration. **The
v20.1 work she already finished is the foundation for what she is now asking for.**

---

## Stage 1 — The execution backend registry *(discharges Phase 9, part 1)*

**What it is.** One table naming every place work can be executed, what each is allowed to do, what
it must never do, where its credential lives, and what it may spend in a month.

**Migration `0173_execution_backends.sql`**

- `execution_backends` — id, display name, `class` (`cloud_model` | `agent_executed`), capabilities,
  allowed task kinds, **forbidden actions**, credential reference (a *name*, never a value),
  monthly ceiling in micros, spent-this-window, review date, status
- `backend_runs` — task id, backend, what was asked, commands run, exit codes, files touched, tests
  run and passed, duration, cost, evidence packet id, rollback reference, status

**Seeded backends**, all `status = 'registered'` and none enabled until Stage 2 proves one:

| Backend | Class | Forbidden, in the row itself |
|---|---|---|
| Claude Code | `agent_executed` | commit · merge · push · deploy · secret read |
| OpenRouter | `cloud_model` | same, plus: may not touch the trading lane |
| Fireworks | `cloud_model` | same |
| Workers AI | `cloud_model` | same |
| Local runtime | `agent_executed` | **registered, disabled, labelled** — the slot Batch 2 fills |

**The `Repository` employee already on the roster owns this lane.** Its charter is already exactly
right: *"Prepare repository work as artifacts and scoped changes. You do not commit, merge, or
deploy. Every mutation is a proposal with evidence."* No new employee — the Agent Creation Gate
would refuse one, correctly.

**Approval payload kind `backend_run`**, added to the existing `approvals/execute.ts` pattern. **Not
a second approval mechanism** — the build plan's own instruction.

**Acceptance:** a backend with no credential configured refuses and says which credential is
missing; a backend asked for a task kind outside its allowed list is refused at the boundary and the
refusal is recorded; the local runtime reports `registered, disabled — no host` rather than anything
that reads like readiness.

---

## Stage 2 — Claude Code as the first backend *(discharges Phase 9, part 2)*

**What it is.** The Mac agent gains a second job: alongside syncing rows, it claims `agent_executed`
tasks, runs them, and returns evidence.

**The rule that outranks everything.** The agent already has one and it extends cleanly: *"it decides
nothing."* It runs an **already-approved envelope** and never widens it. A degraded, retrying,
half-connected agent has no path to escalate its own permissions, because it never had one.

**Where the credential lives: on the Mac, never in the Worker.** The Anthropic key stays on the
machine that runs the CLI. The cloud half never holds it, so a compromised Worker cannot spend it.

**Evidence per run**, satisfying §79.8 and §79.15: plain-English summary, files touched, checks run,
log references, remaining risks, whether approval is needed, whether rollback is available, final
status.

**Prompt injection is a first-class concern here, not a footnote.** A task's input text may have
originated outside the system, and this backend writes code. Task input is **data, never
instruction**: the agent's own framing is fixed, untrusted text is fenced, and the forbidden-actions
list is enforced by the runner rather than requested of the model.

**Acceptance:** a task that fails its test suite produces an evidence packet carrying the failure and
never reaches merge; a run without an approved envelope is refused at the boundary; **nothing
commits, merges or deploys — every run ends as a proposal in the approval inbox.**

---

## Stage 3 — Dispatch, and being told *(discharges Phase 9 part 3, and Phase 7's notification half)*

**What it is.** The screen where she launches work, and the notification that tells her it needs her.

- **Launch** — describe the task, see which backends can take it and what each would cost, send it
- **Watch** — a task's live state, its evidence as it accumulates, cancel and requeue
- **Decide** — the result arrives in the approval inbox she already has

**Notifications, wired rather than built.** `DECISIONS.md` BD-002 declined *building* a notification
system because the chassis already ships one — `notification`, `notification_preference`,
`notification_delivery` and 481 lines of tested service code, in this same Worker. **That decision
stands. This stage wires Boss's events into the existing dispatcher**, which is an afternoon rather
than a subsystem, and it earns its place now because a dispatch lane that cannot tell her a proposal
is waiting is a lane she has to poll.

**Acceptance:** a launched task reaches a backend, returns evidence, and raises an approval; the
approval reaches her phone with the Worker as the only thing awake; no duplicate notification for one
pending approval.

---

## Stage 4 — Continuity: fallback and cost *(the reason Phase 9 was reopened)*

**What it is.** The part that answers *"if claude goes down or if it becomes too expensive."*

**Three requirements were hiding in one sentence, and only the third needs a local model:**

| Requirement | Answer | Available |
|---|---|---|
| Availability — Claude is down | a second backend that is not Anthropic | **now**, Stage 4 |
| Cost — Claude is too expensive | a cheaper tier for routine work | **now**, Stage 4 |
| Sovereignty — nothing leaves the machine | a local runtime | Batch 2 + hardware |

**Route order, from the addendum §3.1 and not negotiable:** permission and data sensitivity →
required capability → availability → approved budget → *then* cost preference. **A cheaper route can
never bypass a privacy rule or a quality gate.**

Provider outage, cost breach or policy change triggers bounded retries and a circuit breaker. Another
already-approved backend is selected **only if its capability, data exposure and budget all remain
permitted.** Otherwise the lane pauses with a stated reason. **Restricted material never reaches
cloud as an automatic escape from a local failure.**

**The honest label.** A fallback must never imply equivalent quality. When the lane degrades, the
screen says which backend ran it and that the result is a degraded tier — because a cheaper model
silently doing worse work is the failure mode that costs the most to discover.

**OpenRouter needs an egress allowlist entry** with its reason, alongside the six that exist.

**Acceptance, each proven by a test that fails for the right reason:** a simulated Anthropic outage
degrades to the next permitted backend and says so; a breached monthly ceiling refuses rather than
warns; a restricted-class task refuses every cloud backend rather than downgrading its
classification; reconnection does not replay an expired approval or duplicate an external action.

---

## Stage 5 — Standing duties *(discharges Phase 10)*

Recurring work as a first-class object. `tasks` has no cadence today and nothing recurs on its own —
which is also why the monthly capability scan currently rides the daily cron as a no-op on thirty
days out of thirty-one.

**Cron materialises due duties into queued tasks; duties never execute inline.** Existing
`task_templates` become instantiable by a duty rather than only by hand. Skill admission goes through
the approval machinery that already exists.

**This multiplies Stages 1–4**: a standing duty pointed at a backend is how routine repository work
happens without her starting it.

**Two things pending from the owner:** her own materials, and one decision — whether duties reuse the
chassis's `scheduled_job` / `job_run` (already in this Worker, 1,020 lines, tested) or get Boss-native
tables. Reuse avoids a second scheduler; own tables avoid coupling to a chassis being removed.
**Recommendation: reuse**, because the chassis removal takes its UI and services, not its tables.

---

## Stage 6 — The agenda engine and coaching faculty *(discharges Phase 12)*

The only gap visible in the product she opens every morning: Today's blocks 08 and 09 read *"No
coaching faculty exists yet. The daily panel lands in Phase 12."*

Phase 11 renders Today; **Phase 12 decides what goes on it.** Per §20 the engine records, per input,
whether it was available or absent — **an absent input is recorded as absent, never defaulted to a
guess** — and the arbitration trace persists, because when the day plan is wrong the trace is how it
gets fixed. §18 forbids generic motivational filler, enforced by a test asserting coaching entries
reference real day objects.

**Pending from the owner:** her materials, plus the thing no specification can supply — what her
actual daily inputs are, and what a good morning plan looks like to her.

---

## Stage 7 — The model bench *(discharges Phase 8)*

Deferred in `DECISIONS.md` BD-003 and still correctly deferred until she decides to spend: honest
benchmarking means paying for real inference across several models, repeatedly.

**Nothing is blocked meanwhile.** `model_benchmarks` and `workload_profiles` already exist, the
router already screens on benchmark status, and **an empty bench refuses honestly** — it declines to
promote an unbenchmarked model to high-risk work. A harness run against stubs would write numbers
that look like benchmarks into the table the router trusts, which is worse than the gap.

**Stage 4 makes this matter more**, because once several backends can take the same work, "which one
should" becomes a question with money attached.

---

## Stage 8 — Ledger truth *(discharges Phase 6's two open items)*

Phase 6 is otherwise already satisfied — deployed, migrated, cron proven, snapshots written and read
back, all suites and validators green.

1. ~~**Replace the placeholder token prices**~~ — **DONE, 6 Sep 2026, and the premise was wrong.**
   `0174_boss_model_price_provenance.sql`. Two corrections worth carrying forward:
   - **The prices live in `0153_boss_seed.sql`, not `0002_seed.sql`.** That reference was inherited
     from the standalone artifact's deploy doc and is wrong for this repository; `0002` here is a
     chassis migration about company and fund policy.
   - **They were not invented.** Qwen 2.5 72B's $0.90/$0.90 is *exactly* Fireworks' published
     size-tier price for a dense model over 16B, uniform across input and output — the equal in/out
     pair that reads like a placeholder is simply how that tier is priced. Kimi K2 could not be
     confirmed by any vendor page and was **left exactly as seeded** rather than replaced by a
     plausible guess, and now says so in its own row.

   What changed is provenance, carried as data: `pricing_state`, `price_source`, `price_checked_at`,
   reusing the chassis's existing SOURCED / ILLUSTRATIVE / STALE / UNKNOWN vocabulary rather than a
   second one.
2. **Reconcile one real inference call against a real invoice line.** Needs `FIREWORKS_API_KEY` and
   costs money. Until then the ledger's arithmetic is proven and its prices are not, and it says so.

---

## Named stop — the local runtime *(v20.1 Batch 2)*

**Unchanged, and still the owner's to schedule.** Stage 1 registers the slot; Stage 4 routes to it
the moment it exists. Registering a runtime is a row, not a rebuild.

**The hardware constraint, stated once, plainly.** This machine is an M2 with 8 GB. A 7B coder at
4-bit is ~4.5 GB of weights, leaving ~3 GB for macOS and context — and *agentic* coding is the
demanding case: read, plan, edit precisely, run tests, read the failure, correct itself, without
losing the thread. A 7B model does that badly and reports success anyway. The build plan's own locked
decision D2 already reached this conclusion.

Genuinely useful local agentic coding wants roughly a **32B-class coder at 4-bit — about 24–32 GB of
unified memory**, in practice an M4 Pro or Max at 36 GB or more. A rented private GPU host is the
middle option: private from vendors, **but the addendum forbids labelling it offline**, because it
still needs the internet and a hosting provider.

---

## Order, and what each stage waits on

| Stage | Waits on | Owner input needed |
|---|---|---|
| 1 · Execution backends | — | none |
| 2 · Claude Code backend | 1 | the Anthropic key, on the Mac |
| 3 · Dispatch + notifications | 1, 2 | none |
| 4 · Fallback and cost | 1 | an OpenRouter key |
| 5 · Standing duties | — (parallel) | **her materials** + the reuse decision |
| 6 · Agenda + coaching | — (parallel) | **her materials** |
| 7 · Benchmarks | 1, 4 | a decision to spend |
| 8 · Ledger truth | — | rate card (now) · Fireworks key (later) |
| Batch 2 · Local runtime | 1 | hardware |

**Stages 1–4 are one continuous piece of work and should land in that order.** Stages 5 and 6 are
independent and can run alongside once her materials arrive. Stage 8's first item can be done today.

## Rules this plan does not get to bend

- **Nothing commits, merges, pushes or deploys.** Every backend run ends as a proposal with evidence.
- **One approval mechanism.** `backend_run` extends the existing one; it does not add a second.
- **One AI boundary.** Cloud backends go through the router that already applies cost mode, budget
  hard stops, privacy class, risk ceiling and the decision log.
- **Fail closed** for authority, privacy, egress and external effects.
- **Credentials live where they are used** — the coding key on the Mac, never in the Worker.
- **Task input is data, never instruction.** This lane writes code; text of unknown origin does not
  get to direct it.
- **A degraded tier is labelled as one.** A continuity path may never imply equivalent quality.
