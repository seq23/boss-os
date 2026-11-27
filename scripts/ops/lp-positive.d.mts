/** Types for the pure exports of `lp-positive.mjs`, so the filter test can drive them. See `ics.d.mts`. */
export type Bucket = "negative" | "departed" | "auto" | "call" | "warm" | "other";

export interface Positive {
  address: string;
  name: string;
  bucket: "call" | "warm";
  first_seen: string;
  quote: string;
  /** Their own words, signature dropped (24 Oct 2026). */
  said?: string;
}

type Reader = typeof import("../../src/worker/boss/router/freeModel.ts").readWorkerSource;
type Reading = (input: Parameters<Reader>[0]) => ReturnType<Reader>;
type Message = { id: string; headers: Record<string, string>; body: string; internalDate: number; hardBounces?: string[] };
type Status = "complete" | "unavailable" | "allowance-exhausted" | "capped";
type Verdict = { id: string; address: string; threadId: string; at: number; name: string; knownSender?: boolean; disposition: string; excerpt?: string; side?: string; resumeOn?: string | null; bounced?: string[] };
export type LpReplyScan = { status: Status; records: Verdict[]; unread: { id: string; address: string }[]; uncertain?: Record<string, number>; held_now?: string[] };
type Options = {
  token: string; query: string; known?: Set<string>; receipts?: Record<string, Verdict>;
  list?: (token: string, query: string) => Promise<ReadonlyArray<readonly [string, Set<string>]>>;
  load?: (threadId: string, token: string) => Promise<Message[]>;
  read?: Reading;
  /** Uncertain answers per message id, carried across runs; the third holds the reply for her. */
  uncertain?: Record<string, number>;
  /** The most model reads this run; past it the rest stay unread and the status is "capped". */
  limit?: number;
};
export const LP_READS_PER_RUN: number;
export function listLpTargets(token: string, query: string): Promise<Array<[string, Set<string>]>>;
export function nameLpHeld(ids: string[], options?: { add?: (section: string, body: { lines: unknown[] }) => unknown }): Promise<void>;
export function readLpReply(target: Message, thread: Message[], options?: { read?: Reading; mailbox?: string; knownSender?: boolean }): Promise<{ status: string; disposition?: string; excerpt?: string; side?: string; resumeOn?: string | null }>;
export function scanLpReplies(options: Options): Promise<LpReplyScan>;
export function readProspectReplies(addresses: string[], sinceYmd: string, options?: { token?: () => Promise<string>; receipts?: Record<string, Verdict>; scan?: (input: Options) => Promise<LpReplyScan> }): Promise<Map<string, { kind: string; side?: string; resumeOn?: string | null }>>;
export function decodedBody(raw: string): string;
export function readableText(raw: string): string;
export function withoutSignature(text: string): string;
export function messageWords(id: string, opts?: { quoted?: boolean; token?: string | null }): Promise<{ text: string | null; at: number | null; thread: string | null; subject: string } | null>;
export function sentWordsTo(emails: string[], opts?: { max?: number }): Promise<any[]>;
export function reconcileList(
  existing: Positive[],
  run: { found: Map<string, Positive>; accepted: Set<string>; rejected: Map<string, string> },
): { people: Positive[]; removed: Array<Positive & { reason: string }>; added: number; promoted: number };
export function unansweredSection(f: { unanswered?: { name: string; address: string; bucket: string; draft: string; days?: number | null }[]; stops?: string[] } | null): string[];
export declare function accessToken(creds: any, scope: string, sub: string): Promise<string>;
export declare function contentToken(): Promise<string>;
