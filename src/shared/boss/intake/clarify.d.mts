/**
 * Types for the clarification rules, so the Worker's intake and `scripts/validate` exercise the SAME
 * functions rather than two copies of the same judgement. Hand-written beside the `.mjs` for the
 * reason its neighbours are: runnable by node with no build step, type-checked where a Worker
 * imports it.
 */

export interface Clarification {
  /** Which rule fired. Recorded, so a week of questions can be counted by kind. */
  reason: "book_or_note" | "nothing_to_act_on";
  /** One sentence for the mail row and the audit trail. */
  why: string;
  /** The whole reply body: what was understood, what was not, and exactly what to send back. */
  ask: string;
}

export interface ClarificationInput {
  subject?: string;
  body?: string;
  /** The seat's department, which is how a desk that owns a structured artefact is recognised. */
  department?: string;
  seatName?: string;
  tag?: string | null;
  /** A reply is never questioned — that is what stops a question loop. */
  isReply?: boolean;
  /** She typed an explicit book verb, so there is nothing left to be unsure about. */
  hasVerb?: boolean;
  /** A book was actually filed from this message. */
  bookFiled?: boolean;
  /** A forwarded message is a complete thought: "here, deal with this". */
  forwarded?: boolean;
  /**
   * The intake never decoded the text — the oversize path stores to R2 and does not parse. An empty
   * `body` then says nothing about what she wrote, so `nothing_to_act_on` may not fire.
   */
  unread?: boolean;
}

export declare function withoutTags(text: string): string;
export declare function namedThing(line: string): string | null;
export declare function isReplyMessage(input: {
  subject?: string; inReplyTo?: string | null; references?: string | null;
}): boolean;
export declare function clarificationFor(input: ClarificationInput): Clarification | null;
