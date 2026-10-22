# How to give Boss OS work by email

_22 October 2026. A test (`tests/emailHowTo.test.ts`) reads this page: the address, the example
emails and who they reach, the reply words and the secret line are checked against the code, so the
page cannot drift from what the mailbox does._

## The address

**boss@sequoiataylor.com**, from one of your own addresses: seq.taylor@gmail.com,
sequoiataylor@icloud.com or staylor@spry.vc. Mail from anyone else is recorded and refused.

You do not need to name anybody. Simone (Chief of Staff) reads it, splits it into its asks, and gives
each ask to the employee who can do it. If you want a particular person, write to them directly:
simone@, danielle@, camille@, monique@, zora@, toni@, imani@ or kendra@sequoiataylor.com, or put their
name with a # in front (#danielle). Both are optional shortcuts.

## Three example emails

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

## What happens after you send

1. **Within a minute, a reply from Boss OS** with one line per job: who has it.
2. **Each job reports back by email** when it is done, or when it needs a decision only you can make.
3. **Every job you email is tailed.** A separate check on your Mac follows each one to the end,
   fixes anything that got stuck, and Simone emails you a short report of what happened.

## How to approve, change or stop

Reply on the same email thread. Short is fine.

| You want to | Reply |
|---|---|
| Go ahead | `approved` (or yes, go, ok) |
| Change it | `changes: ` then what to change |
| Stop it | `stop` (or no, hold) |
| Retry something that stopped | `try again` |
| Drop something that stopped | `drop it` |

Any other reply is read as your answer and the work continues with it. A reply always goes back to
the job it answers; it never starts a new pile.

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
