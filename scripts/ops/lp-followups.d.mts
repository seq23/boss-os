/** Types for lp-followups.mjs. See that file. */
export const PASS_LABELS: readonly string[];
export function daysWaiting(firstSeen: string, now?: number): number | null;
export function firstName(name: unknown): string;
export function chicagoInstant(ymd: string, hour: number, minute: number): number;
export function pickSlots(busy: [number, number][], now?: number, want?: number): number[];
export function slotLine(t: number): string;
export function draftBody(args: { name?: string | null; bucket: string; slots: number[] }): string;
export function hashOf(s: string): string;
export type UnansweredRow = { name: string; address: string; bucket: string; first_seen: string; draft: string; days?: number | null };
export function unansweredOrder(rows: UnansweredRow[], now?: number): (UnansweredRow & { days: number | null })[];
export function followUps(people: unknown[], opts?: { now?: number }): Promise<{ unanswered: (UnansweredRow & { days: number | null })[]; stops: string[]; counts: Record<string, number> }>;
