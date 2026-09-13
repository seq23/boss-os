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
  /** Her capital book and the interest ledger behind it — brokerage work is her work. */
  "capital_book",
  "capital_book_lines",
  "counterparty_interest",
  "counterparty_crossmatches",
  /** Standing side-hustle work that genuinely needs her: see `humanTouch` in pillars.ts. */
  "deliverables",
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
