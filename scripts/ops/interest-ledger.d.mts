/** Types for the pure exports of `interest-ledger.mjs` the tests touch. See `ics.d.mts` for why this is hand-written. */
import type { HeaderMap } from "./mail-bulk.d.mts";
export function bulkReason(headers: HeaderMap): string | null;
export function shapeReason(text: string): string | null;
export function withoutQuoted(text: string): string;
export const SIZE_RE: RegExp;
export const SIDE_RE: RegExp;
