# BOSS OS v20 — BUILD PLAN v2 (CONSOLIDATED)

**For:** Claude Code
**Supersedes:** `BOSS_OS_v20_REMAINING_IMPLEMENTATION_PLAN.md`, `ADDENDUM_A_BLOCKING_DECISIONS`, `ADDENDUM_B_COST_POLICY`. Use this file only; the earlier three are historical.
**Baseline:** `boss-os-v20_FULL_SNAPSHOT_20260810T132958Z_e4e5908ff92f.zip` (root `boss-os`, 78 files, sha256 `84d0b68c…`)
**Authority:** `Boss_OS_v20_Unified_Canonical_Master_Plan.md`, `Boss_OS_v20_Implementation_Roadmap.md`, `Boss_OS_AI_Quant_Fund_Master_Plan_v5.md`
**Covers:** Phases 6 → 23 — everything in canon not yet implemented.
**Decision status:** all six previously-open decisions are LOCKED. Nothing in this plan waits on a human answer.

---

# PART 0 — HOW TO USE THIS

## 0.1 Authority order

```
Canon defines the system.
This plan sequences the build and fixes the vendors.
If this plan conflicts with canon, canon wins.
If canon is silent on build order or vendor choice, this plan governs.
```

## 0.2 Do not invent schema

Every phase names the canon sections defining its entities. Read them before writing a migration. Where canon lists fields, use canon's fields and canon's names. Where canon is silent, say so in the phase ledger rather than guessing.

## 0.3 Build law — carried from the baseline, unchanged

- Single user. No multi-tenancy, no org model.
- Cloudflare only: Workers + D1 + R2 + KV + Queues. Hono API and React/Vite SPA in one Worker.
- Raw SQL migrations, no ORM. New migrations start at `0005_`, one per phase. Never edit a shipped migration.
- Money is integer USD micros. Timestamps are epoch milliseconds.
- Trading lane stays isolated from the ops lane.
- Employee work happens only in the Queue consumer, never inline in a request.
- No stubs, no TODOs, no demo credentials, no pseudo-code. If a layer cannot be proven, label it unproven — never fake it.
- Behaviour is proven with integration tests against real D1, not by the existence of a route.

## 0.4 Cost law — new

```
Prefer $0 with usage-based overage over any fixed monthly fee.
Prefer no vendor over a cheap vendor.
Every vendor is metered inside Boss OS, not only on the vendor's dashboard.
Every vendor's own spending limit is set to a hard stop, not a warning.
A new vendor with a seat fee, an annual commitment, or a monthly minimum
requires an approval card before it enters the system.
```

## 0.5 Required output per phase

A full baseline snapshot ZIP packaged from the `boss-os` root, plus a ledger:

```
Implemented in this ZIP
Not implemented in this ZIP
Remaining phases
Next artifact
Validation status
```

Run `npm run validate` (typecheck + vitest + build) locally before packaging. Never report a phase complete on structural checks alone.

## 0.6 Nothing is blocked

The six decisions that previously gated Phases 7, 8, 9, 15, 16, and 22 are resolved in Part 1. Every vendor, credential shape, and fallback is fixed. Where a human must click something, it is listed in Part 4 and none of it blocks the start of a phase — Claude Code builds the mechanism, the human supplies the secret when the phase is ready to run.

---

# PART 1 — LOCKED DECISIONS AND COST POSTURE

## 1.1 The whole bill

| Line | Cost | When |
|---|---|---|
| Cloudflare Workers Paid | **$5/mo** | Now — the only fixed fee in the system |
| D1, R2, KV, Queues, Cron | $0 at single-user volume | Now |
| GitHub Free | $0 — 2,000 Actions minutes/mo on private repos | Phase 9 |
| Anthropic API (repo lane) | pay-as-you-go, tokens only | Phase 9 |
| Fireworks (employee inference) | pay-as-you-go, per token | Now |
| Workers AI (candidate cheap tier) | free daily allowance on the same account | Phase 8 |
| Notifications | **$0** | Phase 7 |
| Astrology | **$0 — no vendor at all** | Phase 16 |
| Trading server (Hetzner CX22) | ~€4.50/mo | **Only from Phase 22** |

**Committed today: $5/month plus metered inference.** Everything else is free at this volume or deferred to a phase that may never arrive.

Verified 2026-08-10. Re-verify at the start of each phase — pricing is the fastest-decaying content here.

---

## 1.2 D1 — NOTIFICATIONS · LOCKED

**Web Push as primary. Telegram bot as the critical-alert fallback. $0 total.**

### Why a fallback exists

Web Push on iOS has silent failure modes: subscriptions expire, and iOS can evict a PWA's stored data after disuse. For a routine approval, a lost notification costs an hour. For a kill-switch event, it costs more. Critical alerts get a second, independent path.

Telegram beats email here: no per-message cost, no account tier, no domain verification, no sender reputation. One bot token, one HTTPS call.

### Platform constraints — properties, not preferences

1. iOS Web Push works **only for a PWA installed to the Home Screen**. An open Safari tab has no `PushManager`, and every iOS browser uses WebKit, so this cannot be routed around.
2. Requires iOS 16.4+.
3. The permission prompt must fire from a **user gesture**, never on load.
4. Detect standalone mode before prompting: if `window.matchMedia('(display-mode: standalone)').matches` is false on iOS, show Add-to-Home-Screen instructions instead of a prompt that silently no-ops.
5. **Do not use the `web-push` npm package** — it needs Node `crypto`/`https` and fails on Workers with `crypto.createECDH is not a function`. Use a WebCrypto-based Web Push library that explicitly supports Cloudflare Workers, or implement RFC 8291 directly against Workers WebCrypto. Verify the choice actually runs in the Worker before building on it.
6. On 404/410 from the push service, delete the dead subscription and raise a `notification_channel_dead` event.

### Privacy constraint on the fallback

Telegram is a third party receiving alert text. **Fallback bodies carry a pointer only** — "Approval pending — open Boss OS", "Kill switch engaged". Never an amount, counterparty, symbol, person's name, or decision content. A test must assert the fallback formatter cannot include a payload field. Web Push bodies may carry more, being a direct Worker-to-device path.

### Critical vs routine

Critical (both channels): kill switch engaged, trading incident opened, budget exhausted, cron step failure, dead letter arriving, approval expiring in the final warning window.
Routine (push only): everything else.

---

## 1.3 D2 — LOCAL MODEL · LOCKED

**No local model. The cheap tier is Workers AI, benchmarked not assumed. True sovereign inference is deferred to the Phase 22 server.**

### Why not the laptop

Canon §79.2 is the laptop-closed operating law: routine execution must not require your laptop awake. A model on a Mac satisfies §75's privacy goal and breaks §79.2's availability goal simultaneously. It would produce a subsystem that works only when the constraint the architecture rejects happens to hold.

### What replaces it now

Cloudflare Workers AI runs on the account you already pay $5 for, with a free daily allowance on selected models. Phase 8 benchmarks it as a candidate against the golden task set. If it handles the routine end of the sixteen intake kinds — classification, summarisation, template filling — the routing shape becomes **Workers AI → Fireworks → frontier on escalation**, materially cheaper than the current design. If it fails the bench, it is not used. The evidence decides, not this document.

### What is honestly deferred

Canon §106 requires *at least one local model registered*. Workers AI is cloud inference on the same platform — cheaper and same-vendor, but not sovereign. Record §106's local criterion as `DEFERRED — HOST PENDING PHASE 22`, dated, with the Hetzner box named as the future host. **Do not mark it met.**

### Interim rule for restricted content

Until a sovereign host exists, restricted-class content reaches no cloud model without an approved routing card — which the existing router already enforces. That enforcement stays. Phase 8 must not weaken the privacy screen to compensate for the absent local tier.

Build the local adapter **interface** and leave it unimplemented and labelled, so the Phase 22 server drops into a defined slot instead of forcing a refactor.

---

## 1.4 D3 — REPO WORKER · LOCKED

**GitHub Actions is the execution substrate. `anthropics/claude-code-action` is the first worker. Repository targets are runtime data, not build-time configuration.**

### Why the repository list no longer blocks anything

Phase 9 ships with an empty `repo_targets` table and a Settings screen where a repository is added by pasting its URL. Claude Code does not need to know which repos exist in order to build the lane. Two rules are hardcoded:

- **The first target added must not be the Boss OS repository.** The lane proves itself somewhere lower-stakes first.
- **Boss OS is permanently a protected target** under canon §79.9: separate branch, governance impact classification, diff summary, validation report, rollback instructions, explicit owner approval before merge. The Action may open a PR against it and may never merge it. It becomes addable only after the lane has completed one successful run against a different repository.

### Flow — no shortcuts

```
mobile task intake
→ permission envelope
→ approval for repo_write
→ Worker dispatches a GitHub workflow (workflow_dispatch)
→ Action runs Claude Code in GitHub's runner
→ branch + commits + PR + test run
→ Action posts evidence to a Boss OS webhook
→ evidence packet in the approval inbox
→ human approves merge from the phone
→ Worker calls the merge API
```

Merge is never performed by the Action. This keeps §79.7's final gate where canon puts it.

### Credential scope — implement exactly this

| Credential | Lives in | Scope |
|---|---|---|
| GitHub fine-grained token | Worker secret | Named repositories only. `contents: write`, `pull_requests: write`, `actions: write`. **No** admin, **no** org-wide, **no** delete. |
| Anthropic API key | GitHub repository secret | Never in the Worker, never in D1, never in an evidence packet. |
| Webhook signing secret | Worker secret + GitHub secret | Evidence callbacks are signature-verified; unsigned callbacks are discarded and logged. |

Fork-originated events never receive secrets. Record the security tax honestly in the `execution_backends` row per canon §33: what this backend can reach, what it can never reach, what happens if its token leaks.

### Cost controls — mandatory

1. **GitHub spending limit set to $0.** Private-repo workflows stop when the 2,000 monthly minutes are exhausted rather than billing. Treat a blocked run as a normal failure path with a notification, not an incident.
2. **Meter minutes inside Boss OS.** `repo_runs.runner_minutes`, surfaced on the cost dashboard against the 2,000 allowance, notify at 70%.
3. **Model tier follows cost mode.** The Action's model is passed per invocation — route it through the existing cost governor rather than pinning one model in the workflow file. `EMERGENCY_LOW_COST` and `NORMAL` use the cheapest capable tier; `HIGH_PERFORMANCE` and `FRONTIER_BURST` unlock larger models. Largest single lever on repo-lane cost, and the plumbing exists.
4. **Trigger on explicit dispatch from Boss OS only** — not on every push, not on every PR event. Automatic review on every push is how minute budgets evaporate.

Overage, if it ever happens, is $0.006 per Linux 2-core minute. Self-hosted runners carry no per-minute fee — not worth a machine now; revisit only if the Phase 22 server exists and overage is real.

---

## 1.5 D4 — ASTROLOGY · LOCKED

**No vendor. None. Phase 16 ships a computed lunar layer and a seeded almanac table.**

### Why no vendor at all

Three constraints collapse into one answer:

1. **Licensing.** Swiss Ephemeris is AGPL-3.0 unless you buy Astrodienst's commercial licence; calling an AGPL library over a network generally obliges you to release your application's source. Boss OS holds personal, financial, and relationship data. Unacceptable, and a commercial licence for one dashboard in a single-user app is disproportionate.
2. **Runtime.** That library is a stateful C library with on-disk ephemeris files designed for 1997 desktop software. It does not fit Workers.
3. **Privacy.** Every managed alternative means sending birth date, exact time, and place to a third party with its own retention policy. Canon classifies this as the most sensitive tier in the system.

Canon §42.3 explicitly permits a manual moon and retrograde calendar as a fallback. Make it the primary implementation. Birth data then never leaves the Worker at all — strictly better than any vendor arrangement, and $0.

### What Phase 16 ships

- **Computed moon phase and sign** from standard published astronomical algorithms implemented in TypeScript. No dependency, no network call, no licence issue.
- **`astro_calendar`** — a seeded table of new moons, full moons, retrograde periods and shadow windows for the next 24 months, entered once from a public almanac and refreshable the same way. This satisfies canon §42.2's monthly forward view: retrogrades, shadow periods, push/rest/visibility/networking/reflection windows.
- **Everything else in Spirit OS ships in full** — manifestation, evidence vault, rituals, dream journal, contribution tracking, ancestors, anti-delusion engine. None of it needs an ephemeris.

### What is honestly deferred

**Personal natal transits** (canon §42.1's transit-to-natal interpretation) require an ephemeris and are **not implemented**. Mark them `DEFERRED — NO EPHEMERIS SOURCE`. The daily view ships with moon phase, sign, and the calendar-derived signal; the natal layer is a future upgrade behind an optional `execution_backends` row, addable without a rewrite if an acceptable vendor is ever found.

### Canon law as code, not commentary

- Astrology informs. Reality governs. Calendar and obligations win.
- No life, money, legal, health, or trading decision may be decided by astrology alone.

Tests must prove: an astrology signal cannot override a calendar obligation, and cannot influence a trading gate at all. The trading lane does not read the spirit lane.

### Birth data rules — unchanged and now easier

Stored in D1, classified `restricted`, never duplicated into task inputs, prompts, evidence packets, or logs. **Categorically refused by the model router** — a test attempts it and is refused. Included in vault snapshots (identity-tier data). Excluded from any export leaving the perimeter. The derived daily signal may enter the agenda engine; the birth data behind it may not.

---

## 1.6 D5 — PERSONAL OPERATING MANUAL EXPORT · LOCKED

**Nothing leaves the perimeter. $0 by design.**

The Personal Operating Manual is identity-tier memory under canon §45 — the distilled version of how you operate. Handing it to a third-party document service for nicer formatting is the worst trade available: maximum sensitivity, minimum benefit.

- Generation runs in the Worker; output is Markdown.
- Written to R2 under the existing snapshot prefix with a SHA record, so §46 continuity covers it automatically and knowledge and continuity share one mechanism.
- Download via a short-expiry signed URL, single-use where the platform allows.
- **R2 has zero egress fees on every plan**, so downloads are free regardless of size.
- No email delivery, no third-party storage, no external rendering.
- Restricted-class content excluded by an **allowlist**, not a denylist. A test asserts the exclusion.

Phase 23's external SSD and offsite copy remain a manual human step on the downloaded file. That is canon §19's design — the perimeter ends at your device deliberately.

---

## 1.7 D6 — TRADING EXECUTION · LOCKED

### Boss OS governs. It does not execute.

Canon already specifies the architecture: Hummingbot on an always-on server, testnet before live, exchange API keys never carrying withdrawal permission, a permission model that differs by stage (v5 Parts B, C, G). Boss OS keeps the authority envelope, six micro-live gates, notional ceiling, symbol allowlist, position limits, kill switch, and incident ledger — all of which already exist and stay as they are.

### Exchange: **Kraken demo futures** (`demo-futures.kraken.com`)

Chosen on availability, not preference. **Binance futures is not available to US residents**, and you are US-based. Kraken is US-regulated, has operated since 2011 without a breach losing client funds, and offers a self-service demo environment purpose-built for building trading software — the demo base URL differs from production by hostname only, so promotion to live is a configuration change rather than a rewrite.

### Host: **Hetzner CX22 in a US region**, ~€4.50/month

2 vCPU, 4 GB RAM, NVMe, with generous included transfer — roughly 3–5× cheaper than comparable instances elsewhere, and US regions exist (Ashburn, Hillsboro). Canon Part C suggests an AWS `t3.large` in Tokyo and in the same breath says document why and revisit if the exchange or geography changes. The exchange changed to Kraken and the geography to the US, so it is revisited: a t3.large would be the largest recurring cost in the entire system, and Hummingbot on demo with one or two strategies does not need one.

**Provision nothing until Phase 22 actually begins.** Phases 6–21 need no server. Cost incurred before then: $0.

Because D2 defers sovereign inference to this same machine, size for the trading engine first; inference is the secondary tenant and can prompt a resize later. Shared hardware is not shared authority — the two must be isolated from each other on the box.

### Unchanged hard constraints

- Live execution returns `501` until a real adapter exists, every Part G gate is recorded as met, and the human approves. `trading_live_enabled` is an envelope, not a toggle.
- Exchange credentials live on the server, never in the Worker, never in D1. **Boss OS holds no key that can move money.**
- API keys never carry withdrawal permission.
- The kill switch must reach the server and be **proven** to reach it. A kill switch that only sets a local flag is not a kill switch — test it against a running demo engine.
- No guaranteed-return language anywhere in code, UI, or comments.

---

## 1.8 In-product cost guardrails — build these in Phase 7

1. **Vendor ceiling per backend.** Every `execution_backends` row carries a monthly cost ceiling and current-month spend. Exceeding it disables that backend and raises an approval card rather than continuing to spend.
2. **Global monthly ceiling with automatic degrade.** At 80% the system drops to `EMERGENCY_LOW_COST` and notifies; at 100% it stops non-critical work. Manual restoration only — the ceiling must not self-clear.
3. **Free-tier headroom monitoring.** A nightly cron step records consumption against each free allowance — GitHub minutes, D1 writes, R2 operations, Workers AI inferences. Notify at 70%. Free tiers fail silently and expensively.
4. **Provider-side hard stops.** GitHub spending limit $0. Anthropic and Fireworks caps set to figures acceptable as a total loss. In-product limits protect against your system misbehaving; provider-side limits protect against your in-product limits being wrong.
5. **Cost per approved output on the dashboard.** The usage ledger already holds the data. Spend per useful result is the number that tells you whether a model tier earns its price — roadmap PI-9 already names it as a benchmark category.

---

# PART 2 — WHAT IS ALREADY BUILT

Do not rebuild any of this. Extend it.

39 tables across 4 migrations. Approvals with payload execution and symmetric rejection/expiry. Task intake with 16-kind classification and execution assignment. Permission envelopes. Model router with capability, risk, and privacy screening, budget enforcement, and full `routing_decisions` logging. Memory tiers with a promotion gate. Continuity vault with snapshot, verify, three-mode restore, and drill. Paper trading lane with authority gates, kill switch, incidents, CSV export. Employee registry with reviews, merge, retire, sprawl report. Cost modes, usage ledger, diagnostics, deep health check, dead-letter triage, cron.

Roadmap phases already satisfied: TI-1→TI-5, MR-1, MR-2 (partial), MR-4, MR-5, PW-1→PW-5, MF-2, MF-3, MF-7 (partial).

---

# PART 3 — PHASES 6 THROUGH 23

## PHASE 6 — VALIDATION AND DEPLOYMENT PROOF

**Why first:** nothing in the baseline has been compiled, tested, or run against real Cloudflare infrastructure where anyone can see it. Every later phase assumes the code runs. Phase 0 shipped once without compiling; do not repeat that.

**Canon:** §60. Roadmap §107.

1. `npm ci`, then `npm run validate`. Fix every typecheck error, test failure, and build failure. Report counts before and after.
2. Apply migrations 0001–0004 to real remote D1. Report any statement that fails on real D1 but passed in the test pool.
3. Deploy. Prove, with evidence in `system_events`: a queue message delivered end to end, a queue retry, a dead letter reaching its consumer, a cron firing and writing `cron_runs`, an R2 snapshot written and re-read.
4. Prove one real Fireworks inference call and reconcile the charged `usage_ledger` row against the provider's reported cost.
5. Replace the placeholder token prices from `0002_seed.sql` with the current Fireworks rate card **via a new migration**. Do not edit 0002.

**Acceptance:** `validate` exits 0; every binding proven live; one ledger row reconciled to a real invoice line within rounding; the "Externally unproven" list in `PHASES.md` shrinks to only what remains genuinely unproven.

---

## PHASE 7 — NOTIFICATIONS, MOBILE SURFACE, COST GUARDRAILS

**Why:** canon §79.2 and roadmap MF-1 place notification handoff inside the *first usable slice* and it is missing. Separately, about a third of the existing API has no screen.

**Canon:** §79.3, §79.13, §5 Cognitive Load Budget. Roadmap MF-1, MF-8, §80.12.

**Migration `0005_notifications.sql`**

- `push_subscriptions` — endpoint, p256dh, auth, created_at, last_success_at, failure_count, dead_at
- `notification_channels` — type (`web_push` | `telegram`), enabled, verified_at, last_success_at, last_error
- `notifications` — kind, subject_type, subject_id, title, body, urgency, created_at, sent_at, delivered_at, failed_at, error, dedupe_key (indexed; one pending approval never generates two)
- `cost_ceilings` — scope, ceiling_micros, spent_micros, window_started_at, breach_action

**Server**

- Dispatcher on: approval created, approval expiring in the warning window, task failed, dead letter arriving, kill switch engaged, trading incident opened, cron step failure, budget exhausted.
- Delivery is fire-and-forget from the caller's perspective and retried by the queue, never blocking the originating request.
- `GET /api/system/notifications`, `POST /api/system/notifications/test`.
- Service worker push handling in `public/sw.js`.
- The five cost guardrails from §1.8.

**Client — screens for what already exists but is unreachable**

| Screen | Backs onto |
|---|---|
| Router | `/models`, `/models/routes`, `/models/decisions`, `/models/benchmarks` |
| Intake governance | `/intake/workloads`, `/intake/assessments`, `/intake/proposals` |
| Task detail | `/tasks/:id`, requeue, cancel |
| Trading controls | authority PATCH, strategy stage, order cancel, incident resolve |
| Vault restore | `/vault/restore`, including the confirmation path for `replace` |
| Audit, usage, settings | `/system/audit`, `/system/usage`, `/system/settings` |
| Notifications | subscribe, channel health, test send |

Respect the Cognitive Load Budget — drill-downs, not walls of tables on primary tabs.

**Tests:** approval → notification row → dispatcher marks sent → no duplicate; a test enumerating every `api.*` method and failing on orphans; restore `replace` refused without the confirmation string through the API; the fallback formatter cannot include a payload field.

**Acceptance:** a pending approval reaches the phone with the Worker as the only thing awake; no `api.ts` method lacks a screen; kill switch and vault restore both reachable and both gated.

---

## PHASE 8 — MODEL RUNTIME COMPLETION

**Canon:** §75, §75.7–75.9, §31. Roadmap MR-2, MR-3.

**Migration `0006_model_bench.sql`**

- `benchmark_tasks` — golden set per §75.7 and roadmap PI-9 categories
- `benchmark_runs` — task, model, output, quality score, cost micros, latency ms, human edit burden, verdict, run_at
- `model_promotions` — model, from level, to level, evidence run ids, approved_by_approval_id
- Extend `models` with promotion level and ramp state if §75.8/75.9 require fields the table lacks

**Server**

- Harness runs the golden set across registered models and records real runs. Not a simulation.
- **Register Workers AI as a candidate** and benchmark it honestly against Fireworks and a frontier model.
- Promotion is approval-gated: no model becomes a default for a task kind without benchmark evidence and an approved card. Wire into the existing router policy screen, not beside it.
- Local adapter interface only, unimplemented and labelled (§1.3).

**Acceptance:** ≥5 workloads with real benchmark results; ≥1 routing decision from a benchmark-informed default; a weak model cannot be promoted for high-risk work, proven by a test that attempts it and is refused; §106's local-model criterion recorded as deferred with the Phase 22 host named.

---

## PHASE 9 — EXECUTION BACKEND REGISTRY AND REPO LANE

**Canon:** §33, §36, §35.1–35.3, v10.11 §7, §79.7–79.9. Roadmap MF-5, MF-6, §80.13. Decision §1.4.

**Migration `0007_backends_repo.sql`**

- `execution_backends` — canon §33 registry fields: name, class, capabilities, allowed task kinds, forbidden actions, credential reference, security tax notes, monthly ceiling, review date, status
- `repo_targets` — repo identity, default branch, protected flag, allowed paths, validation command (**ships empty**)
- `repo_runs` — task_id, backend, branch, PR ref, commands run, exit codes, tests run/passed, runner_minutes, artifacts, evidence_packet_id, rollback ref, status

**Server**

- Add a `repo_write` payload kind to `approvals/execute.ts` following the existing pattern. Do not create a second approval mechanism.
- Evidence packets extend the existing table to satisfy §79.8 and §79.15: plain-English summary, files touched, checks run, log links, remaining risks, approval needed, rollback available, final status.
- Settings screen to add and remove repo targets, enforcing the two rules in §1.4.

**Tests:** a repo task failing its test suite produces an evidence packet with the failure and never reaches merge; a repo write without an approved envelope is refused at the boundary; a Boss OS target refuses merge without explicit owner approval; the first-target rule refuses a Boss OS repo as the first entry.

---

## PHASE 10 — ASSIGNMENTS, STANDING DUTIES, SKILL PACKS

**Why here:** the Executive OS phases assume recurring work is a first-class object. Today `tasks` has no cadence and nothing recurs on its own.

**Canon:** §27, §54, §30, §29.2, §55 (extend, don't duplicate).

**Migration `0008_duties_skills.sql`** — `assignments`, `standing_duties` (cadence, owner employee, next_due_at, last_run_at, suspended, success criteria), `skill_packs`, `skill_admissions`.

Cron materialises due duties into queued tasks; duties never execute inline. Skill admission is approval-gated through the existing machinery. Existing `task_templates` become instantiable by a duty rather than only by hand.

**Acceptance:** one recurring duty runs on cadence across a week of simulated cron ticks without a new agent being created; a skill pack cannot become active without passing the admission gate.

---

## PHASE 11 — EXECUTIVE OS CORE

**Canon:** §15 Today, §16 cadence, §17 Morning Gate, §16 (15.3) Night Gate.

**Migration `0009_executive_os.sql`** — `days`, `day_flow_blocks`, `open_loops`, `gate_entries`.

Today becomes the default screen and the first tab, ahead of Inbox, containing exactly the thirteen elements canon §15 lists — no more. Canon is explicit that it must read like a Chief of Staff briefing, not a dashboard. Morning Gate, Midday Reset, and Night Gate are three flows each writing a `gate_entries` row. Night Gate feeds the existing memory promotion sweep, not a parallel one.

**Acceptance:** Today renders real data from existing subsystems and stays inside §5's presentation limits; Night Gate captures attention allocation and seeds tomorrow.

**Not in this phase:** deciding *what* goes in Today. Phase 11 renders and captures; Phase 12 decides.

---

## PHASE 12 — AGENDA ENGINE AND COACHING FACULTY

**Canon:** §20 (implement its enumerated inputs, arbitration factors, outputs, and workflow — not a summary), §18 with §17.1–17.9, §8, §19, §21.

**Migration `0010_agenda_coaching.sql`** — `agenda_runs` (inputs snapshot, arbitration trace, outputs), `coaching_entries`, `mental_models`, `mental_model_days`.

The engine records, per §20 input, whether it was available or absent. An absent input is recorded as absent, never defaulted to a guess. The arbitration trace persists — when the day plan is wrong, the trace is how it gets fixed. Canon §18 forbids generic motivational filler; enforce with a test asserting coaching entries reference real day objects.

**Acceptance:** all twelve §20 outputs produced, or explicitly marked unproducible with a reason; recovery state measurably changes the plan, proven by two runs differing only in recovery input.

---

## PHASE 13 — RELATIONSHIP CAPITAL OS

**Canon:** §40, §10, §51 (Person, Organization, Relationship, Meeting, Follow-Up).

**Migration `0011_relationships.sql`** — `people`, `organizations`, `relationships` with §40's five scoring dimensions (strategic importance, trust level, recency, opportunity value, relationship health), `meetings`, `meeting_briefs`, `meeting_captures`, `follow_ups`.

Full §40 meeting intelligence: before-meeting brief, dossier, relationship history, suggested questions, after-meeting capture, follow-up draft, memory promotion candidate. The existing `tpl_meeting_dossier` template becomes the generator — it currently has nowhere to write. Overdue follow-ups surface into `open_loops` and Today.

**Acceptance:** a meeting produces a brief before and a capture after; the capture creates at least one follow-up and one memory promotion candidate.

---

## PHASE 14 — INVESTOR OS AND WEALTH COMMAND CENTER

**Canon:** §41 (thirteen components), §42 (ten tracks, nine engines), §12, §13, §9.

**Migration `0012_investor_wealth.sql`** — `deals`, `lps`, `opportunities`, `theses`, `decisions`, `predictions`, `calibrations`, `red_team_reviews`, `wealth_tracks`, `capital_allocations`, `entities`, `portfolio_vehicles`.

Decision Journal and Prediction Vault are the load-bearing pair: a prediction must be resolvable later and feed real calibration scoring, not a display. Red Team challenges a decision before commitment and records the challenge. Deal Energy Protection (§41) is enforced in UI — pipeline primary, single deal secondary. Trading Allocation Bridge reads trading capital **read-only across the lane boundary**.

**Acceptance:** one decision recorded with a prediction, resolved, reflected in a calibration score; Wealth reads real trading capital without breaching lane isolation.

---

## PHASE 15 — KNOWLEDGE OS SURFACES

**Canon:** §45 (twelve surfaces), memory tiers, §46, §64. Decision §1.6.

**Migration `0013_knowledge_os.sql`** — typed surfaces over the existing `memory_items` substrate, not a parallel store: Life Wiki, Personal Operating Manual, Decision Vault, Prediction Vault (shared with Phase 14 — do not duplicate), Lessons Learned, Memory of Failed Experiments, Breakthrough Library, Operating Pattern Library, Archive of Self, Legacy Vault, Wisdom Canon, Emergency Offline Library.

Personal Operating Manual generation and regeneration from promoted memory. Portable export through the existing vault path with a SHA manifest. **Memory retirement**, which canon requires and the current implementation lacks.

**Acceptance:** the Manual generates from real promoted memory and regenerates after new promotions; a retired memory stops surfacing without being deleted; the restricted-class allowlist test passes.

---

## PHASE 16 — SPIRIT OS, ASTROLOGY, CONTRIBUTION, ANCESTORS

**Canon:** §43 (fourteen components), §42.1–42.3, §44, §5.2. Decision §1.5.

**Migration `0014_spirit.sql`** — `manifestations`, `manifestation_evidence`, `rituals`, `dream_entries`, `contributions`, `ancestor_entries`, `astro_calendar`, `astro_days`.

Computed moon phase and sign in TypeScript. Seeded 24-month almanac table for new moons, full moons, retrogrades, shadow periods, and the §42.2 window types. All non-ephemeris Spirit OS components ship in full. Natal transits marked `DEFERRED — NO EPHEMERIS SOURCE`.

Contribution: minimum one per month, ideal four. **No guilt, no daily requirement** — the reminder tone is part of the spec. Ancestors: gentle respectful reminders only, one hour monthly.

**Acceptance:** daily and monthly views render entirely from computed and seeded data with no network call; the anti-delusion tests in §1.5 pass; the reality-priority warning is visible per §5.2.

---

## PHASE 17 — PROMPT INTELLIGENCE AND MASTERY LENS BENCH

**Canon:** §76.1–76.21. Roadmap PI-1→PI-10.

**Migration `0015_prompt_intelligence.sql`** — `mastery_lenses` using the exact nineteen-field schema in §76.10, plus `pov_cards`, `prompt_packets`, `prompt_scores`, `prompt_library`, `prompt_traces`.

Three enhancement levels per §76.3. Automatic Tier-1 triggers on canon's list: repo work, investor materials, outbound email, marketing, legal-adjacent writing, financial and trading decisions, document compiler work, private-data work, external actions, vendor changes, canonical document updates. 15–20 initial lenses across §76.11 categories, observing the No Pedestal Law (§76.8) — structured method, not celebrity worship. Adapters compile packets per §76.14 through the Phase 9 backend registry. Library promotion is review-gated (§76.17). Traces integrate with existing `routing_decisions` and `usage_ledger`, not a new ledger.

**Acceptance:** a rough request produces a Tier-1 packet with a lens stack, a counter-lens, and a score; no prompt enters the library without review.

---

## PHASE 18 — CAPABILITY INTELLIGENCE

**Canon:** §78.1–78.20. Roadmap CI-1→CI-10.

**Migration `0016_capability_intelligence.sql`** — `capabilities` using the twenty-two-field Capability Package schema in §78.4, plus `active_defaults`, `bench_candidates`, `discovery_inbox`, `after_action_reviews`, `capability_patches`.

Search is trigger-based per roadmap §79.6 — repeated failure, high value, high risk, new link provided, scheduled window, cost too high, better benchmark, no default, bloat. Explicitly not continuous tool-chasing. After-action review runs against real task traces and can propose a patch; core capability updates require approval. Monthly scan and quarterly review as standing duties from Phase 10.

**Acceptance:** every serious job type has an active default; alternatives are benched, not silently mixed into runtime; a patch cannot mutate a critical capability without approval.

---

## PHASE 19 — OPERATING GOVERNANCE LAYER

**Canon:** v10.10 — §2, §3, §4, §5, §6, §7, §8, §11, §14, §15, §16, §17, §18.

**Migration `0017_governance.sql`** — `decision_rights`, `compliance_flags`, `failure_playbooks`, `maintenance_items`, `ip_assets`, `brand_profiles`, `learning_entries`, `emotional_states`.

Enforcement, not display. Decision Rights determines who may decide what and the approvals layer consults it. Emotional State Risk Classification (§18) gates canon's protected actions — a high-risk state blocks them and says so kindly. Anti-Dependency Protocol (§17) is a real check. Mode Boundary Governor issues the §7 mode card.

**Acceptance:** a protected action is refused under a high-risk emotional state, recorded and explained; Compliance Sentinel flags at least the §4 watch list.

---

## PHASE 20 — SEO/GEO AND DOCUMENT COMPILER RUNTIMES

**Canon:** §37, §38, §78.15, §78.8.

**Migration `0018_runtimes.sql`** — runtime job tables per those sections. Both execute through the Phase 9 backend registry and produce evidence packets. Document Compiler Mode is the current active default capability, reviewable per §78.9 — not permanent doctrine.

**Acceptance:** a document compile run produces a structured artifact with a manifest and SHA record; an SEO/GEO run produces an evidence packet, not a claim.

---

## PHASE 21 — FIRM OS BRIDGE AND SEPARATION

**Canon:** §48, §79.10. Roadmap MF-10, PW-8.

**Migration `0019_firm_bridge.sql`** — `bridge_handoffs` with category, direction, payload reference, approval, and a hardcoded forbidden-category list.

Separate repos, permissions, memory, budgets, approvals, audit logs, deployment scopes. Only approved categories cross. Personal data does not leak.

**Acceptance:** a forbidden-category handoff is refused at the boundary, in both directions, proven by test.

---

## PHASE 22 — TRADING: AI QUANT FUND v5 PARTS B–G

**Authority:** `Boss_OS_AI_Quant_Fund_Master_Plan_v5.md` governs entirely. Canon §49–50 and roadmap 15–17 defer to it. Do not implement trading detail from this document. Decisions in §1.7.

**Scope:** command centre and security setup (Part B), server setup (Parts D–E), strategy desks, intake, promotion scorecards (Part F), paper gate, micro-live gate, scale ladder, target deployment rule (Part G), and the Part C 90-day sequence.

Provision the Hetzner CX22 at the start of this phase, not before. Connect Hummingbot to Kraken demo futures. Prove the kill switch reaches the server.

**Acceptance:** paper and micro-live gates exist with evidence requirements; no scale-up without approval; kill switch proven against a running demo engine; trading validation status stays honest.

---

## PHASE 23 — CONTINUITY HARDENING

**Canon:** §19, §46, §45.2, §45.3.

The vault, snapshot, verify, restore, and drill already exist and are the strongest part of the baseline. This phase completes the Emergency Sovereignty Package: offline library, initialization prompt backup, prompt library backup, external SSD workflow, offsite copy workflow, SHA manifests, disaster recovery runbook, restore checklist, local model smoke test.

Some of this is procedural. Produce the runbook and checklist as repo documents; implement the parts that are code.

**Acceptance:** a documented restore drill completes from the offline package alone.

---

# PART 4 — WHAT THE HUMAN ACTUALLY HAS TO DO

Nothing here blocks Claude Code from starting. Each item is needed only when its phase runs.

## Before Phase 6

1. Confirm the Cloudflare account is on **Workers Paid** ($5/month).
2. Make sure Fireworks has a payment method and a spend cap set to a number you would accept losing.

## Before Phase 7

3. Generate a VAPID key pair (Claude Code will give you the command). Private key → Worker secret. Public key → client config.
4. On the iPhone: open the app in **Safari**, tap Share, tap **Add to Home Screen**. Open it from the Home Screen icon, then tap the subscribe control and allow notifications. It will not work from a Safari tab — that is an Apple restriction, not a bug.
5. Create a Telegram bot via BotFather, send it one message, and give Claude Code the bot token and your chat ID. Token → Worker secret.

## Before Phase 8

6. Nothing. Workers AI is on the account you already have.

## Before Phase 9

7. Install the Claude Code GitHub App on **one repository that is not Boss OS**.
8. Create a fine-grained personal access token scoped to that repository with `contents: write`, `pull_requests: write`, `actions: write`. Nothing else. → Worker secret.
9. Put an Anthropic API key in that repository's **GitHub Secrets**.
10. In GitHub billing, set the **spending limit to $0**.

## Before Phase 16

11. Nothing to buy. You will be asked to paste a moon-phase and retrograde calendar for the next two years from any public almanac — a one-time, five-minute task, repeated every couple of years.

## Before Phase 22 — only if the trading lane proceeds

12. Create a **Hetzner** account and a CX22 in a US region (~€4.50/month).
13. Create a **Kraken** account and enable the **demo futures** environment. Generate demo API keys only.
14. Confirm no API key anywhere carries withdrawal permission.

## Ongoing

15. When Boss OS notifies you that a free tier is at 70%, read the notification. That is the system doing its job.

---

# PART 5 — WHAT THIS PLAN DOES NOT DO

- It does not restate canon. Every phase names its sections; read them.
- It does not specify fields where canon specifies them.
- It does not implement live trading execution, which stays `501` behind Part G gates.
- It does not implement natal-transit astrology, which has no acceptable ephemeris source.
- It does not register a local model, which is deferred to the Phase 22 host and recorded as deferred, not met.
- It does not assume the baseline compiles. Phase 6 exists for that reason.
- It does not carry acceptance criteria for subsystems already built and tested in Phases 0–5.

---

# PART 6 — VERIFICATION NOTE

Checked against current sources on 2026-08-10: Cloudflare Workers Paid pricing and free-tier allowances; iOS Web Push requiring Home Screen installation; the `web-push` package failing on Workers; GitHub Actions free minutes and the January 2026 runner rate cut; the Claude Code GitHub Action's capabilities; Swiss Ephemeris licensing and runtime fit; Kraken's US availability and demo futures environment versus Binance's unavailability to US residents for futures; Hetzner CX22 pricing after the April 2026 adjustment.

Cloudflare's Queues and Cron availability on the free plan is reported inconsistently across secondary sources; the $5 Paid plan removes the question.

Re-verify at the start of each phase. Nothing in this document has been implemented or validated — it is a plan and a decision record.
