Read yesterday's replies to West Peek LP outreach, categorise them, and hand the opt-outs to Twin.

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
2. Search `newer_than:2d in:anywhere to:sequoia@westpeek.ventures` and read what came back to that
   address in the last day.
3. Put each reply in exactly ONE of these six buckets:

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

**If nothing came in, write no file and say so in your log.** A day with no replies produces no
digest and no Inbox item. A daily notification that fires regardless is one she stops opening, and
then the day it mattered looks like the forty before it.

## Required final line

Your LAST line must be exactly one of:

    LP-REPLIES-COMPLETE: filed
    LP-REPLIES-COMPLETE: nothing
    LP-REPLIES-COMPLETE: blocked

`blocked` means you could not read the mailbox at all — say why in one line above it. The wrapper
checks for this sentinel; without it the run is recorded as incomplete, because a run that died
halfway and a run with nothing to report are otherwise indistinguishable.
