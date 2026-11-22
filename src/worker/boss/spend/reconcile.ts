import type { Env } from "../env";

/**
 * WHAT THIS SYSTEM ACTUALLY SPENT, IN ONE NUMBER.
 *
 * Money is recorded by Boss OS's own router in `usage_ledger` (0152); this reads it and reports one
 * figure with how it was obtained, plus what cannot be observed from here.
 *
 * THE CHASSIS LEDGERS ARE GONE FROM THIS SUM (chassis retirement, 22 Nov 2026). `ai_run` and
 * `vendor_spend` belonged to the copied West Peek fund code. Both were read live in production
 * before removal: zero rows ever, in either. Their only writers were the retired fund API, so
 * nothing can add a row to them now. The tables stay (nothing is dropped). If anything in Boss OS
 * ever records spend outside the router again, it records it in `usage_ledger`, so one ledger
 * stays the whole truth.
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

export async function reconcileSpend(
  env: Env,
  windowStartedAt: number,
  windowEndsAt = Date.now(),
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
