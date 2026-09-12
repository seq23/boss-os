/**
 * Types for the deterministic handoff rules, so the Worker's intake, the tasks API and
 * `scripts/validate` all exercise the SAME rules rather than three copies of the same judgement.
 */

import type { BossSeat } from "./mail.mjs";

export interface Handoff {
  /** A DEPARTMENT, never an employee id — the seat is looked up in the roster. */
  department: string;
  /** One sentence for the audit row and the reply. */
  why: string;
  /** The words that actually matched, so a handoff can be explained rather than trusted. */
  matched: string[];
}

export interface HandoffInput {
  text?: string;
  subject?: string;
  /** The department of the desk the message is on now. Only the holding desk may be moved off. */
  fromDepartment?: string;
  /**
   * `routeToSeat`'s outcome. Only DEFAULTED may be moved — a tag she typed is a decision she made,
   * and the Chief of Staff is BOTH a named seat and the default holder, so the department alone
   * cannot tell the two apart.
   */
  outcome?: "ROUTED" | "DEFAULTED" | "AMBIGUOUS";
}

export declare const HOLDING_DEPARTMENT: string;
export declare const HANDOFF_RULES: readonly {
  department: string;
  why: string;
  needs: readonly RegExp[];
  orAny?: readonly RegExp[];
}[];

export declare function handoffFor(input?: HandoffInput): Handoff | null;
export declare function seatInDepartment<T extends BossSeat>(
  roster: readonly T[],
  department: string,
): T | null;

export interface HuntRequest {
  /** The company, as she wrote it. */
  asset: string;
  /** The size in dollars, resolved from "$1B+" / "$600M" / "$50 million". */
  size_usd: number;
  /** Which side of the market to hunt. Never defaulted — she has to have said. */
  side: "buy" | "sell";
}

export declare function sizeUsdIn(text: string): number | null;
export declare function huntSideIn(text: string): "buy" | "sell" | null;
export declare function assetIn(text: string): string | null;
export declare function huntRequestIn(text: string): HuntRequest | null;
