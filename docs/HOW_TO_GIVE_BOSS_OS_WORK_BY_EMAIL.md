# How to give Boss OS work by email

_22 October 2026; simone@ and the Tell Simone box added 26 October 2026. A test (`tests/emailHowTo.test.ts`) reads this page: the address, the example
emails and who they reach, the reply words and the secret line are checked against the code, so the
page cannot drift from what the mailbox does._

## The address

**boss@sequoiataylor.com**, from one of your own addresses: seq.taylor@gmail.com,
sequoiataylor@icloud.com or staylor@spry.vc. Mail from anyone else is recorded and refused.

**simone@sequoiataylor.com does exactly the same thing as boss@.** Use whichever you like: it is one
front door.

You do not need to name anybody. Simone (Chief of Staff) reads it, splits it into its asks, and gives
each ask to the employee who can do it. If you want a particular person, write to them directly:
danielle@, camille@, monique@, zora@, toni@, imani@, kendra@ or noelle@sequoiataylor.com, or put their
name with a # in front (#danielle). Both are optional shortcuts.

**Or use the "Tell Simone" box at the top of Today** or the message box on Simone’s page. Send your
request in your own words. Simone’s reply appears where you sent it.

## Example emails

**1 · Build something**

```
To:      boss@sequoiataylor.com
Subject: studio landing page
Body:    Build a one-page studio-style landing for a sample studio in seq23/creator-studios. Your call.
```

Goes to: **Danielle** (builds and repo changes). "Your call" means she does not wait for your yes on
the plan; you still see a preview before anything goes live.

**2 · Ask a question**

```
To:      boss@sequoiataylor.com
Subject: hosting
Body:    What are the three cheapest ways to host a static site with a custom domain?
```

Goes to: **Camille** (research). You get a research page with sources.

**3 · Give someone a standing duty**

```
To:      boss@sequoiataylor.com
Subject: new duty
Body:    every friday, research what changed in the private markets this week and send me a short summary. your call
```

Goes to: **Camille**, as a duty that runs every Friday. Without "your call" you get the draft first
and reply "approved".

One email can carry several jobs. A numbered list with a build, a question and a call to schedule
becomes three jobs on three desks, and the reply says who has which.

## Errands Simone runs for you

Ask Simone to book or request something from a business (a restaurant, a club, a salon, a venue, an
appointment) and **give the business's email address in the same email**. Your email is the
approval: she sends the request as your assistant straight away, signed "Simone, Assistant to Sequoia
Taylor", from simone@ (you are not copied). She watches for their answer and tells you, in your
morning email, What I asked for, What they said, and What you need to do, if anything.

```
To:      simone@sequoiataylor.com
Subject: Dinner Thursday
Body:    Book me a table for two Thursday after 8pm: reservations@thebistro.example
```

She never guesses an address, never pays, and never gives a card: if they ask for a card or a
deposit, she tells you it needs you. Anything with money in it, or fund, LP or trading work, comes
to you as a draft for your Send instead.

## What happens after you send

Simone answers in the original thread when she has a result. If a colleague takes part of the work,
the reply names who has it. A temporary outage keeps the request queued for another attempt.

## How to approve, change or stop

Reply on the same email thread. Short is fine.

| You want to | Reply |
|---|---|
| Go ahead | `approved` (or yes, go, ok) |
| Change it | `changes: ` then what to change |
| Stop it | `stop` (or no, hold) |
| Retry something that stopped | `try again` |
| Drop something that stopped | `drop it` |

Reply to the message that names the job or the decision. If you are continuing an exchange with
Simone, she reads the earlier messages for context.

When something is waiting on you, the email says what is needed in plain English and the exact reply
that clears it.

## How to send a secret (an API key or password)

Put it on its own line in an email to boss@sequoiataylor.com:

```
SECRET VENDOR_API_KEY=the-value
```

The name is the vendor first, in capitals, with underscores (for example `RUNWARE_API_KEY`). Boss OS
stores it encrypted, removes it from the stored email, and your Mac moves it into the vault. It never
appears in a reply, a log or a card. Any job that was waiting for it carries on.
