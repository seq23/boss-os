/** Types for lp-followups.mjs. See that file. */
export const PASS_LABELS: readonly string[];
export function daysWaiting(firstSeen: string, now?: number): number | null;
export function firstName(name: unknown): string;
export function chicagoInstant(ymd: string, hour: number, minute: number): number;
export function pickSlots(busy: [number, number][], now?: number, want?: number, zone?: string): number[];
export function slotLine(t: number | { start: number; zone: string }): string;
export function draftBody(args: { name?: string | null; bucket: string; slots: Array<number | { start: number; zone: string }> }): string;
export function againReply(a: { name?: string | null; said?: string | null; offered?: { start: number; zone: string }[]; slots?: { start: number; zone: string }[]; busy?: [number, number][] | null; now?: number; zoneOn?: ((ymd: string) => string | null) | null }):
  { kind: "confirm" | "times" | "plain"; body: string; picked: { start: number; zone: string } | null; offered: { start: number; zone: string }[] };
export function hashOf(s: string): string;
export type UnansweredRow = { name: string; address: string; bucket: string; first_seen: string; draft: string; days?: number | null };
export function unansweredOrder(rows: UnansweredRow[], now?: number): (UnansweredRow & { days: number | null })[];
export function followUps(people: unknown[], opts?: { now?: number; skipped?: Set<string>; where?: { away_city?: string | null; away_until?: string | null } | null; offered?: Record<string, unknown> }): Promise<{ unanswered: (UnansweredRow & { days: number | null })[]; stops: string[]; counts: Record<string, number> }>;
