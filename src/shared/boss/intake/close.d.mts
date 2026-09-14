/**
 * Types for the close directive, so the Worker's intake and `scripts/validate` exercise the SAME
 * function rather than two copies of the same judgement.
 */

export interface OpenDeliverable {
  id: string;
  name: string;
}

export interface CloseDirective {
  id: string;
  name: string;
  /** The tokens that identified the deliverable, so the close can be explained rather than trusted. */
  matched: string[];
  /** Her sentence — the one carrying the verb — recorded as the reason on the row. */
  reason: string;
}

export interface AmbiguousClose {
  ambiguous: string[];
}

export declare const CLOSE_VERBS: readonly RegExp[];
export declare function closeSentenceIn(text: string): string | null;
export declare function tokensOf(deliverable: OpenDeliverable): { id: string[]; name: string[] };
export declare function deliverablesNamedIn(
  text: string,
  deliverables: readonly OpenDeliverable[],
): { id: string; name: string; matched: string[] }[];
export declare function closeDirectiveFor(input?: {
  text?: string;
  subject?: string;
  deliverables?: readonly OpenDeliverable[];
}): CloseDirective | AmbiguousClose | null;
