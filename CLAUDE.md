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

## Emails to her

Owner, 23 Oct 2026 (inbox review: nine Boss OS emails in two days, none useful). Enforced in code and
pinned by `tests/plainEmail.test.ts` ("the rules in CLAUDE.md"), which reads this section, and by
`npm run validate:email-plain`:
1. **One morning email.** Simone's (`scripts/ops/your-day.mjs`): Decide → New deals since yesterday +
   Monique found → Camille's briefing (≤5 lines; it waits for the report, 07:45 Central at the latest)
   → Done for you (≤3) → Catch up with → Porch & Party: To do for Valerie → sign-off → the 8Raise line.
   Every other producer writes a section file (`src/shared/boss/mail/morning.mjs`) instead of an
   email. Another email only when it cannot wait: a decision due today, money at risk, a deal moving now.
2. **Decide first, one-tap buttons, plain words.** `layoutEmail` / `layoutProblem`
   (`src/shared/boss/mail/plain.mjs`). Never Gmail ids, commands, /api paths, PR numbers, UTC times,
   #tags, jargon, link dumps or "I could not read".
3. **Problem emails:** What happened → What we did → Status, sent after the fix is running; a stopped
   task is re-checked first; chores (vault, tokens, DNS, unreadable sources) are fix jobs, never her mail.
4. **The gate holds, never sends, a failing email:** `mailGate` in `postEmployeeMail`
   (`scripts/ops/notify.mjs`) and `plainReply` on the Worker. A new sender passes through them or it
   does not send.
