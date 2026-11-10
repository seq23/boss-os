/**
 * Types for THE GRID — the repos she cares about for making money. Derived from
 * `searchReadiness/sites.json` (owner, 10 Nov 2026): that file is the one list.
 *
 * A `.d.mts` beside the `.mjs` because the Worker, the examination on her Mac and the validator all
 * have to mean the same thing by "the grid". A list any of them kept its own copy of is the defect
 * that produced two disagreeing property lists before this file existed.
 */

export type GridTier = "primary" | "secondary" | "infrastructure";
export type GridOwner = "hers" | "client";

export interface GridProperty {
  key: string;
  label: string;
  /** Canonical domains, where she has named them. Never invented. */
  domains: readonly string[];
  /** How many properties this row stands for, when the domains are not all recorded. */
  property_count?: number;
  repos: readonly string[];
  /** Domain → the repo that serves it. */
  domain_repos?: Readonly<Record<string, string>>;
  /** Channel handles, for a property with no website (Whisper Almanac). */
  handles?: readonly string[];
  /** The sites.json group: divine_9, support or friends. */
  group?: string;
  /** The sites.json business names this property carries. */
  businesses?: readonly string[];
  owner: GridOwner;
  tier: GridTier;
  why_tier?: string;
}

export interface GridExclusion {
  /** A repo-name prefix, matched case-insensitively against the last path segment. */
  match: string;
  why: string;
}

export declare const GRID: readonly GridProperty[];
export declare const EXCLUDED: readonly GridExclusion[];
export declare const GRID_OWNER: string;
export declare const GRID_KEYS: readonly string[];

export declare function gridRepos(): string[];
export declare function deriveGrid(sites?: unknown): GridProperty[];
export declare function gridChannels(sites?: unknown): { business: string; repo: string; handle: string; group: string | null }[];
export declare function isExcluded(repo: string | null | undefined): boolean;
export declare function whyExcluded(repo: string | null | undefined): string | null;
export declare function propertyForRepo(repo: string | null | undefined): GridProperty | null;
export declare function propertyFor(key: string | null | undefined): GridProperty | null;
export declare function suggestingKeys(): string[];
