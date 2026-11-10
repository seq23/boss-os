export type RefreshSource = { repo: string; path?: string; site?: string; label?: string };
export type RefreshRun = { at: string; refreshed?: number; due?: number; outcome?: string; next_due?: string | null };
export type RefreshRead = { src: RefreshSource; ledger?: { pages?: Record<string, Record<string, unknown>>; runs?: RefreshRun[]; next_due?: string | null }; problem?: string };
export function laneState(read: RefreshRead, range: { from: string; to: string }): { state: "unread" | "no_runs" | "refreshed" | "stalled" | "nothing_due"; next_due?: string | null };
export const REFRESH_LEDGERS: RefreshSource[];
export function lastMonth(now?: number): { from: string; to: string; label: string };
export function firstWeekOfMonth(now?: number): boolean;
export function refreshCount(reads: RefreshRead[], range: { from: string; to: string }): { pages: number; sites: number; unread: string[] };
export function refreshLine(reads: RefreshRead[], opts?: { now?: number }): string | null;
