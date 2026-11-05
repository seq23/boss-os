# Reminders and deal views

Migration 0351 is additive. `person_reminders` counts one delivered morning per address and day,
including thin reminders. `/morning/:day/sent` records delivery; reads and retries do not increment.
A newer owner decision, reply send or nudge action starts a new streak. Three unanswered deliveries
insert the address into `quiet_people`. Existing Today, LP plans and morning producer filters read
that table; the nudge sender checks it directly as well. Quieting never deletes the LP record.

Matches offers “Dismiss all older than 30 days”, followed by an in-page count and Yes / Keep.
The confirmed endpoint recomputes ages and writes `capital_dismissed` through `dismissMatch`.
Fresh pairs remain; a new order signature brings a pair back through the existing rules.

`npm run capital:rainmaker-repliers` is a local, manually invoked importer, run through the existing
vault tooling with `BOSS_PASSCODE` and `GSC_SERVICE_ACCOUNT_JSON`. It uses the existing `LP_MAILBOX`
and `RRLIST_ADDRESS` defaults, searching sent mail addressed to the RR list. `--query '<Gmail query>'`
overrides the selector; `in:sent` is always enforced. Only messages explicitly referencing an RR
send's Message-ID count as replies. Metadata is limited to From, Message-ID, In-Reply-To and
References. No body is requested, nothing is sent, and only counts or named stops are logged.
The authenticated importer endpoint upserts `rainmaker_addresses`; `activeLists` adds these addresses
to the same-firm entries consumed by `pairAllowed` on the Mac and Worker. No private seed data is
committed. Mailbox execution and live D1 import remain unproven until an authorized runtime run.

Orders over 30 days are stale; orders over 90 days are hidden from the email, active grid and Matches.
The archive is a separate 90-day-to-twelve-month view. No order is deleted by an age rule.
