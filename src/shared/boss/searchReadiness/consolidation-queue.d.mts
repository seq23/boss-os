/** Types for the consolidation queue (consolidation-queue.mjs). */
export const CONSOLIDATION: { AGE_DAYS: number; WINDOW_DAYS: number; MAX_HUBS: number; MAX_URLS: number };
export function pageKey(u: string): string;
export function consolidationQueue(a: { sitemapUrls?: string[]; lastmods?: Record<string, string>; firstSeen?: Record<string, string>; gsc: any; now?: number; protectedPaths?: string[] }): { status: "queued" | "clear" | "not_read"; candidates: number; hubCount?: number; hubs: { hub: string; hubUrl: string; total: number; urls: string[] }[]; why?: string };
export function nextFirstSeen(prev: Record<string, string> | null | undefined, sitemapUrls: string[], day: string): Record<string, string>;
