/**
 * Types for the firm matcher, so the test suite type-checks against it.
 *
 * The implementation is `.mjs` because it is loaded by a plain Node ops script that runs outside
 * the bundler; the declaration exists for the same reason `scripts/sync-agent/agent.d.mts` does.
 */

export type MatchConfidence = "confirmed" | "near";
export type MatchMethod = "core_exact_subset" | "core_exact" | "core_typo";

export interface FirmVerdict {
  confidence: MatchConfidence;
  method: MatchMethod;
  core: string;
}

export function normalise(name: unknown): string;
export function tokens(name: unknown): string[];
export function core(name: unknown): string[];
export function coreIsDistinctive(coreTokens: string[]): boolean;
export function compareFirms(candidateName: unknown, lpFirmName: unknown): FirmVerdict | null;

export function crossMatch<C extends { name: string }, L extends { firm: string }>(
  candidates: C[],
  lpFirms: L[],
): { confirmed: Array<{ candidate: C; lp: L } & FirmVerdict>; near: Array<{ candidate: C; lp: L } & FirmVerdict> };
