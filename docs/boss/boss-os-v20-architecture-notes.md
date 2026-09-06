# Boss OS v20 — Architecture Digest, Build Map & Hostile Review

Read: 2026-07-31 · `Boss_OS_v20_Unified_Canonical_Delivery.zip` · 30 files, 1.1 MB
Core corpus: Unified Canonical Master Plan v20 (12,589 lines), Implementation Roadmap v20,
AI Quant Fund Master Plan v5, Personal AI Workforce + Cost Governor Addendum v1,
Mobile-First Command / Cloud Execution Addendum v1, plus the v10.19 preserved baseline.

**What this package is:** governing law and a build plan. Zero code. Every "Current Truth"
line in it says the same thing — nothing has been implemented, no Odysseus fork exists, no
trading account is connected. That is honest, and it is also the whole problem. See §9.

**Relationship to West Peek OS:** same architecture family, different principal.
West Peek OS = the firm's institution (LPs, deals, IC, portfolio). Boss OS = Sequoia's personal
institution (identity, coaching, agenda, wealth, spirit, personal agents) **plus a private AI
quant fund**. The plan writes the separation into law, not convention (§3.5).

---

## 1. What Boss OS actually is

The plan defines it by negation first — not a productivity app, not a habit tracker, not a
Notion clone, not a CRM, not a trading bot, not a prompt pack, "not TypingMind by another name."

Then by composition:

```
Odysseus Fork  +  Boss Constitution  +  Executive OS  +  A-Player Mode OS
+ Daily Coaching Faculty  + Agenda Calculation Engine  + AI Employee OS
+ Investor OS + Relationship Capital OS + Identity OS + Spirit OS
+ Knowledge OS + AI Continuity System + Firm OS Bridge
+ AI Quant Fund Companion + Builder/Runtime Systems
+ Operational Intelligence / Common Sense Governor
```

The organizing sentence for the whole system:

> **The system holds complexity. The human executes.**

And the authority stance:

> Sequoia is the Boss. AI coaches develop her. AI employees do assigned work.
> AI systems propose. Sequoia approves. The Constitution governs.

Four identity tracks drive everything downstream: Future Good Billionaire, Elite Investor,
Master Manifestor, Healthy & Hot Sequoia 2.0. Eight domains: Wealth, Body, Spirit, Execution,
Relationships, Home, Knowledge Continuity, Trading/Capital Systems. Sixteen permanent
"Coaching Filters" (Wealth Creation, Operator Discipline, Strategic Patience, Reality
Calibration, Risk Discipline, Agentic Delegation, …) that act as lenses on every decision.

---

## 2. The Constitution — the actual product differentiator

Roughly 35 named laws sit above every model, agent, and feature. The ones with real
engineering consequences:

| Law | What it forces you to build |
|---|---|
| Truth Over Completion / No Fake Completion | Status must be derived from evidence, never asserted |
| Documents Before Inference | Retrieval before generation, always |
| Reality Before Story | A truth mode flag on narrative output |
| No Silent Mutation | Every write is an auditable, reversible event |
| Conversation ≠ Knowledge / Knowledge Promotion Required | A Memory Promotion Queue with human approval |
| No Loop Without State, Gate, Hard Stop, and Approval Rule | Every agent loop needs a persisted state file |
| No Agent Self-Grading as Sole Verification | Maker/checker split; a second evaluator |
| No Narrative Adjustment Without Truth Mode Disclosure | Narrative Truth Mode as a UI-visible state |
| No Autonomous Financial Authority Without Explicit Envelope | Authority Envelope objects, expiring |
| Nothing Mission-Critical Lives Only in the Cloud | The Continuity Vault, offline SSD, restore drills |
| No West Peek Data Leakage Into Personal Systems | A bridge with permission checks, not an import |

Reality Priority (the tiebreaker ladder, top to bottom): Reality → Risk → Health → Contracts →
Commitments → Legal/Compliance → Capital Protection → Goals → Astrology → Manifestation →
Ritual. Astrology is explicitly *advisory only* and ranks below capital protection. That single
ordering is what keeps a Spirit OS from corrupting a trading system.

**CoVE** is the claim discipline: every important claim carries Claim / Evidence /
Verification / Confidence. Build it as a type, not a habit.

---

## 3. The governance stack (this is the real intellectual property)

### 3.1 Common Sense Governor — five review tiers
Tier 0 Common Sense Pass → Tier 1 CoVE Claim Discipline → Tier 2 Hostile Review Governor →
Tier 3 Maker/Checker Split → Tier 4 Objective Verification Gate. Depth scales with risk;
it is not a single "review" boolean.

Supporting mechanisms named in the plan: POV Intelligence Layer (POV cards — explicit lenses an
agent must argue from), Loop Suitability Gate (is this task even loop-shaped?), Minimum Viable
Loop Standard, **State File Requirement**, **Ralph Wiggum / Silent Loop Failure Guard** (detect
a loop that is running but producing nothing), Worktree Isolation, MCP/Connector Guard, Agent
Security Tax (integrating a tool costs review budget, and that cost is explicit), Comprehension
Debt Guard (don't ship what you can't explain), Narrative Truth Mode, Default Human Override.

### 3.2 Decision Rights + Data Classification
A decision-rights matrix by domain and decision class, and a data-classification matrix that
**routes by class** — sensitive personal, financial, legal, health, and relationship data get
local-first or local-only handling. Data class is an input to model routing, not an afterthought.

### 3.3 Cost Governor / Agent Intensity Dial
Six modes, and each one is a **declarative policy record**, not a vibe:

`SHUTDOWN_MANUAL` · `EMERGENCY_LOW_COST` · `NORMAL` · `HIGH_PERFORMANCE` ·
`FRONTIER_BURST` · `DELEGATION_SPRINT`

Each mode declares: allowed_models, forbidden_models, allowed_tools,
browser_automation_allowed, max_parallel_agents, max_retries, max_estimated_cost_per_task,
max_estimated_cost_per_day, validation_depth, human_approval_required_for_cost_overage,
fallback_mode. One dial changes model choice, agent count, tool access, research depth,
validation depth, retries, background frequency, notification frequency, artifact depth.

Paired law: **Cheap Is Not Enough** — a cheaper model is not better if it increases error,
cleanup, latency, or cognitive burden.

### 3.4 Permission Envelope + Evidence Packet (the two workhorse objects)
Every agent task carries an envelope: task_id, agent_role, execution_assignment, cost_mode,
budget_limit, allowed/forbidden models and tools, data_sensitivity, external_action_allowed,
external_send_allowed, repo_write_allowed, provider_mutation_allowed, financial_action_allowed,
legal_or_compliance_review_required, approval_required_before_action, evidence_required,
expiration_time, rollback_or_reversal_required.

Every meaningful task returns an evidence packet: request, assignment, agent, model/worker,
cost_mode, estimated vs actual cost, source materials, actions taken, artifacts created,
external systems touched, records changed, checks run, risks remaining, unknowns, approval
needed/record, next human action, final status.

> Evidence packets prevent invisible labor and invisible spend.

That sentence is the thesis of the whole OS. If you build one thing, build this.

### 3.5 Personal vs Firm Separation Law
Boss OS agents and West Peek OS agents may share architecture. They must **not** share repos,
permissions, memory, tasks, budgets, approval scopes, audit logs, data boundaries, or
deployment authority. Shared patterns yes; shared authority never.

---

## 4. The delegation engine (v10.19 — the part most systems lack)

**Personal AI Workforce Law:** Boss OS must not assume the human is the default executor.
Every meaningful task is assigned to exactly one of:

`USER_ONLY` · `AI_DRAFT` · `AI_EXECUTE_WITH_APPROVAL` · `AI_EXECUTE_WITH_NOTICE` ·
`HUMAN_CONTRACTOR` · `DEFER` · `DELETE`

Assignment is computed from risk, data sensitivity, cost, urgency, emotional load, required
judgment, required permissions, proof burden, and whether external action is involved.
Defaults are tabulated: research summary → EXECUTE_WITH_NOTICE; message draft → AI_DRAFT;
external send → EXECUTE_WITH_APPROVAL; repo edit → EXECUTE_WITH_APPROVAL; trading decision →
USER_ONLY; low-value high-friction task → EXECUTE_WITH_NOTICE **or DELETE**.

`DELETE` as a first-class routing outcome is the most underrated idea in the document.

**Low-Energy Delegation Mode:** when the user is depleted, the system reduces human labor
instead of increasing self-negotiation. No shame, no intensity push — it drafts, packets,
defers, or deletes.

---

## 5. Model Runtime Intelligence Layer (v20's headline addition)

Seven components: Model Router · Workload Placement Matrix · Local Inference Bench ·
Model Registry · Hardware Capability Profile · Token/Cost Ledger · Quality Evaluation Harness ·
Context Optimization Engine · Cloud Fallback Policy · Model Upgrade Watch.

**Router outputs** (not just "which model"):
`RUN_LOCAL` · `RUN_FRONTIER` · `RUN_LOCAL_FIRST_WITH_FRONTIER_FALLBACK` ·
`RUN_FRONTIER_FIRST_WITH_LOCAL_POST_PROCESSING` · `RUN_EXTERNAL_BACKEND` · `RUN_HUMAN` ·
`ASK_SEQUOIA` · `BLOCK_DO_NOT_RUN`

`RUN_HUMAN` and `BLOCK_DO_NOT_RUN` as router outputs is the correct design. Most model routers
can only pick a model; this one can decline.

**Workload Placement Matrix:** score every recurring workload 1–3 on privacy sensitivity,
volume/cost, latency tolerance, offline need, capability ceiling, control/stability. High
privacy + high volume + modest capability need → local. Low volume + high capability + latency
sensitive → frontier. Middle → hybrid. Worked examples given: private journal → local only;
Knowledge Vault summarization → local-first; morning agenda → hybrid; breaking legal/market →
frontier; trading logs → local; continuity vault check → local only.

**Routing record** is mandatory and durable: routing_id, task_id, agent_id, selected_model,
selected_backend, routing_mode, privacy/volume/latency/offline/capability/control scores,
risk_level, cost_estimate, fallback_model, approval_required, approval_status, reason, created_at.

**Local Inference Bench** exists to kill one specific failure: "local feels sovereign and cheap
but produces weaker work and creates more cleanup." Benchmarks against 15 named real workloads
(agenda calc, night gate, memory extraction, meeting notes, doc summarization, decision-record
extraction, approval-card drafting, task-intake classification, …) — not MMLU.

---

## 6. Task Intake & No Agent Sprawl (v20's second addition)

**Constitutional law:** no new AI employee when an existing agent, task template, skill pack,
recurring duty, or workflow can meet the need.

Supporting laws: Active Agent Burden Test (every active agent needs standing duties,
permissions, outputs, review criteria, **and retirement criteria**), Recurring Task Ownership
Law (owner, cadence, success criteria, review date), Model Routing Discipline Law, Cheap Is Not
Enough Law.

Intake pipeline:

```
new task/command/idea → classify domain → task type → risk → cadence → data sensitivity
→ required tools → Model Router → check existing agents
→ route to existing agent | task template | skill pack | recurring duty | propose new agent
→ Permission Envelope → approval if needed → execute/schedule/archive
→ Evidence Packet → memory promotion candidate → audit log
```

Agent lifecycle is a state machine: Proposed → Provisional → Active → Under Review →
Merged/Retired/Suspended. Creating an agent is itself an approval category.

Decision rule: **Skill Pack** when the knowledge is reusable across agents; **Task Template**
when the shape repeats but the doer doesn't; **New Agent** only when there is a durable role
with distinct permissions, standing duties, and review criteria.

---

## 7. Surfaces, entities, and the frozen navigation

**Navigation (frozen at v10.9, 25 top-level surfaces):** Today · A-Player Mode · Executive
Operations · Operational Intelligence · Coaching Faculty · AI Employees · Approval Inbox ·
Empire Map · Relationship Capital · Deal Flow Center · Opportunity Pipeline · Wealth Command
Center · Spirit · Projects · Creative Studio · Health Vault · Document Vault · Knowledge Vault
(12 sub-vaults) · AI Lab (9 sub-surfaces) · West Peek Bridge · Trading Lab (12 sub-surfaces) ·
Repository Runtime · SEO/GEO Runtime · Document Compiler Runtime · Agents · Settings.

**Agenda Calculation Engine** — the daily brain. ~22 inputs (calendar, energy, recovery state,
money urgency, deal stage, astrology advisory, open loops, trading risk alerts, approval inbox
status, continuity alerts). Arbitration on leverage, urgency, energy match, compounding value,
downside protection, strategic alignment, recovery need, relationship timing, revenue impact,
health floor. Outputs a *day*, not a task list: Today's Contract, Day Flow, First Money Move,
Body Floor, Spirit Cue, Relationship Move, Deep Work Block, Admin Block, Recovery Rule,
Approval Needs, Stop Point, AI Employee Assignments.

**Boss Command Router** — 13 steps from natural-language command to audit log: parse → classify
domain → classify risk → classify data sensitivity → identify tool needs → assign employee →
select backend → check authority → create Assignment → track in Work Queue → Approval Inbox if
needed → Result Memory Gate → Audit Log. Explicit rule: **the human never picks a backend.**

**Agent inventory (~60 agents across 11 groups):** Command+Operations (8) · Daily Coaching
Faculty (8) · Knowledge+Memory (7+) · Relationship+Meeting · Investor+Wealth · West Peek Bridge
· Build/Repo/Document · Spirit+Identity · Health+Recovery · AI Continuity+Local Model ·
Trading Firm (8). Note the tension: a 60-agent inventory sitting next to a No Agent Sprawl law.

**Approval Inbox** — 14 original categories (Memory Promotion, Outbound Message, Trade
Execution, Trading Authority Envelope, Spending, West Peek Handoff, Data Export, Model Routing,
Deployment, …) plus 16 new v20 categories (New Agent Creation, Agent Promotion, Model Routing
Change, Local-to-Cloud Escalation, Cloud Fallback With Sensitive Data, Cost Mode Escalation,
Permission Envelope Approval, Evidence Packet Acceptance, Mobile Approval Packet, …).
Card fields: proposed_action, why_it_matters, risk_level, data_involved, agent_requesting,
backend_or_model_proposed, memory_impact, cost_impact, permission_envelope,
rollback_or_reversal_path, evidence_required, alternatives, approve/edit/reject/snooze.

**Core entities:** ~70 in the baseline (User, Track, Domain, Goal, Protocol, Agenda, Person,
Deal, Decision, Prediction, Thesis, Knowledge Item, Pattern, Lesson, Journal Entry,
Manifestation Evidence, Transit, Agent, Assignment, Approval Card, Model, ModelProvider,
ExecutionBackend, SkillPack, Continuity Snapshot, Vault File, Restore Test, Trading Strategy,
Bot, Backtest, Forward Test, Risk Limit, Trade, Position, Kill Switch Event, …) plus 24 v20
additions (ModelRuntime, ModelBenchmark, Workload, WorkloadPlacementScore, ModelRoutingDecision,
HardwareCapabilityProfile, TokenCostRecord, CloudFallbackEvent, Task, TaskTemplate,
AgentNeedAssessment, AgentCreationProposal, AgentLifecycleEvent, PermissionEnvelope,
EvidencePacket, CostModeEvent, RecurringDuty, …).

**Knowledge OS is tiered memory**, and the tiering is genuinely good:
T1 Working → T2 Operational → T3 Institutional → T4 Identity → T5 Continuity.
Promotion between tiers is a human-approved event, never automatic.

---

## 8. The AI Quant Fund (the piece West Peek OS doesn't have)

Classified **Level 6 — high-risk financial transaction subsystem**, built last *because* it is
high-risk, not because it is optional. Governing sentence:

> AI does the work. Risk engine checks the work. Sequoia approves the authority envelope.
> The system operates inside the envelope. Anything outside the envelope escalates.

**Capital:** $50,000 trading capital + up to $10,000 Year-1 operating budget = $60,000 Phase 1.
Sleeves: Income-Producing Core $25k · Growth Alpha $12.5k · Experimental Strategy Factory $7.5k
· Moonshot/Convex $5k.

**The honesty section is the best page in the whole corpus.** $5k/month on $50k requires ~120%
annual simple return. The plan states plainly that this is "possible but not a default
expectation," tables the capital needed for the target to become reasonable ($150k → 40%,
$250k → 24%), and concludes: *the system cannot be commanded to make $5,000 per month; it is
commanded to discover and validate edge.* Success tiers start at **"preserve capital =
operational win."** Keep that framing; it is what will stop this from becoming a blowup.

**Master principle:** copy candidate strategies, test brutally, paper trade, live small, scale
winners, kill losers fast. AI builds the machine, the market proves the edge. *Strategies are
treated like portfolio companies — most fail, a few deserve real capital.*

**Authority Envelope object** (the trading analog of the Permission Envelope): approved
strategy, capital, assets, venues, order types, max daily loss, max total drawdown, kill-switch
rule, API permission rules, duration, review date, scale-up conditions, pause conditions.
Worked example: $300 micro-live, BTC/ETH/SOL only, Kraken, post-only limits, 15% max drawdown,
withdrawals disabled, 14 days, review required before any increase.

**Capital Deployment Ladder, no skipping:** Stage 0 Research → 1 Backtest → 2 Paper/Testnet →
3 Micro-Live Forward Test → 4 Breakeven Capital Test → 5 Target Deployment → 6 Scale/Multi-Venue.
Each stage carries capital limit, duration, pass criteria, fail criteria, required logs,
required review, and an explicit advance approval.

**Trading Risk Constitution — 14 nevers**, including: no guaranteed-return language, no revenge
trading, no discretionary override under emotional stress, no strategy without backtest, no
live without paper, no exchange API withdrawal permission ever, no autonomous capital increase,
no bot unmonitored without kill switch, no strategy change without versioning, no live system
without tax/ledger workflow or incident response. Stop rules: risk engine blocks → stop;
emotional override detected → stop; logs fail → stop; tax ledger fails → pause before scale;
drawdown breach → pause or flatten per preapproved policy.

**Trading workforce (8 roles):** Trading Coach/Buddy · Quant Research · Strategy Developer ·
Risk Officer · DevOps/SRE · Tax/Ledger · Security · Incident Commander.

**Stack:** Hummingbot (Python, mean-reversion / market-making, post-only limits, BTC/ETH/SOL) as
Bot 1. Paradigm Artemis + Foundry/Solidity on Base/Arbitrum as Bot 2 — explicitly *not a money
plan until it survives simulation, fork testing, contract audit, gas economics, and capital
authorization.* AWS Tokyo server; laptop is a remote control and closing it must not stop
trading.

**90-day roadmap**, day-by-day with artifact / gate / failure rule per day: wk1 command center
+ security → wk2 cloud server → wk3 Hummingbot testnet → wk4 25 strategy hypotheses → wk5
backtest harness → wk6–7 paper portfolios alpha/beta → wk8 monitoring + incident drills →
wk9 micro-live readiness gate → wk10 $250–300 forward test → wk11 $500–1,000 → wk12/13 CEO
decision. Failure rule everywhere: *do not skip forward; repair the failed gate.*

**Firewall:** no West Peek capital, brand, LP, counterparty, or data. No investor-facing claims.
No representing results as a West Peek performance record. Default: **no automatic bridge
between the firm system and the trading system.**

---

## 9. Hostile review — what I'd tell you before you build a line of it

1. **The plan has more governance than product.** 12,589 lines of law for a system with zero
   users and zero code. The Constitution, the five review tiers, the vendor bench, the mastery
   lens bench, the capability intelligence system, the prompt intelligence system — each is
   defensible alone; together they are a compliance department for one person. Ship the
   governance that has a *user-visible surface* (Approval Inbox, Evidence Packet, Cost Governor)
   and leave the rest as a document until a real failure demands it.

2. **60 agents violates your own No Agent Sprawl law on page one.** The inventory is a
   taxonomy of *tasks*, and it has been mislabeled as a roster of *employees*. Start with four
   real agents — Chief of Staff, Knowledge/Memory, Research, Repo — and let everything else be
   a task template until an agent earns a role.

3. **Version sprawl is a real cost.** v10.6 → v10.19 → v20, with an authority hierarchy 13
   levels deep and each layer preserved verbatim. You are now maintaining a legal code. One
   canonical doc plus a changelog; delete the preserved baselines from the working set.

4. **Two crown jewels are buried.** The Evidence Packet and the Cost Governor are the parts
   nobody else has. They are in §80 of a 12k-line document. In the build, they should be the
   first two screens.

5. **Astrology sitting inside the same system as a live trading engine is a credibility risk.**
   Your Reality Priority ladder already handles it correctly (advisory, below capital
   protection) — but enforce it in code as a hard flag, so no astrology signal can ever reach a
   routing or capital decision. One leak destroys trust in the whole system.

6. **The quant fund is a separate company, not a module.** Different runtime, different repo,
   different secrets, different uptime requirement, different legal exposure, different failure
   mode. Boss OS should hold the *approval envelopes and the P&L read-out*. It should not host
   the bot. The plan half-says this; make it absolute.

7. **The 90-day trading roadmap is the only executable artifact in the package** — and it does
   not require Boss OS to exist. You could start it Monday with a spreadsheet, Termius, and a
   Kraken testnet account. Everything else is design.

8. **Local-first sovereignty will cost more than it saves at your scale.** The Local Inference
   Bench exists to prove local models are good enough; run that bench *before* buying hardware,
   not after. Hosted APIs under a hard Cost Governor cap will beat a Mac Studio for the first
   year on every axis except privacy — and the privacy cases (journal, relationship notes,
   continuity vault) are a small, enumerable slice you can route locally later.

9. **"Current Truth" is 30 lines of "not implemented."** That list is the most valuable page in
   the package and it should shrink weekly. If it hasn't shrunk in a month, the plan is
   generating documents instead of software.

---

## 10. Build order I'd actually recommend

**Slice 1 — The Console (2–3 weeks).** Today + Approval Inbox + Evidence Packet viewer + Cost
Governor dial. Four screens. Fake the agents with one hosted model. This alone is usable daily.

**Slice 2 — Intake & Routing (2 weeks).** Task Intake Engine, Permission Envelope, Model
Routing Decision record, Audit Log. Now every action is governed and every dollar is visible.

**Slice 3 — Memory (2 weeks).** Knowledge tiers T1–T3, Memory Promotion Queue with human
approval, Decision Vault, Prediction Vault. This is what makes the system compound.

**Slice 4 — Agenda Engine (2 weeks).** Today's Contract, day flow, First Money Move, Body
Floor, Stop Point. This is the daily habit loop.

**Slice 5 — Four real agents.** Chief of Staff, Knowledge, Research, Repo. Each with standing
duties, an envelope, and retirement criteria.

**Parallel track, unblocked by all of the above — the quant fund's 90-day plan.** Weeks 1–8
require no Boss OS code at all. Run them now.

**Deferred until earned:** Spirit OS, Creative Studio, SEO/GEO Runtime, Mastery Lens Bench,
Vendor Adapter Bench, Capability Intelligence System, local model hardware, mobile PWA
airlock, and 50 of the 60 agents.

**Stack fit:** TanStack Start + Cloudflare Workers + Neon/Postgres + hosted model APIs under
the Cost Governor cap. Under $100/mo through Slice 5. No Odysseus fork needed — you already
have the clean-room notes for the runtime patterns worth taking, and Boss OS's value is the
governance layer above them, which Odysseus does not have.

---

## 11. Boss OS vs West Peek OS — build them as one codebase, two deployments

| Shared (build once) | Boss OS only | West Peek OS only |
|---|---|---|
| Approval Card / Inbox | Identity Tracks, Coaching Faculty | LPs, Deal Flow, IC Decisions |
| Permission Envelope | Agenda Calculation Engine | Portfolio companies |
| Evidence Packet | Spirit OS, Health Vault | Firm cost ledger |
| Cost Governor + modes | AI Quant Fund envelopes | 45-machine registry |
| Task Intake + Model Router | Personal memory tiers | Firm governance/Constitution |
| Audit log + hash chain | Continuity Vault | Regulatory/LP reporting |
| Agent registry + lifecycle | Low-Energy Delegation Mode | Multi-user roles |

Same primitives, separate databases, separate secrets, separate deploys — exactly as the
Personal vs Firm Separation Law requires. Build the shared core once and let each deployment
mount its own domain modules.
