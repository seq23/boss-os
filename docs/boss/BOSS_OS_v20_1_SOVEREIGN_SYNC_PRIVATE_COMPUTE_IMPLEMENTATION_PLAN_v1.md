# BOSS OS v20.1 — SOVEREIGN SYNC + PRIVATE COMPUTE AIRLOCK
## Implementation Plan v1

**Status:** APPROVED IMPLEMENTATION TASK — DEFERRED FOR LATER EXECUTION  
**Base System:** Boss OS v20 complete baseline snapshot, Phases 1–23  
**Target Project:** `boss-os-v20-clean`  
**Target Root:** `/Users/sequoiataylor/REPO_OPERATOR_PROJECTS/boss-os-v20-clean/WORK/boss-os`  
**Baseline Artifact:** `BOSS_OS_V20_COMPLETE_BASELINE_SNAPSHOT_PHASES_1-23.zip`  
**Baseline SHA-256:** `b5e8c570191eca5d335a4dbf7c2639d912d8b9950cef1ce4197f375b3f01809e`

---

# 1. PURPOSE

Boss OS v20 Phases 1–23 are complete and remain the immutable functional baseline.

This task does **not** create Phase 24 and does **not** reopen or rebuild Phases 1–23.

This task creates **Boss OS v20.1**, an additive security and continuity extension that provides:

1. safe synchronization between the private Mac runtime and the Cloudflare runtime;
2. a true Level-2 Private Compute Airlock;
3. locally stored and locally executed LLM capability;
4. hard data-residency and AI-egress controls;
5. offline-capable PWA capture and later synchronization for cloud-eligible data;
6. explicit conflict handling rather than silent data loss;
7. adversarial proof that sovereign/private data cannot reach external AI providers or cloud synchronization paths.

The governing privacy requirement is:

> Data designated LOCAL_ONLY or LOCAL_AI_ONLY must never be transmitted to Claude, Anthropic, OpenAI, OpenRouter, Fireworks, Cloudflare AI, or any other external inference provider.

This must be enforced technically, not merely by prompt wording or an approval card.

---

# 2. FULL INTENDED SYSTEM

Boss OS v20.1 operates as one logical personal operating system with two intentionally different execution domains.

## 2.1 Cloud Domain

Cloud Boss OS remains available through the existing Cloudflare architecture for cloud-eligible information and normal remote access.

Cloud domain may include:

- Cloudflare Worker application runtime;
- D1;
- R2;
- KV;
- Queues;
- scheduled jobs;
- approved external AI providers;
- PWA/browser access;
- Cloudflare Access and application authentication when production deployment occurs.

The cloud domain must never receive records classified as `LOCAL_ONLY`.

External AI providers must never receive context classified as `LOCAL_AI_ONLY`.

## 2.2 Private Domain

Private Boss OS runs on the user's designated private Mac or future private compute host.

Private domain includes:

- local Boss OS runtime;
- local database replica;
- local sync agent;
- local model runtime;
- locally stored model weights;
- local inference;
- local-only memory/data;
- private indexes/embeddings where implemented;
- private-compute logs;
- local encrypted backups.

The private model runtime must bind to loopback/private interfaces only according to the approved security design.

External model fallback is forbidden for private-compute requests.

If private compute is unavailable:

`PRIVATE COMPUTE UNAVAILABLE — NOTHING TRANSMITTED`

is the required fail-closed behavior.

## 2.3 Synchronization Domain

Synchronization exists only for data explicitly eligible to synchronize.

Cloud-eligible records may converge between local and cloud environments.

Local-only records must be rejected before serialization or transmission.

Sync must support:

- stable record identity;
- device identity;
- mutation identity;
- monotonic/version metadata;
- incremental pull;
- incremental push;
- retry safety;
- idempotency;
- tombstones;
- conflict detection;
- reconciliation;
- per-device cursors;
- health/status reporting;
- audit evidence.

There must be no assumption that two independently edited databases will merge safely without this protocol.

---

# 3. NON-NEGOTIABLE SECURITY MODEL

Every sync-relevant/sensitive record must have explicit policy metadata sufficient to enforce both residency and AI processing.

At minimum, represent two independent policy dimensions.

## 3.1 Data Residency

- `CLOUD_SYNC`
- `LOCAL_ONLY`

## 3.2 AI Processing

- `EXTERNAL_OK`
- `EXTERNAL_WITH_APPROVAL`
- `LOCAL_ONLY`

The architecture may use equivalent canonical enums if existing Boss schemas dictate different names, but the semantics must remain equivalent.

## 3.3 Hard Airlock Laws

For `LOCAL_ONLY` residency:

- never upload to Cloudflare D1;
- never upload to R2 cloud vaults;
- never place in cloud queues;
- never include in cloud sync payloads;
- never include in cloud exports;
- never cross the Firm OS bridge;
- never enter cloud snapshots;
- never enter remote telemetry;
- never leave the designated private environment.

For `LOCAL_ONLY` AI processing:

- never route to Claude/Anthropic;
- never route to OpenAI;
- never route to OpenRouter;
- never route to Fireworks;
- never route to Workers AI;
- never route to another internet inference API;
- never silently downgrade to another provider;
- never present an override that converts a sovereign request into external inference.

Failure must be closed.

## 3.4 Secrets and Runtime State That Never Sync

At minimum:

- API keys;
- provider tokens;
- cookies;
- active sessions;
- password/passcode material;
- private signing keys;
- local model weights;
- model caches;
- private local inference logs;
- machine-specific paths;
- private runtime credentials;
- temporary build/cache state.

---

# 4. PHASE / BATCH / SPRINT LEDGER

This v20.1 extension uses implementation batches, not new Boss OS canonical phases.

## Batch 1 — Privacy + Residency Foundation

Implement the canonical policy layer for:

- residency classification;
- AI-processing classification;
- protected-domain defaults;
- hard fail-closed policy evaluation;
- migration/backfill rules for existing records;
- safe default for unknown/unclassified data;
- audit evidence for policy decisions.

Acceptance:

- a LOCAL_ONLY record cannot serialize into a cloud sync payload;
- a LOCAL_ONLY-AI request cannot resolve to any external provider;
- unknown policy fails closed for protected operations.

## Batch 2 — Local Private Compute Runtime

Implement a local model-provider adapter compatible with the existing Boss model/backend registry.

Requirements:

- local inference process;
- loopback-only default binding;
- local provider registration;
- model capability metadata;
- privacy class = local/private;
- health probe;
- deterministic unavailable state;
- no external fallback;
- no external credentials required;
- local inference audit trail that remains local where necessary.

Use a model/runtime appropriate to the actual execution machine.

Current machine context at plan creation:

- Apple M2;
- 8 GB unified memory;
- approximately 117 GiB free disk.

The implementation should prefer a practical quantized local model rather than forcing an oversized model.

`llama.cpp` or an equivalent approved local runtime may be used after execution-time validation.

At least one local model must be successfully registered and exercised before this batch is considered locally complete.

Weights must reside outside the source repository in a protected local model directory and must not be packaged into ordinary Boss source ZIPs.

Model acquisition must use an official or explicitly approved source and obey applicable model licensing.

## Batch 3 — Sync Protocol + Change Ledger

Implement the synchronization substrate.

Required capabilities:

- mutation UUID;
- entity type/id;
- base version;
- resulting version;
- device id;
- timestamp;
- tombstone state;
- payload integrity/hash where appropriate;
- acknowledged state;
- idempotent replay;
- per-device sync cursor;
- transactional change recording with the underlying write.

A database mutation eligible for sync must not be considered successfully committed if its required change-ledger entry cannot be created consistently.

## Batch 4 — Cloud Sync API

Implement authenticated cloud sync endpoints for:

- push mutations;
- pull mutations;
- acknowledgement;
- cursor advancement;
- device registration/revocation;
- conflict return;
- health/status.

Requirements:

- no LOCAL_ONLY payload accepted;
- fail closed on unknown entity/policy;
- size/rate boundaries;
- replay resistance;
- idempotent mutation handling;
- audit trail;
- no secret-bearing entities;
- authorization scoped to the Boss user/device model;
- input validation and schema validation.

## Batch 5 — Mac Local Sync Agent

Implement local synchronization behavior:

- offline outbox;
- reconnect;
- push;
- pull;
- retry/backoff;
- idempotency;
- conflict persistence;
- tombstone handling;
- health state;
- last-successful-sync state;
- manual sync trigger;
- safe cancellation/restart.

The local runtime must remain fully usable while the cloud is unavailable for locally available data.

No cloud outage may cause LOCAL_ONLY information to be promoted into a cloud path.

## Batch 6 — Conflict Resolution + Entity Policies

Define and implement entity-specific merge policy.

Examples:

- append-only audit/events: merge safely;
- immutable evidence: preserve all;
- mutable user records: version conflict;
- decisions/capital/governance/private records: never silent last-write-wins;
- deletions: tombstones;
- generated/cache state: regenerate or exclude rather than reconcile.

Implement a conflict inbox/status surface showing:

- entity;
- local version;
- cloud version;
- common/base version where available;
- conflict reason;
- safe resolution actions;
- audit result.

Conflict resolution must itself create an auditable mutation.

## Batch 7 — Offline PWA Capture

Extend the browser/PWA architecture for cloud-eligible offline operation.

Requirements:

- IndexedDB or equivalent durable browser storage;
- offline outbox;
- reconnect flush;
- mutation IDs shared with canonical sync protocol;
- visible offline/sync state;
- retries;
- no API-response cache pretending to be synchronized state;
- no LOCAL_ONLY private Mac data distributed to browser clients.

The existing service-worker shell caching may remain where correct but must not be misrepresented as full offline data operation.

## Batch 8 — Private Compute UX + Airlock Visibility

Add clear user-facing controls/status for:

- where a record lives;
- whether it may sync;
- whether external AI may see it;
- local model availability;
- provider selected;
- private-compute status;
- sync status;
- conflicts;
- device status.

For sensitive operations, the UI must make the boundary legible without creating daily friction.

Defaults should protect privacy.

## Batch 9 — Adversarial Security + Leakage Testing

Build hostile tests that attempt exfiltration through every relevant exit path.

At minimum test LOCAL_ONLY / LOCAL_AI_ONLY data against:

- external model router;
- Claude adapter;
- OpenAI adapter if present;
- OpenRouter adapter;
- Fireworks adapter;
- Workers AI adapter;
- background queues;
- sync serialization;
- sync push API;
- cloud D1 writes;
- cloud R2/vault snapshots;
- exports;
- Document Compiler;
- prompt traces;
- analytics/telemetry;
- Firm OS bridge;
- continuity packages;
- error reporting/logging.

Tests must use recognizable sentinel secrets and prove they do not appear beyond the permitted private boundary.

A mocked refusal is insufficient if a real local integration layer can be tested.

## Batch 10 — Full Validation + Senior Security Review + Snapshot

After implementation:

- run full canonical Boss validation;
- run new sync integration tests;
- run offline/reconnect tests;
- run replay/idempotency tests;
- run conflict tests;
- run deletion/tombstone tests;
- run device revocation tests;
- run hostile privacy/exfiltration tests;
- run local-model integration proof;
- run build/type/lint/test suites;
- perform senior architecture/security/finality review;
- fix material locally repairable findings;
- rerun full validation.

Then package one cumulative Boss OS v20.1 full baseline snapshot ZIP from the correct WORK root.

---

# 5. CURRENT ARTIFACT SCOPE

The future artifact created by this task is:

**Boss OS v20.1 Complete Baseline Snapshot — Phases 1–23 + Sovereign Sync + Private Compute Airlock**

It must preserve all correct v20 Phase 1–23 functionality and add the v20.1 batches above.

This is a cumulative baseline, not a patch-only delivery.

---

# 6. NOT INCLUDED IN THIS ARTIFACT

Unless separately authorized, this task does NOT:

- reopen or renumber Boss OS Phases 1–23;
- provision production Cloudflare resources;
- change DNS;
- create a public production deployment;
- purchase a Mac Studio or other hardware;
- purchase software or model access;
- create paid provider accounts;
- create exchange accounts;
- deposit trading capital;
- place live trades;
- activate live Phase 22 trading;
- provision a trading server;
- fabricate external Phase 22 evidence;
- create unrestricted remote internet access to the private local model;
- synchronize LOCAL_ONLY content to phones/cloud;
- weaken existing approval or governance controls;
- merge into unrelated repositories;
- mutate Repo Operator itself.

Production cloud deployment is a separate later operational task.

Remote access to private compute from another device is a separate later security decision unless explicitly added by a new approved plan.

---

# 7. PROTECTED EXISTING ARCHITECTURE

Preserve the completed Boss OS v20 baseline.

Do not rebuild correct existing features.

Specifically protect:

- existing phases 1–23;
- existing migrations and data;
- approval architecture;
- audit architecture;
- memory classifications;
- governance;
- Firm OS separation;
- trading lane isolation;
- continuity/vault behavior;
- existing fail-closed provider behavior;
- current provider registry;
- existing artifact/source integrity.

Prefer additive migrations and narrow integration changes.

No destructive reset of the existing database is authorized.

---

# 8. DATA MIGRATION RULES

Existing data must be migrated conservatively.

Before backfilling classification values:

1. inventory entity types;
2. determine existing privacy/sensitivity semantics;
3. map existing sensitivity to new residency/AI policy;
4. choose privacy-preserving defaults;
5. document ambiguous classes;
6. test migration against a copy;
7. prove no data loss.

Restricted/private classes should default toward stronger protection rather than external eligibility.

No existing private record may become externally routable solely because a migration field was absent.

---

# 9. LOCAL MODEL SECURITY REQUIREMENTS

The private inference runtime must:

- run locally;
- use locally stored weights;
- avoid external inference calls;
- not require an external API key for inference;
- bind to loopback/private interface by default;
- expose a health/status endpoint only as necessary;
- avoid sending prompts/responses to telemetry;
- avoid provider SDK telemetry that transmits private data;
- keep logs minimal and appropriately private;
- be replaceable through the existing capability/model registry rather than hardcoded throughout the product.

Model weights are runtime assets, not repository source.

The repo should contain:

- adapter;
- configuration;
- model manifest metadata;
- install/setup instructions;
- integrity/hash support where appropriate;
- health checks;
- tests.

It should not contain multi-gigabyte model binaries.

---

# 10. SYNC SECURITY REQUIREMENTS

The synchronization layer must be designed assuming:

- devices can go offline;
- requests can be replayed;
- the same mutation may be delivered more than once;
- clocks can disagree;
- one side can change while the other is offline;
- a device may later be revoked;
- network requests can fail after the server commits;
- payloads can be malformed;
- users may edit the same record in two places.

Security controls must address:

- authentication;
- authorization;
- device identity;
- replay;
- rate limits;
- validation;
- privacy policy;
- audit;
- conflict integrity;
- failure recovery.

Do not use naive timestamp-only last-write-wins for critical mutable records.

---

# 11. FAILURE + FALLBACK BEHAVIOR

Required fail-closed cases include:

### Local model unavailable
Hold the private task locally.
Do not route externally.

### Cloud unavailable
Continue local operation.
Queue cloud-eligible mutations.
Do not alter LOCAL_ONLY policy.

### Sync authentication failure
Stop synchronization.
Do not discard the local outbox.

### Conflict
Record conflict.
Do not silently overwrite critical data.

### Duplicate mutation
Return previously known result / acknowledge idempotently.

### Unknown classification
Block sensitive egress.

### Revoked device
Reject sync.

### Corrupt payload
Reject and audit.

### Partial reconnect
Resume from durable cursor/outbox state.

---

# 12. VALIDATION PLAN

Minimum validation must prove behavior, not just file presence.

## Local integration

- local DB migration;
- local write;
- local change ledger;
- offline write;
- reconnect;
- push;
- cloud-side acceptance in test environment;
- pull;
- acknowledgement;
- repeat/replay;
- deletion;
- conflict;
- resolution.

## Privacy integration

Use sentinel content such as:

`BOSS_SOVEREIGN_SENTINEL_DO_NOT_TRANSMIT`

Create LOCAL_ONLY and LOCAL_AI_ONLY records/tasks.

Prove the sentinel does not reach any prohibited:

- external request payload;
- provider trace;
- queue payload;
- cloud sync payload;
- bridge handoff;
- cloud snapshot/export.

## Private compute

Prove:

- a local model is registered;
- request reaches local runtime;
- response returns;
- no external provider request occurs;
- local model outage fails closed;
- provider fallback is impossible for LOCAL_AI_ONLY requests.

## Full regression

Existing Boss validation must remain green.

No test may be weakened to make the extension pass.

---

# 13. DEPLOYMENT/RUNTIME CONSTRAINTS

This task implements deployable code but does not perform the production deployment.

The future production deployment should later be separately authorized and should include:

- custom domain;
- Cloudflare Access;
- Boss application authentication;
- Worker secrets;
- least-privilege Cloudflare resources;
- secure D1/R2/KV/Queue bindings;
- alternate endpoint review;
- production migration plan;
- rollback plan;
- post-deploy verification.

The cloud instance must never become a backdoor around private-residency law.

---

# 14. ARTIFACT REQUIREMENTS

At the end of future execution:

- package from the exact Boss WORK root;
- full cumulative baseline ZIP;
- exclude transient dependency/cache/build junk;
- preserve source, migrations, tests, docs and required operational assets;
- do not include local model weights;
- reopen ZIP;
- integrity check;
- verify root layout;
- verify critical files;
- verify v20.1 migrations/features/tests;
- compute SHA-256;
- produce receipt.

Artifact status must distinguish local implementation completeness from any later human/production deployment actions.

---

# 15. DEFINITION OF DONE

This v20.1 task is locally complete only when:

1. Phases 1–23 remain intact.
2. Residency classification is implemented.
3. AI-processing classification is implemented.
4. LOCAL_ONLY cannot sync to cloud.
5. LOCAL_AI_ONLY cannot route externally.
6. At least one local model is genuinely exercised through Boss OS on the designated private machine.
7. Local model outage fails closed.
8. Local/cloud sync is incremental and idempotent.
9. Offline outbox survives restart.
10. Tombstones propagate.
11. Critical concurrent edits produce conflicts rather than silent loss.
12. Conflicts can be resolved and audited.
13. cloud-eligible PWA offline capture works.
14. hostile leakage tests pass.
15. existing Boss tests remain green.
16. senior architecture/security review is complete.
17. material local findings are fixed.
18. final full v20.1 baseline ZIP is packaged and structurally verified.
19. receipt and SHA-256 are produced.
20. no prohibited external deployment or financial action occurred.

---

# 16. USER APPROVAL GATE

The future execution gate is:

> APPROVAL CHECK: This artifact implements Boss OS v20.1 Sovereign Sync + Level-2 Private Compute Airlock + local model integration on top of the completed Boss OS Phases 1–23 baseline. It does not deploy the production cloud environment, purchase hardware, provision paid services, expose private compute to the public internet, or perform live trading. Continue?

This approved task file may be installed in Repo Operator now for later execution.

Installing the task does not authorize starting the run until the user explicitly chooses to execute it later.

---

# 17. NEXT REQUIRED PHASE

There is no new canonical Boss OS phase.

The next implementation work is:

**v20.1 Batch 1 — Privacy + Residency Foundation**

After all v20.1 batches are complete, the next separate operational decision is whether to authorize secure production cloud deployment.

---

# 18. POST-DELIVERY CONTINUATION

When this task is eventually executed and delivered, report:

**Completed extension:** Boss OS v20.1 Sovereign Sync + Private Compute Airlock  
**Canonical Boss phases:** 1–23 remain complete  
**Remaining implementation batches:** none, if all v20.1 batches pass  
**External/human operations:** list separately and do not mislabel them as implementation phases  
**Next recommended artifact:** none unless a separately approved production deployment or private-remote-access task is requested

---

# 19. REPO OPERATOR EXECUTION LAW

When this task is eventually started:

- use the existing `boss-os-v20-clean` project;
- use the current v20 complete baseline as source of truth;
- retrieve governing Boss documents before implementation;
- preserve existing correct work;
- do not reset the repo;
- do not rebuild Phases 1–23;
- implement only real v20.1 gaps;
- use Claude-first routing under current Repo Operator law;
- keep exact-$0 OpenRouter only where current approved fallback law permits;
- private user data must never be supplied to implementation models as test fixtures;
- use synthetic sentinel data for privacy tests;
- perform full local validation;
- perform mandatory final Claude senior review;
- package one cumulative v20.1 baseline;
- do not deploy production without separate authority;
- do not merge/push unless separately authorized.

