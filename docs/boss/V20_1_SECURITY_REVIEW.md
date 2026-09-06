# Boss OS v20.1 — security and finality review

Date: 2026-09-06 · Reviewer: implementation pass, adversarial
Scope: Batches 1, 3, 4, 5, 6, 7, 8, 9 of the Sovereign Sync + Private Compute plan.
Batch 2 (local model runtime) is deferred by the owner and is a **NAMED STOP**, not an omission.

## Findings, in the order they were found

| # | Finding | Severity | State |
|---|---|---|---|
| 1 | **The continuity vault copied every sovereign record into cloud R2**, nightly, on a cron. All 18 `LOCAL_ONLY` tables were in `SNAPSHOT_TABLES`, and R2 is cloud storage. §3.3 forbids it explicitly. | **Critical** | Fixed. Exclusion derived from `data_policy`; proven in both directions and on the restore path. |
| 2 | **Conflict resolution wrote to `sync_ledger` directly**, the only path to the ledger that skipped `prepareMutation` and therefore the airlock and the never-syncs list. | **High** | Fixed. Resolution now passes the same admission check; the planted-conflict exploit is a test. |
| 3 | The restore drill counted deliberately excluded tables as **missing**, so it failed every night. A drill that always fails is switched off, and takes the real one with it. | Medium | Fixed. Snapshots carry their own exclusion list; the drill reads it and reports `excluded_local_only`. |
| 4 | `settings` is free-form `TEXT` key/value — the shape a machine path or runtime credential ends up in — and residency alone would have let it sync. | Medium | Fixed. Blocked outright by a second gate, so a misclassification is not sufficient to move a secret. |
| 5 | **The offline shell had never worked.** Three defects, each hiding the next: a redirected `/index.html` cached and unusable for navigation, the first visit never caching the hashed bundles, and the asset graph needing a crawl rather than one hop. | High (product) | Fixed, with a fourth: a stylesheet that failed to load blanked the page instead of unstyling it. |
| 6 | `lists-speak-while-loading.mjs` existed and **nothing invoked it** — not CI, not a test. It found 31 real violations the moment it ran. | Medium | Wired into CI and ratcheted: Boss's own surface must be zero, the inherited count may only fall. |
| 7 | The deploy script printed `err.stdout` while wrangler writes its diagnosis to **stderr**, so two real deploys failed with a blank reason. | Medium | Fixed. Both streams, and an explicit line when wrangler produced nothing. |
| 8 | Step 4 of the deploy said "deployed and verified" whether or not the health check connected. | Medium | Fixed. It retries, then passes or exits non-zero. |
| 9 | Inherited from West Peek: `var(--wp-accent)` referenced three times, defined nowhere; and one number answering two questions in the job runner, where an old failed occurrence took down the whole sweep. | High | Fixed upstream, PR #19 merged. |

## What is proven, and by what

- **Nine cloud exits**, hostile-tested with a sentinel: R2 snapshot, restore, knowledge export, sync
  serialization, the push API, the event log, the Firm OS bridge, outbound `fetch`, and the
  private-runtime negative — plus the airlock overview, the conflict inbox and the per-record
  lookup, which describe sovereign entities for a living and must never quote one.
- **Both directions.** A filter that removed nothing would pass forever, so the private runtime is
  asserted to *include* what the cloud one excludes.
- **Replay, conflict, tombstone, revocation, rate and size bounds** each have a test that fails for
  the right reason.

## Named stops — true, and not defects

- **Batch 2 is not implemented.** There is no local model runtime, so the plan's *local-model
  integration proof* cannot be run. `localModelStatus()` reports `DEFERRED — NO LOCAL HOST` rather
  than a status that reads like readiness, and the Airlock screen shows that verbatim.
- **`validate:value-shapes` requires a live remote D1** with data in it. Boss OS is commissioned but
  effectively empty, so the scan has nothing to shape-check.
- **Offline means capture, not operation.** The addendum forbids promising mobile access during an
  outage. Nothing in the product claims otherwise.

## Residual risk the owner should hold

- **The rate limit is measured from the ledger**, so refused and conflicted requests are bounded by
  the body/batch caps and the passcode session rather than by the limiter itself.
- **One passcode is the whole perimeter.** There is no second factor. Everything above assumes the
  session is honest; none of it survives the passcode being known.
- **The private half does not exist yet.** Every sovereign entity is currently classified, guarded
  and unreachable — and also unstored anywhere but cloud D1, which holds none of it. The airlock is
  correct in advance of the data, which is the right order and worth not mistaking for completeness.
