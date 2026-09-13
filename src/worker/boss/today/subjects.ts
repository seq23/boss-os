/**
 * WHAT TODAY'S CONTRACT IS ALLOWED TO BE ABOUT.
 *
 * ─── The rule, in her words ────────────────────────────────────────────────
 *
 *   "this was in today's contract: `Danielle's Ahrefs pass has not reported — run
 *    ahrefs-audit-fix.sh or find out why launchd did not.` ----- something not working should
 *    never be in today's contract it should be in the inbox."
 *
 * Today's contract is WHAT SHE IS DOING TODAY. A job that did not run is not her work; it is a
 * notification about her own machinery. Putting one in the contract did not merely misfile it — it
 * DISPLACED real work, because `executionContract` returned it ahead of a stalling deal and the
 * oldest open loop. A cron was outranking a dying deal.
 *
 * This file is the registry that makes the rule enforceable rather than remembered.
 * `scripts/validate/todays-contract-is-her-work.mjs` reads THESE LISTS — not a second copy of them —
 * and fails if a contract builder queries a table that is not classified as her work.
 *
 * ─── Why a registry and not a list of banned words ─────────────────────────
 *
 * A word list catches the sentence and misses the source. The Ahrefs line could have been reworded
 * into something that reads like work — "Chase Danielle about the audit" — and it would still have
 * been the system reporting on itself, still returned ahead of a deal, still the same defect. What
 * makes an item machinery is WHAT IT IS ABOUT, and in this codebase that is legible: it is the table
 * the builder had to read to know.
 *
 * ─── A table in NEITHER list is a FAILURE, deliberately ────────────────────
 *
 * Not a pass, and not a guess. The next contributor adding a contract source has to say which kind
 * of thing it is, in this file, where the rule is written down — and if they think it is machinery,
 * the validator tells them where it belongs instead. An unclassified table passing silently is how
 * the registry would rot into decoration.
 */

/**
 * Tables whose rows ARE her work. A contract item may be about these.
 *
 * The test is not "is it useful" — the alert surface is useful too. It is: does a row here describe
 * something SHE does, decides, owes or owns? A deal, a person, a loop she wrote down, a movement,
 * a manuscript, a day of her own record.
 */
export const WORK_SUBJECTS = new Set([
  /** Deals. The stalling-deal check, which is the thing this pillar exists to catch. */
  "deals",
  /**
   * People and the touch list.
   *
   * `people` is JOINed for the name — `relationships` holds the standing and `people` holds who it
   * is. Found by this registry's own first run, which is the behaviour it exists for: the table was
   * queried by a contract builder and classified nowhere, and an unclassified table is refused
   * rather than waved through.
   */
  "relationships",
  "people",
  /** Things she wrote down and has not closed. §5.7. */
  "open_loops",
  /** Buyers and sellers her analyst surfaced for her to keep or reject. Her decision, not a queue. */
  "sourcing_candidates",
  /** Deals found in her own mailbox, awaiting her pairing. */
  "mailbox_findings",
  /** Her own movement record. */
  "movement_log",
  /** Her days: the record of what she did, which the contract is built on top of. */
  "days",
  /**
   * Her own live brokerage inventory. She is the counterparty and no third party is named in it,
   * which is why 0226 stores it at all — and it is the most literally "her work" table here.
   *
   * The 2,145-row interest ledger is deliberately NOT on this list, because it is deliberately not
   * in this database: "Named counterparties, assets and sizes never reach the Boss OS database."
   */
  "capital_book",
  "capital_book_line",
  /**
   * WORK, AND IT IS THE ONLY THING ON THIS LIST THAT IS A POINTER TO WORK RATHER THAN THE WORK.
   * Stated rather than waved through, because a pointer looks like machinery at a glance.
   *
   * A row here says Monique found N crossings in the interest ledger this morning and emailed them
   * to her. It is not a report about whether a job ran — `duty_runs` is that, and it is on the
   * machinery list where it belongs. It is a count of LIVE DEALS sitting in her inbox, with the
   * named counterparties, assets and sizes deliberately left on her Mac. Acting on them is
   * brokerage work and nobody else can do it.
   *
   * The distinction that matters: if the job fails, NOTHING IS POSTED and this table says nothing.
   * The failure goes to the alert surface like every other duty's. So this table can only ever
   * carry a fact about her business, never a fact about her machinery.
   */
  "brokerage_pointers",
  /**
   * A buyer candidate who also appears on her LP tracker. Public institutions and aggregate counts,
   * never a person — same class as `sourcing_candidates`. Deciding whether to approach one on the
   * buy side is brokerage work and nobody else can make the call.
   */
  "counterparty_crossmatches",
  /**
   * WORK, AND THE CLOSEST CALL ON THIS LIST — stated rather than waved through.
   *
   * `owned_deliverables` is the register of work she has handed to someone, and most of what is
   * said ABOUT it is machinery: stalls, dead executors, missing terminal checks. All of that already
   * goes to the alert surface from `today/deliverables.ts` and none of it comes through here.
   *
   * What `humanTouch` reads is the narrow subset flagged `needs_owner` — an item that cannot proceed
   * without her judgement, her name, her signature or her voice. That is not a report about the
   * machinery; it is a thing only she can do, which is the definition of her work. The distinction
   * is enforced in code and by `validate:one-human-touch`, not left to this comment.
   */
  "owned_deliverables",
  /** JOINed for the owner's name, so an item says who is waiting rather than only what is waiting. */
  "employees",
  /**
   * WORK, AND THE SAME CLOSE CALL `owned_deliverables` ABOVE IS — settled the same way, because it
   * is the same distinction wearing different clothes.
   *
   * `grid_observations` is what Danielle's daily pass over her repositories found. MOST of what is
   * in it is machinery: red workflows, lanes that stopped shipping, repos that would not read. None
   * of that comes through here. Every one of those rows carries `disposition = 'dispatch'`, becomes
   * a task under Danielle's name, and is refused by `examinedTouch`, which reads
   * `disposition = 'needs_her'` and nothing else.
   *
   * WHAT DOES COME THROUGH is a pull request where SHE is the named reviewer, or a client waiting on
   * a reply that has to come from her. That is not a report about her machinery — it is somebody
   * waiting on her signature, found by looking rather than by being told. The endpoint refuses the
   * value on any property that is not `primary` and refuses it without a sentence saying what only
   * she can do, so the narrowness is enforced in D1 and by `validate:one-human-touch`, not left to
   * this comment.
   */
  "grid_observations",
  /**
   * WORK. An employee took something as far as she could and asked HER a question, with the work
   * stopped behind it. `question` is the thing she is being asked, in words she would use.
   *
   * A question addressed to her by name is the definition of her work — it is the one kind of item
   * that cannot be dispatched, because dispatching it is what produced the question.
   */
  "judgement_calls",
  /**
   * WORK, AND IT HOLDS NO CONTENT OF ITS OWN — which is exactly why it has to be said out loud here
   * rather than waved through as plumbing.
   *
   * One row per day: which single item was put in front of her, and out of which of the three
   * sources. The day is the PRIMARY KEY, and that is how "no more than 1 per day" holds — `LIMIT 1`
   * caps a query, not a day, and a page reloaded twice would otherwise hand her two different items.
   *
   * IT IS NOT MACHINERY, and the test is what a row here can ever produce. It cannot produce a
   * sentence about a job, a cadence or a credential; the only thing it can do is point at a row in
   * `owned_deliverables`, `grid_observations` or `judgement_calls` — all three of which are her
   * work, above. A pointer to her work is her work. If it were on the machinery list, the rule would
   * be telling us the one-a-day cap belongs on the alert surface, which is nonsense.
   */
  "human_touch_days",
]);

/**
 * Tables whose rows are the SYSTEM REPORTING ON ITSELF. These belong on the alert surface.
 *
 * Every one of these already has a home: `routes/today.ts` raises a HIGH alert for a duty that has
 * not fired within twice its cadence, for a broken or unprobed credential, for the budget, for the
 * kill switch, for stuck tasks and for a failed nightly run — around thirty items, all outside the
 * contract. Nothing here is unreported. It is reported in the right place.
 */
export const MACHINERY_SUBJECTS = new Set([
  "standing_duties",
  "duty_runs",
  "cron_runs",
  "credential_probes",
  "system_events",
  "vault_snapshots",
  "vault_restores",
  "site_audit_findings",
  "schema_version",
  "backends",
  "external_effect_request",
  "alert_dismissals",
  "discovery_inbox",
  "model_benchmarks",
  "agent_budget",
]);

/**
 * Where a machinery item goes instead, named so the failure message can say it.
 *
 * NOT the approvals Inbox. `today/deliverables.ts` already argued this out and refused: "putting a
 * notification back into it is how it filled up with things to clear without reading last time",
 * and `tests/boss/inboxIsForDecisions.test.ts` holds that line. The approvals Inbox is for
 * decisions whose answer changes what happens next. A notification about machinery goes to the
 * alert surface, which is where its thirty siblings already live.
 */
export const MACHINERY_BELONGS = "the critical_alerts surface (routes/today.ts), not Today's contract and not the approvals Inbox";
