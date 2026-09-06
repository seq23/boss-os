# Architectural Decisions — West Peek OS Initial Implementation

Canon v3.2.14 is frozen to errata during implementation (D11). Corrections are recorded here as ADRs;
no new cumulative canon version is produced.

## Locked decisions (from approved plan §5) — restated for implementers

| ID | Decision |
|---|---|
| D1 | TypeScript + React/Vite + Cloudflare Workers/Pages + D1 + R2 + KV(ephemeral only) + Playwright. |
| D2 | Odysseus is reference-only. No fork, no dependency, no code import. |
| D3 | CanonicalCompany-first entity model. Parallel pipeline entities superseded. |
| D4 | Approved plan §8 phase order is the single implementation sequence. |
| D5 | Network OS stays authoritative for relationship/contact/touch/Gmail records; adapter-only crossings. |
| D6 | VentureDeals/secondaries math is ported only after independent formula verification; manual DealMathPacket entry allowed until then. |
| D7 | ≤15 human approval cards/day steady-state design target; batching/digests preferred; silence ≠ approval. |
| D8 | Privacy modes: `LOCAL`, `FRONTIER`, `LOCKDOWN`. Historical four-mode language folds into these three. |
| D9 | Providers are configuration, not architecture: registry, per-data-class allowlist, cost/capability metadata, manual fallback, default-deny sensitive, kill switch. |
| D10 | Seed full AI registry as reference data; ≤5 active employees, only after explicit human selection; MP names never AI employees. |
| D11 | Canon v3.2.14 frozen to errata. |
| D12 | Engineering builds process controls only; no technical test claims legal/compliance/fund-admin correctness. |
| D13 | West Peek Productions, sponsorship machinery, Market Intelligence Academy are separate future products. |
| D14 | Machine registry count = **45**, from one versioned source artifact, tested from that source. |
| D15 | One append-only typed event spine feeds Activity Feed, Audit Ledger, Diagnostics. |
| D16 | One evidence/provenance substrate for claims, contradictions, promotion, source-of-truth resolution. |

## Implementation ADRs / errata

### ADR-001 — Machine registry source of truth
Canon §5A.2 (v3.2.14) lists machines 1–45. The v1.11 implementation plan's "44 machines" requirement is stale
and superseded (approved plan §2.3, D14). Versioned source: `src/shared/registry/machines.ts`
(`MACHINE_REGISTRY_VERSION = "3.2.14"`). A test asserts exactly 45 entries from that single source.

### ADR-002 — AI employee roster version
Canon contains two rosters (§"Named AI Employee Roster" ~line 10316, and "Revised v3.0 AI Employee Roster"
~line 20545). The v3.0 roster explicitly supersedes prior conflicting names. We seed the v3.0 roster
(30 rows; `Willow` holds two distinct role rows) plus `Whitney — Market Intelligence Coach` (canon line ~20626),
for **31 AI-employee rows**, all `INACTIVE` by default. Names approved-renamed by v3.0 (Petra→Willa etc.) use
the new names only.

### ADR-003 — "Sequoia" in machine owner columns is a human owner, not an AI employee
Canon machine registry row 16 and the §5A.7 department map list `Sequoia` in "Primary AI employees / owners".
No roster row makes a Managing Partner an AI employee, and the approved plan forbids it (D10).
Implementation records this as human ownership metadata only; guard tests assert neither
`Scooter Taylor` nor `Sequoia Taylor` (nor first-name collisions `Scooter`/`Sequoia`) appears as an AI employee name.

### ADR-004 — Diligence claim status enum
Two canon-adjacent enums exist: the Receipts Layer external-content labels
(`KNOWN/BELIEVED/ASSUMED/ESTIMATED/ASPIRATIONAL/STORYTELLING-ADJUSTED/UNVERIFIED`) and the diligence claim
statuses (`VERIFIED/FOUNDER_STATED/THIRD_PARTY_SOURCED/AI_INFERRED/UNVERIFIED/MISSING`). The approved plan §P5
mandates the six-value diligence enum for `DiligenceClaim`. The seven-value labels are out of initial scope
(LP/external-content tooling may adopt them later). No second enum is implemented for diligence claims.

### ADR-005 — Deal math formulas
Neither source document contains numeric fee/discount formulas (only fields and underwriting questions).
Per D6, formulas enter the system only with independent hand-worked verification fixtures
(`tests/**/dealMath*` / `docs/DEAL_MATH_VERIFICATION.md`). Until a formula is verified, `DealMathPacket`
supports manual entry and derived-metric fields stay computed only by verified functions.
The `seq23/secondaries` repo is a read-only integration partner; if it is not locally accessible during P6,
the port is recorded as `UNPROVEN — SOURCE ACCESS GATE` and manual entry remains the path.

### ADR-006 — Authentication
Private ingress is Cloudflare Access (or equivalent) in deployed environments — configuration, not code.
The operator has since configured it: Access is recorded as active on the production hostname
`west-peek-os.seq-taylor.workers.dev`, established and verified entirely outside this repository, so no
check here proves it and none ever will (docs/ENVIRONMENTS.md). The decision is unchanged either way —
the application never implements ingress, and it never trusts Access alone.
App-level `FirmUser` + `Role` + `AuthorityScope` records are always
enforced server-side. Local development uses an explicit dev-identity header honored only when
`WP_OS_ENV=local`; unauthenticated requests are denied everywhere, including local.

### ADR-007 — Remote Cloudflare identifiers
The **top-level (local) profile** of `wrangler.toml` ships placeholder `database_id` / KV `id`. Local dev
and all local validation run offline via miniflare and never need real ids.

**Amended (deployment-profile separation).** Real remote ids are still operator-supplied configuration
behind the deployment approval gate — they are now recorded in the explicit `[env.production]` profile
only, never in the local profile. This keeps the two profiles from sharing state (docs/ENVIRONMENTS.md)
and means the local profile can never accidentally address a production resource. The ids are non-secret.
Recording them is configuration, not deployment: remote deploy, Cloudflare Access, and remote migration
apply remain human-gated and UNPROVEN.

### ADR-008 — Approval volume metric
Approval cards carry creation timestamps; a diagnostics rollup exposes daily/weekly counts against the
≤15/day design target (D7). The metric is observational; it never auto-approves.

### ADR-009 — P3 authority implementation notes
- **Merge reversal shares the merge's reserved key.** The canon reserved-action register contains
  `identity_merge.execute` but no separate reversal key. Reversal carries the same destructive-authority
  character as merge, so both route through `authorize()` with `identity_merge.execute`: merge is keyed
  on the source company (`object_type='canonical_company'`), reversal on the merge receipt
  (`object_type='identity_merge_receipt'`). The register itself is unchanged.
- **Action vocabulary source.** `action_type` is seeded from two registry sources: the canon reserved
  register (`reservedActions.ts`) and the implementation-defined `actionTypes.ts` (ordinary internal
  actions + per-effect-type external-effect keys `effect.email.send` / `effect.message.send` /
  `effect.webhook.post`). Non-register approval cards default to `["MANAGING_PARTNER"]` required
  approver roles. Unknown action keys are DENIED.
- **External-effect execution is simulated.** All executor adapters are local simulations (no egress);
  a static scan (`scripts/validate/no-unauthorized-effects.mjs`, `npm run validate:authority`) proves
  confinement of execution to `effects/executor.ts` and absence of outbound fetch in worker code.
- **Privacy visibility is server-side.** `RESTRICTED`/`LP_PRIVATE`/`MNPI_SENSITIVE`/`BANKING_RESTRICTED`
  rows require the MP role or an `authority_scope` grant (`scope_key='privacy_label'`); filtering happens
  in SQL, not in the client.
- **Human self-approval is permitted.** A human holding a required approver role may decide a card they
  requested (the MPs operate solo at this stage). AI/SYSTEM actors can never decide, requested or not.

### ADR-010 — P4 governed-AI implementation notes
- **Privacy mode lives on `budget_policy`.** The approved plan described firmwide privacy mode as
  "budget_policy/kv config". KV is ephemeral-only (D1), and the privacy mode is institutional policy,
  so `budget_policy` carries both `cost_mode` and `privacy_mode` in one versioned, immutable row.
- **Seeded default policy is LOCKDOWN.** Fail closed: no external egress until an MP changes policy
  through the reserved `governance.policy_change` approval path. Placeholder caps ($25/day, $2/run)
  are operator-maintained config, not a cost claim.
- **Kill switch uses the governance path.** Per the approved P4 plan, provider kill-switch and enable
  both route through `authorize()` with `governance.policy_change` + an approved receipt. MP
  self-approval (ADR-009) keeps the emergency brake one human gesture: create card → approve → call
  with receipt. Every toggle appends `provider.kill_switched` / `provider.enabled` to the spine.
- **Boundary scan scope.** `scripts/validate/no-direct-provider-calls.mjs` scans `src/**` (executable
  code). Provider hostnames legitimately appear in `migrations/` and `scripts/seed/` as seeded
  CONFIG DATA (provider_registry rows, D9); they can perform no calls there.
- **P4 action keys.** `ai.run`, `ai_employee.tool_scope.grant`, and `ai_output.accept` were added to
  the registry source (`actionTypes.ts`); migration 0004 carries compensating `INSERT OR IGNORE`
  rows for databases that applied 0003 before P4 existed.
- **No AI→effects path exists in P4.** `runAi` never touches `effects/executor.ts`, so
  `no-unauthorized-effects.mjs` needed no extension; any future AI-requested external effect must
  create an approval card like any other actor.

### ADR-011 — P5 evidence/provenance implementation notes
- **`knowledge.promote` joins the reserved register.** Promoting evidence into durable
  institutional memory is human-reserved (governing law applied to D16); the canon register has
  no key for it, so it was added to `reservedActions.ts` under the same "implied by the approved
  plan" section as `identity_merge.execute`/`governance.policy_change`/`ai_employee.activate`,
  approver role `MANAGING_PARTNER`. Register semantics are unchanged.
- **Self-promotion ban is three-layer.** (1) Service level: `createClaim` refuses VERIFIED without
  a HUMAN extractor + a DOCUMENT/HUMAN_STATEMENT source; `verifyClaim` refuses AI-extracted claims
  and source-poor claims (409 `self_promotion_ban`). (2) Database:
  `CHECK (NOT (extracted_by_type='AI' AND claim_status='VERIFIED'))` on `diligence_claim`.
  (3) Route level: there is no generic claim status-update route at all (404).
- **Human accept re-attributes, never erases.** The only path from AI_INFERRED to VERIFIED is
  `POST /api/claims/:id/accept`: a human attaches a DOCUMENT/HUMAN_STATEMENT source and takes
  authorship (`extracted_by` becomes the human); `ai_run_id` and a `claim.accepted` spine event
  keep the AI origin traceable. AI never promotes itself; a human stands behind every VERIFIED claim.
- **Document upload encoding is base64 JSON.** The API is JSON-first; base64 keeps upload
  exercisable from vitest/Playwright without multipart parsing. 5 MiB decoded cap per upload.
  Binary content lives only in R2 (`WP_OS_DOCUMENTS`); D1 holds metadata/provenance (§9.1).
- **Extraction candidate parsing is deterministic and local.** In LOCKDOWN/LOCAL the mock-local
  adapter returns unstructured text, so `parseClaimCandidates` structures `metric: value` lines
  from the source document. A real provider's structured output would replace this parser;
  real provider extraction is UNPROVEN — CREDENTIAL GATE.
- **Extra provenance columns.** `claim_source.created_by` and `contradiction_record.proposed_by_*`
  were added beyond the plan's column list: provenance of who attached a source and who proposed
  a contradiction is required by the phase's own rules (AI proposals record proposed-by).

### ADR-012 — P10 LP / data-room implementation notes
- **Evidence must be CURRENT, not merely VERIFIED.** `checkEvidence` refuses a diligence claim that
  carries `superseded_by`, even though P5 correctly leaves such a claim VERIFIED and readable. A
  superseded figure is exactly the kind of stale number an LP claim must not rest on, so LP
  substantiation asks a narrower question than P5's status enum answers. Substantiation is re-checked
  at PUBLISH time, not only at submit: evidence can decay between review and publication.
- **Publication needs two independent gates.** Approved evidence and an approved
  `lp_marketing_claim.approve` receipt (MP or COMPLIANCE_OFFICER, per the canon register). Both are
  checked in the service, so no route can satisfy one and skip the other.
- **The receipt is presented, never discovered.** `authorize()` does not search for an approved card
  that happens to match the action and object; the caller supplies `approval_receipt_id`. This is
  deliberate — auto-discovery would let an unrelated approval authorize a later act.
- **No native VDR, and no bytes on the LP surface.** `data_room_artifact.provider_ref` points at the
  EXTERNAL room; there is no download/content route under `/api/lp/**` (404 by absence), and
  `vdr_state` is labelled `UNPROVEN — PROVIDER NOT SELECTED` on the listing itself.
- **Revocation is a new row, not an edit.** `data_room_access_record` is append-only by trigger;
  `data_room_revocation` is a separate append-only table and effective status (ACTIVE / EXPIRED /
  REVOKED) is COMPUTED at read time. Nothing rewrites a grant that actually happened.

### ADR-013 — P11 allocation implementation notes
- **New arithmetic gets its own verification pass.** `src/shared/allocation/` holds only formulas that
  did not already exist: capacity, concentration, reserve coverage, and constraint evaluation. Each is
  hand-worked in `docs/ALLOCATION_VERIFICATION.md` with fixtures in `tests/allocation.test.ts`.
  Fund-construction and follow-on path economics are NOT re-derived — P11 calls the D6-verified
  `computeFundModel` / `computeFollowOn`, because a second copy is a second thing to verify and a
  second thing to drift.
- **Verification is not acceptance.** `docs/ALLOCATION_VERIFICATION.md` is engineering verification of
  arithmetic. The §7.2 formula-verification gate is the operator (or a designated reviewer) accepting
  it, and that has not happened. The ledger says so.
- **Concentration is cost-based.** Measuring on marked value would let an unrealised write-up create
  concentration headroom — the fund could breach a limit by believing in itself. A policy that states
  no limit produces NO limit rather than an invented threshold (same rule as P8 severity bands).
- **Each option type routes to its own reserved key.** `OPTION_DECISION_ACTIONS` maps RESERVE →
  `reserve_allocation.approve`, FOLLOW_ON → `follow_on.approve`, and the rest →
  `capital_allocation_cross_sleeve.approve`. All three already exist in the canon register; a receipt
  for one can never decide another.
- **A decision is not a capital movement.** Approving an option records a human decision and, for
  RESERVE, writes a `reserve_allocation` reservation. No P11 code path moves money;
  `capital.move_or_commit` and `wire.initiate_or_authorize` remain separately reserved, and the
  `allocation.option_decided` spine event records `capital_moved: false` explicitly.
- **Runs are immutable and rank nothing.** `cross_sleeve_comparison_run`, its per-option results, and
  `constraint_violation` are all UPDATE/DELETE-rejected by trigger, and no result column carries a
  rank, score, or recommendation. Modelled outcomes are labelled `MODELLED SCENARIO — NOT AN
  EXPECTED RETURN` on both the run row and the scenario read.

### ADR-014 — P12 reporting / reconciliation implementation notes
- **Required reviews are ROWS, not a flag.** Submitting a packet opens one PENDING `reporting_review`
  per required function (FINANCE, COMPLIANCE, MANAGING_PARTNER). Distribution reads those rows, and a
  reviewer must actually hold the function they sign off for — compliance cannot cover finance.
- **The review gate is checked BEFORE the receipt.** An unreviewed packet is refused before any
  authorization receipt is read, so a valid send receipt can never stand in for a missing review.
  Distribution then needs the reserved `lp_sensitive_communication.send` receipt as a second,
  independent gate (P10 law: LP-facing material is human-gated).
- **No-overwrite is enforced in the database, not the service.** A trigger on
  `fund_reconciliation_exception` rejects any UPDATE that touches `administrator_value`,
  `internal_value`, `record_key`, `field`, `run_id`, or `exception_kind`; only `status` may move.
  This holds for every actor — including a Managing Partner, including direct SQL — because "the
  administrator remains authoritative" is a property of the data, not a promise made by a code path.
- **Restating an official figure is reserved; escalating is not.** `ACCEPT_ADMINISTRATOR` and
  `CORRECT_INTERNAL` change what our books say and need an
  `official_valuation_or_capital_account.change` receipt. `ESCALATE_TO_ADMINISTRATOR` and `NO_ACTION`
  change no number and need none.
- **West Peek OS never writes to an administrator system.** The import is read-only by construction:
  it accepts supplied records and compares them. Runs are stamped `LOCAL_FIXTURE` until a real
  administrator source contract exists (§7.2), and `reconciliation.run_completed` records
  `administrator_records_written: 0`.
- **Certification is absent by design.** No P12 table carries a `certified` / `audited` /
  `gaap_compliant` column, and a test asserts their absence. The packet listing states plainly that
  no financial, accounting, or valuation correctness is certified (§12.4).

### ADR-016 — Every review state needs an exit (final-review finding)
A final review pass over P10/P12 found the same defect in both: a **negative** disposition was
recordable but nothing consumed it, leaving the object in a stale state with no way back into
review through its own surface.

- **P10.** `lp_claim.status` included `REJECTED`, and `submitLpClaim` accepted it as a revisable
  starting state — but nothing ever *set* it. A claim whose `lp_marketing_claim.approve` card was
  rejected stayed `PENDING_REVIEW` and could not be resubmitted (`illegal_state`). Fixed with
  `rejectLpClaim` / `POST /api/lp/claims/:id/reject`, which resolves the dangling card through
  `decideApproval` and sets `REJECTED`, closing the loop the enum already implied.
- **P12.** A `REJECTED` reporting review made `all_complete` permanently false while
  `recordReview` refused to re-record it and `submitPacket` accepted only `DRAFT` — an unreachable
  state. Fixed by moving the packet to `WITHDRAWN` (already in the schema, previously unused).

**P6 carries the same rule (finalization gate).** Probing found the identical shape in
`submitTransactionForApproval`: a transaction whose card was rejected kept `PENDING_APPROVAL` with no
way to request a new card. It now applies the same card-disposition rule. It is deliberately NOT
auto-VOIDed — `VOID` means "reverse a booked transaction", carries position effects, and is
MP-reserved via `transaction.void`; a refused submission booked nothing.

**Severity correction (measured, not assumed).** Earlier revisions of this ADR and the ledger
described the P10 case as leaving the claim "unpublishable" and "bricked". That was an over-claim,
and probing disproved it: `publishLpClaim` gates on the *receipt*, not on `lp_claim.status`, so a
`PENDING_REVIEW` claim publishes normally once any valid `lp_marketing_claim.approve` receipt is
presented — including one minted through the generic `/api/approvals` surface. The real defect was
narrower and still worth fixing: a **stale, misleading status** plus **no path back into review
through the LP surface**. The P12 case is genuinely blocking, because distribution reads the review
rows themselves rather than a receipt.

**Why the two fixes differ.** An LP claim is *language*: it is revised and re-reviewed, and the
prior rejected card survives as history, so returning to `REJECTED` loses nothing. A reporting
packet is a *published financial statement*: you do not un-reject one, you issue a corrected
version. `WITHDRAWN` is therefore terminal, the rejection row is preserved verbatim, and the path
forward is a new version of the same period — the same supersession rule the rest of the system
follows.

Refusing needs the approver ROLE but no receipt (P6 precedent, `ic.ts`): declining to authorise is
not itself a reserved act. `authorize()` still DENYs anyone who could not have approved, and AI
actors are refused outright.

**Correction (final repair pass).** The first version of this fix was incomplete. It added a correct
LP-specific path (`POST /api/lp/claims/:id/reject`) but left the *ordinary* path open: a reviewer
works in the generic **Approvals** surface, which rejects the approval CARD through
`/api/approvals/:id/decide` and knows nothing about `lp_claim`. That route left the claim in
`PENDING_REVIEW` — the exact dead-end the ADR claimed to have closed, still reachable by the path
most reviewers actually take.

`submitLpClaim` now treats **the card's own disposition** as the authority on whether review is
over: a claim in `PENDING_REVIEW` whose linked card is `rejected` or `revise_requested` is
revisable, however that refusal was expressed. A card still in `pending_review` is not — nobody gets
to resubmit around a live review. The lesson generalises: when object state mirrors approval state,
the object must read the card rather than trust that every writer remembered to update it.

### ADR-015 — Restore drops and re-creates append-only triggers
The append-only/immutability triggers stop the APPLICATION from rewriting institutional history — and
they also reject the DELETEs a faithful reload needs, which broke `restore.mjs` as soon as immutable
tables spread beyond `event_record`. A restore is a privileged administrative rebuild, not an
application flow, and it is already gated behind `--force`, so `restore.mjs` now records every trigger's
own `CREATE` SQL from `sqlite_master`, drops them for the load, re-creates them, and **verifies the full
set is back** before reporting success. A restored database that silently lost its append-only
enforcement would be worse than a failed restore, so that verification is a hard failure, not a warning.

### ADR-017 — Scheduling is a Cron Trigger over D1 state; no Queues, no Durable Objects
GAP-21 asks for the *smallest* architecture that satisfies the firm's real recurring workload. That
workload, enumerated honestly, is: a daily intelligence brief, a periodic portfolio-alert
evaluation, and occasional scheduled employee tasks. Coarse-grained, low-frequency, and needing
durable history far more than throughput.

D1 already gives durable state with append-only history and transactions. The only thing missing was
a clock, and Cloudflare Cron Triggers are exactly a clock. So: **one cron trigger** calls the
Worker's `scheduled()` handler, which selects due `scheduled_job` rows and runs each through the
same governed path an operator uses by hand.

**Queues and Durable Objects are refused.** A queue would add at-least-once delivery semantics,
consumer concurrency, and a second failure surface to a workload that runs a handful of jobs a day;
a Durable Object would add a coordination primitive where a `next_run_at` column and a UNIQUE
idempotency key already prevent double execution. AGENTS.md is explicit that Cloudflare products are
not added because they exist, and neither earns its complexity here. If a future workload genuinely
needs fan-out or per-item retry at volume, that is the moment to revisit this — and it will be a
visible change, not a silent one.

Three consequences worth stating plainly:

1. **A cron trigger cannot fire under local `wrangler dev`.** The same function is therefore
   reachable at `POST /api/jobs/tick` and is called directly in tests, which is how the scheduled
   path is proven offline. Remote *firing* stays UNPROVEN until deployment — the code path is
   proven; Cloudflare calling it is not.
2. **Governance refusals are outcomes, not errors.** A job whose employee is not ACTIVE, whose
   machine is paused, or which is itself paused records a `REFUSED` run with the reason, and is not
   retried. Retrying a governance refusal would be trying to wear it down.
3. **Genuine failures retry to the job's own limit and then stop** in `DEAD_LETTER`, where a human
   can see them. Nothing loops silently.

### ADR-018 — Standing authority is a third tier, bounded three ways, and can never reach a reserved action
Operator ask, 22 Aug 2026: a way to approve something and stop being asked about it again for this
task, today, or this week — with the design decided rather than put to her.

**The frame is delegated authority, not dismissal.** An LPA lets the GP act within stated limits
without returning to the LPs; a board delegates spend up to a threshold; a desk sets a daily limit.
Each carries a scope, a limit and an expiry, and each is revocable. Authority is delegable; judgment
is not. That distinction is what makes the tier safe rather than what makes it convenient.

`authorize()` gained one tier, checked in a deliberate position:

    receipt → reserved → external effect → RESTRICTED (role gate) → STANDING (delegated) → ordinary

**After reserved and external, never before.** A standing grant therefore *cannot* cover the 53
human-reserved actions or the 4 external effects, and that is enforced in the choke point rather
than in the interface — an interface rule is a suggestion, and this one protects the operator's own
standing line that no AI employee emails anybody yet. `grantStandingAuthority()` refuses such a grant
at creation as well, so the impossible state cannot be recorded even briefly.

**All three bounds are required at creation.** Scope (one action key, optionally one object), a use
limit, and an expiry — end of this task, end of today, or end of this week. There is no unbounded
option, and `ends_at` is NOT NULL.

**Expiry-by-default is the safety property, not the convenience.** A grant that never expires becomes
permanent through neglect: revoking it requires first remembering it exists, and the reason it was
granted was to stop thinking about the thing. Expiry inverts the default so authority returns
without anybody acting. "Until this work card closes" is the recommended option because its lifetime
is bounded by a real event rather than by a clock that runs overnight.

**Refused, deliberately:** a blanket "approve everything today"; a silent "remember my choice"
checkbox; any grant without a written reason. The first is abdication rather than delegation; the
second creates authority nobody can find later; the third is unreviewable.

Work-card volume is handled in the same change and is deliberately NOT part of this tier. Duplicate
suppression is a uniqueness rule that is always on and joins the existing card rather than refusing.
Rate limits (20 per employee per rolling hour, 60 open) are a HEALTH SIGNAL routed through
`healthEscalation.ts`, not a permission — a permission gate on volume would deliver a runaway to the
partners as forty approvals instead of stopping it. Full reasoning in `docs/APPROVAL_AND_WORK_DESIGN.md`.

### ADR-019 — A meeting is captured in the browser, and a deal reaches the committee by moving one stage
Operator, 22 Aug 2026: "the meeting tab is not good enough it is not self explanatory from looking
at the page what im able to do. and the IC flow ----who makes the packet how does that get done? how
do we get thru the pipeline and what happens to the page once a deal is at the IC stage?"

Four questions, and the honest answer to all four before this change was that nobody had decided.
The machinery existed — consent records, transcript gates, close-out extraction, a diligence
framework, an append-only decision — and none of it had an owner, a trigger, or a page that said so.
This ADR decides the whole shape, including the two parts it deliberately does not build.

**Poppy makes the packet, and the packet's missing half is a list of questions rather than prose.**
She is the IC Facilitator; she already holds `ic_decision` and `ic_learning_loop`; assembling the
packet is literally her stated job. The packet is DRAFTED from what the firm already holds —
verified claims, diligence answers, portfolio metrics, deal math — and **every gap becomes a named
question owed by a named person** instead of a paragraph. A packet that invents its missing half is
worse than a short one: it reads as complete, so nobody goes looking. `ic_open_question` (migration
0131) is where those gaps live, each carrying what the firm looked at and did not find.

**Pierce is always the champion, so Pierce may never write the kill case.** That rule already
existed in `icPortal.ts` and is now also what decides who a question is addressed to: the bear-case
questions are owed by a partner who is not carrying the deal, and the ordinary diligence questions
are owed by the champion. Otherwise IC becomes a sales meeting for the investment, which is the
firm's own stated reason for the rule.

**A deal reaches IC by a stage transition, not by anybody remembering.** `DILIGENCE → IC_READY` on
the Dealflow spine now creates an `ic_packet` in DRAFT and opens a WORK CARD for Poppy to assemble
it. Nothing auto-decides and nothing auto-answers; the card is the mechanism, exactly as inbound
email opens a card for Wyatt rather than quietly creating a company. Re-entering the stage does not
mint a second packet — an open packet is found and left alone.

**An IC rejection sends the deal to the pass pile, and that is a bug fix as much as a decision.**
`IC_DECIDED` could only move on to `CLOSED` or `WITHDRAWN`, so a deal the committee rejected was
stranded in a state whose only forward move said the fund invested. REJECT now transitions the
opportunity to `PASS` carrying the decision's own rationale as the reason, which is why a REJECT
requires a rationale in a sentence: for a fund the record of what it declined is half the value of
the pipeline, and the reason is the whole of that half. Nothing is deleted; PASS already reopens at
SCREENING when a company comes back.

**Capture is in-browser, chunked to Workers AI Whisper on the existing `AI` binding.** No new
vendor, no new credential, nothing added to the egress allowlist — the same argument that made
Workers AI the cheap text tier and Browser Rendering a binding rather than an HTTP client. The
alternative everyone reaches for is a recording bot that joins the call, and it was refused for a
product reason rather than a cost one: **the firm's employees have to be able to talk to the
partners DURING the meeting.** Live Help is already built, seated, capped and revocable, and a bot
sitting in the call cannot be conferred with — it can only hand back a transcript afterwards. A
capture that runs in the same page as the conversation keeps the seated employee reachable while the
meeting is still happening, which is the entire point of having seated an employee at all.

**Consent is prompted and logged before capture starts, every time.** California is a two-party
state; New York and Georgia are not. A firm whose partners sit in one and whose founders sit in the
others cannot run on "usually fine". The consent machinery was already correct and already unused:
`consent_record` is append-only, human-only, revocable, the current state is the latest row per
(meeting, consent type), and `importTranscript` refuses and RECORDS the refusal when consent is
missing — so "we did not record" is auditable. What did not exist was the PROMPT. Capture now cannot
start without one, the prompt is shown every time rather than remembered, and both gates it depends
on — the activated recording policy and granted consent — are named on screen in plain words before
anybody presses anything. A remembered consent is the failure mode here: consent is given by a
person in a room on a day, and a checkbox that carries it forward to the next meeting is a record of
something that did not happen.

**Whisper is UNPROVEN and the button says so.** The transcription path is written, governed and
reachable, and it has never run against a real model: the `AI` binding does not exist under local
miniflare, there is no offline fixture that would prove anything, and this change deploys nothing.
So the capability is probed at runtime and the button is DISABLED with the reason on screen wherever
the binding is absent. It is never rendered as live and inert. When a chunk fails to transcribe the
page says which chunk and why, rather than dropping it — a transcript with a silent hole in it is
worse than a short one, for the same reason a packet with an invented middle is.

**A shared live room for both Managing Partners at once is designed here and DELIBERATELY NOT
BUILT.** It is also the one thing in this whole design that would genuinely justify a Durable
Object, which ADR-017 refused and AGENTS.md forbids without cause. The cause would be real: two
partners typing into one meeting room needs presence ("Sequoia is here"), ordering (whose line came
first when both typed in the same second), and a single authority both browsers agree with — and a
`next_run_at` column, a UNIQUE key and polling give none of those. Every other coordination problem
in this system is coarse and low-frequency; this one is per-keystroke and inherently multi-client,
which is exactly the boundary ADR-017 said would be the moment to revisit the decision.

It is deferred anyway, and the reason is not doubt about the design. Everything else in this change
is D1 rows written through the existing choke point — it can fail, but it fails the way the rest of
the system already fails, and a partner sees a refusal. A Durable Object adds a second coordination
primitive and a second failure surface: a room that is up while the Worker is down, or down while
the Worker is up, and a class of bug ("the other partner's line never arrived") that is invisible in
D1 and cannot be reconstructed from the event spine. Both partners in one room is worth that price
one day. It is not worth it in the same change that first makes the page legible, and shipping it
alongside would make every problem in the page ambiguous between the two. **Designed, written down,
not built** — and when it is built it will be a visible change with its own ADR, not a silent one.

**The page is flat and always renders every section, LP-shaped.** Five sections in the order a
partner asks in: what is coming up; what happened and what came out of it; start a meeting now;
where a deal stands with the committee; and last, how a meeting becomes work. An empty section
states that it is empty and why, because "nothing has reached this yet" and "this is broken" look
identical otherwise — the same defect the IC sequence block was written to fix, applied to the whole
surface. The explainer goes last: a page that explains itself before showing anything is a page you
have to read before you can use.

**A transcript the firm did not record comes in by paste or file, not by API.** Operator, same day:
"i sometimes have fireflies meeting notes so the meetings should have fireflies and whisper
capabilities to transfer those notes and transcripts." Both paths land in the same place — turns on
the meeting, through the same two gates — and they are reached differently on purpose. A Fireflies
API integration needs a credential, a declared network boundary and a vendor decision, and
`validate:network-boundary` exists precisely to stop an outbound host appearing outside a declared
adapter. An export the operator already has in her hand needs none of that and works today. **The
API route is designed and deferred on the same terms as the shared room**: it is a second vendor
relationship for a convenience the paste box already delivers, and the day it is built it will be a
visible change with its own credential in the vault.

Three rules govern what an imported transcript IS, and each exists because getting it wrong is
silent:

1. **Importing is never consent.** The firm did not ask anybody anything by pressing a button;
   somebody else made that recording under conditions nobody here witnessed. Nothing in the import
   path writes a GRANTED consent row. The two existing gates still apply — taking custody of a
   recording of a conversation is the governed act, not the button used to do it — so an import
   without an activated policy and granted consent is refused and the refusal is recorded.
2. **The source travels with the transcript.** `source` already said PROVIDER / NATIVE / MANUAL /
   UPLOAD, which is the right shape at the wrong resolution: "PROVIDER" does not tell a reader who
   recorded this. `transcript_import.provider_name` names the vendor, and the record says in words
   that the firm cannot vouch for the permission the recording was made under. A turn West Peek
   captured and a turn out of somebody else's export are both usable and are not the same evidence.
3. **The parser never guesses who spoke.** Exports vary — speaker labels, timestamps, both, neither.
   A line that cannot be attributed with confidence is kept and marked as unattributed rather than
   handed to the nearest name above it, because close-out extracts commitments from these turns and
   an invented attribution becomes a task assigned to somebody who was never in the room. The one
   place a line inherits a speaker is a wrapped continuation directly beneath one, with nothing in
   between. A stop-list keeps "Note:" and "Action items:" from being read as people — that failure
   is silent, looks exactly like a transcript, and poisons every line beneath it.

Fireflies' own summary and action items are filed as **theirs**, clearly labelled, and never as
speech: their model wrote those words and nobody in the room said them. The action items are
deliberately NOT turned into commitments on import. Close-out reads the notes and PROPOSES
commitments a person accepts, and a second path that assigned work straight out of a vendor's
bullet list would go around the only step in the chain with a human in it.

---

# Boss OS ADRs

`AGENTS.md` requires that canon deviations be recorded as ADRs. The Boss OS port made several and
recorded none — ADR numbering stopped at 019, all of them the chassis's, while the decisions that
put one product inside another's repository lived only in commit messages. These close that gap.

Decided or ratified 6 September 2026.

### ADR-020 — Boss OS is v21; the canon it implements stays v20

Three things carried a v20 label: the live product, the specification it implements, and a
deprecated earlier build in `REPO_OPERATOR_ARCHIVE/deprecated-repos/`. They were not distinguishable
from inside the product, because `BOSS_OS_VERSION` was never declared in `wrangler.toml` and the
fallback in `bossMount.ts` returned the literal string `"v20"` — so `/api/system/health` and every
snapshot payload identified the live build as the archived one.

**Decision.** The product is **v21**, declared explicitly in both wrangler profiles. The documents in
`docs/boss/` keep their `BOSS_OS_v20_*` filenames.

**Why the documents do not follow the product.** They are the authority, not the artefact. Every
`§`-citation in the code resolves against them by name, and the v20.1 plan's §1 forbids renumbering
preserved sections. Renaming the specification to match the thing it specifies would break the
citations that exist so a future reader can find out *why* a rule is there.

### ADR-021 — Which app mounts is decided by hostname, in the client

boss.sequoiataylor.com served West Peek Ventures' entire fund interface — West Peek branding, a
sign-in for `you@westpeek.ventures`, and Thesis, Dealflow and Portfolio down the side — because
`main.tsx` chose between the two apps by pathname and defaulted to the chassis. One business's
interface on another's domain, which is precisely what the owner's separation rule exists to prevent.

**It had to be fixed in the client.** The first fix was a 302 in the Worker's fetch handler and it
could never have worked: Cloudflare's assets binding answers `/` directly and the fetch handler is
never invoked for it. It deployed, and `/` still returned 200 with the chassis.

**Decision.** `BOSS_HOSTS` in `src/client/main.tsx` is an **allowlist**, not a pattern. "Does this
look like a Boss host" is a question with a wrong answer, and the wrong answer puts one business's
UI on another's domain. Anywhere not on the list keeps the old behaviour, so the chassis's E2E
journeys still drive it at `/` — they are the regression suite for the domain being removed.

### ADR-022 — One bundle, two apps, and only one ever mounts

Boss OS arrived as a complete SPA with its own shell, lock screen and stylesheet. Both apps define
global CSS and both own the whole screen, so loading them together would leave whichever stylesheet
lost the race silently restyling the other.

**Decision.** The import is dynamic and exclusive. This is the interim shape, not the destination:
when the fund domain is stripped, Boss OS becomes the root app and the branch goes away with it.

### ADR-023 — The Boss maintenance cadence belongs to Boss OS, not to the cron expression

`runScheduled` was called from the Worker's `scheduled()` handler on every tick of a quarter-hourly
cron inherited from the chassis job runner. It is documented as nightly everywhere it is mentioned.
Production reached 62 snapshots and 30.4 MB of R2 in under fifteen hours, on a database holding no
user data, because `audit_log`, `system_events` and `cron_runs` are all snapshotted and the run
writes to all three.

**Decision.** The trigger is hourly, and the cadence is enforced **inside `runScheduled`** rather
than by the cron expression: daily maintenance at or after 03:00 UTC, weekly snapshot, skipped again
when nothing of substance changed, retention to twelve.

**Why the guard stays even though the trigger was fixed.** A cadence that lives only in
`wrangler.toml` is one edit away from being wrong again, and the exported function would remain able
to run ninety-six times a day for whatever calls it next. The guard makes the cadence a property of
Boss OS.

The consequence, accepted: `boss_task_queue` no longer drains every fifteen minutes. A request that
may have queued something drains it itself, after the response, so the tick is a safety net rather
than the only thing that moves the queue.

### ADR-024 — Boss OS's stylesheet is outside the design-token scan, deliberately

`validate:design-tokens` scans `src/client/styles.css` only. Boss OS's stylesheet uses raw pixel
values throughout and declares no `--space-*` / `--text-*` scale.

**Decision.** Leave it outside, and say so rather than let it look like an oversight.

**Why.** The scan exists for a specific chassis defect — a purpose block running its sentence at
13px above a line at 12px, one pixel apart, which reads as a mistake rather than a hierarchy.
Retrofitting a scale onto a ported design would be a large cosmetic refactor with real regression
risk, on a stylesheet whose sibling is scheduled for deletion. `validate:brand` (colour declared
only in the token block), `validate:css-classes` and `validate:css-variables` all do cover it, so it
is not unguarded — only unscaled.

### ADR-025 — A detector may not report a grouping column as a finding

The sprawl report ran `GROUP BY lane, department HAVING COUNT(*) > 1` and the Team screen rendered
the result as "Two employees cover the same ground… Merge one before the roster grows again." On the
live roster that accused four employees who each do work nobody else does.

**Decision.** Evidence and recommendation are separated. `shared_departments` is a roster fact with
no verb. `overlapping_charters` measures similarity between standing orders and is the only signal
that carries a recommendation — and it shows its score, so the reader can disagree with the
measurement rather than only with the verdict.

**The general rule this states.** A detector that fires on the normal shape of the thing it watches
is as useless as one that never fires, and worse when it fires as an accusation with an action
attached. Every detector in this repository needs a test asserting what it must NOT fire on.

### ADR-026 — D10 reshaped for Boss OS: one principal, and a name convention that keeps two businesses apart

D10 was written for West Peek: *"MP names never AI employees. MPs: Scooter Taylor, Sequoia Taylor"*,
alongside a cap of five active employees. Neither clause fits here. Boss OS has one principal, not
two Managing Partners, and it already runs seven employees.

**Decision.** No Boss OS employee may carry the name of the principal it serves — Sequoia Taylor.
Boss OS names are drawn from a convention distinct from West Peek's, so an employee of one business
can never be read as the other's. The five-employee cap is West Peek's and does not bind Boss OS;
the Agent Creation Gate governs roster growth here, as it already did.

**The convention, stated so it can be checked.** West Peek's entire roster is P and W names — Paige,
Parker, Porter, Walker, Wren, Whitney. **Boss OS avoids both initials.** That is the whole of the
rule: the rest of the alphabet is free. It is a weaker constraint than an allocated letter and it
buys the only property that matters, which is that a name is never ambiguous about which business
employs it. An earlier draft proposed all-B names; the owner declined it, correctly — a
single-letter roster of seven reads as a gimmick and makes the names harder to tell apart, not
easier.

**Appearance is not part of this decision, or of any decision.** The owner directed that her
employees are Black women. That direction lives in `src/client/public/employees-boss/CASTING.json`
and nowhere else: there is no race, appearance or demographic column in `employees`, in the
registry, or in the worker, and none may be added. A face is a rendering concern; a charter is what
the system reasons about. The chassis's own casting sheet states the same rule, and this one
inherits it deliberately rather than by accident.

**Portraits say what they are.** Seven editorial headshots on a team screen are indistinguishable
from photographs of real staff. Every portrait's alt text and the manifest committed beside the
files state that these are AI-generated images of people who do not exist. That sentence is load-
bearing, not a disclaimer: the failure it prevents is a face later being taken for a colleague.

### ADR-027 — Seven employees, because the roster had more seats than jobs

The owner read her own roster and said it plainly: *"Task Intake, Repository, Knowledge,
Relationship… are not real roles someone can have when they work for a Boss."* They were names for
parts of a system wearing an employee's clothes. Her instruction on size was equally plain: *"u
decide how many employees i need — dont overengineer this. 1 employee can do multiple things."*

**Decision (migration 0175).** Eight seats become seven, and one new capability appears.

- **Task Intake merged into the Chief of Staff.** Its charter was *"classify what comes in, pick the
  existing employee, template or duty that fits"* — which is what a Chief of Staff **is**. Two seats
  for one function, and the sprawl banner had been pointing at the pair for weeks for the wrong
  reason (shared department) while being right by accident.
- **Model Router merged into Continuity, as Systems Manager.** One decided where work runs, the
  other kept the system rebuildable. Both are upkeep of the machine, and in an office this size one
  person does both. `emp_continuity` survives rather than `emp_router` because the suite already
  drives that id for the retire-through-review path.
- **Director of Research added.** Nobody on the old roster looked outward — every seat watched
  something inside the system. The Executive Intelligence Report is about markets, deals, policy and
  the news, so the Agent Creation Gate admits it rather than refusing it as sprawl.

**Merged, not deleted.** `lifecycle = 'merged'` with `merged_into` pointing at the survivor, which is
the shape `/employees/:id/merge` already writes, and queued work follows the survivor. An employee
brought back later returns as herself rather than as a stranger.

**The merge removed the detector's hardest near-miss**, which is worth recording: Chief of Staff and
Task Intake were the closest honest pair on the roster, and the answer turned out to be that they
were one job. `tests/boss/rosterOverlap.test.ts` now guards the next-closest pair — the Archivist and
the Director of Research, both of whom are about evidence and sourcing, and are still two jobs.

### ADR-028 — The morning coaching conversation is never stored, and consent is a constraint

The owner asked the right question: *"i feel like i should have the option to have a 1:1 conversation
with any model right? and keep it locked down? or can it only be locked down if its a local model?"*

**"Locked down" is two questions, which is why the airlock has two axes.** Where a conversation is
STORED she controls absolutely. What a model READS she cannot — a model must see a sentence to answer
it, and no contract turns that into a mechanism. Both halves are said on the screen where she
decides, because saying only the first would be the reassuring lie and only the second would hide
what she does control.

**Decision (migration 0177).** The conversation is never written to the cloud domain at all. There is
no `coaching_turns` table and there must never be one; the turns are React state in her browser. Two
things persist and neither is her interior life: her **consent** for the day, which is governance,
and the day's **mode**, which the agenda needs before it renders because §17 rewrites all four pillar
contracts to floors on a Recovery Day.

**`emotional_states` was NOT loosened.** It also backs the decision vault, the prediction vault,
manifestations and promoted memory. Reclassifying it to enable one feature would have opened all of
them, and none of those needed opening.

**A policy row with no table, deliberately.** `coaching_turns` is classified so the airlock can govern
whether a model may read the conversation, and has no table because LOCAL_ONLY residency is honoured
literally rather than by writing rows into Cloudflare's database and labelling them. The
classification validator declares the exception by name and checks it in BOTH directions — a
classified entity with no table is normally stale, and this one fails if a table ever appears.

**Consent named a backend and constrained nothing, until it did.** The endpoint recorded which
backend she approved — *"consent to Claude Code on her own Mac is not consent to OpenRouter"* — and
then called the router with no confinement, so a provider she never named could have answered her. It
did not, only because the other one happened to have no key. That is luck, not a guard, and it is the
shape this repository names: a guard that cannot reach the thing it governs. `RouteRequest.onlyProviderId`
narrows the candidate list before any screening, notes every candidate it removes in the decision log,
and refuses by name when nothing survives. It only ever takes candidates away, so it cannot promote
anything past privacy, capability, risk or budget.

**The consent screen had a hardcoded backend id**, and it named `bk_claude_code` — which is
agent-executed and cannot hold a conversation at all, since a turn would have become a task in a queue
waiting on the Mac agent. Any hardcoded id would have been a second list free to drift from the one
the router reaches. The server now reports which backends are commissioned AND carrying enabled
models, free ones first. Backend-to-provider comes from the wiring, never from matching
`credential_ref` against `api_key_var`: Workers AI stores `binding:AI` in one and `AI` in the other,
both true, and a SQL join on those columns silently drops the only free backend she has.

**Routing refusals are 409s.** `RoutingBlocked` always carried a message and a hint and nothing turned
them into a response — every refusal reaching an HTTP route came back as a bare 500 with the hint
dropped and was written to `system_events` as `unhandled_error`, putting deliberate refusals into the
log a person reads to find what broke. A policy refusal fails identically forever, so it is a conflict
with the request, never a fault on this side.

**What is registered, and what stays hers.** Workers AI is commissioned and provisioned: two models,
free, `unbenchmarked`, cleared only to low risk. They can carry continuity work. Becoming the
`rt_ops_default` primary still needs an operator-scored benchmark and an approved promotion card, and
this work did not touch either gate — note that the route's declared models are both Fireworks, which
has no key in production, so coaching runs on the continuity tier by design rather than by accident.

**One seeded slug did not exist.** `@cf/meta/llama-3.1-8b-instruct` is not in the account catalogue —
only the `-fp8` build is. The row provisioned cleanly, passed every validator, and would have failed
at the first call, landing on whoever typed the first sentence of a morning conversation.
`scripts/ops/provision-backend.mjs` now checks every slug against `wrangler ai models` before writing,
and hard-fails when it cannot check: an unreadable catalogue is an unanswered question, not a pass.

### ADR-029 — Her four documents are the agenda engine; v10.19 is dead

The owner supplied four documents and named what each one feeds. Only one of them — the Executive
Intelligence Report — had been built. The other three were the specification for a screen that was
already shipping something else.

| Document | Feeds | Was |
| --- | --- | --- |
| A-Player Mode OS Contract | the agenda engine — §15 runtime, §26 template, laws, floors, verdicts | not built |
| Billionaire High-Performance Coach | the coaching layer — laws, modes, tracks | not built |
| Executive Intelligence Report | Today's Executive Briefing block | shipped, ADR-027 era |
| Morning Movement / Somatic | the Body contract — exact sequences, bed-first, novelty | not built |

All three are now in `docs/boss/`. **v10.19 is dead** and the owner said so plainly when asked; the
A-Player contract supersedes it in practice and now in writing. `BOSS_OS_AI_Sovereignty_Continuity_Addendum_v1.md`
already recorded that v20 supersedes v10.19 — this closes the question rather than leaving it as a
"preserved baseline" a future chat might treat as live.

**Her four conflicts, and how each was resolved.**

**1 · Seven blocks versus five stages.** Day Flow rendered Morning Gate, Agenda Calculation, Today's
Contract, Midday Reset and Night Gate — every one of which is a stage of THIS SYSTEM, not a part of
her day. "0 of 5 stages complete" was a progress bar for the machinery, on the screen whose entire
job is telling her how far *she* has got. §15.2 has specified seven blocks from the beginning.
Migration 0178 adds `run_of_show`, and the gates become EVIDENCE: completing one closes the block it
speaks for. The three blocks no gate can speak for — the two wealth blocks and the food check — are
hers to close, because nothing this system observes proves she made a brokerage move or ate in her
lane. A gate never overwrites a block she closed herself; "she did it at 9" and "a gate implied it at
2" are different facts and the specific one wins.

**2 · A conversation versus a screen.** Already answered and already built — see ADR-028. The
morning coaching is a real 1:1 flow that stores nothing.

**3 · Three chats versus one system.** Confirmed by the owner: **Boss OS replaces Chat B.** Chat A is
the contract in the database, Chat C is the approval inbox.

**4 · Law 4 versus the Midday Reset.** The line she asked for, drawn in code. Law 4 says the day is an
execution environment and emotional spikes do not rewrite the morning plan; the Midday Reset exists to
adjust the day. Both are right, and the difference is not WHETHER the plan changes but WHY —
**stabilising** is reality changing (the Operator Discipline track: "plans execute unless reality
changes"), **renegotiating** is the same plan looking harder than it did at 7am. So dropping a
priority at midday now requires `because`, and the gate refuses without it. Deliberately not a block:
she can drop anything she likes, she just cannot do it silently. That is the track's other rule made
mechanical — "renegotiation must be explicit."

**The verdict does not guess, and that cost something.** §14.2 says "ask what was completed before
assigning a verdict; do not guess completion", so nothing infers a floor from the database — a closed
Run of Show block is not evidence she manifested. Floors are three-state: met, missed, and NOT
ANSWERED, which is why the Night Gate uses paired buttons rather than checkboxes. A checkbox would
collapse unanswered into missed and manufacture exactly the guess the rule forbids. A day with
nothing reported met but floors still unanswered is held open, not scored a Miss. §13.3's flexible
items cannot create a Miss, and the mechanism is that they are absent from `FLOORS` entirely.

**Blocks 08 and 09 were never waiting on a build.** Both rendered "awaiting substrate — lands in
Phase 12" for the whole port. The substrate was §11's three Modes and §10's five Tracks, a fixed set
she had already written down; the blocks were waiting on a DOCUMENT. Neither calls a model: a
rotating lens and a named mode are decidable from the day's state, so the faculty runs at $0 by
construction rather than by policy. §10.6's background track stays out of the rotation, because
promoting it silently would be this system changing her contract.

**The novelty engine needed a memory to be one.** The Somatic brain says "track recent movement
selections whenever history is available" — a novelty engine with no history is a random number
generator that repeats as often as it varies. `movement_log` is that history, and selection is
least-recently-used rather than random, which makes "avoid the same major movement on consecutive
days" literal instead of true-on-average. It is deterministic, so it never needs a model either.

**Bed-first broke in the copy, not in a movement.** §6.8: no standing, walking pad or outdoor walking
may appear in the minimum-viable fallback. Every movement in `body.ts` is bed-based — and the movement
FLOOR string still read "outside walk, walking pad, bed yoga or somatic all count", which put a walking
pad inside a recovery day's contract. Caught by a test that checks the whole rendered contract rather
than only the fallback list, which is the only way that class of leak gets caught.

**What is still absent, and says so by name.** §15.4 requires exact Spirit, Wealth and Execution
contracts — a gratitude sentence, a first money move, a first completion action. The Morning Gate does
not collect any of them yet, so `morning_agenda` names each as absent with its reason rather than
filling in a plausible sentence. Body is real because her documents specify it exactly. That is the
difference between this and the old `{available: false, reason: "the agenda engine lands in Phase 12"}`:
the absence is now specific and shrinking.
