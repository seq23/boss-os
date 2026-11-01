# Boss OS — rules for anyone working in this repo

Boss OS's own authority is [`docs/boss/`](docs/boss/) and [`STATUS.md`](STATUS.md). The root
documents (`AGENTS.md` and friends) describe the inherited West Peek chassis; read their banner.
Operating facts and traps (the `/api/boss/*` mount, the passcode, mail keys, cadence, Mac runs,
lanes, performance) are in [`docs/boss/OPERATING_FACTS.md`](docs/boss/OPERATING_FACTS.md).

## Company brain

Boss OS is part of the `personal` brain (Boss OS itself, Spirit, gates, coaching, her schedule); the
`team` brain is who's who across her AI teams. Read `~/Brains/personal.md` and `~/Brains/team.md`
before work here, and the brain of whichever business a change serves. `~/Brains` is a read-only
copy: business facts and rulings are edited in Boss OS (the Brains screen, or
`PUT /api/boss/brains/<slug>`), never only in a session's memory; how this repo works stays in `docs/`.

## Outreach rules

Monique's outreach sends automatically for the side businesses (owner, 9 Oct 2026: "u do it all").
Two rules govern it. Both are enforced in code and pinned by `tests/boss/moniqueOutreach.test.ts`
("outreach rules (owner, 9 Oct 2026)"), which also reads this section.

1. **heygetonmylevel.com is NEVER an outreach target** (owner, 9 Oct 2026: "skip this for outreach").
   It is a free bonus for Time2Read subscribers, not a product sold on its own. It has no entry in
   `src/worker/boss/outreach/catalog.ts`, no referral code, no sender and no domain setup in
   `npm run outreach:domains`. `NEVER_OUTREACH_DOMAINS` lists it and `assertSenderAllowed` refuses
   it at send time. Its grid, health and heartbeat monitoring are untouched: this rule is outreach only.
2. **Outreach never sends through, or needs a permission in, West Peek's Google Workspace
   (westpeek.ventures)** (owner, 9 Oct 2026). The side businesses are Spry's. The outreach sender
   impersonates only `OUTREACH_MAILBOX` (st@time-2-read.com); `assertOutreachMailboxAllowed` refuses
   any `sub` on westpeek.ventures before a token is minted, `assertSenderAllowed` refuses any From
   on it, and `scripts/outreach/domains.mjs` refuses to run as a westpeek.ventures admin or mailbox,
   for a westpeek.ventures domain, or against a Workspace whose domain list includes it
   (`assertOutreachSetupTarget`, exit 4).
3. **The CAN-SPAM postal address is private runtime data.** It is set per business on Team →
   Outreach (`outreach_domain_state.postal_address`, through the API or D1) and never written into a
   git file, fixture, commit, PR, log or report: the repo is public. Tests use a fake address, and a
   test in `moniqueOutreach.test.ts` scans the repo for the real one. Emails show it in the footer:
   one short line in plain text, 10px muted grey beside the unsubscribe link in HTML.
   A business with no address of its own inherits the one every other business shares, read from
   their rows at send time (`effectivePostalAddress`, engine.ts); a route-ready business refused in
   the sending window for a missing precondition is a NAMED STOP on Today (`outreachStopAlerts`),
   never a quiet skip (16 Oct 2026, Memphis Senior Care Homes sent nothing for two days).
4. **No live send from a domain without SPF, Google DKIM and DMARC** (9 Oct 2026: Gmail blocked
   aplayermode.com and approvalprep.com test sends, `550 5.7.26` DMARC — empty DKIM key under
   `p=reject`). `mailAuthRefusal` (`src/worker/boss/outreach/mailauth.ts`) reads the sender domain's
   TXT records over DNS-over-HTTPS before every live send; a gap or a failed lookup refuses it. Test
   sends to the test inbox still go, so a fixed domain can be proven first.

## Agents never spend money

Owner, 22 Oct 2026: **"AGENTS NEVER SPEND MONEY."** No Boss OS employee, on any lane, cloud rung or Mac
seat, executes a purchase, checkout, payment, subscription, plan upgrade, top-up or renewal. Each one
prepares everything up to the checkout (the link, the exact price, what it buys and why) and hands it to
her as a decision; she pays. Enforced in code, three places, and pinned by
`tests/agentsNeverSpend.test.ts`, which reads this section:
1. `src/shared/boss/duties/executors.mjs` — `NEVER_SPEND_RULE`, `spendStepIn`, and the `owner_spend`
   capability that no seat in `SEAT_EXECUTORS` holds; `checkAssignment` refuses a spend step for every
   seat. `validate:work-reaches-executor` fails the build if a seat is ever given `owner_spend`.
2. `src/shared/boss/service/practices.mjs` — R32 in `SERVICE_PRACTICES`, so the sentence is in front of
   every employee run (cloud rungs, Mac seats, Danielle's repo lane through `{{PRACTICES}}`).
3. `docs/SERVICE_RULES.md` — R32 [ALL-KINDS], read by `validate:service-rules`.

## Deals: matches and the archive

Owner, 24 Oct 2026. In code in `src/shared/boss/deals/match.mjs` (size, price, age) and
`scripts/ops/interest-grid.mjs` (`otherSides`, `allMatches`, `moniqueFound`), pinned by
`tests/morningFullContext.test.ts` and `tests/dealGrid.test.ts`:
1. **A buy and a sell on the same company match** when sizes fit (partial fills say "fills $15M of
   their $100M"; small orders stack) and prices are within 15% (`DEFAULT_TOLERANCE`; the Matches
   screen offers 5–30%). **A missing price never hides a match**: it ranks below, "worth asking".
   Never two Rainmaker sides, never anyone on her do-not-suggest list (`pairAllowed`).
2. **Age counts.** Fresher first; an order over 60 days is "may be stale — check it's still live";
   over 6 months it leaves the email and shows on the Matches screen as "old".
3. **The grid is six months; the Archive is six to twelve.** A view by the source email's date, never
   a deletion; only the main grid is matched; a new email about an archived order is a fresh row.
4. **Her own deals read "Yours: buyer" / "Yours: seller"** everywhere.
5. **A match is one buyer and one seller on one company, counted once** (24 Oct 2026: "1,305 in all;
   1,359 within the 15% limit" contradicted itself — one broker re-sending an order every week was
   counted every time). `allMatches` collapses order pairs to party pairs (`pairKeyOf`, `orders`), and
   every number quoted comes from `matchCounts`.
6. **Monique found is ONE grid, never hundreds, never Decide** (owner, 25 Oct 2026, mock-up v2):
   company (+N more) | seller → buyer with sizes and prices | fit in plain words (size, price, age: "size fits, prices close, fresh") | "Open ›" to
   the trade's card on the Matches screen, which holds the seller's ready email and Dismiss. At most
   `MAX_EMAIL_MATCHES` (5) rows, one per company, live and within tolerance; a ⭐ match sorts first and
   earns the star only when both prices are known and within 10%, the seller fills at least 25% of the
   buyer or $10M, and both orders are under 14 days (`STAR`, `matchFit`). A row stays until she
   dismisses it or one side goes stale. **No match goes to Decide**: Decide is her own moves (LP
   replies, approvals). Then "Still looking" as one line, the filings and press as one link, and one
   count line, "See all N matches →". "New deals since yesterday" is a grid too: company | side |
   size @ price | from | Open ›. Pinned by `tests/matchGridAndStar.test.ts` and
   `tests/morningSizeAndMatches.test.ts`.
6a. **Dismiss is one table** (`capital_dismissed`, `src/worker/boss/capital/dismiss.ts`): the card's
   button, the one-tap link and her reply "dismiss <code>" all write it; the Matches screen, Today
   (the kept morning) and her Mac's morning run all read it. A dismissed pair comes back only on a new
   order (a new size or price). Pinned by `tests/boss/dismissMatch.test.ts`.
7. **Outward words call her buyers "LPs"** (owner, 24 Oct 2026): match notes, prospect emails, LP
   replies and deal drafts never say "buyer"; a prospect email never names Anthropic (it alludes:
   `NEVER_NAMED`, `src/shared/boss/lp/plan.mjs`). Pinned by `tests/outboundWords.test.ts`.

## Emails to her

Owner, 23 Oct 2026 (inbox review: nine Boss OS emails in two days, none useful). Enforced in code and
pinned by `tests/plainEmail.test.ts` ("the rules in CLAUDE.md"), which reads this section, and by
`npm run validate:email-plain`:
1. **One morning email.** Simone's (`scripts/ops/your-day.mjs`): Decide → New deals since yesterday +
   Monique found (+ Prospect emails) → ✨ Spirit (week, moon, sky, the morning sequence, a new non-body
   gratitude sentence every day, the month, the week's practice in one line; then one link, "See the
   full sky, body and practice in Boss OS →" — trimmed 25 Oct 2026) → Camille's briefing (five lines and "Read the full briefing →" to its screen — the whole briefing is never
   in the email; it waits for the report, 07:45 Central at the latest) → Done for you (≤3)
   → Catch up with → Porch & Party: To do for Valerie → sign-off → the 8Raise line only when something
   is wrong. Every other producer writes a section file (`src/shared/boss/mail/morning.mjs`) instead of
   an email. Another email only when it cannot wait: a decision due today, money at risk, a deal moving now.
   **Every decision is in Decide, all of them** (24 Oct 2026: "6 decisions" showed 3 and Today showed
   none): the count is the number shown, each item says who (with their full address), what they
   said, the history, the words that go out in her name word for word ("Send as is" never sends what
   was not shown), and links to its own screen. The run posts the whole morning to Boss OS before it
   sends (`/api/boss/morning`, `src/worker/boss/routes/morning.ts`); Today lists the same decisions
   and every link opens that item (`/?morning=<day>&item=<id>`). Anything an employee can fix is a done
   line, never a decision — a task that failed is ONE fix job per job family and a done line the next
   morning (`failedTaskLines`, `fixJobsToOpen`). **Told once** (owner, 26 Oct 2026,
   `src/shared/boss/mail/morningMemory.mjs`, pinned by `tests/morningMemory.test.ts`): Done for you
   shows an item once, never twice in one email, one short whole sentence each, at most three, then
   "+N more on Today ›" (the full What happened / What we did / Status stays on Today); a Decide item
   she has already seen is one thin line on later days ("Still yours to answer: name · N days ·
   Open ›"), kept, and not counted as a fresh decision in the subject. Pinned by
   `tests/morningFullContext.test.ts` ("Rule 0: everything awaiting her is in Decide").
2. **Decide first, one-tap buttons, plain words.** `layoutEmail` / `layoutProblem`
   (`src/shared/boss/mail/plain.mjs`). Never Gmail ids, commands, /api paths, PR numbers, UTC times,
   #tags, jargon, link dumps or "I could not read".
3. **Problem emails:** What happened → What we did → Status, sent after the fix is running; a stopped
   task is re-checked first; chores (vault, tokens, DNS, unreadable sources) are fix jobs, never her mail.
4. **Where it stands (combined boss fix, 23 Oct 2026):** One morning email from Simone; Mac emails pass
   the plain-email gate before sending. LP replies run daily through the delegation with one-tap send;
   the Tuesday reminder and the connector digest are retired. Deals grid live; ~6-month lookback;
   Rainmaker and do-not-suggest lists edited by reply. Every morning section goes through
   `writeMorningSection`; a one-tap button is a page (`/tap/<token>`), never an /api link.
5. **The gate makes a failing email plain before it ever holds it** (owner, 25 Oct 2026: every email
   clear, never silently held): `plainOrSimplified` in `postEmployeeMail` (`scripts/ops/notify.mjs`)
   reads `mailGate`, then runs `simplifyForOwner` (`src/shared/boss/mail/plain.mjs`), which moves every line carrying a code
   word, file name, flag, id, markdown or command into an attached "details" file, keeps labelled
   lines' labels, and rebuilds the HTML from the plain text. Only what still fails is held and handed
   to Danielle as a repair; `plainReply` guards the Worker's replies. No code words reach her: file
   names, flags, validators, build and commit words and markdown are in the gate's own checks.
   Every sender's real builder output is pinned by `tests/everySenderPlain.test.ts`.
6. **Never risk Gmail's clip** (owner, 24 Oct 2026: Gmail hides an email over ~102KB behind "View entire
   message"). The HTML must fit `EMAIL_HTML_BUDGET` (80KB, bytes): styles live on the wrapper, not on
   every paragraph; long lists stop with "See all N →" on their screen (`MAX_DEAL_ROWS`, `MAX_FOUND_LINES`,
   `MAX_PROSPECT_SENDS`); past the budget `CUT_ORDER` cuts the prospect emails' words, then Monique's
   lines to three, then the deal rows to five. **Decisions are never cut.** Pinned by
   `tests/morningSizeAndMatches.test.ts` (a heavy-day fixture that fails over 80KB).
7. **The practice emails** (owner, 31 Oct 2026: "when i go on long streaks of not opening the boss os app
   and not doing coaching and not hitting my gates u should email me … I need tough love sometimes").
   From Imani, Director of Practice, to her only, through `scripts/ops/practice-nudges.mjs` on the
   errand-reminders tick; Boss OS decides and claims each one (`src/worker/boss/practice/lapse.ts`,
   `practice_nudges`, one per kind per day). The lapse ladder: day 2 firm, day 4 tough love, day 7 and
   every 3 days after a hard truth, from 10:00 Central, reset the moment she opens the app, talks to the
   coach or closes a gate. Each states the streak, quotes one of HER laws or contract commitments
   (`LAWS`, `COMMITMENTS` in `today/faculty.ts`), gives one A-player line from `practice/lines.ts`
   (never body, weight or food; never cruel; no hustle clichés) and ONE tiny action with a link. The
   midday push carries the day's law while the Midday gate is open. Only THAT she engaged is stored
   (`practice_engagement`), never what she said: coaching stays LOCAL_ONLY. Pinned by
   `tests/boss/practiceLapse.test.ts`.

## Search Readiness: the checklist enforces itself on the grid repos

Owner, 25 Oct 2026. Her pinned Search Readiness Checklist is data, run every week on every grid repo
site. Pinned by `tests/searchReadiness.test.ts`, which reads this section:
1. **One definition.** `src/shared/boss/searchReadiness/checklist.json` holds every item (the page's
   71 plus j9, hyperlocal coverage) as an automatic check or a manual item with its reason.
   `npm run sites:page -- --out <path>` renders the pinned page from it; edit the JSON, never the page.
   The page also carries "Where every site stands", one row per site counted from the newest
   `results-<day>.json` (`--results <file>` to pick one). Four lessons of 26 Oct 2026 are automatic
   items, each pinned by a check test: b10 every title names its own site, never a sibling's; e9
   Clarity loads only where a visitor fills a form or buys; h6 a cached build is keyed on every
   tracked file except the workflows; j10 junk lead domains are blocked through the site setting
   `BLOCKED_LEAD_DOMAINS`, never written into public code.
2. **The grid repos** are `src/shared/boss/searchReadiness/sites.json`: category (side business,
   client, own business), kind, and a coverage entry for every site. Hyperlocal sites list the towns
   inside their radius, the neighborhoods, the local anchors and the service × town pages; the
   generator's guide sites read their own city list. heygetonmylevel.com is excluded (no payment
   mechanism yet); nothing West Peek, nothing of Shirley Brown's senior housing work.
3. **Weekly, Monday 06:00** (`com.seq.boss-sites-audit`, `npm run sites:audit -- --morning`; by hand
   `npm run sites:audit`). Spends nothing: plain GETs, Search Console read-only, free PageSpeed, `gh` reads.
   Results go into the Monday morning email as "The grid repos" section, told once.
4. **Every failure is a fix brief** in `~/.boss-os/search-readiness/fix-queue.json`
   (`npm run sites:fix-queue`), which Danielle's repair run reads (prompt section 1b) and fixes like an
   Ahrefs finding. The two client sites are fixed too. The Spry Labs download page is PROTECTED: fixed
   only on its own, single-page, Gumroad buy link checked before and after, never cosmetic or bulk.
5. **The run measures with main's definition, never a stale checkout's** (26 Oct 2026). The audit
   runs from her own checkout, which nothing updates: it sat at #147 while main held the corrected
   `aplayermode.com` → `sprylabs-hpc-site` mapping, so the run measured the apex against the Expo app
   repo and wrote five fix briefs for files that were there all along. The runner reads
   `checklist.json` and `sites.json` from `origin/<default>` every run (`definitionChoice`, pinned by
   `tests/searchReadiness.test.ts`), says so when the checkout has drifted, and writes the definition
   it used onto the results and the fix queue. A stale definition does not fail; it invents work.
   `npm run sites:audit` also fast-forwards that checkout first (`scripts/ops/self-update-checkout.sh`),
   because the code is loaded before any definition can be read: default branch only, clean tree only,
   strict fast-forward only, every refusal exits 0 so the audit still runs. Never a reset, rebase,
   stash, commit or branch switch in her checkout.
6. **Authority and entity, phase K (31 Oct 2026, the authority audit).** k1 an `entity.json` holds the
   site (or the `entity_file` sites.json names), k2 no `sameAs` on the site's own hosts, k3 at least one
   external profile resolves (a login-walled platform alone is unverifiable, never a pass), k4 the
   `entity_parent` in sites.json holds (`spry-labs`: parentOrganization reaches
   billionairehighperformancecoach.com/spry-labs, directly or through a grid parent; `client` and `own`:
   never Spry Labs, so the friends' businesses and Porch & Party never carry it; the three authority-network
   publications are `own` too, because the owner withdrew their parent-company claim on 11 Oct 2026 and
   `authority-backlink-network` fails its own build if it reappears, so a side business may hold `own` when
   `entity_parent_why` on its row says why), k5 a `ymyl: true` site's
   content pages name a reviewer listed with written consent in the repo's `reviewers.json`, k6 the weekly
   entity-backlink-watch is green and under eight days old. a1-a6 were taken, hence K. k5 with no
   reviewer is a **named stop** (`OWNER_REVIEWER_NEEDED`, disposition `named_stop`): said every week,
   never worked, because nobody invents a person. Pinned by `tests/searchReadiness.test.ts`.

## Brains: one document per business, read first

Owner, 31 Oct 2026 ("time to work"). One definition, `src/shared/boss/brains/brain.mjs`; stored in D1
(`brains`, `brain_revisions`, migration 0323); pinned by `tests/brains.test.ts` (which reads this
section), `tests/boss/brains.test.ts` and `npm run validate:brains`:
1. **Nine brains.** Seven businesses, in scoreboard order (`brokerage` — Spry Ventures (spry.vc), the
   brokerage, priority 1 — `west-peek-ventures` — the fund ONLY — `west-peek` — the community: Rooms,
   TLC, westpeek.live, the join site — `porch-and-party`, `time-2-read` — a Spry Labs company — `spry` —
   Spry Labs, the umbrella for every side business, holding the Industry Guides — `friends`), `personal`
   (Boss OS itself, Spirit, gates, coaching, her schedule) and `team` (who's who across her AI teams, a
   plain document). Restructured by the owner on 1 Nov 2026 (migration 0326): the fund and the community
   are separate brains that link to each other and never repeat each other's facts; `industry-guides` is
   RETIRED into `spry` (`RETIRED_BRAINS`): its row and revisions stay as history, GET/PUT on the slug
   resolve to `spry`, and nothing lists, scores or reads it.
   Every brain but `team` has the eight sections in order: Company, Numbers, Priorities, People, Voice,
   Settled decisions, Open questions, Who does what. Gaps are written `[MISSING]`; Settled decisions
   lines read `- YYYY-MM-DD — decision — why`; Numbers is `| Metric | Definition | Source | Value | Last updated |`.
2. **The repo is public: seeds are skeletons only.** No real brain content in any git file, fixture,
   commit or PR. `validate:brains` fails the build if a seed is anything but `seedFor(slug, title)`.
3. **Private spans** (LP names, fund terms, deal terms, investor names) are wrapped
   `<!-- confidential -->…<!-- /confidential -->`. They reach her Claude seat (`bk_claude_code`) only.
   Cut, fail closed, at all three exits: `routeCompletion` (every cloud route, before a request exists),
   `dispatchRunForTask` (the row a non-Claude seat claims) and `/backends/claim` (a run handed down to
   another seat). An unclosed mark cuts everything after it.
4. **Every employee reads first** (`buildPromptParts`): the brain(s) of the business(es) they serve
   (`EMPLOYEE_BRAINS`; Camille P&P, Monique the brokerage, the fund, the community (her TLC/Rooms-related
   work), time-2-read and Spry Labs — she runs their outreach; Simone, Danielle and Zora read every business summarised, Simone also
   `personal`) and a short who's-who from `team`.
5. **Edits** on the Brains screen (one section at a time, history kept) or by email to Simone
   ("P&P brain: add settled decision …", "time-2-read priorities: 1 … 2 …", "spry brain: set Sales to
   3"); every change is a revision, an email one noted "by email".
6. **The scoreboard never invents a number**: "not tracked yet" when a Value is `[MISSING]`;
   `personal` and `team` are not on it. On the 1st, Simone's morning email carries one grid; on Mondays
   one plain line from the weekly check (rule 8, never red).
7. **Her local copy** is `npm run brains:pull` → `~/Brains/<slug>.md` (private spans kept; passcode
   injected as `BOSS_PASSCODE` by the caller), hourly at :23 from launchd `com.seq.boss-brains-pull`,
   installed by `scripts/ops/install-agent-launchd.sh`.
8. **The Monday cohesion check** (plan step 10): launchd `com.seq.boss-cohesion`, Monday 06:05 Central
   (before the 06:40 email), runs `npm run brains:cohesion` (`scripts/brains/cohesion-check.mjs`). It
   moves memory strays (any `*.md` but `MEMORY.md` under `~/.claude/projects/*/memory/`) into
   `~/.claude/memory-archive/<date>/`, never deletes; flags a home `MEMORY.md` grown past an index,
   active repos under `~/GitHub` without a `## Company brain` section (client repos never named,
   `isClientRepo`), skills carrying a phrase that contradicts `~/.claude/CLAUDE.md`
   (`BAD_SKILL_PHRASES`); restarts a `~/Brains` copy older than 2 hours. It posts to
   `POST /api/boss/brains/cohesion/mac`; `GET /cohesion` folds it with the stale brains into ONE line
   (`cohesionCheckLine`): "Cohesion: all clear", or what it fixed and what it could not. **Rule 0:** no
   Mac record this week reads "the Mac's weekly check did not run this week", never "all clear".
   Pinned by `tests/cohesionCheck.test.ts`.

## Time-2-Read groups & institutions: Monique's duty

Owner, 31 Oct 2026 ("Monique should do inst sales and i want to find like home school pods and
institutions too"). Rules in `src/shared/boss/t2rGroups/rules.mjs`; the Worker half is
`src/worker/boss/outreach/groups.ts` (desk `/api/boss/t2r-groups`), the Mac job
`scripts/ops/t2r-groups.mjs` (`duty_t2r_groups`, weekdays 08:15 Central). Pinned by
`tests/t2rGroups.test.ts` (which reads this section) and `tests/boss/t2rGroups.test.ts`:
1. **Tiers are data** (`t2r_group_tiers`, migration 0324): 1 homeschool pods, co-ops, microschools;
   2 libraries, after-school programs, literacy nonprofits, tutoring centers; 3 schools and districts,
   **off until Phase 8** (teacher dashboard, rosters, privacy agreements, reading-gain proof). An off
   tier is refused at import, never queued, and refused again at send time (`groupSendGate`).
2. **Public sources only.** Every group keeps the `source_url` its address was published on, and the
   Mac job reads that page before importing; a published role or group mailbox only, never a guess.
3. **NeverBounce "valid" before the first email**; anything else is skipped for good. A bounced
   address is never written to again.
4. **Each group its own 15-day code** (`groupCodeFor`, e.g. MAPLEG15K7Q) through the existing
   governed path to time-2-read's code table (`runCode`, simone-commands.mjs); no group is emailed
   until its code is live. Each code's use is read back from the signups view, per group.
5. **Sent by the outreach engine** as business `time2read_groups` from st@time-2-read.com: at most
   `NEW_GROUPS_PER_WEEKDAY` (10) new groups a weekday, **one follow-up** (two steps, never a third),
   automatic like all Monique outreach. The words carry no price, no call ask, no "no screens" or
   anti-AI framing, no medical claim and no other language (`outboundProblems`, checked on every build).
6. **Replies:** interest or a question is a card for her; "not now", an unsubscribe, an auto-reply
   or a bounce is filed. A question about price or paying is always a card, with a suggested price
   (`suggestedPrice`). **Monique never quotes**: approved words go to her drafts.
7. **What she reads:** Mondays one line in Simone's email, "Time-2-Read groups: N emailed, N replied,
   N codes in use" (`weeklyLine`); the time-2-read scoreboard's "Institutional pipeline" and "Outreach
   replies" are written by the hourly tick (`feedScoreboard`), a revision only when a number moved.

## The Email Map: every automated email, every business

Owner, 31 Oct 2026: "one Email Map page inside Boss OS, all businesses". Pinned by
`tests/outboundEmailMap.test.ts` ("the Email Map page's manifest covers every sender"):
1. **One list.** `src/shared/boss/emailMap/manifest.json` holds every automated email anything of hers
   sends, grouped by business (Brokerage, West Peek Ventures, Porch & Party, Time-2-Read, Industry
   Guides / Spry, Personal, Friends' businesses & clients): what it is, sender, owner, from, to, when,
   where it runs, trigger, how to pause, code paths per repo and launchd labels. The page
   (☰ More → Email Map, `/?tab=emails`, `src/client/boss/pages/EmailMap.tsx`) renders it and nothing else.
2. **A new sender goes on it in the same PR.** The test fails on any file in this repo that sends (a
   transport, or a call to `sendAsEmployee`, `postEmployeeMail`, `sendAs`, `sendOne`, `createInvite`,
   an outreach send…: `SENDING_PATTERNS` in `scripts/ops/lib/email-map.mjs`) with no row citing it, and
   on a cited path that is gone. `npm run email-map:check` reads the other repos on their default branch
   and the Mac's launchd jobs the same way (exit 2 when nothing could be checked).
3. **Public repo.** Business sending addresses only (`BUSINESS_DOMAINS`); she is "You"; never a
   customer, LP, prospect or investor name.
4. `docs/OUTBOUND_EMAIL_MAP.md` stays the detailed audit of the Boss OS and side-business paths that
   Team → Duties reads; every Id there is a manifest row with the same owner.
