export const REPLY_LOOKBACK_DAYS: number;
export function syncAgentReplies(o: { client: { replies: (since: string) => Promise<unknown> }; now?: number; write?: (...args: unknown[]) => unknown; dir?: string }): Promise<{ read: number; cards: number; unread: number }>;
