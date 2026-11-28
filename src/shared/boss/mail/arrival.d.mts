export type Arrival = "arrived" | "not_arrived" | "pending" | "unknown";
export const ARRIVAL_GRACE_MS: number;
export function resendArrival(event: unknown, sentAt: number, now?: number): Arrival;
export function mailboxArrival(found: unknown, sentAt: number, now?: number): Arrival;
export function arrivalVerdict(items: { arrival: string }[] | null | undefined, what: string): { state: "verified" | "nothing_due" | "missing" | "unknown"; evidence: string };
export function replyArrivals<T extends { at: string }>(replies: T[], carriers: { day: string; built_at: number; keys?: string[]; arrival: string }[], keyOf: (r: T) => string, now?: number): (T & { arrival: Arrival })[];
