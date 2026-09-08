Watch KDP Case #51496198 for a reply and act on it.

**This is Simone's duty `duty_kdp_publication` in Boss OS.** She owns it; you are how it executes,
because reading her mailbox needs credentials the Claude Code runner strips from an agent's
environment. Her charter applies to what you write: draft the recommendation, never the decision.

**The canonical copy of this file is `scripts/ops/kdp-watch-prompt.md` in the boss-os repo.**
`~/bin/kdp-watch-prompt.md` is a symlink to it, installed by `scripts/ops/install-agent-launchd.sh`.
Edit the repo copy; a divergent second copy is the exact defect this system keeps producing.

## Background you need

Sequoia Taylor's KDP account (ID `A3LMPMTW4INAPT`) cannot publish. Clicking Publish returns
"Please fix the highlighted error(s) to continue" with no field highlighted. The real cause was
found on 2026-09-02: the page renders a hidden alert, present in the DOM but never shown, reading
"Account Information Incomplete — You must complete your account information to publish items."
It is an account-level block, not a title-level one.

Every account section reads complete: identity (Amazon confirmed verification by email on
2026-08-09), Business Type Individual, bank account on file, tax profile Complete at 0%
withholding. Three titles published from this same account on 1–2 September 2026
(B0HHFK6W76, B0HHHR33NQ, B0HHHLKDD4), so it worked days ago.

Seven titles are blocked, all Draft:
A12Z8RECXCYT3S, A746KSQA6VXQ8, A2C99P6JESFOP0, A14601U7XU2FCM, A3O8BGWQ63OSF0,
A1EYXUFGFV7CN6, AZUTRW0LN8GDM

A reply was sent to support on 2026-09-02 at 17:33 UTC asking them to check server-side which
account attribute is flagged, since the customer-facing pages give no way to identify it.

**Tested and disproven, 7 September 2026:** the 10-unpublished-title cap is NOT the cause. She
drained the queue — the first three In-review titles went Live, freeing slots — and the refusal did
not change. Do not raise the cap as a theory and do not suggest publishing more titles to free
slots. The account-level alert above is the live explanation and support is the only route to it.

## What to do

1. Load the Gmail tools you need with ToolSearch (search_threads, get_thread, send_message).
2. Read thread `1a05d7334054d73b` (subject "KDP Case #51496198 Correspondence") — the case thread.
3. **Then search more widely**, because Amazon does not always reply on the thread you wrote to:
   `newer_than:30d (kdp OR "Kindle Direct" OR "Case #51496198" OR from:kdp-support@amazon.com OR
   from:amazon.com)`. Read anything that looks like a response about this account or these titles,
   including messages that arrive as a NEW case number rather than a reply. A support system that
   answers by opening a fresh ticket is common, and watching one thread would miss it entirely.
4. Determine whether any NEW message from Amazon has arrived AFTER 2026-09-02T17:33Z, on any thread.
   Treat a new case number about the same block as a reply to this case, and say so.

### If no new reply

**A silent case is a case that dies.** Amazon support closes threads that go quiet, and the owner's
instruction is explicit: keep the replies coming until this resolves. So silence is not a reason to
do nothing — but it is also not a licence to nag, because a thread that receives a message every
other day gets deprioritised or auto-closed as spam.

Read the whole thread and work out **how many days since the last message from support**, and **how
many unanswered nudges she has already sent** (a nudge is a message from her address that follows
another message from her address with no support reply between them).

| Days since support last wrote | Unanswered nudges so far | What to do |
|---|---|---|
| Fewer than 4 | any | Nothing. Say so in one line and stop. |
| 4–9 | 0 or 1 | Send ONE short nudge. |
| 10 or more | 2 | Send one nudge that explicitly asks for escalation to a team that can query account state. |
| any | 3 or more | **Send nothing.** Email her instead: the case is not being worked and needs a different route — phone support, or a new case referencing this one. |

**A nudge is three sentences at most.** Restate the one unanswered question — which account attribute
is flagged server-side for `A3LMPMTW4INAPT`, given all four account sections display complete and
three titles published on 1–2 September — say how long it has been, and ask for an update. Never
re-send the history, never express frustration, never threaten anything. A courteous short message
gets read; a long angry one gets triaged to the bottom.

**Then stop.** One message per run, maximum, whatever the table says.

### If a new reply HAS arrived

Read it carefully and classify it:

- **They name a specific field or action she must take.** Report it clearly. If it is something
  only she can do — upload an ID, confirm a bank detail, answer a tax question — DO NOT attempt
  it. Email her the instruction (see Notify below) and stop.
- **They say the block is cleared.** Do not take their word for it — a support agent saying a flag
  is removed and the Publish button actually working are different claims, and this case has already
  produced one confident answer that changed nothing. **Go and check.** See "Verifying a clearance"
  below.
- **Another generic template that does not address the account-level alert.** Reply once, briefly,
  restating the specific unanswered question: which account attribute is flagged server-side for
  A3LMPMTW4INAPT, given that all four account sections display as complete and three titles
  published on 1–2 September. Ask for escalation to a team that can query account state. Be
  courteous and short. Do not re-send the full history.

## Hard rules

- **Never put bank details, tax identifiers, government ID numbers, passwords or full account
  numbers in an email.** Reference the account by its KDP Account ID only. If support asks for
  any of those, do NOT supply them — email Sequoia and let her respond herself.
- **At most ONE reply per inbound support message.** Before sending, check the thread: if a reply
  from her address already follows the latest support message, send nothing.
- **Do not open a new case.** Reply in the existing thread only.
- **Publish AT MOST ONE title per run, and only after support says the block is cleared.** Never all
  seven. One title proves whether the account-level flag is actually gone, and if something is still
  wrong it is wrong on one book rather than on her whole shelf. She decides about the rest.
- If anything is ambiguous, do not guess — email her and stop.

## Verifying a clearance

Only when a support reply says the block is lifted.

1. Load the browser tools with ToolSearch, then call `tabs_context_mcp` FIRST.
2. If the browser is not reachable — no extension, no Chrome running — **do not treat that as a
   failure of the clearance.** This job runs unattended at 09:23 and her laptop may be shut. Email
   her that support says it is cleared and it needs a browser check, end with `needs-her`, and stop.
3. If the browser IS reachable: open KDP, take ONE Draft title — start with `A2C99P6JESFOP0`, which
   is the known-valid book that produced the empty-payload refusal — and walk it to Publish.
4. **Before clicking Publish, check the Content tab.** The AI questionnaire must read *Text: "Entire
   work, with extensive editing" / Images: "None" / Translations: "None"* with the accuracy box
   ticked, and it must be committed with **Save and Continue**, never Save as Draft — Save as Draft
   silently drops it and the Content tab's "Complete" badge lies about this.
5. Click Publish once. If it fails, **capture the real error**: `read_network_requests` returns no
   bodies, so install a fetch/XHR interceptor before clicking and read the `save-and-publish`
   payload. The server names the actual fields there even when the page highlights nothing.
6. Report what happened, either way, and email her.

**Do not enter any credential, payment detail or government ID in the browser.** If a page asks for
one, stop and email her.

## Notify

Whenever there is something she needs to know — a new reply of any kind, an action required of
her, or the block clearing — send her an email at `seq.taylor@gmail.com` with subject
`KDP case update` and a short plain-text summary: what support said, what you did, and what she
needs to do. Keep it under 200 words. If there is no new reply, send nothing.

## Reporting back to Boss OS — do this on EVERY run, before your final line

Everything above stays on this machine. This step is the only thing that leaves it, and what it
carries is a determination rather than any of the mail you read.

Write `~/.boss-os/kdp/determination.json`, creating the directory if it does not exist:

```json
{
  "sentinel": "no-reply",
  "determination": "One or two sentences, in your own words, about what you found and decided.",
  "next_action": "What happens next and who does it. One sentence.",
  "needs_owner": false,
  "days_since_support": 1,
  "nudges_unanswered": 0,
  "threads_seen": 4,
  "published_title_ref": null
}
```

**NEVER QUOTE THE MAIL, AND NEVER INCLUDE AN ADDRESS.** Describe what support said; do not reproduce
it. No sender names, no email addresses, no subject lines, no account numbers, no case content
pasted through. Boss OS **refuses** any determination containing an `@` — the whole batch is
rejected, and a rejected report reads on the screen as a missing report. Write it clean the first
time.

`published_title_ref` is null unless you actually published a title this run, in which case it is
that one title's reference and nothing else.

Then say, in your log output, that you wrote it. `scripts/ops/kdp-report.mjs` posts the file to
Boss OS immediately after you exit; it is what makes Simone's duty show a determination on the
Publishing screen instead of only in a log file nobody opens.

## Required final line

Your LAST line must be exactly one of:

    KDP-WATCH-COMPLETE: no-reply
    KDP-WATCH-COMPLETE: replied
    KDP-WATCH-COMPLETE: needs-her
    KDP-WATCH-COMPLETE: cleared
    KDP-WATCH-COMPLETE: published
    KDP-WATCH-COMPLETE: nudged
    KDP-WATCH-COMPLETE: stalled

`published` means one title actually went through. `nudged` means the case was chased. `stalled`
means three or more nudges have gone unanswered and it now needs a different route.

The wrapper checks for this sentinel; without it the run is recorded as incomplete, because a run
that died halfway and a run with nothing to report are otherwise indistinguishable.
