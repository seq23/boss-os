/** Types for the pure exports of `lp-positive.mjs`, so the filter test can drive them. See `ics.d.mts`. */
export type Bucket = "negative" | "departed" | "auto" | "call" | "warm" | "other";

export interface Positive {
  address: string;
  name: string;
  bucket: "call" | "warm";
  first_seen: string;
  quote: string;
}

export type Screened =
  | { drop: true; address: string; reason: string }
  | { drop: false; address: string; name: string; bucket: Bucket; why: string; text: string; evidence: "quoted" | "thread" };

export function decodedBody(raw: string): string;
export function readableText(raw: string): string;
export function screenMessage(
  raw: string,
  opts: { mailbox?: string; sentByUs: (messageId: string) => Promise<boolean> | boolean },
): Promise<Screened>;
export function reconcileList(
  existing: Positive[],
  run: { found: Map<string, Positive>; accepted: Set<string>; rejected: Map<string, string> },
): { people: Positive[]; removed: Array<Positive & { reason: string }>; added: number; promoted: number };
