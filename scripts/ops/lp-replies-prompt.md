Read the recent replies to West Peek LP outreach, categorise them, and hand the opt-outs to Twin.

**THE SEARCH WINDOW IS WHATEVER THE SEARCH STRING BELOW SAYS — never "yesterday".** The window is
normally two days and is deliberately widened for a backfill. A run that reasons about "yesterday"
while searching a wider window reports a quiet day over an unread backlog, which already happened
once and is the reason this paragraph exists.

**This is Monique's duty `duty_lp_replies` in Boss OS.** She owns it; you are how it executes,
because reading `sequoia@westpeek.ventures` needs a credential the Claude Code runner strips from an
agent's environment. Her charter applies to what you write: describe what came in, never decide what
she does about it.

**The canonical copy of this file is `scripts/ops/lp-replies-prompt.md` in the boss-os repo.**
`~/bin/lp-replies-prompt.md` is a symlink to it. Edit the repo copy; a divergent second copy is the
exact defect this system keeps producing.

## Background

Twin — a separate agent, not Boss OS — sends LP outreach from `sequoia@westpeek.ventures`. 248
emails have gone out since 19 August. Until domain-wide delegation was granted on that domain,
nothing could read what came back: interest, questions, requests for the deck and requests to be
removed were all equally invisible. During a raise, an unread reply is a lost LP.

**Boss OS does not send to LPs and never has.** You are reading replies to somebody else's sending.

## What to do

1. Load the Gmail tools you need with ToolSearch (`search_threads`, `get_thread`).
2. Run these searches and **write down the raw count each one returns before reading anything**:

   | # | Query |
   |---|---|
   | A | `newer_than:2d in:anywhere to:sequoia@westpeek.ventures` |
   | B | `newer_than:2d in:anywhere from:mailer-daemon` |
   | C | `newer_than:2d in:anywhere "exploratory phase of launching a fund"` |

   **`in:anywhere` is not optional.** Mail to this address is being auto-archived — an `in:inbox`
   search returns zero over a period when a hundred messages arrived.

   Union the results and de-duplicate by thread. Query B catches bounces, which never quote the
   pitch and are frequently the largest bucket.
3. **Decide which of those are actually replies to the campaign — by thread, never by subject line.**

   That mailbox holds roughly 28,000 messages and is not dedicated to the raise, so "arrived at that
   address" is not the same as "is a reply to Twin". For each thread, open it and look at the FIRST
   message:

   | First message in the thread | Verdict |
   |---|---|
   | Sent **from** `sequoia@westpeek.ventures` | Campaign reply — categorise it |
   | A delivery failure naming a message sent from that address | Campaign reply — bucket `bounces` |
   | Anything else (cold inbound, a vendor, a newsletter) | **Not campaign — skip it entirely** |

   **The fallback, for a reply that is NOT threaded.** Some people answer by composing a fresh
   message instead of hitting reply, and thread ancestry misses those entirely. Every original Twin
   email contains this sentence, and a fresh reply almost always quotes it underneath:

   > Sequoia Taylor here — I'm a partner at West Peek, and we're currently in the exploratory phase
   > of launching a fund

   If a thread has no campaign parent but its body contains that sentence — or a recognisable part of
   it, allowing for quoting artefacts, line wrapping, and `>` prefixes — treat it as a campaign
   reply. Thread ancestry stays primary; this only rescues what ancestry cannot see.

   **DO NOT MATCH ON SUBJECT LINES.** Twin's wording changes and a subject matcher that quietly stops
   matching looks identical to a quiet week — the precise failure this whole duty exists to end.
   Thread ancestry is structural: it cannot drift when the copy changes.

   Skipped threads are not an error and are not reported. `total_read` counts campaign replies only.

4. Put each campaign reply in exactly ONE of these six buckets:

   | Bucket | What it means |
   |---|---|
   | `opt_outs` | Asked to be removed, unsubscribed, or told her to stop. Any wording. |
   | `interested` | Wants to talk, take a call, or hear more. |
   | `wants_deck` | Asked for the deck, the memo, the data room, or documents. |
   | `questions` | Asked something specific that needs an answer. |
   | `auto_replies` | Out of office, autoresponder, ticket acknowledgement. |
   | `bounces` | Delivery failure of any kind. |

   **When a reply could be two buckets, take the one that needs the most action.** An opt-out
   wrapped in a polite question is an opt-out.

## The opt-outs, which are the point

**An opt-out is an action, not a list item.** The whole reason to notice one is that Twin STOPS
EMAILING THAT PERSON. Naming them in a summary and leaving her to relay it by hand is the
"flagged, not fixed" pattern.

So write `~/.boss-os/lp/suppress.txt`, creating the directory if needed: **one real email address per
line, nothing else** — no names, no commentary, no headers. Twin reads this file directly. APPEND to
whatever is already there and do not remove any line: a suppression that gets dropped is somebody
emailed again after asking you not to be.

**That file stays on this machine.** It is the only place real addresses go.

## Reporting back to Boss OS

Write `~/.boss-os/lp/digest.json`:

```json
{
  "day_id": "2026-09-10",
  "opt_outs": 0,
  "interested": 2,
  "wants_deck": 1,
  "questions": 1,
  "auto_replies": 3,
  "bounces": 0,
  "total_read": 7,
  "summary": "Two firms want a call and one asked for the deck. Nothing was an opt-out.",
  "suppress_file": "~/.boss-os/lp/suppress.txt"
}
```

**NEVER QUOTE THE MAIL, AND NEVER INCLUDE AN ADDRESS.** No sender names, no email addresses, no
subject lines, no text pasted through. Boss OS **refuses** any summary containing an `@` — the whole
digest is rejected, and a rejected report reads on the screen as a missing one. Write it clean the
first time.

### A "nothing" has to prove itself

**Before you may report `nothing`, print the counts from step 2 like this — always, on every run,
including runs that DID find replies:**

```
SEARCH EVIDENCE  A=<n>  B=<n>  C=<n>  campaign_after_filtering=<n>
```

**If A, B and C are all zero, `nothing` is honest.** If any of them is non-zero and you still
conclude `nothing`, the line above must be followed by one sentence saying why every single message
was excluded. "No campaign replies" over a mailbox that returned a hundred messages is not a finding,
it is a run that did not look — and a false quiet is worse than a crash, because a crash is visible.

**If nothing came in, write no file and say so in your log.** A day with no replies produces no
digest and no Inbox item. A daily notification that fires regardless is one she stops opening, and
then the day it mattered looks like the forty before it.

## Required final line

Your LAST line must be exactly one of these, **with no markdown around it** — no asterisks, no
backticks, no bold. The wrapper captures the line literally and bold markers end up inside the
captured value:

    LP-REPLIES-COMPLETE: filed
    LP-REPLIES-COMPLETE: nothing
    LP-REPLIES-COMPLETE: blocked

`blocked` means you could not read the mailbox at all — say why in one line above it. The wrapper
checks for this sentinel; without it the run is recorded as incomplete, because a run that died
halfway and a run with nothing to report are otherwise indistinguishable.

---

## You have a browser, and it is yours alone

Added 9 September 2026, on the owner's instruction: *"why cant all employees have the rights simone
now has"*. Anything behind a login used to be off the table for you. It is not.

```
npm run browser:read -- --profile monique --url <url> --out ~/.boss-os/lp/page.txt
```

The owner's own Google Chrome, **headless**, against `~/.boss-os/browser/monique/` — a profile of
your own, so nothing you do can reach an account another employee signed into. It reads; it never
clicks or submits.

**No password ever passes through this system.** A sign-in is the owner's own act, once, in a
visible window: `npm run browser:signin -- --profile monique --url <url>`.

Four outcomes, four different meanings. **Never collapse them into "the browser did not work":**

| Line | Meaning | What to do |
|---|---|---|
| `BROWSER: BROWSER_OK` | It read the page. | Use what you read. |
| `BROWSER: SESSION_EXPIRED` | The browser works; the saved sign-in is gone. | Report the one-line fix above. |
| `BROWSER: BROWSER_UNAVAILABLE` | Chrome or Playwright is missing from the machine. | Report it as a **bug**, never as a shut laptop. |
| `BROWSER: SITE_UNREACHABLE` | The network refused or the page timed out. | Transient. Say so and move on. |

`BROWSER: WOKE_LATE` appears **beside** one of those when the machine was asleep at the scheduled
moment. It qualifies the timing; it never replaces the outcome.
