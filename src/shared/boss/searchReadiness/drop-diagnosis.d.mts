/** Types for the drop diagnosis (drop-diagnosis.mjs). Loose on purpose: the shapes are JSON. */
export const DIAG: { TOP: number; INSPECT: number; MAX_LINES: number; CONCENTRATED: number; SITEMAP_SHRINK: number; SITEMAP_SURGE: number };
export function shortUrl(u: string): string;
export function windowLosses(current: any[], previous: any[]): { key: string; before: number; after: number; lost: number; gone: boolean }[];
export function diagnoseDrop(a: any): any;
export function mostLikely(diagnosis: any): string | null;
export function endStop(t: string): string;
