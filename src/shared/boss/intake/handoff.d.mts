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
