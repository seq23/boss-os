import { getSetting, setSetting } from "../lib/settings";
import { audit } from "../lib/audit";

/**
 * WHAT HER PLAN ALLOWS, AND WHAT SHE KEEPS BACK FOR HERSELF.
 *
 * ─── Her words ─────────────────────────────────────────────────────────────
 *
 *   "so claude cieling is $50? i want claude ceiling to be whatever my plan allows"
 *
 * The $50 was a number she authorised on 9 September, written into migration 0222 by hand, and it
 * says so in its own comment: "It is headroom, not a response to observed spend." She is now
 * superseding it, and the fix is not a bigger hardcoded number — it is to stop hardcoding one.
 *
 * ─── Reserve, don't cap ────────────────────────────────────────────────────
 *
 * She has said two things that sound contradictory and are not. Today: "whatever my plan allows."
 * In 0195, the worry behind the whole budget: "a week where she cannot use Claude Code for her own
 * work because her staff spent it."
 *
 * Both are honoured by INVERTING THE CONTROL. The employees may draw the whole plan MINUS a
 * reserve she keeps for her own work. Set the reserve to zero and the ceiling is literally whatever
 * the plan allows; leave it at the default 25% and the thing she was actually afraid of cannot
 * happen. A cap answers "how much may they spend" and she has to guess the number; a reserve
 * answers "how much do I want left", which is the question she can actually answer.
 *
 * ─── The number is DERIVED, in one place, and everything follows it ────────
 *
 * `plan_monthly_capacity_micros` is the plan's capacity; the employee ceiling and the daily pace
 * both come out of it by arithmetic. Upgrading her plan moves the ceiling by itself, which is what
 * "whatever my plan allows" has to mean if it is to stay true next month.
 *
 * THE DAILY FIGURE STAYS DERIVED, which 0222 established after finding a $2/day cap sitting under a
 * $50/month ceiling — $60 against $50, two limits that could not both be honoured. It divides by 31
 * rather than 30 so the derived pace can never exceed the ceiling in any month of the year.
 *
 * ─── AND IT IS NOT MONEY ───────────────────────────────────────────────────
 *
 * `bk_claude_code` runs on her Claude subscription. The "$17.03 spent" on that row is EQUIVALENT
 * USAGE against a flat fee — no money left her account, and none will. 0195 and 0222 both say so in
 * their comments and the screen said none of it, so she has been reading a fake bill. `costBasis`
 * carries that fact next to every figure, because an authoritative-looking number that misleads is
 * the specific defect 0222 warned about.
 */

export const PLAN_TIER_KEY = "plan_tier";
export const PLAN_CAPACITY_KEY = "plan_monthly_capacity_micros";
export const PLAN_RESERVE_PCT_KEY = "plan_reserve_pct";

/** The longest month, so a derived daily pace can never exceed the monthly ceiling. */
export const DAYS_IN_LONGEST_MONTH = 31;

/** What she keeps for her own work unless she says otherwise. */
export const DEFAULT_RESERVE_PCT = 25;

/**
 * The plans this is written against, with what a month of each costs.
 *
 * A SHORT LIST RATHER THAN A FREE NUMBER, because the whole point is that the ceiling follows the
 * PLAN. A hand-typed capacity is the hardcoded $50 with a nicer form around it — it goes stale the
 * moment she upgrades, and nothing would notice. `custom` exists for the case this list is wrong,
 * and it is the only one that takes a figure.
 */
export const PLAN_TIERS: { id: string; label: string; monthlyMicros: number }[] = [
  { id: "claude_pro", label: "Claude Pro", monthlyMicros: 20_000_000 },
  { id: "claude_max_5x", label: "Claude Max (5×)", monthlyMicros: 100_000_000 },
  { id: "claude_max_20x", label: "Claude Max (20×)", monthlyMicros: 200_000_000 },
  { id: "custom", label: "Something else", monthlyMicros: 0 },
];

export interface PlanState {
  tier: string;
  tierLabel: string;
  /** What a month of the plan is worth, in micros. */
  capacityMicros: number;
  /** The share she keeps for her own work, 0–100. */
  reservePct: number;
  reserveMicros: number;
  /** What the employees may draw: capacity minus reserve. THIS is the Claude ceiling. */
  employeeCeilingMicros: number;
  /** The pace inside that month. Derived, never stored — 0222's rule. */
  dailyMicros: number;
  /** True once she has set a tier; false while this is running on the default. */
  chosen: boolean;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RESERVE_PCT;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function tierOf(id: string): { id: string; label: string; monthlyMicros: number } {
  return PLAN_TIERS.find((t) => t.id === id) ?? PLAN_TIERS.find((t) => t.id === "claude_max_5x")!;
}

/** Everything that follows from the capacity and the reserve, computed rather than stored. */
export function derivePlan(tier: string, capacityMicros: number, reservePct: number, chosen: boolean): PlanState {
  const pct = clampPct(reservePct);
  const capacity = Number.isFinite(capacityMicros) && capacityMicros > 0 ? Math.floor(capacityMicros) : 0;
  const reserveMicros = Math.floor((capacity * pct) / 100);
  const employeeCeilingMicros = Math.max(0, capacity - reserveMicros);
  return {
    tier,
    tierLabel: tierOf(tier).label,
    capacityMicros: capacity,
    reservePct: pct,
    reserveMicros,
    employeeCeilingMicros,
    dailyMicros: Math.floor(employeeCeilingMicros / DAYS_IN_LONGEST_MONTH),
    chosen,
  };
}

export async function planState(db: D1Database): Promise<PlanState> {
  const [tierRaw, capacityRaw, reserveRaw] = await Promise.all([
    getSetting(db, PLAN_TIER_KEY),
    getSetting(db, PLAN_CAPACITY_KEY),
    getSetting(db, PLAN_RESERVE_PCT_KEY),
  ]);

  const tier = tierRaw ?? "claude_max_5x";
  /*
   * THE CAPACITY FOLLOWS THE TIER unless the tier is `custom`. Storing both and trusting the stored
   * one is how a plan upgrade moves a label and leaves the number behind — which is exactly the
   * shape of the $50 this replaces.
   */
  const known = tierOf(tier);
  const capacity = tier === "custom" ? Number(capacityRaw ?? 0) : known.monthlyMicros;
  const reserve = reserveRaw === null ? DEFAULT_RESERVE_PCT : Number(reserveRaw);

  return derivePlan(tier, capacity, reserve, tierRaw !== null);
}

export async function setPlan(
  db: D1Database,
  change: { tier?: string; capacityMicros?: number; reservePct?: number },
): Promise<PlanState> {
  const before = await planState(db);

  if (change.tier !== undefined) {
    if (!PLAN_TIERS.some((t) => t.id === change.tier)) {
      throw new Error(`"${change.tier}" is not a plan this system knows. One of: ${PLAN_TIERS.map((t) => t.id).join(", ")}.`);
    }
    await setSetting(db, PLAN_TIER_KEY, change.tier);
  }
  if (change.capacityMicros !== undefined) {
    const micros = Math.max(0, Math.floor(Number(change.capacityMicros)));
    await setSetting(db, PLAN_CAPACITY_KEY, String(micros));
  }
  if (change.reservePct !== undefined) {
    await setSetting(db, PLAN_RESERVE_PCT_KEY, String(clampPct(Number(change.reservePct))));
  }

  const after = await planState(db);
  await audit(db, {
    actor: "boss", lane: "ops", entityType: "setting", entityId: PLAN_TIER_KEY,
    action: "plan_changed",
    detail: {
      from: { tier: before.tier, reserve_pct: before.reservePct, ceiling_micros: before.employeeCeilingMicros },
      to: { tier: after.tier, reserve_pct: after.reservePct, ceiling_micros: after.employeeCeilingMicros },
    },
  });
  return after;
}

// ─── What $0 means, said in words rather than left as a number ───────────────

/**
 * WHY A NUMBER IS NOT ENOUGH, and this is her complaint almost verbatim.
 *
 * Three backends show a ceiling of $0.00 and the three zeroes mean opposite things:
 *
 *   bk_workers_ai     $0 because it is FREE — an included allowance on an account already paid for
 *   bk_openrouter     $0 because NOTHING IS AUTHORISED — free-tier models only until she says so
 *   bk_local_runtime  $0 because it is OFF
 *
 * One number, three meanings, and the screen showed the number. `Backends.tsx` has had the
 * vocabulary for this the whole time — its `spend.kind` handling already renders "FREE", "NO CAP"
 * and "up to $x" — and the registry rows never carried a kind for it to read. Two components, each
 * with their own idea, and no link between them.
 */
export const SPEND_KINDS = ["free", "capped", "uncapped", "off"] as const;
export type SpendKind = (typeof SPEND_KINDS)[number];

/**
 * What a figure on this row IS. The distinction she is owed on every number on the screen.
 *
 *   invoiced        — money leaves her account. A bill.
 *   plan_equivalent — usage measured against a flat subscription. NO money moves.
 *   free            — nothing is charged and nothing is drawn down.
 */
export const COST_BASES = ["invoiced", "plan_equivalent", "free"] as const;
export type CostBasis = (typeof COST_BASES)[number];

export const COST_BASIS_NOTE: Record<CostBasis, string> = {
  invoiced: "Billed to your card.",
  plan_equivalent: "Equivalent usage — billed to your plan, not your card. No money moves.",
  free: "Free. Nothing is charged and nothing is drawn down.",
};

export function spendSentence(kind: SpendKind, ceilingMicros: number, basis: CostBasis): string {
  const money = `$${(ceilingMicros / 1e6).toFixed(2)}`;
  switch (kind) {
    case "free":
      return `Free — no ceiling applies. ${COST_BASIS_NOTE[basis]}`;
    case "off":
      return "Switched off. Nothing runs here, so no ceiling applies.";
    case "uncapped":
      return `No ceiling. Spend is recorded but nothing stops it. ${COST_BASIS_NOTE[basis]}`;
    case "capped":
    default:
      return ceilingMicros > 0
        ? `Up to ${money} a month. ${COST_BASIS_NOTE[basis]}`
        : "Nothing is authorised — only genuinely free tiers may run until you raise this.";
  }
}
