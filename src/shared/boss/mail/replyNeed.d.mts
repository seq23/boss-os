/** Types for replyNeed.mjs: does an email need a reply, and who the reply goes to. */
export const OUR_MAIL_DOMAINS: readonly string[];
export type ReplyNeedKind = "asks" | "invites" | "auto_reply" | "pass_along" | "reviewing" | "thanks" | "fyi" | "nothing_asked";
export function replyNeed(text: string | null | undefined, o?: { subject?: string; headers?: Record<string, string | null | undefined> }): { needed: boolean; kind: ReplyNeedKind; why: string };
export function addressesIn(value: unknown): Array<{ address: string; display: string }>;
export function isOurs(address: string, extra?: string[]): boolean;
export function replyAllRecipients(latest: Record<string, string | null | undefined> | null | undefined, o?: { ours?: string[] }): { to: string[]; cc: string[] };
export function recipientLines(r: { to?: string[]; cc?: string[] } | null | undefined): string[];
