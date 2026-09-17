/**
 * THE BYPASS — the one way over a cap, and it is hers.
 *
 * Her request, in her words: *"if a task is going to take me over the caps daily or per run or
 * monthly i need a way to bypass"*.
 *
 * Modelled on `STRATEGIC_SURGE` in West Peek OS (`src/worker/ai/runAi.ts`), which exists for
 * exactly this and has the semantics worth copying: caps lift ONLY inside an unexpired,
 * fully-specified record, and an expired or malformed one resolves to the normal posture. Copied
 * and diverged, per this repository's rule — the sibling keeps one JSON blob on a firm-wide policy
 * row, and this needs several bypasses to coexist and to be told apart in the ledger afterwards.
 *
 * ─── WHAT A BYPASS IS, AND WHAT IT IS NOT ───────────────────────────────────────────────────────
 *
 * It is a NUMBER, a REASON and an EXPIRY, against ONE named cap. It is not a switch, not a mode,
 * and not a period during which nothing stops. Spending past a bypass's own amount is refused
 * exactly as it would have been without one — the ceiling moves, it never disappears.
 *
 * Nothing here touches `budgets.hard_stop`. That mechanism exists (the spend lever's OPEN position
 * sets it to 0) and it is deliberately not what this uses, because its end state is silence: work
 * stops being refused and nobody is told anything. A bypass ends by expiring, loudly, back to the
 * cap that was always there.
 *
 * ─── FAIL CLOSED, ON EVERY AXIS ─────────────────────────────────────────────────────────────────
 *
 * Absent, expired, revoked, unparseable, in the future, or raised by anyone but the owner — each
 * resolves to NO BYPASS. There is no branch in this file that returns headroom on a value it did
 * not fully understand. The `raised_by = 'owner'` CHECK on the table means the last of those cannot
 * even be written, and it is asserted here as well: a constraint enforced in one place is a
 * constraint that moves when somebody edits a migration.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { formatMicros } from "./spend";

export type BypassScope = "per_run" | "day" | "month";

export interface BypassRow {
  id: string;
  scope: string;
  lane: string | null;
  amount_micros: number;
  reason: string;
  raised_by: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

export interface BypassState {
  /** The live bypass for this scope and lane, or null. Null is the normal state. */
  active: BypassRow | null;
  /** One sentence for a decision log and for a person. Never empty when `active` is set. */
  note: string;
}

const NONE: BypassState = { active: null, note: "" };

/**
 * Is this row a bypass, right now?
 *
 * EVERY CONDITION IS CHECKED HERE EVEN THOUGH THE QUERY ALSO FILTERS ON SOME OF THEM. The query is
 * an optimisation; this is the rule. A future edit to the SQL cannot loosen what a bypass means,
 * because the SQL is not where that is decided.
 */
export function isLive(row: BypassRow, now: number): boolean {
  if (row.raised_by !== "owner") return false;
  if (row.revoked_at !== null) return false;
  if (!Number.isFinite(row.expires_at) || row.expires_at <= now) return false;
  if (!Number.isFinite(row.created_at) || row.created_at > now) return false;
  if (!Number.isFinite(row.amount_micros) || row.amount_micros <= 0) return false;
  if (typeof row.reason !== "string" || row.reason.trim().length < 12) return false;
  return row.scope === "per_run" || row.scope === "day" || row.scope === "month";
}

/**
 * The live bypass for one cap, if there is one.
 *
 * THE MOST RECENT WINS, NOT THE LARGEST. If she raised two, the one she raised last is the decision
 * she currently holds; picking the largest would let a stale, generous bypass outrank a deliberate,
 * tighter one she wrote afterwards.
 */
export async function bypassFor(
  db: D1Database,
  scope: BypassScope,
  lane: string | null,
  now = Date.now(),
): Promise<BypassState> {
  let rows: { results?: BypassRow[] };
  try {
    rows = await db
      .prepare(
        `SELECT id, scope, lane, amount_micros, reason, raised_by, created_at, expires_at, revoked_at
           FROM spend_bypass
          WHERE scope = ?1 AND (lane IS ?2 OR lane = ?2) AND revoked_at IS NULL AND expires_at > ?3
          ORDER BY created_at DESC
          LIMIT 5`,
      )
      .bind(scope, lane, now)
      .all<BypassRow>();
  } catch {
    // A table that is missing or a query that threw is not headroom. Fail closed and say nothing
    // about a bypass, which leaves the cap exactly where it was.
    return NONE;
  }

  for (const row of rows.results ?? []) {
    if (!isLive(row, now)) continue;
    return {
      active: row,
      note:
        `A ${row.scope === "per_run" ? "per-run" : row.scope} bypass of ${formatMicros(row.amount_micros)} is in ` +
        `force until ${new Date(row.expires_at).toISOString()}, raised by the owner: ${row.reason.trim()}`,
    };
  }
  return NONE;
}

/**
 * WHAT THIS RUN IS ABOUT TO COST, AND WHICH CAP IT WILL HIT — before it runs.
 *
 * "Predict, do not just block" is the half of her request that is easy to skip, and skipping it
 * produces exactly the experience she described: work dies at the moment it mattered and the reason
 * arrives afterwards. A prediction is the same arithmetic done one step earlier and said out loud.
 *
 * IT IS A STATEMENT, NOT A DECISION. Nothing here refuses anything — the guard and the router do
 * that, in the places that already own it. This exists so that the refusal, when it comes, has
 * already been announced, and so a surface can show "this is going to be short" while the work is
 * still queued.
 */
export interface SpendPrediction {
  /** True when this run, at this estimate, will be refused by one of the caps. */
  willExceed: boolean;
  /** Which one. Named, so the sentence can say what would change it. */
  cap: "per_run" | "day" | "month" | null;
  /** By how much, in micros. Zero when nothing is exceeded. */
  overBy: number;
  /** A full sentence for a person, naming the task, the cap and the shortfall. */
  sentence: string;
}

export const NO_PREDICTION: SpendPrediction = {
  willExceed: false,
  cap: null,
  overBy: 0,
  sentence: "",
};

/**
 * Compare one estimate against the three caps in force and say what will happen.
 *
 * THE SMALLEST BINDING CAP IS THE ONE NAMED, and per-run is checked first because it is the one a
 * single task can hit on its own — telling her "the month is fine" about a call that dies on the
 * per-run ceiling would be true and useless.
 */
export function predictSpend(args: {
  what: string;
  estimateMicros: number;
  perRunCapMicros: number;
  dayRemainingMicros: number | null;
  monthRemainingMicros: number | null;
}): SpendPrediction {
  const { what, estimateMicros: est } = args;

  const checks: { cap: "per_run" | "day" | "month"; limit: number; how: string }[] = [
    { cap: "per_run", limit: args.perRunCapMicros, how: "what a single run may cost" },
  ];
  if (args.dayRemainingMicros !== null) {
    checks.push({ cap: "day", limit: args.dayRemainingMicros, how: "what is left in the lane's day" });
  }
  if (args.monthRemainingMicros !== null) {
    checks.push({ cap: "month", limit: args.monthRemainingMicros, how: "what is left in the lane's month" });
  }

  for (const c of checks) {
    if (est > c.limit) {
      const over = est - c.limit;
      return {
        willExceed: true,
        cap: c.cap,
        overBy: over,
        sentence:
          `"${what}" is estimated at ${formatMicros(est)}, which is ${formatMicros(over)} more than ` +
          `${formatMicros(c.limit)} — ${c.how}. It will stop unless you raise a ${c.cap === "per_run" ? "per-run" : c.cap} ` +
          `bypass naming an amount, a reason and an expiry.`,
      };
    }
  }

  return NO_PREDICTION;
}
