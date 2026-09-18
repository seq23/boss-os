/**
 * Types for the Stage 5 candidate order, so the router and `scripts/validate` exercise the SAME
 * comparator rather than two copies of the same judgement.
 */

export interface OrderableModel {
  display_name: string;
  capability_tier: string;
  /** `models.ladder_rung` — lower is tried first; absent sorts last. Migration 0256. */
  ladder_rung?: number | null;
}

export declare const CAPABILITY_RANK: Record<string, number>;
export declare function capabilityRank(tier: string | null | undefined): number;
export declare function ladderRung(rung: number | null | undefined): number;
export declare function orderCandidates<T extends OrderableModel>(
  models: readonly T[],
  costOf: (model: T) => number,
): T[];
