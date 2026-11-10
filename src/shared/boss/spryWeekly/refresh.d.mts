export type RefreshSource = { repo: string; path?: string; site?: string };
export type RefreshRead = { src: RefreshSource; ledger?: { pages?: Record<string, Record<string, unknown>> }; problem?: string };
export const REFRESH_LEDGERS: RefreshSource[];
export function lastMonth(now?: number): { from: string; to: string; label: string };
export function firstWeekOfMonth(now?: number): boolean;
export function refreshCount(reads: RefreshRead[], range: { from: string; to: string }): { pages: number; sites: number; unread: string[] };
export function refreshLine(reads: RefreshRead[], opts?: { now?: number }): string | null;
