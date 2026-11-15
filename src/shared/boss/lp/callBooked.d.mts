/** Types for callBooked.mjs. See that file. */
export function sameContact(a: string, b: string): boolean;
export function callFor(address: string, events: Array<{ scheduled_at: number; status?: string | null; description?: string | null; attendees?: Array<{ email?: string | null; self?: boolean; responseStatus?: string | null }> }>, now?: number): { start: number; held: boolean } | null;
export function callWhen(start: number): string;
export function callLine(start: number, now?: number): string;
export const CALENDAR_UNREAD_STOP: (why: unknown) => string;
