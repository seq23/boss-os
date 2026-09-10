/**
 * Types for the auto-fix policy, shared by the Worker route, the local job and the validator.
 *
 * A `.mjs` beside a `.d.mts` because all three have to mean the same thing by "off limits". A rule
 * each of them keeps its own copy of is the defect this repository names most often.
 */

export interface NoAutoFixRepo {
  repo: string;
  why: string;
}

export declare const NO_AUTO_FIX: ReadonlyArray<NoAutoFixRepo>;
export declare const NO_AUTO_FIX_REPOS: readonly string[];
export declare const DISPOSITIONS: readonly string[];

export declare function mayAutoFix(repo: string | null | undefined): boolean;
export declare function whyNoAutoFix(repo: string | null | undefined): string | null;
