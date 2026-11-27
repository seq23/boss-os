export const OUR_MAIL_DOMAINS: readonly string[];
export function addressesIn(value: unknown): Array<{ address: string; display: string }>;
export function isOurs(address: string, extra?: string[]): boolean;
export function replyAllRecipients(latest: Record<string, string | null | undefined> | null | undefined, o?: { ours?: string[] }): { to: string[]; cc: string[] };
export function recipientLines(r: { to?: string[]; cc?: string[] } | null | undefined): string[];
