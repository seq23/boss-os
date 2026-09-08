# Boss OS — how it actually runs

_Written 7 September 2026. This is the operating manual: who does what, when it runs, what it costs,
and what is deliberately not built. If something on a screen surprises you, the explanation is here._

---

## The one fact that shapes everything

**Agents research the open web. Local jobs read your accounts.**

The Claude Code runner strips every credential from its environment on purpose — anything matching
`KEY`, `TOKEN`, `SECRET` or `PASSCODE` is removed before the process starts. That is a deliberate
property of the sandbox, not a gap.

So an agent can search the web, open pages and write a file. It **cannot** unlock your vault, read
your mailbox, reach Search Console, or use your `gh` login. Anything that needs one of those runs as
a scheduled job on your Mac instead.

This is why some work has an employee's name on it but executes from `launchd`. The employee owns
the work; the job is the only thing that can do it.

---

## The employees, and what each one owns

| Employee | Role | Pillar | Owns |
|---|---|---|---|
| **Camille** | Director of Research | Wealth | Executive report, buyer sourcing, property performance |
| **Monique** | Director of Relationships | Wealth | The network refresh, backlink prospecting |
| **Danielle** | Technical Program Manager | Execution | The shipping heartbeat |
| **Imani** | Director of Practice | Body + Spirit | The week's practice, rituals, technique research |
| **Kendra** | Systems Manager | — | Tool scouting |
| Simone | Chief of Staff | — | No standing duty |
| Zora | Archivist | — | No standing duty |
| Toni | Chief Risk Officer | — | No standing duty |

Before 7 September, **Camille owned every duty in the system** and the other eight employees had a
department, a charter and no work. That is the same defect this codebase produces everywhere else — a
correct thing nothing invokes — at the level of an org chart.

Simone, Zora and Toni still have none. That is honest rather than finished.

### What the four pillars mean

Written in your language, and carried on every contract the Morning Gate produces, because
"§5.7: at least one concrete asset-advancing action" is a definition only its author could love.

- **Body** — keto, movement, discipline. Imani.
- **Spirit** — the sentence, the sequence, the ancestral hour. Imani.
- **Wealth** — money in: buyers, LPs, and the people who send you both. Camille and Monique.
- **Execution** — did anything you own actually get built or shipped. Danielle.

---

## What runs, and when

All times America/Chicago.

### Every day

| Time | What | Who | Where it runs |
|---|---|---|---|
| 06:30 | Executive Intelligence Report | Camille | agent |
| 06:35 | The Mac claims and executes pending runs | — | launchd |
| 06:50, 07:10 | Two more claim attempts, in case the first missed | — | launchd |
| 12:35, 18:35 | Later claim attempts, for anything dispatched by hand | — | launchd |

### Mondays, Wednesdays, Fridays

| Time | What | Who |
|---|---|---|
| 06:45 | Brokerage sourcing — new buyers, and who has gone quiet | Camille |

### Weekly

| Day | Time | What | Who |
|---|---|---|---|
| Monday | 07:00 | Shipping heartbeat + Search Console read | Danielle, Camille |
| Monday | 07:30 | Backlink prospecting | Monique |
| Wednesday | 07:00 | The packet reminder — notification + a markdown file | — |
| Thursday | 08:00 | Tool scouting | Kendra |
| Sunday | 17:00 | The week's practice | Imani |
| Sunday | 18:00 | Network refresh — re-read the mailbox, update the touch list | Monique |

### The launchd jobs

```
com.seq.boss-agent       claims and runs agent work        5×/day
com.seq.boss-packet      the Wednesday packet reminder     Wed 07:00
com.seq.boss-network     mailbox → touch list              Sun 18:00
com.seq.boss-properties  heartbeat + Search Console        Mon 07:00
```

Reinstall or repair them all with `npm run app:install` and `bash scripts/ops/install-agent-launchd.sh`.

---

## What it costs

**Claude Max is a flat subscription, so these are equivalent-usage figures, not a separate bill.**
That makes the scarcity worse rather than better: the employees and you draw on the same plan.
Running out does not produce an invoice — it produces a week where you cannot use Claude Code for
your own work because your staff spent it.

| Duty | Model | Cap | Cadence | Per run | Per month |
|---|---|---|---|---|---|
| Executive report | Haiku | 5 min | daily | ~$0.15 | ~$4.50 |
| Buyer sourcing | Sonnet | 5 min | Mon/Wed/Fri | ~$0.30 | ~$3.90 |
| Backlinks | Haiku | 10 min | weekly | ~$0.20 | ~$0.90 |
| Tools | Haiku | 10 min | weekly | ~$0.20 | ~$0.90 |
| Practice | Haiku | 10 min | weekly | ~$0.15 | ~$0.65 |
| | | | | | **≈ $11** |

**Ceiling: $25/month. Warned at 70%.**

One briefing once cost **$3.88** because every duty inherited the default model — the most expensive
one available, run agentically for ten minutes over thirty pages to produce twenty sections. The
envelope had supported a `model` flag the whole time and nothing was setting it. Every duty now names
its own model, and sourcing keeps the better one deliberately: the report summarises pages that
already say what they say, while sourcing *judges* whether a firm buys at your size, and a wrong yes
costs you a phone call and some credibility.

**The budget stops scheduled work and never stops you.** A duty over the ceiling is skipped with a
named reason on Today. Anything you dispatch runs whatever the balance — a budget that can refuse the
owner makes the system less useful than no system, and it is your plan.

---

## The three apps

In `~/Applications`. Finder → Go → Home → Applications.

| App | What it is |
|---|---|
| **Boss OS** | The live system. Your real data. Needs the internet. |
| **Boss OS (Local)** | The same code on your Mac, against a local copy. No network. |
| **Boss OS Sync** | Copies cloud → local. Takes ~6 minutes. Never pushes. |

**The local app is not a local model.** That is Batch 2 and remains deferred. The local app runs the
same Worker against a database in `.wrangler/state`; employees still use Claude when they run.

**It is a read-only mirror.** Anything you change there is overwritten by the next sync. There is no
local→cloud path and no flag for one — pushing a laptop copy over live data is the one move that
could destroy the real thing.

---

## Your data, and where it lives

| Thing | Where | Leaves your Mac? |
|---|---|---|
| Code-name → real address mapping | `~/.boss-os/contacts/MAP.json` | **Never** |
| Correspondents and dates | `~/.boss-os/sourcing/CONTACTS.json` | No |
| Computed sky, natal chart | `~/.boss-os/reports/SKY.json` | No |
| Wednesday packets | `~/.boss-os/packets/*.md` | No |
| Local database copy | `.wrangler/state` (~92 MB) | No |
| Production snapshots | `backups/*.json` (~2 MB each, gitignored) | No |

**Boss OS stores code names only.** SANDPIPER has gone 94 days; only your laptop can say who that is.
The sync endpoint rejects an entire batch if any code name contains an `@` — it caught a real leak on
the first run, when a collision suffix was built from the first three characters of a real address.

**The mailbox extraction requests From, To, Date and List-Unsubscribe and nothing else.** Gmail never
returns a subject or a body for that request; the privacy claim is what the request asks for, not
something applied to the answer afterwards. `npm run validate:gmail` fails the build if that changes.

---

## Commands worth knowing

```bash
npm run holdings -- "Anthropic"   # do I have access to this stock? "NONE FOUND" is a real answer
npm run properties                # Search Console: what's working and what isn't
npm run spry:heartbeat            # are the properties still shipping
npm run contacts:extract          # re-read the mailbox
npm run contacts:sync -- --commit # update the touch list (dry-run without --commit)
npm run lp:sync -- --commit       # push new LP rows to Scooter's tracker (append-only)
npm run packet:remind -- --force  # build the Wednesday packet now
npm run returns:contribute        # LP sends/replies + Search Console into the return ledger
npm run crossmatch                # firms on both the LP list and the buyer list
npm run canon:sync                # store the docs/boss/ documents in the vault, hashed
npm run local:pull                # read production into backups/
npm run local:restore -- --force  # load that into the local database
```

Deploys always go through the vault: `npm run vault:run -- npm run deploy:production`.

---

## The validators, and what each one caught

These exist because each of them caught something real.

| Validator | What it asks |
|---|---|
| `validate:reachable` | Is every built thing reachable from her day? |
| `validate:classification` | Does every Boss table have a residency, and every policy row a table? |
| `validate:gmail` | Does the extractor still request only metadata headers? |
| `validate:sql` | Does every statement match the schema? |
| `accessibility` | Do source files contain invisible characters? |

**`validate:reachable` is the important one.** The defect this system produces most is a correct
thing that nothing invokes: a table with a reader and no writer, a function nobody calls, a runner no
job starts. It asks two questions — is any Boss table read but never written, and does anything
invoke each ops script — and it found three unwired scripts and `vault_entries` within minutes of
being written.

---

## What is deliberately NOT built

Not gaps. Decisions, with reasons.

- **Local→cloud sync.** The mirror is one-way and there is no flag for the reverse.
- **A local model (Batch 2).** Deferred by you, indefinitely.
- **A daily Search Console check.** It lags 2–3 days; a daily number with no decision attached is a
  habit, not a system. Weekly, compared to the previous week, is the shortest useful window.
- **Reading your mail's contents.** The extraction takes metadata only. Matching "an old buyer asked
  about Company X" against "someone recently offered X" needs subjects and bodies, which is a
  materially bigger step and a separate decision.
- **Client repos.** Out of Boss OS entirely, permanently.
- **Anything that commits, merges, pushes or deploys.** Every agent run ends as a proposal.

---

## Outstanding

Real, and named rather than quietly absent.

1. **The missed-connections feature.** The one you described: an old buyer asked about a company, and
   recent mail shows you may now have access to it. Needs mail contents. Design is settled — it would
   run on your Mac and emit only code-named structured output — but it is not built.

2. **`sequoia@westpeek.ventures` is not connected.** It is p1 on your Wednesday packet. It unblocks
   LP reply detection and the opt-out defect the outreach register has carried since 19 August.

3. **Simone, Zora and Toni have no work.** Three seats with charters and nothing to do.

4. **The brokerage has no measure of a good week**, and you were right that it cannot have one — deals
   take two weeks or six months. What it has instead is buyer flow and touch counts, which is the
   honest substitute.

5. **`heygetonmylevel` has no workflow runs at all.** The heartbeat reports it as unknown rather than
   healthy.

6. **23 properties, 7,642 impressions, 24 clicks in 28 days** — average position 56 to 78, pages six
   to eight. Indexing works; ranking does not. Monique's backlink duty aims at exactly this, and it
   is one duty against a portfolio-wide problem.

7. **The first-run seeding fires three weekly duties at once.** They settle onto their weekdays after
   the first run.

8. **Imani's practice duty delivers nowhere.** `duty_practice_week` declares `delivers:
   'practice_week'`, `deliverReport.ts` handles four keys and that is not one of them, and no table
   of that name exists — only a `data_policy` row classifying one. So the duty runs every Sunday at
   17:00, costs its ~$0.15, and its output lands in the run workspace and stops there. Found on
   7 September by `validate:classification`, which fails on the orphan policy row and is the only
   validator not wired into `npm run validate`. `validate:reachable` cannot see it: it asks whether
   tables have writers, not whether a duty's delivery key has a handler.

9. **Nineteen of the twenty-three Search Console properties belong to no income line.**
   `projects.ts` declares six domains; the account holds twenty-three. `npm run returns:contribute`
   names the other nineteen on every run rather than pooling their traffic into a line that did not
   earn it. Either they are lines and should be declared, or they are not and the decision should be
   written down. `time-2-read.com` and `heygetonmylevel.com` are a separate case: they are not in
   Search Console at all, which is why the SaaS line reads as unmeasured rather than zero.
