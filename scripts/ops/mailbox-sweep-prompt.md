Read Sequoia Taylor's mailbox and find the four things she asked for.

**This is Monique's duty `duty_mailbox_sweep` in Boss OS.** She owns it; you are how it executes,
because reading the contents of her mail needs credentials the Claude Code runner strips from an
agent's environment. Her charter applies to what you write: prepare the finding, never the decision.

**The canonical copy of this file is `scripts/ops/mailbox-sweep-prompt.md` in the boss-os repo.**
`~/bin/mailbox-sweep-prompt.md` is a symlink to it, installed by
`scripts/ops/install-agent-launchd.sh`. Edit the repo copy; a divergent second copy is the exact
defect this system keeps producing.

## What she actually asked for

> "i just want one of the employees to peruse the mailbox and find connections and find people that
>  could be buyers that i havent talked to in a while etc.... and find deals im missing between a
>  buyer and seller in my inbox"

Her business is a **brokerage in private late-stage technology secondaries**: she matches people who
want to sell shares in private companies with people who want to buy them. It runs on referrals and
on remembering who mentioned what. **The last clause is the whole point of this job** — someone
asked about a company months ago, someone else later mentioned having access to it, and nothing
connected the two.

## NEVER QUOTE THE MAIL

Everything below is written on the assumption that you read subjects and bodies. You may. What you
produce must contain **no quotation, no subject line, no address, and no company-confidential
sentence lifted from a message**. You describe; you never reproduce.

Boss OS **refuses** any finding containing an `@`, and `mailbox-report.mjs` refuses it first, so a
leak fails loudly rather than shipping. That is a backstop, not the rule. The rule is that the
reasoning you write must stand on **dates, counts and the shape of what happened**, not on words
somebody wrote.

The one exception is `subject_matter`: the **name of the company or asset** two people have in
common. That is the substance of a brokerage finding and it is hers, not a counterparty's — write
the company name plainly.

## Identity: code names, never addresses

`~/.boss-os/contacts/MAP.json` maps a code name to a real address. Read it. It is the *reverse*
direction you need, so build the inverse: address (lowercased) → code name.

- Every person you name in a finding is named by their **code name**.
- **If an address is not in the map, that person is not eligible for a finding.** Do not invent a
  code name, do not use a first name, do not use a domain. Skip them and count how many you skipped.
- The map never leaves this machine. Boss OS learns that ROOK has gone quiet and cannot learn who
  ROOK is, which is her rule honoured by construction.

## What to do

1. Load the Gmail tools you need with ToolSearch (`search_threads`, `get_thread`).
2. Build the address → code name map from `~/.boss-os/contacts/MAP.json`.
3. Search her mail over the last **eighteen months**. That window is deliberate: a referral
   relationship decays over quarters, and a missed deal can be a year apart on either side.
4. Produce findings of the four kinds below. Aim for **quality over volume — at most twenty
   findings, and fewer is better.** A screen with forty items on it is a screen she stops opening.

### 1. `missed_deal` — THE ONE THAT MATTERS MOST

Someone asked about buying a company; someone else, later or earlier, indicated they hold shares in
it or can source them. She never introduced them.

- Both sides must be **in the map**, so both can be named.
- Name the company in `subject_matter`.
- `because` says: which side wanted what, roughly when, and how long the two sit apart. Dates and
  direction, never their words.
- Only raise it if **neither side already appears with the other** on a later thread — if she
  already put them together, this is not a missed deal, it is a deal.
- `confidence`: `high` when both sides are explicit and within the last six months; `medium` when
  one side is inferred or the older side is over a year old; `low` otherwise. **A guess is a `low`,
  not an omission** — but a `low` you cannot justify in `because` is an omission.

### 2. `cooling_buyer`

Someone who has previously talked with her about buying, or who has actually transacted, and has
gone quiet relative to how often they used to write.

- `because` states: how many exchanges, over what period, and how many days since the last one,
  compared to their normal gap. **Their own rhythm, not a fixed threshold** — a twice-a-year
  correspondent is not cooling at four months.
- Do not raise anyone whose entire history is her writing to them. That is a prospect she has not
  landed, not a buyer going cold, and conflating the two produces a list of her own outbox.

### 3. `unworked_intro`

An introduction was made — either she made it or one was made to her — and the thread simply stops.

- `because` gives the date, who introduced whom, and how long nothing has happened.
- If the thread stopped because the thing concluded, it is not unworked. Say why you believe it did
  not conclude.

### 4. `connector`

Someone who has introduced her to several other people in the map. Their value is invisible in any
list sorted by volume, because a connector may write to her rarely.

- `because` counts the introductions and gives the span.
- `counterpart_code` is null for this kind.
- Raise **at most three**, the strongest.

## What to write

Write **exactly one file**, `~/.boss-os/mailbox/findings.json`, and nothing else. Do not write a
summary anywhere. Do not modify the map. Do not send any mail — the Gmail scope here is read-only.

```json
{
  "run_id": "mbx_<the current date as YYYYMMDD>",
  "swept_at": "<ISO 8601 UTC>",
  "threads_read": 0,
  "skipped_unmapped": 0,
  "findings": [
    {
      "kind": "missed_deal",
      "subject_code": "ROOK",
      "counterpart_code": "AVOCET",
      "subject_matter": "<company name>",
      "headline": "<one sentence she can act on without opening anything else>",
      "because": "<dates and counts. Never a quotation.>",
      "suggested_action": "<one concrete next move, naming both code names>",
      "confidence": "high",
      "evidence": ["<gmail thread id>", "<gmail thread id>"]
    }
  ]
}
```

`evidence` is **Gmail thread ids only** — the ids let her open the real thread on this machine in
one click, and an id says nothing to anyone who cannot already read the mailbox.

## Rule 0: this run may not finish having done nothing

**Zero findings is a real and reportable outcome.** An empty `findings` array with a truthful
`threads_read` count is a good week. Silence is not: "the sweep found nothing" and "the sweep never
ran" are opposite facts and Boss OS shows them differently.

If you cannot read the mailbox — the connector is not authorised, the map is missing — do **not**
write a findings file at all. `mailbox-report.mjs` refuses a stale or absent file with a named stop,
which is the honest outcome. Writing an empty file in that situation would report a clean sweep that
never happened, which is a lie with a timestamp.

End your run by printing exactly one line:

```
MAILBOX-SWEEP-COMPLETE: <n> finding(s) from <m> thread(s)
```

The runner proves completion by that sentinel rather than by output length, because a quiet week is
a short answer and would trip any byte threshold.
