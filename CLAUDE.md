# Boss OS — rules for anyone working in this repo

Boss OS's own authority is [`docs/boss/`](docs/boss/) and [`STATUS.md`](STATUS.md). The root
documents (`AGENTS.md` and friends) describe the inherited West Peek chassis; read their banner.

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
6. **The email carries the best few, never hundreds:** at most `MAX_EMAIL_MATCHES` (5) new matches —
   a pair first seen in the last 36 hours (`matches-first-seen.json` on her Mac) or one on an order
   that arrived since yesterday — one per company, freshest then closest price, none stale. One on a
   new order is in Decide (both sides, addresses, sizes, prices, fill, gap, age, a ready note to
   each); the rest are lines under Monique found; then one count line, "See all N matches →", to the
   Matches screen (Deals → Matches), which lists every current one. Pinned by
   `tests/morningSizeAndMatches.test.ts`.
7. **Outward words call her buyers "LPs"** (owner, 24 Oct 2026): match notes, prospect emails, LP
   replies and deal drafts never say "buyer"; a prospect email never names Anthropic (it alludes:
   `NEVER_NAMED`, `src/shared/boss/lp/plan.mjs`). Pinned by `tests/outboundWords.test.ts`.

## Emails to her

Owner, 23 Oct 2026 (inbox review: nine Boss OS emails in two days, none useful). Enforced in code and
pinned by `tests/plainEmail.test.ts` ("the rules in CLAUDE.md"), which reads this section, and by
`npm run validate:email-plain`:
1. **One morning email.** Simone's (`scripts/ops/your-day.mjs`): Decide → New deals since yesterday +
   Monique found (+ Prospect emails) → ✨ Spirit (the approved sample: week, moon, sky, practice, a
   new non-body gratitude sentence every day, the month; the rest under "Show more ▾") → Camille's briefing (five lines and "Read the full briefing →" to its screen — the whole briefing is never
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
   line (What happened / What we did / Status), never a decision — a task that failed is a fix job
   and a done line the next morning (`failedTaskLines`). Pinned by
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
5. **The gate holds, never sends, a failing email:** `mailGate` in `postEmployeeMail`
   (`scripts/ops/notify.mjs`) and `plainReply` on the Worker. A new sender passes through them or it
   does not send.
6. **Never risk Gmail's clip** (owner, 24 Oct 2026: Gmail hides an email over ~102KB behind "View entire
   message"). The HTML must fit `EMAIL_HTML_BUDGET` (80KB, bytes): styles live on the wrapper, not on
   every paragraph; long lists stop with "See all N →" on their screen (`MAX_DEAL_ROWS`, `MAX_FOUND_LINES`,
   `MAX_PROSPECT_SENDS`); past the budget `CUT_ORDER` cuts the prospect emails' words, then Monique's
   lines to three, then the deal rows to five. **Decisions are never cut.** Pinned by
   `tests/morningSizeAndMatches.test.ts` (a heavy-day fixture that fails over 80KB).

## Search Readiness: the checklist enforces itself on the grid repos

Owner, 25 Oct 2026. Her pinned Search Readiness Checklist is data, run every week on every grid repo
site. Pinned by `tests/searchReadiness.test.ts`, which reads this section:
1. **One definition.** `src/shared/boss/searchReadiness/checklist.json` holds every item (the page's
   71 plus j9, hyperlocal coverage) as an automatic check or a manual item with its reason.
   `npm run sites:page -- --out <path>` renders the pinned page from it; edit the JSON, never the page.
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
