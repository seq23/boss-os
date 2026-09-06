import { audit } from "../lib/audit";
import { getSetting, setSetting } from "../lib/settings";

/**
 * THE SPEND LEVER — one graduated control over how much money the router may
 * spend, expressed through the dollar authority that already exists.
 *
 * WHY THIS IS NOT A FOURTH NUMBER. This repository already had three spend
 * controls before this file: `budgets` (per lane, per period, the dollar
 * authority, and it already hard-stops), `cost_mode` (which MODEL TIERS are
 * eligible — a quality question, not a money one), and
 * `execution_backends.monthly_ceiling_micros` (a per-backend sub-cap). A fourth
 * independent limit is the "two components each keeping their own list, with no
 * link between them" defect. So the lever introduces no new stored amount that
 * anything checks on its own:
 *
 *   - it supplies the ALLOWANCE that a backend's sub-cap defers to;
 *   - the lane budget remains the outer authority and is never raised by it;
 *   - the effective allowance for any call is min(lane remaining, backend
 *     remaining, task envelope) — three numbers that can never disagree because
 *     the smallest always wins.
 *
 * COST MODE IS A SEPARATE QUESTION AND STAYS ONE. "How good a model" and "how
 * much money" are different decisions. The lever never changes `cost_mode`, and
 * `cost_mode` never changes the lever.
 *
 * THE POSITION AND THE NUMBER ARE TWO THINGS. `spend_lever` says which position;
 * `spend_lever_moderate_micros` is MODERATE's allowance, editable at any time and
 * effective on the next spend decision. Nothing is materialised into rows, so
 * changing the figure needs no re-apply step that could be forgotten.
 */

export const SPEND_LEVER_POSITIONS = ["FREE_ONLY", "MODERATE", "OPEN"] as const;
export type SpendLeverPosition = (typeof SPEND_LEVER_POSITIONS)[number];

export const SPEND_LEVER_KEY = "spend_lever";
export const SPEND_LEVER_MODERATE_KEY = "spend_lever_moderate_micros";

export interface SpendLeverState {
  position: SpendLeverPosition;
  /** Micros of paid spend a backend may use this window. Meaningless when `uncapped`. */
  allowanceMicros: number;
  /** OPEN only. No dollar ceiling is applied — spend is still recorded. */
  uncapped: boolean;
  /** MODERATE's figure, and where it came from — set by the owner, or seeded. */
  moderateMicros: number;
  moderateSource: "owner_set" | "seeded_from_lane_budget" | "absent";
  label: string;
  /** One sentence a person can act on. Every refusal quotes this. */
  remedy: string;
}

function isPosition(v: unknown): v is SpendLeverPosition {
  return typeof v === "string" && (SPEND_LEVER_POSITIONS as readonly string[]).includes(v);
}

/**
 * MODERATE's default figure is READ, not invented.
 *
 * The owner already decided what a month of routine work is worth when she set
 * the ops month budget. Seeding MODERATE from that row means nothing is blocked
 * waiting on her to type a number, and the number that appears is one she
 * recognises rather than a constant an implementer chose.
 */
async function seedModerateMicros(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT limit_micros FROM budgets WHERE lane = 'ops' AND period = 'month'`)
    .first<{ limit_micros: number }>();
  return row?.limit_micros ?? 0;
}

export async function spendLeverState(db: D1Database): Promise<SpendLeverState> {
  const raw = await getSetting(db, SPEND_LEVER_KEY);
  // FAIL CLOSED. An absent, misspelled or hand-edited position is FREE_ONLY.
  // OPEN is opt-in and is never reached by a missing value, an unparseable one,
  // or inheritance from anywhere.
  const position: SpendLeverPosition = isPosition(raw) ? raw : "FREE_ONLY";

  const storedModerate = await getSetting(db, SPEND_LEVER_MODERATE_KEY);
  const parsed = storedModerate === null ? NaN : Number(storedModerate);
  const ownerSet = Number.isFinite(parsed) && parsed >= 0;
  const moderateMicros = ownerSet ? Math.floor(parsed) : await seedModerateMicros(db);
  const moderateSource: SpendLeverState["moderateSource"] = ownerSet
    ? "owner_set"
    : moderateMicros > 0
      ? "seeded_from_lane_budget"
      : "absent";

  if (position === "OPEN") {
    return {
      position, allowanceMicros: 0, uncapped: true, moderateMicros, moderateSource,
      label: "Open — no dollar ceiling",
      remedy: "The spend lever is at OPEN, so no ceiling is applied. Move it to MODERATE or FREE_ONLY in Settings to put one back.",
    };
  }
  if (position === "MODERATE") {
    return {
      position, allowanceMicros: moderateMicros, uncapped: false, moderateMicros, moderateSource,
      label: `Moderate — up to ${formatMicros(moderateMicros)} of paid work per month, per backend`,
      remedy: `The spend lever is at MODERATE, which allows ${formatMicros(moderateMicros)} of paid work per backend this month. Raise MODERATE's figure, or move the lever to OPEN, in Settings.`,
    };
  }
  return {
    position, allowanceMicros: 0, uncapped: false, moderateMicros, moderateSource,
    label: "Free only — $0",
    remedy: "The spend lever is at FREE_ONLY, so only routes that cost nothing may run. Move the lever to MODERATE or OPEN in Settings to allow paid models.",
  };
}

export function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

export interface LeverChange {
  from: SpendLeverPosition;
  to: SpendLeverPosition;
  moderateFrom: number;
  moderateTo: number;
  laneHardStopsSetTo: number;
}

/**
 * Move the lever.
 *
 * WHAT CHANGES IN THE DATABASE, so the state is legible rather than implied:
 *
 *   - `settings.spend_lever` — the position.
 *   - `settings.spend_lever_moderate_micros` — MODERATE's allowance, when given.
 *   - `budgets.hard_stop` — 0 at OPEN, 1 otherwise, on EVERY lane row.
 *     `limit_micros` is never touched, and `spent_micros` keeps accruing at every
 *     position, so the window's spend stays readable against a limit she can
 *     still see even while nothing is refusing on it.
 *
 * REVERSIBLE AND NOT RETROACTIVE. Dropping back takes effect at the next spend
 * decision. Work already completed is not re-judged and is never failed after
 * the fact; only the next call is refused.
 */
export async function setSpendLever(
  db: D1Database,
  next: { position: SpendLeverPosition; moderateMicros?: number },
  actor: string,
): Promise<LeverChange> {
  const before = await spendLeverState(db);

  await setSetting(db, SPEND_LEVER_KEY, next.position);
  if (next.moderateMicros !== undefined) {
    await setSetting(db, SPEND_LEVER_MODERATE_KEY, String(Math.floor(next.moderateMicros)));
  }

  const hardStop = next.position === "OPEN" ? 0 : 1;
  await db.prepare(`UPDATE budgets SET hard_stop = ?`).bind(hardStop).run();

  const after = await spendLeverState(db);
  const change: LeverChange = {
    from: before.position, to: after.position,
    moderateFrom: before.moderateMicros, moderateTo: after.moderateMicros,
    laneHardStopsSetTo: hardStop,
  };

  await audit(db, {
    actor, lane: "ops", entityType: "spend_lever", entityId: SPEND_LEVER_KEY,
    action: "moved", detail: change,
  });

  return change;
}
