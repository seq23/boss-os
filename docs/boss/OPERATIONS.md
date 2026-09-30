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
| **Monique** | Director of Relationships | Wealth | The network refresh, backlink prospecting, **the mailbox sweep** |
| **Danielle** | Technical Program Manager | Execution | The shipping heartbeat |
| **Imani** | Director of Practice | Body + Spirit | The week's practice, rituals, technique research |
| **Kendra** | Systems Manager | — | Tool scouting |
| **Simone** | Chief of Staff | Execution | Getting your books published, and chasing Amazon until they are |
| **Toni** | Chief Risk Officer | — | The credentials this whole system runs on, and the West Peek reply path |
| Zora | Archivist | — | No standing duty |

Before 7 September, **Camille owned every duty in the system** and the other eight employees had a
department, a charter and no work. That is the same defect this codebase produces everywhere else — a
correct thing nothing invokes — at the level of an org chart.

Simone took the publishing block on 7 September and Toni took the credentials on 9 September. Zora
still has none, which is honest rather than finished.

Monique also owns the LP reply digest as of 9 September — **dormant, not broken**. Nothing can read
`sequoia@westpeek.ventures` until Scooter grants domain-wide delegation on that domain, so the duty
is suspended with that reason on the row, and the credential prober wakes it the morning he does it.
Nobody has to remember.

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
| 06:00 | Executive Intelligence Report fires (was 06:30 — see below) | Camille | agent |
| 06:05 | The Mac writes SKY.json and MARKETS.json, then claims and executes the run | — | launchd |
| 06:35, 06:50, 07:10 | Three more claim attempts, in case the first missed | — | launchd |
| 12:35, 18:35 | Later claim attempts, for anything dispatched by hand | — | launchd |

**Why 06:00 and not 06:30 (19 September 2026).** The Worker's cron is hourly on the hour. A 06:30
duty is not due at the 06:00 tick and so fired at 07:00; the Mac's next slot was 07:10; the report
landed at 07:18–07:25 every single morning, against a success criterion that says "by 07:00". Central
is a whole-hour offset from UTC, so 06:00 fires AT 06:00 on every day of the year; the Mac claims it
at 06:05; a 20–25 minute Sonnet run is on your screen by ~06:30 with the stamp *"Information checked
through ~6:25 AM CT"*.

### Mondays, Wednesdays, Fridays

| Time | What | Who |
|---|---|---|
| 06:45 | Brokerage sourcing — new buyers, and who has gone quiet | Camille |
| 09:23 | Read the KDP support mail, decide what it means, chase the case | Simone |

### Weekly

| Day | Time | What | Who |
|---|---|---|---|
| Monday | 07:00 | Shipping heartbeat + Search Console read | Danielle, Camille |
| Monday | 07:30 | Backlink prospecting | Monique |
| Wednesday | 07:00 | The packet reminder — notification + a markdown file | — |
| Thursday | 08:00 | Tool scouting | Kendra |
| Sunday | 17:00 | The week's practice | Imani |
| Sunday | 18:00 | Network refresh — re-read the mailbox, update the touch list | Monique |
| Sunday | 18:30 | Mailbox sweep — missed deals, cooling buyers, connectors | Monique |

### The launchd jobs

```
com.seq.boss-agent       claims and runs agent work        5×/day
com.seq.boss-packet      the Wednesday packet reminder     Wed 07:00
com.seq.boss-network     mailbox → touch list              Sun 18:00
com.seq.boss-properties  heartbeat + Search Console        Mon 07:00
com.seq.kdp-watch        the KDP case, read and chased      Mon/Wed/Fri 09:23
com.seq.boss-mailbox     mailbox → findings                 Sun 18:30
com.seq.boss-credentials are the logins still working?      daily 06:15
com.seq.boss-lp          LP replies → Inbox digest          daily 07:45 (dormant)
```

Reinstall or repair them all with `npm run app:install` and `bash scripts/ops/install-agent-launchd.sh`.

---

## What arrives by itself, and what the Inbox is for

_Rewritten 8 September 2026, because you opened it and told us what was wrong._

> "when i click on inbox i have all these executive intelligence reports to 'approve' then they
>  disappear after hitting the button. then in the 'today' screen i dont see any hting WTF? they are
>  to be delivered to the today screen automatically. i shouldnt have to fucking approve it."

Every clause of that was a real defect. The most damning part is that the code agreed with you in
writing: `approvals/execute.ts` carried the comment *"APPROVING APPLIES NOTHING, AND THAT IS THE
DESIGN RATHER THAN AN OMISSION."* It was right that nothing is applied and wrong to conclude that
this should therefore be an approval.

### The rule

> **An approval exists when your answer changes what happens next.**

If approving and rejecting lead to the same world, there was no question — and putting it on a list
teaches you to clear the list without reading it, which is how the one item that *did* need you gets
cleared too. An inbox that cries wolf is worse than no inbox.

**What the Inbox keeps**

| | Because |
|---|---|
| A run that changed files outside its own workspace | That is a change to your machine, and accepting or discarding it is a real fork |
| A run that tripped a forbidden action | A guard fired and you should see it |
| A run that asked for your decision | §79.8's evidence packet has always carried `approval_needed`; nothing read it until now |
| Work you dispatched by hand with no delivery contract | Its output has nowhere else to land, so the docket **is** the result |
| Memory promotions, capability admissions, prompt library, trading, intake, model routing | Every one of these applies something real |

**What it lost:** your own briefing, and the four other delivered outputs like it — the buyer list,
the backlink prospects, the tool scan, the week's practice. All five were written to their tables
and shown on their screens *before* the approval was ever raised.

**Acceptance is still recorded.** `backend_run_auto_accepted` in the audit log, naming the run, the
backend and the reason. What went away is the click, not the trail.

### The run your Mac could never claim — the reason it was not arriving at all

Two things were stacked, and fixing only the first would have left a screen honestly reporting a
permanent absence.

**`queue/consumer.ts` sets a task to `running` and THEN dispatches its run.** The claim endpoint
required the task to still be `queued`, so the join could never match: **every duty routed to
Claude Code produced a run nothing on earth could take.** It reached Today as *"fired, but its last
task is still running — nothing picked it up"*, which reads as a broken launchd agent and is not —
the agent runs five times a day, asks correctly, and is told there is nothing for it.

Every report you have ever seen came in through `POST /backends/dispatch`, the one path that
bypasses the consumer and leaves the task `queued`. That is why this looked like it worked.

Fixed in `0206`. Exclusivity moved onto the run itself (`claimed_at`), which is the object being
claimed; the old lock was a conditional UPDATE on the task's status doing double duty as filter and
lock. **Proven live**: with the fix in, the real Mac agent immediately claimed and completed a
brokerage sourcing run that had been stranded since 7 September.

**Runs stranded by the bug are left where they are.** They are claimable now, oldest first, one per
agent tick — five ticks a day, so a small backlog drains within a day rather than being thrown away.

### What "the report arrives by itself" now means

- **It lands on Today.** No approval, no gate.
- **If today's has not arrived, yesterday's is shown in full**, labelled with the day it is for.
  Before this, a briefing that existed and was readable was replaced by "No report for today yet",
  which is the blank screen you were describing.
- **The reason is named, and the reasons differ.** Not due for another 18 minutes · the task is
  still queued and nothing on your Mac has claimed it · the run failed, here is its error · the duty
  is suspended · it has never fired. Each of those is a different morning with a different next move,
  and the old sentence was identical for all of them.
- **Yesterday's archives itself when today's arrives.** Archived, never deleted — the report format
  chains corrections to the previous day, so deleting the last link would break the one feature that
  depends on it.

### The briefing, on par with the one you pay for (19 September 2026)

> "I keep opening my OpenAI app and the executive briefing there is far superior to anything in Boss
>  OS ... Fix Boss OS's daily executive briefing to be just like the one in my txt file. Delivered
>  automatically daily to me only. ... Leave astrology and travel-map colours out."

The file on your desk is the specification now, ported into `src/worker/boss/duties/briefingSpec.ts`
and read by the materialiser, the delivery and a validator. What arrives each morning:

| | Was (through 19 Sep) | Is |
|---|---|---|
| Edition | A headline | *Saturday, September 19, 2026 • Morning Edition • Central Time* and *Information checked through 6:2x AM CT*, derived from the evidence |
| One-Minute Summary | Up to four one-sentence bullets, no numbers allowed to open one | 3–5 items, each two or three sentences with the figures and an inline `[n]` citation |
| Top 5 Headlines | Headline, summary, why, score | Headline, summary, a **data block** of cited numbers, a why-it-matters of two to four paragraphs, a score on the file's weights |
| Markets dashboard | A table the model typed — three of three index figures wrong on 19 Sep, each cited | **Built by the system** from a live snapshot (Yahoo Finance chart API + the Treasury's par-yield CSV, free, keyless); a row the feed did not answer reads *not available at HH:MM CT* |
| SpaceX Watch | The prompt said "not publicly listed" | The feed answers public/private every morning; SPCX leads the section with close, move, prior close; then the reference map, Starship, Starlink, supply |
| Depth elsewhere | Four bullets a section | Up to six two-sentence bullets, the file's questions asked of each |
| Sources | Behind a toggle | Numbered, open by default, article-level URLs, each `[n]` in the text an anchor to its row |
| Final line | None | None. The report ends with its last section (removed 30 Sep 2026 at her instruction) |
| Model | Haiku 4.5, 900 s | **Sonnet 4.5**, 1500 s, on your Claude Code session — $0.00 in API dollars; the CLI's notional figure accrues to the $50/month Claude Max proxy |
| A stale report | 15 Sep's was 14 Sep's, refiled from a `delivers.json` left in the workspace | The runner removes any `delivers.json` before the run starts and says so |

Astrology and the Money / Career / Travel Map are stripped on delivery if a run files them, and the
section is named on your screen. They live on Spirit.

### The briefing, written for your eyes (13 September 2026)

> "the way it is formmated now is for a machine not for a human eyes. it needs to be synthesized and
>  summarized and formatted properly"

Both halves were true and each needed its own fix.

| | Was | Is |
|---|---|---|
| The one line on Today | The first sentence of a five-sentence summary of stacked figures | **`headline`** — one line, twelve words, no figures |
| A section | A heading and a paragraph | A heading, **what it means for you**, then up to four bullets with the key phrase bolded |
| Sections shown | All of them, in storage order | The **first four**; the rest one click away, with a count |
| Sources | A list of URLs and ISO timestamps at full weight | Behind a toggle |
| Gaps and corrections | Buried under the sources | **On the screen, at full weight** |

**Gaps and corrections were deliberately not compressed.** "I could not verify this" and "yesterday
I told you the opposite" are decision-bearing — the 7 September run used a correction to overturn a
standing assumption that a company was still private. A briefing that reads beautifully because it
dropped its caveats is worse than the one it replaced.

**The four-section cap is applied on the screen, not on the way in.** A real run on 8 September,
with the new prompt, filed fourteen sections — down from twenty, so the instruction moved it and did
not govern it. Truncating on the write side would destroy research you paid for; folding it away
gives you the short read and loses nothing.

**Same duty, same cadence, same model, same cap.** Asking for a synthesis is not more work than
asking for six sections.

### The morning agenda, without doing anything

> "i should get a morning agenda each day without doing anything what the fuck?!"

The four Pillar Contracts were being derived the whole time — from your projects, your arcs, your
practice and your real record — and only **inside** `POST /today/gates/morning`. So opening Today at
7am showed "The Morning Gate has not run. Today has no contract yet." A day plan that exists and is
only computed if you press something is not a day plan; it is a form.

It is **derived on read** now, so a failed cron and an unpressed button cannot produce an empty
screen. Proposed is not agreed: the plan is on the screen, and running the gate is you agreeing to it
or overriding it.

**Today's Contract is the agenda, divided by pillar** — your specification, and all three parts of
it were built and unwired rather than missing:

| Pillar | What is on the screen | Who owns it |
|---|---|---|
| **Body** | §6.9's five stored morning movements, printed exactly and in order, then today's somatic rotation — one movement per lane, chosen as the least recently used, each saying why. Then water, hydration, the food rule and the safety stop. | Imani |
| **Spirit** | **Your gratitude sentence, mirrored here.** Spirit remains its home; you should not have to navigate to read your own sentence. Then the seven-step manifestation sequence with its minutes. | Imani |
| **Wealth** | The first money move, with the named candidates and their sources under it. | Camille and Monique |
| **Execution** | Whether anything you own shipped, and an honest line when nothing is owed. | Danielle |

**Nothing there is invented.** Every movement is one you wrote down; the system only chooses which
somatic one comes up today, deterministically from `movement_log`, and says why.

---

## How to give an employee a duty

_21 September 2026. "is there a lane for me to ask for a new duty to my Boss OS agents? i still dont
know how to create a job for them."_ There is now, and it is three steps.

**1 · Email it.** To `boss@sequoiataylor.com`, from one of your addresses, subject or first line
`#<seat> new duty`, then the duty in your words:

```
To:      boss@sequoiataylor.com
Subject: #monique new duty
Body:    every friday, check the LP replies sheet and tell me who went quiet
```

`#simone new duty monique …` lets the Chief of Staff route it. The same box is on **Team → Duties**
("Add a duty"), with a Preview that shows the draft before anything exists.

**2 · Read the draft.** The employee (or Simone) replies with the whole thing — name, owner, cadence
with the concrete slot and why that hour (it avoids the briefing and the Mac's other jobs), executor
and why (an agent, or a job on your Mac — anything touching your accounts has to be the Mac), model
tier, delivery route, cost against the $25 ceiling, the prompt she will run from, and **every
refusal verbatim**. A duty that cannot run — a script your Mac does not have, a delivery route that
does not exist — comes back as a `NAMED STOP` and is not created. The same draft is a card in your
Inbox.

**3 · Reply `approved`.** One word on the thread creates it and the reply names the first run.
`changes: make it daily at 3pm` redrafts with your text as overrides. `no` withdraws it. Put
**`your call`** in the ORIGINAL request and it is created without waiting, recorded as pre-approved
with that phrase. Approve on the Inbox card does exactly what `approved` by mail does.

Every duty appears on **Team → Duties** with its cadence, executor, last run, next run and last
outcome. Guards: `validate:duty-birth` (one writer, reached only through the approval loop or a
recorded pre-approval, the owner ↔ executor ↔ script check above the write, the mail door below the
sender refusal, the installed-script list pinned to the installer) and `tests/boss/dutiesByEmail.test.ts`.

## When you hand someone something to own

**Your rule, and it is now a mechanism rather than an instruction:**

> "she owns this deliverable so she needs to make sure its done and if there is any block she needs
> to tell me immediately and keep reminding me until its done. she canot drop it. that goes for all
> employees when i give them something to own."

A **duty** and a **deliverable** are different things, and the difference is the whole point.

| | A duty | An owned deliverable |
|---|---|---|
| Finished when | It fired | The world is actually true |
| Can it report success while achieving nothing? | Yes — and one did, for eleven weeks | No. Nothing it says closes it |
| Who decides it is done | The duty | Records being counted |
| If its executor breaks | It goes quiet | It gets louder |

Imani's practice duty is the reason that table is written the way it is. It fired every Sunday at
17:00 for eleven weeks, cost about $0.15 a time, and delivered into a handler that did not exist.
Nothing failed. The clock advanced, the task closed, an approval was raised, every test passed. A
duty cannot tell you it is achieving nothing, because its success criterion is that it ran.

**How an owned deliverable behaves:**

- **It names a person.** Escalations say "Simone is blocked on getting your books published", never
  "the KDP thing is stuck".
- **It is finished by counting, not by claiming.** "Every authored title is Live" is checked against
  your records. A support agent saying a flag is cleared, a job reporting success, an employee
  saying it is done — none of those closes anything.
- **It escalates on Today, and gets louder.** Raised today is a note. Three days is high. A week is
  critical. At a fortnight it stops describing the block and says the thing that is true: the route
  being used is not working and needs a different one. Nothing is filed on a page you have to
  remember to open.
- **Silence is the alarm, not the calm.** If nothing happens for a week, that is itself surfaced —
  which is why a launchd job that stops firing makes a commitment louder rather than letting it
  quietly die alongside the job.
- **Only you can stop one, and it costs a reason.** There is no code anywhere that lets an employee,
  a run or a job decide your commitment is no longer worth keeping. There is no "mark done" button
  either, for you or anyone: if you want it off the screen without it being finished, that is
  *stopped*, with a reason, and it stays in the register saying so.

**Where to look:** Team → Owns. But you should not have to — anything blocked is on Today.

`npm run validate:owned-work` fails the build if a deliverable is ever created without an owner, a
condition the records can decide, or a live path to your screen. It also fails if there are none at
all, because an empty register renders as "nothing is stuck", which is indistinguishable from
"everything is fine".

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
| KDP case watch | Haiku | 10 min | Mon/Wed/Fri | ~$0.05 | ~$0.65 |
| Mailbox sweep | Sonnet | 80 turns | weekly | ~$0.60 | ~$2.60 |
| Credential probe | Haiku | 3 min | daily | ~$0.01 | ~$0.30 |
| LP replies (dormant) | Haiku | 10 min | daily | ~$0.03 | ~$0.90 |
| | | | | | **≈ $15.45** |

**Coaching is the deliberate exception and is not in that table**, because it is not scheduled work.
Everything above was pushed DOWN to the cheapest model that could do the job. Coaching goes the other
way, on your instruction — "it is imperative that i use the best models with the best thinking brains
and the most integrity" — and the budget never touches it, because opening the screen and typing is
you asking directly rather than a duty firing. Today it still runs free on Workers AI; a frontier key
in the vault makes it roughly a cent a morning, about $0.30 a month at five mornings a week.

**Ceiling: $25/month. Warned at 70%.**

**The per-run figures above are estimates and one of them is now measured.** A real brokerage
sourcing run on 8 September — the first one the fixed claim path let through — cost **$1.99**
against an estimate of $0.30. That is one data point on the most expensive duty in the schedule and
it does not change the shape of the plan, but it is worth knowing that the estimates are estimates:
the ledger has arithmetic it can prove and prices it cannot, and it says so.

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

**Three things do read the contents of your mail, all on this machine, all named.** That sentence
above used to be the whole story and it was not true of the repository — it was true of one file.
The validator now scans every script that touches Gmail, and names the exceptions with their
reasons rather than leaving them ungoverned:

| What | Why it needs contents | What keeps it narrow |
|---|---|---|
| `npm run holdings` | "Do I have access to <company>?" is answered in prose — someone writing that they have shares available. No arrangement of From/To/Date produces it. | On demand only, never a scheduled job. One company at a time, the one you typed. Prints and exits: no index, no cache, no file. |
| Simone's KDP watch | You cannot tell from a header whether support resolved a case. | It does not call Gmail at all — `claude -p` reads through the connector on this machine. What reaches Boss OS is a determination in the run's own words, and the endpoint **refuses** one containing an `@`. |
| Monique's mailbox sweep | "An old buyer asked about a company; someone else now has access to it" is a fact about what two people *said*. No arrangement of From/To/Date produces it. | Built the same way Simone's is, deliberately: it makes **no Gmail API call from this repository at all**, so `validate:gmail`'s rule for every other caller is unchanged rather than widened. Subjects and bodies stay under `~/.boss-os/`. Every person is named by their code name from `MAP.json`, an unmapped address is skipped rather than named, and both the reporter and the endpoint refuse the **whole batch** if any field carries an `@`. Six assertions in `validate:gmail` fail the build if any of that stops being true. |

Neither sends anything to a model, and neither writes mail contents anywhere.

---

## What changed on 9 September

_Read it in this order; each one is a defect she found by using the system._

**The alert on Today was frozen and had started lying.** A fix in 0203 stopped any run writing the
deliverable's blocker, so the escalation could never change again — it was still describing a
week-old theory about an Amazon account flag after your Gmail connector had been revoked and after
support had named cover image processing instead. There are two facts and there are now two fields:
**the blocker** is the standing reason and no run may write it, **the current status** is what the
last run learned and every run writes it, dated. The escalation clock is untouched by both, so a new
sentence today does not make a nine-day block look fresh.

**"I could not run" no longer looks like a quiet week.** They rendered identically — as silence —
which is how the connector could be dead for days. Every named stop in the watcher now files a
determination and posts it BEFORE exiting.

**The notification shared its failure mode with the work.** The watcher was told to email you when
something needed you, through the same connector it reads your mail with. When you changed your
Google password, Google revoked the grant instantly and the one condition that most needed to reach
you was the exact condition that could not send. **The Boss OS report is the channel of record now**;
email is a nice-to-have that may fail silently, and the prompt says so.

**Nothing watched the credentials.** A daily prober USES each one — the connector, the service
account, the West Peek grant, and whether Amazon mail is reachable without the connector — and dead
or stale both reach Today with the exact steps. It costs about a cent a day.

**Approving something now makes it happen.** Work that needs your judgement lands in the Inbox with
the work IN it — the seven covers render in the card — and **Approve is the trigger, not a filing
action**. Try Again carries your sentence back. An item cannot be created unless it names something
that actually happens when you say yes, and a resume that fails leaves the item on your screen
rather than recording a decision over work that never restarted.

**Every employee reports completion**, detected by counting records rather than claimed, once, into
the same Inbox — and Try Again on a completion reopens it.

**The Wednesday packet reached you never.** It was written correctly to your Mac every week while
Today showed an empty Meetings section. A headless Claude has no Artifact tool — tested, not assumed
— so the Worker serves the agenda page instead: **one link that never changes, every packet newest
first, with downloads**. Today carries a compact pointer and says so plainly when none is filed.

**The packet prepares you as well as him.** "Your week" is yours, labelled as yours, counted from
your own records with the source named on every line, and empty when the week was empty.

**An item stays on the packet until it is TRUE, not until it is mentioned.** The West Peek grant had
appeared there worded identically every week since 19 August. It now says how long he has had it,
and it closes itself the morning the impersonation actually succeeds.

**The anchor streak had a hole in it.** `WHERE morning_completed_at IS NOT NULL` meant a day you
never opened was not counted as unknown — it was dropped out of the window entirely and the query
reached further back to fill the gap. Ten skipped days shrank the window rather than showing up in
it, which flattered. The window is ten CALENDAR days now, and `untouched` separates "opened it and
never closed the night" from "never opened it at all".

**And the screens say what they are.** Today's Contract carries its date, yesterday's verdict and a
line for each gate saying which block it closes; Coaching leads with what it is for rather than a
privacy disclaimer, and its button names the action rather than a Cloudflare product.

---

## Later on 9 September

**The Meetings tab was a packet reader that lied about itself.** It said "Nothing in the diary" and
opened onto a full agenda, because the collapsed line counted one table while the body rendered
another. It is a diary now: what you have coming up, one row each, with a link where a meeting has a
packet. The packet lives at one permanent URL and is not dumped into the section.

**And the Wednesday meeting was in Google the whole time.** Two things were in the way, neither of
them the one first diagnosed: domain-wide delegation was not granted on either domain, and the
Google Calendar API was disabled in the project — which returns 403 and looks exactly like a missing
scope. Both are fixed. "Sequoia // Scooter Sync", weekly, 11:00, is now read directly.

**Two calendar sources, deliberately.** The API is preferred because Google expands recurrence
itself. The secret iCal feeds stay as the resilience layer: a service-account grant is an
OAuth-shaped thing, and this morning showed what a password change does to those. An iCal address
has no token to revoke. A meeting in both is shown once.

**The agenda link 401'd on a cold click** and the shell bounced you to Today. The cookie was fine —
the shape of the refusal was not. Those two pages answer a browser with an unlock form now, and the
download is real markdown with the right filename.

**You can act on an alert.** Refresh re-runs the checks rather than re-reading the answer. Mark
resolved RE-VERIFIES and tells you when the records disagree — nothing here can be closed by anyone
saying it is done, and that includes you, which is what stops an employee or a job closing your work.
Dismiss is a snooze with a reason: it expires, it comes back if the thing gets worse, and next time
it says why you put it aside.

**Every section says what it is.** You should not have been the mechanism that found the ones that
did not — the gates, the coaching screen, and a Spirit Signal card that rendered as "medium / 07 /
Spirit Signal / 08". The block indices are gone, every section has a sentence, and a test fails the
build if one is ever added without one.

**Simone owns Kindle itself**, not one case inside it. Promotional mail is noted and produces
silence — enforced at the endpoint rather than asked for in a prompt. Updates are notated where you
can read them back. A problem with a title gets acted on, and she can hand a piece to a colleague
without handing over accountability: a stalled assignment escalates under her name.

**You can see what every employee owns, and add to it.** Team → the roster shows each seat's duties
with the model, the cost per month and whether it has ever fired — an empty seat is shown as an empty
seat. Describing a duty in your own words drafts the proper version, and it goes to your Inbox with
the cadence, the model and the new monthly total against the ceiling before anything is created.

**The first thing that screen showed was a real defect.** `duty_mailbox_sweep` named no model, so it
inherited the most expensive one available — the $3.88 briefing, coming back through a row written
after that was fixed. Named now, and `validate:duty-delivery` fails the build on the next one.

---

## The interest ledger — the market that was already in your mailbox

**Added 9 September 2026.** Both sides of a market have been sitting in `staylor@spry.vc` the whole
time: somebody wanted SpaceX in March, somebody is selling it this week, and 104,241 messages sit
between them. **The monitoring was never the point. The matching is the product** — and you cannot
match on prose, so the work was turning the mailbox into a ledger with a shape:

> **principal** · **side** · **asset** · **size** · **date** · **confidence** · **intermediated_by**
> · **source_message**

That produces no screen and no button, which is exactly why it was ninety per cent of the job.

**Three scripts, and the split between them is the safety story.**

| | |
|---|---|
| `interest-ledger.mjs` | Reads the mailbox. **Sends nothing to any model.** Two filter stages, and it reports what it discarded by named reason |
| `interest-extract.mjs` | Turns candidates into ledger rows through **Haiku**. **Never touches Gmail** |
| `interest-match.mjs` | Crosses the two sides. Reads only the ledger |

**The filter throws away bulk structurally, not by guessing.** `List-Unsubscribe` is a header every
legitimate marketing sender sets and no person writing to you ever does; the same for `Precedence`,
`Auto-Submitted`, no-reply senders and out-of-office subjects. Those are facts about a message. Only
then does it ask for the shape of a trade: a **size** — dollars **or a share count**, because "I
have 40k shares of X available" is exactly the inbound supply you want and contains no dollars — and
a **side**.

**There is no list of company names anywhere in it, deliberately.** A fixed list of SpaceX,
ByteDance and Stripe would raise precision this week and start missing next quarter's name for ever,
silently. Money plus side vocabulary catches companies nobody typed into a config, and after one
pass the ledger itself becomes the name source. `validate:filter-accounts` fails the build if a
company name ever enters the filter's code.

**Nobody at Rainmaker is ever the principal, and their name is kept anyway.** A co-broker writing
"my client wants SpaceX at this mark" is genuine market interest that arrived through a route — so
their client is the principal and the co-broker goes in `intermediated_by`. In a co-brokered deal
the route *is* the deal.

**Compliance mail is not classified at all.** The test is never "is this compliance" — it is "does
this contain an asset, a side and a size". Compliance and internal chatter produce no interest, so
nothing about them is stored or summarised. Read to decide, keep only what qualifies, discard the
rest.

**The matching inverts the filter's bias.** The filter is generous because a dropped message is a
deal you never learn you missed. The matcher is strict because **one bad call outweighs ten missed
matches** — calling somebody about stock they never wanted costs credibility in a small market. High
threshold, every match shows its evidence and its age, at most five, and `--not "<address>"` removes
somebody for good.

**No matching window, because a cliff loses real deals.** The ledger holds two things that behave
differently: **has transacted in X** is a durable fact about who somebody is and never expires,
while **wants X right now** is perishable. Decay is a curve — a seller's interest fades fastest
because inventory moves, a buyer's mandate persists, and size predicts durability: a $2B ByteDance
buyer is an institution with a standing mandate, a $2M buyer is often opportunistic.

**It never leaves this Mac.** Named counterparties, assets and sizes do not reach the Boss OS
database — not code-named, not counted. This is live transaction data at a FINRA-registered
broker-dealer. The ledger is `~/.boss-os/capital/ledger.json`, the matches come to your own inbox
from `monique@sequoiataylor.com`, and Boss OS is told nothing at all.

**Monique can read spry.vc and can never send from it.** Already true three ways — no send scope was
granted, spry.vc is verified in neither Resend account, and every employee is addressed at
sequoiataylor.com — and none of the three was written down anywhere. `validate:no-spry-sender` now
fails the build on an outbound identity, a sender envelope, or any impersonating script that
acquires a Gmail write scope.

**It is a revival engine, not a reconciliation, and that was a correction.** It was built the wrong
way round first: leaning on "has transacted in X" as the durable signal and treating a live
expression of interest as the perishable half. Your words fixed it — *"i havent done any deals in a
while thats the whole point of having this agent help me drum up business."* So the durable half is
thin, and **the value moves entirely to the conversations**: the buyer who wanted SpaceX in March
and heard nothing since, the seller who never found a counterparty, the firm that asked what you had
and got a vague answer. **An interest that never closed is more actionable than one that did** — the
closed one is done, the open one is a phone call. The daily email is two sections for that reason:
the crosses, then *worth going back to*.

**How it is verified: precision, judged by you, on twenty-five rows.** Recall against a book of
closed deals is impossible here, and precision matters more anyway — a wrong row becomes a phone
call about stock somebody never wanted.

```bash
npm run capital:review                    # 25 rows, highest confidence first
npm run capital:review -- --wrong <id>    # that one is wrong: struck everywhere, and counted
```

**Each row carries the sentence out of the message that produced it**, which is the whole point: you
are checking a row against a real sentence rather than agreeing with a summary of a message you
cannot see. A row with no quote is refused outright, and a ledger where nothing carries one is a
named stop rather than a screen reporting nothing to review. **If most are right it works. If a
third are wrong it does not** — and the errors show their own pattern: over-reading vague language,
mistaking a co-broker for a principal, catching a discussion about a company rather than an interest
in its stock.

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
npm run kdp:check                 # run Simone's KDP watch now, instead of waiting for Mon/Wed/Fri
npm run mailbox:sweep             # run Monique's mailbox sweep now, instead of waiting for Sunday
npm run capital:scan -- --backfill    # read the whole spry.vc history into candidate messages
npm run capital:scan                  # ...or only what has arrived since the last scan
npm run capital:extract               # candidates into the interest ledger (Haiku, on this Mac)
npm run capital:review                # 25 rows with the sentence behind each — the acceptance test
npm run capital:review -- --wrong <id>   # that row was wrong: struck everywhere, and counted
npm run capital:match                 # who fits whom right now, at most five, each with its reason
npm run capital:match -- --find SpaceX --side buy --size 250000000
npm run capital:match -- --revive     # only the leads: interests expressed and never filled
npm run capital:match -- --nudge      # the monthly note: three people, anchored on the company
npm run capital:match -- --not "someone@example.com"   # never recommend this person again
npm run credentials:check         # are the logins still working? four real calls, about a cent
npm run kdp:covers                # put the covers in ~/.boss-os/kdp/covers/final/ in your Inbox
npm run kdp:resume                # she approved; start Simone now rather than waiting for Friday
npm run lp:replies                # Monique's LP digest — the grant landed, so it runs
npm run calendar:sync             # your calendars into the diary; API first, iCal as the backstop
npm run kdp:surface               # Simone's daily Kindle triage, now instead of at 09:30
npm run notify -- --from Simone --subject "..." --body "..."   # a push Google cannot revoke
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
| `validate:no-spry-sender` | Can anything in here send mail *as* the brokerage mailbox? It must never be able to |
| `validate:filter-accounts` | Does the mailbox filter say what it threw away, and has a company name crept into it? |
| `validate:classification` | Does every Boss table have a residency, and every policy row a table? |
| `validate:gmail` | Does every Gmail caller still request only headers — and is the one content exception still narrow? |
| `validate:duty-delivery` | Does every duty's output have a handler, a table, and a way to her? For a **local job**, does a route write the table and does a script actually POST to it? |
| `validate:owned-work` | Does every owned deliverable have an owner, a terminal condition and a live escalation? |
| `validate:reachable` | *(strengthened 9 Sep)* Shell scripts now count as invokers. A bash local job calling a reporter was invisible to it, and the only reason that passed was that this document happened to name the file — a scan resting on prose is one wrong edit from a false alarm. |
| `validate:sql` | Does every statement match the schema? |
| `validate:css-classes` | Does every `className` have a rule? It had been reporting `.input` on Team.tsx — the control that stops an owned deliverable, rendering unstyled — and was in no gate. It is in `npm run validate` now. |
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
- **Making Monique's and Camille's local jobs into duty rows.** `standing_duties` can now express
  locally-executed work — that is what Simone's row is — so it is tempting to give the network
  refresh and the property read the same treatment and have their owners written somewhere
  readable. Not done, and the reason is specific: a `local_job` duty's clock only advances when the
  job REPORTS BACK, and neither of those jobs does. Adding the rows without adding a reporter to
  each would put two permanent "has never fired" alerts on Today for two jobs that run perfectly
  well every week — a false alarm, which is worse than the gap, because a screen that cries wolf is
  one you stop reading. They stay launchd jobs until each has something to report.

- ~~**Reading your mail's contents.**~~ **Decided and built, 8 September 2026** — narrowly. The
  scheduled *extraction* still takes metadata only and always will; `validate:gmail` fails the build
  if it changes. What was added is a third local job that reads contents inside `claude -p` on this
  machine, exactly as Simone's KDP watch does, so no script in this repository gained the ability to
  read a body. The decision that made it safe was choosing that route over the obvious one: a
  `format=full` extractor here would have meant widening the guard for everyone.
- **Client repos.** Out of Boss OS entirely, permanently.
- **Anything that commits, merges, pushes or deploys.** Every agent run ends as a proposal.

---

## The bird's-eye view, 8 September 2026

_Every screen walked as you would walk it, in order, on the live site. What was found and what was
done about it._

| Screen | Was | Now |
|---|---|---|
| **Today** | Contract, briefing, meetings and loops all empty. Effectively a blank page. | The agenda by pillar with the actual movements and your sentence; yesterday's briefing when today's has not landed, with a named reason |
| **Inbox** | Five dockets asking you to approve your own briefing, applying nothing | Zero. It holds decisions only |
| **People** | 200 rows, every one reading `importance 100 · trust 100 · recency 0 · opportunity 0` | Monique's findings first, then who is genuinely overdue against their own rhythm |
| **Capital** | Opened on `0 active · 0 on file · $0 committed · nothing in the pipeline` | Opens on the desk: buyers to review, LP cross-matches, buyers gone quiet |
| **Spirit** | Working | Unchanged |
| **Team** | Working; the control that stops an owned deliverable rendered as an unstyled browser input | Styled, and `validate:css-classes` is in the gate |
| **Memory** | Working | Unchanged |
| **Trading** | Working; its CSV export link hit the chassis and answered `unauthenticated` | Fixed prefix |
| **Vault** | **Crashed the entire application to a blank page** | Renders. And no screen can do that again |
| **Systems** | Working | Unchanged |

**Three defects were of one kind, and it is the kind this repository keeps producing:** a correct
thing nothing invoked. The Pillar Contracts were derived only inside a handler nothing on the screen
called. The morning movements existed as content and appeared nowhere. The claim query could not
match a row the dispatcher had just created.

**One was a screen and an endpoint disagreeing about a payload** — `/vault/entries` answers an
envelope and the client called it an array. There was no boundary anywhere, so it took the product
down rather than the panel.

**One was a guard that had been reporting a real defect into a terminal nobody reads:**
`validate:css-classes` was not in `npm run validate`. It is now.

---

## Outstanding

Real, and named rather than quietly absent.

1. ~~**The missed-connections feature.**~~ **BUILT, 8 September 2026.** Monique's mailbox sweep,
   Sunday 18:30, half an hour after the network refresh so the code-name map it names people from is
   current. It finds four things — a deal sitting between two people in your mailbox, a buyer who has
   gone quiet against *their own* rhythm, an introduction nobody worked, and the connectors whose
   value is invisible in any list. They land on People, the cooling buyers also land on the Capital
   desk, and a high-confidence pairing becomes Today's first money move — because two people who have
   both already talked to you about the same asset is the shortest route to a commission you have.

   **Installed 8 September**, so it fires on its own from the coming Sunday. Until it has run once,
   the People screen says exactly that rather than showing a bare empty list — "no findings" is true
   both when the sweep read your mail and found nothing and when it never ran, and those are
   opposite facts.

2. **`sequoia@westpeek.ventures` is not connected — and SCOOTER is the one who can fix it, not you.**
   Delegation is per-domain and your spry.vc admin does not reach westpeek.ventures. The exact steps
   to hand him are inline on the Wednesday packet and on Today, the prober tests the grant every
   morning, and the item closes itself the day it works.

   **Stated precisely, because the earlier wording overstated it.** CONFIRMED: 248 emails have gone
   out from that address since 19 August and nothing can read what comes back — interest, questions,
   requests for the deck and requests to be removed, all equally invisible. During a raise, an unread
   reply is the loss. NOT CLAIMED: that any particular opt-out is sitting there, which is unknowable
   until the grant exists. And the sending is Twin's, not Boss OS's: nothing here has ever emailed
   an LP.

3. **Zora has no work.** One seat with a charter and nothing to do. Simone was one of three until
   7 September and Toni until 9 September; both now own something real.

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

9. **Nineteen of the twenty-three Search Console properties belong to no income line.**
   `projects.ts` declares six domains; the account holds twenty-three. `npm run returns:contribute`
   names the other nineteen on every run rather than pooling their traffic into a line that did not
   earn it. Either they are lines and should be declared, or they are not and the decision should be
   written down. `time-2-read.com` and `heygetonmylevel.com` are a separate case: they are not in
   Search Console at all, which is why the SaaS line reads as unmeasured rather than zero.
