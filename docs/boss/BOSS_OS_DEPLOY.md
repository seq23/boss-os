# Deploying and operating Boss OS

Everything below is free tier for a single user, except R2 once your snapshots
get large. Expect a few cents a month at most, plus whatever your inference
provider charges.

## 1. Install and log in

```bash
npm install
npx wrangler login
```

## 2. Create the resources

```bash
npx wrangler d1 create boss-os-db
npx wrangler kv namespace create SESSIONS
npx wrangler r2 bucket create boss-os-vault
npx wrangler queues create boss-os-tasks
npx wrangler queues create boss-os-tasks-dlq
```

Each command prints an id. Paste them into `wrangler.jsonc`, replacing
`REPLACE_WITH_YOUR_D1_ID` and `REPLACE_WITH_YOUR_KV_ID`.

Both queues are needed. `boss-os-tasks-dlq` has its own consumer: without it,
messages that exhaust their retries disappear silently.

## 3. Set your secrets

```bash
npx wrangler secret put BOSS_PASSCODE
npx wrangler secret put SESSION_SECRET
npx wrangler secret put FIREWORKS_API_KEY
```

Pick a long passcode. It is the only thing between the internet and your OS.

## 4. Migrate and seed

```bash
npm run db:remote     # applies 0001–0004
npm run seed:remote   # 0002 only; 0004 is applied by the migration runner
```

Migrations are ordered and the seeds are idempotent — every insert is
`OR IGNORE`, so re-running them is safe.

## 5. Validate before you deploy

```bash
npm run validate      # typecheck, tests against real D1/R2/KV in workerd, build
```

## 6. Deploy

```bash
npm run deploy
```

Open the printed `*.workers.dev` URL on your phone, unlock, then use Share →
Add to Home Screen. It runs full screen with no browser chrome.

## 7. Optional: your own domain

Add a `routes` entry in `wrangler.jsonc` pointing at a hostname on a domain in
your Cloudflare account, then redeploy. A custom domain also lets you put
Cloudflare Access in front of the whole thing as a second gate.

---

# First-run checklist

- [ ] Unlock screen appears and rejects a wrong passcode
- [ ] `GET /api/health` returns `ok` without a session (uptime checks need this)
- [ ] Settings → Health: every check green. It touches D1, R2, KV, the queue
      binding, your secrets, and cron freshness
- [ ] Vault → "Restore drill": passes, covering every table with a matching hash
- [ ] Settings → Overview: both lanes' budgets appear, cost mode is `NORMAL`
- [ ] Team → send in a task, confirm it queues and comes back as an approval
- [ ] Trading: draft a paper order, approve it, confirm the position appears

**Correct the seeded model prices** in `migrations/0002_seed.sql` against your
provider's current rate card before you trust the cost ledger. They are
placeholders, and the ledger is only as honest as those numbers.

---

# Operator runbook

## Nightly cron

03:00 UTC, four steps, each recorded independently in `cron_runs`:

1. `roll_budgets` — rolls any budget window that has passed
2. `expiry_sweep` — expires overdue approvals and terminates their origins
3. `promotion_sweep` — evaluates memory promotion rules
4. `snapshot` — writes a full snapshot to R2

A step that fails does not cancel the rest. Settings → Diagnostics shows the
per-step result. A run marked `partial` means some steps worked and some did
not — read the steps, do not assume.

## "Nothing is running"

Check in this order:

1. **Cost mode.** `SHUTDOWN_MANUAL` stops all autonomous spend by design. Tasks
   queue but do not run. Settings → Overview.
2. **Budgets.** A hard-stopped lane at its limit blocks the router. Held tasks
   raise a `spend` approval; approving one releases that task.
3. **Routing decisions.** `GET /api/models/decisions` records why every
   candidate model was refused. `blocked_policy`, `blocked_budget`,
   `blocked_no_model`, and `ask_human` are all deliberate refusals.
4. **Dead letters.** Settings → Diagnostics. Requeue after fixing the cause.

## A task is stuck in `awaiting_approval`

It is waiting for you. Open the docket. If the approval was for a budget or
routing gate, approving it puts the task back on the queue; rejecting cancels
it. Nothing else clears that state, and nothing silently times out except the
expiry sweep, which cancels the origin too.

## Restore from a snapshot

1. Vault → **Verify** the snapshot you intend to use. Confirm the hash matches.
2. Take a fresh snapshot of current state first — `replace` is destructive.
3. `POST /api/vault/restore`:
   - `{"snapshot_id": "...", "mode": "verify"}` — writes nothing, proves it loads
   - `{"snapshot_id": "...", "mode": "merge"}` — fills gaps, existing rows win
   - `{"snapshot_id": "...", "mode": "replace", "confirm": "REPLACE"}` — wipes
     the covered tables and loads the snapshot verbatim
4. Every attempt is recorded in `vault_restores`, including the failures.

Run a restore drill monthly. It is one button and it is the only thing that
turns "we have backups" into "we can restore".

## Trading incidents

- **Kill switch** (Trading tab) engages immediately, cancels every unfilled
  order, and files an incident. It blocks drafting and execution until cleared.
- Orders that fail to execute are marked `rejected`, keep their error, and file
  an incident automatically.
- `GET /api/trading/ledger.csv` exports every fill with a `simulated` column.
  Paper fills say `yes`. Do not hand that file to an accountant without reading
  that column.

## Going live with trading

You cannot, in this build, and the refusal is intentional. There is no live
broker adapter. Recording all six micro-live gates is necessary but not
sufficient: `PATCH /api/trading/authority {"live_enabled": true}` returns `501`
because the code that places a real order does not exist here. Writing that
adapter is a separate, reviewed change, and the gates in
`src/server/trading/authority.ts` are where it must be enforced.

## Rotating secrets

`SESSION_SECRET` and `BOSS_PASSCODE` can be rotated with `wrangler secret put`.

Every session is issued carrying a fingerprint of `SESSION_SECRET`, so rotating
it ends every session immediately: existing cookies stop matching and the stale
KV records are cleared as they are hit. **This is what to do if a phone is lost
or you think a session cookie has leaked.** Rotating `BOSS_PASSCODE` changes
what unlocks the next session but does not end sessions already issued — rotate
`SESSION_SECRET` as well when you want both.

Wrong passcodes are rate limited per caller: ten inside fifteen minutes and that
caller gets `429` until the window passes, correct passcode included. The
counters live in the `SESSIONS` KV namespace and expire on their own.

## Where things are recorded

| What | Where |
|---|---|
| Every state change | `audit_log` |
| Structured diagnostics | `system_events`, and `wrangler tail` |
| Why a model was or was not used | `routing_decisions` |
| What a task actually did | `evidence_packets` |
| Approval decisions and their execution | `approvals`, `approval_events` |
| Nightly maintenance | `cron_runs` |
| Messages that gave up | `dead_letters` |
| Snapshot and restore history | `vault_snapshots`, `vault_restores` |
