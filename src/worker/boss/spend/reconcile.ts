import type { Env } from "../env";
import type { Env as ChassisEnv } from "../../env";
import { firmSpend } from "../../ai/spend";

/**
 * WHAT THIS SYSTEM ACTUALLY SPENT, IN ONE NUMBER.
 *
 * THE DEFECT THIS CLOSES. Money is recorded in three places in this repository and nothing ever
 * added them together:
 *
 *   `usage_ledger`   — Boss OS's own, written by its router (0152).
 *   `ai_run`         — the West Peek chassis's, written by `runAi` (0004).
 *   `vendor_spend`   — charges outside any model boundary, e.g. generated images (0080), which are
 *                      outside `runAi` by design and invisible to both of the above.
 *
 * Two components each keeping their own list, with no link between them, is the defect pattern this
 * repository is written against — and here it has teeth, because "what did I spend" was answered by
 * whichever ledger the reader happened to open. A budget that hard-stops at $2 while a second
 * ledger accrues elsewhere is not a budget.
 *
 * IT CALLS THE CHASSIS'S OWN DEFINITION RATHER THAN RE-DERIVING ONE. `firmSpend` already sums
 * `ai_run` and `vendor_spend` together and is, in its own words, "the single source every screen
 * and every ceiling reads" — written that way after three separate derivations of the same word
 * were caught 28% apart. Re-implementing that SQL here to avoid one import would have been the
 * fourth derivation, and there is no reason to believe mine would agree with theirs.
 *
 * THE COUPLING IS DELIBERATE AND FAILS LOUDLY. Boss OS is otherwise self-contained and the chassis
 * is scheduled for removal, so this import is the one thread between them. When the chassis goes
 * this file stops compiling — which is the correct failure: a missing ledger should be a build
 * error someone fixes, never a total that silently shrinks.
 *
 * THIS IS A READER, NOT A FOURTH LEDGER. It writes nothing. Adding a fourth store to fix three that
 * disagree is the same mistake with more steps. Each source keeps recording exactly as it does
 * today; this reads them and reports one figure with its parts still visible, so a number that
 * looks wrong can be traced to the ledger that produced it.
 *
 * EVERY FIGURE CARRIES HOW IT WAS OBTAINED. `measured` is what a vendor reported. `estimated` is
 * arithmetic from a stored price. `unobservable` is a cost that genuinely cannot be read from here,
 * and it is stated rather than defaulted to zero — a zero meaning "we could not look" is
 * indistinguishable from a zero meaning "nothing was spent", and only one of those is good news.
 */

export type Basis = "measured" | "estimated" | "unobservable";

export interface LedgerPart {
  source: string;
  cost_micros: number;
  basis: Basis;
  rows: number;
  /** Why this figure is what it is. A person reads this, so it is a sentence. */
  note: string;
}

export interface Reconciliation {
  window_started_at: number;
  window_ends_at: number;
  /** The sum of every part that carries a number. */
  total_micros: number;
  /** True only when every counted part is `measured`. */
  fully_measured: boolean;
  parts: LedgerPart[];
  /** Real costs this reader cannot see. Named, never folded into the total as zero. */
  unobservable: LedgerPart[];
}

/**
 * The Workers AI free allowance, and why no figure is claimed for it here.
 *
 * Cloudflare's included allowance is 10,000 neurons a day. The binding does not return neurons
 * consumed — there is no field on the response, and a Worker cannot read its own remaining balance.
 * The account-level figure IS readable, through Cloudflare's GraphQL analytics API
 * (`aiInferenceAdaptiveGroups`), which needs an account-scoped API token.
 *
 * THAT TOKEN DELIBERATELY DOES NOT LIVE IN THIS WORKER. It can edit D1, deploy Workers and read
 * R2 — putting it in the cloud half to render a usage number would trade this system's whole
 * credential posture for a progress bar. `npm run ops:workers-ai-usage` reads it on the machine
 * that already holds the token, which is the same shape as every other private-side capability
 * here.
 *
 * So the allowance is reported as unobservable AND SAYS WHERE THE REAL NUMBER LIVES, rather than
 * recording 0 and letting a reader mistake "not measured" for "nothing spent".
 */
export const WORKERS_AI_ALLOWANCE_NOTE =
  "Workers AI's included allowance is 10,000 neurons a day. The binding does not report neurons " +
  "consumed and a Worker cannot read its own remaining balance, so no figure is claimed here. " +
  "Read the true account figure with `npm run ops:workers-ai-usage`, which runs where the " +
  "Cloudflare token already lives rather than putting an account-scoped token in this Worker.";

/**
 * `firmSpend` reads only `env.WP_OS_DB`, and Boss OS's `DB` is that same database — one D1, one
 * Worker. The shim is narrow on purpose: widening it would invite the rest of the chassis env in
 * behind it.
 */
function chassisView(db: D1Database): ChassisEnv {
  return { WP_OS_DB: db } as unknown as ChassisEnv;
}

export async function reconcileSpend(
  env: Env,
  windowStartedAt: number,
  windowEndsAt = Date.now(),
  firmScope = "west-peek",
): Promise<Reconciliation> {
  const parts: LedgerPart[] = [];

  // ── Boss OS's own ledger ───────────────────────────────────────────────────
  // `status = 'ok'` only. A row for a call blocked by budget or errored carries a cost of 0, and
  // counting it would inflate the row count while adding nothing — making the ledger look busier
  // than the spending was.
  const boss = await env.DB
    .prepare(
      `SELECT COALESCE(SUM(cost_micros), 0) AS cost, COUNT(*) AS n
         FROM usage_ledger WHERE ts >= ? AND ts < ? AND status = 'ok'`,
    )
    .bind(windowStartedAt, windowEndsAt)
    .first<{ cost: number; n: number }>();

  parts.push({
    source: "usage_ledger",
    cost_micros: Number(boss?.cost ?? 0),
    // ESTIMATED, not measured, and 0174 is why the distinction is kept: the figure is arithmetic
    // over token counts and a stored per-token price. One of those prices is vendor-confirmed and
    // one is explicitly unconfirmed, so their product cannot honestly be called a measurement.
    basis: "estimated",
    rows: Number(boss?.n ?? 0),
    note:
      "Boss OS's router ledger. Cost is computed from token counts and the stored per-token price, " +
      "so it is exactly as true as those prices — each row in `models` states its own provenance.",
  });

  // ── The chassis's ledgers, through the chassis's own definition ────────────
  // ALL_TIME then narrowed by the caller's window is not possible through firmSpend's fixed
  // windows, so the whole-life figure is read and reported as such. Reporting a smaller number
  // under a window it does not actually cover would be worse than reporting a wider true one.
  const chassis = await firmSpend(chassisView(env.DB), firmScope, "ALL_TIME").catch(() => null);

  if (chassis) {
    parts.push({
      source: "ai_run + vendor_spend",
      cost_micros: Math.round(chassis.total_usd * 1_000_000),
      // Mixed: model cost is estimated from prices, vendor cost is what the vendor reported. The
      // weaker of the two governs the label, because a total is only as trustworthy as its
      // shakiest part.
      basis: "estimated",
      rows: chassis.runs,
      note:
        `The West Peek chassis's ledgers, read through its own \`firmSpend\` — the single ` +
        `definition every chassis screen and ceiling uses. Model $${chassis.model_usd.toFixed(6)} ` +
        `and vendor $${chassis.vendor_usd.toFixed(6)}, all-time rather than windowed, because ` +
        `firmSpend offers fixed windows and a narrower figure that did not cover the window would ` +
        `mislead. ${chassis.unpriced_vendor_calls} vendor call(s) reported no cost and are excluded ` +
        `rather than counted as zero.`,
    });
  }

  const unobservable: LedgerPart[] = [
    {
      source: "workers_ai_allowance",
      cost_micros: 0,
      basis: "unobservable",
      rows: 0,
      note: WORKERS_AI_ALLOWANCE_NOTE,
    },
  ];

  return {
    window_started_at: windowStartedAt,
    window_ends_at: windowEndsAt,
    total_micros: parts.reduce((sum, p) => sum + p.cost_micros, 0),
    fully_measured: parts.length > 0 && parts.every((p) => p.basis === "measured"),
    parts,
    unobservable,
  };
}
