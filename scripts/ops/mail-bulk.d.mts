/**
 * Types for `mail-bulk.mjs`. Named `.d.mts` because that is what TypeScript looks for beside a
 * `.mjs`. Hand-written and tiny, same reason as `ics.d.mts`: the module must be plain JavaScript
 * because two ops scripts import it at runtime, and the tests want it typed.
 */
export type HeaderMap = Record<string, string>;

export const OUR_DOMAINS: readonly string[];
export function bulkReason(headers: HeaderMap): string | null;
export function addressIn(raw: unknown): string;
export function ownDomainReason(address: string): "own_domain" | null;
export function headersFromRaw(raw: string): HeaderMap;
export function referencedIds(headers: HeaderMap): string[];
export function quotesMailbox(bodyText: string, mailbox: string): boolean;
export function replyEvidence(args: {
  headers: HeaderMap;
  bodyText: string;
  mailbox: string;
  sentByUs: (messageId: string) => Promise<boolean> | boolean;
}): Promise<{ evidence: "quoted" | "thread"; reason?: undefined } | { reason: "not_a_reply"; evidence?: undefined }>;
