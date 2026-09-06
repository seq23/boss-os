# Build phases

Phases 0 through 5, Phase 11, and Phases 13 through 23 are implemented in this
snapshot. This file records what each one actually delivered, and what was
deliberately left out.

Phases 6 through 10 and Phase 12 are not in this repository. The surviving
artifact's migrations run 0001–0004 and then 0009, and no code for those phases
is present; where a later phase needed something they would have provided — the
standing duties Phase 10 carries, the coaching faculty Phase 12 decides with —
the gap is recorded at the point of use rather than papered over.

## Phase 0 — Foundation

Full schema for six subsystems, Worker + SPA, auth, lane isolation, approval
inbox listing and deciding, vault snapshots, nightly cron.

Repairs made to Phase 0 during later phases:

- Budget windows were stored but never rolled, so a lane that hit its daily
  limit once stayed blocked forever. Windows now roll on UTC calendar
  boundaries, driven by whichever request or cron run first notices.
- Errored and budget-blocked model calls were charged to the budget. Only real
  spend moves a budget now.
- `tasks.approval_id`, `trading_orders.approval_id`, and
  `agent_proposals.approval_id` are foreign keys, and several batches updated the
  referencing row before inserting the approval. Every one of those ordering bugs
  is fixed; the tests would fail immediately if one came back.
- The dead-letter queue was configured with no consumer, so exhausted messages
  vanished. There is a consumer now.

## Phase 1 — Approval execution

Approving a payload does the thing. `task_output` releases the task,
`memory_promotion` applies the tier change, `trade` fills through the broker,
`spend` puts the held task back on the queue, `model_route` grants one envelope
permission to reach a cloud model, `agent_creation` hires provisionally.

Rejection is symmetric: the origin is cancelled, never orphaned. Expiry behaves
the same way, because an expired approval that leaves a task in
`awaiting_approval` forever is a lie about the state of the system.

Decision and execution are recorded separately, so the UI can say "approved, but
the order was refused" instead of pretending it worked.

The inbox removes a docket optimistically and puts it back, in place, with the
reason, if the request fails. The old fixed 240 ms refetch is gone.

## Phase 2 — AI employees and model router

Task intake classifies every request into one of sixteen canonical kinds and
assigns it an execution assignment. `USER_ONLY` and `DEFER` never reach the
queue; `DELETE` refuses the work outright.

Every run gets a permission envelope. External send, repo write, provider
mutation, and financial action are all denied there and cannot be granted by
intake — only by an approved payload.

The router screens candidates on capability tier, risk ceiling, benchmark
status, approved and forbidden task kinds, and privacy class, then checks the
cost estimate against the envelope before calling anything. Restricted content
cannot reach a cloud model without an approved routing card. Every decision,
including every refusal, is written to `routing_decisions` with the reason each
candidate was kept or dropped.

The Agent Creation Gate requires a completed need assessment, and No Agent
Sprawl blocks any proposal whose assessment resolved to an existing employee, a
template, or a standing duty.

## Phase 3 — Memory promotion and continuity vault

Memory can only be created at `capture`. The gate is the only path upward.
Rejecting a promotion keeps the capture and closes the proposal — a rejected
promotion is a judgement about durability, not about whether the note was worth
taking. The sweep will not stack duplicate cards on the same item.

The vault snapshots every table, verifies by re-reading and re-hashing from R2,
and restores in three modes: `verify` writes nothing, `merge` fills gaps without
overwriting, `replace` demands an explicit confirmation string. The restore
drill proves the whole path end to end without touching live state.

The first working version of restore was wrong in a way only a populated
database would reveal: it wrote table by table, in batches, with foreign keys
enforced per statement. The schema has a genuine cycle — an employee points at
the proposal that created it, and that proposal points back at the employee — so
no insert order can satisfy that row by row, and a restore of any real database
would have failed part way through. Restore is now a single transaction with
foreign keys deferred to the commit, so it lands completely or not at all. The
test that caught it builds the whole object graph before restoring, because a
restore test against an empty database proves nothing.

## Phase 4 — Trading lane

Strategy registry with intake form and stage gates. Paper broker with real fill,
position, average-cost, realised-P&L, and cash maths. Authority envelope with
all six micro-live gates, per-order notional ceiling, symbol allowlist, and open
position limit, re-checked at execution time rather than only at draft time.
Kill switch cancels open orders and files an incident. Incident ledger and CSV
fill export.

**Not implemented, on purpose:** a live broker adapter. Enabling live execution
returns `501` even when every gate is recorded, because the code that places a
real order is not in this repository. The settings key `trading_live_enabled`
cannot be set to true; it is not a toggle, it is an envelope.

## Phase 5 — Hardening

Structured diagnostics to both console and `system_events`. Deep health check
that touches D1, R2, KV, the queue binding, secrets, and cron freshness, and
reports everything failing rather than stopping at the first problem. Cost
dashboard by lane, employee, model, and kind of work, plus a count of decisions
that did not route. Dead-letter triage with requeue and dismiss. Per-step cron
records, so "the cron ran" and "the cron worked" stay distinguishable. Employee
performance reviews, merge, retire, and a sprawl report.

## Phase 11 — Executive OS Core

Today is the default screen and the first tab, ahead of Inbox. It contains the
thirteen elements canon §15 lists, in canon's order, and no fourteenth:
Today's Contract, Executive Briefing, Day Flow, Meetings, Open Loops, Critical
Alerts, Spirit Signal, Coaching Focus, Daily Thinking Lens, Approval Inbox,
AI Employee Status, Continuity Status, Trading Status.

`GET /api/today` assembles all thirteen from live tables in one pass and
persists them to `day_flow_blocks`, upserting on `(day_id, block_key)` so a
reload rebuilds in place rather than stacking a second set. The day row is
created by whichever request or cron run first notices the date, the same rule
budget windows already follow, so a day nobody opened is still a recorded day.

Nine of the thirteen read real rows: approvals by risk with the oldest and the
count expiring within a day, tasks in flight and opened today, model spend and
captures for the day, employees by status with the five busiest, the vault's
last snapshot and its age, trading authority with open positions, orders and
incidents, and a critical-alerts block assembled from open dead letters, failed
tasks, unresolved high-severity incidents, an engaged kill switch, a nightly run
that did not finish clean, and error-level `system_events` from the last day.
Continuity Status and Trading Status are canon's two "when relevant" elements;
they compute relevance and the screen omits them when they are not.

Four elements had no substrate in the schema when this phase shipped — Meetings
(Phase 13, since filled), Spirit Signal (Phase 16), Coaching Focus and Daily
Thinking Lens (both Phase 12). The
block still renders and persists, carrying `available: false`, the reason, and
the phase that fills it. An absent input is recorded as absent, never defaulted
to a guess, and the same rule applies to the Morning Gate's agenda field: the
agenda engine is Phase 12, so `morning_agenda` records its absence rather than
inventing a plan.

Three gates, each writing one `gate_entries` row and the matching columns on
`days`, each capped by canon §5 — three priorities, three checks, three review
prompts — and each refusing a second run for the same day. A gate is a moment,
not a form; re-running it would overwrite what was actually said.

- **Morning** records priorities, identity cue, state, body floor and revenue
  reality, and scans the approval inbox so the contract states what was waiting
  when the day was agreed to.
- **Midday** runs the approval sweep canon names, recording pending approvals by
  risk and the open loop count alongside the checks.
- **Night** takes the attention allocation and refuses more than one day of it,
  captures evidence and the review, and calls the existing
  `runPromotionSweep` — canon has one promotion gate and this feeds it rather
  than running a second one beside it. The candidates it shows are the same
  `promotion_events` rows the sweep wrote, gated by the same pending approvals.

Tomorrow's seed is not a note to nobody: each seeded priority becomes a real
`open_loops` row on tomorrow's day, so it is on the screen before the Morning
Gate runs. Open loops carry forward — an unresolved loop from Monday is still on
Friday's screen, labelled with the day it came from, because a loop that
silently stopped being shown when the date rolled over is the exact failure
"what must not be forgotten" exists to prevent. Deferring writes a new loop on
tomorrow rather than rewriting the date on the old one, so today's record still
says the loop was open today and was not closed.

The four new tables joined `SNAPSHOT_TABLES`, parents before children, and a new
`roll_day` cron step keeps the day and its blocks current overnight.

**Not in this phase, on purpose:** deciding *what* belongs in Today. Phase 11
renders and captures; the agenda engine and coaching faculty that decide are
Phase 12.

### Repairs made in the final review

Two failure-path defects in the Night Gate, both caught by tests written to
reproduce them first:

- The review prompts and tomorrow's seed are optional, but an empty list was
  refused where an absent field was accepted — and the form sends the empty
  list. Closing a day with nothing to review and nothing to seed returned 400
  with a message about a missing prompt. Nothing sent and nothing in the list
  now mean the same thing.
- The one-run-a-day refusal happened after the promotion sweep, so a second
  submission proposed promotions and raised approvals and *then* said the gate
  had already run. The refusal now comes before any write. The check remains
  inside `recordGate` as well, and a batch that loses to the unique index is
  re-read and answered as a second run rather than a 500, so two simultaneous
  submissions cannot both land.

### Repair carried out before Phase 11

A previous implementation worker overwrote `src/shared/governance.ts`,
`src/client/pages/Trading.tsx`, and `src/server/intake/envelope.ts` with stubs,
leaving the repository unable to typecheck at all — 20 errors across 8 files,
including the removal of `loadEnvelope`, which the queue consumer imports. Those
three files were restored from the registered source artifact
`SOURCES/boss-os-v20-complete.zip`. The same worker left three files in phase
namespaces it had no authority to open, none of them registered on the router
and all of them querying tables no migration creates. Everything removed is kept
under `_quarantine/`, with the reasoning, rather than deleted. Its
`migrations/0009_executive_os.sql` was sound and was kept unchanged.

## Phase 13 — Relationship Capital OS

Migration `0011_relationships.sql` adds seven tables: `organizations`, `people`,
`relationships`, `meetings`, `meeting_briefs`, `meeting_captures`, `follow_ups`.
All seven joined `SNAPSHOT_TABLES`, parents before children, and the restore
test now builds the whole chain — organization through to the open loop a
follow-up raised — before replacing the database, because a restore test that
does not contain the new foreign keys proves nothing about them.

**The five scores canon §40 names.** Strategic importance, trust level and
opportunity value are judgements only the Boss can make; the system stores them
and refuses to invent them. Recency and relationship health are derived, and the
API refuses to be told what they are — `PATCH` with `relationship_health` is a
400, because a derived number that can be overwritten is a number that can lie.

Recency is full marks inside the agreed cadence, decays in a straight line after
it, and reaches zero at three cadences. Never contacted is zero: a fact, not a
default. Health weights trust and recency ahead of importance and opportunity,
then subtracts for what is owed and late, for commitments dropped rather than
kept, and for a tie with no contact ever recorded. Every penalty is capped —
ten late follow-ups cost the same 24 points as three, because past a point the
score has already said what it has to say. The whole calculation, including the
weights and each penalty with its reason, is stored in `score_detail` and shown
on the screen behind "How that health score was reached".

**The brief before.** `tpl_meeting_dossier` has existed since Phase 2 with
nowhere to write; it is now the generator. The brief records the template it
came from and the rendered prompt, and fills the template's output contract from
real rows: who they are, what they want, what we want, three questions, one ask,
known landmines. Every section either cites the row it came from or says it is
unavailable and why. "What they want" is evidence — what they are waiting on you
for, and what they asked for last time — never a guess about motive. The
landmines are the follow-ups you are late on, the ones you dropped, a trust
score below 40, and a silence long enough to have zeroed recency. Each carries
its source id.

The three suggested questions are ranked from what is true about this
relationship: a commitment they made and have not delivered outranks a generic
opener, and every question carries the row that justifies it. A meeting gets one
brief; regenerating it would overwrite preparation the Boss has already read, so
a second request is refused.

**The capture after.** One capture per meeting, and it always leaves two things
behind. At least one follow-up: one per commitment on either side, or — when
nothing was committed — a recap follow-up that says in its own record why it was
derived, because a meeting with no next step is the failure this catches rather
than a state to record silently. And at least one memory promotion candidate:
what was learned enters `memory_items` at `capture`, the only tier anything may
be created at, and is proposed through the one existing gate. `proposePromotion`
was extracted from the manual promote route so the capture raises exactly the
same shape of card, rather than a second kind of promotion nobody would think to
look for.

The capture also moves the relationship: contact is recorded, the trust delta is
applied and clamped, and the scores are re-derived.

**Follow-ups reach the screen.** An overdue follow-up is surfaced onto the day as
an `open_loops` row, which is how a commitment made in a room ends up on Today a
week later. `follow_ups.loop_id` is the idempotence key: reading the screen twice
does not stack a second loop, and after the first surfacing the existing
carry-forward rules keep it visible until it is closed. Priority is 1 for a tie
scoring 70 or more on strategic importance, or for anything more than a week
late.

Resolving that loop keeps the commitment; dismissing it drops the commitment,
which costs relationship health rather than disappearing quietly; deferring
re-points the follow-up at tomorrow's loop rather than closing it. It works in
both directions — completing the follow-up closes the loop it raised.

A day in the future never takes overdue follow-ups. Because a follow-up is
surfaced once, looking ahead at tomorrow would otherwise move today's overdue
commitments onto a day that has not happened, and off the screen the Boss is
actually on. That was a real defect in the first implementation of this phase,
found before it shipped and covered by a test that reproduces it.

**Today.** Meetings left the "awaiting substrate" list and now reads real rows:
the day's meetings with whether each is briefed and captured, meetings held in
the last week and never captured, the count of overdue follow-ups, and
relationships past their cadence. The block is persisted like every other one.
`surface_follow_ups` is a separate nightly cron step from `roll_day`, so "the
day was rebuilt" and "the follow-ups were swept" stay distinguishable in
`cron_runs` — the same rule Phase 5 set for every other step.

**People** is a new tab: what you are late on first, then the ties by strategic
importance with all five scores visible, then each person's meetings,
commitments and remembered facts, with the brief and the capture form on the
meeting itself.

**Not in this phase, on purpose:** no model is called. The dossier is assembled
from rows, and the rendered template prompt is stored rather than sent. Routing
a person's history to a model is a privacy-class decision — `people.privacy_class`
defaults to `private` for exactly that reason — and it belongs with the phase
that has a reason to make it.

## Phase 14 — Investor OS and Wealth Command Center

Migration `0012_investor_wealth.sql` adds twelve tables: `entities`,
`portfolio_vehicles`, `wealth_tracks`, `theses`, `deals`, `lps`,
`opportunities`, `decisions`, `predictions`, `red_team_reviews`,
`calibrations`, `capital_allocations`. All twelve joined `SNAPSHOT_TABLES` and
the restore test builds the whole chain — thesis through decision, challenge,
prediction and calibration, then entity through vehicle, track and allocation —
before replacing the database.

Probability is stored in basis points and money in integer USD micros, so a 65%
forecast is `6500` and nothing in the scoring depends on float equality.

**The Decision Journal and the Prediction Vault are one mechanism.** A decision
needs at least two options, because one option is a plan with a justification
attached. It cannot be committed until the red team has seen it; a `kill`
verdict can still be overridden, but only in writing, and the override is stored
on the decision and logged at `warn`. Anything above low stakes commits with a
falsifiable prediction attached — the pair is what compounds, and either one
alone is a diary.

A prediction records its resolution criteria and its resolution date before the
fact. `0%` and `100%` are refused: certainty is not a forecast. Resolving one
stores its Brier contribution, `(p − outcome)²` in basis points, and recomputes
the calibration score across every resolved prediction — so the number on the
screen moved because that forecast moved it. Ambiguous resolutions are counted
and excluded rather than scored, because a criterion that did not settle says
something about how the prediction was written, not about the forecasting. The
run stores its buckets, so the screen can say *where* the forecasting is off —
overconfidence at the top end reads differently from hedging in the middle — and
`GET /api/investor/calibration` names the predictions past their date and still
unresolved, which is the way a prediction vault actually fails.

**Deal Energy Protection** is enforced in the API, not only in the UI: a rule
only the screen keeps is a rule a curl breaks. Exactly one deal may hold focus,
guaranteed by a partial unique index rather than by a check the second request
can lose, and the loser of two simultaneous requests is refused rather than
500ing. Closing, passing or killing a focused deal releases it. `GET
/api/investor/deals` returns the pipeline first and the focused deal second —
the ordering is the protection — and reports a thin pipeline behind a focused
deal, focus held longer than thirty days, and overdue next steps as warnings.
The Capital screen renders it in the same order. Opportunities are weighted by
probability, so a large number at 5% does not outrank a small one that is nearly
certain.

**The Trading Allocation Bridge** is the only path across the lane boundary and
it goes one way. `src/server/investor/bridge.ts` contains SELECTs only, joins no
trading table to an ops table — two reads assembled in TypeScript, because a
join would quietly make the lanes one book — and returns a snapshot marked
`read_only`. Wealth refuses to create a vehicle of kind `trading`, refuses an
entity tagged into the trading lane, and refuses any allocation carrying a
trading account or position, all with the same refusal text. The Wealth summary
reports `ops_micros` and `trading_micros` separately and states
`allocatable_micros` as the ops figure alone, so no total silently blends
governed trading capital into deployable wealth. A test asserts the trading
tables are byte-identical before and after a bridge read.

Wealth also refuses what it cannot stand behind: allocation targets that would
total more than one book, capital moved against a decision still being argued,
and a value with no date. Marks older than six months are reported as stale,
because a stale mark is worse than a missing one — it looks like knowledge.

**Not seeded, on purpose:** canon §42 fixes ten wealth track names. No authority
document available to this build reproduces them, so `wealth_tracks` ships empty
and `GET /api/wealth/tracks` says exactly that rather than shipping ten invented
names that would then be indistinguishable from canon.

**Not in this phase, on purpose:** no live capital moves anywhere. Wealth records
what is held and what was decided; nothing here places an order, wires money, or
touches the trading lane's authority envelope.

## Phase 15 — Knowledge OS surfaces

Migration `0013_knowledge_os.sql` adds five tables and three columns. The
tables: `knowledge_surfaces` (seeded with canon §45's twelve),
`knowledge_items`, `manual_versions`, `knowledge_retirements`,
`knowledge_exports`. The columns are on `memory_items`: `sensitivity`,
`retired_at`, `retired_reason`.

**Typed surfaces, not a parallel store.** `knowledge_items` files a memory onto
a surface; it never copies one. The knowledge stays in `memory_items`, so
promotion, the approval gate, the sweep and the vault keep working unchanged.
Two of the twelve — the Decision Vault and the Prediction Vault — are windows
onto Phase 14's tables rather than storage of their own, because duplicating
them would create a second copy that drifts. Filing onto those two is refused
and says why. Each surface declares the lowest tier it accepts: the Wisdom Canon
takes canon tier only, and filing a working-tier memory there is refused with
the instruction to promote it first. A surface that accepts anything is a
folder.

**The Manual is generated, never typed.** It reads what is filed on the surfaces
marked `in_manual`, promoted to working or canon, live, and not restricted. The
version is content-addressed: the hash covers the sections and deliberately not
the generation timestamp, so regenerating with nothing changed writes no version
and returns `unchanged: true`. A new promotion produces a new version that
records the one it supersedes. What was left out is counted and returned beside
what went in — retired, restricted and unpromoted filings each have their own
number, so the document can say what it is not showing.

**Memory retirement**, which canon requires and the implementation lacked. It is
neither deletion nor archival: the row stays, its promotion history stays, its
filings stay, and it stops surfacing — in memory listings, on every surface, in
the Manual, in exports, in the promotion sweep, and at the promotion gate, which
refuses to promote a retired memory because promoting something that stopped
being true is how canon rots. Retiring requires a reason, restoring is
symmetric, and both are written to `knowledge_retirements`, because why
something stopped being true is often worth more than the memory was.

**Portable export with a SHA manifest**, written through the existing vault path
into R2. Every document is hashed individually and the payload as a whole, the
manifest names the surfaces each item was filed on, and `verify` re-reads the
object from R2 and re-hashes it — a manifest nobody checks is a promise. Retired
memory is never exported: it stopped surfacing, and an export is a surface.

**The restricted-class allowlist.** Restricted knowledge follows the law the
router already keeps: it does not leave by default. An ordinary export omits it,
counts it, and names each omission with its reason in the manifest. Including it
takes both an explicit `include_restricted` and the typed confirmation
`INCLUDE RESTRICTED` — the same shape as the vault's replace path — and the
export row records that it carried restricted content, with the event logged at
`warn`.

**Not in this phase, on purpose:** no automatic filing. Nothing decides which
surface a memory belongs on; the Boss files it. A classifier that guessed would
put private history in the Legacy Vault and be wrong quietly.

## Phase 16 — Spirit OS, astrology, contribution, ancestors

Migration `0014_spirit.sql` adds nine tables: `manifestations`,
`manifestation_evidence`, `rituals`, `ritual_runs`, `dream_entries`,
`contributions`, `ancestor_entries`, `astro_calendar`, `astro_days`. Eight are
the ones the build plan names; `ritual_runs` is the ninth, because a ritual with
no history cannot answer "did I actually do this", which is the only question
the screen needs to answer.

**The sky is computed, not fetched.** `src/server/spirit/astro.ts` implements
the standard truncated series from Meeus — the lunar longitude to about a third
of a degree, and the new and full moon times from the ch. 49 corrections. Tests
check it against published lunar events rather than against itself: the phase
times land within ten minutes of the almanacs, illumination at a new moon is
under 2% and over 98% at full, and the Moon walks all twelve signs in a month.
Near a sign boundary the API names the adjacent sign instead of picking one, and
every response carries the method string, because a computed number with no
stated method invites being believed.

Twenty-four months of new moons, full moons and the seven windows derived from
them are computed and stored, with no network call anywhere in the path — which is
what makes the Emergency Offline Library from Phase 15 mean something. It is
recomputed nightly by a `roll_almanac` cron step, and any other month is
computed on demand, so a view of last spring works exactly as well as next week.
Recomputation is idempotent: the arithmetic is deterministic and the unique
index absorbs the repeats.

**Canon §42.2's five windows are named as canon names them.** Push, visibility,
networking, reflection and rest are laid across every computed lunation as
fractions of the interval from one new moon to the next, so they tile the month
exactly once and never overlap — a test asserts each window begins where the last
one ended. The names come from the build plan; the boundaries do not, and every
row says which is which in its own `detail` rather than letting a derived edge
pass as authority. The daily view names the window the day is in; the two ritual
anchors — intention around the new moon, release after the full — stay separate
objects, because a ritual is anchored to a moon and not to a window.

**Two gaps, kept apart on purpose.** The natal layer — placements, transits to
them, planetary ingresses — is `DEFERRED — NO EPHEMERIS SOURCE`. Nothing about it
is waiting on this build: there is no acceptable ephemeris and no vendor that
would not take birth data out of the Worker.

Retrograde periods and shadow windows are a different thing entirely, and an
earlier pass in this build filed them under the same status, which was wrong.
Build plan §1.5 D4 makes canon §42.3's hand-entered calendar the *primary*
implementation for them: a table "entered once from a public almanac and
refreshable the same way". They were never blocked on an ephemeris — they were
blocked on a five-minute paste, and calling that permanently deferred is how it
never gets done. So `POST /api/spirit/astro/almanac/import` is that path. It
validates the mistakes a person actually makes while copying a calendar — a
period that ends before it starts, a mistyped year, a shadow with no retrograde
attached to it, the same row pasted twice — records which almanac every row came
from, and refreshes by replacing the range rather than layering a second copy
over it. A refresh is scoped to imported rows, so it cannot take the computed
lunar almanac with it.

What did not change is the refusal to invent. There is no default retrograde
table in this repository and no migration ships one; a test still asserts no
retrograde row was fabricated to fill the gap. What changed is that the system
now says *what it is waiting for* — `AWAITING ALMANAC IMPORT — MANUAL ENTRY
(canon §42.3)` — and `GET /api/spirit/astro/almanac/coverage` reports how much of
the twenty-four-month horizon is actually entered, strictly: two rows for next
spring do not cover two years, and the month screen says the forward view is
incomplete until they do.

**Canon §1.5, the anti-delusion rules, are enforced and not merely described.**
A manifestation cannot be created without the first concrete action; the system
will not hold a wish. It closes on three things the Boss did and one result
somebody else could check — and a "result" claimed as verifiable without a
reference is refused, because a result nobody can check is a feeling with a
stronger word attached. Signs — dreams, synchronicities, the number seen three
times — are recorded, because they matter to the person, and never counted. The
API says so at the point of recording (`counts_toward_completion: false`), in
the progress object (`signs_counted: 0`), and in the refusal to close, which
names how many signs are on file and that none of them count.

**Canon §5.2, reality has priority.** Every Spirit read carries a reality check
computed from the operational tables — open dead letters, failed tasks,
unresolved high-severity incidents, approvals expiring within a day, overdue
follow-ups, the trading kill switch — and states it before anything about the
sky. The Spirit screen puts that block above the moon, the Today screen's Spirit
Signal carries the identical object, and both are produced by the same function,
so the two can never disagree.

**Canon §44's tone is part of the specification.** One contribution a month is
the whole requirement and four is the good month; there is no daily version, no
streak, and no red number. A month with nothing in it says "nothing is owed".
The ancestor practice is an hour a month, "whenever it suits", and nothing about
it is late. A test asserts the empty-month copy contains none of *should*,
*must*, *behind*, *failed* or *streak*.

**Today.** Spirit Signal left the "awaiting substrate" list; two elements remain
there, both Phase 12's.

## Phase 17 — Prompt Intelligence and the Mastery Lens Bench

Migration `0015_prompt_intelligence.sql` adds six tables: `mastery_lenses`,
`pov_cards`, `prompt_packets`, `prompt_scores`, `prompt_library`,
`prompt_traces`. The lens record carries nineteen content fields, as canon
§76.10 specifies a nineteen-field schema; canon's exact field names are not
reproduced in any authority document available to this build, so the nineteen
are derived from the requirements that *are* stated — method, counter-lens,
tier eligibility, failure modes, origin discipline, output shape — rather than
guessed at. A test pins the count.

**Eighteen lenses ship on the bench**, inside canon's 15–20, each with an
ordered method, the questions it asks, the moves it makes to a prompt, the ways
it goes wrong, and the lens that argues with it. Every lens has a counter-lens
and no lens is its own.

**The No Pedestal Law (§76.8) is enforced, not described.** There is no field
for whose lens it is, and sending one is a 400. A name or origin containing a
person from the pedestal list is refused, and so is a possessive — "Ackman's
Screen" fails on the apostrophe, because the possessive is the tell. A lens that
borrows a reputation stops being examined, which is the whole point of the law.

**Canon §76.3's trigger list decides the tier, not the caller.** All eleven
categories canon names are matched — repo work, investor materials, outbound
email, marketing, legal-adjacent writing, financial and trading decisions,
document compiler work, private-data work, external actions, vendor changes,
canonical document updates — plus restricted sensitivity, which is private-data
work by definition. Asking for a light pass on investor materials returns a tier
1 packet whose `tier_reason` records that tier 3 was asked for and overruled.
The financial matcher is deliberately wide: an over-escalated packet costs a
longer prompt, and a missed one costs an unexamined money decision.

**Compilation is assembly, not inference.** No model is called; the packet is
what the existing router would later be handed. A packet carries the lens stack
(four at tier 1, two at tier 2, one at tier 3), a counter-lens that is never
already in the stack, the points of view it must be read from, an evidence rule,
an output contract and explicit refusals about fabricating sources. The same
request compiles identically twice, which is what makes two packets comparable.

**Scoring is structural and absolute.** Seven dimensions, each with the reason
for its points. The lens-stack dimension is scored absolutely rather than
normalised per tier: a light packet *should* score below a full one, and the
first implementation normalised it, which made a one-lens tier-3 pass score
higher than a four-lens tier-1 packet. The test that caught it compares the two
directly.

**Canon §76.17: nothing enters the library without review.** Promotion proposes
— it writes a `proposed` entry and raises an approval card of a new kind,
`prompt_library_promotion`, handled in the existing approval executor. Approving
admits it; rejecting and expiry close it rather than leaving it proposed
forever, the same symmetry every other gate has. A proposed prompt cannot be
used, and the refusal says so. Writing the library row before its approval row
inside one batch tripped the same foreign-key ordering bug the earlier phases
had to fix; the approval is inserted first.

**Traces join the ledgers that exist.** A packet compiled against a task links
to that task's most recent `routing_decisions` and `usage_ledger` rows. This
phase adds no third ledger, and the trace endpoint says so.

## Phase 18 — Capability Intelligence

Migration `0016_capability_intelligence.sql` adds six tables: `capabilities`,
`active_defaults`, `bench_candidates`, `discovery_inbox`,
`after_action_reviews`, `capability_patches`. The Capability Package carries
twenty-two content fields, as canon §78.4 specifies a twenty-two-field schema;
canon's exact field names are not reproduced in any authority document available
to this build, so the twenty-two are derived from what the phase has to decide
with — what job it does, what it costs, what it risks, how mature it is, what it
cannot do, how it fails, and where the claims come from. A test pins the count.

**The registry describes only what this build has.** Sixteen packages, each
naming a mechanism that exists in this repository and citing the files and tests
that back the claim: the queue, the cron, the router, the packet compiler, the
approval inbox, the promotion gate, meeting intelligence, the decision journal,
the paper broker, the benchmark bench, the agent gate, repository work under the
validation command, and the Boss's own judgement where the coaching faculty is
absent. Registering a package with no stated limits is refused — a package with
no limits has not been used yet.

**One capability per job type, enforced by the primary key.** `active_defaults`
is keyed on the job type, so a job cannot quietly have two things running it.
Every serious job type has a default; `west_peek_bridge` is the one that does
not, and it is recorded as deferred to Phase 21 with the reason rather than
pointed at something that would read as coverage. A job type with no default is
not a gap in the report — it is one of the nine discovery triggers, by name.

**The bench is not a rotation.** `GET /resolve/:job_type` reads the defaults
only; benched alternatives are listed for visibility and never fall back into
runtime. The one alternative that ships — local model inference — is benched
precisely because no local runtime exists here, which is what a bench is for.
Promoting a candidate records the capability it replaced and puts that one back
on the bench rather than deleting it.

**Search is trigger-based, per roadmap §79.6.** All nine triggers are named, and
a discovery with no trigger is refused with the reason: looking without one is
continuous tool-chasing.

**After-action review reads real traces**, not impressions: the tasks of that
job kind in the window, their statuses, their error messages and their
dead-letter records. Findings cite the task ids they came from. Past the failure
threshold it raises a repeated-failure discovery and proposes a patch. Writing
the patch before the review it references tripped the foreign-key ordering rule
again; the writes now follow the keys — discovery, then review, then patch.

**A core capability does not change on somebody's say-so.** A patch to a `core`
package is raised as a high-risk approval and changes nothing until it is
approved; applying it directly is refused and says why. Rejection and expiry
close the patch, so a core capability is never left with a change that is
neither applied nor abandoned. Patches to standard packages apply immediately
and are still recorded, with the package version bumped either way.

**The standing cadence.** Canon puts the monthly scan and the quarterly review
on Phase 10's standing duties. `standing_duties` is not in the surviving
artifact — Phase 10's migration is absent from this repository — so the cadence
rides the nightly cron as a recorded `capability_cadence` step, which is a
deliberate no-op on any day that is not the first of a month. When Phase 10's
substrate exists, these become two duty rows and `runCapabilityCadence` becomes
their handler; the behaviour does not change.

## Phase 19 — the Operating Governance Layer

Migration `0017_governance.sql` adds eight tables: `decision_rights`,
`emotional_states`, `compliance_flags`, `failure_playbooks`,
`maintenance_items`, `ip_assets`, `brand_profiles`, `learning_entries`. Every
one of them is read by a code path that can refuse something, which is what the
build plan means by enforcement rather than display.

**Canon §18 gates the protected actions.** A state is recorded by the Boss with
its own risk classification — the system does not infer distress from typing
speed, and inferring it would be worse than asking — and it expires, because a
Tuesday should not be gating a Friday. While a high-risk state is in force,
`assertProtectedAction` refuses placing an order, changing the trading authority
envelope, committing a decision, allocating capital, exporting restricted
knowledge, and deciding any protected approval kind. Everything else runs
normally: capture, meetings, reading, drafting, deferring.

The refusal is kind and specific, and that tone is part of the specification:
*"Not now. You recorded yourself as grieving at 09:14, and placing an order is
one of the protected actions. It will still be here when the state clears, and
nothing has been lost."* A test asserts the copy contains none of *should not*,
*irresponsible*, *mistake* or *failure*. Deferring an approval is never held —
canon holds decisions, not the person.

Every refusal writes a `compliance_flags` row with the action class and the
state that caused it, an audit entry, and a `warn` system event, so the pattern
is visible later rather than only felt at the time.

**Canon §2–§3, decision rights, are consulted by the approvals layer.** Before a
decision is recorded, the rights table is read: a right naming a decider other
than the Boss refuses the decision and says who it belongs to, and a protected
class runs the §18 gate. Twelve rights ship, one per action class this build
actually has, each with the rationale it is enforced under.

**Canon §4, the Compliance Sentinel.** Eleven watch items, each tied to a real
table — a high-risk state in force, restricted knowledge that left, a refused
protected action, the kill switch, untriaged dead letters, a stale vault,
approvals expiring within a day, overdue maintenance, an IP renewal inside
thirty days, predictions past their date, and a job type with no capability
default. Canon §4's own enumeration is not reproduced in any authority document
available to this build, so the list is what this system can genuinely check,
and the endpoint says so. Flags are idempotent per watch item and subject:
running the sentinel twice does not double the board. It runs nightly as its own
recorded cron step. Clearing a flag means the condition stopped being true;
accepting one means the Boss decided to live with it, and requires a reason.

**Canon §17, the Anti-Dependency Protocol, is a real check**, not a promise. Six
questions asked against real rows: is anything readable offline, is there a
verified snapshot, does a portable export exist, has a restore actually been
rehearsed, is more than one provider path configured, and is how the Boss
operates written down outside the Boss. A fresh database fails most of them and
says so plainly.

**Canon §7's mode card** is assembled from live state — cost mode, trading
authority, the state in force, the rights table — rather than declared, and lists
each protected action with whether it is open or held right now.

Playbooks surface themselves: `GET /playbooks` evaluates each one's condition
against the live tables and returns the ones that apply now first, because a
playbook nobody sees at the moment it applies is a document. Maintenance items
carry cadences, become flags when overdue, and doing the work clears the flag.
The brand check holds a draft against what the brand never does — including
emoji in outbound work — and says it is a keyword check rather than a judgement
of quality.

## Phase 20 — the SEO/GEO and Document Compiler runtimes

Migration `0018_runtimes.sql` adds four tables — `runtime_jobs`,
`document_artifacts`, `seo_audits`, `geo_probes` — and registers both runtimes
as Capability Packages in the Phase 18 registry.

**Both run as governed work, not as function calls.** A run is classified
through the same intake classifier, given a real permission envelope, resolved
to a capability that must not be retired, and closed with an evidence packet on
every terminal outcome — including failure. A runtime that created tasks by hand
would be a second door into execution with none of the governance on it.

**Document Compiler Mode is the current default for drafting**, which is canon
§78.8 working rather than being described: the migration moves the drafting
default from the packet compiler to the compiler and benches the packet
compiler, with `reviewable, not doctrine` written into the reason. The Phase 18
test that asserted the old default now asserts the new one and says why.

**The compiler assembles; it does not write.** Seven live sources read real
tables — the day's briefing lines, the book by track, recent committed
decisions, the current calibration score, the Manual's sections, open compliance
flags, late commitments — alongside text supplied with the request. A section
whose source returns nothing is recorded as absent with the reason, never
filled, and the absence is carried into the evidence packet as an unknown and
into the next human action. The output is a real markdown file in R2 with a
per-section manifest, a hash per section and a hash of the whole; `verify`
re-reads it from R2 and re-hashes it. The same inputs compile to the same hash.

**The SEO/GEO runtime produces evidence, never a claim.** Ten static checks,
each stating what it observed and quoting what it read — one top-level heading,
sectioning, whether the first paragraph answers rather than introduces, length,
sentence length, whether there are actual figures, whether claims carry a
source, links, the reader's own questions, and whether the subject is named.
Findings carry a severity and a fix. The GEO half probes each question against
the text: is the answer present, and does the sentence carrying it let a reader
check it.

**What needs a network is named, not estimated.** Indexation, backlinks, search
position, competitor coverage, real-user timings and whether generative engines
cite the page are all reported as `DEFERRED — NO NETWORK ACCESS`, and they ride
in the evidence packet as risks remaining. A URL is refused outright rather than
pretended at. A test asserts the whole response never contains a ranking claim.

The two runtimes close a loop: a compiled artifact can be audited directly, and
the audit's evidence packet cites the artifact it read.

## Phase 21 — the Firm OS bridge and separation

Migration `0019_firm_bridge.sql` adds one table, `bridge_handoffs`, and that is
the point: this phase does not join the two systems, it adds the single narrow,
audited crossing between them.

**The forbidden list is hardcoded in the application**, not stored in a table.
A forbidden list that lives in a table is a forbidden list somebody can edit at
2am, and this boundary exists precisely for the moments when someone is in a
hurry. Twelve categories never cross in either direction — health, personal
finance, family, journal, spirit practice, relationship dossiers, anything
classed restricted, trading positions, credentials, and, inbound, client
confidential material, client personal data and firm payroll. Each carries the
reason it is on the list, because a refusal that cannot say why teaches nobody
anything.

**The allowlist falls closed.** An unrecognised category is a refusal, not a
question. Six categories may cross: engagement scope, deliverables, schedule
slots, invoice references, published material, and capability notes.

**The bridge carries a reference and a summary, never the object.** It cannot
leak a body it never holds. When the reference points at a memory, the
classification decides regardless of the category: restricted never leaves, and
private is refused with the instruction to reclassify it as internal if it is
genuinely firm material.

**A refusal is recorded, not discarded.** It writes a `refused` handoff row with
its reason, raises a compliance flag, logs at `warn`, and never creates an
approval — there is nothing for the Boss to decide about a category that does
not cross. The pattern of what somebody keeps trying to send is exactly what a
boundary needs to be able to show later.

**An allowed category still needs the Boss.** Every crossing raises an approval
in this system's own inbox, so the firm cannot approve its own request. The
category is re-checked at the moment of crossing, and a handoff whose category
changed between proposal and approval is refused then — a check that only runs
at proposal time is a check with a window in it.

`GET /separation` states what keeps each of the seven dimensions separate —
repositories, permissions, memory, budgets, approvals, audit logs, deployment
scopes — and counts the crossings and refusals against them, because separation
is the default state and the bridge is the exception.

## Phase 22 — the AI Quant Fund, Parts B–G

Migration `0020_quant_fund.sql` adds eight tables: `trading_engines`,
`kill_switch_probes`, `deployment_stages`, `strategy_desks`,
`promotion_scorecards`, `scale_rungs`, `trading_sequence`, `trading_nevers`.
The existing authority envelope, six micro-live gates, notional ceiling, symbol
allowlist, position limits, kill switch and incident ledger are untouched — the
build plan is explicit that they stay as they are.

**The governing document is not in this build's authority set.**
`Boss_OS_AI_Quant_Fund_Master_Plan_v5.md` governs this phase and is not present
in `AGENT_INPUTS` or `SOURCES`. What is implemented follows the locked decision
that derives from it — build plan §1.7 D6 — together with the architecture
notes' record of the ladder, the envelope, the 90-day sequence and the risk
constitution. `GET /api/quant/ladder` says so in the response, and where the
master plan's own detail would be required — per-strategy parameters, the
day-by-day sequence, the complete fourteen nevers — this build records what it
has rather than inventing the rest.

**Boss OS governs; it does not execute.** No route here places an order. There
is no credential field in the schema, sending one is refused with the reason,
and a test asserts no column named `api_key`, `secret`, `credential`, `token` or
`passphrase` exists. Switching the engine to `live` is refused: live execution
needs a broker adapter that is not in this repository. The engine ships as
`planned`, because provisioning is a human action and this phase does not
pretend otherwise.

**The Capital Deployment Ladder does not skip.** Seven stages, each with its
capital limit, pass and fail criteria, required logs, required review and an
explicit advance approval. A scorecard that steps over a stage is refused; so is
a promotion with no scored criteria, because an unscored promotion is a hunch. A
failing card cannot even be sent for approval, and a passing one advances
nothing until the approval is decided — the ladder never advances on a score
alone. The 90-day sequence enforces the same rule week by week: week five cannot
start while week two is unfinished, and every week carries the same failure
rule — do not skip forward, repair the failed gate.

**The kill switch is proven, not assumed.** Build plan §1.7: *a kill switch that
only sets a local flag is not a kill switch.* So the proof is a round trip — a
stop command sent to the engine's control endpoint and an acknowledgement read
back. An engine with no control endpoint is `not_configured`, a reply without an
acknowledgement is `no_ack`, an unreachable engine is `error`, and all three are
unproven. Proof expires after thirty days and has to be re-earned. Until it is
proven, the micro-live scorecard is refused and no scale rung opens.

**No autonomous capital increase.** Rungs open in order, only behind a proven
kill switch, and only through a high-risk approval in the trading lane. The
request records the reason; the capital moves when the approval is decided and
not before. Opening a rung is also a §18 protected action, so a high-risk
emotional state holds it like any other trade.

**The risk constitution records what actually enforces each never.** Ten nevers,
each with an `enforcement` column reading `code` or `procedural`. Seven are
enforced by something in this repository and each names it. Three are
procedural — no revenge trading, no discretionary override under stress beyond
what Phase 19 already holds, no live system without a tax workflow — and they
say plainly that nothing here stops them, only the Boss does. Marking a
procedural rule as enforced would be the most dangerous lie in the system.

**The validation status stays honest**, which is itself one of this phase's
acceptance criteria. `GET /api/quant/validation` reports `ready_for_live: false`
and lists what blocks it: no live adapter, an engine that is externally
unproven, the six micro-live gates unrecorded. It distinguishes `unmet` from
`externally_unproven`, and it does not round up.

**What is genuinely unproven here:** the kill-switch round trip is exercised
against a stubbed transport, exactly as the model adapter is. The protocol and
every refusal around it are proven; the round trip against a real Hummingbot on
a real Hetzner box connected to Kraken demo futures is not, because no server,
account or key exists in this build. Nothing in this phase provisions anything,
and the acceptance criterion "kill switch proven against a running demo engine"
remains open against a real engine — the status says so rather than claiming it.

## Phase 23 — continuity hardening

Migration `0021_continuity.sql` adds `sovereignty_packages` and
`sovereignty_drills`, and four continuity maintenance items that join Phase 19's
existing cadence machinery rather than starting a second reminder system.

**The Emergency Sovereignty Package is one file.** It carries the Personal
Operating Manual, every memory filed on an offline surface, every approved
prompt, and the three recovery documents — the disaster recovery runbook, the
restore checklist and the initialization prompt — with a SHA-256 for each item
and one for the whole payload. Restricted knowledge is deliberately absent: the
package is designed to be copied to an SSD and left in a drawer, and canon's
restricted class does not leave the system by any door, including this one.

**The documents live in code and travel with the package.**
`src/server/continuity/documents.ts` is the source of truth; `docs/` carries
human-readable copies with a header saying so. The point is that the runbook is
readable when the repository, the Worker and the account are all gone — a
runbook that only exists in the repository you have lost is not a runbook.

**The drill is the acceptance.** It re-reads the package from R2, verifies the
payload hash and every item hash, and then walks the restore checklist against
the package contents alone — no other table is consulted for any answer. The
acceptance test runs it with global `fetch` stubbed to throw, so "completes from
the offline package alone" is proven rather than asserted: anything reaching for
the network would fail loudly instead of passing quietly. A passing drill clears
the maintenance item that asks for it.

The drill fails honestly in every direction that matters: an incomplete package
fails on the missing components and names them, a package that is not in R2
fails every step rather than reporting success, and a package whose body was
altered fails on both the payload hash and the item hashes.

**What the system cannot verify, it does not claim.** The external SSD copy and
the offsite copy are physical acts; they are tracked as maintenance items with
cadences, they become compliance flags when overdue, and nothing marks them done
on the Boss's behalf. `GET /api/continuity` lists every component of the package
with whether it is present, and says which two it can never check.

**Canon §106's local model stays deferred.** No local runtime and no host exists
in this build, so the criterion is reported as `DEFERRED — NO LOCAL HOST` with
the smoke test that would prove it, rather than marked met. A local model that
has never answered anything is not a fallback.

## Externally unproven

These are implemented but were never exercised against the real external
service, because doing so needs credentials and an account this build does not
have:

- Fireworks (or any) live model inference — the adapter is exercised against a
  stubbed transport in tests, never against the provider
- Cloudflare deployment, real Queues delivery and retry, real Cron firing
- Any broker, live or paper, beyond the in-process simulator
- The quant engine: no Hetzner box, no Kraken demo account, no Hummingbot. The
  kill-switch round trip is exercised against a stubbed transport, so the
  protocol and every refusal around it are proven and the round trip against a
  real running engine is not. `GET /api/quant/validation` reports it as
  externally unproven rather than met.
- The external SSD copy and the offsite copy of the sovereignty package. They
  are physical acts; the system tracks their cadence and cannot see the drawer.
- Canon §106's local model. No local runtime and no host exists here, so the
  criterion is reported as `DEFERRED — NO LOCAL HOST`.
- Any screen in a real browser — Today, People, Capital, Spirit, Team, Memory,
  Vault, Settings. Their APIs are covered end to end by tests against a real D1
  inside workerd, and the SPA compiles and builds, but nothing in this build has
  rendered them on a device.

## What was verified end to end

Every phase's acceptance sentence is walked by a test that fails if the
behaviour stops being true, against a real D1, R2 and KV inside workerd with the
actual migrations applied. Three checks are worth naming because they are the
ones that catch decay rather than bugs:

- **The restore.** A populated database — every table from every phase, with the
  foreign keys that connect them — is snapshotted and replaced from the
  snapshot, and every table comes back with exactly the row count the snapshot
  recorded. A schema test independently proves no table is missing from the
  snapshot list except the vault's own two journals.
- **The offline drill.** The sovereignty package is verified and walked with the
  network stubbed to throw, so "works with no network" is proven rather than
  asserted.
- **The absent-input rule.** Blocks, briefs, documents and packages all state
  what they do not have; tests assert the copy contains no TODO, placeholder or
  invented value where a real one is missing.
