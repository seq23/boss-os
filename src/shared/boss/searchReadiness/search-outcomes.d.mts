/** Types for the outcome alarm (search-outcomes.mjs). Loose on purpose: the shapes are JSON. */
export const OUTCOME: { WINDOW_DAYS: number; LAG_DAYS: number; DROP: number; MIN_PRIOR_IMPRESSIONS: number; MIN_PRIOR_CLICKS: number; DENSITY_MIN_URLS: number; DENSITY_PER_PAGE: number };
type Win = { start: string; end: string };
export function outcomeWindows(now?: number, opts?: { days?: number; lag?: number }): { current: Win; previous: Win; start: string; end: string };
export function sumWindow(rows: any[], w: Win): { impressions: number; clicks: number; days: number };
export function outcomeVerdict(a: { read: any; sitemapUrls?: number | null; now?: number }): any;
export function redLines(siteResults: any[]): { domain: string | null; kind: string; line: string }[];
export function weeklyBriefs(siteResults: any[], opts?: { now?: number }): any[];
