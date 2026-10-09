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
4. **No live send from a domain without SPF, Google DKIM and DMARC** (9 Oct 2026: Gmail blocked
   aplayermode.com and approvalprep.com test sends, `550 5.7.26` DMARC — empty DKIM key under
   `p=reject`). `mailAuthRefusal` (`src/worker/boss/outreach/mailauth.ts`) reads the sender domain's
   TXT records over DNS-over-HTTPS before every live send; a gap or a failed lookup refuses it. Test
   sends to the test inbox still go, so a fixed domain can be proven first.
