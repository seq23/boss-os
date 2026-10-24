/** Types for the buy↔sell matcher. See match.mjs for the rules. */
export const STALE_DAYS: number;
export const OLD_DAYS: number;
export const DEFAULT_TOLERANCE: number;
export const TOLERANCES: readonly number[];
export function ageDays(receivedOn: unknown, now?: number): number | null;
export function ageWords(receivedOn: unknown, now?: number): string;
export function parsePrice(text: unknown): { kind: "share" | "valuation"; value: number } | null;
export function moneyShort(n: number, kind?: "share" | "valuation"): string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function priceGap(buyer: any, seller: any): { gap: number; ask: any; bid: any } | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function gapWords(buyer: any, seller: any): string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fillWords(order: any, other: any): string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rankMatches(deal: any, candidates: any[], opts?: { tolerance?: number; now?: number }): { matches: any[]; stack: string | null };
