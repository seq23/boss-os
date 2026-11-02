/** Types for quality sampling (page-quality-sample.mjs). */
export const QUALITY: { SAMPLE: number; ITEMS: readonly string[]; SLOT_WORDS: number; SLOT_MAX: number; SHINGLE: number; NEAR_DUPLICATE: number; PAGE_FAIL_SHARE: number };
export function isoWeek(t?: number): string;
export function pickSample(urls: Iterable<string>, opts?: { n?: number; week?: string; exclude?: string[] }): string[];
export function bodyText(html: string): string;
export function scorePage(page: { url?: string; html?: string | null }, opts?: { host?: string }): Record<string, { ok: boolean; note?: string } | null>;
export function repeatedSlots(text: string, opts?: { n?: number; max?: number }): { phrase: string; times: number }[];
export function similarity(a: string, b: string, k?: number): number;
export function qualitySample(a: { site: any; host: string; pages: any[]; checklist: any }): any;
