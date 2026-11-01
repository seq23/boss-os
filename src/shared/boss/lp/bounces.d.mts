export function hardBouncedAddresses(text: string | null | undefined): string[];
export function twinReplyQueueRows(args: { sentRows: unknown[][]; hard: Map<string, number>; queued?: Set<string> }): string[][];
export function sendsAfterBounce(sends: { to: string[]; at: number }[], hard: Map<string, number>): { to: string; at: number }[];
export type NeverBounceVerdict = { send: boolean; mark: "valid" | "catchall" | "unknown" | "invalid" | "disposable" | "unverified" };
export function neverBounceVerdict(result: string | null | undefined): NeverBounceVerdict;
export const NEVERBOUNCE_CACHE_DAYS: number;
export const NEVERBOUNCE_MAX_PER_RUN: number;
export function verifyFirstSends(
  emails: string[],
  opts: { check: ((email: string) => Promise<string | null>) | null; cache?: Record<string, { result: string; at: number }>; cap?: number; now?: number },
): Promise<{ verdicts: Map<string, NeverBounceVerdict>; cache: Record<string, { result: string; at: number }>; checked: number }>;
export const REPLY_BUCKETS: Set<string>;
export function twinReplyQueueFromReplies(args: {
  sentRows: unknown[][];
  replies: Map<string, { bucket: string; when?: string; name?: string }>;
  queued?: Set<string>;
}): string[][];
