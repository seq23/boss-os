/**
 * Types for Boss OS's mail routing, so the Worker and the build validators share ONE router.
 *
 * A `.mjs` beside a `.d.mts`, the pattern this repo already uses for
 * `scripts/validate/no-cross-repo-coupling.d.mts` — and here it is load-bearing rather than
 * stylistic. `validate:every-employee-has-a-tag` has to prove that every employee in D1 is
 * reachable, and the only honest way to prove that is to CALL the real `routeToSeat` with the real
 * roster. A validator that reimplemented the tag rule in order to check the tag rule would be
 * asserting its own copy — two components each keeping their own list with no link, in the guard
 * meant to prevent exactly that.
 */

export interface BossSeat {
  id: string;
  name: string;
  role: string;
  lane: string;
  department?: string | null;
}

export type BossRouteOutcome = "ROUTED" | "DEFAULTED" | "AMBIGUOUS";

export interface BossRoute {
  outcome: BossRouteOutcome;
  /** Never null: something always takes the message. */
  seat: BossSeat;
  tag: string | null;
  /** Tags that were typed and matched no seat. Named back to her so a typo is visible. */
  unknownTags: string[];
  candidates: BossSeat[];
  why: string;
}

export declare const BOSS_INTAKE_MAILBOX: string;
export declare const BOSS_INTAKE_DOMAIN: string;
export declare const BOSS_INTAKE_SENDERS: readonly string[];
export declare const BOSS_DEFAULT_ROUTE_ROLE: string;

export declare function seatTag(name: string): string;
export declare function hashtagsIn(text: string): string[];
export declare function routeToSeat(text: string, roster: readonly BossSeat[], to?: string | null): BossRoute | null;
export declare function seatByAddress(to: string | null | undefined, roster: readonly BossSeat[]): BossSeat | null;
export declare function replyBody(route: BossRoute, roster: readonly BossSeat[], subject: string): string;
export declare function decodeMimeHeader(value: string): string;
export declare function extractAddress(header: string | null | undefined): string | null;
export declare function strippedSubject(subject: string): string;
export declare function dmarcPassed(authResults: string | null | undefined): boolean;
export declare function isOwner(address: string | null | undefined): boolean;
